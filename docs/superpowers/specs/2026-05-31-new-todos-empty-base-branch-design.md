# New-Todos Empty Base Branch Handling Design

**Date:** 2026-05-31
**Status:** Approved (pending user spec review)

## Problem

When the new-todos filter is enabled (`filtering.newTodosOnly`) but the base branch (`filtering.newTodosGitBaseBranch`) is empty (`""`), the current behavior is misleading:

- `newTodoFilter.refresh()` early-returns before any git runs (`src/newTodoFilter.js:119-125`), leaving `coveredRoots`/`failedRoots` empty.
- Every file therefore classifies as `'no-repo'`, so the tree shows the status node **"N not in a git repository"** — which is wrong; the real cause is *no base branch configured*.
- No warning popup fires (the rebuild popup only fires on `summary.allFailed === true`, `src/extension.js:2557-2562`; the empty-branch path returns `allFailed: false`).

Result: todos still show fail-open (because `newTodosShowUndiffableFiles` defaults true), but the reason given is inaccurate and there's no popup pointing at the real fix.

This is distinct from the nonexistent-branch bug (a git-diff settle race), which is fixed separately in `docs/superpowers/plans/2026-05-31-fix-git-diff-nonexistent-branch-race.md`.

## Goal

When the filter is enabled but the base branch is empty, treat it as a **config error**: surface a clear, distinct message via popup and file decoration, plus an additive (non-dominant) tooltip line in the existing status node — while still showing todos fail-open per `newTodosShowUndiffableFiles`.

## Scope

**In scope:** runtime behavior when the empty-branch state exists — classification, popup, status-node tooltip, file decoration, fail-open/closed.

**Out of scope:**
- Tightening entry points (the toggle command at `src/extension.js:3883-3908` already prompts for a branch; the empty state is still reachable by editing settings directly — we do NOT prevent or repair that here).
- The nonexistent-branch race fix (separate, already planned/executed).

## Key design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Behavior on empty branch | Treat as config error | Mirrors nonexistent-branch behavior; clear and still usable (fail-open) |
| Messaging granularity | Distinct from `diff-failed` | New `'no-branch'` reason; accurate cause ("no branch" vs "bad branch") |
| Scope | Runtime behavior only | Focused; config-error messaging makes the state self-explanatory |
| Status node | Additive tooltip bucket, no dominant label | Avoids hiding `no-repo`/`diff-failed` counts in (future) multi-repo scans |
| `no-branch` model | Global module flag | Branch is global this milestone; per-root is YAGNI until per-repo branch config exists (see Forward note) |

### Forward note (per-repo base branch milestone)

A future milestone will allow configuring the base branch **per repo**. At that point `no-branch` becomes a per-root condition that can co-occur with `no-repo`/`diff-failed` in the same scan.

Already future-proofed by this design:

- The **status node** is additive (one more tooltip bucket, no priority label), so it coexists correctly when `no-branch` and other reasons appear together.

Will need rework:

- The **global `missingBranch` flag** in `newTodoFilter` will become per-root state. This is intentional YAGNI for now — there is no per-repo branch config to populate per-root state yet, and the per-repo milestone will redesign root tracking anyway.

## Components & data flow

A new third undiffable category `'no-branch'` flows through the existing undiffable pipeline alongside `'no-repo'` and `'diff-failed'`.

### 1. `src/newTodoFilter.js`

- Add module flag `var missingBranch = false;`
- In `refresh( branch, roots, globs )`: treat a branch that is empty or whitespace-only as missing. Set `missingBranch = ( enabled === true && isBlank( branch ) )` where `isBlank(b)` is `!b || String(b).trim() === ''`. Reset on every `refresh` call (it is recomputed each time, so no stale state).
- The existing early-return path (lines 119-125) still clears `rangesByPath`/`coveredRoots`/`failedRoots`; it now also has `missingBranch` already set above the early return.
- `classifyUndiffable( fsPath )`: **first** check — if `rangesByPath.get( fsPath )` is falsy AND `missingBranch === true`, return `'no-branch'`. Otherwise fall through to the existing covered/failed/no-repo logic.
- `isNewTodo` is unchanged: `'no-branch'` is a non-null reason, so the existing fail-open/closed branch (`return showUndiffableFiles === true;`) already applies.

### 2. `src/extension.js`

