import { SiteAdapter, TextUnit } from './engine';
import { SELECTORS, queryFirst } from './selectors';
import { isProcessed } from '../utils/dom';

// Reddit renders post bodies & comments as markdown with real <p>/<li> nodes.
// We translate at the PARAGRAPH level and insert each translation right after
// its paragraph → natural "English line / Chinese line" interleaving, no
// duplication of the original (the page already shows it).
//
// IMPORTANT: a bullet is <li><p>…</p></li>, so 'p, li' matches BOTH the <li>
// and the <p> inside it (same text). We must keep only the OUTERMOST block of
// any nested pair, or the bullet gets translated twice. queryselectorAll returns
// document order (ancestors first), so we skip any node contained by one we
// already took.
const LEAF = 'p, li';

export const redditAdapter: SiteAdapter = {
  id: 'reddit',
  collect(): TextUnit[] {
    const units: TextUnit[] = [];
    const seen = new Set<Element>();

    const addLeaf = (e: Element) => {
      const html = e as HTMLElement;
      // NEVER collect our own output. The title translation block is given
      // slot="title" (so it projects next to the title) which makes it match the
      // [slot="title"] selector — without this guard it would be re-translated
      // forever, stacking duplicate titles.
      if (html.classList.contains('ibt-block') || html.closest('.ibt-block')) return;
      if (seen.has(html) || isProcessed(html)) return;
      // de-dupe nesting: skip if an already-collected block contains this one
      // (handles <li><p>…</p></li> → keep the <li>, drop the inner <p>)
      if (units.some((u) => u.source.contains(html))) return;
      seen.add(html);
      const text = html.innerText?.trim() ?? '';
      if (text) units.push({ source: html, text });
    };

    for (const t of queryFirst(SELECTORS.reddit.title)) addLeaf(t);

    const containers = [...queryFirst(SELECTORS.reddit.body), ...queryFirst(SELECTORS.reddit.comment)];
    for (const c of containers) {
      const leaves = c.querySelectorAll(LEAF);
      if (leaves.length) leaves.forEach(addLeaf);
      else addLeaf(c); // no inner paragraphs → translate the container itself
    }
    return units;
  },
};
