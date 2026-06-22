import { hasTranslatableText } from '../core/segmentation';

// Generic, layout-aware block detection for the "translate any page" engine.
//
// The old universal scanner matched a FIXED tag whitelist (p,li,h1..h6,blockquote,…)
// and excluded div/span. That misses prose on modern SPA sites — Facebook and
// Mastodon/Truth Social render post bodies inside <div dir="auto"> / <span>, so the
// whitelist found nothing (or translated stray UI chrome instead).
//
// Instead we classify EVERY element by its computed `display` (block vs inline, the
// same signal the browser uses) and pick the LOWEST block element that directly
// holds text — the "leaf block". That is one translation unit. This is the approach
// Mozilla Readability / kiss-translator use, and it works without a per-site rule on
// most sites. A relevance gate then drops UI chrome (author names, Follow/Like
// buttons, nav, timestamps) so we translate the post body, not the furniture.
//
// KNOWN GAP: a "mixed" container — a block that holds BOTH a child block with text
// AND its own loose inline/text run — translates the child block but skips the loose
// run (it has no element anchor our dedup can key on). That needs text-node "run"
// anchors (a later phase). The old tag-whitelist engine missed such structures
// entirely, so this is a residual gap, not a regression.

export interface Unit {
  /** Source block whose translation we insert right after. */
  element: HTMLElement;
  /** Its visible text. */
  text: string;
}

// Canonical inline (phrasing) tags. We treat an element as inline ONLY when its
// computed display is inline AND it is phrasing — so a <span>/<a> that CSS has turned
// into display:block is correctly treated as a block boundary, not folded into a run.
const PHRASING = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'I',
  'IMG', 'KBD', 'LABEL', 'MARK', 'Q', 'RUBY', 'RT', 'RP', 'S', 'SAMP', 'SMALL',
  'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR', 'FONT', 'OUTPUT',
]);

// Subtrees we never read or translate (code, controls, media, editors, our output).
const HARD_SKIP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'SELECT', 'OPTION', 'SVG', 'CANVAS',
  'IFRAME', 'INPUT', 'CODE', 'PRE', 'KBD', 'SAMP', 'VIDEO', 'AUDIO', 'OBJECT',
  'EMBED', 'MATH', 'BUTTON',
]);

// Areas/roles that are interactive UI chrome, not readable prose.
const SKIP_CHROME = [
  'nav', 'time', 'label',
  '[role="button"]', '[role="menuitem"]', '[role="tab"]', '[role="switch"]',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[translate="no"]', '.notranslate', '[data-testid="User-Name"]',
].join(',');

type DisplayKind = 'block' | 'inline' | 'none' | 'contents';

/**
 * Find the lowest block-level elements that directly hold readable text — the
 * translation "units" — at/under `root` (the root itself IS considered, so a single
 * leaf element can be passed when only its subtree changed). Computed-display based,
 * so it works on sites that render prose inside <div dir="auto"> / <span>.
 */
export function collectUnits(root: HTMLElement): Unit[] {
  const units: Unit[] = [];
  // Per-scan caches: getComputedStyle and innerText are the expensive calls; cache
  // them so a subtree is styled/read once. Scoped to this scan (Maps GC'd on return)
  // so a node that toggles display/text between scans isn't stuck stale.
  const scache = new Map<Element, { kind: DisplayKind; visible: boolean }>();
  const itext = new Map<Element, string>();

  const styleOf = (el: Element): { kind: DisplayKind; visible: boolean } => {
    const hit = scache.get(el);
    if (hit) return hit;
    const cs = getComputedStyle(el);
    const d = cs.display;
    let kind: DisplayKind;
    if (d === 'none') kind = 'none';
    else if (d === 'contents') kind = 'contents';
    else if (d.startsWith('inline')) kind = PHRASING.has(el.tagName) ? 'inline' : 'block';
    else kind = 'block';
    const s = { kind, visible: cs.visibility !== 'hidden' && cs.visibility !== 'collapse' };
    scache.set(el, s);
    return s;
  };
  const display = (el: Element): DisplayKind => styleOf(el).kind;

  // An element actually paints a box of meaningful size. Filters display:none-detached
  // (no rects), zero-size measurement nodes, and visibility:hidden — the hidden a11y /
  // placeholder elements SPAs like Facebook scatter everywhere. Translating those would
  // stack a column of junk blocks even though the source itself is invisible.
  const rendered = (el: Element): boolean => {
    if (!styleOf(el).visible) return false;
    const rects = (el as HTMLElement).getClientRects();
    return rects.length > 0 && rects[0].width >= 1 && rects[0].height >= 1;
  };

  const textOf = (el: Element): string => {
    let t = itext.get(el);
    if (t === undefined) { t = ((el as HTMLElement).innerText || '').trim(); itext.set(el, t); }
    return t;
  };

  const skip = (el: Element): boolean => {
    if (!(el instanceof HTMLElement)) return true;          // SVG / MathML / foreign
    if (HARD_SKIP.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.classList.contains('ibt-block') || el.dataset.ibtOut === '1') return true; // our own output
    if (el.getAttribute('aria-hidden') === 'true') return true;
    return false;
  };

  // Does `el` contain a BLOCK descendant that holds visible text? If so, `el` is a
  // container and we descend; otherwise it is a leaf block (a unit boundary).
  // innerText already aggregates nested text, so for a block child we only need to
  // read it; transparent boxes (inline / display:contents) are recursed past.
  const hasChildBlockWithText = (el: Element): boolean => {
    for (const ch of Array.from(el.children)) {
      if (skip(ch)) continue;
      const dk = display(ch);
      if (dk === 'none') continue;
      if (dk === 'block') {
        if (textOf(ch)) return true;
      } else if (hasChildBlockWithText(ch)) {
        return true;
      }
    }
    return false;
  };

  // Evaluate `el` itself, then recurse as needed. Passing the root here (not just its
  // children) lets a single changed leaf be re-collected on an incremental rescan.
  const visit = (el: Element): void => {
    if (skip(el)) return;
    const dk = display(el);
    if (dk === 'none') return;
    if (dk === 'contents' || dk === 'inline') {
      for (const ch of Array.from(el.children)) visit(ch);
      return;
    }
    // el is a block
    if (hasChildBlockWithText(el)) {
      for (const ch of Array.from(el.children)) visit(ch);     // container → go deeper
    } else {
      const text = textOf(el);                                  // leaf block → one unit
      if (text && rendered(el) && passesGate(el as HTMLElement, text)) units.push({ element: el as HTMLElement, text });
    }
  };

  visit(root);
  return units;
}

// Fraction of an element's text that sits inside links.
function linkDensity(el: HTMLElement): number {
  const total = (el.innerText || '').trim().length || 1;
  let linked = 0;
  el.querySelectorAll('a').forEach((a) => { linked += ((a as HTMLElement).innerText || '').trim().length; });
  return linked / total;
}

// Keep real prose, drop UI chrome. CJK gets a shorter minimum length (a 2-character
// Chinese phrase is meaningful).
function passesGate(el: HTMLElement, text: string): boolean {
  const t = text.trim();
  if (!hasTranslatableText(t)) return false;                // needs a letter, len >= 2
  if (el.closest(SKIP_CHROME)) return false;                // buttons / nav / names
  const density = linkDensity(el);
  if (density > 0.9) return false;                          // near-fully-linked card / promo, any length
  if (t.length < 40 && density > 0.5) return false;         // short + mostly link → author/menu item
  const hasCJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(t);
  if (!hasCJK && t.length < 3) return false;                // stray single short token
  return true;
}
