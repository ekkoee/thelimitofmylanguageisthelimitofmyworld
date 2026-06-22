import { AlignedPair, Settings, TranslateBatchResponse, TranslateResponse } from '../core/types';
import { SELECTORS, queryFirst } from './selectors';
import { onUrlChange } from '../utils/observer';
import { el } from '../utils/dom';
import { extensionAlive, isContextGoneError, sendMessage } from '../utils/runtime';

const ROOT_FLAG = 'data-ibt-yt';
const SETTLE_MS = 180;
const POLL_MS = 100;
const EMPTY_GRACE_MS = 400;
const LOOKAHEAD = 16;           // translate this many upcoming cues ahead (batched in one request)
const AHEAD_THROTTLE_MS = 400;

interface Cue { start: number; end: number; text: string }

let controller: Controller | null = null;

export function startYouTube(getSettings: () => Settings): void {
  const boot = () => { controller?.destroy(); controller = new Controller(getSettings); void controller.start(); };
  boot();
  onUrlChange(() => boot());
}
export function updateYouTubeSettings(s: Settings): void { controller?.setSettings(s); }

// ---------------------------------------------------------------------------
// Controller: starts in the safe "DOM mode" (inject Chinese beside YouTube's own
// caption) and UPGRADES to "movie mode" the instant the page bridge intercepts
// the real subtitle track (which happens when the viewer turns captions on).
// ---------------------------------------------------------------------------
class Controller {
  private settings: Settings;
  private track?: TrackCaptions;
  private dom?: DomCaptions;
  private player: HTMLElement | null = null;
  private cancelled = false;
  private loadedToken = '';
  private onCues = (e: MessageEvent): void => this.handleCues(e);

  constructor(getSettings: () => Settings) { this.settings = getSettings(); }
  setSettings(s: Settings) { this.settings = s; this.track?.setSettings(s); this.dom?.setSettings(s); }

  async start(): Promise<void> {
    this.cancelled = false;
    window.addEventListener('message', this.onCues);

    this.player = await this.waitForPlayer();
    if (!this.player || this.cancelled) return;

    // Safe default: show the injected line beside YouTube's caption right away.
    this.dom = new DomCaptions(() => this.settings, this.player);
    this.dom.start();

    // Prompt the bridge in case captions were already on before we attached.
    window.postMessage({ source: 'ibt-iso', type: 'getCues' }, '*');
  }

  private handleCues(e: MessageEvent): void {
    if (this.cancelled || e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'ibt-main' || d.type !== 'cues' || !d.ok || !d.cues?.length) return;
    if (d.videoId && d.videoId !== currentVideoId()) return; // stale (previous video)

    const token = (d.videoId || '') + ':' + d.cues.length;
    if (token === this.loadedToken && this.track) return; // already showing this track
    this.loadedToken = token;

    const merged = mergeCues(d.cues as Cue[]);
    console.log('[IBT] 字幕軌載入成功 →「電影模式」，', d.lang, '/', d.kind, '— 原始', d.cues.length, '句，合併為', merged.length, '句');
    this.dom?.destroy(); this.dom = undefined;            // hand off from fallback
    this.track?.destroy();
    if (this.player) { this.track = new TrackCaptions(() => this.settings, this.player, merged); this.track.start(); }
  }

  private async waitForPlayer(): Promise<HTMLElement | null> {
    for (let i = 0; i < 60 && !this.cancelled; i++) {
      const p = queryFirst(SELECTORS.youtube.player)[0] as HTMLElement | undefined;
      if (p) return p;
      await delay(500);
    }
    return null;
  }

  destroy(): void {
    this.cancelled = true;
    window.removeEventListener('message', this.onCues);
    this.track?.destroy(); this.dom?.destroy();
    this.track = undefined; this.dom = undefined;
  }
}

function currentVideoId(): string | null {
  try { return new URL(location.href).searchParams.get('v'); } catch { return null; }
}