- `scannedUndiffable` (line 99) gains a `'no-branch'` set: `{ 'no-repo': new Set(), 'diff-failed': new Set(), 'no-branch': new Set() }`.
- Clear it on rebuild (alongside lines 2531-2532).
- `applyNewTodoFilterToResults` (line 2250): accept `'no-branch'` as a tracked reason: `if( reason === 'no-repo' || reason === 'diff-failed' || reason === 'no-branch' )`.
- `setNewTodoStatus` payload (line 2580): add `noBranch: scannedUndiffable['no-branch'].size`.
- Rebuild popup (lines 2557-2562): add a branch-empty case. When `newTodoFilter.isEnabled() === true` and the configured base branch is blank, show:
  `"<DISPLAY_NAME>: no base branch set for new-todos filter (set filtering.newTodosGitBaseBranch)"`.
  This is mutually exclusive with the existing `allFailed` warning **this milestone** (empty branch never runs git, so `allFailed` is false). Implement as: if branch blank → show the no-branch warning; else if `allFailed` → show the existing warning.

### 3. `src/tree.js` (status node, lines 566-606)

- Trigger and total include `noBranch`:
  - trigger: `( nts.noRepo + nts.diffFailed + nts.noBranch ) > 0`
  - `totalUndiffable = nts.noRepo + nts.diffFailed + nts.noBranch`
- **Label is unchanged** — use the existing count-based labels (`'New-todos: N shown without filtering'` / `'New-todos: N not shown'`, and the current-file variants). No special "no base branch" label. This keeps `no-branch` from dominating/hiding other reasons.
- Tooltip: add one line, only when `nts.noBranch > 0`:
  `'- ' + nts.noBranch + ' no base branch configured\n'`
  (placed alongside the existing `not in a git repository` / `could not be diffed (errors)` lines).
- `suppressNothingFound` (line 533): include `noBranch` → `( nts2.noRepo + nts2.diffFailed + nts2.noBranch ) > 0`.

### 4. `src/fileDecorationProvider.js` (`reasonTooltip`, lines 4-12)

- Add a `reason === 'no-branch'` case returning:
  `"No base branch configured for new-todo filtering. Showing all todos."`

## Error handling & edge cases

- **Whitespace-only branch** (`"   "`): trimmed and treated as empty, so it never reaches git.
- **Fail-closed** (`showUndiffableFiles === false`): todos hidden, but the status node still shows the count + the "no base branch configured" tooltip line, so the tree is not a silent empty. `suppressNothingFound` keeps the "Nothing found" node from appearing on top.
- **Filter disabled**: `missingBranch` is only set when `enabled === true`; when disabled, `classifyUndiffable` is not consulted for filtering and `missingBranch` stays false.

## Testing

All stub-based (empty branch never invokes git, so no real-repo test is needed):

- **`test/newTodoFilter.behavior.test.js`**
  - enabled + empty branch → `classifyUndiffable( file )` returns `'no-branch'`.
  - enabled + whitespace-only branch (`'  '`) → `'no-branch'` (trim behavior).
  - `'no-branch'` + `showUndiffableFiles(true)` → `isNewTodo` returns true (fail-open).
  - `'no-branch'` + `showUndiffableFiles(false)` → `isNewTodo` returns false (fail-closed).
  - non-empty branch → `missingBranch` cleared (a file with no ranges classifies as `no-repo`/covered per existing logic, NOT `no-branch`).

- **`test/tree.behavior.test.js`**
  - `setNewTodoStatus` with `noBranch > 0`, others 0 → status node present, count label correct, tooltip contains "N no base branch configured".
  - `noBranch` + `noRepo` both > 0 (forward-compat sanity) → tooltip shows both lines; label is the combined count (no dominant no-branch label).
  - `suppressNothingFound` honors `noBranch > 0` in current-file fail-closed mode.

- **`test/fileDecoration.behavior.test.js`**
  - `classifyUndiffable` stubbed to return `'no-branch'` → decoration tooltip is the no-branch text.

## Files touched

- `src/newTodoFilter.js` (Modify) — `missingBranch` flag + `classifyUndiffable` `no-branch` case.
- `src/extension.js` (Modify) — `scannedUndiffable['no-branch']`, status payload `noBranch`, rebuild popup branch-empty case.
- `src/tree.js` (Modify) — additive tooltip bucket + counts + suppressNothingFound.
- `src/fileDecorationProvider.js` (Modify) — `no-branch` reason tooltip.
- `test/newTodoFilter.behavior.test.js`, `test/tree.behavior.test.js`, `test/fileDecoration.behavior.test.js` (Modify) — tests above.
