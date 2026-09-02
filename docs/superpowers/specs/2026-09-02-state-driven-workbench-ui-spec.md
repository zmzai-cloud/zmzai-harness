# Lectern State-Driven Workbench UI Specification

## 1. Purpose

Lectern already has the correct desktop workbench structure:

```
sessions | task conversation + composer | contextual workbench
                              ----------- terminal / debug area -----------
```

The next UI milestone is to make that structure respond to the user's current
job. Today the shell mostly keeps the same emphasis whether the user is about
to start, the agent is working, changes need review, or an artifact is ready.
The result is visually calm but operationally flat: large empty panels compete
with the action that matters now.

This specification defines a state-driven presentation layer. It does not
replace the session, terminal, project-isolation, permission, or git systems.
It coordinates their existing signals into a workbench that makes the next
useful action obvious.

## 2. Product Outcome

Within one glance, a user can answer all of these questions:

1. Which project and task am I in?
2. Is the agent idle, working, waiting for me, ready for review, or finished?
3. What did it change or produce?
4. Where do I inspect, run, debug, approve, or continue it?

The experience should feel like a focused agent development environment, not a
chat page with an IDE attached. It should retain the density and predictability
expected from a mature desktop developer tool while avoiding a permanent wall
of controls.

## 3. Scope

### In scope

- A derived task-presentation state and deterministic panel-priority rules.
- Purposeful empty, active, review, and delivered states.
- A compact task context strip that links project, task, model, safety mode,
  worktree/isolation state, and current agent status.
- A bottom **Debug Area** that starts with Terminal and can grow to include
  Problems, Output, and Debug Console without changing the outer layout.
- Review and result surfaces that automatically follow meaningful task events
  while preserving an explicit user selection.
- Discoverable panel resizing, panel collapsing, keyboard shortcuts, focus,
  and responsive behavior.
- Session-list hierarchy and status treatment that make sessions usable as
  tasks rather than undifferentiated chat history.

### Out of scope

- Agent model routing, provider support, permissions policy, and tool runtime
  changes.
- A VS Code extension, collaborative editing, or a general-purpose IDE.
- Replacing the existing xterm-based interactive PTY implementation.
- New server persistence for analytics, remote workspaces, or sharing.
- Redesigning the Electron title bar beyond removing UI controls that do not
  serve a workbench purpose.

## 4. Design Principles

1. **The current job wins.** The panel most useful for the current state earns
   the visual emphasis; inactive utilities should not occupy permanent space.
2. **Automation is reversible.** Agent events may select a useful panel, but a
   user-selected tab is never stolen during the same task unless the user asks
   to return to automatic mode.
3. **The artifact is first-class.** A generated HTML page, changed source file,
   test result, local URL, or export is an outcome, not an attachment buried in
   chat.
4. **Stable geography, adaptive density.** Sidebar, conversation, contextual
   workbench, and debug area keep their positions. Their visibility and
   emphasis change with state; the user never has to relearn the layout.
5. **No unexplained empty surfaces.** Every empty panel states its purpose and
   its next meaningful input, in one short sentence.
6. **Keyboard parity.** Essential navigation and panel operations are possible
   without the pointer; pointer affordances remain obvious to new users.

## 5. Users And Core Jobs

| User | Core job | Success signal |
| --- | --- | --- |
| Builder | Give an agent a bounded task and follow progress | They see current activity, touched files, and any required approval without hunting. |
| Reviewer | Understand and accept or reject an agent's code changes | They reach the diff, tests, and relevant task context in one transition. |
| Debugger | Run a command and inspect failures beside the task | The terminal has a real shell, clear tabs, and does not hide the relevant task state. |
| Deliverer | Open or validate the result produced by the task | The artifact or local URL is foregrounded immediately after it is created. |

## 6. Presentation State Model

`TaskPresentationState` is client-derived and deliberately has no independent
server storage. Its input is the active `SessionInfo`, `ChatViewData`, terminal
metadata, git/diff state, and previewable edited paths.

