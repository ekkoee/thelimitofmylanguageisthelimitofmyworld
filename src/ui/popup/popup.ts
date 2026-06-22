import { loadSettings, saveSettings } from '../../core/storage';
import { Settings, SiteId } from '../../core/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function init() {
  const s = await loadSettings();

  const enabled = $<HTMLInputElement>('enabled');
  enabled.checked = s.enabled;
  enabled.addEventListener('change', () => saveSettings({ enabled: enabled.checked }));

  document.querySelectorAll<HTMLInputElement>('input[data-site]').forEach((cb) => {
    const site = cb.dataset.site as SiteId;
    cb.checked = s.sites[site];
    cb.addEventListener('change', async () => {
      const cur = await loadSettings();
      await saveSettings({ sites: { ...cur.sites, [site]: cb.checked } });
    });
  });

  // 譯文呈現 — mirrors the page's CURRENT 3-state view and sets it on change.
  // Read/write <html data-ibt-view> on the active tab so the popup always shows
  // the real state (and stays in sync after Alt+A cycling).
  const viewMode = $<HTMLSelectElement>('viewMode');
  const activeTabId = async (): Promise<number | undefined> => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  };
  const tabId = await activeTabId();
  if (tabId != null) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.documentElement.getAttribute('data-ibt-view') || 'both',
      });
      if (res?.result) viewMode.value = String(res.result);
    } catch { /* page not scriptable (chrome://, store) — keep default */ }
  }
  viewMode.addEventListener('change', async () => {
    const id = await activeTabId();
    if (id == null) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: id },
        func: (v: string) => document.documentElement.setAttribute('data-ibt-view', v),
        args: [viewMode.value],
      });
    } catch { /* not scriptable */ }
  });

  // language: keep the free-engine code and the LLM-prompt name in sync
  const lang = $<HTMLSelectElement>('lang');
  lang.value = s.targetLangCode === 'zh-CN' ? 'zh-CN' : 'zh-TW';
  lang.addEventListener('change', () => {
    const code = lang.value;
    const name = code === 'zh-CN' ? 'Simplified Chinese (zh-CN)' : 'Traditional Chinese (zh-TW)';
    saveSettings({ targetLangCode: code, targetLang: name });
  });

  bindSelect('order', s.subtitleOrder, (v) => ({
    subtitleOrder: v as Settings['subtitleOrder'],
    // keep the Twitter/Reddit side-by-side order in sync with the same choice
    layout: (v === 'enTop' ? 'origTop' : 'transTop') as Settings['layout'],
  }));
  bindSelect('provider', s.provider, (v) => ({ provider: v as Settings['provider'] }));

  const model = $<HTMLInputElement>('model');
  model.value = s.model;
  model.addEventListener('change', () => saveSettings({ model: model.value.trim() }));

  const font = $<HTMLInputElement>('fontScale');
  const fontVal = $('fontScaleVal');
  font.value = String(s.fontScale);
  fontVal.textContent = `${s.fontScale.toFixed(2)}×`;
  font.addEventListener('input', () => { fontVal.textContent = `${Number(font.value).toFixed(2)}×`; });
  font.addEventListener('change', () => saveSettings({ fontScale: Number(font.value) }));

  $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // "翻譯這個網頁" — works even if the Alt+A shortcut isn't bound.
  const AUTO_SITE = /^https?:\/\/([^/]*\.)?(x\.com|twitter\.com|reddit\.com|youtube\.com)\//i;
  const tBtn = $<HTMLButtonElement>('translatePage');
  const hint = $('ctaHint');
  tBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (tab.url && AUTO_SITE.test(tab.url)) {
      // these sites auto-translate → toggle show/hide
      chrome.tabs.sendMessage(tab.id, { type: 'ibt-toggle-visibility' }).catch(() => {});
      window.close();
      return;
    }
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['bilingual.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['universal-inject.js'] });
      window.close();
    } catch {
      hint.textContent = '這個頁面無法翻譯（例如 chrome:// 或商店頁）';
      (hint as HTMLElement).style.color = '#e06c6c';
    }
  });
}

function bindSelect(id: string, value: string, patch: (v: string) => Partial<Settings>) {
  const sel = $<HTMLSelectElement>(id);
  sel.value = value;
  sel.addEventListener('change', () => saveSettings(patch(sel.value)));
}

init();
