import { detectSite } from '../utils/site';
import { loadSettings, onSettingsChanged } from '../core/storage';
import { applyRootState, cycleView, VIEW_LABEL } from '../utils/dom';
import { observeMutations, onUrlChange } from '../utils/observer';
import { Engine } from './engine';
import { scanTwitter } from './twitter';
import { redditAdapter } from './reddit';
import { startYouTube, updateYouTubeSettings } from './youtube';
import { Settings } from '../core/types';

// This script auto-runs ONLY on X / Reddit / YouTube (declared in the manifest).
// The "translate any page" feature is injected on demand via the Alt+A command
// (see background.js + universal-inject.js) so the extension needs no broad host
// access.
(async function main() {
  const site = detectSite();
  if (!site) return;

  let settings = await loadSettings();
  applyRoot(settings);

  // Alt+A (or the popup button) on these auto-sites cycles the 3-state display:
  // 原文 + 中文 → 只顯示原文 → 只顯示中文 → … (pure CSS, no re-translation).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'ibt-toggle-visibility') {
      flash(VIEW_LABEL[cycleView()]);
    }
  });

  if (site === 'youtube') {
    let live = settings;
    startYouTube(() => live);
    onSettingsChanged((s) => { live = s; applyRoot(s); updateYouTubeSettings(s); });
    return;
  }

  if (site === 'x') {
    const scan = () => scanTwitter(settings);
    scan();
    observeMutations(document.body, scan, 300);
    onUrlChange(() => setTimeout(scan, 400));
    onSettingsChanged((s) => { settings = s; applyRoot(s); scan(); });
    return;
  }

  // reddit
  const engine = new Engine(redditAdapter, settings);
  const scan = () => engine.scan();
  scan();
  observeMutations(document.body, scan, 300);
  onUrlChange(() => setTimeout(scan, 400));
  onSettingsChanged((s) => { settings = s; applyRoot(s); engine.setSettings(s); scan(); });
})();

function applyRoot(s: Settings) {
  applyRootState({
    enabled: s.enabled, showOriginal: s.showOriginal, layout: s.layout, fontScale: s.fontScale,
    targetLangCode: s.targetLangCode, transStyle: s.transStyle, transColor: s.transColor,
  });
}

// brief toast for hotkey feedback on auto-sites
let fEl: HTMLDivElement | null = null;
let fTimer: number | undefined;
function flash(msg: string): void {
  if (!fEl) { fEl = document.createElement('div'); fEl.className = 'ibt-toast'; }
  fEl.textContent = msg;
  if (!fEl.isConnected) document.documentElement.appendChild(fEl);
  fEl.classList.add('ibt-toast-show');
  if (fTimer) clearTimeout(fTimer);
  fTimer = setTimeout(() => fEl?.classList.remove('ibt-toast-show'), 1800) as unknown as number;
}
