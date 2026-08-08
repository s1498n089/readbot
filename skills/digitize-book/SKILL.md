---
name: digitize-book
description: 把 book/<書>/src 裡的書（PDF 或分章照片）用多模態（視覺）數位化成 jupyter（ipynb）電子書——可選「翻譯成繁中」或「原文照錄（繁中書直接數位化）」，順便做每小節重點筆記、把頁面插圖截出來。觸發詞（含口語）：「把這本書數位化／電子化 / 翻譯這本書 / 翻 <書名> / 把這本 PDF／照片轉成電子書 / 翻第 3 章 / 翻成 ipynb / 做這本的重點筆記 / 把書的圖截出來 / digitize book / translate book」等。
---

# digitize-book

把一本書（PDF／照片）**數位化**成電子書產物，寫進 `book/<書>/output/`——依 `task` 設定**翻成繁中**或**原文照錄**。**本文＋筆記都是 ipynb**。
看板（`/readbot:serve`）只負責顯示產物；**真正動手讀、翻譯/轉錄、截圖的是這個 skill**。

> 走「PDF→逐頁圖片→多模態理解」這條路：最省事，掃描 PDF 本來就是圖、且多模態理解不一定輸 OCR。

> ⏳ **數位化/翻譯是長時間的動作，不要有焦慮感。** 一本書幾十上百頁很正常——**踏實地一頁一頁走完就好**，不要為了快而跳頁、略讀或草草帶過。寧可慢、寧可分多次完成，也要每頁都確實做到位。

## 0. 取得 plugin 根目錄
系統會在開頭給「**Base directory for this skill**」（= `<plugin>/skills/digitize-book`）。
**plugin 根 = 該 base 的上兩層**（`<base>/../..`），解析成絕對路徑 `<PLUGIN_DIR>`，後面所有 `uv run` 都帶 `--project "<PLUGIN_DIR>"`（用 plugin 的 venv，裡面才有 pymupdf/pillow）。
**路徑慣例**：`book/`、`tmp/` 都相對「使用者目前的 cwd」（dev=repo、安裝後=使用者專案）；產物寫 `book/<書>/output/`、過程檔寫 `tmp/`，**勿污染 project root**。

## 1. 先把「要翻什麼」搞清楚（先讀 config／progress，不夠的才問）
- **哪本書** → 對到 `book/<書>/`。沒有就**教使用者自己建**（別代為 `mkdir`）：用看板「＋ 新增書」建好書骨架，再把 PDF／照片放進 `book/<書>/src/`，然後回來找 Claude 接續。
- **讀 `book/<書>/config.json`** → 拿設定當預設，不必每次重問使用者（檔案不存在＝全部視同預設值，可順手建立；schema 見 README「資料模型」）：
  - **`task`**：`translate`（翻成繁中，預設）或 `transcribe`（**原文照錄、純數位化**——繁中書用這個，書上印什麼就打什麼、不翻不改）。使用者當下若有明講，以使用者為準（Claude 可順手打看板 `PUT /api/books/<書>/config` 同步回 config.json）。
  - **`image_model`**：`codex`（預設，本機 Python／PIL 直接裁切／疊字）或 `chatgpt`（CDP 接管 ChatGPT）——**決定 §5 截圖走哪條做法檔、開工前要讀**。`mode` 仍是**保留欄位**（目前一律 `ipynb`）。
- **讀 `book/<書>/progress.md`** → 看這本翻到哪了（口語記錄，**未提及＝未作業**），決定這次從哪接續、翻哪幾章。
- **來源型態** → 看 `src/`：是 PDF（`*.pdf`）還是**分章照片**（`src/ch1/`、`src/ch2/`…）。
- **範圍** → 哪幾章。**預設逐章**（一次一章，整本太大）；參考 progress.md 接續。
- **語言** → 預設 `zh_tw`。

## 2. 前置處理（開讀前先備好）
PDF／照片進來後、開始讀之前的準備：把頁面轉成圖（2a），第一次還要建書卡 metadata（2b）。