// Auto-caption tracks are split into tiny fragments (often mid-sentence), which
// gives the translator no context and reads poorly. Merge consecutive fragments
// back into sentence-sized cues: flush on sentence-ending punctuation, a clear
// pause, or once a line gets long enough to stand on its own.
function mergeCues(raw: Cue[]): Cue[] {
  const MAX_CHARS = 90;
  const GAP_MS = 800;
  const out: Cue[] = [];
  let cur: Cue | null = null;
  for (const c of raw) {
    if (!cur) { cur = { start: c.start, end: c.end, text: c.text }; continue; }
    const gap = c.start - cur.end;
    const endsSentence = /[.!?。！？]['")\]]?$/.test(cur.text);
    const combined = (cur.text + ' ' + c.text).replace(/\s+/g, ' ').trim();
    if (endsSentence || gap > GAP_MS || combined.length > MAX_CHARS) {
      out.push(cur);
      cur = { start: c.start, end: c.end, text: c.text };
    } else {
      cur.text = combined;
      cur.end = c.end;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// MOVIE MODE — render our own clean bilingual subtitle from the subtitle track,
// synced to video.currentTime. One sentence at a time, Chinese on top.
// ---------------------------------------------------------------------------
class TrackCaptions {
  private settings: Settings;
  private overlay?: HTMLDivElement;
  private enEl?: HTMLDivElement;
  private zhEl?: HTMLDivElement;
  private raf = 0;
  private lastIdx = -2;
  private everShown = false;
  private readonly trans = new Map<number, string>();
  private readonly inflight = new Set<number>();
  private lastAhead = 0;
  private cooldownUntil = 0;
  private warned = false;

  constructor(getSettings: () => Settings, private player: HTMLElement, private cues: Cue[]) {
    this.settings = getSettings();
  }
  setSettings(s: Settings) { this.settings = s; }
  start(): void { this.ensureOverlay(); this.loop(); }

  private video(): HTMLVideoElement | null { return this.player.querySelector('video'); }

  private loop = (): void => {
    // Extension reloaded/updated → this content script is dead. Stop the loop
    // (don't reschedule) and tear down, so we don't spam sendMessage failures.
    if (!extensionAlive()) { this.destroy(); return; }
    this.raf = requestAnimationFrame(this.loop);
    const s = this.settings;
    if (!s.enabled || !s.sites.youtube) { this.hide(); this.flag(false); return; }

    // only show while the viewer has captions turned on
    const ccOn = !!queryFirst(SELECTORS.youtube.captionWindow, this.player)[0];
    if (!ccOn) { this.hide(); this.flag(false); return; }

    const v = this.video();
    if (!v) return;
    const ms = v.currentTime * 1000;
    const idx = this.findCue(ms);
    this.ensureAhead(idx, ms);

    if (idx !== this.lastIdx) {
      this.lastIdx = idx;
      if (idx < 0) { this.hide(); }
      else {
        this.ensureOverlay();
        this.applyFont();
        this.applyOrder();
        this.setEn(this.cues[idx].text);
        this.setZh(this.trans.get(idx) || '');
        this.show();
      }
    } else if (idx >= 0) {
      const t = this.trans.get(idx);
      if (t && this.zhEl && this.zhEl.textContent !== t) this.setZh(t);
    }
    this.flag(this.everShown); // hide native only once we've shown a cue
  };

  private findCue(ms: number): number {
    const c = this.cues;
    let lo = 0, hi = c.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (ms < c[m].start) hi = m - 1;
      else if (ms >= c[m].end) lo = m + 1;
      else return m;
    }
    return -1;
  }

  private nextIdx(ms: number): number {
    const c = this.cues;
    let lo = 0, hi = c.length - 1, ans = c.length;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m].start > ms) { ans = m; hi = m - 1; } else lo = m + 1; }
    return ans;
  }

  private ensureAhead(idx: number, ms: number): void {
    const now = Date.now();
    if (now - this.lastAhead < AHEAD_THROTTLE_MS) return;
    if (now < this.cooldownUntil) return;
    this.lastAhead = now;

    const base = Math.max(0, idx >= 0 ? idx : this.nextIdx(ms));
    const batch: number[] = [];
    for (let i = base; i <= base + LOOKAHEAD && i < this.cues.length; i++) {
      if (this.trans.has(i) || this.inflight.has(i)) continue;
      batch.push(i);
    }
    if (!batch.length) return;

    batch.forEach((i) => this.inflight.add(i));
    const texts = batch.map((i) => this.cues[i].text);
    translateBatch(texts)
      .then((arr) => {
        this.warned = false;
        batch.forEach((i, k) => { const t = (arr[k] || '').trim(); if (t) this.trans.set(i, t); });
      })
      .catch((err) => {
        if (isContextGoneError(err)) return; // extension reloaded → loop will stop itself
        const msg = String(err?.message ?? err);
        const quota = /\b429\b|quota|rate/i.test(msg);
        this.cooldownUntil = Date.now() + (quota ? 60000 : 4000); // quota: wait a minute; other: brief
        if (!this.warned) {
          this.warned = true;
          if (quota) console.warn('[IBT] 翻譯額度用盡（Gemini 429）。建議把模型改成 gemini-2.5-flash-lite（額度較高），或改用免費 Google；額度每天會重置。');
          else console.warn('[IBT] 翻譯失敗：', msg, '（稍後重試）');
        }
      })
      .finally(() => batch.forEach((i) => this.inflight.delete(i)));
  }

  private ensureOverlay(): void {
    if (this.overlay && this.overlay.isConnected) return;
    if (getComputedStyle(this.player).position === 'static') this.player.style.position = 'relative';
    this.overlay = el('div', 'ibt-yt-overlay');
    this.zhEl = el('div', 'ibt-yt-zh');
    this.enEl = el('div', 'ibt-yt-en');
    this.overlay.append(this.zhEl, this.enEl); // Chinese on top
    this.overlay.style.display = 'none';
    this.player.appendChild(this.overlay);
  }

  private applyFont(): void {
    const base = Math.min(46, Math.max(16, this.player.clientHeight * 0.036));
    const size = Math.round(base * this.settings.fontScale);
    if (this.enEl) this.enEl.style.fontSize = `${size}px`;
    if (this.zhEl) this.zhEl.style.fontSize = `${size}px`;
  }

  private applyOrder(): void {
    const zhTop = this.settings.subtitleOrder !== 'enTop';
    if (this.zhEl) this.zhEl.style.order = zhTop ? '0' : '1';
    if (this.enEl) this.enEl.style.order = zhTop ? '1' : '0';
  }

  private setEn(t: string): void { if (this.enEl && this.enEl.textContent !== t) this.enEl.textContent = t; }
  private setZh(t: string): void {
    if (this.zhEl) { if (this.zhEl.textContent !== t) this.zhEl.textContent = t || ''; this.zhEl.style.display = t ? '' : 'none'; }
  }

  private flag(on: boolean): void {
    const r = document.documentElement;
    if (on) { if (r.getAttribute(ROOT_FLAG) !== 'on') r.setAttribute(ROOT_FLAG, 'on'); }
    else if (r.getAttribute(ROOT_FLAG) === 'on') r.removeAttribute(ROOT_FLAG);
  }

  private show(): void { if (this.overlay) { this.overlay.style.display = 'flex'; this.everShown = true; } }
  private hide(): void { if (this.overlay) this.overlay.style.display = 'none'; }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.flag(false);
    this.overlay?.remove();
    this.overlay = undefined; this.enEl = undefined; this.zhEl = undefined;
  }
}

