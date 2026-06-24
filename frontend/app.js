/* ============================================================
   Readbot — 書籍看板（Vue 3）
   列 book/ 底下的書、顯示選定書 output/ 的產物與筆記；可建書／改設定／刪書。
   數位化／翻譯、重點整理等產物都在對話裡走 Claude skill（digitize-book）；
   看板只做管理寫入（建/改設定/刪）、不寫 output 產物、不打外部 API，只跟本地 server 往返。
   ============================================================ */
const { createApp } = Vue;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 還原數學佔位符 → KaTeX 渲染（沒載入 KaTeX 就還原成原文，不漏出佔位符）
function restoreMath(html, math) {
  return html.replace(/@@M(\d+)@@/g, (m, i) => {
    const [x, display] = math[i];
    const raw = display ? `$$${x}$$` : `$${x}$`;
    if (!window.katex) return raw;
    try {
      return katex.renderToString(x, { displayMode: display, throwOnError: false });
    } catch (e) {
      return raw;
    }
  });
}

// 把內文相對圖片路徑改寫成 server 的 output 端點（否則瀏覽器找不到插圖）。
function fixImgs(html, base) {
  return html.replace(
    /(<img\b[^>]*?\bsrc=")([^"]+)(")/gi,
    (m, p1, src, p3) => (/^(https?:|data:|\/)/i.test(src) ? m : p1 + base + src + p3),
  );
}

// renderMd：① 先把數學式抽出來用佔位符保護（避免 marked 把 _ ^ * \ 當 markdown 吃掉）
// ② marked 轉散文 ③ 用 KaTeX 把數學還原 ④ 改寫相對圖片路徑。
function renderMd(text, base) {
  const math = [];
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (m, x) => `@@M${math.push([x, true]) - 1}@@`);
  text = text.replace(/\$([^$\n]+?)\$/g, (m, x) => `@@M${math.push([x, false]) - 1}@@`);
  return fixImgs(restoreMath(marked.parse(text), math), base);
}

// 把 .ipynb（JSON）渲染成 HTML：markdown cell 走 renderMd、code cell 包成 <pre>
function renderIpynb(text, base) {
  let nb;
  try { nb = JSON.parse(text); } catch (e) { return '<p class="ds-muted">（無法解析的 ipynb）</p>'; }
  return (nb.cells || []).map((cell) => {
    const src = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    if (cell.cell_type === 'markdown') return '<div class="nb-cell">' + renderMd(src, base) + '</div>';
    if (cell.cell_type === 'code') return '<div class="nb-cell nb-code"><pre><code class="language-python">' + escapeHtml(src) + '</code></pre></div>';
    return '';
  }).join('');
}

// ---- 心智圖（Markmap）：把筆記 md 抽成「精簡脈絡」樹 → SVG。只載 markmap-view（手組樹、不用重的 markmap-lib）。----
let _markmap = null;
function loadMarkmap() {
  // pin 0.18.x（避免 @latest 跨到不相容的 d3 major）
  if (!_markmap) _markmap = import('https://cdn.jsdelivr.net/npm/markmap-view@0.18/+esm').then((m) => m.Markmap);
  return _markmap;
}

let mmInstance = null;
function destroyMM() {
  if (mmInstance) { try { mmInstance.destroy(); } catch (e) { /* ignore */ } mmInstance = null; }
}

// 行內：$..$ 用 KaTeX 渲染、其餘 escape、去粗體標記（markmap 節點 content 是 HTML）
function mmInline(s) {
  return String(s).split(/(\$[^$\n]+\$)/).map((p) => {
    const m = p.match(/^\$([^$\n]+)\$$/);
    if (m) { try { return window.katex ? katex.renderToString(m[1], { throwOnError: false }) : escapeHtml(m[1]); } catch (e) { return escapeHtml(m[1]); } }
    return escapeHtml(p.replace(/\*\*(.+?)\*\*/g, '$1'));
  }).join('');
}

// ipynb 筆記 → 取出 markdown cells 串起來（心智圖只看散文層階、不要 code cell）
function notebookMd(text) {
  try {
    const nb = JSON.parse(text);
    return (nb.cells || []).filter((c) => c.cell_type === 'markdown')
      .map((c) => (Array.isArray(c.source) ? c.source.join('') : c.source || '')).join('\n\n');
  } catch (e) { return ''; }
}