### 2a. PDF → 逐頁 PNG（PyMuPDF；照片來源跳過此步）
把**這次要處理的頁範圍**（頁範圍先由 §3 分章決定；整本一次 render 只在你確實要做整本時才需要）render 成 ~200 DPI PNG，存 `tmp/<書>/pages/`（gitignored 過程檔）：
```bash
# 末兩個參數＝起始頁、結束頁（1-based）；都不給＝整本
uv run --project "<PLUGIN_DIR>" python - "book/<書>/src/<書>.pdf" "tmp/<書>/pages" "<起始頁>" "<結束頁>" <<'PY'
import sys, os, fitz
src, out = sys.argv[1], sys.argv[2]
p0 = int(sys.argv[3]) if len(sys.argv) > 3 else 1     # 起始頁；不給＝從第 1 頁
p1 = int(sys.argv[4]) if len(sys.argv) > 4 else 0     # 結束頁；0＝到最後一頁
os.makedirs(out, exist_ok=True)
doc = fitz.open(src)
p1 = p1 or doc.page_count
for i in range(p0, p1 + 1):
    doc[i - 1].get_pixmap(dpi=200).save(os.path.join(out, f"p{i:04d}.png"))
print(f"rendered pages {p0}-{p1} -> {out}")
PY
```

### 2b. 建書 metadata：封面、書名、作者（每本書第一次做一次）
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
3. 寫進 `book/<書>/config.json`（**讀現有→加欄位→原子寫回**，別蓋掉既有的 task 等欄位）：`title`、`author`、`cover: "cover.png"`。看板 `/api/books` 會自動把這些變成書卡（封面＋書名＋作者）。

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
> - **`translate`（翻譯）**：翻成繁中——**用語一律在地化**（見下方「🇹🇼 用語在地化」、與來源無關）；簡中來源另需**字形簡→繁＋行/列對調**（見 §4a）。輸出語言＝`zh_tw`。

> 🔤 **關鍵術語首次出現時，於譯名後用括號附上原文**（如「可擴展性（scalability）」「容錯（fault-tolerance）」「吞吐量（throughput）」），幫讀者建立「中↔原文」的專業詞彙對照、邊讀邊學術語。原則：
> - 只挑**重要、值得記**的專業術語，不是每個詞都標。
> - **同一術語整章只標一次**（首次出現），之後重複不再標，免得擁擠。
> - 縮寫／產品名／技術名（CDN、ETL、REST、Kafka…）本就保留原文、不必再加括號。
>
> **僅外文原書（英、日…）翻中時適用**——簡→繁因原文同為中文不需此步（簡→繁要標英文的時機見 §4a）。

> 🇹🇼 **用語在地化（凡輸出繁中就適用、與來源語言無關）**：大陸用語→台灣慣用——軟件→軟體、程序→程式、算法→演算法、內存→記憶體、**電平→電壓**、屏幕→螢幕、視頻→影片、鼠標→滑鼠……（依台灣慣用、拿不準就保留原詞或標英文、別亂換）。**翻英文書同樣要**——技術術語的中譯多從大陸傳入、甚至更常踩，不是只有簡中來源才做。

### 4a. 簡體 → 繁體（zh_cn → zh_tw）特別注意〔task=translate 且來源是簡中時〕
這一步做的是**純字形簡→繁**（其餘一律照原文、不改寫、不潤飾）。用語在地化不在這裡——見上方「🇹🇼 用語在地化」（凡輸出繁中就適用、不限這裡）。

最大的坑是**「行 / 列」剛好相反**：

| 意義 | 簡體（中國） | 繁體（台灣） |
|---|---|---|
| row（橫的） | 行 | **列** |
| column（直的） | 列 | **行** |

→ 翻矩陣／表格／張量維度時務必**對調**；遇到容易混淆處，建議**直接標英文**最清楚，例如「**列（row）**」「**行（column）**」。

## 5. 截圖（figure extraction）
把頁面插圖截出來。標準流程＝每張圖「**先裁切（成 `figX-Y.png`）→ §5B 回讀驗收 → task=translate 再生譯圖（成 `figX-Y.<語言碼>.png`）**」；原裁切圖一律保留、看板**預設顯示原圖**。裁切要含**整張圖 ＋ 整行圖說**。**給做法檔的輸入＝足以定位那張圖的畫面**：能給整頁頁圖就整頁，一頁多圖／版面很雜時才自己縮一塊（別把「先切一塊」當每條路都要的步驟）。

