"""
Readbot — Backend（書籍看板）

掃描專案根的 book/ 當書籍清單；選一本後顯示它 output/ 底下的產物與章節筆記。
src/（原始 PDF／照片）不經 UI。電子化／翻譯產物由 digitize-book skill 寫入。

book/<書名>/
  src/                              ← 原始輸入（UI 不顯示）
  config.json                       ← 每本書設定（mode/image_model/task；title/author/cover 由 skill 抽自書的前幾頁）
  progress.md                       ← 進度（口語記錄，給 digitize-book skill 讀/寫）
  output/cover.png                  ← 封面圖（書卡 icon；config.cover 指它）
  output/<語言>/<格式>/ch<n>/        ← 產物本文（翻譯或數位化）；<格式>=md|ipynb，<語言> 預設 zh_tw
  output/<語言>/<格式>/note/ch<n>/   ← 章節筆記（跟著同一個格式走）

看板做管理寫入：建書（POST，建骨架＋config/progress）、改設定（PUT config）、刪書（DELETE 整個資料夾）；**output 產物只由 digitize-book skill 寫入**。只綁 127.0.0.1、不打任何外部 API。

執行：
    uv run python server.py                          # 書庫 = ./book
    uv run python server.py --book-dir /path/book    # 指定書庫目錄（plugin 安裝後指向使用者專案）
接著開啟 http://localhost:5050
"""

import argparse
import json
import os
import re
import shutil
import sys

# 強制 stdout/stderr 使用 UTF-8（避免 Windows cp950/cp1252 出現 UnicodeEncodeError）
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from flask import Flask, jsonify, request, send_file

ROOT = os.path.dirname(os.path.abspath(__file__))  # 前端靜態檔（index.html / frontend/）位置
# 書庫目錄：預設專案根的 book/（dev 在 repo 內跑時即 repo/book）；可用 BOOK_DIR 環境變數或 --book-dir 覆寫。
# plugin 安裝後由 serve skill 補 --book-dir "$(pwd)/book" → 讀「使用者專案」的 book/。
BOOK_DIR = os.environ.get("BOOK_DIR") or os.path.join(os.getcwd(), "book")

# 繞過 Jinja：template_folder=None。index.html 以原始檔案透過 send_file 提供（UTF-8）。
app = Flask(__name__, static_folder=ROOT, static_url_path="", template_folder=None)
app.jinja_env.auto_reload = False
# 註：不需要 CORS — 前端由本 server 同源服務。


def _safe_name(name):
    """資料夾名守門（擋路徑穿越／隱藏檔）：純 basename、不以 . 開頭、無 '..'。非法回 None。"""
    if not name or name != os.path.basename(name) or name.startswith(".") or ".." in name:
        return None
    return name


def _book_path(book_id):
    return os.path.join(BOOK_DIR, book_id)


def _natkey(name):
    """讓 ch10 排在 ch2 後面：抓名字裡的數字當主鍵。"""
    m = re.search(r"\d+", name)
    return (int(m.group()) if m else 0, name)


def _scan_output(book_id):
    """掃 <book>/output → {語言: {格式: {chapters:[…], notes:[…]}}}（只列非空的）。"""
    base = os.path.join(_book_path(book_id), "output")
    tree = {}
    if not os.path.isdir(base):
        return tree
    for lang in sorted(os.listdir(base)):
        lp = os.path.join(base, lang)
        if not os.path.isdir(lp):
            continue
        fmts = {}
        for fmt in sorted(os.listdir(lp)):
            fp = os.path.join(lp, fmt)
            if not os.path.isdir(fp):
                continue
            chapters, notes = [], []
            for entry in os.listdir(fp):
                if not os.path.isdir(os.path.join(fp, entry)):
                    continue
                if entry == "note":
                    notes = [
                        d for d in os.listdir(os.path.join(fp, entry)) if os.path.isdir(os.path.join(fp, entry, d))
                    ]
                else:
                    chapters.append(entry)  # ch1, ch2…（note 以外的子資料夾都當章節）
            if chapters or notes:
                fmts[fmt] = {"chapters": sorted(chapters, key=_natkey), "notes": sorted(notes, key=_natkey)}
        if fmts:
            tree[lang] = fmts
    return tree


DEFAULT_CONFIG = {"schema_version": 1, "mode": "ipynb", "image_model": "codex", "task": "translate",
                  "title": "", "author": "", "cover": None}  # title/author/cover 由 digitize-book 從書的前幾頁抽出後填
VALID_MODE = ("md", "ipynb")
VALID_IMAGE_MODEL = ("claude_code", "chatgpt", "codex")
VALID_TASK = ("translate", "transcribe")  # translate=翻成繁中；transcribe=原文照錄、純數位化

_PROGRESS_TEMPLATE = """# {name} — 處理進度

> 口語記錄即可，讓 digitize-book skill 知道進度到哪。**未提及的一律視為「未作業」。**
> 格式範例：
>   前言: 已完成
>   Ch1: 已做到 1.3 節，其餘未做

（尚未開始）
"""