// 從筆記 md 抽精簡脈絡：章(h1) → 小節(## 1.x) → 重點一句 ＋ 各關鍵詞
function buildMindmapTree(md, fallbackTitle) {
  const h1 = (md.match(/^#\s+(.+)$/m) || [])[1] || '';
  const title = h1.replace(/\s*(重點筆記|——|—).*$/, '').trim() || fallbackTitle || '心智圖';
  const root = { content: mmInline(title), children: [] };
  for (const part of md.split(/\n(?=##\s)/)) {
    const hm = part.match(/^##\s+(.+)$/m);
    if (!hm) continue;
    const sec = { content: mmInline(hm[1].trim()), children: [] };
    const zm = part.match(/\*\*重點\*\*[：:]\s*([\s\S]*?)(?=\n\n|\n\*\*|\n```|\n!\[|$)/);
    if (zm) {
      const first = zm[1].replace(/\s+/g, ' ').trim().split(/(?<=[。！？])/)[0];
      if (first) sec.children.push({ content: '💡 ' + mmInline(first), children: [] });
    }
    const km = part.match(/\*\*關鍵詞\*\*[：:]\s*(.+)/);
    if (km) km[1].split(/[、,，/]/).map((s) => s.trim()).filter(Boolean).forEach((kw) => sec.children.push({ content: mmInline(kw), children: [] }));
    if (sec.children.length) root.children.push(sec);
  }
  return root;
}

const MM_OPTS = { duration: 250, spacingVertical: 10, spacingHorizontal: 90, paddingX: 14, fitRatio: 0.92 };

createApp({
  data() {
    return {
      books: [],          // /api/books → [{ id, title, has_output }]
      selectedId: '',
      book: null,         // /api/books/<id> → { id, title, output: {lang:{fmt:{chapters,notes}}} }
      loadingBook: false,
      lang: '', fmt: '', kind: 'text', ch: '',   // 目前檢視的座標
      docHtml: '', docLoading: false,
      transFigs: [],      // 這章有譯圖的檔名（figX-Y.<語言碼>.png）；給 enhanceFigures 用
      imageModels: [{ v: 'chatgpt', label: 'ChatGPT' }, { v: 'claude_code', label: 'Claude Code' }],
      tasks: [{ v: 'translate', label: '翻譯' }, { v: 'transcribe', label: '數位化' }],
      libraryOpen: false,  // 書庫 modal（書卡列表）
      createBox: { show: false, name: '', error: '', busy: false },  // 新增書 modal
      deleteBox: { show: false, book: null, busy: false, error: '' },  // 刪除書確認 modal
      configSaved: false,
    };
  },

  async mounted() {
    await this.loadBooks();
    if (this.books.length) this.selectBook(this.books[0].id);
  },

  computed: {
    langs() { return Object.keys((this.book && this.book.output) || {}); },
    fmts() { return Object.keys((this.book && this.book.output && this.book.output[this.lang]) || {}); },
    chips() {
      const node = this.book && this.book.output && this.book.output[this.lang] && this.book.output[this.lang][this.fmt];
      if (!node) return [];
      return ((this.kind === 'note' || this.kind === 'mindmap') ? node.notes : node.chapters) || [];
    },
  },

  watch: {
    // docHtml 一變（載入新文件）→ 下個 tick：程式碼上色＋複製鈕、有譯圖的插圖加對照切換
    docHtml() { this.$nextTick(() => { this.enhanceCode(); this.enhanceFigures(); }); },
  },

  methods: {
    async loadBooks() {
      try {
        this.books = (await (await fetch('/api/books')).json()).books || [];
      } catch (e) {
        console.error('loadBooks', e);
      }
    },

    async selectBook(id) {
      this.selectedId = id;
      this.loadingBook = true;
      this.book = null;
      this._resetView();
      try {
        const data = await (await fetch('/api/books/' + encodeURIComponent(id))).json();
        if (this.selectedId !== id) return;  // 連點：過期回應丟棄
        this.book = data;
        // 預設展開：第一個語言 → 第一個格式 → 本文
        this.lang = this.langs[0] || '';
        this.fmt = this.fmts[0] || '';
      } catch (e) {
        console.error('selectBook', e);
      } finally {
        if (this.selectedId === id) this.loadingBook = false;
      }
    },

    pickBook(id) { this.libraryOpen = false; this.selectBook(id); },   // 從書庫卡片選書 → 關 modal
    pickLang(l) { this.lang = l; this.fmt = this.fmts[0] || ''; this._resetDoc(); },
    pickFmt(f) { this.fmt = f; this._resetDoc(); },
    pickKind(k) { this.kind = k; this._resetDoc(); },
    onChapterChange(c) { if (c) this.openDoc(c); else this._resetDoc(); },   // 下拉選章節

    async openDoc(c) {
      this.ch = c;
      if (this.kind === 'mindmap') { await this.renderMindmap(c); return; }
      this.docLoading = true;
      this.docHtml = '';
      const q = new URLSearchParams({ lang: this.lang, fmt: this.fmt, ch: c, kind: this.kind });
      // 這份 doc 在 output/ 底下的目錄 → 用來把內文相對圖片路徑接成 server 端點
      const dir = this.kind === 'note' ? `${this.lang}/${this.fmt}/note/${c}` : `${this.lang}/${this.fmt}/${c}`;
      const base = '/api/books/' + encodeURIComponent(this.selectedId) + '/output/' + dir + '/';
      const id = encodeURIComponent(this.selectedId);
      try {
        // doc 與「這章有哪些譯圖」並行抓；figs 失敗不影響本文
        const [figData, r] = await Promise.all([
          fetch('/api/books/' + id + '/figs?' + q.toString()).then((x) => (x.ok ? x.json() : { zh: [] })).catch(() => ({ zh: [] })),
          fetch('/api/books/' + id + '/doc?' + q.toString()),
        ]);
        if (this.ch !== c) return;  // 過期
        this.transFigs = figData.translated || [];
        if (!r.ok) { this.docHtml = '<p class="ds-muted">（讀取失敗：' + r.status + '）</p>'; return; }
        const text = await r.text();
        this.docHtml = this.fmt === 'ipynb' ? renderIpynb(text, base) : renderMd(text, base);
      } catch (e) {
        console.error('openDoc', e);
        this.docHtml = '<p class="ds-muted">（讀取失敗）</p>';
      } finally {
        if (this.ch === c) this.docLoading = false;
      }
    },

    // 心智圖：來源＝該章「筆記」md → 抽精簡脈絡樹 → Markmap 畫進 <svg ref="mm">
    async renderMindmap(c) {
      this.docHtml = '';
      const id = encodeURIComponent(this.selectedId);
      const q = new URLSearchParams({ lang: this.lang, fmt: this.fmt, ch: c, kind: 'note' });
      try {
        const r = await fetch('/api/books/' + id + '/doc?' + q.toString());
        if (this.ch !== c || this.kind !== 'mindmap') return;   // 過期／已切走
        let md = '';
        if (r.ok) { const t = await r.text(); md = this.fmt === 'ipynb' ? notebookMd(t) : t; }
        const tree = buildMindmapTree(md, c);
        const Markmap = await loadMarkmap();
        await this.$nextTick();
        if (this.ch !== c || this.kind !== 'mindmap' || !this.$refs.mm) return;
        destroyMM();
        mmInstance = Markmap.create(this.$refs.mm, MM_OPTS, tree);
      } catch (e) {
        console.error('mindmap', e);
      }
    },

    // ----- 新增書（server 直接建 src/、output/、config.json、progress.md）-----
    openCreate() { this.createBox = { show: true, name: '', error: '', busy: false }; },
    async createBook() {
      const name = (this.createBox.name || '').trim();
      if (!name) { this.createBox.error = '請輸入書名'; return; }
      this.createBox.busy = true; this.createBox.error = '';
      try {
        const r = await fetch('/api/books', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { this.createBox.error = d.error || ('建立失敗：' + r.status); return; }
        this.createBox.show = false;
        this.libraryOpen = false;
        await this.loadBooks();
        this.selectBook(d.id);
      } catch (e) {
        console.error('createBook', e);
        this.createBox.error = '建立失敗：' + e;
      } finally {
        this.createBox.busy = false;
      }
    },

    // ----- 每本書設定（task 任務 / mode 格式 / image_model 截圖模型）→ PUT 寫進 config.json -----
    async setConfig(key, val) {
      if (!this.book || !this.book.config || this.book.config[key] === val) return;
      this.book.config[key] = val;  // 樂觀更新
      try {
        const r = await fetch('/api/books/' + encodeURIComponent(this.selectedId) + '/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: val }),
        });
        if (r.ok) {
          this.book.config = await r.json();
          this.configSaved = true;
          setTimeout(() => { this.configSaved = false; }, 1500);
        }
      } catch (e) {
        console.error('setConfig', e);
      }
    },

    // ----- 刪除書（DELETE 整個 book/<書>/ 資料夾，含 src/output；不可復原）-----
    deleteBook(b) { this.deleteBox = { show: true, book: b, busy: false, error: '' }; },
    async confirmDelete() {
      const b = this.deleteBox.book;
      if (!b) return;
      this.deleteBox.busy = true; this.deleteBox.error = '';
      try {
        const r = await fetch('/api/books/' + encodeURIComponent(b.id), { method: 'DELETE' });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          this.deleteBox.error = d.error || ('刪除失敗：' + r.status);
          return;
        }
        this.deleteBox.show = false;
        this.books = this.books.filter((x) => x.id !== b.id);
        if (this.selectedId === b.id) {   // 刪到的是目前選的 → 清空，改選下一本
          this.selectedId = ''; this.book = null; this._resetView();
          if (this.books.length) this.selectBook(this.books[0].id);
        }
      } catch (e) {
        console.error('deleteBook', e);
        this.deleteBox.error = '刪除失敗：' + e;
      } finally {
        this.deleteBox.busy = false;
      }
    },

    // 對檢視器裡每塊程式碼：highlight.js 上色 ＋ 注入右上角「複製」鈕
    enhanceCode() {
      const root = this.$refs.viewer;
      if (!root) return;
      root.querySelectorAll('pre > code').forEach((code) => {
        const pre = code.parentElement;
        if (pre.dataset.enhanced) return;       // 同一塊不重複處理
        pre.dataset.enhanced = '1';
        if (window.hljs) window.hljs.highlightElement(code);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'code-copy';
        btn.textContent = '複製';
        btn.addEventListener('click', async () => {
          const text = code.textContent;
          let ok = false;
          try { await navigator.clipboard.writeText(text); ok = true; }
          catch (e) {                                  // fallback：execCommand（免 clipboard 權限/安全性限制）
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-9999px';
            document.body.appendChild(ta); ta.focus(); ta.select();
            try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
            document.body.removeChild(ta);
          }
          btn.textContent = ok ? '已複製' : '複製失敗';
          setTimeout(() => { btn.textContent = '複製'; }, 1200);
        });
        pre.appendChild(btn);
      });
    },

    // 對每張插圖：若這章有對照譯圖（figX-Y.<語言碼>.png，來自 /figs 清單）就加「譯圖／原圖」原地切換。
    // 副檔名用「目前語言資料夾名」推 → 切到哪個語言層就找那個語言的譯圖，永遠同步。
    enhanceFigures() {
      const root = this.$refs.viewer;
      if (!root || !this.transFigs.length || !this.lang) return;
      const suf = '.' + this.lang + '.png';
      root.querySelectorAll('img').forEach((img) => {
        if (img.dataset.figDone) return;
        const src = img.getAttribute('src') || '';
        const file = src.split('/').pop().split('?')[0];          // figX-Y.png
        if (!/\.png$/i.test(file)) return;
        const transFile = file.replace(/\.png$/i, suf);           // figX-Y.<lang>.png
        if (transFile === file || !this.transFigs.includes(transFile)) return;  // 這張沒譯圖 → 不動
        img.dataset.figDone = '1';
        this._mountFigToggle(img, src, src.replace(/\.png(\?|$)/i, suf + '$1'));
      });
    },
    _mountFigToggle(img, origSrc, transSrc) {
      if (!img.isConnected) return;
      const wrap = document.createElement('div');
      wrap.className = 'fig-compare';
      img.parentNode.insertBefore(wrap, img);
      const bar = document.createElement('div');
      bar.className = 'fig-toggle';
      const bO = document.createElement('button'); bO.type = 'button'; bO.textContent = '原圖';
      const bT = document.createElement('button'); bT.type = 'button'; bT.textContent = '譯圖';
      const hint = document.createElement('span'); hint.className = 'fig-hint';
      const setMode = (trans) => {
        img.src = trans ? transSrc : origSrc;
        bT.classList.toggle('active', trans);
        bO.classList.toggle('active', !trans);
        hint.textContent = trans ? 'AI 生成譯圖，可能與原圖有出入' : '書上原始截圖（點「譯圖」看 AI 翻譯版）';
      };
      bar.appendChild(bO); bar.appendChild(bT); bar.appendChild(hint);
      wrap.appendChild(bar);
      wrap.appendChild(img);          // 把 img 搬進 wrap（接在 bar 後面）
      bO.onclick = () => setMode(false);
      bT.onclick = () => setMode(true);
      setMode(false);                 // 預設顯示原裁切圖（忠實）；譯圖讓使用者自己點
    },

    _resetView() { this.lang = ''; this.fmt = ''; this.kind = 'text'; this._resetDoc(); },
    _resetDoc() { this.ch = ''; this.docHtml = ''; destroyMM(); },
  },
}).mount('#app');
