---
name: serve
description: 啟動 Readbot 的看板 WebUI（Flask，http://localhost:5050），檢視目前專案 book/ 底下的書與各書的產物（output/ 的 md/ipynb 本文與章節筆記）。觸發詞（含口語）：「開看板 / 開啟 WebUI / 打開介面 / 開網頁 / 把 server 跑起來 / 啟動服務 / 開 UI / 開 dashboard / 看做好的書 / 打開 localhost:5050 / 開 5050」等。會用 skill 自己的位置定位 plugin 內的 server.py，並讀取使用者目前專案的 book/。
---

# serve

啟動 Readbot 看板（檢視產物）。看板掃**目前專案 `./book`** 底下的書當清單，選一本後顯示它 `output/` 的產物（md/ipynb 本文＋每章筆記）。
plugin 內含 Flask 後端與 Vue 前端；**看板不寫 output 產物、不打外部 API、只綁 127.0.0.1**（建書／改設定／刪書是管理寫入）。數位化／翻譯由 `/readbot:digitize-book` 做、寫進 `book/<書>/output/`，產完**重刷頁面**即見。

## 步驟

### 1. 取得 plugin 根目錄
本 skill 被呼叫時系統會給「**Base directory for this skill**」（= `<plugin>/skills/serve`）。
**plugin 根 = 該 base 的上兩層**（`<base>/../..`），解析成絕對路徑 `<PLUGIN_DIR>`（裡面有 `server.py`、`frontend/`、`index.html`），後續指令都用它。不靠 cwd、不靠 `$CLAUDE_PLUGIN_ROOT`。

### 2. 確保相依（冪等）
```bash
uv sync --project "<PLUGIN_DIR>"
```
若 `uv` 不存在 → 請使用者先跑 `/readbot:setup`。

### 3. 啟動（背景執行），書庫指向使用者專案
伺服器會持續執行（長時間阻塞），請在**背景**跑，再告訴使用者已在 http://localhost:5050 啟動：
```bash
uv run --project "<PLUGIN_DIR>" python "<PLUGIN_DIR>/server.py" --book-dir "$(pwd)/book"
```
（`<PLUGIN_DIR>` 換成步驟 1 的實際絕對路徑。前端從 plugin 服務，書庫讀使用者專案 `./book`。）

## 注意

- 看板沒書 = `book/` 還沒有書 → 用看板「＋ 新增書」（或建 `book/<書>/src/`）放入 PDF／照片，再用 `/readbot:digitize-book` 數位化／翻譯。
- 書顯示「待產出」= 還沒有 `output/` → 跑 digitize-book 產出後**重刷頁面**即見。
- 預設 port **5050**（避開 macOS AirPlay 佔用的 5000）；只綁 `127.0.0.1`、`debug=False`。port 被占就改 `--port` 並告知使用者實際網址。
