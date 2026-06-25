---
name: digitize-book
description: 把 book/<書>/src 裡的書（PDF 或分章照片）用多模態（視覺）數位化成 markdown 或 jupyter 電子書——可選「翻譯成繁中」或「原文照錄（繁中書直接數位化）」，順便做每小節重點筆記、把頁面插圖截出來。觸發詞（含口語）：「把這本書數位化／電子化 / 翻譯這本書 / 翻 <書名> / 把這本 PDF／照片轉成電子書 / 翻第 3 章 / 翻成 ipynb / 做這本的重點筆記 / 把書的圖截出來 / digitize book / translate book」等。
---

# digitize-book

把一本書（PDF／照片）**數位化**成電子書產物，寫進 `book/<書>/output/`——依 `task` 設定**翻成繁中**或**原文照錄**。**本文＋筆記跟著同一個格式**（md 或 ipynb）。
看板（`/readbot:serve`）只負責顯示產物；**真正動手讀、翻譯/轉錄、截圖的是這個 skill**。

> 走「PDF→逐頁圖片→多模態理解」這條路：最省事，掃描 PDF 本來就是圖、且多模態理解不一定輸 OCR。

> ⏳ **數位化/翻譯是長時間的動作，不要有焦慮感。** 一本書幾十上百頁很正常——**踏實地一頁一頁走完就好**，不要為了快而跳頁、略讀或草草帶過。寧可慢、寧可分多次完成，也要每頁都確實做到位。

## 0. 取得 plugin 根目錄
系統會在開頭給「**Base directory for this skill**」（= `<plugin>/skills/digitize-book`）。
**plugin 根 = 該 base 的上兩層**（`<base>/../..`），解析成絕對路徑 `<PLUGIN_DIR>`，後面所有 `uv run` 都帶 `--project "<PLUGIN_DIR>"`（用 plugin 的 venv，裡面才有 pymupdf/pillow）。
**路徑慣例**：`book/`、`tmp/` 都相對「使用者目前的 cwd」（dev=repo、安裝後=使用者專案）；產物寫 `book/<書>/output/`、過程檔寫 `tmp/`，**勿污染 project root**。

## 1. 先把「要翻什麼」搞清楚（先讀 config／progress，不夠的才問）
- **哪本書** → 對到 `book/<書>/`。沒有就請使用者用看板「＋ 新增書」建好（或代為 `mkdir`），再請使用者把 PDF／照片放進 `src/`。
- **讀 `book/<書>/config.json`** → 拿設定當預設，不用每次重問：
  - `mode`：`md` 或 `ipynb`（產物格式；科技書建議 ipynb）。
  - `image_model`：截圖走哪條——**`chatgpt`（預設：CDP 接管 ChatGPT 裁切，品質最穩，見 §5A）** 或 `claude_code`（本機 PyMuPDF 裁切 fallback，見 §5B）。
  - **`task`**：`translate`（翻成繁中，預設）或 `transcribe`（**原文照錄、純數位化**——繁中書用這個，書上印什麼就打什麼、不翻不改）。決定 §4 文字怎麼處理。
  - 使用者當下若有明講，以使用者為準（並可順手請看板/PUT config 更新）。
- **讀 `book/<書>/progress.md`** → 看這本翻到哪了（口語記錄，**未提及＝未作業**），決定這次從哪接續、翻哪幾章。
- **來源型態** → 看 `src/`：是 PDF（`*.pdf`）還是**分章照片**（`src/ch1/`、`src/ch2/`…）。
- **範圍** → 哪幾章。**預設逐章**（一次一章，整本太大）；參考 progress.md 接續。
- **語言** → 預設 `zh_tw`。

## 2. PDF → 逐頁 PNG（PyMuPDF；照片來源跳過此步）
把每頁 render 成 ~200 DPI PNG，存 `tmp/<書>/pages/`（gitignored 過程檔）：
```bash
uv run --project "<PLUGIN_DIR>" python - "book/<書>/src/<書>.pdf" "tmp/<書>/pages" <<'PY'
import sys, os, fitz
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
doc = fitz.open(src)
for i, page in enumerate(doc, 1):
    page.get_pixmap(dpi=200).save(os.path.join(out, f"p{i:04d}.png"))
print(f"rendered {doc.page_count} pages -> {out}")
PY
```

