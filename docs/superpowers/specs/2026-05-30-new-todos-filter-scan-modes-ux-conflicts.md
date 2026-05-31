# Discussion: New-Todos Filter UX Conflicts Across Scan Modes

Purpose: consolidate the UX/usability conflicts created where the new-todos
filter intersects with existing scan modes and visibility settings, so we can
iterate on them in one place.

This is not a replacement for the main design doc. It is a focused discussion
doc for unresolved or easy-to-misread behavior.

> **Status: folded into the main docs.** The decisions here (see "RESOLVED
> model" below) have been incorporated into
> `2026-05-30-new-todos-filter-scan-modes-design.md` and `-mockups.md`. This
> doc is kept as a record of the discussion and will **not** be maintained going
> forward : treat the design + mockups as the source of truth for any future
> change.
>
> **Setting names are superseded.** This doc uses the earlier names
> `showTodosInUndiffableFiles` / `showExternalOpenFiles`. The current names
> (in the design + mockups) are `filtering.newTodosShowUndiffableFiles` /
> `filtering.newTodosShowOpenFilesOutsideWorkspace`.

Related docs:
- `2026-05-30-new-todos-filter-scan-modes-design.md`
- `2026-05-30-new-todos-filter-scan-modes-mockups.md`

## Scope of this doc

This doc covers conflicts between:
- scan mode (`workspace`, `workspace + open files`, `open files`, `current file`)
- `filtering.showTodosInUndiffableFiles`
- `filtering.showExternalOpenFiles`
- the status-marker / empty-state UX

It does not re-argue the core correctness fix of deriving diff roots from the
files being scanned.

## Consolidated tensions

### 1. Hidden because external vs hidden because undiffable vs genuinely no results

These states can all collapse into the same user-visible outcome: an empty tree
or a missing file.

Cases:
- The file has no new todos after a successful diff.
- The file is undiffable and `showTodosInUndiffableFiles` is `false`.
- The file is outside the workspace and `showExternalOpenFiles` is `false`.
- In `current-file` mode, the active file may be outside the workspace and be
  hidden for that reason.

Why this is a scan-mode/new-todos-settings problem:
- The user sees "nothing found" or does not see the expected file, but the cause
  is ambiguous.
- The current marker only explains undiffable files. It does not explain hidden
  external files.
- Scenario 7 currently hides external files and also drops the undiffable marker
  if the only undiffable file was external and therefore hidden.

Design question:
- Should hidden external files get their own visible status node, or should the
  current marker expand to cover both hidden-undiffable and hidden-external
  causes?

### 2. `current-file` mode has the sharpest contradiction with `showExternalOpenFiles`

`showExternalOpenFiles` is currently defined as applying in `current-file` mode
too.

Why this is a scan-mode/new-todos-settings problem:
- In `current-file` mode, users expect the tree to reflect the file they are
  actively looking at.
- If that active file is outside the workspace and `showExternalOpenFiles` is
  `false`, the tree can legitimately hide the active file entirely.
- That makes `current-file` mode feel self-contradictory: the scan mode says
  "current file", but another setting can suppress the current file.

Design question:
- Should `current-file` mode ignore `showExternalOpenFiles` and always show the
  active file?

### 3. Marker semantics are unclear once files are hidden

The design uses one marker for undiffable files and allows its wording to switch
between "shown" and "hidden" depending on `showTodosInUndiffableFiles`.

Why this is a scan-mode/new-todos-settings problem:
- The implementation notes describe the marker as tied to displayed undiffable
  files, but the copy can also describe hidden ones.
- If all relevant files are hidden, it is not obvious whether the marker should
  still appear, or what the trigger condition is.
- This matters most in fail-closed and current-file/open-files modes, where the
  tree may otherwise look broken.

Design question:
- Should the marker be driven by "relevant scanned files" rather than only
  displayed files?

### 4. Some states are "expected empty", others are "policy-hidden"

The mockups distinguish:
- legitimate empty: diff succeeded, no new todos
- hidden by policy: undiffable hidden or external hidden

Why this is a scan-mode/new-todos-settings problem:
- Both can look like "Nothing found" unless the surrounding status UI is very
  explicit.
- This distinction matters because one state reassures the user that filtering
  worked, while the other state tells them a setting excluded files.

Design question:
- Do we need a separate empty-state message when files were omitted by settings?

## Decision points to iterate on

These are the main product decisions still worth locking down:

1. Should `current-file` mode always show the active file, regardless of
   `showExternalOpenFiles`?
2. Should hidden external files produce a status node, similar to hidden
   undiffable files?
3. What should drive marker visibility: displayed files, scanned files, or
   omitted files?
4. Do we want one combined status surface for all omission reasons, or separate
   ones for undiffable vs external?

## Suggested iteration order

Recommended order because each choice affects the next one:

1. Decide the `current-file` rule.
2. Decide whether hidden external files need visible explanation.
3. Decide the marker trigger model: displayed vs scanned vs omitted files.
4. Refine the marker text and click behavior after the above are settled.

## Current proposal

This is the current direction from the discussion above.

- Use a **policy-first** model across scan modes.
- Keep one **combined status node** for omitted files, rather than separate nodes
  for external vs undiffable cases.
- Keep the node compact, and put the detailed breakdown in the tooltip.

### Status node copy

For non-`current-file` modes:

- `Some files not shown (settings)`
- `Some files not shown (errors)`
- `Some files not shown (settings, errors)`

For `current-file` mode:

- `Current file not shown (settings)`
- `Current file not shown (errors)`
- `Current file not shown (settings, errors)`

The `current-file` wording is a deliberate special case in the UI copy only. The
underlying behavior stays policy-first.

### Bucket definitions

`settings`:
- external files hidden by `showExternalOpenFiles: false`
- file not in a git repo

`errors`:
- `git diff` failed

This treats "not in a git repo" as an expected limitation/policy outcome, while
reserving `errors` for actual diff failures.

### Tooltip structure

The tooltip should group reasons by top-level bucket first.

Example:

```text
Files not shown

Settings
- 2 open files are outside the workspace
- 1 open file is not in a git repo

Errors
- 1 open file could not be diffed
```

The exact counts and wording can vary by mode, but the structure should stay:

- heading
- `Settings` section when applicable
- `Errors` section when applicable

### `current-file` policy details

- If the active file is outside the workspace and `showExternalOpenFiles` is
  `false`, do **not** attempt `git diff`.
- In that case, show only `Current file not shown (settings)` and explain only
  that reason in the tooltip.
- If the active file is eligible for filtering and `git diff` fails, show
  `Current file not shown (errors)`.
- If the active file is eligible and simply has no new todos, use the normal
  empty-result state instead of a "not shown" node.

### Empty-state rule

- If files were excluded by policy or error, the status node should explain that.
- In `current-file` mode, if the active file was excluded, do **not** also show
  `Nothing found`.
- More generally, avoid pairing a "not shown" node with generic empty-state copy
  that implies the file was successfully processed and had zero matching todos.

## RESOLVED model (supersedes "Current proposal" above)

After review, the locked decisions:

1. **One combined status node** (not separate external/undiffable nodes). It
   replaces the earlier M1-M4 "New-todos filter: ..." marker : same node slot.
2. **Trigger = any scanned file is hidden OR shown-but-unfiltered.** Specifically
   the node appears when, for the current scan, ≥1 file is:
   - **hidden** by `showExternalOpenFiles: false` (external), or
   - **hidden** by `showUndiffableFiles: false` (undiffable, fail-closed), or
   - **shown-but-unfiltered** : undiffable under fail-open
     (`showUndiffableFiles: true`) : these appear dimmed, and the node explains
     the dimming at the top level.
   (So under default settings, the node still appears whenever an undiffable file
   is present : to explain the dim colour. It is absent only when every scanned
   file was successfully filtered.)
3. **Two-bucket tooltip.** Two top-level sections; omit a section when empty.
   Both can be non-empty at once (they're driven by independent settings on
   different files : e.g. an in-workspace undiffable file shown dimmed *and* an
   external file hidden). Per-file **precedence: Hidden wins** : a file that is
   both external-hidden and undiffable is counted once, under Hidden.

   ```text
   Files affected by the new-todos filter

   Hidden
   - N file(s) outside the workspace
   - N file(s) not in a git repository
   - N file(s) could not be diffed (errors)

   Shown without filtering
   - N file(s) not in a git repository
   - N file(s) could not be diffed (errors)
   ```

   Within each bucket, one line per reason+count; no-repo vs diff-failed split
   via M1 `classifyUndiffable`. "errors" wording is **kept** for diff-failed
   (invites the user to fix the base branch). (`outside the workspace` only
   appears under Hidden : an external *diffable* file that is shown is filtered
   normally, so it is not "without filtering".)
4. **Node label** is a compact summary; full breakdown in the tooltip. Examples:
   - only hidden : `New-todos: N file(s) not shown`
   - only fail-open dimmed : `New-todos: N file(s) shown without filtering`
   - both : `New-todos: N not shown, M without filtering`
5. **Click** opens the most relevant setting (the one responsible for the
   dominant reason); tooltip lists all. (Refines M4.)
6. **`current-file` mode is policy-first** : `showExternalOpenFiles` applies. An
   external active file with the setting off is hidden, and the node uses
   `current-file` copy (`Current file not shown : outside the workspace`). In
   that case skip `git diff` for it and do **not** also show `Nothing found`.
   The mode's behavior is consistent with other modes; only the copy differs.

These supersede: the fail-open-only M1 marker in Scenario 3a (now part of the
combined node); the `settings`/`errors` bucketing (replaced by Hidden /
Shown-without-filtering, though "errors" survives as a per-line qualifier for
diff-failed); and the interim "flat list" decision (replaced by the two-bucket
tooltip, now that the buckets are confirmed to coexist).
