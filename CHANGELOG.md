# Changelog

## 0.2.1

- Improve section spacing, description line height and control alignment; stack controls in narrow settings panels.
- Replace all settings dropdowns with consistent themed listboxes, including model and language selection.
- Support keyboard navigation, type-ahead, selected markers, scrolling and viewport-aware popup placement.
- Dismiss and clean up dropdowns when settings rerender or close.

## 0.2.0

- Fetch model IDs from the configured service and select them from a dropdown, with manual entry retained.
- Offer 16 target-language presets and preserve custom language values.
- Switch settings between Simplified Chinese and English immediately, independently of the translation language.
- Cancel model discovery when the endpoint or key changes, settings close, or the plugin unloads.
- Add authenticated GET transport and settings interaction regression tests.

## 0.1.2

- Expose the built bundle at `dist/main.js` so the Obsidian community directory can verify it against the published asset.
- Scope selection debounce timers to their PDF window and use explicit Node timers for network requests.
- Validate model response shapes before accessing their fields.
- Remove a deprecated slider tooltip call.

## 0.1.1

First public release.

- Translate selected PDF words, phrases and passages with an OpenAI-compatible Chat Completions endpoint.
- Automatic, click-to-translate and command-only modes.
- Optional nearby context, configurable target language, timeout and selection length limit.
- Plain-text translation popover, copy button and in-memory cache.
- Cancel superseded requests and dismiss the popover before opening PDF++ context menus.
- Close plugin-owned settings dialogs and cancel requests when unloading.
- Add reproducible release checks, public documentation and an MIT license.

## 0.1.0

Local prototype, tested with Obsidian 1.13.7 and PDF++ 0.40.31 on Windows. Not published as a GitHub release.
