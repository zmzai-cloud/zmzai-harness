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

Each boundary is rendered as a keyboard-accessible separator with a visible
drag affordance. Pointer dragging adjusts the adjacent column width within
safe minimum and maximum bounds. Widths are persisted locally so a restart
restores the user's layout.

The session sidebar keeps its existing navbar control. The right workbench gets
its own top-right icon button. On collapse, the workbench column is removed and
the conversation takes the released width. The divider and workbench return at
their saved width when the same button is used to restore it.

At narrow layouts where the workbench is already hidden by the responsive
breakpoint, the desktop collapse state has no visual effect and does not alter
the sidebar behavior.

## Project Session Boundary

The client loads `/api/sessions` for the active project only. It does not request
the cross-project aggregate mode. Session selection is a local selection within
that list: it updates the active session without changing projects or reloading
the app.

Project switching continues to reload the application as it does today, which
causes the active project's SQLite-backed session store and corresponding list
to be loaded. Old project's active-session restoration is scoped out of this
flow: a stale `lastSession` cannot be restored if it is absent from the new
project's list.

The existing API aggregate query may remain available for non-workbench callers,
but it is no longer part of the desktop workbench path. Project badges and
cross-project click routing are removed from the session-list presentation.

## State And Accessibility

Client state owns `sidebarWidth`, `workbenchWidth`, and `workbenchOpen`; each
is initialized from local storage with bounded defaults and persisted after
changes. A shared splitter component uses pointer capture and cleans up on
pointer release/cancel. It exposes `role="separator"`, the correct orientation,
and an accessible label.

The workbench toggle's label changes between “收起右侧工作区” and “展开右侧工作区”.
The sidebar toggle retains its existing labels and state key.

## Verification

- Drag each vertical divider independently and confirm neighboring content does
  not overflow or become unusable.
- Collapse and restore the right workbench; confirm the session sidebar remains
  visible and unchanged.
- Switch between two projects with distinct session histories; each shows only
  its own sessions, and no action in the list switches projects.
- Verify desktop and responsive breakpoints with the app's typecheck and the
  relevant component tests or focused browser inspection.