```ts
type TaskPresentationState =
  | "idle"
  | "running"
  | "needs_input"
  | "review_ready"
  | "delivered"
  | "failed";

type PresentationContext = {
  sessionId: string | null;
  sessionStatus: "idle" | "running" | "waiting" | "completed" | "failed";
  permissionRequest: PermissionRequest | null;
  editedPaths: string[];
  previewablePaths: string[];
  terminal: { hasLiveProcess: boolean; lastExitCode?: number };
  explicitWorkbenchTab: "review" | "files" | "preview" | null;
  explicitDebugTab: "terminal" | "problems" | "output" | "debug" | null;
};
```

### Precedence (explicit state machine)

`deriveTaskPresentation` is a **pure function** evaluated as an ordered
predicate table. Each row is checked top-to-bottom; the first row whose
condition matches wins. There is no cross-row state (e.g. "no newer running
event") — every condition references only the `PresentationContext` fields.

| # | Condition (evaluated in order) | State |
| --- | --- | --- |
| 1 | `sessionId === null`, or session has no meaningful task events | `idle` |
| 2 | `permissionRequest !== null` (approval/clarification/conflict addressed to the user) | `needs_input` |
| 3 | `sessionStatus === "running"` or `terminal.hasLiveProcess` | `running` |
| 4 | `sessionStatus === "failed"` and `previewablePaths.length === 0` and `editedPaths.length === 0` | `failed` |
| 5 | `previewablePaths.length > 0` (a completed task produced a previewable artifact) | `delivered` |
| 6 | `editedPaths.length > 0` or git changes present (reviewable but not previewable) | `review_ready` |
| 7 | fallthrough | `idle` |

Key design constraints implied by this table:

- **`running` wins over `failed`** (rows 3 vs 4). A session is only presented as
  `failed` once it has stopped and produced no artifact or edits to inspect. A
  transiently non-zero command exit while the agent keeps working must not flip
  the strip to `failed`.
- **`failed` and `delivered` are not mutually exclusive.** A task that "failed"
  (non-zero exit, a rejected command) but still produced a previewable artifact
  is presented as `delivered`, because the usable outcome exists. The `failed`
  row (4) only fires when there is *nothing* left to review or open. When the
  outcome *does* surface via `delivered`/`review_ready`, the strip still exposes
  the underlying failure as a secondary badge (§7.6), never swallowing it.
- **`delivered` ranks above `review_ready`** (rows 5 vs 6): an artifact is a
  stronger outcome than a set of edits. When both exist, the artifact is
  foregrounded and the edits remain one click away in Review.
- Every row must have a unit test in `deriveTaskPresentation`'s suite (§13).

`failed` never hides the conversation or terminal. `needs_input` never
auto-opens a destructive surface; it foregrounds the existing permission or
reply UI.

## 7. State-Specific UI Requirements

### 7.1 Idle

**Intent:** begin a task with confidence rather than stare at empty equipment.

- The composer is the visual anchor of the central column. It remains compact
  enough to keep recent task history visible when one exists.
- The central empty state shows the selected project and a concise prompt to
  describe the desired outcome. It must not contain tutorial prose or a large
  marketing-style illustration.
- The right workbench displays a quiet project-context card only when open:
  current root, branch if available, current change count, and the three
  available surfaces. It does not open Files merely to fill space.
- The Debug Area is closed by default for a new idle session, unless the user
  explicitly left it open for the same project. `Cmd/Ctrl+J` always toggles it.
- Recent output or a running terminal process is sufficient reason to preserve
  the user's existing Debug Area visibility.

### 7.2 Running

**Intent:** make progress legible without distracting from the conversation.

- The task context strip shows a positive running state, elapsed time, current
  operation label, model, and permission mode. The operation label must be
  derived from actual events, never fabricated progress text.
- `ChatView` remains the primary surface. Expanded tool groups show the active
  operation and a compact summary of completed operations.
- The right workbench's automatic tab is **Files** when the latest meaningful
  event touched a file; otherwise it remains on the user's chosen tab.
- A live task command causes the Debug Area to show an unobtrusive activity dot
  and tab badge. It does not force-open the panel or steal keyboard focus.
- The composer is available for a follow-up, but the stop action is visually
  adjacent and unambiguous while the agent is active.

### 7.3 Needs Input

**Intent:** make a blocked task impossible to miss and easy to resolve.

- The task context strip changes to an attention state and names the blocking
  category: approval, clarification, or conflict.
- The relevant in-conversation approval/reply block is scrolled into view once
  when it first appears. Do not repeat this behavior after the user scrolls.
  The "once" key is the permission request's **message id**: the same message
  id scrolls at most once, even across SSE refreshes, tab switches, or
  re-entering the session.
- The session list gets a small attention marker; it is not merely another
  green/gray activity dot.
- The right workbench and Debug Area retain the user's state. A permission
  request must not unexpectedly open a terminal or diff.

### 7.4 Review Ready

**Intent:** transition from “agent did work” to “I can judge the work.”

- If the user has not explicitly selected a workbench tab in this task, select
  **Review** when the first edited path or git diff arrives.
- The Review header shows changed-file count, additions/deletions when known,
  tests/commands summary when known, and the task's last completion status.
- The changed-file list prioritizes paths associated with the active task,
  then other working-tree changes. It clearly labels that distinction.
- Review must provide a path to Files for source inspection and to Preview for
  the generated artifact, but must not duplicate a full file tree inside the
  diff panel.
- The Debug Area badge communicates failed tests or a non-zero terminal exit;
  it remains closed unless the user has already chosen to keep it visible.

### 7.5 Delivered

**Intent:** foreground the usable outcome rather than the implementation.

- If a previewable artifact was created or changed, and the user has not chosen
  another tab, select **Preview** and select the most recent supported artifact.
- The result header identifies the file or local URL, offers desktop/mobile
  viewport choices, refresh, and open-in-browser. It never describes the
  preview system itself.
- A non-previewable delivery shows a concise outcome row: file(s), command
  result, local URL if one was detected, and a direct route to Review.
- The composer changes from a generic prompt to a compact continuation prompt;
  it must not imply that the task is still running.

### 7.6 Failed

**Intent:** preserve diagnosis context and offer a single clear recovery path.

- The context strip exposes the failure state and last failed operation.
- If there is a failed command, the Debug Area receives an error badge. If it
  is already open, **Terminal** or **Output** becomes the automatic tab only
  when the user did not explicitly choose another debug tab.
- Conversation shows the failure result and a direct retry/continue action.
- Existing changed files and results remain available; failure never clears the
  workbench selection or terminal buffer.
- When the task failed but a previewable artifact or editable path *does* exist,
  the presentation state is `delivered`/`review_ready` (per §6 rows 5–6), not
  `failed`. In that case the strip surfaces the failure as a secondary badge and
  the outcome panel remains the foreground; the failure is never swallowed.

## 8. Information Architecture

### 8.1 Persistent geometry

The desktop composition remains four stable regions:

```
┌──────────────┬───────────────────────────────────────────┬──────────────────┐
│ Task list    │ Task conversation and composer            │ Contextual       │
│              │                                           │ workbench        │
├──────────────┴───────────────────────────────────────────┴──────────────────┤
│ Debug Area: Terminal | Problems | Output | Debug Console                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

- The session sidebar is project-scoped and keeps the existing session-isolation
  contract.
- The conversation remains the source of truth for agent reasoning, approvals,
  tool calls, and replies.
- The right workbench contains only **Review**, **Files**, and **Preview**.
- The bottom Debug Area spans the conversation and workbench columns, never the
  session sidebar.

### 8.2 Task context strip

Replace the low-information combination of title, status chip, and isolated
toolbar controls with one compact strip at the top of the central region.

It contains, in descending visual priority:

1. task title and current state;
2. project/worktree identity;
3. active operation or completion summary;
4. model and auto/approval mode;
5. compact terminal/test/change badges when relevant.

It must be single-line at normal desktop width, wrap only its secondary metadata
at narrow widths, and never consume a hero-scale vertical block.

### 8.3 Session list

The session list has these visual groups in order:

1. **Needs attention**: blocked or failed sessions.
2. **In progress**: running sessions and live terminal tasks.
3. **Recent**: completed or idle sessions ordered by activity.
4. **Archived**: behind the existing archive entry point.

Each row exposes title, one durable status marker, relative/absolute recency,
and a subdued project/model descriptor only where it helps distinguish a task.
The active task has both a background treatment and a left edge marker; color
is never its only indication.

### 8.4 Debug Area

The current `TerminalPane` becomes the first tab in `DebugArea`.

| Tab | Phase | Content |
| --- | --- | --- |
| Terminal | 1 | Existing interactive PTY terminal tabs and shell lifecycle. |
| Problems | 2 | Parsed diagnostics from agent tools and terminal output; grouped by file. |
| Output | 2 | Structured task/runtime stream with filterable sources. |
| Debug Console | 3 | Interactive debugging protocol console, introduced only with a real debugger. |

Phase 1 ships the tab rail with Terminal live and the other labels omitted until
they have working content. Disabled placeholder tabs are prohibited.

Terminal requirements for Phase 1:

- VS Code-like terminal tab row: terminal name, dirty/running state, close,
  new terminal, shell selection, split, clear, restart, and overflow actions.
- Root and session isolation are visible in a compact tooltip or terminal
  details menu, not repeated in terminal output.
- `Cmd/Ctrl+J` toggles the entire Debug Area, preserving PTY processes and
  scrollback. `Cmd/Ctrl+\`` focuses the active terminal when it is open.
- Resize synchronization is debounced and only follows a committed layout
  change. Visual reflow, output updates, and polling/SSE updates must never
  generate a resize request loop. "Committed layout change" means exactly:
  splitter drag release, splitter double-click reset, panel collapse/expand,
  or a window/container resize event. Incremental terminal output, status
  changes, and React re-renders must **never** call xterm `fit()`. This is a
  Phase 1 hard gate (§13), not a visual-quality nice-to-have.

## 9. Interaction Contract

### 9.1 Automatic selection policy

`WorkbenchPanel` stores per-session selection intent:

```ts
type WorkbenchSelection = {
  tab: "review" | "files" | "preview";
  source: "automatic" | "user";
  selectedPath?: string;
};
```

- A tab click sets `source: "user"` for the active session.
- State transitions may update a selection only while the source is
  `"automatic"`.
- New session, deleted session, and explicit “Follow task” action reset source
  to `"automatic"`.
- `openFile` is always an explicit user-intent operation and selects Files.
- A result artifact selects Preview only if selection source is automatic.

The same contract applies to the future debug tabs. This prevents automation
from turning the workbench into a flickering dashboard.

### 9.2 Resizing and collapse

- All splitters have a visible 8px target, resize cursor, focused treatment,
  and subtle hover rail. They remain keyboard-accessible separators.
- Double-clicking a splitter restores its documented default dimension.
- Vertical splitters retain their existing desktop bounds; the horizontal debug
  splitter retains a minimum useful terminal height.
- Right workbench and Debug Area have separate, directional collapse controls.
  A collapse control never changes any other region's open state.
- Persist widths/heights and open state per user, while preserving active task
  selections per session. A project may not inherit another project's selected
  session or task context.

### 9.3 Keyboard map

| Shortcut | Behavior |
| --- | --- |
| `Cmd/Ctrl+J` | Toggle Debug Area. |
| `Cmd/Ctrl+\`` | Open Debug Area if needed and focus active terminal. |
| `Cmd/Ctrl+B` | Toggle session sidebar. |
| `Cmd/Ctrl+Shift+E` | Focus Files in the right workbench. |
| `Cmd/Ctrl+Shift+G` | Focus Review in the right workbench. |
| `Cmd/Ctrl+Shift+R` | Focus Preview in the right workbench. |
| `Cmd/Ctrl+K` | Open command palette. |
| Arrow keys / Home / End on splitter | Resize the focused region. |

The implementation must not intercept an OS-reserved shortcut and must not
steal keystrokes from a focused terminal, editor, or text composer except for
the documented global panel toggles.

Before shipping, confirm each `Cmd/Ctrl+Shift+*` binding in the Electron main
process `before-input-event` layer that it is actually registerable on both
macOS and Windows. `Cmd/Ctrl+Shift+G` (Git) and `Cmd/Ctrl+Shift+R` (browser
reload) have known conflicts on macOS; if a binding is reserved, demote it to a
menu/command-palette-only action rather than registering a conflicting
accelerator.

## 10. Visual System Requirements

- Use the established neutral desktop palette; dark terminal remains visually
  distinct without becoming the dominant surface while empty.
- Keep cards for repeated list rows, modals, and genuinely framed tools only.
  The main workbench regions are unframed bands divided by hairline borders.
- Use a 4px spacing rhythm and a small set of dense control heights. Toolbars
  use icon buttons with tooltip and accessible name; commands use text or
  icon-plus-text only when an icon alone would be ambiguous.
- State color is supplementary: each state also has an icon, label, and text
  description available to screen readers.
- Empty states use one compact central message and one relevant action; no
  decorative illustrations, long instruction manuals, or generic slogans.
- Avoid consecutive competing pills. Status, model, and mode are structured as
  metadata, not three equally weighted buttons.
- At desktop widths, task title and primary state are readable without opening
  a menu. At constrained widths, secondary metadata truncates before title and
  state do.

## 11. Technical Design

### 11.1 New client modules

| Module | Responsibility |
| --- | --- |
| `lib/task-presentation.ts` | Pure derivation of `TaskPresentationState`, active operation summary, and automatic panel recommendation. Unit-testable with no React dependency. |
| `components/TaskContextStrip.tsx` | Renders task/project/status metadata and context actions. Receives a derived view model only. |
| `components/DebugArea.tsx` | Owns bottom tab state, terminal chrome, debug badges, visibility, focus behavior, and future tab registration. It hosts `TerminalPane` for Phase 1. |
| `components/WorkbenchPanel.tsx` | Retains tab/content rendering but consumes the selection contract and automatic recommendation rather than embedding transition policy. |
| `components/SessionList.tsx` | Receives grouped session view models rather than inferring visual priority inside row markup. |

`app/page.tsx` stays the orchestration boundary. It owns active project/session,
server event subscription, persistent layout state, derived presentation state,
and cross-region commands. It must not accumulate status-to-tab conditional
trees; those belong in `lib/task-presentation.ts`.

### 11.2 State and event flow

1. Existing session event ingestion updates `ChatViewData`, status,
   permissions, edited paths, command metadata, and terminal metadata.
2. `app/page.tsx` constructs `PresentationContext` for the active session.
3. `deriveTaskPresentation(context)` returns state, context-strip view model,
   workbench recommendation, and Debug Area badge model.
4. `WorkbenchPanel` applies a recommendation only when its per-session
   selection source is automatic.
5. `DebugArea` applies a recommendation only when its tab source is automatic;
   it never opens itself merely because new output arrives.
6. Any direct user tab, file, terminal, or splitter action persists the local
   intent and emits no agent/server event.

### 11.3 API impact

Phase 1 requires no new server route. It composes existing data:

- `GET /api/sessions` and session event stream for session status/activity.
- `GET /api/git/diff` or existing status endpoint for review metadata.
- Existing root-constrained filesystem routes for file/artifact paths.
- Existing terminal list/stream lifecycle for live process state.

Phase 2 Problems/Output may add a structured diagnostics contract. Do not parse
arbitrary terminal ANSI text in the UI as the sole source of truth. Tool events
should carry optional diagnostic records with `path`, `line`, `column`,
`severity`, `message`, and `source`.

### 11.4 Persistence keys

Existing keys remain authoritative for geometry:

- `lectern:sidebar-width`
- `lectern:workbench-width`
- `lectern:workbench-open`
- `lectern:bottom-panel-height`
- `lectern:bottom-panel-open`

Add a namespaced per-session selection record only if it is small and has a
clear eviction strategy:

```
lectern:workbench-selection:<project-id>:<session-id>
```

Do not persist transient agent status, terminal output, permission requests, or
foreign project session IDs in browser storage.

## 12. Delivery Plan

### Phase 1: State-aware shell

1. Add pure presentation-state derivation with focused tests.
2. Add `TaskContextStrip` and replace duplicated header status controls.
3. Add automatic/user selection-source handling to Review, Files, and Preview.
4. Introduce `DebugArea` as a Terminal-only wrapper, preserving the current
   PTY lifecycle and `Cmd/Ctrl+J` behavior.
5. Make terminal chrome and panel affordances discoverable; add splitter reset.
6. Improve idle, needs-input, review-ready, delivered, and failed empty states.

### Phase 2: Review and diagnostic density

1. Add grouped session statuses and attention markers.
2. Add task-scoped review summary and test/command outcome row.
3. Add structured Problems and Output only after upstream diagnostic events are
   available.

### Phase 3: Delivery polish

1. Detect and render local development URLs as delivery outcomes.
2. Add result action menus appropriate to each artifact type.
3. Add a real debug-console integration only with an actual debugger protocol.

## 13. Acceptance Criteria

### Functional

- A new idle task opens with Debug Area closed unless the user explicitly kept
  it open in this project; `Cmd/Ctrl+J` always works.
- A running agent updates the context strip from real events and never forces
  focus into a panel.
- The first task-scoped file change selects Files only while the user has not
  made a workbench choice.
- The first reviewable task-scoped change selects Review only while selection
  is automatic.
- The most recent previewable task artifact selects Preview only while
  selection is automatic.
- A user-selected Review, Files, Preview, Terminal, or future debug tab remains
  selected through later agent events in that task.
- A permission request is visible in conversation and marked in the session
  sidebar without changing the user's chosen workbench/debug panel.
- Collapse/expand, drag, keyboard resize, double-click reset, and `Cmd/Ctrl+J`
  preserve the correct independent region state.
- Switching project/session cannot display a previous task's selected artifact,
  terminal, review diff, or context-strip metadata.
- Terminal resize requests occur only after a committed terminal layout change;
  output events and ordinary React renders produce zero resize requests. This
  is a **hard gate**: it must pass before Phase 1 is considered done, and is
  verified by instrumenting terminal API calls (§13 Verification), not by
  visual inspection alone.

### Visual and interaction quality

- At 1440px wide, all four regions remain usable when opened, with no text
  collision, clipped toolbar labels, or overlapping controls. This criterion
  applies to the **Phase 1 terminal-only Debug Area**; the Phase 2/3 multi-tab
  Problems/Output/Debug Console surface is re-validated separately when those
  tabs ship.
- At the responsive breakpoint, the workbench's collapsed behavior retains an
  accessible route to its contents and restores the user's desktop layout when
  width returns.
- All icon-only controls have tooltip, visible focus ring, and accessible name.
- Status is understandable in monochrome and with a screen reader.
- Empty panels never display a large blank surface without an explanation or
  purpose.

### Verification

- Unit-test every `TaskPresentationState` precedence case and automatic-tab
  recommendation.
- Component-test selection-source preservation across state transitions.
- Browser-test idle, running, needs-input, review-ready, delivered, and failed
  screenshots at desktop and constrained desktop widths.
- Browser-test the complete keyboard map, splitter drag/reset, independent
  collapse controls, and restored persistent layout.
- Instrument terminal API calls during a resize/re-render test and assert no
  duplicate resize loop.
- Run `pnpm typecheck`, focused component tests, and a real Electron smoke test
  with two isolated project sessions before release.

## 14. Success Measures

This release is successful when a hands-on evaluator can start a task, follow a
file change, inspect the diff, open the generated artifact, run a terminal
command, and return to the task without asking where each capability lives.

The team should capture lightweight local measures during dogfooding:

- time from task completion to first artifact/diff inspection;
- number of manual tab changes before reaching the changed file or artifact;
- number of accidental panel opens/collapses;
- duplicate terminal resize requests per deliberate resize operation;
- keyboard-path completion for opening, focusing, and closing the terminal.

No remote analytics is required for Phase 1. Short recorded usability sessions
and repeatable browser checks are sufficient to validate the design.
