# Readbot — 讀書機器人（Claude Code plugin）

把 Claude Code 裝上這包 plugin，就變身讀書機器人：**把書數位化（可選翻譯）、整理重點、產學習小卡**。
核心是 `digitize-book`：把書（PDF／照片）**逐頁轉圖 → 多模態讀 → 翻成繁中或原文照錄 → 產出 markdown 或 jupyter ＋ 每小節重點筆記 ＋ 截出插圖**，再用看板檢視。

## 專案內容

| 項目 | 說明 |
|---|---|
| `.claude-plugin/` | `plugin.json` + `marketplace.json`（repo 自己當 marketplace，`source: "./"`） |
| `skills/digitize-book` | **核心**：把 `book/<書>/src` 數位化／翻成 `output/` 的 md/ipynb ＋ 章節筆記 ＋ 插圖 |
| `skills/serve` | 開看板 → http://localhost:5050（看 `book/` 清單與各書 `output/`） |
| `skills/setup` | 裝環境：uv ＋ Node ＋ **CDP 瀏覽器**（ChatGPT 截圖／線上文件用） |
| `.mcp.json` | 內建 Playwright MCP（CDP 接管 9222 的 Chrome），隨安裝自動註冊 |
| `server.py`／`index.html`／`frontend/` | Flask + Vue 3（CDN）唯讀看板 ＋ 設計系統 `theme.css` |
| `templates/`、`docs/` | CDP 啟動腳本範本；plugin 教學／CDP 入門／設計系統 spec |

## 資料模型

```
book/<書>/
  src/                              原始 PDF，或分章照片 ch1/ ch2/…（看板不顯示）
  config.json                       每本書設定（task=翻譯/數位化、mode=md|ipynb、image_model）
  progress.md                       進度（口語記錄）
  output/zh_tw/md/ch3/ch3.md        本文（markdown；翻譯或數位化）
  output/zh_tw/md/ch3/images/       從頁面截出的插圖（本文引用）
  output/zh_tw/md/note/ch3/ch3.md   每小節一個重點的筆記
  output/zh_tw/ipynb/…              選 jupyter 時（科技書：LaTeX ＋ 可跑 code）
```
語言層（`zh_tw`）日後可加 `en/`、`ja/`；格式（md/ipynb）做書時選、可並存。

## 用法

1. 把書放進 `book/<書名>/src/`（一個 PDF，或照片 `src/ch1/*.png`）。
2. 對話裡 `/readbot:digitize-book` —— 說要做第幾章、選任務（翻譯／數位化）、md／ipynb。
3. `/readbot:serve` —— 開看板，選書看 `output/`（本文／筆記、md／ipynb 切換）。

## 為什麼要 CDP

讀書機器人會用 CDP 接管一台**使用者已登入**的 Chrome 來操作線上內容（例如 ChatGPT 截圖、要讀的線上文件）——用使用者的登入、不另外打 API。透過內建 Playwright MCP 連這台 Chrome。不懂 CDP？看 **[docs/cdp-基本觀念.md](docs/cdp-基本觀念.md)**。

## 開發者：直接在 repo 跑

需求：[**uv**](https://docs.astral.sh/uv/)。

```bash
uv sync                        # 建 .venv + 裝相依（Flask、PyMuPDF、Pillow、NumPy）
uv run python server.py        # 看板 → http://localhost:5050（讀 ./book；--reload 開發自動重啟）
claude --plugin-dir ./         # 以 plugin 形式載入 skills（/readbot:<skill>）
```

## 安裝為 plugin

```text
/plugin marketplace add <帳號>/<repo>    # 加入 marketplace
/plugin install readbot@readbot         # 安裝
```

裝好後：`/readbot:setup`（首次備環境）→（放書進 `book/<書>/src/`）→ `/readbot:digitize-book` → `/readbot:serve`。
製作機制與踩坑見 **[docs/plugin-tutorial.md](docs/plugin-tutorial.md)**。
