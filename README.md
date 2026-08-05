# Readbot — 讀書機器人（Claude Code plugin）

把 Claude Code 裝上這包 plugin，就變身讀書機器人：**把書數位化（可選翻譯）、整理重點、陪讀問答**。
核心是 `digitize-book`：把書（PDF／照片）**逐頁轉圖 → 多模態讀 → 翻成繁中或原文照錄 → 產出 jupyter（ipynb）＋ 每小節重點筆記 ＋ 截出插圖**；使用者再用看板檢視、用 `tutor` 陪讀。

## 專案內容

| 項目 | 說明 |
|---|---|
| `.claude-plugin/` | `plugin.json` + `marketplace.json`（repo 自己當 marketplace，`source: "./"`） |
| `skills/digitize-book` | **核心**：把 `book/<書>/src` 數位化／翻成 `output/` 的 ipynb ＋ 章節筆記 ＋ 插圖 |
| `skills/tutor` | 陪讀：回答使用者的章節問題、把學到的重點增補進該章筆記（只增補、不改本文） |
| `skills/serve` | 開看板 → http://localhost:5050（看 `book/` 清單與各書 `output/`） |
| `skills/setup` | 裝環境：uv ＋ Node ＋ **CDP 瀏覽器**（ChatGPT 截圖用） |
| `.mcp.json` | 內建 Playwright MCP（CDP 接管 9222 的 Chrome），隨安裝自動註冊 |
| `server.py`／`index.html`／`frontend/` | Flask + Vue 3（CDN）唯讀看板 ＋ 設計系統 `theme.css` |
| `templates/`、`docs/` | CDP 啟動腳本範本；plugin 教學／CDP 入門／設計系統 spec |

## 資料模型

```
book/<書>/
  src/                              原始 PDF，或分章照片 ch1/ ch2/…（看板不顯示）
  config.json                       每本書設定（task=翻譯/數位化 ＋ 書卡：title/author/cover；mode／image_model 為保留欄位）
  progress.md                       進度（口語記錄）
  output/cover.png                  封面圖（書卡 icon，抽自書第 1 頁）
  output/zh_tw/ipynb/ch3/ch3.ipynb       本文（翻譯或數位化）
  output/zh_tw/ipynb/ch3/images/         插圖：figX-Y.png 原裁切；翻譯時另有 figX-Y.zh_tw.png 譯圖（看板可切原圖／譯圖）
  output/zh_tw/ipynb/note/ch3/ch3.ipynb  每小節一個重點的筆記
```
語言層（`zh_tw`）日後可加 `en/`、`ja/`。產物格式目前一律 `ipynb`。

### `config.json` schema

每本書一份；缺檔／缺欄／非法值都安全——server 讀取時自動補預設、正規化（`_read_config`），手動編輯壞了也不會掛。**目前實際支援的值如下表**（`mode`／`image_model` 是保留欄位——`server.py` 的 `VALID_*` 為相容仍收舊值，但功能上只走下表）。

| 欄位 | 型別 | 目前支援值 | 預設 | 誰寫入 |
|---|---|---|---|---|
| `task` | str | `"translate"` \| `"transcribe"` | `"translate"` | 使用者（看板或 digitize-book 對話中選） |
| `title`／`author` | str | 自由字串 | `""` | digitize-book（抽自書的前幾頁） |
| `cover` | str \| null | 檔名（相對 `output/`） | `null` | digitize-book（通常 `"cover.png"`） |
| `mode` | str | 只 `"ipynb"` | `"ipynb"` | 保留欄位：UI 不開放、skill 一律 ipynb（留給未來擴充格式） |
| `image_model` | str | 只 `"chatgpt"` | `"chatgpt"` | 保留欄位：UI 不開放、skill 一律 ChatGPT（留給未來換生圖模型） |
| `schema_version` | int | `1` | `1` | server 自動補（保留給未來遷移） |

### 個人風格檔（專案根，可選）

放在**專案根**、因人而異、已 gitignore（不隨 plugin 散布）：

- `note-style.md` —— 你要的**筆記口味與結構**（`digitize-book`／`tutor` 寫筆記前先讀、照它寫）。
- `tutorial-style.md` —— 你要的**陪讀教法**（`tutor` 陪讀前先讀、照它教）。

**沒有時 skill 會先問你**「要怎麼整理重點／怎麼被陪讀」，再照你說的做（可順手幫你存成該檔，之後不必再問）。

## 用法

1. 把書放進 `book/<書名>/src/`（一個 PDF，或照片 `src/ch1/*.png`）。書資料夾建議用看板「＋ 新增書」建（會一併生成 `config.json`／`progress.md`）；手動建也行（`config.json` 缺檔視同預設）。
2. 對話裡 `/readbot:digitize-book` —— 跟 Claude 說要做第幾章、選任務（翻譯／數位化）。
3. `/readbot:serve` —— 開看板，選書看 `output/`（本文／筆記兩檢視）。
4. `/readbot:tutor` —— 陪讀做好的章節：Claude 回答問題、把學到的重點補進該章筆記。

## 為什麼要 CDP

讀書機器人會用 CDP 接管一台**使用者已登入**的 Chrome 去操作 ChatGPT（裁圖／生譯圖）——用使用者的登入、不另外打 API。透過內建 Playwright MCP 連這台 Chrome。不懂 CDP？看 **[docs/cdp-基本觀念.md](docs/cdp-基本觀念.md)**。

## 開發者：直接在 repo 跑

需求：[**uv**](https://docs.astral.sh/uv/)。

```bash
uv sync                        # 建 .venv + 裝相依（Flask、PyMuPDF、Pillow）
uv run python server.py        # 看板 → http://localhost:5050（讀 ./book；參數見下表）
claude --plugin-dir ./         # 以 plugin 形式載入 skills（/readbot:<skill>）
```

上面是「**cwd 剛好在 repo 根**」的簡寫。**cwd 不在 repo**（或想指定別的書庫）就把路徑寫全——`--project` 指 **plugin 根**（才吃得到 plugin 的 venv，裡面才有 Flask／PyMuPDF），`server.py` 與 `--book-dir` 都給絕對路徑：

```bash
# 從任何位置都能跑
uv run --project /path/to/readbot python /path/to/readbot/server.py --book-dir /path/to/book

# Windows（PowerShell）同理
uv run --project C:\path\to\readbot python C:\path\to\readbot\server.py --book-dir C:\path\to\readbot\book
```

`server.py` 的參數：

| 參數 | 說明 | 預設 |
|---|---|---|
| `--book-dir` | 書庫目錄（其下一本書一個資料夾） | `<cwd>/book`；也可用 `BOOK_DIR` 環境變數 |
| `--port` | 服務 port | `5050`；也可用 `PORT` 環境變數（預設避開 macOS AirPlay 佔用的 5000） |
| `--reload` | 開發用：改 `server.py` 存檔就自動重啟 | 關閉 |

（平常用 `/readbot:serve` 開看板即可，這段是要手動跑或除錯時用。）

## 安裝為 plugin

```text
/plugin marketplace add <帳號>/<repo>    # 加入 marketplace
/plugin install readbot@readbot         # 安裝
```

裝好後：`/readbot:setup`（首次備環境）→（放書進 `book/<書>/src/`）→ `/readbot:digitize-book` → `/readbot:serve` → `/readbot:tutor`（陪讀）。
製作機制與踩坑見 **[docs/plugin-tutorial.md](docs/plugin-tutorial.md)**。
