(function (global) {
  'use strict';

  const messages = {
    'zh-CN': {
      popup_header_title: 'ChatGPT 侧边导航栏',
      popup_section_language: '语言',
      popup_lang_zh: '中文',
      popup_lang_en: 'English',
      popup_section_settings: '设置',
      popup_enable_sidebar: '启用侧边栏',
      popup_performance_mode: '性能模式',
      popup_section_width: '宽度',
      popup_chat_width: '主对话区宽度',
      popup_width_compact: '紧凑',
      popup_width_wide: '宽',
      popup_section_theme: '主题',
      popup_theme_light: '浅色',
      popup_theme_dark: '深色',
      popup_section_shortcuts: '快捷键',
      popup_shortcut_focus: '聚焦搜索框',
      popup_shortcut_escape: '清空搜索 / 取消聚焦',
      popup_shortcut_bookmark: '点击 ✦ 添加书签 · 右键复制消息',

      content_timeline_entry: '第 {index} 次发送',
      content_timeline_ai_bookmark: 'AI 回答书签',
      content_bookmarked: '已加书签',
      content_chat_width_limited: '主对话区 {width}px（已达页面上限）',
      content_chat_width_applied: '主对话区宽度 {width}px',
      content_chat_width_missing: '未找到主对话区容器',
      content_action_widen: '展开宽度',
      content_action_narrow: '收窄宽度',
      content_action_expand: '展开目录',
      content_action_collapse: '收起目录',
      content_drag_sidebar: '拖动移动侧栏',
      content_search_placeholder: '搜索对话...',
      content_toggle_bookmark: '切换书签',
      content_ai_add_bookmark: '为这条 AI 回答添加书签',
      content_ai_remove_bookmark: '取消这条 AI 回答的书签',
      content_scroll_top: '滚动到顶部',
      content_scroll_bottom: '滚动到底部',
      content_export_hint: '左键：复制目录\nShift+左键：导出完整对话',
      content_waiting: '等待对话...',
      content_copied: '已复制内容',
      content_copy_failed: '复制失败',
      content_ai_bookmark_added: '已为 AI 回答添加书签',
      content_ai_bookmark_removed: '已取消 AI 回答书签',
      content_no_match: '未匹配到内容',
      content_no_chat: '未检测到有效对话',
      content_full_chat_copied: '完整对话已复制',
      content_outline_copied: '目录已复制',
      content_export_header: '=== 导出对话 ({time}) ===\n',
      content_export_user: '【User】',
      content_export_ai: '【AI】',
      content_assistant_prefix: 'AI'
    },
    en: {
      popup_header_title: 'ChatGPT Side Navigation',
      popup_section_language: 'Language',
      popup_lang_zh: 'Chinese',
      popup_lang_en: 'English',
      popup_section_settings: 'Settings',
      popup_enable_sidebar: 'Enable sidebar',
      popup_performance_mode: 'Performance mode',
      popup_section_width: 'Width',
      popup_chat_width: 'Main chat width',
      popup_width_compact: 'Compact',
      popup_width_wide: 'Wide',
      popup_section_theme: 'Theme',
      popup_theme_light: 'Light',
      popup_theme_dark: 'Dark',
      popup_section_shortcuts: 'Shortcuts',
      popup_shortcut_focus: 'Focus the search box',
      popup_shortcut_escape: 'Clear search / blur input',
      popup_shortcut_bookmark: 'Click ✦ to bookmark · Right-click to copy a message',

      content_timeline_entry: 'Prompt {index}',
      content_timeline_ai_bookmark: 'AI reply bookmark',
      content_bookmarked: 'Bookmarked',
      content_chat_width_limited: 'Chat width {width}px (page limit reached)',
      content_chat_width_applied: 'Chat width {width}px',
      content_chat_width_missing: 'Chat container not found',
      content_action_widen: 'Widen sidebar',
      content_action_narrow: 'Narrow sidebar',
      content_action_expand: 'Expand sidebar',
      content_action_collapse: 'Collapse sidebar',
      content_drag_sidebar: 'Drag to move the sidebar',
      content_search_placeholder: 'Search conversation...',
      content_toggle_bookmark: 'Toggle bookmark',
      content_ai_add_bookmark: 'Bookmark this AI reply',
      content_ai_remove_bookmark: 'Remove bookmark from this AI reply',
      content_scroll_top: 'Scroll to top',
      content_scroll_bottom: 'Scroll to bottom',
      content_export_hint: 'Left click: copy outline\nShift+Left click: export full chat',
      content_waiting: 'Waiting for conversation...',
      content_copied: 'Copied',
      content_copy_failed: 'Copy failed',
      content_ai_bookmark_added: 'AI reply bookmarked',
      content_ai_bookmark_removed: 'AI reply bookmark removed',
      content_no_match: 'No matches found',
      content_no_chat: 'No valid conversation detected',
      content_full_chat_copied: 'Full chat copied',
      content_outline_copied: 'Outline copied',
      content_export_header: '=== Exported Conversation ({time}) ===\n',
      content_export_user: '[User]',
      content_export_ai: '[AI]',
      content_assistant_prefix: 'AI'
    }
  };

  function normalizeLanguage(language) {
    if (typeof language !== 'string') return 'zh-CN';
    const lower = language.toLowerCase();
    if (lower === 'en' || lower.startsWith('en-')) return 'en';
    if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh_cn' || lower.startsWith('zh-') || lower.startsWith('zh_')) {
      return 'zh-CN';
    }
    return 'zh-CN';
  }

  function detectDefaultLanguage() {
    const candidates = [
      typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getUILanguage === 'function'
        ? chrome.i18n.getUILanguage()
        : '',
      typeof navigator !== 'undefined' ? navigator.language : ''
    ];

    for (const candidate of candidates) {
      const normalized = normalizeLanguage(candidate);
      if (candidate) return normalized;
    }

    return 'zh-CN';
  }

  function interpolate(template, params) {
    if (!params) return template;
    return String(template).replace(/\{(\w+)\}/g, (_, key) => {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        return String(params[key]);
      }
      return `{${key}}`;
    });
  }

  function t(language, key, params) {
    const normalized = normalizeLanguage(language);
    const dict = messages[normalized] || messages['zh-CN'];
    const fallback = messages.en || {};
    const template = dict[key] || fallback[key] || key;
    return interpolate(template, params);
  }

  global.AI_TOC_I18N = {
    messages,
    normalizeLanguage,
    detectDefaultLanguage,
    t
  };
})(globalThis);
