(function () {
  'use strict';
  if (window.__AI_TOC_GPT__) return;
  window.__AI_TOC_GPT__ = true;

  const NS = 'gpt';
  const { normalizeLanguage, detectDefaultLanguage, t } = window.AI_TOC_I18N;
  const CFG = {
    minW: 188,
    chatMinW: 720,
    chatMaxW: 1440,
    chatDefaultW: 960,
    len: 18,
    MAX_CACHE: 3000,
    MAX_RENDER: 1200,
    IDLE_TIMEOUT: 800
  };

  const STORAGE_KEYS = ['bookmarks', 'manualBookmarks', 'collapsed', 'pos', 'theme', 'reduceFx', 'enabled', 'chatWidth', 'language'];
  const STORAGE_DEFAULTS = {
    bookmarks: [],
    manualBookmarks: [],
    collapsed: false,
    pos: { x: -1, y: 100 },
    theme: 'dark',
    reduceFx: true,
    enabled: true,
    chatWidth: CFG.chatDefaultW,
    language: detectDefaultLanguage()
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
      getAll() {
        const prefixed = {};
        for (const k of STORAGE_KEYS) {
          prefixed[`ai-toc-${NS}-${k}`] = STORAGE_DEFAULTS[k];
        }
        return new Promise((resolve) => {
          chrome.storage.local.get(prefixed, (result) => {
            const out = {};
            for (const k of STORAGE_KEYS) {
              out[k] = result[`ai-toc-${NS}-${k}`];
            }
            resolve(out);
          });
        });
      },
      set(key, val) {
        chrome.storage.local.set({ [`ai-toc-${NS}-${key}`]: val });
      }
    },
    resolveThemeClass() {
      const root = document.getElementById('ai-toc');
      if (root && root.classList.contains('theme-light')) return 'theme-light';
      return 'theme-dark';
    },
    toast(msg) {
      const div = document.createElement('div');
      div.className = `ai-toast ${Utils.resolveThemeClass()}`;
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
    hash32(str) {
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
    constructor(stored) {
      this.themes = ['light', 'dark'];

      this.cache = {
        items: [],
        keySet: new Set(),
        key2item: new Map(),
        node2key: new WeakMap(),
        autoInc: 1
      };

      this.state = {
        enabled: stored.enabled,
        marks: new Set((stored.bookmarks || []).map((value) => this.normalizeStoredBookmarkId(value)).filter(Boolean)),
        manualMarks: new Set((stored.manualBookmarks || []).map((value) => this.normalizeStoredBookmarkId(value)).filter(Boolean)),
        isCollapsed: stored.collapsed,
        pos: stored.pos,
        theme: this.normalizeTheme(stored.theme),
        language: this.normalizeLanguage(stored.language),
        activeKey: '',
        keyword: '',
        chatWidth: this.normalizeChatWidth(stored.chatWidth),
        reduceFx: stored.reduceFx,
        isDragging: false,
        offset: { x: 0, y: 0 }
      };

      if (stored.theme !== this.state.theme) {
        Utils.storage.set('theme', this.state.theme);
      }
      if (stored.language !== this.state.language) {
        Utils.storage.set('language', this.state.language);
      }
      if (stored.chatWidth !== this.state.chatWidth) {
        Utils.storage.set('chatWidth', this.state.chatWidth);
      }

      this.dom = {};
      this.chatRoot = null;
      this.observer = null;
      this.layoutObserver = null;
      this.chatWidthTargets = [];

      this._dragRAF = 0;
      this._pendingXY = null;

      this._renderScheduled = false;
      this._timelineRefreshScheduled = false;
      this._renderedCount = 0;
    }

    normalizeTheme(theme) {
      return theme === 'light' ? 'light' : 'dark';
    }

    normalizeLanguage(language) {
      return normalizeLanguage(language);
    }

    t(key, params) {
      return t(this.state.language, key, params);
    }

    normalizeStoredBookmarkId(value) {
      if (typeof value !== 'string') return '';
      if (value.startsWith('mid:') || value.startsWith('id:') || value.startsWith('hash:')) return value;
      if (value.startsWith('h:')) {
        const parts = value.split(':');
        if (parts[1]) return `hash:${parts[1]}`;
      }
      return value;
    }

    normalizeChatWidth(width) {
      const n = Number(width);
      if (!Number.isFinite(n)) return CFG.chatDefaultW;
      return Math.max(CFG.chatMinW, Math.min(CFG.chatMaxW, Math.round(n)));
    }

    applyTheme(theme) {
      const normalizedTheme = this.normalizeTheme(theme);
      const applyTo = (el) => {
        if (!el) return;
        Array.from(el.classList).forEach((className) => {
          if (className.startsWith('theme-')) el.classList.remove(className);
        });
        el.classList.add('theme-' + normalizedTheme);
      };

      applyTo(this.dom.root);
      applyTo(this.dom.timeline);
      this.state.theme = normalizedTheme;
      return normalizedTheme;
    }

    updateLocalizedUI() {
      if (this.dom.root) this.dom.root.lang = this.state.language;
      if (this.dom.timeline) this.dom.timeline.lang = this.state.language;

      if (this.dom.head) {
        const title = this.t('content_drag_sidebar');
        this.dom.head.title = title;
        this.dom.head.setAttribute('aria-label', title);
      }

      if (this.dom.search) {
        const placeholder = this.t('content_search_placeholder');
        this.dom.search.placeholder = placeholder;
        this.dom.search.setAttribute('aria-label', placeholder);
      }

      if (this.dom.btnTop) this.setButtonIcon(this.dom.btnTop, 'top', this.t('content_scroll_top'));
      if (this.dom.btnBot) this.setButtonIcon(this.dom.btnBot, 'bottom', this.t('content_scroll_bottom'));
      if (this.dom.exportBtn) this.setButtonIcon(this.dom.exportBtn, 'copy', this.t('content_export_hint'));
      this.syncInlineBookmarkButtons();

      this.updateActionButtons();
    }

    setLanguage(language, persist = false) {
      const normalizedLanguage = this.normalizeLanguage(language);
      this.state.language = normalizedLanguage;
      this.updateLocalizedUI();
      this.renderListFull();
      if (persist) {
        Utils.storage.set('language', normalizedLanguage);
      }
      return normalizedLanguage;
    }

    getActionIcon(name) {
      const icons = {
        top: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12V4"/><path d="M5.25 6.75 8 4l2.75 2.75"/><path d="M4 13h8"/></svg>',
        bottom: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4v8"/><path d="M5.25 9.25 8 12l2.75-2.75"/><path d="M4 3h8"/></svg>',
        wide: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 5 3 8l3 3"/><path d="M10 5l3 3-3 3"/><path d="M3 8h10"/></svg>',
        narrow: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8h4"/><path d="M10.5 8h4"/><path d="M7 5 4 8l3 3"/><path d="M9 5l3 3-3 3"/></svg>',
        collapse: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>',
        expand: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>',
        copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="4" width="7" height="8" rx="1.5"/><path d="M4 10H3.5A1.5 1.5 0 0 1 2 8.5v-5A1.5 1.5 0 0 1 3.5 2H9"/></svg>'
      };
      return icons[name] || '';
    }

    setButtonIcon(button, iconName, title) {
      if (!button) return;
      button.innerHTML = this.getActionIcon(iconName);
      if (title) {
        button.title = title;
        button.setAttribute('aria-label', title);
      }
    }

    makeTimelineTitle(it) {
      const parts = [
        it.role === 'assistant'
          ? this.t('content_timeline_ai_bookmark')
          : this.t('content_timeline_entry', { index: it.idx })
      ];
      if (this.state.marks.has(it.bookmarkId)) parts.push(this.t('content_bookmarked'));
      if (it.preview) parts.push(it.preview);
      return parts.join('\n');
    }

    setActiveKey(key) {
      this.state.activeKey = key || '';
      this.syncActiveStates();
    }

    syncActiveStates() {
      if (this.dom.body) {
        this.dom.body.querySelectorAll('.ai-item.active').forEach((el) => el.classList.remove('active'));
        if (this.state.activeKey) {
          const activeItem = this.dom.body.querySelector(`.ai-item[data-key="${Utils.escSel(this.state.activeKey)}"]`);
          if (activeItem) activeItem.classList.add('active');
        }
      }

      if (this.dom.timelineTrack) {
        this.dom.timelineTrack.querySelectorAll('.ai-timeline-node.active').forEach((el) => el.classList.remove('active'));
        if (this.state.activeKey) {
          const activeNode = this.dom.timelineTrack.querySelector(`.ai-timeline-node[data-key="${Utils.escSel(this.state.activeKey)}"]`);
          if (activeNode) activeNode.classList.add('active');
        }
      }
    }

    buildTimelineNode(it) {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'ai-timeline-node';
      if (this.state.marks.has(it.bookmarkId)) node.classList.add('bookmark');
      if (this.state.activeKey === it.key) node.classList.add('active');
      node.dataset.key = it.key;
      node.title = this.makeTimelineTitle(it);
      node.setAttribute('aria-label', this.makeTimelineTitle(it));
      return node;
    }

    renderTimeline() {
      if (!this.dom.timelineTrack || !this.dom.timeline) return;

      this.syncTimelinePosition();
      this.dom.timelineTrack.textContent = '';

      if (!this.cache.items.length) {
        return;
      }

      const items = this.cache.items.slice(Math.max(0, this.cache.items.length - CFG.MAX_RENDER));
      const metrics = this.measureTimelineMetrics(items);
      const trackHeight = this.dom.timelineTrack.clientHeight || Math.max(120, window.innerHeight - 180);
      const frag = document.createDocumentFragment();
      for (let i = 0; i < items.length; i++) {
        const node = this.buildTimelineNode(items[i]);
        const top = Math.max(6, Math.min(trackHeight - 6, metrics[i] * trackHeight));
        node.style.top = `${top}px`;
        frag.appendChild(node);
      }

      this.dom.timelineTrack.appendChild(frag);
    }

    measureTimelineMetrics(items) {
      if (!items.length) return [];

      const root = this.chatRoot || this.findChatRoot() || document.body;
      const allBlocks = root ? Array.from(root.querySelectorAll('div[data-message-author-role]')) : [];

      let contextTop = 0;
      let contextBottom = 0;

      if (allBlocks.length) {
        const firstRect = allBlocks[0].getBoundingClientRect();
        const lastRect = allBlocks[allBlocks.length - 1].getBoundingClientRect();
        contextTop = firstRect.top + window.scrollY;
        contextBottom = lastRect.bottom + window.scrollY;
      }

      const total = Math.max(1, contextBottom - contextTop);

      return items.map((it, index) => {
        const fallback = items.length === 1 ? 0.5 : index / Math.max(1, items.length - 1);
        const target = this.getItemTargetNode(it);
        if (!target) return fallback;

        const rect = target.getBoundingClientRect();
        const center = rect.top + window.scrollY + rect.height / 2;
        if (total <= 1) return fallback;
        return Math.max(0, Math.min(1, (center - contextTop) / total));
      });
    }

    syncTimelinePosition() {
      const rail = this.dom.timeline;
      const root = this.dom.root;
      if (!rail || !root || !root.parentElement) return;

      const shouldShow =
        root.style.display !== 'none' &&
        this.cache.items.length > 0;

      if (!shouldShow) {
        rail.style.display = 'none';
        return;
      }

      rail.style.display = '';
    }

    getClassNameText(el) {
      if (!el) return '';
      if (typeof el.className === 'string') return el.className;
      if (el.className && typeof el.className.baseVal === 'string') return el.className.baseVal;
      return String(el.className || '');
    }

    isChatWidthCandidate(el, mainRect) {
      if (!(el instanceof HTMLElement)) return false;

      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;

      const style = window.getComputedStyle(el);
      const className = this.getClassNameText(el);
      const hasMaxWidth = !!style.maxWidth && style.maxWidth !== 'none' && style.maxWidth !== 'max-content';
      const hasWidthHint =
        /\bmax-w-[^\s]+\b/.test(className) ||
        className.includes('max-w[') ||
        /\bmx-auto\b/.test(className) ||
        /\bw-full\b/.test(className) ||
        /\bself-center\b/.test(className);

      const mainCenter = mainRect.left + mainRect.width / 2;
      const rectCenter = rect.left + rect.width / 2;
      const centered = Math.abs(rectCenter - mainCenter) <= 40;
      const widthDelta = mainRect.width - rect.width;
      const looksConstrained =
        widthDelta >= 32 &&
        rect.width >= Math.min(320, mainRect.width * 0.35);

      return hasMaxWidth || (centered && looksConstrained) || (hasWidthHint && centered);
    }

    findChatWidthTargets() {
      const main = document.querySelector('main');
      const messages = main ? Array.from(main.querySelectorAll('div[data-message-author-role]')).slice(0, 8) : [];
      if (!main || !messages.length) return [];

      const directTargets = Array.from(main.querySelectorAll('[class*="l-thread-content-max-width-"]'))
        .filter((el) => el instanceof HTMLElement);
      const mainRect = main.getBoundingClientRect();
      const mergedTargets = [];
      const pushTarget = (el) => {
        if (!el || el === main || !(el instanceof HTMLElement) || mergedTargets.includes(el)) return;
        mergedTargets.push(el);
      };

      directTargets.forEach(pushTarget);

      messages.forEach((message) => {
        let current = message;
        let depth = 0;
        while (current && current !== main && depth < 10) {
          if (current instanceof HTMLElement) {
            const rect = current.getBoundingClientRect();
            const style = window.getComputedStyle(current);
            const isNarrowerThanMain = rect.width > 0 && rect.width <= mainRect.width - 24;
            const hasWidthConstraint = style.maxWidth !== 'none' || style.width !== 'auto';
            if (isNarrowerThanMain || hasWidthConstraint) {
              pushTarget(current);
            }
          }
          current = current.parentElement;
          depth++;
        }
      });

      if (mergedTargets.length) {
        return mergedTargets;
      }

      const counts = new Map();
      const scored = new Map();

      const bumpScore = (el, score) => {
        if (!el || el === main || !(el instanceof HTMLElement)) return;
        const prev = scored.get(el) || 0;
        if (score > prev) scored.set(el, score);
      };

      const chains = messages.map((message) => {
        const chain = [];
        let current = message;
        while (current && current !== main) {
          if (current instanceof HTMLElement) {
            chain.push(current);
            counts.set(current, (counts.get(current) || 0) + 1);
          }
          current = current.parentElement;
        }
        return chain;
      });

      chains.forEach((chain) => {
        chain.forEach((el) => {
          if (!this.isChatWidthCandidate(el, mainRect)) return;

          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const widthDelta = mainRect.width - rect.width;
          const count = counts.get(el) || 0;
          let score = 0;

          if (count >= 2) score += 6;
          if (style.maxWidth && style.maxWidth !== 'none') score += 3;
          if (widthDelta >= 64) score += 2;
          if (widthDelta >= 120) score += 2;

          bumpScore(el, score);
        });
      });

      const firstMessage = messages[0];
      bumpScore(firstMessage?.closest('article'), 8);
      bumpScore(firstMessage?.closest('[role="log"]'), 7);
      bumpScore(firstMessage?.closest('section'), 5);

      const targets = Array.from(scored.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([el]) => el)
        .slice(0, 16);

      return targets;
    }

    getLiveChatWidthTargets() {
      const targets = (this.chatWidthTargets || []).filter((el) => el instanceof HTMLElement && el.isConnected);
      return targets.length ? targets : this.findChatWidthTargets();
    }

    applyChatWidth(width, persist = false, source = 'unknown') {
      const normalizedWidth = this.normalizeChatWidth(width);
      document.documentElement.style.setProperty('--ai-toc-chat-width', `${normalizedWidth}px`);
      document.documentElement.style.setProperty('--thread-content-max-width', `${normalizedWidth}px`);
      const shouldReuseTargets =
        source === 'preview-chat-width' ||
        source === 'message:set-chat-width' ||
        source === 'storage:onChanged';
      const targets = shouldReuseTargets ? this.getLiveChatWidthTargets() : this.findChatWidthTargets();
      const prevTargets = this.chatWidthTargets || [];

      prevTargets.forEach((el) => {
        if (!targets.includes(el)) {
          el.style.removeProperty('--thread-content-max-width');
          el.style.removeProperty('max-width');
          el.style.removeProperty('width');
          el.style.removeProperty('min-width');
          el.style.removeProperty('flex-basis');
          el.style.removeProperty('margin-left');
          el.style.removeProperty('margin-right');
          const firstChild = el.firstElementChild;
          if (firstChild instanceof HTMLElement) {
            firstChild.style.removeProperty('width');
            firstChild.style.removeProperty('max-width');
            firstChild.style.removeProperty('min-width');
          }
        }
      });

      targets.forEach((el) => {
        el.style.setProperty('--thread-content-max-width', `${normalizedWidth}px`, 'important');
        el.style.setProperty('max-width', `${normalizedWidth}px`, 'important');
        el.style.setProperty('width', `min(100%, ${normalizedWidth}px)`, 'important');
        el.style.setProperty('min-width', '0', 'important');
        el.style.setProperty('flex', '0 0 auto', 'important');
        el.style.setProperty('flex-basis', 'auto', 'important');
        el.style.setProperty('align-self', 'stretch', 'important');
        el.style.setProperty('margin-left', 'auto', 'important');
        el.style.setProperty('margin-right', 'auto', 'important');

        const firstChild = el.firstElementChild;
        if (firstChild instanceof HTMLElement) {
          firstChild.style.setProperty('width', '100%', 'important');
          firstChild.style.setProperty('max-width', '100%', 'important');
          firstChild.style.setProperty('min-width', '0', 'important');
        }

        const innerTargets = el.querySelectorAll('[class*="text-message"], .text-message, [data-message-author-role], [class*="max-w-full"]');
        innerTargets.forEach((inner) => {
          if (!(inner instanceof HTMLElement)) return;
          inner.style.setProperty('width', '100%', 'important');
          inner.style.setProperty('max-width', '100%', 'important');
          inner.style.setProperty('min-width', '0', 'important');
        });
      });

      this.chatWidthTargets = targets;
      this.state.chatWidth = normalizedWidth;
      const appliedWidth = targets.length
        ? Math.round(Math.max(...targets.map((el) => el.getBoundingClientRect().width)))
        : 0;

      const isUserTriggered =
        source === 'message:set-chat-width' ||
        source === 'storage:onChanged';

      if (isUserTriggered) {
        if (targets.length) {
          this.flashChatWidthTargets(targets);
          if (appliedWidth > 0 && appliedWidth < normalizedWidth - 12) {
            Utils.toast(this.t('content_chat_width_limited', { width: appliedWidth }));
          } else {
            Utils.toast(this.t('content_chat_width_applied', { width: normalizedWidth }));
          }
        } else {
          Utils.toast(this.t('content_chat_width_missing'));
        }
      }

      if (source !== 'observer:anyNew' && source !== 'observer:layoutRefresh') {
        console.info('[AI TOC] applyChatWidth', {
          source,
          width: normalizedWidth,
          targetCount: targets.length,
          targets: targets.slice(0, 5).map((el) => ({
            tag: el.tagName,
            className: this.getClassNameText(el).slice(0, 160),
            width: Math.round(el.getBoundingClientRect().width),
            maxWidth: window.getComputedStyle(el).maxWidth
          }))
        });
      }

      if (persist) {
        Utils.storage.set('chatWidth', normalizedWidth);
      }

      return {
        requestedWidth: normalizedWidth,
        appliedWidth,
        targetCount: targets.length
      };
    }

    applySidebarWidth() {
      if (this.dom.root) {
        this.dom.root.style.width = CFG.minW + 'px';
      }

      this.updateActionButtons();
    }

    flashChatWidthTargets(targets) {
      targets.forEach((el) => {
        el.style.setProperty('outline', '2px dashed #10a37f', 'important');
        el.style.setProperty('outline-offset', '4px', 'important');
      });

      window.setTimeout(() => {
        targets.forEach((el) => {
          el.style.removeProperty('outline');
          el.style.removeProperty('outline-offset');
        });
      }, 900);
    }

    scheduleTimelineRefresh() {
      if (this._timelineRefreshScheduled) return;
      this._timelineRefreshScheduled = true;
      requestAnimationFrame(() => {
        this._timelineRefreshScheduled = false;
        this.renderTimeline();
      });
    }

    updateActionButtons() {
      if (this.dom.btnFold) {
        this.setButtonIcon(
          this.dom.btnFold,
          this.state.isCollapsed ? 'collapse' : 'expand',
          this.state.isCollapsed ? this.t('content_action_expand') : this.t('content_action_collapse')
        );
      }
    }

    init() {
      this.renderShell();
      this.bindEvents();
      this.hookHistory();
      this.resetForRoute();
    }

    getSelectors() {
      return 'div[data-message-author-role="user"]';
    }

    getAllMessageNodes(role) {
      const root = this.chatRoot || this.findChatRoot();
      const nodes = root ? Array.from(root.querySelectorAll('div[data-message-author-role]')) : [];
      if (!role) return nodes;
      return nodes.filter((node) => node.getAttribute('data-message-author-role') === role);
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


    renderShell() {
      const mk = (tag, cls, props = {}) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        for (const [k, v] of Object.entries(props)) el[k] = v;
        return el;
      };

      this.dom.root = mk('div', '', { id: 'ai-toc' });
      if (this.state.isCollapsed) this.dom.root.classList.add('ai-hide');
      if (this.state.reduceFx) this.dom.root.classList.add('fx-off');
      this.dom.timeline = mk('div', '', { id: 'ai-timeline' });
      this.dom.timelineTrack = mk('div', '', { id: 'ai-timeline-track' });
      if (this.state.reduceFx) this.dom.timeline.classList.add('fx-off');
      this.dom.timeline.append(this.dom.timelineTrack);
      this.applyTheme(this.state.theme);

      this.dom.head = mk('div', '', { id: 'ai-head' });
      this.dom.head.append(mk('span', 'ai-grip'));

      this.dom.search = mk('input', '', { id: 'ai-search', type: 'text' });
      this.dom.body = mk('div', '', { id: 'ai-body' });

      const foot = mk('div', '', { id: 'ai-foot' });
      const controls = mk('div', 'ai-controls');
      const actions = mk('div', 'ai-actions ai-actions-four');
      this.dom.btnTop = mk('button', 'ai-btn', { type: 'button' });
      this.dom.btnBot = mk('button', 'ai-btn', { type: 'button' });
      this.dom.btnFold = mk('button', 'ai-btn', { type: 'button' });
      this.dom.exportBtn = mk('button', 'ai-btn', { type: 'button' });
      this.updateLocalizedUI();

      actions.append(this.dom.btnTop, this.dom.btnBot, this.dom.btnFold, this.dom.exportBtn);
      controls.append(this.dom.search, actions);
      foot.append(controls);

      this.dom.root.append(this.dom.head, this.dom.body, foot);
      document.body.appendChild(this.dom.root);
      document.body.appendChild(this.dom.timeline);
      this.applySidebarWidth();

      const clampX = (x) => Math.max(0, Math.min(x, window.innerWidth - 60));
      const clampY = (y) => Math.max(0, Math.min(y, window.innerHeight - 40));

      if (this.state.pos.x !== -1) {
        this.dom.root.style.left = clampX(this.state.pos.x) + 'px';
        this.dom.root.style.top = clampY(this.state.pos.y) + 'px';
        this.dom.root.style.right = 'auto';
      } else {
        this.dom.root.style.top = '100px';
        this.dom.root.style.right = '20px';
      }

      this.dom.btnFold.onclick = () => this.toggleCollapse();
      this.dom.btnTop.onclick = () => this.scrollSidebarOrPage('top');
      this.dom.btnBot.onclick = () => this.scrollSidebarOrPage('bottom');
      this.dom.exportBtn.onclick = (e) => this.handleExport(e);

      this.renderEmpty(this.t('content_waiting'));
      this.syncTimelinePosition();
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
        const it = this.cache.key2item.get(key);
        if (!it) return;

        if (star) {
          if (this.state.marks.has(it.bookmarkId)) {
            this.state.marks.delete(it.bookmarkId);
            if (it.role !== 'user') {
              this.state.manualMarks.delete(it.bookmarkId);
              this.removeItemByBookmarkId(it.bookmarkId);
            }
          } else {
            this.state.marks.add(it.bookmarkId);
            if (it.role !== 'user') {
              this.state.manualMarks.add(it.bookmarkId);
            }
          }
          this.persistMarks();
          this.syncInlineBookmarkButtons();
          this.renderListFull();
          this.renderTimeline();
          return;
        }

        this.setActiveKey(key);
        this.scrollToKey(key);
      });

      this.dom.body.addEventListener('contextmenu', (e) => {
        const itemEl = e.target.closest('.ai-item');
        if (!itemEl) return;
        e.preventDefault();
        const key = itemEl.dataset.key;
        const it = this.cache.key2item.get(key);
        if (!it) return;
        navigator.clipboard.writeText(it.txt || '')
          .then(() => Utils.toast(this.t('content_copied')))
          .catch(() => Utils.toast(this.t('content_copy_failed')));
      });

      this.dom.timeline.addEventListener('click', (e) => {
        const node = e.target.closest('.ai-timeline-node');
        if (!node) return;
        const key = node.dataset.key;
        if (!key) return;
        this.setActiveKey(key);
        this.scrollToKey(key);
      });

      const startDrag = (e) => {
        if (e.target.closest('.ai-btn') || e.target.closest('#ai-search')) return;
        this.state.isDragging = true;
        this.state.offset.x = e.clientX - this.dom.root.offsetLeft;
        this.state.offset.y = e.clientY - this.dom.root.offsetTop;
        e.currentTarget.style.cursor = 'grabbing';
      };

      const head = this.dom.head;
      const foot = this.dom.root.querySelector('#ai-foot');
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
          const x = Math.max(0, Math.min(p.x - this.state.offset.x, window.innerWidth - 60));
          const y = Math.max(0, Math.min(p.y - this.state.offset.y, window.innerHeight - 40));
          this.dom.root.style.left = x + 'px';
          this.dom.root.style.top = y + 'px';
          this.dom.root.style.right = 'auto';
          this.syncTimelinePosition();
        });
      }, { passive: true });

      document.addEventListener('mouseup', () => {
        if (!this.state.isDragging) return;
        this.state.isDragging = false;
        head.style.cursor = 'move';
        foot.style.cursor = 'move';
        Utils.storage.set('pos', { x: this.dom.root.offsetLeft, y: this.dom.root.offsetTop });
      });

      window.addEventListener('resize', Utils.debounce(() => this.renderTimeline(), 60), { passive: true });

      document.addEventListener('keydown', (e) => {
        // Ctrl+Shift+F: 聚焦搜索框并展开侧边栏
        if (e.ctrlKey && e.shiftKey && e.key === 'F') {
          e.preventDefault();
          if (this.state.isCollapsed) this.toggleCollapse();
          this.dom.search.focus();
          return;
        }
        // Escape: 搜索框有内容时清空，无内容时失焦
        if (e.key === 'Escape' && document.activeElement === this.dom.search) {
          e.preventDefault();
          if (this.dom.search.value) {
            this.dom.search.value = '';
            this.state.keyword = '';
            this.renderListFull();
          } else {
            this.dom.search.blur();
          }
        }
      });
    }

    hookHistory() {
      let lastUrl = location.href;

      const onRouteChange = Utils.debounce(() => {
        this.resetForRoute();
      }, 200);

      const checkUrl = () => {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          onRouteChange();
        }
      };

      // detect-navigation.js 在主世界劫持 pushState/replaceState 并派发此事件
      window.addEventListener('ai-toc:urlchange', checkUrl);
      window.addEventListener('popstate', checkUrl);

      // 兜底轮询，确保任何情况下都能检测到 URL 变化
      setInterval(checkUrl, 1000);
    }

    resetForRoute() {
      this.detachObserver();
      this.detachLayoutObserver();
      this.cache.items = [];
      this.cache.keySet = new Set();
      this.cache.key2item = new Map();
      this.cache.node2key = new WeakMap();
      this.cache.autoInc = 1;
      this._renderedCount = 0;
      this.state.activeKey = '';
      this.renderTimeline();

      this.chatRoot = this.findChatRoot();
      this.attachObserver();
      this.attachLayoutObserver();
      this.fullRescan();
      this.applyChatWidth(this.state.chatWidth, false, 'resetForRoute');
      if (!this.state.enabled) {
        if (this.dom.root) this.dom.root.style.display = 'none';
        if (this.dom.timeline) this.dom.timeline.style.display = 'none';
        this.detachObserver();
        this.detachLayoutObserver();
      }
    }

    attachObserver() {
      const root = this.chatRoot || document.body;
      const selectors = this.getSelectors();

      const onMutations = (mutations) => {
        let anyNew = false;
        let shouldRefreshTimeline = false;
        for (const m of mutations) {
          if (!m.addedNodes || m.addedNodes.length === 0) continue;
          shouldRefreshTimeline = true;

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
        if (shouldRefreshTimeline) {
          this.syncInlineBookmarkButtons();
        }
        if (anyNew) {
          this.applyChatWidth(this.state.chatWidth, false, 'observer:anyNew');
          this.scheduleRender();
        } else if (shouldRefreshTimeline) {
          this.applyChatWidth(this.state.chatWidth, false, 'observer:layoutRefresh');
          this.scheduleTimelineRefresh();
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

    attachLayoutObserver() {
      if (!window.ResizeObserver || !this.chatRoot) return;
      this.layoutObserver = new ResizeObserver(() => this.scheduleTimelineRefresh());
      this.layoutObserver.observe(this.chatRoot);
    }

    detachLayoutObserver() {
      if (this.layoutObserver) {
        try { this.layoutObserver.disconnect(); } catch {}
      }
      this.layoutObserver = null;
    }

    makeKeyAndAnchor(node, txt) {
      const wrap = node.closest('[data-message-id]') || node.closest('article') || node;
      const mid = wrap.getAttribute && wrap.getAttribute('data-message-id');
      if (mid) return { key: `mid:${mid}`, kind: 'mid', val: mid, weak: null };

      const wid = wrap.id;
      if (wid) return { key: `id:${wid}`, kind: 'id', val: wid, weak: null };

      const h = Utils.hash32(txt);
      const key = `h:${h}:${this.cache.autoInc++}`;
      const weak = new WeakRef(wrap);
      return { key, kind: 'weak', val: h, weak };
    }

    makeBookmarkId(anchor, txt) {
      if (anchor.kind === 'mid') return `mid:${anchor.val}`;
      if (anchor.kind === 'id') return `id:${anchor.val}`;
      return `hash:${Utils.hash32(txt)}`;
    }

    persistMarks() {
      Utils.storage.set('bookmarks', Array.from(this.state.marks));
      Utils.storage.set('manualBookmarks', Array.from(this.state.manualMarks));
    }

    findItemByBookmarkId(bookmarkId) {
      return this.cache.items.find((item) => item.bookmarkId === bookmarkId) || null;
    }

    removeItemByBookmarkId(bookmarkId) {
      const index = this.cache.items.findIndex((item) => item.bookmarkId === bookmarkId);
      if (index === -1) return false;

      const [item] = this.cache.items.splice(index, 1);
      this.cache.keySet.delete(item.key);
      this.cache.key2item.delete(item.key);
      const targetNode = this.getItemTargetNode(item);
      if (targetNode) this.cache.node2key.delete(targetNode);
      if (this.state.activeKey === item.key) this.state.activeKey = '';
      this.cache.items.forEach((entry, idx) => {
        entry.idx = idx + 1;
      });
      this._renderedCount = Math.min(this._renderedCount, this.cache.items.length);
      return true;
    }

    isAssistantBookmarkActive(node) {
      const txt = Utils.fastText(node);
      if (!txt) return false;
      const anchor = this.makeKeyAndAnchor(node, txt);
      const bookmarkId = this.makeBookmarkId(anchor, txt);
      return this.state.manualMarks.has(bookmarkId);
    }

    toggleAssistantBookmark(node) {
      const txt = Utils.fastText(node);
      if (!txt) return;

      const anchor = this.makeKeyAndAnchor(node, txt);
      const bookmarkId = this.makeBookmarkId(anchor, txt);
      const exists = this.state.manualMarks.has(bookmarkId);

      if (exists) {
        this.state.manualMarks.delete(bookmarkId);
        this.state.marks.delete(bookmarkId);
        this.removeItemByBookmarkId(bookmarkId);
        Utils.toast(this.t('content_ai_bookmark_removed'));
      } else {
        this.registerMessageNode(node);
        this.state.manualMarks.add(bookmarkId);
        this.state.marks.add(bookmarkId);
        Utils.toast(this.t('content_ai_bookmark_added'));
      }

      this.persistMarks();
      this.syncInlineBookmarkButtons();
      this.renderListFull();
    }

    getBookmarkButtonHost(node) {
      return node.closest('[data-message-id]') || node.closest('article') || node.parentElement || node;
    }

    syncInlineBookmarkButtons() {
      const assistantNodes = this.getAllMessageNodes('assistant');
      assistantNodes.forEach((node) => {
        const host = this.getBookmarkButtonHost(node);
        if (!(host instanceof HTMLElement)) return;
        host.classList.add('ai-msg-bookmark-host');

        let btn = host.querySelector(':scope > .ai-msg-bookmark-btn');
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ai-msg-bookmark-btn';
          btn.textContent = '✦';
          host.appendChild(btn);
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleAssistantBookmark(node);
          });
        }

        const active = this.isAssistantBookmarkActive(node);
        btn.classList.toggle('active', active);
        const title = active ? this.t('content_ai_remove_bookmark') : this.t('content_ai_add_bookmark');
        btn.title = title;
        btn.setAttribute('aria-label', title);
      });
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
      const role = node.getAttribute('data-message-author-role') || 'unknown';
      const bookmarkId = this.makeBookmarkId({ key, kind, val, weak }, txt);

      const it = {
        key, kind, val, weak,
        bookmarkId,
        role,
        hash: Utils.hash32(txt),
        txt, lower, preview,
        idx: this.cache.items.length + 1,
        timelineLabel: `#${this.cache.items.length + 1}`
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
          if (drop.role !== 'user') {
            this.state.manualMarks.delete(drop.bookmarkId);
          }
          if (this.state.marks.has(drop.bookmarkId)) {
            this.state.marks.delete(drop.bookmarkId);
            this.persistMarks();
          }
          if (this.state.activeKey === drop.key) this.state.activeKey = '';
          this._renderedCount = Math.max(0, this._renderedCount - 1);
        }
      }

      return true;
    }

    fullRescan() {
      const nodes = this.getAllMessageNodes();
      for (const node of nodes) {
        const role = node.getAttribute('data-message-author-role');
        if (role === 'user') {
          this.registerMessageNode(node);
          continue;
        }
        if (role !== 'assistant') continue;
        const txt = Utils.fastText(node);
        if (!txt) continue;
        const anchor = this.makeKeyAndAnchor(node, txt);
        const bookmarkId = this.makeBookmarkId(anchor, txt);
        if (this.state.manualMarks.has(bookmarkId)) {
          this.registerMessageNode(node);
        }
      }
      this.syncInlineBookmarkButtons();
      this.renderListFull();
    }

    renderEmpty(text) {
      this.dom.body.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'ai-txt ai-empty';
      empty.textContent = text;
      this.dom.body.appendChild(empty);
      this._renderedCount = this.cache.items.length;
      this.renderTimeline();
    }

    buildItemEl(it) {
      const item = document.createElement('div');
      item.className = 'ai-item' + (this.state.marks.has(it.bookmarkId) ? ' mark' : '');
      if (this.state.activeKey === it.key) item.classList.add('active');
      item.title = it.txt;
      item.dataset.key = it.key;

      const num = document.createElement('span');
      num.className = 'ai-num';
      num.textContent = '#' + it.idx;

      const star = document.createElement('span');
      star.className = 'ai-star';
      star.textContent = '✦';
      star.title = this.t('content_toggle_bookmark');
      star.setAttribute('aria-label', this.t('content_toggle_bookmark'));

      const label = document.createElement('span');
      label.className = 'ai-txt';
      label.textContent = it.role === 'assistant'
        ? `${this.t('content_assistant_prefix')} · ${it.preview}`
        : it.preview;

      item.append(num, star, label);
      return item;
    }

    getItemTargetNode(it) {
      if (!it) return null;

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
        const nodes = root.querySelectorAll('div[data-message-author-role]');
        for (const n of nodes) {
          const t = Utils.fastText(n);
          if (!t) continue;
          if (Utils.hash32(t) === it.hash) {
            target = n;
            break;
          }
        }
      }

      return target;
    }

    renderListFull() {
      const kw = this.state.keyword;
      const items = this.cache.items;

      if (!items.length) {
        this.renderEmpty(this.t('content_waiting'));
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
        this.renderEmpty(kw ? this.t('content_no_match') : this.t('content_waiting'));
        return;
      }

      this.dom.body.appendChild(frag);
      this._renderedCount = items.length;
      this.applyChatWidth(this.state.chatWidth, false, 'renderListFull');
      this.syncActiveStates();
      this.renderTimeline();
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
      this.applyChatWidth(this.state.chatWidth, false, 'appendNewItems');
      this.syncActiveStates();
      this.renderTimeline();
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

      const target = this.getItemTargetNode(it);

      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    scrollSidebarOrPage(edge) {
      const body = this.dom.body;
      const top = edge === 'top' ? 0 : Math.max(0, (body?.scrollHeight || 0) - (body?.clientHeight || 0));
      const canScrollBody = !!body && body.scrollHeight > body.clientHeight + 4;

      if (canScrollBody) {
        try {
          body.scrollTo({ top, behavior: 'smooth' });
        } catch {
          body.scrollTop = top;
        }

        requestAnimationFrame(() => {
          if (body) body.scrollTop = top;
        });
        return;
      }

      const pageTop = edge === 'top'
        ? 0
        : Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight || 0,
          this.chatRoot?.scrollHeight || 0
        );

      try {
        window.scrollTo({ top: pageTop, behavior: 'smooth' });
      } catch {
        window.scrollTo(0, pageTop);
      }
    }

    toggleCollapse() {
      this.state.isCollapsed = !this.state.isCollapsed;
      this.dom.root.classList.toggle('ai-hide');
      this.updateActionButtons();
      this.syncTimelinePosition();
      Utils.storage.set('collapsed', this.state.isCollapsed);
    }

    handleExport(e) {
      e.stopPropagation();
      if (e.shiftKey) {
        const log = this.getChatLog();
        if (!log) return Utils.toast(this.t('content_no_chat'));
        navigator.clipboard.writeText(log)
          .then(() => Utils.toast(this.t('content_full_chat_copied')))
          .catch(() => Utils.toast(this.t('content_copy_failed')));
      } else {
        const kw = this.state.keyword;
        const list = this.cache.items
          .filter(x => !kw || x.lower.includes(kw))
          .map(x => x.txt)
          .join('\n');
        navigator.clipboard.writeText(list || '')
          .then(() => Utils.toast(this.t('content_outline_copied')))
          .catch(() => Utils.toast(this.t('content_copy_failed')));
      }
    }

    getChatLog() {
      const root = this.chatRoot || document.querySelector('main') || document.body;
      const blocks = root.querySelectorAll('div[data-message-author-role]');
      if (!blocks.length) return null;

      const time = new Date().toLocaleString(this.state.language === 'en' ? 'en-US' : 'zh-CN');
      const log = [this.t('content_export_header', { time })];
      blocks.forEach((b) => {
        const role = b.getAttribute('data-message-author-role');
        const t = Utils.fastText(b);
        if (!t) return;
        log.push(`${role === 'user' ? this.t('content_export_user') : this.t('content_export_ai')}\n${t}\n-------------------`);
      });
      return log.join('\n\n');
    }
  }

  Utils.storage.getAll().then((stored) => {
    const app = new SideNavGPT(stored);
    app.init();
    console.info('[AI TOC] content booted', {
      enabled: app.state.enabled,
      chatWidth: app.state.chatWidth,
      url: location.href
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      const chatWidthKey = `ai-toc-${NS}-chatWidth`;
      const languageKey = `ai-toc-${NS}-language`;

      if (changes[chatWidthKey]) {
        const nextWidth = app.normalizeChatWidth(changes[chatWidthKey].newValue);
        console.info('[AI TOC] storage chatWidth changed', {
          oldValue: changes[chatWidthKey].oldValue,
          newValue: changes[chatWidthKey].newValue,
          normalized: nextWidth
        });
        if (nextWidth !== app.state.chatWidth) {
          app.applyChatWidth(nextWidth, false, 'storage:onChanged');
        }
      }

      if (changes[languageKey]) {
        const nextLanguage = app.normalizeLanguage(changes[languageKey].newValue);
        if (nextLanguage !== app.state.language) {
          app.setLanguage(nextLanguage, false);
        }
      }
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'toggle-enabled') {
        app.state.enabled = msg.value;
        if (msg.value) {
          if (!app.dom.root?.parentElement) app.init();
          app.dom.root.style.display = '';
          if (app.dom.timeline) app.dom.timeline.style.display = '';
          app.resetForRoute();
          app.applyChatWidth(app.state.chatWidth, false, 'toggle-enabled');
          app.applySidebarWidth();
          app.syncTimelinePosition();
        } else {
          if (app.dom.root) app.dom.root.style.display = 'none';
          if (app.dom.timeline) app.dom.timeline.style.display = 'none';
          app.detachObserver();
          app.detachLayoutObserver();
        }
      } else if (msg.type === 'set-reduceFx') {
        app.state.reduceFx = msg.value;
        app.dom.root.classList.toggle('fx-off', msg.value);
        app.dom.timeline?.classList.toggle('fx-off', msg.value);
      } else if (msg.type === 'preview-chat-width') {
        const result = app.applyChatWidth(msg.value, false, 'preview-chat-width');
        sendResponse(result);
      } else if (msg.type === 'set-chat-width') {
        const result = app.applyChatWidth(msg.value, true, 'message:set-chat-width');
        sendResponse({
          chatWidth: app.state.chatWidth,
          appliedWidth: result.appliedWidth,
          targetCount: result.targetCount
        });
      } else if (msg.type === 'set-theme') {
        const appliedTheme = app.applyTheme(msg.value);
        Utils.storage.set('theme', appliedTheme);
        sendResponse({
          requestedTheme: msg.value,
          appliedTheme,
          themes: app.themes.slice(),
          className: app.dom.root?.className || null,
          themeClasses: Array.from(app.dom.root?.classList || []).filter((name) => name.startsWith('theme-'))
        });
      } else if (msg.type === 'set-language') {
        const appliedLanguage = app.setLanguage(msg.value, true);
        sendResponse({
          requestedLanguage: msg.value,
          appliedLanguage
        });
      }
    });
  });
})();
