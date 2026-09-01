# Lectern Landing Page: Immersive Product Showcase

## Status

Approved design direction. The user selected the immersive product-showcase direction after reviewing visual comparisons.

## Purpose

The current Lectern landing page accurately describes the product but reads primarily as a technical feature list. This revision should make the desktop workbench tangible at first glance while preserving the existing local-first, editorial visual system.

The page must communicate three ideas before a visitor reaches the download area:

1. Lectern is a desktop workbench for running coding agents.
2. The user can see and control the agent's work through tasks, permissions, and diffs.
3. Execution and user data remain on the user's machine.

## Scope

Update the static landing page at the workspace root, `zmzai-lectern-landing.html`. Do not change the Electron or Next.js application.

Keep the existing release links, FAQ answers, ecosystem links, local-first claims, and download compatibility details. Do not introduce unverified usage statistics, testimonials, customer logos, or cloud-storage claims.

## Information Architecture

### 1. Hero: desktop workbench as the primary visual

Replace the current split hero terminal with a dark, immersive hero band.

- Keep the product lockup and direct download CTA.
- Use the headline "把 agent loop 装回桌面。".
- Include a short supporting line that distinguishes cloud reasoning from local execution without implying that all data stays offline.
- Build one high-fidelity Lectern workbench composition: session rail, task conversation, changed-file panel, execution status, and audit state.
- Use CSS and semantic HTML to create the illustration. It must be recognizably based on actual Lectern interface structures, not an abstract dashboard or decorative illustration.
- Add restrained ambient motion: a slow desktop-window drift and sequential status updates. Honor `prefers-reduced-motion` by disabling all animation.

### 2. Workflow: a visible control loop

Keep the three-step flow, but pair each step with a distinct compact UI vignette:

| Step | Message | Visual emphasis |
| --- | --- | --- |
| Task | State intent in natural language | Prompt and session context |
| Authorize | Sensitive actions wait for a decision | Permission request with an explicit allow action |
| Review | Changes stay reviewable before the user decides | Diff/file-change panel and successful test state |

Avoid repetitive card grids. Each vignette should be a framed product surface with a meaningful UI state and a short explanation.

### 3. Capabilities: concise proof points

Retain the six current capabilities and accurate copy. Shorten visual density with a numbered editorial list and include a single wider diff-review illustration beside or beneath it. The illustration is evidence for the claims, not a fourth generic card.

### 4. Local-first: trust through visible artifacts

Retain the sessions, audit, and resume information. Present it as three connected system artifacts rather than standalone feature cards:

- `zmzai.db` for sessions
- `audit.db` for permissions and actions
- event sequence/reconnect indicator for resume

Use neutral surfaces and the established live green for good-state indicators. Do not use the hero magenta here.

### 5. Download, FAQ, ecosystem, closing CTA

Keep existing content and links. Refine spacing, visual hierarchy, and section transitions only. Download remains a practical compatibility table, not a marketing panel.

## Visual System

- Preserve the existing "Ink Frame" token palette: warm white reading surface, near-black product surfaces, graphite lines, live green status, and limited magenta inside the dark hero only.
- Preserve the MiSans, Noto Serif SC, and JetBrains Mono typographic roles.
- Use product-window framing, narrow borders, and shadows to create depth. Keep section containers unframed and editorial.
- The hero may use a subtle grid/noise texture generated through CSS. Do not add gradient blobs or unrelated decorative elements.
- Maintain the existing desktop and mobile accessibility patterns. On mobile, stack product composition below headline and preserve enough detail for it to remain legible rather than shrinking it into a thumbnail.

## Interaction and Accessibility

- Existing navigation anchors, download links, GitHub links, FAQ disclosure behavior, and reveal-on-scroll behavior must continue working.
- All animated decoration is non-essential and disabled for `prefers-reduced-motion`.
- Product illustrations use real text where meaningful and mark decorative pieces with `aria-hidden` where appropriate.
- Ensure visual text has sufficient contrast, buttons retain keyboard focus styling, and no critical information is conveyed solely by color.

## Implementation Boundaries

- Work is limited to `zmzai-lectern-landing.html` and new local image assets only if needed. The planned version should not require external stock assets.
- Reuse existing CSS variables and responsive breakpoints where possible.
- Keep the page standalone and deployable through its existing hosting flow; no build-tool or app dependency changes.
- Do not overwrite current unrelated worktree changes in `zmzai-lectern/components/TerminalPane.tsx` or `zmzai-lectern/components/WorkbenchPanel.tsx`.

## Verification

1. Open the resulting page at desktop and mobile dimensions.
2. Confirm hero, workflow vignettes, capability illustration, and local-first artifacts fit without clipping or overlapping.
3. Confirm links and anchor navigation still resolve.
4. Test reduced-motion mode, keyboard focus, and FAQ disclosure.
5. Validate that the static HTML loads with no JavaScript errors and that the existing page's release URLs remain unchanged.
