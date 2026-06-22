// ⚠️ All site-specific selectors live here so they can be patched in one place
// when X / Reddit / YouTube change their DOM. Each entry lists fallbacks tried
// in order.

export const SELECTORS = {
  x: {
    // tweet body, replies, quoted tweets all share this testid
    text: ['[data-testid="tweetText"]'],
    bio: ['[data-testid="UserDescription"]'],
    // X Articles (long-form). ReadView wraps title + body; RichTextView/the
    // Draft.js content are the body. Order: broadest (incl. title) first.
    article: [
      '[data-testid="twitterArticleReadView"]',
      '[data-testid="twitterArticleRichTextView"]',
      '[data-testid="longformRichTextComponent"]',
    ],
    // primary content column — used to also pick up the article title (an <h1>)
    primaryColumn: ['[data-testid="primaryColumn"]'],
  },
  reddit: {
    title: ['[slot="title"]', 'a[slot="full-post-link"]', 'h1[slot="title"]'],
    body: ['[slot="text-body"] .md', '[slot="text-body"]', '[slot="post-rtjson-content"]'],
    comment: ['[id$="-comment-rtjson-content"]', 'shreddit-comment [slot="comment"] .md'],
  },
  youtube: {
    // live caption window rendered by the player
    captionWindow: ['.ytp-caption-window-container', '#ytp-caption-window-container'],
    captionWindowInner: ['.caption-window'],  // the positioned box that holds the text
    captionSegment: ['.ytp-caption-segment'],
    player: ['#movie_player', '.html5-video-player'],
  },
} as const;

export function queryFirst(selectors: readonly string[], root: ParentNode = document): Element[] {
  for (const sel of selectors) {
    const found = root.querySelectorAll(sel);
    if (found.length) return Array.from(found);
  }
  return [];
}
