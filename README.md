<a id="top"></a>
<a id="english"></a>

# ChatGPT Side Navigation Extension

[English](#english) | [简体中文](#zh-cn)

Chrome extension for `https://chatgpt.com/*` that adds a floating conversation navigator, search, bookmarks, export tools, a timeline rail, and popup-based layout controls.

The interface and interaction design were inspired by Google Voyager and the open-source project [gemini-voyager](https://github.com/Nagi-ovo/gemini-voyager).

## Features

- Floating sidebar injected into ChatGPT pages
- Search across detected user messages
- Bookmark important entries
- Export the visible outline or the full conversation
- Timeline rail for quick navigation through long chats
- Popup settings for:
  - enable / disable
  - reduced effects mode
  - light / dark theme
  - main chat width
  - sidebar width

## How It Works

The extension has two main parts:

- `popup.html` + `popup.js`: the browser action popup used to change settings
- `content.js` + `content.css`: the page-side UI and logic injected into ChatGPT

When a setting changes in the popup, the extension:

1. updates `chrome.storage.local`
2. sends a message to the active ChatGPT tab
3. lets the content script update the page immediately

## Message Flow

### Initial page load

1. Chrome injects `content.css` and `content.js` into `https://chatgpt.com/*`
2. `content.js` reads all extension state from `chrome.storage.local`
3. the floating sidebar and the timeline rail are rendered
4. the content script scans the current conversation and builds the outline
5. `detect-navigation.js` patches SPA navigation so route changes can trigger a refresh

### Popup to page updates

For a normal popup action, the flow is:

1. user changes a control in `popup.html`
2. `popup.js` normalizes the value
3. `popup.js` sends a message to the active tab
4. `content.js` handles the message and updates the live page
5. state is persisted in `chrome.storage.local`

### Chat width timing

Chat width uses a split flow for lower latency:

- slider `input`: sends `preview-chat-width` for live preview
- slider `change`: sends `set-chat-width` and persists the final value
- `content.js` also listens to `chrome.storage.onChanged` as a fallback sync path

### Message types

- `toggle-enabled`
- `set-reduceFx`
- `set-theme`
- `preview-chat-width`
- `set-chat-width`
- `set-sidebar-width`

## Storage Keys

All extension state is stored in `chrome.storage.local` with the prefix `ai-toc-gpt-`.

| Key | Type | Purpose |
| --- | --- | --- |
| `bookmarks` | `string[]` | bookmarked outline item ids |
| `collapsed` | `boolean` | whether the sidebar body is collapsed |
| `wide` | `boolean` | whether the sidebar is in wide mode |
| `pos` | `{ x: number, y: number }` | saved floating position of the sidebar |
| `theme` | `'light' \| 'dark'` | current extension theme |
| `reduceFx` | `boolean` | disables blur / heavy visual effects |
| `enabled` | `boolean` | master on/off flag for the injected UI |
| `chatWidth` | `number` | requested main chat width from the popup |
| `sidebarWidth` | `number` | requested sidebar width from the popup |

## Width Control Details

### Sidebar width

Sidebar width is straightforward:

- the popup range control writes `sidebarWidth`
- `content.js` applies the width directly to the floating root node
- the legacy `wide` flag is still maintained for compatibility with the old wide / normal mode toggle

### Main chat width

Main chat width is more complex because ChatGPT controls the page layout.

The extension currently does all of the following:

- stores the requested width as `chatWidth`
- sends a live preview message while the slider is moving
- applies a CSS variable: `--ai-toc-chat-width`
- also overrides ChatGPT's own layout variable: `--thread-content-max-width`
- targets current layout wrappers such as elements matching `[class*="l-thread-content-max-width-"]`
- expands inner message wrappers like `max-w-full`, `text-message`, and message role containers
- re-applies width after route changes and layout refreshes

### Requested width vs applied width

The popup can request a width larger than what the current page layout can visibly show.

Because of that, `content.js` calculates and returns an `appliedWidth` after updating the DOM. In practice:

- `requestedWidth` is what the slider asks for
- `appliedWidth` is what the targeted layout containers actually render at

If the page has already reached its natural layout limit, increasing the slider further may not create a visible change even though the extension is still applying the new value.

## Installation

1. Open `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this project folder
5. Open `https://chatgpt.com/`

## Usage

### Sidebar

- Click items to scroll to the related message
- Click the star area to bookmark an item
- Right-click an item to copy its text
- Use the top / bottom buttons to jump inside the list

### Timeline

- Click timeline nodes to jump through long conversations
- Active and bookmarked items are visually highlighted

### Keyboard Shortcuts

- `Ctrl` + `Shift` + `F`: focus the search box
- `Esc`: clear search or blur the input

### Export

- Left click export: copy the current outline
- `Shift` + left click export: copy the full conversation

## Project Structure

- [manifest.json](./manifest.json): extension manifest and injection entrypoints
- [popup.html](./popup.html): popup UI markup and embedded styles
- [popup.js](./popup.js): popup logic, storage sync, and tab messaging
- [content.js](./content.js): injected app logic, DOM scanning, navigation, export, width control
- [content.css](./content.css): injected styles for sidebar, timeline, and chat-width overrides
- [detect-navigation.js](./detect-navigation.js): route-change bridge for ChatGPT's SPA navigation
- [icons/icon16.png](./icons/icon16.png), [icons/icon48.png](./icons/icon48.png), [icons/icon128.png](./icons/icon128.png): extension icons

## Notes

- The extension is designed for the current ChatGPT web UI and may require selector updates when the site layout changes.
- Main chat width is applied by overriding ChatGPT layout containers. The actual visible width can still be limited by the current page layout.
- `main.js` was a legacy userscript path and is not part of the extension runtime.

## Development

There is no build step. Edit the source files directly and reload the unpacked extension in Chrome.

Recommended reload loop:

1. change source files
2. reload the extension in `chrome://extensions/`
3. refresh the ChatGPT tab

[Back to top](#top)

---

<a id="zh-cn"></a>

# ChatGPT 侧边导航扩展

[English](#english) | [简体中文](#zh-cn)

这是一个面向 `https://chatgpt.com/*` 的 Chrome 扩展。它会在 ChatGPT 页面注入一个浮动侧边目录，提供搜索、书签、导出、时间线导航，以及通过 popup 控制页面布局的能力。

界面和交互设计灵感来源于 Google Voyager，以及开源项目 [gemini-voyager](https://github.com/Nagi-ovo/gemini-voyager)。

## 功能特性

- 在 ChatGPT 页面注入浮动侧边栏
- 按用户消息建立目录
- 搜索对话内容
- 书签标记重点条目
- 导出目录或完整对话
- 右侧时间线快速跳转
- 通过 popup 调整：
  - 启用 / 禁用
  - 性能模式
  - 浅色 / 深色主题
  - 主对话区宽度
  - 侧栏宽度

## 工作方式

这个项目当前以扩展版为主，核心链路分成两部分：

- `popup.html` + `popup.js`：浏览器工具栏弹出的设置面板
- `content.js` + `content.css`：注入到 ChatGPT 页面的实际功能和样式

当你在 popup 里修改设置时，扩展会：

1. 更新 `chrome.storage.local`
2. 向当前激活的 ChatGPT 标签页发送消息
3. 由内容脚本立刻把设置应用到页面

## 消息流时序

### 页面初始加载

1. Chrome 将 `content.css` 和 `content.js` 注入到 `https://chatgpt.com/*`
2. `content.js` 从 `chrome.storage.local` 读取全部状态
3. 渲染浮动侧边栏和时间线
4. 扫描当前会话，生成目录数据
5. `detect-navigation.js` 劫持单页路由切换，用于在会话切换后重新同步

### popup 到页面的更新链路

普通设置项的更新流程如下：

1. 用户在 `popup.html` 中操作控件
2. `popup.js` 对输入值做规范化
3. `popup.js` 向当前标签页发送消息
4. `content.js` 处理消息并更新页面
5. 最终状态写入 `chrome.storage.local`

### 主对话区宽度的时序

主对话区宽度为了降低拖动延迟，使用了分流策略：

- 滑杆 `input`：发送 `preview-chat-width`，只做即时预览
- 滑杆 `change`：发送 `set-chat-width`，并持久化最终值
- `content.js` 同时监听 `chrome.storage.onChanged`，作为兜底同步路径

### 当前消息类型

- `toggle-enabled`
- `set-reduceFx`
- `set-theme`
- `preview-chat-width`
- `set-chat-width`
- `set-sidebar-width`

## 存储键说明

扩展所有状态都保存在 `chrome.storage.local` 中，统一前缀为 `ai-toc-gpt-`。

| 键名 | 类型 | 作用 |
| --- | --- | --- |
| `bookmarks` | `string[]` | 已加书签的目录项 id |
| `collapsed` | `boolean` | 侧边栏主体是否折叠 |
| `wide` | `boolean` | 侧边栏是否处于宽模式 |
| `pos` | `{ x: number, y: number }` | 浮动侧边栏保存的位置 |
| `theme` | `'light' \| 'dark'` | 当前扩展主题 |
| `reduceFx` | `boolean` | 是否关闭模糊和重视觉效果 |
| `enabled` | `boolean` | 页面注入 UI 的总开关 |
| `chatWidth` | `number` | popup 中设置的主对话区目标宽度 |
| `sidebarWidth` | `number` | popup 中设置的侧栏目标宽度 |

## 宽度控制的实现细节

### 侧栏宽度

侧栏宽度控制比较直接：

- popup 滑杆写入 `sidebarWidth`
- `content.js` 直接把宽度应用到浮动根节点
- 历史上的 `wide` 标志仍然保留，用来兼容旧的宽 / 窄切换逻辑

### 主对话区宽度

主对话区宽度更复杂，因为真正控制宽度的是 ChatGPT 自己的布局容器。

当前扩展会同时做这些事：

- 把目标宽度存入 `chatWidth`
- 拖动时发送预览消息，减少延迟
- 设置扩展内部变量 `--ai-toc-chat-width`
- 同时覆盖 ChatGPT 自己的 `--thread-content-max-width`
- 优先命中 `[class*="l-thread-content-max-width-"]` 这一类当前布局容器
- 向内继续放开 `max-w-full`、`text-message`、消息 role 容器等内层节点
- 在路由切换、布局刷新、消息追加后重新应用宽度

### 请求宽度和实际宽度

popup 滑杆可以请求一个比当前页面自然布局更宽的值。

因此 `content.js` 在应用后会计算并返回 `appliedWidth`：

- `requestedWidth`：滑杆请求的目标宽度
- `appliedWidth`：当前被命中的布局容器实际渲染出来的宽度

所以在某些页面布局下，滑杆继续往右拖，可能不会再看到明显变宽。这不一定是消息链路失效，而可能是页面自身已经到达可见上限。

## 安装方式

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择当前项目目录
5. 打开 `https://chatgpt.com/`

## 使用说明

### 侧边栏

- 点击目录项：滚动到对应消息
- 点击星标区域：添加或取消书签
- 右键目录项：复制该条消息文本
- 使用顶部 / 底部按钮：快速移动列表

### 时间线

- 点击时间线节点：快速跳转长对话
- 当前项和书签项会有高亮状态

### 快捷键

- `Ctrl` + `Shift` + `F`：聚焦搜索框
- `Esc`：清空搜索或取消输入框焦点

### 导出

- 普通点击导出按钮：复制当前目录
- `Shift` + 点击导出按钮：复制完整对话

## 项目结构

- [manifest.json](./manifest.json)：扩展清单和注入入口
- [popup.html](./popup.html)：popup 的 HTML 和内嵌样式
- [popup.js](./popup.js)：popup 逻辑、存储同步、向页面发消息
- [content.js](./content.js)：页面内主逻辑，负责目录、搜索、书签、导出、时间线、宽度控制
- [content.css](./content.css)：页面注入样式，包含侧边栏、时间线和主对话区宽度覆盖
- [detect-navigation.js](./detect-navigation.js)：为 ChatGPT 单页路由切换补事件
- [icons/icon16.png](./icons/icon16.png)、[icons/icon48.png](./icons/icon48.png)、[icons/icon128.png](./icons/icon128.png)：扩展图标资源

## 说明

- 这个扩展依赖当前 ChatGPT 网页结构；如果官网改版，选择器和宽度逻辑可能需要同步调整。
- 主对话区宽度是通过覆盖 ChatGPT 的布局容器实现的，所以“请求宽度”和“实际显示宽度”在某些布局下可能不完全一致。
- `main.js` 属于旧的 userscript 路径，不属于当前扩展运行主链路。

## 开发方式

项目没有构建步骤，直接修改源码即可。

推荐调试流程：

1. 修改源码
2. 在 `chrome://extensions/` 里重新加载扩展
3. 刷新 ChatGPT 页面

[回到顶部](#top)
