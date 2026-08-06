# CLAUDE.md

## 這是什麼

**Readbot** —— 把 Claude Code 變成讀書機器人的 plugin：**把書數位化（可選翻譯）、整理重點、陪讀問答**。
核心是 `digitize-book` skill：把 `book/<書>/src` 的 PDF／照片**逐頁轉圖 → 多模態讀 → 翻成繁中或原文照錄 → 寫成 ipynb 產物 ＋ 每小節重點筆記 ＋ 截出插圖**。

組成：
- plugin manifest（`.claude-plugin/`，repo 自己當 marketplace）。
- 四個 skill：`digitize-book`（核心，數位化／翻譯）、`tutor`（陪讀：回答使用者的章節問題＋把學到的重點補進該章 note，只增補不改本文）、`serve`（開看板）、`setup`（裝 uv＋Node＋CDP 瀏覽器）。
- **唯讀看板**：Flask（`server.py`）+ Vue 3 CDN（`index.html`／`frontend/`），掃 `book/` 當清單、顯示 `output/`（本文／筆記兩檢視）。
- 內建 Playwright MCP（`.mcp.json`）——CDP 核心管道：digitize-book 用它接管 ChatGPT 做裁圖／生譯圖（見 `docs/cdp-基本觀念.md`）。

## 資料模型（book/，在專案根）

```
book/<書>/
  src/                                原始輸入（PDF 或分章照片 ch1/ ch2/…）；UI 不顯示
  config.json                         每本書設定（task ＋ 書卡 metadata：title/author/cover；mode／image_model 為保留欄位）
  progress.md                         進度（口語記錄，給 skill 讀/寫）
  output/cover.png                    封面圖（書卡 icon；skill 抽自書第 1 頁）
  output/<語言>/ipynb/ch<n>/ch<n>.ipynb    本文（翻譯或數位化；語言預設 zh_tw）
  output/<語言>/ipynb/ch<n>/images/        插圖（被本文引用）：figX-Y.png 原裁切、figX-Y.<語言>.png 譯圖（task=translate 時每張都生；語言碼同 output 資料夾；看板自動加「譯圖/原圖」對照、預設原圖）
  output/<語言>/ipynb/note/ch<n>/ch<n>.ipynb   每小節一個重點的章節筆記
```
- 過程檔（PDF 逐頁 PNG）→ `tmp/<書>/pages/`（gitignored）；產物只進 `book/<書>/output/`。
- **個人風格檔**（專案根、gitignored）：`note-style.md`（筆記口味／結構，`digitize-book`／`tutor` 寫筆記前讀）、`tutorial-style.md`（陪讀教法，`tutor` 陪讀前讀）；**缺檔時 skill 先問使用者、不寫死預設**（見各 skill）。

## 環境與指令（uv）

團隊統一用 **uv**（勿用 pip）。`uv.lock` 進版控。相依：**Flask**（看板）＋ **PyMuPDF／Pillow**（PDF→頁圖、封面與插圖處理）。

```bash
uv sync                     # 建 .venv + 裝相依
uv run python server.py     # 看板 → http://localhost:5050（讀 ./book）
```

`server.py` 的完整參數（`--book-dir`／`--port`／`--reload`、環境變數）與「cwd 不在 repo 根時」的跑法 → 見 **[README](README.md)** 的「開發者：直接在 repo 跑」。

改後端的驗法（沒有測試套件）：① `import server` 擋語法／import 錯；② 對著 `--reload` 的 server 打真端點做往返（用臨時 `--book-dir`、測完清掉、不碰真資料）。
Lint/format：`uv run ruff format .`、`uv run ruff check --fix .`（手動跑）。

## 操作慣例

- **shell 動作走 Bash 工具**；包內 python 一律 `uv run --project "<PLUGIN_DIR>"`（plugin venv 才有 pymupdf/pillow）。
- 指令別用 `cd xxx && uv run …` 開頭（不符 `Bash(uv run:*)` 會跳框）；Bash cwd 已是專案根，直接 `uv run …` + 相對路徑。
- 破壞性指令（`rm`、`taskkill`）刻意不預核准，每次先問過使用者再做。
- 🚨 **暫存檔別丟 project root**：PDF 逐頁圖等過程檔 → `tmp/`；瀏覽器流程暫存 → `.browser/tmp/`（都已 gitignore）。收工前清掉、確認 root 乾淨再向使用者回報。

## 重要 gotchas（勿誤改）

- `server.py` 開頭強制 stdout/stderr 為 UTF-8（避免 Windows cp950 `UnicodeEncodeError`），勿移除。
- 看板**不碰 output 內容**：產物（翻譯/數位化本文、筆記、插圖）一律由 skill 寫；server 只做管理寫入——建書骨架（POST）、改 config（PUT）、刪書（DELETE），**不寫任何 output 產物**。
- Jinja 停用（`template_folder=None`），`index.html` 以 `send_file` 原始檔服務；勿改成 template 渲染。
- `static_folder=ROOT, static_url_path=''` 把整個 plugin 目錄透過 HTTP 服務；靠「只綁 127.0.0.1 + 無 CORS」緩解（已知取捨）。
- 讀檔端點的路徑穿越守門集中在 `_resolve_under_output()`（逐段驗名＋realpath，全專案唯一比對點）、book_id 用 `_safe_name`；書庫用 `--book-dir`／`BOOK_DIR`，預設 `cwd/book`；前端靜態檔永遠從 plugin 目錄（`ROOT`）服務。
- 要跑包內程式（各 skill：digitize-book／tutor／serve／setup）→ 用 skill 的「Base directory」推 plugin 根（`<base>/../..`），**勿**靠 `$CLAUDE_PLUGIN_ROOT`／cwd（見 `docs/plugin-tutorial.md`）。

## 程式風格

- Python：4 空格、無 type hints。JS：2 空格、camelCase。註解中英混用可接受。換行一律 **LF**（`.gitattributes` 強制）。
- Git：在個人分支 `<name>_dev` 工作、開 PR 進 `main`（勿直接 push `main`）；commit 用 **gitmoji + 繁中描述**，結尾加 `Co-Authored-By` trailer。
