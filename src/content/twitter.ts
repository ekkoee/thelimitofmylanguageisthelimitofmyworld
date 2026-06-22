import { renderTranslationAfter } from './engine';
import { SELECTORS, queryFirst } from './selectors';
import { isProcessed, markProcessed } from '../utils/dom';
import { Settings } from '../core/types';

// X / Twitter. A tweet's text lives in one [data-testid="tweetText"], but the
// line breaks inside it can be <br> elements (often nested) OR '\n' inside text
// nodes. We walk the WHOLE subtree, split at every break, and insert each
// line's translation right after it → true "English line / Chinese line"
// interleaving (the core feature). The original stays intact.
//
// "Only-Chinese" view can't CSS-hide the interleaved original (text nodes aren't
// selectable), so it's handled with a scoped zh-view rule in bilingual.css that
// collapses the tweet's own text while keeping our .ibt-block lines visible.
//
// Articles (X long-form): title + rich-text body live OUTSIDE tweetText, so they
// get a separate prose pass scoped to the article reader / primary column.

const SPLIT = 'data-ibt-split';
// X Articles render paragraphs as <div> (not <p>), so we include div and rely on
// innermost-leaf + skip filtering. Skips cover UI chrome, links, the engagement
// bar, timestamps, comments (tweetText) and our own output.
const ARTICLE_LEAF = 'h1,h2,h3,h4,p,li,blockquote,div';
// NOTE: skip only TRULY editable areas. X Articles render in a read-only Draft.js
// editor with contenteditable="false" — a bare [contenteditable] selector would
// (wrongly) match that and skip the whole article body.
const ARTICLE_SKIP = 'script,style,noscript,nav,aside,header,button,textarea,a,time,[role="group"],[contenteditable="true"],[data-testid="tweetText"],.ibt-block';

interface Line { anchor: Node; text: string }

function isIbt(n: Node): boolean {
  return n.nodeType === 1 && (((n as Element).className as any)?.toString?.() || '').startsWith('ibt-');
}

function splitLines(tt: HTMLElement): Line[] {
  const out: Line[] = [];
  let buf = '';
  const flush = (anchor: Node | null) => {
    const t = buf.replace(/\s+/g, ' ').trim();
    if (t && anchor) out.push({ anchor, text: t });
    buf = '';
  };

  // Snapshot text nodes + <br> in document order (we'll split text nodes after).
  const items: Node[] = [];
  const tw = document.createTreeWalker(tt, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      if (n.nodeType === 1) {
        if (isIbt(n)) return NodeFilter.FILTER_REJECT;            // skip our own nodes
        return n.nodeName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;                            // text node
    },
  });
  let c: Node | null;
  while ((c = tw.nextNode())) items.push(c);

  for (const node of items) {
    if (node.nodeName === 'BR') { flush(node); continue; }
    let tn = node as Text;
    let val = tn.nodeValue || '';
    let nl = val.indexOf('\n');
    while (nl !== -1) {
      buf += val.slice(0, nl);
      const rest = tn.splitText(nl + 1);   // tn now ends with the '\n'
      flush(tn);
      tn = rest; val = rest.nodeValue || ''; nl = val.indexOf('\n');
    }
    buf += val;
  }
  flush(tt); // trailing line → insert after the whole tweet text
  return out;
}

export function scanTwitter(s: Settings): void {
  if (!s.enabled || !s.sites.x) return;

  // 1) Tweets / replies / quotes — interleave a translation after each line.
  for (const node of queryFirst(SELECTORS.x.text)) {
    const tt = node as HTMLElement;
    if (tt.getAttribute(SPLIT) === '1') continue;
    tt.setAttribute(SPLIT, '1');
    try {
      const lines = splitLines(tt);
      if (lines.length <= 1) {
        const text = tt.innerText?.trim() ?? '';
        if (text) renderTranslationAfter(tt, text);
      } else {
        for (const ln of lines) renderTranslationAfter(ln.anchor, ln.text);
      }
    } catch {
      // never let a DOM quirk break the page; leave this tweet untranslated
    }
  }

  // 2) X Articles (long-form) — title + body live OUTSIDE tweetText.
  const scope = findArticleScope();
  if (scope) {
    const leaves = collectArticleLeaves(scope);
    // Only act on a REAL article: needs a couple of substantial prose blocks.
    // Guards against translating UI on ordinary pages (X has nav <h1>s too).
    const substantial = leaves.filter((e) => (e.innerText || '').trim().length >= 40);
    if (substantial.length >= 2) {
      for (const leaf of leaves) {
        markProcessed(leaf);
        const text = leaf.innerText?.trim() ?? '';
        if (text) renderTranslationAfter(leaf, text);
      }
    }
  }

  // 3) Profile bios.
  for (const node of queryFirst(SELECTORS.x.bio)) {
    const b = node as HTMLElement;
    if (isProcessed(b)) continue;
    markProcessed(b);
    const text = b.innerText?.trim() ?? '';
    if (text) renderTranslationAfter(b, text);
  }
}

// Find the X Article content region, if this page is one. We don't rely on a
// specific (and unstable) testid: an Article shows a big <h1> title that normal
// tweets never have, so we locate that title and scope to the <article> it sits
// in. Explicit reader testids are tried first as a fast path.
function findArticleScope(): HTMLElement | null {
  const reader = queryFirst(SELECTORS.x.article)[0] as HTMLElement | undefined;
  if (reader) return reader;
  const col = (queryFirst(SELECTORS.x.primaryColumn)[0] as HTMLElement) || document.body;
  // A real article title is long; X's nav/page <h1>s ("Post", "Home") are short.
  const h1 = Array.from(col.querySelectorAll<HTMLElement>('h1')).find(
    (h) => !h.closest('[data-testid="tweetText"]') && !h.closest('.ibt-block') && (h.innerText || '').trim().length >= 12,
  );
  // Require the title to live inside an <article> (the post container). If not,
  // skip rather than risk scanning page chrome.
  return h1 ? (h1.closest('article') as HTMLElement | null) : null;
}

// Innermost prose blocks within an article region (title + paragraphs + bullets),
// skipping tweets and UI chrome. De-dupes nesting like the universal scanner.
function collectArticleLeaves(root: HTMLElement): HTMLElement[] {
  const matches = Array.from(root.querySelectorAll<HTMLElement>(ARTICLE_LEAF));
  // STRUCTURAL leaves: contain no other matched element. Computed against ALL
  // matches (including already-processed paragraphs and our own inserted divs),
  // so once a paragraph is processed we don't "climb" to its now-childless
  // ancestor and re-translate it — that was an infinite tree-walking loop.
  const leaves = matches.filter((c) => !matches.some((o) => o !== c && c.contains(o)));
  return leaves.filter((e) => {
    if (isProcessed(e) || e.closest(ARTICLE_SKIP)) return false;
    const t = e.innerText?.trim() ?? '';
    return !!t && t.length >= 2;
  });
}
