# 雙語對照翻譯 · Bilingual Reader

> A free, open-source Chrome extension (Manifest V3) for **line-by-line bilingual reading** — original on one line, translation on the next — on X/Twitter, Reddit, YouTube, and any web page. No API key required.

把外文內容變成「**原文一行、中文一行**」的對照閱讀,幫你更快讀懂、順便學語言。
**完全免費、預設免 API 金鑰、裝上就能用**:內建**兩個免費引擎**(Google,偶爾被限流時自動切換 Microsoft),並**自動偵測任何來源語言**(英文、日文、韓文…皆可)翻成中文。想要更高品質可在設定頁改用 Gemini / OpenAI / 本地 Ollama。

---

## ✨ 功能特色

- **多語言來源**:自動偵測英文、日文、韓文…等任何來源語言並翻成中文。
- **兩個免費引擎**:預設 Google 免費端點,偶爾被限流時自動切換到 Microsoft 免費端點,翻譯不中斷(皆免金鑰)。
- **X / Twitter、Reddit**:開啟後自動以雙語顯示,逐行對照。
- **YouTube**:電影模式雙語字幕——攔截原字幕、合併成自然句子、跟著聲音一句一句出現,中文在上、英文在下(可調整)。
- **任何網頁**:點工具列圖示 →「翻譯這個網頁」,或按 `Alt+A`,一鍵整頁雙語;再操作一次即關閉。通用版面偵測,連 Facebook 等以 div/span 排版的現代網站也能抓到內文。
- **雙擊單字浮窗**(選用,預設關閉):任何網頁雙擊單字或反白詞句,就地浮出原文＋🔊 朗讀、翻譯,單字附**字典卡**;開啟時才請求「所有網站」權限,關閉即一併撤除。
- **顯示 / 隱藏切換**:在 X / Reddit / YouTube 按 `Alt+A`(或按鈕)可隨時隱藏譯文、切回原文。
- **繁體 / 簡體中文**一鍵切換。
- **多種譯文樣式**:底線、虛線、波浪線、框線、醒目提示、斜體、粗體,以及「**學習模式**」(中文先模糊,滑過才顯示,逼自己先讀原文)。
- **可自訂**譯文顏色與字體大小,設定頁有即時預覽。
- **頁面上下文感知**:翻譯時參考頁面標題,專有名詞與產品名翻譯更準確。
- **Twitter / X 段落分組翻譯**:推文改以段落為單位翻譯,跨行語意更連貫。
- **Reddit 長貼文對照穩定度改善**:長串貼文的雙語對照更穩定。

---

## 🚀 安裝

> 目前還在等 Chrome 線上應用程式商店審核,先用下面方式手動安裝。**全程免費、不用註冊、不用填任何 key。**

### A. 一般使用者(推薦,3 分鐘)
1. 到本專案的 [Releases](../../releases) 下載最新版 zip。
2. 解壓縮,會得到一個資料夾(裡面有 `manifest.json`)。**不要刪掉或搬走它。**
3. 開啟 `chrome://extensions`,打開右上角「**開發人員模式 / Developer mode**」。
4. 點「**載入未封裝項目 / Load unpacked**」→ 選**剛剛解壓出來的那個資料夾**。

打開 x.com / reddit.com / youtube.com 就會自動雙語。其他網頁按 `Alt+A` 或點工具列圖示 →「翻譯這個網頁」。

> 💡 Chrome 每次開機可能跳「要停用開發人員模式擴充功能嗎?」,按「**保留 / Keep**」即可(手動安裝的正常現象)。

### B. 從原始碼建置(開發者)
```bash
npm install
npm run build      # 產生 dist/
```
然後依上面步驟 3–4 載入 **`dist/`** 資料夾。

---

## 🕹️ 使用方式

| 情境 | 操作 |
|---|---|
| X / Reddit / YouTube | 自動翻譯。按 `Alt+A` 或工具列按鈕可隱藏／顯示譯文。 |
| 其他任何網頁 | 點工具列圖示 →「翻譯這個網頁」,或按 `Alt+A`;再按一次關閉。 |
| 切換繁／簡、樣式、顏色、引擎 | 點工具列圖示開設定,進階選項按「完整設定 / API key →」。 |

> `Alt+A` 是 Chrome 快速鍵。載入未封裝擴充功能時 Chrome 有時不會自動綁定,可到 `chrome://extensions/shortcuts` 手動設定。

---

## 🔧 翻譯引擎

| 引擎 | 免費? | 需要 key? | 說明 |
|---|---|---|---|
| **Google(預設)** | ✅ 完全免費 | ❌ 不用 | 免費端點,回傳本身就逐句對齊。少數情況可能被限流。 |
| **Microsoft(免費後備)** | ✅ 完全免費 | ❌ 不用 | Edge 免金鑰端點。Google 被限流(403/429)時自動切換,也可手動選用。 |
| Gemini | 有免費額度 | 需免費 key | 到 aistudio.google.com 拿免費 key;預設 `gemini-2.5-flash-lite`。 |
| OpenAI | 付費 | 需 key | 品質高、要付費。 |
| Ollama | ✅ 免費 | ❌ 不用 | 本地模型,需自行安裝 Ollama 並下載模型。 |

