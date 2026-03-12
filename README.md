# ChatGPT Side Navigation Extension

English | [简体中文](./README.zh-CN.md)

Chrome extension for `https://chatgpt.com/*` that adds a floating conversation navigator, search, bookmarks, export tools, a timeline rail, and popup-based layout controls.

For Chinese documentation, see [README.zh-CN.md](./README.zh-CN.md).

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
