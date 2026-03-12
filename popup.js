const NS = 'gpt';
const key = (k) => `ai-toc-${NS}-${k}`;
const CHAT_WIDTH_DEFAULT = 960;
const CHAT_WIDTH_MIN = 720;
const CHAT_WIDTH_MAX = 1440;
const SIDEBAR_WIDTH_MIN = 188;
const SIDEBAR_WIDTH_MAX = 288;

const manifest = chrome.runtime.getManifest();
document.getElementById('version').textContent = `v${manifest.version}`;

const toggleEnabled = document.getElementById('toggle-enabled');
const toggleFx = document.getElementById('toggle-fx');
const themeBtns = document.querySelectorAll('.theme-btn');
const chatWidthInput = document.getElementById('chat-width');
const chatWidthValue = document.getElementById('chat-width-value');
const sidebarWidthInput = document.getElementById('sidebar-width');
const sidebarWidthValue = document.getElementById('sidebar-width-value');
const normalizeTheme = (theme) => (theme === 'light' ? 'light' : 'dark');
const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
};
const normalizeChatWidth = (width) => clamp(width, CHAT_WIDTH_MIN, CHAT_WIDTH_MAX, CHAT_WIDTH_DEFAULT);
const normalizeSidebarWidth = (width) => clamp(width, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN);
const renderWidthValue = (el, value) => {
  el.textContent = `${value}px`;
};
const syncThemeButtons = (theme) => {
  themeBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
};
let pendingChatWidthPreview = null;
let chatWidthPreviewRAF = 0;

chrome.storage.local.get(
  {
    [key('enabled')]: true,
    [key('reduceFx')]: true,
    [key('theme')]: 'dark',
    [key('chatWidth')]: CHAT_WIDTH_DEFAULT,
    [key('sidebarWidth')]: SIDEBAR_WIDTH_MIN,
    [key('wide')]: false
  },
  (result) => {
    toggleEnabled.checked = result[key('enabled')];
    toggleFx.checked = result[key('reduceFx')];

    const current = normalizeTheme(result[key('theme')]);
    if (current !== result[key('theme')]) {
      chrome.storage.local.set({ [key('theme')]: current });
    }
    syncThemeButtons(current);

    const chatWidth = normalizeChatWidth(result[key('chatWidth')]);
    const rawSidebarWidth = result[key('sidebarWidth')];
    const sidebarWidth = normalizeSidebarWidth(
      typeof rawSidebarWidth === 'number'
        ? rawSidebarWidth
        : (result[key('wide')] ? SIDEBAR_WIDTH_MAX : SIDEBAR_WIDTH_MIN)
    );

    chatWidthInput.value = String(chatWidth);
    sidebarWidthInput.value = String(sidebarWidth);
    renderWidthValue(chatWidthValue, chatWidth);
    renderWidthValue(sidebarWidthValue, sidebarWidth);

    const nextState = {};
    if (chatWidth !== result[key('chatWidth')]) nextState[key('chatWidth')] = chatWidth;
    if (sidebarWidth !== result[key('sidebarWidth')]) nextState[key('sidebarWidth')] = sidebarWidth;
    if (Object.keys(nextState).length) chrome.storage.local.set(nextState);
  }
);

toggleEnabled.addEventListener('change', () => {
  const val = toggleEnabled.checked;
  chrome.storage.local.set({ [key('enabled')]: val });
  notifyContentScript({ type: 'toggle-enabled', value: val });
});

toggleFx.addEventListener('change', () => {
  const val = toggleFx.checked;
  chrome.storage.local.set({ [key('reduceFx')]: val });
  notifyContentScript({ type: 'set-reduceFx', value: val });
});

themeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const theme = normalizeTheme(btn.dataset.theme);
    syncThemeButtons(theme);
    chrome.storage.local.set({ [key('theme')]: theme });
    notifyContentScript({ type: 'set-theme', value: theme });
  });
});

chatWidthInput.addEventListener('input', () => {
  const value = normalizeChatWidth(chatWidthInput.value);
  chatWidthInput.value = String(value);
  renderWidthValue(chatWidthValue, value);
  pendingChatWidthPreview = value;
  if (chatWidthPreviewRAF) return;
  chatWidthPreviewRAF = requestAnimationFrame(() => {
    chatWidthPreviewRAF = 0;
    if (pendingChatWidthPreview == null) return;
    notifyContentScript({ type: 'preview-chat-width', value: pendingChatWidthPreview });
    pendingChatWidthPreview = null;
  });
});

chatWidthInput.addEventListener('change', () => {
  const value = normalizeChatWidth(chatWidthInput.value);
  chatWidthInput.value = String(value);
  renderWidthValue(chatWidthValue, value);
  chrome.storage.local.set({ [key('chatWidth')]: value });
  notifyContentScript({ type: 'set-chat-width', value }, (response) => {
    const appliedWidth = Number(response?.appliedWidth);
    if (Number.isFinite(appliedWidth) && appliedWidth > 0) {
      renderWidthValue(chatWidthValue, appliedWidth);
    }
  });
});

sidebarWidthInput.addEventListener('input', () => {
  const value = normalizeSidebarWidth(sidebarWidthInput.value);
  sidebarWidthInput.value = String(value);
  renderWidthValue(sidebarWidthValue, value);
  chrome.storage.local.set({
    [key('sidebarWidth')]: value,
    [key('wide')]: value > (SIDEBAR_WIDTH_MIN + SIDEBAR_WIDTH_MAX) / 2
  });
  notifyContentScript({ type: 'set-sidebar-width', value });
});

function notifyContentScript(msg, onResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, msg)
        .then((response) => {
          if (typeof onResponse === 'function') onResponse(response);
        })
        .catch(() => {});
    }
  });
}