## 2b. 建書 metadata：封面、書名、作者（每本書第一次做一次）
給看板「書卡」用的 metadata。**config 已有 `title`／`cover` 就跳過**（之前做過了）。
1. **封面**：把第一頁（PDF 第 1 頁＝封面；分章照片來源用 `src/` 第一張）render 成圖、存 `book/<書>/output/cover.png`，縮到 ~460px 寬當卡片 icon：
```bash
uv run --project "<PLUGIN_DIR>" python - "book/<書>/src/<書>.pdf" "book/<書>/output/cover.png" <<'PY'
import sys, os, fitz
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(os.path.dirname(dst), exist_ok=True)
fitz.open(src)[0].get_pixmap(dpi=110).save(dst)
im = Image.open(dst)
if im.width > 460:
    im.resize((460, round(460 * im.height / im.width))).save(dst)
print("cover ->", dst)
PY
```
2. **書名＋作者**：Read 前幾頁（封面、書名頁、版權頁／CIP）抽出**書名**與**作者**。書名依 `task` 處理（translate→翻成繁中、transcribe→原文）；作者用原書印的（人名一般保留、簡轉繁）。
3. 寫進 `book/<書>/config.json`（**讀現有→加欄位→原子寫回**，別蓋掉 mode/task）：`title`、`author`、`cover: "cover.png"`。看板 `/api/books` 會自動把這些變成書卡（封面＋書名＋作者）。

## 3. 分章（PDF 才需要）
- 先讀 PDF 內建目錄抓章節起始頁（`fitz.open(src).get_toc()`）。
- 抓不到/不準 → 看前幾頁頁圖、用視覺判讀章節邊界；仍不確定就**問使用者頁碼範圍**（例 `ch3 = p.45–70`）。
- 照片來源：`src/ch<n>/` 已分好，直接用。

## 4. 多模態讀＋產出本文（逐頁、踏實走）
對範圍內的**每一頁** PNG（或照片），用 **Read 工具「看」圖**，一頁一頁來：
- 抽出文字、辨識結構：標題層級、小節（1.1 / 1.2…）、程式碼區塊、數學公式、表格、插圖。
- **逐頁、不跳頁**：前言、目錄、附錄等都要做（除非使用者指定只做某章／某步驟）。
- 依 `task` 產出本文（翻譯或照錄，見下方 📌），但**原樣保留**：LaTeX 公式（`$...$` / `$$...$$`）、程式碼原文（code 不翻、註解可翻）、表格結構、插圖佔位。
- 把整段接成連續內容。

> 🎯 **忠實直譯、不要潤飾**（本文最高原則）：**作者寫什麼就翻什麼**——逐句對應，保留原意與原本的語序、結構、語氣。**不要換句話說、不要為了「讀起來順」而改寫或加料、不要自行擴寫或補背景。** 本文裡**不要塞入額外解釋**：要幫讀者理解是 note（§7）的事，別混進本文。真的非補不可（原文明顯跳步、或關鍵術語第一次出現）才補，且只在**關鍵處**極簡一句、不喧賓奪主。

> 📌 **看 `task` 決定文字怎麼處理**（兩種都要忠實、零潤飾）：
> - **`transcribe`（純數位化）**：**原文一字不改照錄**——不翻譯、不轉字形、不改用語，書上印什麼就打什麼（繁中書用這個）。輸出語言＝原書語言（繁中→`zh_tw`、簡中→`zh_cn`…），**§4a 不適用**。
> - **`translate`（翻譯）**：翻成繁中（見 §4a）——簡中→簡轉繁＋用語、外文→翻譯。輸出語言＝`zh_tw`。

> 🔤 **關鍵術語首次出現時，於譯名後用括號附上原文**（如「可擴展性（scalability）」「容錯（fault-tolerance）」「吞吐量（throughput）」），幫讀者建立「中↔原文」的專業詞彙對照、邊讀邊學術語。原則：① 只挑**重要、值得記**的專業術語，不是每個詞都標；② **同一術語整章只標一次**（首次出現），之後重複不再標，免得擁擠；③ 縮寫／產品名／技術名（CDN、ETL、REST、Kafka…）本就保留原文、不必再加括號。**僅外文原書（英、日…）翻中時適用**；簡→繁因原文同為中文不需此步（簡→繁要標英文的時機見 §4a）。

