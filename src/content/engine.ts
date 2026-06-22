import { AlignedPair, Settings, TranslateResponse } from '../core/types';
import { hasTranslatableText, isAlreadyTargetLang } from '../core/segmentation';
import { el, isProcessed, markProcessed } from '../utils/dom';
import { sendMessage, isContextGoneError } from '../utils/runtime';

export interface TextUnit { source: HTMLElement; text: string; }
export interface SiteAdapter { id: string; collect(): TextUnit[]; }

async function translateBlock(text: string): Promise<AlignedPair[]> {
  const resp = await sendMessage<TranslateResponse>({ type: 'translate', text });
  if (!resp?.ok) throw new Error(resp?.error || 'translate failed');
  return resp.pairs || [];
}

function fillPairs(block: HTMLElement, pairs: AlignedPair[]): void {
  block.className = 'ibt-block';
  block.textContent = '';
  // Our block holds ONLY the translation. The original stays as the page's own
  // text (rich: links/mentions/media intact); the 3-state view shows/hides that
  // original via `.ibt-orig-src`. No `.ibt-orig` duplicate → no double original.
  for (const p of pairs) {
    block.appendChild(el('div', 'ibt-trans', p.t));
  }
}

// Shown when the extension context is gone (reload/update): a refresh reloads
// the fresh content script and translation resumes.
function showReloadHint(block: HTMLElement): void {
  block.className = 'ibt-block';
  block.textContent = '';
  block.appendChild(el('span', 'ibt-error-msg', '擴充功能已更新，請重新整理此頁面以繼續翻譯。'));
}

function showError(block: HTMLElement, message: string, retry: () => void): void {
  block.className = 'ibt-block ibt-error';
  block.textContent = '';
  const friendly = message.startsWith('NO_API_KEY')
    ? '此引擎需要 API key — 點擊擴充功能圖示 → 選項頁填入（或切回免費引擎）。'
    : `翻譯失敗：${message}`;
  block.appendChild(el('span', 'ibt-error-msg', friendly));
  const btn = el('button', 'ibt-retry', '重試');
  btn.addEventListener('click', retry);
  block.appendChild(btn);
}

/** Insert a translation block right AFTER `anchor` (element or text node).
 *  `opts.sig` stamps a content fingerprint on the block (data-ibt-sig) so a re-scan
 *  can detect "this exact translation already sits here" even after the framework
 *  swaps the source node — see universal.ts. Every block is also tagged
 *  data-ibt-out so the universal MutationObserver ignores its own insertions. */
export function renderTranslationAfter(
  anchor: Node, text: string, opts?: { sig?: string },
): HTMLElement | null {
  if (!hasTranslatableText(text)) return null;
  const block = el('div', 'ibt-block ibt-loading');
  block.dataset.ibtOut = '1';
  if (opts?.sig) block.dataset.ibtSig = opts.sig;
  block.appendChild(el('span', 'ibt-loading-dot', '翻譯中…'));
  if (anchor.parentNode) anchor.parentNode.insertBefore(block, anchor.nextSibling);
  // Tag the original element so "Chinese-only" view can hide it via CSS — but
  // ONLY when our block is a true sibling of a self-contained original
  // (Reddit / universal / single-line tweets & bios). Never tag a <br>, nor any
  // container that already holds our blocks (e.g. a multi-line tweet's text box,
  // whose interleaved originals are text nodes that CSS can't hide anyway).
  if (anchor.nodeType === 1) {
    const elAnchor = anchor as HTMLElement;
    // Reddit's <shreddit-post> projects light-DOM children into shadow <slot>s.
    // An unslotted block lands in the DEFAULT slot — rendered at the BOTTOM of
    // the post — which is why the title's translation showed up at the end.
    // Mirror the source's slot so the translation renders right where the
    // original is (e.g. directly under the title).
    const slot = elAnchor.getAttribute('slot');
    if (slot) block.setAttribute('slot', slot);
    if (elAnchor.tagName !== 'BR' && !elAnchor.querySelector('.ibt-block')) {
      elAnchor.classList.add('ibt-orig-src');
    }
  }

  const run = async () => {
    block.className = 'ibt-block ibt-loading';
    block.textContent = '';
    block.appendChild(el('span', 'ibt-loading-dot', '翻譯中…'));
    try {
      const pairs = await translateBlock(text);
      fillPairs(block, pairs);
    } catch (err: any) {
      // Extension was reloaded/updated → quiet "refresh" hint, no retry spam.
      if (isContextGoneError(err)) { showReloadHint(block); return; }
      showError(block, String(err?.message ?? err), run);
    }
  };
  void run();
  return block;
}

/** Generic engine: one translation inserted after each collected element.
    Used for Reddit (real <p>/<li> paragraph nodes). */
export class Engine {
  private io?: IntersectionObserver;
  private readonly pending = new Set<HTMLElement>();

  constructor(private adapter: SiteAdapter, private settings: Settings) {}
  setSettings(s: Settings) { this.settings = s; }

  private siteEnabled(): boolean {
    const id = this.adapter.id as keyof Settings['sites'];
    return this.settings.enabled && (this.settings.sites[id] ?? true);
  }

  scan(): void {
    if (!this.siteEnabled()) return;
    for (const unit of this.adapter.collect()) {
      if (isProcessed(unit.source) || this.pending.has(unit.source)) continue;
      // Skip text already in the target language (e.g. a Chinese post when the
      // target is Chinese) — no 中文→中文 duplicate. Not marked processed, so it
      // re-evaluates if the target language is later changed.
      if (isAlreadyTargetLang(unit.text, this.settings.targetLangCode)) continue;
      if (this.settings.translateOnVisible) {
        this.pending.add(unit.source);
        (unit.source as any).__ibtText = unit.text;
        this.ensureIO().observe(unit.source);
      } else {
        markProcessed(unit.source);
        renderTranslationAfter(unit.source, unit.text);
      }
    }
  }

  private ensureIO(): IntersectionObserver {
    if (this.io) return this.io;
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const src = e.target as HTMLElement;
        this.io!.unobserve(src);
        this.pending.delete(src);
        if (isProcessed(src)) continue;
        markProcessed(src);
        renderTranslationAfter(src, (src as any).__ibtText || src.innerText || '');
      }
    }, { rootMargin: '300px' });
    return this.io;
  }
}