**合格標準（4 條）**：
- ① **外框邊線完整**（圖本體＋圖外那圈細外框線四邊都不切，尤其曲線**峰頂**）。
- ② **外框線外側再留白邊**（別讓外框線貼在圖片邊緣、四周有呼吸空間，約 20~30px——切到框線一眼就看得出來、很扣分）。
- ③ **留白不含內文**（沒有正文段落、頁眉頁碼、前一張圖）。
- ④ **含整行圖說**（「图 X-Y …」/「Figure X-Y …」，圖說有兩行就兩行都要）。

**怎麼裁、怎麼生譯圖 → 依 `config.image_model`（§1 讀）選一條路、Read 對應的做法檔照做**（兩條路都要達成上面 4 條標準、裁完都接 §5B 回讀驗收、生譯圖都遵守 §5C 的命名與文字驗收）：
- **`codex`（預設）** → `<PLUGIN_DIR>/skills/digitize-book/figure-codex.md`：用 `codex exec` 在本機以 Python(Pillow) 直接裁切／疊字翻譯，不經瀏覽器——像素忠實、快，不竄改照片／結構。
- **`chatgpt`** → `<PLUGIN_DIR>/skills/digitize-book/figure-chatgpt.md`：透過 CDP 接管 ChatGPT，用它的視覺裁切、image-gen／PIL 生譯圖。

### 5B. 回讀驗收 ＋ 插回原文
- **逐張回讀驗收**（強制）：每張都自己 Read 回讀，注意力**放在四邊**對照 ①②③④（方框有沒有被切？峰頂在不在？留白有沒有沾到正文／前一張圖？圖說完不完整？）。不符就重來——重跑該圖的裁切（見你這條路的做法檔）。⚠️ **別用「全部乾淨」一句帶過**，每張都要實際看過（圖多可派 subagent 複驗）。**疊字／本機補字這種「程式性改原圖」的，驗收也可程式性**——比對「只有該改處有差異」比目視硬；重畫的只能目視。
- **把圖插回原文出現的位置**（夾在對應段落之間、不是堆在章末）：插一個 **markdown cell** 放 `![圖 3-1 標題](images/fig1.png)`，夾在前後文 cell 間。

### 5C. 生譯圖：圖內文字翻成目標語言（task=translate 時，**每張圖都做**）
插圖的文字（座標軸 label、標註、圖例）也常需要翻譯——尤其來源是**日文／法文**等看不懂的語言時，連 x/y 軸 label 都得翻。所以**不挑圖、每張都生一張譯圖**，搭配保留的原裁切圖。（task=`transcribe` 時不做這步。）
> 🈂️ **「要翻的圖內文字」包含圖說（caption）本身**——「图 X-Y …」/「Figure X-Y …」那行也是外文，也要翻。所以**圖框內沒有可翻文字（純示意圖／節點圖／第三方 UI 截圖）也照樣生譯圖**：圖體（方框／節點／連線／截圖）維持原樣、不動內容，**只把圖說翻成目標語言**重新輸出（圖體不動、只換圖說文字；具體做法見做法檔）。圖說翻譯版很直接、好讀，使用者通常會想要。**唯一可略過的情形**：整張圖連圖說都沒有任何外文（例：無圖說、或圖說已是目標語言）。
- **怎麼生 → 見你這條路的做法檔**（§5 dispatcher 已指定）：`codex` 在本機用 Python(Pillow) 疊字（照片／結構都像素忠實）；`chatgpt` 預設 image-gen 重繪、少數圖種（照片／勾勾／精確 code／數據曲線）改 PIL。**無論走哪條，核心要求一致**：把圖內文字＋整行圖說翻成目標語言，其餘（圖形／座標軸／數據／曲線／配色／排版）維持原樣；數學符號／變數／產品名不翻。
- **命名**：存成 **`figX-Y.<語言碼>.png`**，`<語言碼>`＝output 語言資料夾名（**與 §6 同步**；task=translate 現行輸出恆為 `zh_tw`）。與原圖**同資料夾**、**絕不覆蓋 `figX-Y.png`**（`figX-Y.png` 永遠是源語言原始裁切）。
- **看板預設顯示原裁切圖**（忠實那張）；譯圖是使用者**自己點「譯圖」**才看的輔助，真生壞了還有原圖兜底、而且原圖就是預設。修字錯怎麼收斂見下方「文字專項驗收」。
- **本文照舊引用 `figX-Y.png`、不必改**：看板靠 `/figs` 查到同語言碼的譯圖，自動加「**原圖／譯圖**」切換（**預設原圖**）。
- **🔍 文字專項驗收（每張都做）**：譯圖的價值就是「文字翻對」，**驗的細度依產出方式**：
  - **重畫（image-gen）**：會把字**畫成形近的別字**、縮圖看不出 → **每個文字元素單獨高倍放大再 Read**、逐字比對（原圖小字也先放大看準，免得 baseline 認錯字）。
  - **疊字（PIL；codex 一律、chatgpt 特例）**：程式性畫字、不會畫錯字，風險在**遮蓋不乾淨（殘留原文字尾）**＋**你給的對照本身寫錯** → **整張回讀**就看得到，可疑處再放大。
  - 兩者都查兩類易錯：① **簡繁字形殘留**（圖說開頭那字最常見，`图`→應是繁體 `圖`）；② **概念相近的詞被換掉**、意思全變（機率↔頻率、機率密度↔頻率密度）。
  - 對不上 → 重生（**指令點名上一版具體哪裡不對**）。**重跑要收斂**——第二次仍卡在同一處＝這條修不動了，別再重跑，看「錯多大」決定收尾：
    - **整體壞**（版面亂、多處錯字）→ **留原圖**（原圖是預設、不虧）。
    - **只有一兩個字錯、其餘全對**（版面／配色／其他文字都對）→ **本機 PIL 只補那一兩個字**是合理的最後收尾（兩次重生都改不掉才用、非常態）：定位到錯字位置 → 白色蓋掉 → 用**接近書體的字型**重寫正確的字（原文是斜體就仿斜體）、其餘像素完全不動。（典型情境：圖說某個字被寫成形近的錯字、點名重生兩次都改不掉，但整張只錯這一字——補那一字，勝過整張作廢。）
    - **圖形偏差不強求**（重畫本來就會變、原圖是預設）。