def _read_config(book_id):
    """讀 <book>/config.json；缺檔/壞檔回預設，補齊缺欄、非法值正規化回預設。"""
    cfg = dict(DEFAULT_CONFIG)
    p = os.path.join(_book_path(book_id), "config.json")
    if os.path.isfile(p):
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
            if isinstance(d, dict):
                cfg.update({k: d[k] for k in ("mode", "image_model", "task", "title", "author", "cover") if k in d})
        except Exception:
            pass
    if cfg.get("mode") not in VALID_MODE:
        cfg["mode"] = DEFAULT_CONFIG["mode"]
    if cfg.get("image_model") not in VALID_IMAGE_MODEL:
        cfg["image_model"] = DEFAULT_CONFIG["image_model"]
    if cfg.get("task") not in VALID_TASK:
        cfg["task"] = DEFAULT_CONFIG["task"]
    for k in ("title", "author"):  # 自由字串，非字串就正規化成空字串
        if not isinstance(cfg.get(k), str):
            cfg[k] = ""
    if not (cfg.get("cover") is None or isinstance(cfg.get("cover"), str)):
        cfg["cover"] = None
    cfg["schema_version"] = 1
    return cfg


def _write_config(book_id, cfg):
    """原子寫入 config.json（.tmp → os.replace）。"""
    p = os.path.join(_book_path(book_id), "config.json")
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)


@app.route("/")
def index():
    return send_file(os.path.join(ROOT, "index.html"), mimetype="text/html")


@app.route("/api/health")
def health():
    return jsonify({"ok": True})


@app.route("/api/books", methods=["GET", "POST"])
def api_books():
    """GET：列出書；POST：建一本書（以書名為資料夾名，建 src/、output/、config.json、progress.md）。"""
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        name = _safe_name((body.get("name") or "").strip())
        if name is None:
            return jsonify({"error": "書名不合法（不可空白、含路徑分隔、.. 或以 . 開頭）"}), 400
        path = _book_path(name)
        if os.path.isdir(path):
            return jsonify({"error": "同名書已存在"}), 409
        os.makedirs(os.path.join(path, "src"), exist_ok=True)
        os.makedirs(os.path.join(path, "output"), exist_ok=True)
        _write_config(name, dict(DEFAULT_CONFIG))
        with open(os.path.join(path, "progress.md"), "w", encoding="utf-8") as f:
            f.write(_PROGRESS_TEMPLATE.format(name=name))
        return jsonify({"id": name, "title": name, "has_output": False, "config": _read_config(name)}), 201

    books = []
    if os.path.isdir(BOOK_DIR):
        for name in sorted(os.listdir(BOOK_DIR)):
            p = os.path.join(BOOK_DIR, name)
            if not os.path.isdir(p) or name.startswith("."):
                continue
            out = os.path.join(p, "output")
            cfg = _read_config(name)
            cover = None
            if cfg.get("cover") and os.path.isfile(os.path.join(out, cfg["cover"])):
                cover = f"/api/books/{name}/output/{cfg['cover']}"
            books.append({
                "id": name,
                "title": cfg.get("title") or name,
                "author": cfg.get("author") or "",
                "cover": cover,
                "has_output": os.path.isdir(out) and bool(os.listdir(out)),
            })
    return jsonify({"books": books})


@app.route("/api/books/<book_id>", methods=["GET", "DELETE"])
def api_book(book_id):
    """GET：回傳設定＋output 樹；DELETE：刪除整本書資料夾（含 src／output，無法復原）。"""
    if _safe_name(book_id) is None or not os.path.isdir(_book_path(book_id)):
        return jsonify({"error": "找不到該書"}), 404
    if request.method == "DELETE":
        rp = os.path.realpath(_book_path(book_id))
        root = os.path.realpath(BOOK_DIR)
        if rp == root or not rp.startswith(root + os.sep):  # 多一層保險：必須在書庫底下
            return jsonify({"error": "路徑不合法"}), 400
        try:
            shutil.rmtree(rp)
        except OSError as e:  # Windows：檔案被其他程式鎖住可能半途失敗，如實回報而非吞成 500
            return jsonify({"error": f"刪除未完成（可能有檔案正開啟中）：{e}"}), 500
        return jsonify({"ok": True})
    cfg = _read_config(book_id)
    return jsonify({"id": book_id, "title": cfg.get("title") or book_id, "author": cfg.get("author") or "",
                    "config": cfg, "output": _scan_output(book_id)})


@app.route("/api/books/<book_id>/config", methods=["GET", "PUT"])
def api_config(book_id):
    """讀／改每本書設定：mode=md|ipynb、image_model=codex|chatgpt、task=translate|transcribe。"""
    if _safe_name(book_id) is None or not os.path.isdir(_book_path(book_id)):
        return jsonify({"error": "找不到該書"}), 404
    cfg = _read_config(book_id)
    if request.method == "PUT":
        body = request.get_json(silent=True) or {}
        if body.get("mode") in VALID_MODE:
            cfg["mode"] = body["mode"]
        if body.get("image_model") in VALID_IMAGE_MODEL:
            cfg["image_model"] = body["image_model"]
        if body.get("task") in VALID_TASK:
            cfg["task"] = body["task"]
        _write_config(book_id, cfg)
    return jsonify(cfg)


