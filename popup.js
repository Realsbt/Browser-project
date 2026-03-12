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
    // #region agent log
    fetch('http://127.0.0.1:7701/ingest/fb728793-037f-4a0f-82ac-b7d0acca2df3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'767ac1'},body:JSON.stringify({sessionId:'767ac1',runId:'initial-debug',hypothesisId:'H1',location:'popup.js:42',message:'theme button clicked',data:{theme,buttonCount:themeBtns.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    syncThemeButtons(theme);
    chrome.storage.local.set({ [key('theme')]: theme });
    notifyContentScript({ type: 'set-theme', value: theme });
  });
});

chatWidthInput.addEventListener('input', () => {
  const value = normalizeChatWidth(chatWidthInput.value);
  chatWidthInput.value = String(value);
  renderWidthValue(chatWidthValue, value);
  // #region agent log
  fetch('http://127.0.0.1:7701/ingest/fb728793-037f-4a0f-82ac-b7d0acca2df3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6155d5'},body:JSON.stringify({sessionId:'6155d5',runId:'initial-debug',hypothesisId:'H1',location:'popup.js:99',message:'chat width slider input',data:{value,inputValue:chatWidthInput.value},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  chrome.storage.local.set({ [key('chatWidth')]: value });
  notifyContentScript({ type: 'set-chat-width', value });
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

function notifyContentScript(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    // #region agent log
    fetch('http://127.0.0.1:7701/ingest/fb728793-037f-4a0f-82ac-b7d0acca2df3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'767ac1'},body:JSON.stringify({sessionId:'767ac1',runId:'initial-debug',hypothesisId:'H2',location:'popup.js:52',message:'notify content script queried tabs',data:{msgType:msg?.type,msgValue:msg?.value,tabId:tabs[0]?.id ?? null,tabUrl:tabs[0]?.url ?? null,tabCount:tabs.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, msg)
        .then((response) => {
          if (msg?.type === 'set-chat-width') {
            // #region agent log
            fetch('http://127.0.0.1:7701/ingest/fb728793-037f-4a0f-82ac-b7d0acca2df3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6155d5'},body:JSON.stringify({sessionId:'6155d5',runId:'initial-debug',hypothesisId:'H1',location:'popup.js:125',message:'chat width sendMessage resolved',data:{tabId:tabs[0]?.id ?? null,msgValue:msg?.value,response:response ?? null},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
          }
          // #region agent log
          fetch('http://127.0.0.1:7701/ingest/fb728793-037f-4a0f-82ac-b7d0acca2df3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'767ac1'},body:JSON.stringify({sessionId:'767ac1',runId:'initial-debug',hypothesisId:'H2',location:'popup.js:55',message:'sendMessage resolved',data:{msgType:msg?.type,msgValue:msg?.value,tabId:tabs[0]?.id,response:response ?? null},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        })
        .catch((error) => {
          if (msg?.type === 'set-chat-width') {
            // #region agent log
            fetch('http://127.0.0.1:7701/ingest/fb728793-037f-4a0f-82ac-b7d0acca2df3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6155d5'},body:JSON.stringify({sessionId:'6155d5',runId:'initial-debug',hypothesisId:'H1',location:'popup.js:134',message:'chat width sendMessage rejected',data:{tabId:tabs[0]?.id ?? null,msgValue:msg?.value,error:error?.message || String(error)},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
          }
          // #region agent log
          fetch('http://127.0.0.1:7701/ingest/fb728793-037f-4a0f-82ac-b7d0acca2df3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'767ac1'},body:JSON.stringify({sessionId:'767ac1',runId:'initial-debug',hypothesisId:'H2',location:'popup.js:59',message:'sendMessage rejected',data:{msgType:msg?.type,msgValue:msg?.value,tabId:tabs[0]?.id,error:error?.message || String(error)},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        });
    }
  });
}