### 4a. 簡體 → 繁體（zh_cn → zh_tw）特別注意〔task=translate 且來源是簡中時〕
這一步**只做兩件事：① 字形簡→繁；② 大陸用語→台灣慣用語——其餘一律照原文，不改寫、不潤飾。** 用語在地化例：軟件→軟體、程序→程式、算法→演算法、內存→記憶體、**電平→電壓**、屏幕→螢幕、視頻→影片、鼠標→滑鼠……（依台灣慣用；**拿不準就保留原詞或標英文**，別亂換）。最大的坑是**「行 / 列」剛好相反**：

| 意義 | 簡體（中國） | 繁體（台灣） |
|---|---|---|
| row（橫的） | 行 | **列** |
| column（直的） | 列 | **行** |

→ 翻矩陣／表格／張量維度時務必**對調**；遇到容易混淆處，建議**直接標英文**最清楚，例如「**列（row）**」「**行（column）**」。

## 5. 截圖（figure extraction）
依 config 的 `image_model` 走：`chatgpt`（預設，§5A）或 `claude_code`（本機 fallback，§5B）。兩條都要切到**整張圖 ＋ 整行圖說**，最後都**回讀驗收**（§5C）。**task=translate 走 ChatGPT 時，標準流程＝每張圖「先裁切（§5A）→ 再生譯圖（§5D）」**；原裁切圖一律保留、看板**預設顯示原圖**。

**合格標準（4 條，兩法共用）**：① **方框四邊完整**（圖本體＋外框一邊都不切，尤其曲線**峰頂**）；② **四周稍微留白**、不擁擠；③ **留白不含內文**（沒有正文段落、頁眉頁碼、前一張圖）；④ **含整行圖說**（「图 X-Y …」/「Figure X-Y …」）。

### 5A. ChatGPT 裁切〔預設，image_model=chatgpt〕
丟「含整張圖的大圖」給 ChatGPT，讓它用視覺＋Python(PIL) 自己裁、回精準成品。透過內建 Playwright MCP 驅動（工具名：dev=`mcp__playwright__*`、安裝後=`mcp__plugin_readbot_playwright__*`）：
1. **前提**：CDP Chrome 開著且已登入 `chatgpt.com`。沒開先跑 `.browser/launch-chrome-cdp.bat`（見 `/readbot:setup`），確認 `http://127.0.0.1:9222/json/version` 回 200。**接不上（9222 探測失敗、或還沒登入 ChatGPT）→ 改走 §5B 本機裁切，並提示使用者補做 `/readbot:setup` 步驟 5/6。**
2. **備輸入圖**：從該頁 PNG 切一塊**含整張圖的大略區域**（不用精準、可連上下內文一起）存 `.browser/tmp/`。
3. navigate `https://chatgpt.com/` → 點 composer「＋」(`composer-plus-btn`) →「新增照片和檔案」→ `browser_file_upload` 那塊大略圖。
4. 在輸入框打**裁切指令**，按 Enter 送出。**固定用這個通用範本**（把 `图 X-Y` 換成實際編號；知道圖說全文就一起填進去，幫 ChatGPT 定位更準；英文書改用 `Figure X-Y`）——它已把 §5 的 4 條標準寫進去：
   > 這張圖裡有一張圖「**图 X-Y**」。請用 Python（PIL）把「图 X-Y 那張圖，加上它正下方那整行圖說『**图 X-Y …**』」精準裁切成一張 PNG 讓我下載。要求：① 圖的外框（座標軸方框／示意圖外框）四邊要完整、不可被切（尤其曲線峰頂）；② 四周留一點點白邊、不要太擠；③ **不可包含上下或旁邊的內文段落**（正文那幾行不要）；④ **一定要含「图 X-Y …」那整行圖說**。裁好後把成品顯示出來、並提供下載連結。
   - 例：`X-Y`＝`1-5`、圖說填『均值为0、标准差为1的正态分布』。
5. 等它跑 Python 裁好（頁面出現結果圖）→ **抓回本機**：`browser_evaluate` 找結果 `<img>`（naturalWidth 較小那張）、頁內 `fetch(src)` 轉 base64 → 存檔 → 解碼成 `…/images/figX-Y.png`。
6. ⚠️ 餵的大略圖若含「頁緣細框線」，ChatGPT 也會框進去——想更乾淨就餵「已不含頁緣線」的較緊區域。