def _resolve_under_output(book_id, *parts):
    """把 parts 接到該書 output/ 下，逐段擋穿越＋用 realpath 守門。
    **全專案唯一做路徑穿越比對的地方**——三個讀檔端點都走它，免得守門邏輯散落、補強漏一處。
    parts 內可含 '/'（如 api_output_file 的 relpath）；每一路徑段都必須是無穿越的單一名字。
    回 (realpath, None) 成功，或 (None, (resp, code)) 失敗。"""
    out_root = os.path.realpath(os.path.join(_book_path(book_id), "output"))
    for part in parts:
        for comp in str(part).replace("\\", "/").split("/"):
            if comp in ("", "..") or comp != os.path.basename(comp):
                return None, (jsonify({"error": "參數不合法"}), 400)
    rp = os.path.realpath(os.path.join(out_root, *parts))
    if not (rp == out_root or rp.startswith(out_root + os.sep)):
        return None, (jsonify({"error": "找不到該檔"}), 404)
    return rp, None


@app.route("/api/books/<book_id>/doc")
def api_doc(book_id):
    """取單一產物檔內容。query：lang、fmt(md|ipynb)、ch、kind(text|note)。"""
    if _safe_name(book_id) is None:
        return jsonify({"error": "找不到該書"}), 404
    lang, fmt, ch = request.args.get("lang", ""), request.args.get("fmt", ""), request.args.get("ch", "")
    kind = request.args.get("kind", "text")
    if fmt not in ("md", "ipynb"):
        return jsonify({"error": "格式只支援 md / ipynb"}), 400
    ext = "ipynb" if fmt == "ipynb" else "md"
    parts = [lang, fmt] + (["note", ch] if kind == "note" else [ch]) + [ch + "." + ext]
    rp, err = _resolve_under_output(book_id, *parts)
    if err:
        return err
    if not os.path.isfile(rp):
        return jsonify({"error": "找不到該檔"}), 404
    mime = "application/json; charset=utf-8" if ext == "ipynb" else "text/markdown; charset=utf-8"
    return send_file(rp, mimetype=mime)


@app.route("/api/books/<book_id>/figs")
def api_figs(book_id):
    """列某章 images/ 底下有哪些譯圖（figX-Y.<語言碼>.png，語言碼＝這個 lang）。看板靠它決定哪張圖要加「譯圖／原圖」對照切換，免逐張探測 404。query 同 doc：lang、fmt、ch、kind。"""
    if _safe_name(book_id) is None:
        return jsonify({"error": "找不到該書"}), 404
    lang, fmt, ch = request.args.get("lang", ""), request.args.get("fmt", ""), request.args.get("ch", "")
    kind = request.args.get("kind", "text")
    if fmt not in ("md", "ipynb"):
        return jsonify({"error": "格式只支援 md / ipynb"}), 400
    parts = [lang, fmt] + (["note", ch] if kind == "note" else [ch]) + ["images"]
    rp, err = _resolve_under_output(book_id, *parts)
    if err:
        return err
    suffix = "." + lang.lower() + ".png"  # 譯圖副檔名＝語言碼（與 output 資料夾同步）
    translated = sorted(f for f in os.listdir(rp) if f.lower().endswith(suffix)) if os.path.isdir(rp) else []
    return jsonify({"translated": translated})


@app.route("/api/books/<book_id>/output/<path:relpath>")
def api_output_file(book_id, relpath):
    """服務 output/ 底下的任意檔（給本文／筆記內文引用的插圖用）。realpath 擋路徑穿越。"""
    if _safe_name(book_id) is None:
        return jsonify({"error": "找不到該書"}), 404
    rp, err = _resolve_under_output(book_id, relpath)
    if err:
        return err
    if not os.path.isfile(rp):
        return jsonify({"error": "找不到該檔"}), 404
    return send_file(rp)  # mimetype 由副檔名自動推斷（png → image/png）


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Readbot 書籍看板")
    ap.add_argument("--book-dir", help="書庫目錄（其下一本書一個資料夾），預設 ./book")
    # 預設 5050：macOS 的 AirPlay 接收器佔 5000，避開它（可用 --port 或 PORT 環境變數覆寫）
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 5050)))
    ap.add_argument("--reload", action="store_true", help="開發用：改 server.py 存檔就自動重啟（仍 debug=False）")
    args = ap.parse_args()
    if args.book_dir:
        BOOK_DIR = args.book_dir
    print(f"\nReadbot server 執行中：http://localhost:{args.port}", flush=True)
    print(f"書庫目錄：{BOOK_DIR}\n", flush=True)
    try:
        app.run(host="127.0.0.1", port=args.port, debug=False, threaded=True, use_reloader=args.reload)
    except OSError as e:
        print(f"\n啟動失敗：port {args.port} 無法綁定（{e}），請改用 --port 指定別的 port。", flush=True)
        sys.exit(1)