## 6. 寫產物（ipynb）
> `<語言>`＝結果語言：**translate → `zh_tw`**；**transcribe → 原書語言**（繁中→`zh_tw`、簡中→`zh_cn`…，見 §4 📌）。看板會自動掃出 output 底下實際存在的語言層，不必另外設定。
- 產物一律 **ipynb** → `book/<書>/output/<語言>/ipynb/ch<n>/ch<n>.ipynb`：散文→markdown cell、程式碼→code cell、公式→markdown cell 裡的 LaTeX。**直接手組 JSON** 即可：`{"cells":[...],"nbformat":4,"nbformat_minor":5,"metadata":{}}`（本專案沒裝 nbformat，不必依賴它）。
- 原子寫入：先寫 `.tmp` 再 `os.replace`，避免半截檔。
- ⚠️ **看板用 marked.js 核心版**：**不支援 markdown 註腳**（`[^1]`／`[^1]: …` 會原樣噴出來、爆版）。原書的頁尾註腳要改寫成——文中標「（注 N）」＋該段後面放 blockquote `> **注 N**：…`。（表格、`$ $`／`$$ $$` 數學是支援的。）
- ✅ **本文也要「渲染驗收」（和 §5B 驗圖對等，別組完就交）**：圖會逐張回讀，本文同樣不能只組完就算數——要確認在看板上**真的長對**：
  - **靜態掃**：`grep` 產出的 ipynb 有沒有 marked 不吃的語法（最常見 `[^` 註腳；見上一條）。
  - **看渲染（CDP）**：開 `http://localhost:5050`，在頁面 context 跑看板的全域函式 `renderIpynb(text, base)` 再驗產出的 DOM（比截圖可靠——文件很長時 headless 截圖深處會全黑）。⚠️ **第一參數吃「ipynb 原始 JSON 字串」、不是 parse 過的物件**——傳物件會回『（無法解析的 ipynb）』佔位**且不報錯**，最容易被誤判成產物壞掉。最小可跑片段（填 `id`／`ch`；驗筆記把 `kind` 改 `'note'`）：
    ```js
    // 當「有回傳值的 async 函式」跑（如 browser_evaluate）——把統計 return 出來、別用 console.log（自動化拿不到 console）
    async () => {
      const id = '<書資料夾名>', lang = 'zh_tw', ch = 'ch3', kind = 'text';   // 填實際值；驗筆記把 kind 改 'note'
      const q = new URLSearchParams({ lang, fmt: 'ipynb', ch, kind });
      const text = await (await fetch(`/api/books/${encodeURIComponent(id)}/doc?${q}`)).text();  // 原始 JSON 字串，別 JSON.parse
      const dir = kind === 'note' ? `${lang}/ipynb/note/${ch}` : `${lang}/ipynb/${ch}`;
      const base = `/api/books/${encodeURIComponent(id)}/output/${dir}/`;
      const d = document.createElement('div'); d.innerHTML = renderIpynb(text, base);
      return { katex: d.querySelectorAll('.katex').length, table: d.querySelectorAll('table').length,
               img: d.querySelectorAll('img').length,
               footnote殘: (d.textContent.match(/\[\^/g) || []).length,   // 應 0
               dollar殘: (d.textContent.match(/\$/g) || []).length };      // 應 0（數學都被 KaTeX 接走）
    }
    ```
    沒 CDP 就請使用者幫看一眼。**「組完 ipynb」≠「顯示正確」——這步專抓 marked 不吃的語法（如 `[^` 註腳）、數學沒被 KaTeX 接到、圖斷鏈等。**