**🚀 批次並行（多圖時省時，實測一次 5 張品質不掉）**：別一張一張來。一個訊息 **`browser_file_upload` 一次傳 5 張大略圖**（每張含一個 `图 X-Y`），叫 ChatGPT 一次裁完——它用**一次 Python run** 全部處理（~5 張約 2~3 分鐘，比逐張快、tool call 也少）。指令裡列出每張對應的 `图 X-Y`、套 §5 四條標準，並**務必要它「用 `IPython.display` 把每張成品直接內嵌顯示」——別讓它只給下載連結**（給連結時成品不是 `<img>`、`fetch` 抓不到；若已先給連結，補一句「請改成內嵌顯示」即可）。收成：`browser_evaluate` 抓**最後 N 張**結果 `<img>`（比輸入窄）依序 `fetch`→base64 存回 `figX-Y.png`。每張一樣要 §5C 回讀驗收。
   - ⚠️ 備輸入大略圖時**範圍要夠（含整張圖＋下方那一行圖說）**——抓太小／位置抓錯會出現「細條」（裁到剩一條）或「漏圖說」；§5C 驗到就把那張**單獨重裁**（單張比整批快）。批次 wall-clock 會浮動（5 張約 2~5 分鐘，ChatGPT 自己會多做幾步檢查）。

### 5B. 本機 PyMuPDF 裁切〔fallback，image_model=claude_code〕
不靠 ChatGPT 時自己切（PyMuPDF＋Pillow＋numpy；別只肉眼估比例）：
- **下緣**：`page.get_text("blocks")` 找以「图 X-Y」開頭的**圖說方塊**，用其 `y1`＋一點留白（圖說一定在圖正下方，最準）。注意 `图1-1` 別誤配 `图1-10`（數字後不可再接數字）。
- **上緣**：matplotlib 圖的**方框上緣＝一條 >40% 頁寬的長橫黑線**——掃描像素找「最上面那條長橫線」當圖頂，乾淨切掉上方正文；**排除頁首書眉線**（y<0.09）。無大方框的示意圖退用「白縫法」（往上遇夠大白縫就停）。
- **左右**：取圖非白像素最左/最右＋留白，掃描帶限在頁面內側（~0.07–0.93）**避開頁緣框線**。
- **同頁兩張圖**：搜尋上界卡在「前一張圖的圖說」下方；上緣留白帶內若還有文字，往下收到文字下方。
- **頑固頁緣線**：那條淡色頁框常壓在圖說左邊界，要完整含圖說那側難免帶一條淡線（非內文、可接受）；其餘三側 crop 內收一點點切掉。
- **換算像素裁切**（從該頁 PNG 切出、存進該章 `images/`）：
```bash
uv run --project "<PLUGIN_DIR>" python - \
  "tmp/<書>/pages/p0045.png" \
  "book/<書>/output/<語言>/md/ch3/images/fig1.png" \
  0.12 0.18 0.88 0.55 <<'PY'
import sys, os
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
x0, y0, x1, y1 = map(float, sys.argv[3:7])
os.makedirs(os.path.dirname(dst), exist_ok=True)
im = Image.open(src); W, H = im.size
im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))).save(dst)
print("cropped ->", dst)
PY
```
### 5C. 共用：回讀驗收 ＋ 插回原文
- **逐張回讀驗收**（強制）：每張都自己 Read 回讀，注意力**放在四邊**對照 ①②③④（方框有沒有被切？峰頂在不在？留白有沒有沾到正文／前一張圖？圖說完不完整？）。不符就重來——chatgpt 重下指令、本機重估 bbox。⚠️ **別用「全部乾淨」一句帶過**，每張都要實際看過；圖多可再派 subagent 當獨立第二雙眼複驗。
- **把圖插回原文出現的位置**（夾在對應段落之間、不是堆在章末）：**md** 插 `![圖 3-1 標題](images/fig1.png)`；**ipynb** 插一個 **markdown cell** 放同樣語法，夾在前後文 cell 間。

