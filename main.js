// ==UserScript==
// @name        ChatGPT对话侧边导航栏 
// @namespace    http://tampermonkey.net/
// @version      9.1
// @description  ChatGPT 专用：侧边目录/书签/搜索/导出。性能：不再强引用消息节点（避免越聊越卡），新消息只“增量追加”列表，列表渲染限量，点击再定位滚动。
// @author       Realsbt
// @license      MIT
// @match        https://chatgpt.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (window.__AI_TOC_GPT_US__) return;
  window.__AI_TOC_GPT_US__ = true;

  const NS = 'gpt-us';
  const CFG = {
    symbol: 'US',
    minW: 200,
    maxW: 320,
    chatDefaultW: 960,
    chatWidths: [768, 960, 1120, 1280, 1440],
    len: 18,
    MAX_CACHE: 3000,     // 缓存上限（用于目录/搜索/复制目录）
    MAX_RENDER: 1200,    // 列表渲染上限（只渲染最近 N 条，避免 DOM 太大）
    IDLE_TIMEOUT: 800
  };

  const Utils = {
    debounce(fn, delay) {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
      };
    },
    storage: {
      get(key, def) {
        const k = `ai-toc-${NS}-${key}`;
        try {
          if (typeof GM_getValue !== 'undefined') return GM_getValue(k, def);
          const raw = localStorage.getItem(k);
          return raw ? JSON.parse(raw) : def;
        } catch {
          return def;
        }
      },
      set(key, val) {
        const k = `ai-toc-${NS}-${key}`;
        try {
          if (typeof GM_setValue !== 'undefined') return GM_setValue(k, val);
          localStorage.setItem(k, JSON.stringify(val));
        } catch {}
      }
    },
    toast(msg) {
      const div = document.createElement('div');
      div.style.cssText =
        'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.75);color:#fff;padding:8px 14px;border-radius:18px;z-index:10001;font-size:13px;backdrop-filter:blur(4px);pointer-events:none;transition:opacity .25s;';
      div.textContent = msg;
      document.body.appendChild(div);
      setTimeout(() => {
        div.style.opacity = '0';
        setTimeout(() => div.remove(), 260);
      }, 1400);
    },
    fastText(el) {
      const t = el && el.textContent ? el.textContent : '';
      return t.replace(/\s+\n/g, '\n').replace(/\n+/g, '\n').trim();
    },
    hash32(str) { // FNV-1a
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(36);
    },
    escSel(s) {
      if (window.CSS && CSS.escape) return CSS.escape(s);
      return String(s).replace(/["\\#.:()[\]=>~+*^$|]/g, '\\$&');
    }
  };

  class SideNavGPT {
    constructor() {
      this.themes = ['auto', 'pink', 'blue'];

      this.cache = {
        items: [],             // { key, kind, val, weak, hash, txt, lower, preview }
        keySet: new Set(),
        key2item: new Map(),
        node2key: new WeakMap(),
        autoInc: 1
      };

      this.state = {
        marks: new Set(Utils.storage.get('bookmarks', [])),
        isCollapsed: Utils.storage.get('collapsed', false),
        isWide: Utils.storage.get('wide', false),
        chatWidth: CFG.chatWidths.includes(Utils.storage.get('chatWidth', CFG.chatDefaultW))
          ? Utils.storage.get('chatWidth', CFG.chatDefaultW)
          : CFG.chatDefaultW,
        pos: Utils.storage.get('pos', { x: -1, y: 100 }),
        theme: Utils.storage.get('theme', 'auto'),
        keyword: '',
        reduceFx: Utils.storage.get('reduceFx', true),
        isDragging: false,
        offset: { x: 0, y: 0 }
      };

      this.dom = {};
      this.chatRoot = null;
      this.observer = null;

      this._dragRAF = 0;
      this._pendingXY = null;

      this._renderScheduled = false;
      this._renderedCount = 0;
    }

    init() {
      this.injectCSS();
      this.renderShell();
      this.bindEvents();
      this.hookHistory();
      this.resetForRoute();
    }

    getSelectors() {
      return 'div[data-message-author-role="user"]';
    }

    findChatRoot() {
      const main = document.querySelector('main');
      if (!main) return document.body;

      const anyMsg = main.querySelector('div[data-message-author-role]');
      if (anyMsg) {
        const near = anyMsg.closest('[role="log"]') || anyMsg.closest('section') || anyMsg.parentElement?.parentElement;
        return near || main;
      }
      return main;
    }

    normalizeChatWidth(width) {
      const n = Number(width);
      if (!Number.isFinite(n)) return CFG.chatDefaultW;
      let nearest = CFG.chatWidths[0];
      let minDelta = Math.abs(nearest - n);
      for (const candidate of CFG.chatWidths) {
        const delta = Math.abs(candidate - n);
        if (delta < minDelta) {
          nearest = candidate;
          minDelta = delta;
        }
      }
      return nearest;
    }

    findChatWidthTargets() {
      const main = document.querySelector('main');
      if (!main) return [];

      const direct = Array.from(main.querySelectorAll('[class*="l-thread-content-max-width-"]'));
      if (direct.length) return direct;

      const firstMessage = main.querySelector('div[data-message-author-role]');
      if (!firstMessage) return [];

      const targets = [];
      let current = firstMessage.parentElement;
      while (current && current !== main) {
        const className = String(current.className || '');
        const style = getComputedStyle(current);
        if (
          className.includes('max-w') ||
          (style.maxWidth && style.maxWidth !== 'none')
        ) {
          targets.push(current);
        }
        current = current.parentElement;
      }
      return targets;
    }

    applyChatWidth(width, persist = false) {
      const normalized = this.normalizeChatWidth(width);
      document.documentElement.style.setProperty('--ai-chat-width', `${normalized}px`);
      document.documentElement.style.setProperty('--thread-content-max-width', `${normalized}px`);

      const targets = this.findChatWidthTargets();
      targets.forEach((el) => {
        el.style.setProperty('--thread-content-max-width', `${normalized}px`, 'important');
        el.style.setProperty('width', `min(100%, ${normalized}px)`, 'important');
        el.style.setProperty('max-width', `min(${normalized}px, calc(100vw - 96px))`, 'important');
        el.style.setProperty('min-width', '0', 'important');
        el.style.setProperty('flex', '0 1 auto', 'important');
        el.style.setProperty('margin-left', 'auto', 'important');
        el.style.setProperty('margin-right', 'auto', 'important');

        const firstChild = el.firstElementChild;
        if (firstChild instanceof HTMLElement) {
          firstChild.style.setProperty('width', '100%', 'important');
          firstChild.style.setProperty('max-width', '100%', 'important');
          firstChild.style.setProperty('min-width', '0', 'important');
        }
      });

      this.state.chatWidth = normalized;
      if (this.dom.btnChatWidth) {
        this.dom.btnChatWidth.title = `主对话区宽度：${normalized}px`;
      }
      if (persist) Utils.storage.set('chatWidth', normalized);
    }

    injectCSS() {
      const css = `
html{ --ai-chat-width:${this.state.chatWidth}px; }
main [class*="l-thread-content-max-width-"]{
  width:min(100%, var(--ai-chat-width)) !important;
  max-width:min(var(--ai-chat-width), calc(100vw - 96px)) !important;
  min-width:0 !important;
  flex:0 1 auto !important;
  margin-left:auto !important;
  margin-right:auto !important;
}
main [class*="l-thread-content-max-width-"] > [class*="max-w-full"]{
  width:100% !important;
  max-width:100% !important;
  min-width:0 !important;
}
#ai-toc-us{
  --at-bg: rgba(255,255,255,.85); --at-bd:#e2e8f0; --at-txt:#334155;
  --at-h-bg:rgba(248,250,252,.6); --at-h-txt:#3b82f6; --at-act:#3b82f6; --at-shd:0 8px 32px rgba(0,0,0,.08);
  --at-s-off:#cbd5e1; --at-s-on:#f59e0b; --at-hover:rgba(0,0,0,.05);
}
@media (prefers-color-scheme: dark){
  #ai-toc-us{
    --at-bg: rgba(28,25,23,.85); --at-bd:#f59e0b; --at-txt:#fef3c7;
    --at-h-bg:rgba(28,25,23,.6); --at-h-txt:#f59e0b; --at-act:#d97706; --at-shd:0 8px 32px rgba(0,0,0,.42);
    --at-s-off:#57534e; --at-s-on:#f59e0b; --at-hover:rgba(255,255,255,.08);
  }
}
#ai-toc-us.theme-pink{
  --at-bg: rgba(255,245,247,.85)!important; --at-bd:#fbcfe8!important; --at-txt:#831843!important;
  --at-h-bg:rgba(252,231,243,.6)!important; --at-h-txt:#db2777!important; --at-act:#ec4899!important;
  --at-shd:0 8px 32px rgba(236,72,153,.24)!important; --at-s-off:#f9a8d4!important; --at-s-on:#be185d!important;
}
#ai-toc-us.theme-blue{
  --at-bg: rgba(240,249,255,.85)!important; --at-bd:#bae6fd!important; --at-txt:#0c4a6e!important;
  --at-h-bg:rgba(224,242,254,.6)!important; --at-h-txt:#0284c7!important; --at-act:#0ea5e9!important;
  --at-shd:0 8px 32px rgba(14,165,233,.22)!important; --at-s-off:#7dd3fc!important; --at-s-on:#0369a1!important;
}
#ai-toc-us.theme-green{
  --at-bg: rgba(240,253,244,.85)!important; --at-bd:#bbf7d0!important; --at-txt:#14532d!important;
  --at-h-bg:rgba(220,252,231,.6)!important; --at-h-txt:#16a34a!important; --at-act:#22c55e!important;
  --at-shd:0 8px 32px rgba(34,197,94,.22)!important; --at-s-off:#86efac!important; --at-s-on:#15803d!important;
}
#ai-toc-us.theme-purple{
  --at-bg: rgba(250,245,255,.85)!important; --at-bd:#e9d5ff!important; --at-txt:#581c87!important;
  --at-h-bg:rgba(243,232,255,.6)!important; --at-h-txt:#9333ea!important; --at-act:#a855f7!important;
  --at-shd:0 8px 32px rgba(168,85,247,.22)!important; --at-s-off:#d8b4fe!important; --at-s-on:#7e22ce!important;
}
#ai-toc-us.theme-orange{
  --at-bg: rgba(255,247,237,.85)!important; --at-bd:#fed7aa!important; --at-txt:#7c2d12!important;
  --at-h-bg:rgba(255,237,213,.6)!important; --at-h-txt:#ea580c!important; --at-act:#f97316!important;
  --at-shd:0 8px 32px rgba(249,115,22,.22)!important; --at-s-off:#fdba74!important; --at-s-on:#c2410c!important;
}
#ai-toc-us{
  position:fixed; z-index:9999; display:flex; flex-direction:column;
  background:var(--at-bg); border:1px solid var(--at-bd); color:var(--at-txt);
  border-radius:16px; box-shadow:var(--at-shd);
  font-family:system-ui,sans-serif; transition:width .2s, opacity .2s, background .2s;
  max-height:80vh;
  contain: content;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
#ai-toc-us.fx-off{ backdrop-filter:none !important; -webkit-backdrop-filter:none !important; box-shadow:none !important; }
#ai-head-us,#ai-foot-us{
  padding:10px 12px; cursor:move; display:flex; justify-content:space-between; align-items:center;
  flex-shrink:0; user-select:none;
}
#ai-head-us{ border-bottom:1px solid var(--at-bd); background:var(--at-h-bg); border-radius:16px 16px 0 0; }
#ai-foot-us{ border-top:1px solid var(--at-bd); border-radius:0 0 16px 16px; font-size:12px; }
.ai-title{ font-weight:700; font-size:16px; color:var(--at-h-txt); }
.ai-ctrls{ display:flex; gap:8px; align-items:center; }
.ai-btn{ cursor:pointer; opacity:.65; transition:.15s; font-size:14px; padding: 2px 6px; border-radius: 6px; }
.ai-btn:hover{ opacity:1; transform:scale(1.06); color:var(--at-act); background:var(--at-hover); }

#ai-search-us{
  margin:8px; padding:6px 12px; border:1px solid var(--at-bd); border-radius:8px;
  background:var(--at-hover); color:var(--at-txt); font-size:12px; outline:none; flex-shrink:0;
  transition: .2s;
}
#ai-search-us:focus{ border-color:var(--at-act); background:transparent; box-shadow: 0 0 0 2px rgba(59,130,246,.1); }

#ai-body-us{ flex:1; overflow-y:auto; padding:4px 0; scrollbar-width:thin; min-height:0; }
#ai-body-us::-webkit-scrollbar{ width:4px; }
#ai-body-us::-webkit-scrollbar-thumb{ background:var(--at-bd); border-radius: 4px; }

.ai-item{
  padding:6px 8px 6px 4px; cursor:pointer; display:flex; align-items:center;
  border-left:3px solid transparent; transition:.12s;
  margin: 2px 6px; border-radius: 6px;
}
.ai-item:hover{ background:var(--at-hover); border-left-color:var(--at-act); padding-left:8px; }
.ai-item.mark{ background:var(--at-hover); border-left-color:var(--at-s-on); font-weight:600; }
.ai-item.active{ background:var(--at-act); color:#fff; border-left-color:var(--at-act); padding-left:8px; }
.ai-item.active .ai-txt{ color:#fff; }
.ai-item.active .ai-star{ color:rgba(255,255,255,.7); }
.ai-item.active .ai-num{ color:rgba(255,255,255,.7); }
.ai-star{ width:22px; text-align:center; color:var(--at-s-off); font-size:12px; }
.ai-item.mark .ai-star{ color:var(--at-s-on); text-shadow:0 0 4px var(--at-s-on); }
.ai-txt{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; pointer-events:none; font-size:12px; }

.ai-wide{ width:${CFG.maxW}px !important; }
.ai-norm{ width:${CFG.minW}px !important; }
.ai-hide #ai-body-us,.ai-hide #ai-search-us,.ai-hide #ai-foot-us{ display:none; }
.ai-hide{ width:auto !important; height:auto !important; }
      `;
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    }

    renderShell() {
      const mk = (tag, cls, props = {}) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        for (const [k, v] of Object.entries(props)) el[k] = v;
        return el;
      };

      this.dom.root = mk('div', this.state.isWide ? 'ai-wide' : 'ai-norm', { id: 'ai-toc-us' });
      this.dom.root.style.zIndex = '10050';
      if (this.state.isCollapsed) this.dom.root.classList.add('ai-hide');
      if (this.state.theme !== 'auto') this.dom.root.classList.add('theme-' + this.state.theme);
      if (this.state.reduceFx) this.dom.root.classList.add('fx-off');

      const head = mk('div', '', { id: 'ai-head-us' });
      const title = mk('div', 'ai-title', { textContent: CFG.symbol });

      const ctrls = mk('div', 'ai-ctrls');
      const btnWide = mk('span', 'ai-btn', { textContent: '↔', title: '切换宽度' });
      this.dom.btnChatWidth = mk('span', 'ai-btn', { textContent: '宽', title: `主对话区宽度：${this.state.chatWidth}px` });
      this.dom.btnFold = mk('span', 'ai-btn', { textContent: this.state.isCollapsed ? '◀' : '▼', title: '折叠/展开' });

      ctrls.append(btnWide, this.dom.btnChatWidth, this.dom.btnFold);
      head.append(title, ctrls);

      this.dom.search = mk('input', '', { id: 'ai-search-us', placeholder: '搜索对话...', type: 'text' });
      this.dom.body = mk('div', '', { id: 'ai-body-us' });

      const foot = mk('div', '', { id: 'ai-foot-us' });
      const jumpCtrls = mk('div', 'ai-ctrls');
      const btnTop = mk('span', 'ai-btn', { textContent: '⬆', title: '顶部' });
      const btnBot = mk('span', 'ai-btn', { textContent: '⬇', title: '底部' });
      jumpCtrls.append(btnTop, btnBot);

      const exportBtn = mk('span', 'ai-btn', { textContent: '📋', title: '左键：复制目录\nShift+左键：导出完整对话' });
      foot.append(jumpCtrls, exportBtn);

      this.dom.root.append(head, this.dom.search, this.dom.body, foot);
      document.body.appendChild(this.dom.root);

      if (this.state.pos.x !== -1) {
        this.dom.root.style.left = this.state.pos.x + 'px';
        this.dom.root.style.top = this.state.pos.y + 'px';
        this.dom.root.style.right = 'auto';
      } else {
        this.dom.root.style.top = '100px';
        this.dom.root.style.right = '360px';
      }

      btnWide.onclick = () => this.toggleWidth();
      this.dom.btnChatWidth.onclick = () => this.cycleChatWidth();
      this.dom.btnFold.onclick = () => this.toggleCollapse();
      btnTop.onclick = () => this.dom.body.scrollTo({ top: 0, behavior: 'smooth' });
      btnBot.onclick = () => this.dom.body.scrollTo({ top: this.dom.body.scrollHeight, behavior: 'smooth' });
      exportBtn.onclick = (e) => this.handleExport(e);

      this.renderEmpty('等待对话...');
    }

    bindEvents() {
      this.dom.search.oninput = (e) => {
        this.state.keyword = (e.target.value || '').toLowerCase();
        this.renderListFull();
      };

      this.dom.body.addEventListener('click', (e) => {
        const star = e.target.closest('.ai-star');
        const itemEl = e.target.closest('.ai-item');
        if (!itemEl) return;

        const key = itemEl.dataset.key;
        if (!key) return;

        if (star) {
          if (this.state.marks.has(key)) {
            this.state.marks.delete(key);
            itemEl.classList.remove('mark');
          } else {
            this.state.marks.add(key);
            itemEl.classList.add('mark');
          }
          Utils.storage.set('bookmarks', Array.from(this.state.marks));
          return;
        }

        this.scrollToKey(key);
      });

      this.dom.body.addEventListener('contextmenu', (e) => {
        const itemEl = e.target.closest('.ai-item');
        if (!itemEl) return;
        e.preventDefault();
        const key = itemEl.dataset.key;
        const it = this.cache.key2item.get(key);
        if (!it) return;
        navigator.clipboard.writeText(it.txt || '').then(() => Utils.toast('已复制内容'));
      });

      const startDrag = (e) => {
        if (e.target.closest('.ai-btn') || e.target.closest('#ai-search-us')) return;
        this.state.isDragging = true;
        this.state.offset.x = e.clientX - this.dom.root.offsetLeft;
        this.state.offset.y = e.clientY - this.dom.root.offsetTop;
        e.currentTarget.style.cursor = 'grabbing';
      };

      const head = this.dom.root.querySelector('#ai-head-us');
      const foot = this.dom.root.querySelector('#ai-foot-us');
      head.onmousedown = startDrag;
      foot.onmousedown = startDrag;

      document.addEventListener('mousemove', (e) => {
        if (!this.state.isDragging) return;
        this._pendingXY = { x: e.clientX, y: e.clientY };
        if (this._dragRAF) return;

        this._dragRAF = requestAnimationFrame(() => {
          this._dragRAF = 0;
          const p = this._pendingXY;
          if (!p) return;
          this.dom.root.style.left = (p.x - this.state.offset.x) + 'px';
          this.dom.root.style.top = (p.y - this.state.offset.y) + 'px';
          this.dom.root.style.right = 'auto';
        });
      }, { passive: true });

      document.addEventListener('mouseup', () => {
        if (!this.state.isDragging) return;
        this.state.isDragging = false;
        head.style.cursor = 'move';
        foot.style.cursor = 'move';
        Utils.storage.set('pos', { x: this.dom.root.offsetLeft, y: this.dom.root.offsetTop });
      });
    }

    hookHistory() {
      const fire = () => window.dispatchEvent(new Event('ai-toc-us:route'));
      const _push = history.pushState;
      history.pushState = function () { _push.apply(this, arguments); fire(); };
      const _rep = history.replaceState;
      history.replaceState = function () { _rep.apply(this, arguments); fire(); };
      window.addEventListener('popstate', fire);

      window.addEventListener('ai-toc-us:route', Utils.debounce(() => {
        this.resetForRoute();
      }, 200));
    }

    resetForRoute() {
      this.detachObserver();
      this.cache.items = [];
      this.cache.keySet = new Set();
      this.cache.key2item = new Map();
      this.cache.node2key = new WeakMap();
      this.cache.autoInc = 1;
      this._renderedCount = 0;

      this.chatRoot = this.findChatRoot();
      this.attachObserver();
      this.fullRescan();
      this.applyChatWidth(this.state.chatWidth);
    }

    attachObserver() {
      const root = this.chatRoot || document.body;
      const selectors = this.getSelectors();

      const onMutations = (mutations) => {
        let anyNew = false;
        for (const m of mutations) {
          if (!m.addedNodes || m.addedNodes.length === 0) continue;

          for (const n of m.addedNodes) {
            if (!n || n.nodeType !== 1) continue;

            if (n.matches && n.matches(selectors)) {
              if (this.registerMessageNode(n)) anyNew = true;
              continue;
            }

            const found = n.querySelectorAll ? n.querySelectorAll(selectors) : null;
            if (found && found.length) {
              for (const fn of found) {
                if (this.registerMessageNode(fn)) anyNew = true;
              }
            }
          }
        }
        if (anyNew) {
          this.applyChatWidth(this.state.chatWidth);
          this.scheduleRender();
        }
      };

      this.observer = new MutationObserver(onMutations);
      this.observer.observe(root, { childList: true, subtree: true });
    }

    detachObserver() {
      if (this.observer) {
        try { this.observer.disconnect(); } catch {}
      }
      this.observer = null;
    }

    makeKeyAndAnchor(node, txt) {
      const wrap = node.closest('[data-message-id]') || node.closest('article') || node;
      const mid = wrap.getAttribute && wrap.getAttribute('data-message-id');
      if (mid) return { key: `mid:${mid}`, kind: 'mid', val: mid, weak: null };

      const wid = wrap.id;
      if (wid) return { key: `id:${wid}`, kind: 'id', val: wid, weak: null };

      const h = Utils.hash32(txt);
      const key = `h:${h}:${this.cache.autoInc++}`;
      const weak = (typeof WeakRef !== 'undefined') ? new WeakRef(wrap) : null;
      return { key, kind: 'weak', val: h, weak };
    }

    registerMessageNode(node) {
      if (this.cache.node2key.has(node)) return false;

      const txt = Utils.fastText(node);
      if (!txt) return false;

      let { key, kind, val, weak } = this.makeKeyAndAnchor(node, txt);

      if (this.cache.keySet.has(key)) {
        let k = 2;
        while (this.cache.keySet.has(`${key}-${k}`)) k++;
        key = `${key}-${k}`;
      }

      const lower = txt.toLowerCase();
      const preview = txt.length > CFG.len ? (txt.slice(0, CFG.len) + '..') : txt;

      const it = {
        key, kind, val, weak,
        hash: Utils.hash32(txt),
        txt, lower, preview
      };

      this.cache.items.push(it);
      this.cache.keySet.add(key);
      this.cache.key2item.set(key, it);
      this.cache.node2key.set(node, key);

      if (this.cache.items.length > CFG.MAX_CACHE) {
        const drop = this.cache.items.shift();
        if (drop) {
          this.cache.keySet.delete(drop.key);
          this.cache.key2item.delete(drop.key);
          if (this.state.marks.has(drop.key)) {
            this.state.marks.delete(drop.key);
            Utils.storage.set('bookmarks', Array.from(this.state.marks));
          }
          this._renderedCount = Math.max(0, this._renderedCount - 1);
        }
      }

      return true;
    }

    fullRescan() {
      const root = this.chatRoot || this.findChatRoot();
      const nodes = root ? Array.from(root.querySelectorAll(this.getSelectors())) : [];
      for (const n of nodes) this.registerMessageNode(n);
      this.renderListFull();
    }

    renderEmpty(text) {
      this.dom.body.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'ai-txt';
      empty.style.cssText = 'padding:10px;text-align:center;opacity:.8;';
      empty.textContent = text;
      this.dom.body.appendChild(empty);
      this._renderedCount = this.cache.items.length;
    }

    buildItemEl(it) {
      const item = document.createElement('div');
      item.className = 'ai-item' + (this.state.marks.has(it.key) ? ' mark' : '');
      item.title = it.txt;
      item.dataset.key = it.key;

      const star = document.createElement('span');
      star.className = 'ai-star';
      star.textContent = '★';

      const label = document.createElement('span');
      label.className = 'ai-txt';
      label.textContent = it.preview;

      item.append(star, label);
      return item;
    }

    renderListFull() {
      const kw = this.state.keyword;
      const items = this.cache.items;

      if (!items.length) {
        this.renderEmpty('等待对话...');
        return;
      }

      this.dom.body.textContent = '';

      const frag = document.createDocumentFragment();
      const start = Math.max(0, items.length - CFG.MAX_RENDER);
      let shown = 0;

      for (let i = start; i < items.length; i++) {
        const it = items[i];
        if (kw && !it.lower.includes(kw)) continue;
        frag.appendChild(this.buildItemEl(it));
        shown++;
      }

      if (!shown) {
        this.renderEmpty(kw ? '未匹配到内容' : '等待对话...');
        return;
      }

      this.dom.body.appendChild(frag);
      this._renderedCount = items.length;
    }

    appendNewItems() {
      const items = this.cache.items;
      if (!items.length) return;

      if (this.state.keyword) {
        this.renderListFull();
        return;
      }

      const firstIsEmpty = this.dom.body.firstElementChild && this.dom.body.firstElementChild.classList.contains('ai-txt');
      if (firstIsEmpty) this.dom.body.textContent = '';

      const frag = document.createDocumentFragment();

      for (let i = this._renderedCount; i < items.length; i++) {
        frag.appendChild(this.buildItemEl(items[i]));
      }

      if (frag.childNodes.length) {
        this.dom.body.appendChild(frag);
      }

      this._renderedCount = items.length;

      const children = this.dom.body.children;
      const overflow = children.length - CFG.MAX_RENDER;
      if (overflow > 0) {
        for (let i = 0; i < overflow; i++) {
          if (this.dom.body.firstElementChild) this.dom.body.removeChild(this.dom.body.firstElementChild);
        }
      }
    }

    scheduleRender() {
      if (this._renderScheduled) return;
      this._renderScheduled = true;

      const run = () => {
        this._renderScheduled = false;
        this.appendNewItems();
      };

      if ('requestIdleCallback' in window) {
        requestIdleCallback(run, { timeout: CFG.IDLE_TIMEOUT });
      } else {
        setTimeout(run, 120);
      }
    }

    scrollToKey(key) {
      const it = this.cache.key2item.get(key);
      if (!it) return;

      let target = null;

      if (it.kind === 'mid') {
        target = document.querySelector(`[data-message-id="${Utils.escSel(it.val)}"]`);
      } else if (it.kind === 'id') {
        target = document.getElementById(it.val);
      } else if (it.weak && it.weak.deref) {
        target = it.weak.deref();
      }

      if (!target) {
        const root = this.chatRoot || document.querySelector('main') || document.body;
        const nodes = root.querySelectorAll(this.getSelectors());
        for (const n of nodes) {
          const t = Utils.fastText(n);
          if (!t) continue;
          if (Utils.hash32(t) === it.hash) { target = n; break; }
        }
      }

      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    toggleCollapse() {
      this.state.isCollapsed = !this.state.isCollapsed;
      this.dom.root.classList.toggle('ai-hide');
      this.dom.btnFold.textContent = this.state.isCollapsed ? '◀' : '▼';
      Utils.storage.set('collapsed', this.state.isCollapsed);
    }

    toggleWidth() {
      this.state.isWide = !this.state.isWide;
      this.dom.root.classList.toggle('ai-wide', this.state.isWide);
      this.dom.root.classList.toggle('ai-norm', !this.state.isWide);
      Utils.storage.set('wide', this.state.isWide);
    }

    cycleChatWidth() {
      const currentIndex = CFG.chatWidths.indexOf(this.state.chatWidth);
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % CFG.chatWidths.length;
      const nextWidth = CFG.chatWidths[nextIndex];
      this.applyChatWidth(nextWidth, true);
      Utils.toast(`主对话区宽度 ${nextWidth}px`);
    }

    handleExport(e) {
      e.stopPropagation();
      if (e.shiftKey) {
        const log = this.getChatLog();
        if (!log) return Utils.toast('未检测到有效对话');
        navigator.clipboard.writeText(log).then(() => Utils.toast('✅ 完整对话已复制'));
      } else {
        const kw = this.state.keyword;
        const list = this.cache.items
          .filter(x => !kw || x.lower.includes(kw))
          .map(x => x.txt)
          .join('\n');
        navigator.clipboard.writeText(list || '').then(() => Utils.toast('✅ 目录已复制'));
      }
    }

    getChatLog() {
      const root = this.chatRoot || document.querySelector('main') || document.body;
      const blocks = root.querySelectorAll('div[data-message-author-role]');
      if (!blocks.length) return null;

      const log = [`=== 导出对话 (${new Date().toLocaleString()}) ===\n`];
      blocks.forEach((b) => {
        const role = b.getAttribute('data-message-author-role');
        const t = Utils.fastText(b);
        if (!t) return;
        log.push(`${role === 'user' ? '【User】' : '【AI】'}\n${t}\n-------------------`);
      });
      return log.join('\n\n');
    }
  }

  const app = new SideNavGPT();
  const boot = () => {
    console.info('[AI TOC US] boot', { href: location.href, readyState: document.readyState });
    app.init();
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else window.addEventListener('DOMContentLoaded', boot, { once: true });
})();
