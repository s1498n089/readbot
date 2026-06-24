---
name: setup
description: 安裝/設定 Readbot（讀書機器人）的執行環境：經套件管理器（macOS Homebrew / Windows Scoop）裝 uv 與 Node（nvm，Node 24 LTS）→ uv sync → 備 CDP 瀏覽器（複製啟動腳本、登入要操作的網站）→ 預核准瀏覽器自動化工具（免每次跳權限框）。觸發詞（含口語與失敗情境）：「幫我設定環境 / 安裝 / 裝環境 / 初始化 / 環境準備 / 配置環境 / 把環境裝好 / 第一次使用要準備什麼 / 我要開始用 / 怎麼開始 / 怎麼跑起來 / 準備 CDP 環境 / setup / install」；以及遇到「缺 uv / 沒裝 uv / 缺 Node 或 npx / uv sync 失敗 / MCP 連不到瀏覽器 / serve 提示缺工具」等狀況時，也觸發本 skill。
---

# setup

把 Readbot 的執行環境一次備好。**會安裝軟體**，每個安裝動作前先簡短告知使用者、徵得同意再跑。

> 兩塊環境都要備好：
> - **看板**（`/readbot:serve`）：只需要 **uv** 與專案相依（步驟 3b、4）。
> - **CDP 瀏覽器 ＋ Playwright MCP**（步驟 3c、5、6）：讀書機器人的**核心管道**。`digitize-book` 的預設截圖就是透過內建 Playwright MCP、用 CDP 接管一台**使用者已登入**的 Chrome 去操作 ChatGPT 裁圖；之後要處理的「書」也可能是**線上文件**。（MCP 已宣告在 `.mcp.json`、隨安裝自動註冊。）

## 步驟

### 1. 取得 plugin 根目錄
系統會在開頭給「**Base directory for this skill**」（即 `<plugin>/skills/setup`）。
**plugin 根 = 該 base 的上兩層**（`<skill base>/../..`），解析成絕對路徑，後續用。不靠 cwd 或 `$CLAUDE_PLUGIN_ROOT`。

### 2. 問使用者的作業系統
直接問使用者：作業系統是 **Windows / macOS / Linux** 哪一個？依回答走對應分支。

### 3. 裝好工具鏈：uv ＋ Node（都走套件管理器，一次備齊）
**統一走套件管理器**（brew/scoop），有就跳過、絕不重裝。先確保管理器在，再裝 uv 與 Node。

**3a. 套件管理器**（沒有才裝）：
- **macOS** Homebrew（互動要密碼，請使用者用 `!` 前綴自己跑）：
  ```bash
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ```
  裝完找不到 `brew` → 用 `/opt/homebrew/bin/brew`（Apple Silicon PATH 未設）。
- **Windows** Scoop（PowerShell）：
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force; iwr -useb get.scoop.sh | iex
  ```
- **Linux**（無 brew/scoop 文化，下面 uv/nvm 改用官方安裝器）。

**3b. uv**（看板必備）：`uv --version` 有 → 跳過；否則 `brew install uv`／`scoop install uv`（Linux：`curl -LsSf https://astral.sh/uv/install.sh | sh`）。

**3c. Node（用 nvm 裝 Node 24 LTS）**——瀏覽器自動化（Playwright MCP，`digitize-book` 截圖會用）要跑 `npx`，所以需要 Node。
`node --version` 與 `npx --version` 都有且 Node ≥ 20 → 跳過（已夠用，不必硬升到 24）；**沒有 Node 時才裝**，裝就裝 24 LTS、用 nvm（依 OS）：
- **Windows**（Scoop 裝 nvm-windows）：
  ```powershell
  scoop install nvm
  nvm install 24
  nvm use 24
  ```
  （新版 nvm-windows `nvm install 24` 會解析成最新 24.x；舊版只吃完整版號就改 `nvm install lts` 或 `nvm install 24.x.x`。）
- **macOS**（Homebrew 裝 nvm；要自建 `NVM_DIR` 並 source，且 **source 與 `nvm install` 必須在同一條 bash 指令**——每次 bash 不共用 shell 狀態）：
  ```bash
  brew install nvm
  mkdir -p ~/.nvm
  export NVM_DIR="$HOME/.nvm"; . "$(brew --prefix nvm)/nvm.sh"; nvm install 24 && nvm use 24
  ```
  提醒使用者把 `export NVM_DIR="$HOME/.nvm"` 與 `. "$(brew --prefix nvm)/nvm.sh"` 加進 `~/.zshrc`（之後新 shell 才有 node）。