### 5D. 生譯圖：圖內文字翻成目標語言（task=translate 走 ChatGPT 時，**每張圖都做**）
插圖的文字（座標軸 label、標註、圖例）也常需要翻譯——尤其來源是**日文／法文**等看不懂的語言時，連 x/y 軸 label 都得翻。所以**不挑圖、每張都生一張譯圖**，搭配保留的原裁切圖。（task=`transcribe` 或 image_model=`claude_code` 時不做這步。）
- **流程＝接在 §5A 裁切後**，每張圖「**先裁切 → 再生譯圖**」：把剛裁好的 `figX-Y.png` 丟 ChatGPT，指令要它「**只把圖內文字翻成目標語言；其餘圖形／座標軸／數據／曲線／數學符號／排版／配色一律維持原樣**，重新輸出整張圖」，附文字對照（照 §4a 用語；數學符號與變數不要翻）。**提示詞要盡量把「除文字翻譯外、其他全部保持原樣」描述清楚。**
- **命名**：存成 **`figX-Y.<語言碼>.png`**，`<語言碼>`＝output 語言資料夾名（**與 §6 同步**）：繁中→`zh_tw`、簡中→`zh_cn`、日文→`ja`…。與原圖**同資料夾**、**絕不覆蓋 `figX-Y.png`**（`figX-Y.png` 永遠是源語言原始裁切）。
- **🚀 批次並行（多圖省時，實測可行）**：一個訊息 `browser_file_upload` 傳 ~5 張原圖，指令叫 ChatGPT「**對每張各生一張、依序對應、不要合併**」並附各圖文字對照——它會逐張生（5 張約 5~8 分鐘）。收成：`browser_evaluate` 抓 `naturalWidth` 較大的生成圖（輸入圖較小）、**依 DOM 順序**對上上傳順序存成 `figX-Y.<語言碼>.png`；**同尺寸的圖（多張同型 plot）只能靠順序分辨，務必逐張回讀確認對上**。**還可多開分頁讓多批同時生**（2 批×5 張並行 ≈ 砍半 wall-clock）。
- **trade-off（知道、接受）**：GPT 一定是「**重畫**」整張圖，數據圖／曲線可能跟原圖對不上。**這是可接受的取捨**——看板**預設顯示原裁切圖**（忠實那張），譯圖是使用者**自己點「譯圖」**才看的輔助；真生壞了還有原圖、而且原圖就是預設。
- **本文照舊引用 `figX-Y.png`、不必改**：看板靠 `/figs` 查到同語言碼的譯圖，自動加「**原圖／譯圖**」切換（**預設原圖**）。
- **🔍 文字專項驗收（譯圖最重要的一關，每張都做）**：譯圖的價值就是「文字翻對」，所以要**專門針對文字驗一遍**——不是整張看順眼就過。步驟：
  1. **逐一對照原圖**，列出這張的每個文字元素：圖說、標題、座標軸標籤、圖例、框內標註。
  2. **每個元素「單獨」高倍裁切放大再 Read**（PIL 裁該元素、放大數倍）；**別用縮小的拼貼一次掃**——縮圖分不出細微字形差（例：`图↔圖`），很容易看漏。一次一個、看清楚。
  3. **讀出來後「明確判斷對不對」**，別預期它對就放過：簡轉繁全了嗎？用語對嗎？**有沒有被畫成別的字／別的詞？**
  4. **特別留意兩類易錯**（每張都查）：① **簡繁字形殘留**——圖說開頭那個字最常見（例：`图`→應是繁體`圖`）；② **概念相近的詞被換掉**、意思全變（例：機率↔頻率、機率密度↔頻率密度）。
  5. **原圖的小字也要先放大看準**——baseline 看錯（把某字認成另一字），就抓不到譯圖的錯。
  - 對不上 → 重生（指令點名要它修哪個字）；**同一張最多 2 次**，2 次還錯就留原圖。**圖形偏差不強求**（重畫本來就會變、原圖是預設）。

