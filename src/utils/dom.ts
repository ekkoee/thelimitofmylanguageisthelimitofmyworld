export const NS = 'ibt'; // injected-node class/attribute namespace

export const PROCESSED_ATTR = 'data-ibt-done';

export function isProcessed(el: Element): boolean {
  return el.getAttribute(PROCESSED_ATTR) === '1';
}
export function markProcessed(el: Element): void {
  el.setAttribute(PROCESSED_ATTR, '1');
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// --- 3-state display view (Alt+A cycles; popup mirrors). Pure CSS, no re-translate.
//  both → original + Chinese   |   orig → original only   |   zh → Chinese only
export type ViewMode = 'both' | 'zh' | 'orig';
const VIEW_ATTR = 'data-ibt-view';
const VIEW_NEXT: Record<ViewMode, ViewMode> = { both: 'orig', orig: 'zh', zh: 'both' };
export const VIEW_LABEL: Record<ViewMode, string> = {
  both: '原文 + 中文', orig: '只顯示原文', zh: '只顯示中文',
};

export function getView(): ViewMode {
  const v = document.documentElement.getAttribute(VIEW_ATTR);
  return v === 'zh' || v === 'orig' ? v : 'both';
}
export function setView(v: ViewMode): void {
  document.documentElement.setAttribute(VIEW_ATTR, v);
}
/** Advance to the next view in the cycle and return it. */
export function cycleView(): ViewMode {
  const next = VIEW_NEXT[getView()];
  setView(next);
  return next;
}

let rootApplied = false;
/** Mirror visual settings onto <html> so CSS handles all toggles without re-translation. */
export function applyRootState(s: {
  enabled: boolean; showOriginal: boolean; layout: string; fontScale: number;
  targetLangCode?: string; transStyle?: string; transColor?: string;
}): void {
  const r = document.documentElement;
  // Default display is bilingual; never clobber a view the user has cycled to.
  if (!r.hasAttribute(VIEW_ATTR)) r.setAttribute(VIEW_ATTR, 'both');
  r.setAttribute('data-ibt-enabled', String(s.enabled));
  r.setAttribute('data-ibt-show-original', String(s.showOriginal));
  r.setAttribute('data-ibt-layout', s.layout);
  r.style.setProperty('--ibt-font-scale', String(s.fontScale));
  // Simplified vs Traditional → pick a complete CJK font so glyphs don't mix
  r.setAttribute('data-ibt-lang', s.targetLangCode === 'zh-CN' ? 'zh-CN' : 'zh-TW');
  // translated-text visual style
  r.setAttribute('data-ibt-style', s.transStyle || 'plain');
  // custom translated-text color (unset → CSS fallback to default)
  if (s.transColor) r.style.setProperty('--ibt-trans-color', s.transColor);
  else r.style.removeProperty('--ibt-trans-color');
  rootApplied = true;
}
export function rootStateApplied(): boolean { return rootApplied; }
