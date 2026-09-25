# PDF Selection Translator 0.2.1

Improved settings spacing and responsive alignment. All settings dropdowns now use themed custom listboxes with keyboard navigation, selected markers and viewport-aware positioning.

- Fetch models from your configured OpenAI-compatible endpoint and select a model from a dropdown. Manual model IDs remain supported.
- Choose from 16 target-language presets or retain a custom language.
- Switch settings between Simplified Chinese and English immediately, independently of translation language.
- Cancel model discovery on endpoint/key changes, settings dismissal and plugin unload.

Model discovery uses authenticated GET /models without sending paper text or generating test completions. Provider-listed models may have different capabilities or quota restrictions; use Test translation to verify a selection. The reading popover remains in Simplified Chinese.

Download pdf-selection-translator-0.2.1.zip and replace the plugin's three installation files, preserving data.json. Restart Obsidian to load the update. Requires Obsidian desktop 1.13.7+.

Validation: 33 automated tests, TypeScript checking, production build and release-asset verification. New tests cover a real local GET request, model selection, live settings language switching, custom language preservation and stale-request cancellation. Real provider availability depends on the configured service.