## 6. 寫產物（依選的格式）
> `<語言>`＝結果語言：**translate → `zh_tw`**；**transcribe → 原書語言**（繁中→`zh_tw`、簡中→`zh_cn`…，見 §4 📌）。看板會自動掃出 output 底下實際存在的語言層，不必另外設定。
- **md** → `book/<書>/output/<語言>/md/ch<n>/ch<n>.md`
- **ipynb** → `book/<書>/output/<語言>/ipynb/ch<n>/ch<n>.ipynb`：散文→markdown cell、程式碼→code cell、公式→markdown cell 裡的 LaTeX。**直接手組 JSON** 即可：`{"cells":[...],"nbformat":4,"nbformat_minor":5,"metadata":{}}`（本專案沒裝 nbformat，不必依賴它）。
- 原子寫入：先寫 `.tmp` 再 `os.replace`，避免半截檔。
- ⚠️ **看板用 marked.js 核心版**：**不支援 markdown 註腳**（`[^1]`／`[^1]: …` 會原樣噴出來、爆版）。原書的頁尾註腳要改寫成——文中標「（注 N）」＋該段後面放 blockquote `> **注 N**：…`。（表格、`$ $`／`$$ $$` 數學是支援的。）
- ✅ **本文也要「渲染驗收」（和 §5C 驗圖對等，別組完就交）**：圖會逐張回讀，本文同樣不能只組完就算數——要確認在看板上**真的長對**：
  - **靜態掃**：`grep` 產出的 md/ipynb 有沒有 marked 不吃的語法（最常見 `[^` 註腳；見上一條）。
  - **看渲染（CDP）**：開 `http://localhost:5050`。**最穩的驗法是在頁面 context 跑看板自己的 `renderIpynb(doc, base)`（它是 app.js 的全域函式），再驗產出的 DOM**——數：`[^` 註腳（應 0）、漏出的 `$`（應 0，數學都被 KaTeX 接走）、`.katex`／`table`／`img` 數量對不對。比硬截圖可靠——**文件很長時（渲染後常達上萬 px）headless Chrome 會把深處內容截成全黑**（是截圖壓縮的限制、不是內容問題；頁頂截得到、往下截不到），所以用 DOM 檢查、別只靠截圖。沒 CDP 就請使用者幫看一眼。**「組完 ipynb」≠「顯示正確」——這步專抓 marked 不吃的語法、數學沒被 KaTeX 接到、圖斷鏈等。**

## 7. 重點筆記（note）— 每小節一個重點，用「小白視角」打痛點
整章一檔，跟本文同格式（md → `…/md/note/ch<n>/ch<n>.md`；ipynb → `…/ipynb/note/ch<n>/ch<n>.ipynb`）。
每個小節一塊 `## 1.x <小節標題>`，內含：
- **重點**：2–4 句濃縮。
- **白話打痛點**：站在**初學者（小白）**的角度——這節真正想解決什麼問題？一般讀者最容易**卡在哪、誤解什麼**？用**具體例子**、或**走一遍實際流程／一個小數字**把它講通。很多書寫得抽象、對小白不友善；這裡就是要把它「翻成人話」。
- **關鍵詞**：幾個術語（也是之後學習小卡的素材）。
- **（ipynb 時）程式輔助教學**：若該節有數學式或程式，note 可放**一小段可跑的 code cell** 把概念演示出來（畫個分布圖、跑個最小例子、用程式驗證一條公式…），用「能跑的程式」幫讀者建立直覺，比純文字更好懂。（code cell **不附預先算好的 outputs**；看板只顯示程式碼、不會執行，讀者在 Jupyter 跑才出圖。）

> 這是這個 plugin 最有價值的地方：不只濃縮，而是**真的把難懂的點講到讀者懂**——能打中痛點正是 Claude 的強項。

## 8. 收尾
- **更新 `book/<書>/progress.md`**：用口語記下這次做到哪，讓下次（或別的 session）接得上。例：「Ch1: 已做到 1.4 節，其餘未做」「前言: 已完成」。未提及的一律視為未作業。
- 清掉 `tmp/<書>/pages/`（過程檔；若還要重 crop 可暫留，最後再清）。
- 請使用者開 `/readbot:serve` → 看板選這本書、切到對應語言/格式看 output。

## 注意
- **一次一章**：避免單次太大/太久；長書分多次做。
- **長章節用「逐節寫工作檔 → 最後組裝」**：每做完一個小節就把該節產出（含 ```python 圍欄、`$$` 數學、`![](images/..)` 圖）寫成 `tmp/<書>/work/<節>.md`；全章做完再用一支小腳本把這些 md 依序組成 ipynb（```python 圍欄→code cell、其餘→markdown cell，依標題切 cell）。這樣進度落地、context 被摘要也不怕，且 md→ipynb 的切割邏輯只寫一次。
- **Windows 中文輸出**：ad-hoc `uv run python - <<'PY'` 腳本只要會 `print` 中文（書名/內容），開頭就加 `import sys; sys.stdout.reconfigure(encoding="utf-8")`，否則 Windows cp950 會 `UnicodeEncodeError`。
- `pymupdf`/`pillow`/`numpy` 已是專案相依（`uv sync` 即有）；萬一缺 → `uv sync --project "<PLUGIN_DIR>"`。
- 所有 python 走 `uv run --project "<PLUGIN_DIR>"`（plugin venv）；**過程檔只進 `tmp/`、產物只進 `book/<書>/output/`**，收工前確認 project root 乾淨。
