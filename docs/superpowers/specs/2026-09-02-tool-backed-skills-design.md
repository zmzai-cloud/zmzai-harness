# Tool-backed Skill Loading

## Goal

Replace the current client-side `SKILL.md` string concatenation with a tool-backed, progressively disclosed skill flow. A user-selected skill is mandatory for that run, but the raw user message remains exactly the text the user entered.

## User-visible behavior

- Selecting a skill and sending `使用这个 skill 帮我` creates a normal user message whose text is only `使用这个 skill 帮我`.
- The message renders a compact skill attachment above the text: cube icon, the skill name in blue, then the user text. It never renders the `SKILL.md` body.
- On replay, pagination, reconnect, and search, the attachment remains visible because the selected skill is message metadata, not transient composer state.
- A selected skill is mandatory: the runner loads it before the model begins the task. This preloading is not represented as a fake model tool call or a user-message part. A later model-initiated `skill` call renders normally in agent activity; its content is never copied into the user message.

## Architecture

### 1. Message and prompt contract

Add an optional `skill` metadata value to framework `PromptInput`, queued prompts, and persisted user `MessageInfo`:

```ts
type SelectedSkill = { id: string; name: string; digest: string }
```

The browser submits `{ text, skillId }`; the Lectern prompt route first resolves the session's fixed workspace root (including a worktree root), then resolves and validates the id only inside that root. It turns it into `{ id, name, digest }` and passes it to `runner.prompt`. The browser never fetches a skill body in order to send a prompt. Rewind revalidates the stored digest and rejects the replay if the required skill has changed, rather than silently applying different mandatory instructions.

Queued prompts retain that same metadata so a prompt submitted while another run is active cannot lose its mandatory skill. The prompt route validates and reads the selected body before enqueueing, so the initial response can truthfully reject stale or unreadable selections. It stores the digest; when the item reaches the queue head the runner rechecks that digest, persists the raw user message first, and emits a durable run error if the skill changed or vanished in the interim.

### 2. Skill catalog and reader

Move discovery and file reading into a server-only Lectern skill service shared by `/api/skills` and the runtime wiring. It accepts an explicit workspace root, keeps the existing allowed roots and source precedence, normalizes identifiers, rejects traversal and symlink escape, and returns either metadata or one selected file's body.

Catalog discovery reads only a size-bounded frontmatter prefix and excludes malformed, non-regular, or oversized entries. Full body reads perform the same containment checks and enforce a documented byte cap; an over-cap skill returns a diagnosable error rather than consuming the full prompt budget.

Expose one framework `skill` tool for every run. Its description lists only available skill names and descriptions; its `id` parameter is an enum / validated stable identifier, with name used only for display. Calling it returns the selected `SKILL.md` body plus an opaque, per-run capability handle (not a host path). A later scoped reader accepts only issued handles and relative paths, resolving files beneath their server-side bound root with containment and symlink checks. References and scripts can therefore be read only when needed without exposing a home directory or allowing a forged handle to select another skill root.

`GET /api/skills?sessionId=<id>` lists against that existing session's fixed project/worktree root. With no session id, it lists against the active project for the new-session Composer; the prompt route repeats resolution after session creation, so the listing and selection are never trusted as authorization.

### 3. Mandatory selected skill

For a prompt with `skill`, the runner validates the stored digest, resolves the body before creating the model agent, and constructs an explicit `mandatorySkillContext`: a fixed trusted boundary containing the id, name, body, and opaque root handle. This context is appended to the in-memory `systemPrompt` for that run; it is not merely a statement that the skill was loaded. The instruction and body are never persisted as a user message.

The framework stays product-agnostic: add `resolveMandatorySkill(session, selectedSkill)` to `RunnerDeps`. Lectern injects this resolver when it constructs each runtime; it binds the request's session/worktree root to the server-only skill service, checks the digest, reads the body, and issues the run-local scoped-reader capability. The runner neither imports Lectern modules nor discovers skills through an active-workspace global.

The selected skill body is the only skill body loaded automatically. All other skills remain metadata-only until the model calls the `skill` tool. This is the required progressive-disclosure boundary. A selected skill applies only to the run caused by that message; it is not silently carried into a later turn. Rewind inherits the original selected-skill metadata and recreates the same mandatory context.

Route-time validation failures are returned as HTTP errors before a message is created. Any later failure (including the race between validation and an immediate detached run, or a queued prompt reaching the queue head) persists the raw user message and emits a durable visible run error rather than silently running without a user-requested mandatory instruction.

### 4. Rendering

Extend the transcript event payload and `ChatProjector`'s internal user-message shape with optional selected-skill metadata. Render the attachment in `ChatView` using existing theme tokens; use a cube-like icon and a blue skill label, matching the supplied reference. Do not surface markdown from any code path in the user bubble.

## Data flow

```text
Composer: text + skillId
  -> POST /prompt validates and size-checks selected body, resolves { id, name, digest }
  -> SessionRunner persists raw text + selected-skill metadata
  -> queue head revalidates digest via injected resolver
     -> mismatch/read failure: durable run error (no agent execution)
     -> success: chosen body enters bounded, hidden mandatorySkillContext
  -> model receives raw user text and uses `skill` tool for other bodies
  -> transcript returns raw text + skill metadata
  -> ChatView renders compact attachment + raw text
```

## Error handling

- Route-time unknown or stale `skillId`: HTTP 400; no message is created.
- Route-time selected body unreadable or beyond its cap: HTTP 422; no message is created.
- A selected skill changes after a queued request was accepted: preserve the raw user message and emit a durable visible run error; do not execute with a changed body.
- Rewind with a changed selected-skill digest: HTTP 409; do not run with altered mandatory instructions.
- An unselected tool request for an unknown skill: normal tool error with no filesystem path disclosure beyond configured roots.
- Legacy transcript records without `skill` remain unchanged and render normally.

## Tests

- Composer request test: selected skill sends an id, never markdown.
- Prompt-route tests: resolve/validate selected id against the session-aware catalog; reject missing and unreadable skills before enqueue; new-session listing uses the active root only.
- Runner tests: selected-skill context is mandatory but not present in persisted user content; queued prompt retains its digest and yields a durable failure if it changes before execution.
- Skill-tool tests: catalog is metadata-only until execute; body and opaque run-bound capability are returned only for the requested stable id; forged capabilities, duplicate names, traversal, symlink escape, oversized content, and absolute-path leakage are rejected.
- Transcript/projector/UI tests: persisted selected metadata produces the compact attachment across reload; rewind preserves the digest and rejects changed instructions; user text, session title seed, search text, and LLM title input exclude skill markdown.

## Out of scope

- Changing installed-skill discovery locations.
- Making skills globally auto-triggered without user selection.
- Per-skill permission policies or a skill marketplace.
