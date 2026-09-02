# Slash Resource References

## Goal

Add a Codex-style slash menu to the Composer. The first enabled resource commands are `/skill` and `/file`; future commands share one registry but remain hidden until enabled.

## Interaction

- Typing `/` at the start of a token opens a filterable command menu.
- `/skill` switches the menu to discovered skills. Selecting one attaches it as the existing mandatory selected skill; its body is not inserted into the textarea.
- `/file` switches the menu to the existing workspace file picker. Selecting one inserts the existing `@path` reference so the user can see and edit it.
- Arrow keys, Enter, Tab, and Escape work consistently. Text that is not an exact command remains ordinary user text.

## Extensibility

`slashCommands` is a typed registry with `id`, label, description, keywords, enabled state, and handler. Only `skill` and `file` are enabled now. Reserved MCP/model/context entries are not rendered or callable until their product behavior exists.

## Data and rendering

Skill selection uses the existing structured `skillId` prompt field and message metadata. File references continue to use the existing `@path` visible syntax and context-file hint. No resource body is concatenated into a user message.

## Tests

- Command matching and filtering.
- `/skill` selection sends a skill id and renders the attachment.
- `/file` enters the existing path picker.
- Disabled registry entries are not visible.
