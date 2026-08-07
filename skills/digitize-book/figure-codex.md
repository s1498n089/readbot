# Codex 版截圖操作（image_model=codex，預設）

> `digitize-book` §5「截圖」的 **image_model=codex 分支**——用 **Codex CLI**（`codex exec`）在**本機**直接讀圖、跑 Python(Pillow)、寫圖。**不經瀏覽器、不經 CDP、不經 ChatGPT UI**，所以沒有「上傳／等渲染／收圖／對話卡死」那套；也因為一律在原圖上 **PIL 裁切／疊字（不重繪）**，照片、精確 code、勾勾、數據曲線都**像素級忠實**——這是它比 chatgpt 分支更適合「忠實數位化」的原因。
> **共用的部分不在這裡、在主 `SKILL.md §5`**：裁切的 4 條合格標準、§5B 回讀驗收、§5C 的「要不要生／命名／文字專項驗收」。本檔只講「怎麼驅動 codex」。文中 `§5`／`§5B`／`§5C` 指主 SKILL.md 的對應節；`<PLUGIN_DIR>` 是主 §0 推出的 plugin 根。

## 前提
- **Codex CLI 已裝、且登入**：`codex login status` 應回「Logged in using ChatGPT」（或 API key）。沒登入就停下、請使用者跑 `codex login`（見 `/readbot:setup`）。
- **有 uv**：codex 產出圖靠 Pillow，Pillow 已在 plugin venv（`uv sync` 就有）。

## 怎麼驅動 codex（裁切、生譯圖共用）
一張圖 = 一次 `codex exec`。用 **Bash** 跑（前景、`timeout` 給大一點，`max` reasoning 一張常要 1~5 分鐘；或 `run_in_background`）：
```
codex exec -m gpt-5.6-sol -c model_reasoning_effort="max" --sandbox danger-full-access '<指令>'
```
- **`-m` 模型／`-c model_reasoning_effort`**：依 codex 當前可用模型與使用者偏好（上面是目前用的組合）。
- **`--sandbox danger-full-access`**：給 codex **完整讀寫檔案系統**的權限——它才能直接讀輸入圖、把成品寫到 `images/`。這是刻意授權（也是它快的原因）；指令裡把輸入／輸出路徑講明確，codex 就只動那些檔。
- **輸入／輸出都在 `<指令>` 裡給絕對路徑**：codex 直接讀本機輸入圖、把成品寫到你指定的絕對路徑（**省掉 chatgpt 分支的下載＋收圖**）。輸出直接指向 `book/<書>/…/images/`。
- **codex 自己會**：讀圖判斷座標、用 `uv run --project "<PLUGIN_DIR>" python` 跑 Pillow、`ImageChops` 逐像素自驗、必要時迭代修——不用手把手教，指令把「目標＋忠實要求＋用 Pillow＋用 uv＋輸出路徑」講清楚即可。
- 🔑 **叮嚀它「腳本寫到 `tmp/`（相對 workdir、符合主 §0 的 `tmp/` 慣例）、別留在專案根」**：codex 的 workdir 是**使用者的專案根**（dev 時＝repo 根、安裝後＝使用者專案），不講它可能把臨時 `.py` 留在根污染。指令明寫相對 `tmp/` 就會乖乖落那（實測有效）；這些腳本的清理見下方「收尾」段（主 §8 清的是 `tmp/<書>/pages/` 頁圖、不含這些腳本）。
- **輸出很長（幾十 KB）會被存成檔**：讀結尾即可（它會印成品絕對路徑與尺寸）。
- **驗收沒過怎麼重跑**：codex 沒有可延續的對話——重跑＝**重下一次 `codex exec`、把要修的點寫進新指令**（例：「上一版某字寫錯／某邊切到了，這次…」＋同一張輸入圖、同一個輸出路徑），直接覆蓋原輸出。