- **Linux**（官方 nvm 安裝器）：
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm install 24 && nvm use 24
  ```
裝完用 `node --version`（應為 v24.x）+ `npx --version` 確認。

> 統一走套件管理器，未來新工具同一管道、移除也乾淨（`brew/scoop uninstall uv nvm`）。勿改成各平台官方安裝器（Linux 例外）。

### 4. 安裝專案相依（看板必備）
```bash
uv sync --project "<PLUGIN_DIR>"
```
做完這步就能跑 `/readbot:serve` 開看板了。

### 5. 備 CDP 瀏覽器（讀書機器人的核心管道）
讀書機器人靠 plugin **內建的 Playwright MCP**（`.mcp.json` 隨安裝自動註冊）透過 CDP 接管一台**使用者已登入**的 Chrome——`digitize-book` 預設用它操作 ChatGPT 裁圖，也用來讀線上文件。MCP 不用另外建，但那台 Chrome 要本機備好：

1. **把啟動腳本放進「使用者專案」的 `.browser/`**（登入態是使用者資產、不放 plugin 內）：
   ```bash
   mkdir -p "$(pwd)/.browser"
   cp "<PLUGIN_DIR>/templates/launch-chrome-cdp.bat" "$(pwd)/.browser/"   # Windows
   cp "<PLUGIN_DIR>/templates/launch-chrome-cdp.sh"  "$(pwd)/.browser/"   # macOS / Linux
   ```
   提醒使用者把 `.browser/` 加進**他自己專案**的 `.gitignore`（裡面有登入態）。
2. **由「Claude」幫使用者啟動那台 Chrome**（不必使用者手動雙擊——Claude 跑腳本＝等同人親手雙擊）：
   - Windows：`cmd //c "$(pwd)/.browser/launch-chrome-cdp.bat"`
   - macOS／Linux：`bash "$(pwd)/.browser/launch-chrome-cdp.sh"`
   會開出一台帶 9222 埠的 Chrome（背景、不阻塞）。
3. **唯一需要「使用者」親手做的事：在那台 Chrome 登入要操作的網站**（最重要的是 **ChatGPT**（截圖用）；以及要讀的線上書籍／文件。登入無法自動化、只有真人能做；登一次就好，profile 會記住、下次免登）。
4. 使用者登入後**即可直接用，不必重啟 Claude Code**（MCP 是用到瀏覽器工具時才連 CDP，Chrome 後開也接得上）。換 port 就設環境變數 `PLAYWRIGHT_CDP_URL`。
   - Windows 上裸 `npx` 已實測可用；萬一某些 Windows 環境 MCP 因 `npx` 解析不到（找不到 `npx.cmd`）起不來：把 `.mcp.json` 的 `"command"` 改成 `"cmd"`、`"args"` 開頭插 `"/c", "npx"`（其餘不動；預設裸 `npx` 是為了跨平台）。

### 6. 預核准瀏覽器自動化工具（免每次跳權限框）
之後的功能會用到 plugin 內建的 playwright MCP 工具（navigate/click/type/upload…），預設**每個動作都會問一次權限**，一次流程十幾、二十框很煩。**徵得使用者同意後**，把這些工具預先核准。

> ⚠️ 這步會**修改使用者專案的 `.claude/settings.local.json`**（本機級、Claude Code 預設 gitignore、不進他的版控）。動手前先講清楚、徵得同意；用「合併」不覆蓋。

跑這個小腳本（讀現有→合併去重→原子寫回；只 append、不刪別人的設定）：
```bash
uv run python - <<'PY'
import json, os
d = os.path.join(os.getcwd(), ".claude"); os.makedirs(d, exist_ok=True)
p = os.path.join(d, "settings.local.json")
cfg = {}
if os.path.isfile(p):
    try: cfg = json.load(open(p, encoding="utf-8"))
    except Exception: cfg = {}
perms = cfg.setdefault("permissions", {})
allow = perms.setdefault("allow", []); ask = perms.setdefault("ask", [])
for x in ["mcp__plugin_readbot_playwright",
          "Bash(uv run:*)", "Bash(uv sync:*)", "Bash(curl:*)", "Bash(mkdir:*)", "Bash(ls:*)", "Bash(date:*)", "Bash(cmd:*)", "Bash(bash:*)",
          "Write(book/**)", "Edit(book/**)", "Read(book/**)", "Write(tmp/**)", "Edit(tmp/**)", "Read(tmp/**)"]:
    if x not in allow: allow.append(x)
for x in ["mcp__plugin_readbot_playwright__browser_run_code_unsafe"]:
    if x not in ask: ask.append(x)
tmp = p + ".tmp"; json.dump(cfg, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=2); os.replace(tmp, p)
print("[ok] merged permissions into", p)
PY
```
- **allow `mcp__plugin_readbot_playwright`**：授**整個內建 playwright server**（官方明確支援、跨版本最穩、涵蓋所有 `browser_` 工具；`<plugin>` 是 `readbot`）。
- **ask `…__browser_run_code_unsafe`**：任意執行碼維持「每次問」——`ask` 優先級高於 `allow`，會蓋過整包 allow，不會被誤放行。
- 順帶預核准流程實際會用到的 Bash 指令：`uv run`／`uv sync`（跑 server/腳本）、`curl`（探 CDP 埠）、`mkdir`（建暫存夾）、`ls`／`date`（列檔/時間戳）、`cmd`／`bash`（啟動 Chrome 腳本：Windows 用 `cmd` 跑 `.bat`、macOS／Linux 用 `bash` 跑 `.sh`），以及 `Write/Edit/Read(book/** 與 tmp/**)`（讀寫書庫產物與過程檔）。**破壞性的 `rm`／`taskkill` 刻意不放行**，每次問過再做。
- 設定在**新 session 才生效**（這個 session 內若還會問，重啟／`/reload-plugins` 後就不會了）。
- 註：工具識別名是 `mcp__plugin_<plugin>_<server>__<tool>`（plugin-provided MCP 的命名，見 plugin-tutorial §4.5）——和「專案級 `.mcp.json`」的 `mcp__<server>__…` 不同，別把那個寫進來。

### 7. 回報
環境就緒。接著可：
- `/readbot:serve` —— 開看板檢視／新增／編輯／刪除項目。
- `/readbot:digitize-book` —— 數位化／翻譯書籍；其預設截圖會用到步驟 5、6 備好的 CDP 瀏覽器與工具權限。
