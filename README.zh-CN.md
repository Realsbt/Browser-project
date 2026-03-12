# ChatGPT 侧边导航扩展

[English](./README.md) | 简体中文

这是一个面向 `https://chatgpt.com/*` 的 Chrome 扩展。它会在 ChatGPT 页面注入一个浮动侧边目录，提供搜索、书签、导出、时间线导航，以及通过 popup 控制页面布局的能力。

English version: [README.md](./README.md)

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
