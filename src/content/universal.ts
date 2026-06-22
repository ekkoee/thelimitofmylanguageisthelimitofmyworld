import { Settings } from '../core/types';
import { hasTranslatableText } from '../core/segmentation';
import { renderTranslationAfter } from './engine';

// Block-level elements that usually hold readable prose. Containers like
// <div>/<article> are intentionally excluded — we de-duplicate by containment
// and translate the innermost text block, which keeps granularity sane on
// arbitrary sites.
const BLOCK_SELECTOR = [
  'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'figcaption', 'dd', 'dt', 'summary',
  'td', 'th', 'caption',
].join(',');

// Never translate inside these (code, controls, editors, our own output).
const SKIP_ANCESTORS = 'script,style,noscript,code,pre,kbd,samp,textarea,select,option,svg,[contenteditable],[data-ibt-skip],.ibt-block';

const UNI_ATTR = 'data-ibt-uni'; // marks a source element we've handled

export class UniversalTranslator {
  private active = false;
  private io?: IntersectionObserver;
  private mo?: MutationObserver;
  private rescan?: number;
  private readonly blocks = new Set<HTMLElement>();   // inserted translation blocks
  private readonly sources = new Set<HTMLElement>();  // source elements we marked
  private settings: Settings;

  constructor(getSettings: () => Settings) { this.settings = getSettings(); }
  setSettings(s: Settings): void {
    this.settings = s;
    if (this.active && !s.enabled) this.deactivate();
  }

  isActive(): boolean { return this.active; }

  toggle(): boolean { this.active ? this.deactivate() : this.activate(); return this.active; }

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.scan();
    this.mo = new MutationObserver(() => this.scheduleScan());
    this.mo.observe(document.body, { childList: true, subtree: true });
    toast('整頁雙語已開啟（再按 Alt+A 關閉）');
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.mo?.disconnect(); this.mo = undefined;
    this.io?.disconnect(); this.io = undefined;
    if (this.rescan) { clearTimeout(this.rescan); this.rescan = undefined; }
    this.blocks.forEach((b) => b.remove());
    this.blocks.clear();
    this.sources.forEach((s) => s.removeAttribute(UNI_ATTR));
    this.sources.clear();
    toast('整頁雙語已關閉');
  }

  private scheduleScan(): void {
    if (!this.active) return;
    if (this.rescan) clearTimeout(this.rescan);
    this.rescan = setTimeout(() => this.scan(), 350) as unknown as number;
  }

  private firstScanReported = false;

  private scan(): void {
    if (!this.active || !this.settings.enabled) return;
    const nodes = document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);
    const candidates: HTMLElement[] = [];
    let skippedAsTarget = 0;
    nodes.forEach((node) => {
      if (!this.eligible(node)) return;
      // (task 4) This path only: skip text that's ALREADY the target language
      // (e.g. Chinese page) to avoid pointless 中文→中文 double lines. Deliberately
      // NOT applied to X/Reddit's per-node scan (slower, and source is ~never zh).
      if (this.looksAlreadyTarget(node)) { skippedAsTarget++; return; }
      candidates.push(node);
    });

    // keep only innermost blocks (drop any that contain another candidate)
    const leaves = candidates.filter((c) => !candidates.some((o) => o !== c && c.contains(o)));

    if (!this.firstScanReported) {
      this.firstScanReported = true;
      if (!leaves.length && skippedAsTarget > 0) toast('這頁看起來已經是中文，不需要翻譯');
    }

    for (const node of leaves) {
      node.setAttribute(UNI_ATTR, '1');
      this.sources.add(node);
      if (this.settings.translateOnVisible) this.ensureIO().observe(node);
      else this.render(node);
    }
  }

  private eligible(node: HTMLElement): boolean {
    if (node.hasAttribute(UNI_ATTR)) return false;
    if (node.closest(SKIP_ANCESTORS)) return false;
    const text = (node.innerText || '').trim();
    if (!text || text.length < 2 || !hasTranslatableText(text)) return false;
    if (!node.getClientRects().length) return false; // hidden / not rendered
    return true;
  }

  // True when the text is already in the target language (only meaningful for a
  // Chinese target). Han-dominant AND no Japanese kana / Korean hangul → it's
  // Chinese, so translating it would just stack 中文 on 中文.
  private looksAlreadyTarget(node: HTMLElement): boolean {
    if (!(this.settings.targetLangCode || '').toLowerCase().startsWith('zh')) return false;
    const text = (node.innerText || '').trim();
    const han = (text.match(/\p{Script=Han}/gu) || []).length;
    if (!han) return false;
    if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return false;
    const letters = (text.match(/\p{L}/gu) || []).length || 1;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    return han / letters >= 0.5 && latin / letters < 0.5;
  }

  private ensureIO(): IntersectionObserver {
    if (this.io) return this.io;
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const src = e.target as HTMLElement;
        this.io!.unobserve(src);
        this.render(src);
      }
    }, { rootMargin: '400px' });
    return this.io;
  }

  private render(node: HTMLElement): void {
    const text = (node.innerText || '').trim();
    const block = renderTranslationAfter(node, text);
    if (block) this.blocks.add(block);
  }
}

// --- tiny transient toast (bottom-center) ---
let toastEl: HTMLDivElement | null = null;
let toastTimer: number | undefined;
export function toast(msg: string): void {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'ibt-toast'; }
  toastEl.textContent = msg;
  if (!toastEl.isConnected) document.documentElement.appendChild(toastEl);
  toastEl.classList.add('ibt-toast-show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl?.classList.remove('ibt-toast-show'); }, 1800) as unknown as number;
}