## 裁切
把「含整張圖的一頁（或大略區域）」交給 codex，要它像素掃描定位、PIL crop 出「圖＋整行圖說」（達成主 §5 的 4 條標準）。備輸入圖同 chatgpt 分支：**寧可切大、含完整圖＋圖說**（codex 會精準裁掉多餘）。範本（`[…]` 換實際值；英文書 `图 X-Y`→`Figure X-Y`）：
> 讀取圖片 `[粗胚頁圖絕對路徑]`。頁面裡有一張圖「**图 X-Y**」＋正下方一行圖說「**图 X-Y …**」，四周可能有正文、頁碼、別張圖。任務：**只**把「图 X-Y 那張圖＋它整行圖說」精準裁成一張 PNG（不要別張圖、不要正文、不要頁碼）。要求：① 圖外框那圈細線**完整保留**、四邊不可切；② 外框外側再留約 **20~30px 白邊**；③ 不含正文／頁碼／別張圖；④ **含整行圖說**。做法：用 Python + Pillow——先讀圖、**用像素掃描定位外框線四邊與圖說下緣的 bbox**（別只靠目測座標），再 crop。我們有 uv、Pillow 在專案 venv，請用 `uv run --project [PLUGIN_DIR] python` 跑；腳本寫到 `tmp/`（相對你的 workdir＝專案根，別留在專案根本身）。輸出存成 `[…/images/figX-Y.png 絕對路徑]`。完成後印出成品的絕對路徑與尺寸。
- 收成＝codex 已直接把檔寫到 `images/figX-Y.png`——**不用下載、不用搬**。接著走 §5B 逐張回讀驗收。

## 生譯圖（task=translate 時，每張都做）
把剛裁好的 `figX-Y.png` 交給 codex，PIL 疊字翻文字、其餘像素不動。**codex 版一律 PIL 疊字（不重繪）**——照片／結構／數據都像素保留，不需要 chatgpt 分支那套「image-gen vs PIL」分流。範本（`[…]` 換實際值；照 §4a 用語）：
> 讀取圖片 `[figX-Y.png 絕對路徑]`。把圖內所有非目標語言的文字（角色方塊、箭頭／座標軸標註、圖例、最底下整行圖說）翻成 **[目標語言，如 繁體中文]**，其餘一切（圖形／照片／箭頭／泳道／數據／曲線／配色／版面／外框）**像素上維持原樣、絕對不要用影像生成重畫**。做法：用 Python + Pillow 在原圖上**逐塊把原文用背景色蓋掉、再重寫譯文**（**中文字型：先偵測系統實際存在的 CJK 字型再用**——常見位置 Windows `C:/Windows/Fonts/msjh.ttc`、macOS `/System/Library/Fonts/PingFang.ttc`、Linux `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`；逐一試、取第一個存在的，**全都找不到就中止並報錯、絕不 fallback 到 PIL 預設字型**——預設字型畫不出中文、會靜默產出空白／方框的壞圖）；遮蓋色塊要**夠寬、蓋掉整段原文**（免得譯文較短時右緣殘留原字尾）。**技術詞／變數／產品名保留原文**（如 `unix_locked`、`UPDATE`、`x_t`）。我們有 uv、Pillow 在專案 venv，用 `uv run --project [PLUGIN_DIR] python` 跑；腳本寫到 `tmp/`（相對你的 workdir＝專案根，別留在專案根本身）。輸出存成 `[…/figX-Y.<語言碼>.png 絕對路徑]`。完成後印出成品的絕對路徑與尺寸。
- **文字對照**：知道圖說／標註的正確譯法就一起寫進指令（簡→繁對照、英→中對照），最準。
- 收成＝codex 已直接寫出 `figX-Y.<語言碼>.png`——直接接主 §5C 的**文字專項驗收**（每張都做）。

## 並行 / 收尾
- **一張一次 `codex exec`**（保守、對應主 §5 精神）。要並行可**同時開多個 `codex exec`（`run_in_background`）**、各自獨立輸入輸出——但**別在一支呼叫裡塞多張**（一次多張的效果尚未實測，先別賭）。
- **收尾**：清掉 `tmp/` 底下 codex 留的裁切／疊字腳本；確認 **專案根乾淨**（codex 偶爾會在根留 `.py`，`git status` 掃一下）。
