# Lectern Workbench Resize And Project Session Isolation

## Scope

Refine the active Lectern desktop workbench in three focused ways:

1. The divider between the session sidebar and conversation, and the divider
   between the conversation and right workbench, are independently draggable.
2. A selected project shows only its own sessions. The session sidebar no longer
   aggregates sessions across projects or jumps to another project when a session
   is selected.
3. The control in the top-right of the workbench collapses and restores only the
   right workbench. It must never collapse the session sidebar.

## Layout And Interaction

The main content area remains a three-column flex layout:

```
session sidebar | conversation | right workbench
```

Each boundary is rendered as a keyboard-accessible vertical separator with a
visible drag affordance. The two separators are 8px wide. On desktop, the
sidebar is clamped to 200-420px, the right workbench is clamped to 320-720px,
and the conversation always retains at least 420px. A drag that would break a
neighbor's minimum is clamped at that limit. Constraints are recalculated from
the current container width on pointer move and window resize; at less than
1180px the workbench is hidden by the existing responsive breakpoint.

Widths are stored globally as `lectern:sidebar-width` and
`lectern:workbench-width`; invalid, stale, or out-of-range values fall back to
the defaults (256px and 384px) and are clamped before rendering. This preserves
one familiar desktop layout across projects without leaking session data.

The session sidebar keeps its existing navbar control. A separate right-workbench
toggle sits in persistent outer chrome immediately before the existing sidebar
toggle, so it remains available after the workbench is removed. Its icon and
accessible label switch between “收起右侧工作区” and “展开右侧工作区”. On
collapse, only the workbench column and its adjacent divider are removed; the
conversation takes the released width. The divider and workbench return at their
saved width when the same outer-chrome button is used to restore them.

At narrow layouts where the workbench is already hidden by the 1180px breakpoint,
the right-workbench toggle is hidden. The stored desktop open/closed state is
unchanged and takes effect again when the window widens.

## Project Session Boundary

The client loads `/api/sessions` for the active project only. It does not request
the cross-project aggregate mode. Session selection is a local selection within
that list: it updates the active session without changing projects or reloading
the app.

Project switching continues to reload the application as it does today, which
causes the active project's SQLite-backed session store and corresponding list
to be loaded. Both the legacy `pendingSession` preference and stale
`lastSession` values are cleared or ignored unless their ID exists in that
loaded active-project list. This prevents a prior cross-project navigation from
restoring a foreign session; a genuine empty list remains the empty state.

The existing API aggregate query may remain available for non-workbench callers,
but it is no longer part of the desktop workbench path. Project badges and
cross-project click routing are removed from the session-list presentation.

## State And Accessibility

Client state owns `sidebarWidth`, `workbenchWidth`, and `workbenchOpen`; each
is initialized from local storage with bounded defaults and persisted after
changes. A shared splitter component uses pointer capture and cleans up on
pointer release/cancel. It is focusable and exposes `role="separator"`,
`aria-orientation="vertical"`, an accessible label, and current/minimum/maximum
pixel values through the corresponding ARIA attributes. Arrow keys resize by
16px, Home chooses the minimum, End chooses the maximum, and visible focus
treatment is provided. The workbench toggle retains focus after collapse.

The sidebar toggle retains its existing labels and state key; it does not read
or write any right-workbench state.

## Verification

- Automated component cases cover both divider clamps and saved widths,
  collapse/restore without changing sidebar state, separator keyboard semantics,
  and narrow-to-wide state restoration.
- API/client state cases cover two projects with distinct session stores plus
  stale `lastSession` and legacy `pendingSession` values.
- Drag each vertical divider independently and confirm neighboring content does
  not overflow or become unusable.
- Collapse and restore the right workbench; confirm the session sidebar remains
  visible and unchanged.
- Switch between two projects with distinct session histories; each shows only
  its own sessions, and no action in the list switches projects.
- Verify desktop and responsive breakpoints with the app's typecheck and a
  focused browser inspection.