## 7. 重點筆記（note）
整章一檔（跟本文一樣 ipynb）→ `…/ipynb/note/ch<n>/ch<n>.ipynb`；每節的重點**對齊書的節次**收好（放在該重點所屬的小節，`tutor` 之後才好補進同一節）。note 是 ipynb，需要時可放**可跑的 code cell** 演示概念（不附預先算好的 outputs；看板只顯示、不執行，讀者在 Jupyter 跑才出圖）。長章節筆記同樣適用〈注意〉段的「逐節 md → 最後組裝」（md→ipynb 的切割邏輯與本文共用、進度也落地）。

> 📝 **每則 note「寫什麼、用什麼結構、什麼切角」＝完全照使用者專案根的 `note-style.md`。** 權責劃分：note 風格是**使用者的個人偏好、由 `note-style.md` 定義**；skill 只負責「讀懂書 → 照 `note-style.md` 寫 → 放對小節」，**格式一律不寫死**。
>
> 🛡️ **防呆：動手寫 note 前先確認 `note-style.md` 在。** 不在就**先問使用者**「這本書的重點想怎麼整理？（每節放哪些區塊、用什麼標記、什麼切角）」，照他回答寫；並建議順手幫他把偏好存成 `note-style.md`，同一專案以後不必再問。

> note 是這個 plugin 最有價值的產物——把書**真的讀懂**、照使用者的切角把重點寫到受用，不只是濃縮。

## 8. 收尾
- **更新 `book/<書>/progress.md`**：用口語記下這次做到哪，讓下次（或別的 session）接得上。例：「Ch1: 已做到 1.4 節，其餘未做」「前言: 已完成」。未提及的一律視為未作業。
- 清掉 `tmp/<書>/pages/`（過程檔；若還要重 crop 可暫留，最後再清）。
- 請使用者開 `/readbot:serve` → 看板選這本書、切到對應語言/格式看 output。

## 注意
- **一次一章**：避免單次太大/太久；長書分多次做。
- **長章節用「逐節寫工作檔 → 最後組裝」**：每做完一個小節就把該節產出（含 ```python 圍欄、`$$` 數學、`![](images/..)` 圖）寫成 `tmp/<書>/work/<節>.md`；全章做完再用一支小腳本把這些 md 依序組成 ipynb（```python 圍欄→code cell、其餘→markdown cell，依標題切 cell）。這樣進度落地、context 被摘要也不怕，且 md→ipynb 的切割邏輯只寫一次。
- **Windows 中文輸出**：ad-hoc `uv run python - <<'PY'` 腳本只要會 `print` 中文（書名/內容），開頭就加 `import sys; sys.stdout.reconfigure(encoding="utf-8")`，否則 Windows cp950 會 `UnicodeEncodeError`。
- `pymupdf`/`pillow` 已是專案相依（`uv sync` 即有）；萬一缺 → `uv sync --project "<PLUGIN_DIR>"`。
- 所有 python 走 `uv run --project "<PLUGIN_DIR>"`（plugin venv）；**過程檔只進 `tmp/`、產物只進 `book/<書>/output/`**，收工前確認 project root 乾淨。