---

## 🧩 權限(最小化)

| 權限 | 用途 |
|---|---|
| `storage` | 儲存設定、金鑰、翻譯快取於本機。 |
| `activeTab` + `scripting` | 按 `Alt+A`／按鈕時,**僅暫時**存取當前分頁以插入譯文。預設安裝不要求「所有網站」權限。 |
| 選用 `<all_urls>`(預設關閉) | 僅當你開啟「雙擊單字浮窗」時於點擊當下請求,用於在任意網頁顯示浮窗;關閉功能即撤除。 |
| 主機權限:`x.com` / `twitter.com` / `reddit.com` / `youtube.com` | 在這四個網站自動顯示雙語。 |
| 主機權限:`translate.googleapis.com`(Google 免費)、`edge.microsoft.com` ＋ `api-edge.cognitive.microsofttranslator.com`(Microsoft 免費後備) | 預設免費引擎,傳送選取文字取得譯文。 |
| 主機權限:`generativelanguage.googleapis.com`、`api.openai.com`、`localhost`／`127.0.0.1` | 選用引擎(Gemini／OpenAI 需自備金鑰;Ollama 為本機,資料不離開裝置)。 |

---

## 🔒 隱私

- 不追蹤、不投放廣告、不販售資料。
- 設定與 API 金鑰只存在你的瀏覽器本機(`chrome.storage`)。
- 只有在你觸發翻譯時,才會把該段文字送到**你所選擇**的翻譯服務以取得譯文。
- 所有外部 API 呼叫都在 background service worker,content script 不持有金鑰,也避開 CORS。

---

## 🏗️ 開發

### 指令
| 指令 | 作用 |
|---|---|
| `npm run build` | 產生 `dist/`(unpacked 載入用) |
| `npm run watch` | 監看原始碼自動重建 |
| `npm run typecheck` | 只跑 TypeScript 型別檢查 |
| `npm run smoke` | 實測免費端點是否可用 |
| `npm run zip` | 把 `dist/` 打包成 zip(上架／發佈用) |

技術:**TypeScript + esbuild**(零外掛相依,直建 `dist/`)。

### 架構
```
src/
├─ background/service-worker.ts   訊息入口:快取 → 佇列 → provider;Alt+A 命令注入整頁翻譯
├─ content/
│  ├─ index.ts                    站點偵測 + 啟動對應 adapter;Alt+A 顯示/隱藏切換
│  ├─ engine.ts                   收集節點、可見才翻、插入雙語區塊
│  ├─ twitter.ts / reddit.ts      各站 adapter(要翻哪些節點)
│  ├─ blocks.ts                   通用版面偵測(getComputedStyle 判區塊/行內 + 內容/雜訊過濾)
│  ├─ universal.ts                整頁翻譯器(通用偵測 + 可見才翻 + SPA 去重)
│  ├─ universal-inject.ts         由 background 在使用者按 Alt+A 時注入當前分頁
│  ├─ youtube.ts                  攔截字幕 → 合併句子 → 電影模式雙語字幕
│  ├─ yt-main.ts                  MAIN world 橋接,攔截 YouTube timedtext 回應
│  └─ selectors.ts                ⚠️ 所有站點 selector 集中於此,改版只改這裡
├─ core/
│  ├─ types.ts                    型別 + 預設設定
│  ├─ storage.ts                  chrome.storage 設定讀寫(含新鍵自動套用)
│  ├─ segmentation.ts             英文斷句(逐句對齊用)
│  ├─ cache.ts                    記憶體 + chrome.storage.local 雙層快取
│  └─ queue.ts                    併發上限佇列(控成本／速率)
├─ providers/                     翻譯引擎抽象:base 介面 + google / microsoft / openai / gemini / ollama
├─ ui/popup, ui/options           快速控制 + 完整設定(含樣式即時預覽)
├─ styles/bilingual.css           注入頁面的雙語樣式(深色友善、多種樣式)
└─ utils/                         site 偵測、DOM、MutationObserver / URL 變化
```

### 設計重點
- **逐句對齊**:content 端先斷句,整批送進 provider,要求回傳「同長度同順序」的 JSON,確保每句英文對得回每句中文,而非「整段 → 一坨」。
- **成本控制**:相同句子先查雙層快取;未命中才打 API,且經過併發上限佇列;預設只翻譯捲到可見範圍的內容。
- **顯示切換全靠 CSS**:顯示模式／上下順序／字體大小／顏色寫在 `<html>` 的 `data-ibt-*` 屬性與 CSS 變數,切換即時、不需重新翻譯。
- **YouTube 第一原則**:絕不弄丟字幕——只有在自己的字幕確認顯示後,才隱藏原生字幕。

---

## 📄 授權

[MIT](LICENSE) — 自由使用、修改、散布。