// ---------------------------------------------------------------------------
// DOM MODE (fallback) — inject a Chinese line beside YouTube's on-screen
// caption. Native English is never hidden, so captions never vanish.
// ---------------------------------------------------------------------------
function stripCaptionHint(t: string): string {
  return t
    .replace(/\s*\S*\s*\((?:auto-generated|自動產生|自动生成)\).*$/i, '')
    .replace(/\s*(?:tap|click|按一下|輕觸)\s*(?:to\s*)?(?:進入設定|enter settings|view settings|設定).*$/i, '')
    .trim();
}

class DomCaptions {
  private settings: Settings;
  private timer?: number;
  private settle?: number;
  private lineEl?: HTMLDivElement;
  private spanEl?: HTMLSpanElement;
  private curText = '';
  private lastTrans = '';
  private lastSeen = 0;

  constructor(getSettings: () => Settings, private player: HTMLElement) { this.settings = getSettings(); }
  setSettings(s: Settings) { this.settings = s; if (!s.enabled || !s.sites.youtube) this.removeLine(); }
  start(): void { this.timer = setInterval(() => this.tick(), POLL_MS) as unknown as number; this.tick(); }

  private tick(): void {
    // Extension reloaded/updated → stop polling cleanly.
    if (!extensionAlive()) { this.removeLine(); if (this.timer) clearInterval(this.timer); return; }
    const p = this.player;
    const s = this.settings;
    if (!s.enabled || !s.sites.youtube) { this.removeLine(); return; }

    const container = queryFirst(SELECTORS.youtube.captionWindow, p)[0] as HTMLElement | undefined;
    const segs = container ? queryFirst(SELECTORS.youtube.captionSegment, container) : [];
    let text = segs.map((n) => (n as HTMLElement).innerText).join(' ').replace(/\s+/g, ' ').trim();
    text = stripCaptionHint(text);

    const now = Date.now();
    if (!text || !container) {
      if (now - this.lastSeen > EMPTY_GRACE_MS) { this.removeLine(); this.curText = ''; }
      return;
    }
    this.lastSeen = now;

    const win = (queryFirst(SELECTORS.youtube.captionWindowInner, container)[0] as HTMLElement) || container;
    this.ensureLine(win);
    this.applyFont();
    if (text !== this.curText) {
      this.curText = text;
      if (this.settle) clearTimeout(this.settle);
      this.settle = setTimeout(() => this.doTranslate(text), SETTLE_MS) as unknown as number;
    }
  }

