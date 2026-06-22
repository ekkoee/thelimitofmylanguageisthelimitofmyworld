import { AlignedPair, Settings, TranslateResponse } from '../core/types';
import { hasTranslatableText } from '../core/segmentation';
import { el, isProcessed, markProcessed } from '../utils/dom';

export interface TextUnit { source: HTMLElement; text: string; }
export interface SiteAdapter { id: string; collect(): TextUnit[]; }

function translateBlock(text: string): Promise<AlignedPair[]> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'translate', text }, (resp: TranslateResponse) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!resp?.ok) return reject(new Error(resp?.error || 'translate failed'));
      resolve(resp.pairs || []);
    });
  });
}

function fillPairs(block: HTMLElement, pairs: AlignedPair[]): void {
  block.className = 'ibt-block';
  block.textContent = '';
  for (const p of pairs) {
    const pair = el('div', 'ibt-pair');
    pair.appendChild(el('div', 'ibt-orig', p.o));
    pair.appendChild(el('div', 'ibt-trans', p.t));
    block.appendChild(pair);
  }
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

/** Insert a translation block right AFTER `anchor` (element or text node). */
export function renderTranslationAfter(anchor: Node, text: string): HTMLElement | null {
  if (!hasTranslatableText(text)) return null;
  const block = el('div', 'ibt-block ibt-loading');
  block.appendChild(el('span', 'ibt-loading-dot', '翻譯中…'));
  if (anchor.parentNode) anchor.parentNode.insertBefore(block, anchor.nextSibling);
  // Tag the original element so "Chinese-only" view can hide it via CSS — but
  // ONLY when our block is a true sibling of a self-contained original
  // (Reddit / universal / single-line tweets & bios). Never tag a <br>, nor any
  // container that already holds our blocks (e.g. a multi-line tweet's text box,
  // whose interleaved originals are text nodes that CSS can't hide anyway).
  if (anchor.nodeType === 1) {
    const elAnchor = anchor as HTMLElement;
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