  private async doTranslate(text: string): Promise<void> {
    if (text !== this.curText) return;
    try {
      const pairs = await translateBlock(text);
      const t = pairs.map((p) => p.t).filter(Boolean).join(' ');
      if (this.curText === text) { this.lastTrans = t; this.setText(t); }
    } catch { /* English stays visible */ }
  }

  private host(win: HTMLElement): HTMLElement {
    const tb = win.querySelector('.captions-text') as HTMLElement | null;
    return (tb?.parentElement as HTMLElement) || win;
  }
  private ensureLine(win: HTMLElement): void {
    if (!this.lineEl) { this.lineEl = el('div', 'ibt-yt-line'); this.spanEl = el('span'); this.lineEl.appendChild(this.spanEl); }
    const host = this.host(win);
    if (this.lineEl.isConnected && this.lineEl.parentElement === host) return;
    const tb = win.querySelector('.captions-text') as HTMLElement | null;
    host.insertBefore(this.lineEl, tb ?? host.firstChild); // Chinese on top
    this.setText(this.lastTrans);
  }
  private applyFont(): void {
    if (!this.spanEl) return;
    const base = Math.min(46, Math.max(16, this.player.clientHeight * 0.036));
    this.spanEl.style.fontSize = `${Math.round(base * this.settings.fontScale)}px`;
  }
  private setText(t: string): void {
    if (this.spanEl && this.spanEl.textContent !== t) this.spanEl.textContent = t || '';
    if (this.lineEl) this.lineEl.style.display = t ? '' : 'none';
  }
  private removeLine(): void { this.lineEl?.remove(); }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.settle) clearTimeout(this.settle);
    this.lineEl?.remove();
    this.lineEl = undefined; this.spanEl = undefined; this.curText = ''; this.lastTrans = '';
  }
}

// ---- helpers ----
async function translateBlock(text: string): Promise<AlignedPair[]> {
  const resp = await sendMessage<TranslateResponse>({ type: 'translate', text });
  if (!resp?.ok) throw new Error(resp?.error || 'failed');
  return resp.pairs || [];
}

async function translateBatch(texts: string[]): Promise<string[]> {
  const resp = await sendMessage<TranslateBatchResponse>({ type: 'translateBatch', texts });
  if (!resp?.ok) throw new Error(resp?.error || 'failed');
  return resp.translations || [];
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
