# Design: New-Todos-Only Filter across scan modes (workspace boundary as a scan mode)

> **Status:** proposal. 
> **Note** : mutually exclusive with `2026-05-30-new-todos-filter-scan-modes-design.md` and its mockups. 
> It's an alternate UX for the same feature, we can only implement one of these designs, not both.
> You do not need to read the old docs. 

## Goal

The new-todos-only filter (Option B) shows only todos on lines that are new vs a
git base branch. Two things must be true for it to be usable across all scan
modes:

1. **It must work in every scan mode.** Today (before this design) the filter
   works in workspace-only and workspace+open modes but is **broken** in
   current-file and open-files modes : with the filter ON it shows **nothing**,
   even for files inside the workspace. Root cause + fix in "Diffability axis".
2. **The workspace boundary (include / exclude out-of-workspace files) must be a
   first-class, discoverable choice.** This design encodes it directly in the
   **scan mode** rather than a separate boolean setting.

There are two orthogonal "should this file's todos show?" axes:

- **Boundary axis** : is the file inside the workspace? -> encoded in the **scan
  mode** (this design's main change).
- **Diffability axis** : can the file be git-diffed at all (is it in a repo whose
  diff succeeded)? -> the `filtering.newTodosShowUndiffableFiles` setting
  (fail-open / fail-closed).

These two axes live on two different UI surfaces (scan-mode dropdown vs a
setting). That is an accepted trade-off (see "Accepted trade-offs"), not an
oversight. The status node explains the **diffability** axis only : the boundary
axis is the user's own scan-mode selection and needs no separate explanation.

## Scan modes

Five modes. The workspace-boundary decision is baked into the mode:

| # | Mode (label) | Scan target | Out-of-workspace files? |
|---|---|---|---|
| 1 | workspace only | whole workspace | n/a (workspace is in-workspace by definition) |
| 2 | open files (workspace only) | open files | **excluded** |
| 3 | open files (in and out of workspace) | open files | **included** |
| 4 | workspace + any open files | workspace + open files | **included** |
| 5 | current file | active file | **always included** (no boundary axis) |

### Why there is no "workspace + open files (workspace only)" mode

The set of files scanned by "workspace + open-files-restricted-to-workspace" is
**identical** to "workspace only": any in-workspace open file is already covered
by the workspace scan. So that combination collapses into mode 1 and is
correctly absent.

The only thing "workspace + any open files" (mode 4) adds over mode 1 is the
*out-of-workspace* open files. Strip those out and it **is** "workspace only".

### Why "open files (workspace only)" (mode 2) is NOT redundant with mode 1

In open-files mode the scan target is **only the open files**, not the whole
workspace. A workspace file that isn't open won't appear. So restricting
open-files to in-workspace files (mode 2) is a strict subset of the *open files*,
not of the *workspace* : it earns its place.

### Why "current file" (mode 5) has no boundary variant

The active file is an explicit, deliberate focus by the user. Showing its todos
regardless of location is the least-surprising behavior, and editors generally
treat "current file" as an override. So current-file is **always in/out**: it
scans the active file wherever it lives. (The diffability axis still applies to
it : see "Current-file mode".)

## Enum identifiers

The `tree.scanMode` enum already ships with four values. Four of the five modes
map onto them unchanged; only **one** mode is genuinely new.

Existing enum (`package.json:1689` / `:1706`; `src/extension.js:53-56`):

| Existing id | Existing constant | Maps to mode |
|---|---|---|
| `'workspace'` | `SCAN_MODE_WORKSPACE_AND_OPEN_FILES` | 4 : workspace + any open files |
| `'workspace only'` | `SCAN_MODE_WORKSPACE_ONLY` | 1 : workspace only |
| `'open files'` | `SCAN_MODE_OPEN_FILES` | 3 : open files (in and out of workspace) |
| `'current file'` | `SCAN_MODE_CURRENT_FILE` | 5 : current file |

**New value (the only addition):**

| New id | New constant | Mode |
|---|---|---|
| `'open files in workspace'` *(NEEDS CONFIRMATION)* | `SCAN_MODE_OPEN_FILES_IN_WORKSPACE` | 2 : open files (workspace only) |

- The four existing ids keep their **exact current scan-target behavior**. Mode 3
  (`'open files'`) already scans in-and-out-of-workspace open files today, so
  re-labelling it "open files (in and out of workspace)" is a **label change
  only**.
- The new enum value is added to **both** `better-todo-tree.tree.scanMode` and
  the legacy `todo-tree.tree.scanMode` declaration, consistent with the existing
  dual declaration. (Adding an enum value to the legacy alias is fine : the alias
  setting itself already exists; we're not introducing a *new* `todo-tree.*`
  setting.)
- Enum *order* in `package.json` keeps existing ids in their current positions
  (avoid churn) and appends the new id last; `markdownEnumDescriptions` order
  matches the array order.

### Labels (`package.nls.json`)

Update `markdownEnumDescriptions` to match the new labels and add a 5th
(both `todo-tree.*` and `better-todo-tree.*` keys, as today):

| key suffix (id) | mode | description |
|---|---|---|
| `.1` (`'workspace'`) | 4 | "Scan the whole workspace and any open files (including files outside the workspace)" |
| `.2` (`'open files'`) | 3 | "Scan open files only, including files outside the workspace" |
| `.3` (`'current file'`) | 5 | "Scan the current file only (wherever it lives)" |
| `.4` (`'workspace only'`) | 1 | "Scan the workspace only" |
| `.5` (`'open files in workspace'`) | 2 | "Scan open files that are inside the workspace only" |

## Boundary axis: enforcement (the scan-mode change)

"External" = a scan target whose `fsPath` is not under any workspace root
(`isFileInSearchRoots` against `getWorkspaceSearchRoots()`).

- **Mode 2 (open files, workspace only):** external open targets are **excluded
  from the scan set** (their results are not written / are removed). This is the
  user's explicit scan-mode choice, so it is **not** surfaced in the status node.
- **Modes 3, 4, 5:** external files are **included** and scanned normally.
- **Mode 1:** the question can't arise (only workspace files are scanned).

Enforcement lives where scan targets are enumerated
(`getOpenDocumentsForScan` / `getNotebookDocumentsForScan`,
`extension.js:1754` / `:1729`), so it applies uniformly to full-rebuild and
incremental paths. The predicate is "is this mode 2 **and** the target external".

## Diffability axis

This is where the "filter broken in current-file / open-files modes" bug is
fixed, and where fail-open / fail-closed for undiffable files is implemented.
None of this depends on the scan-mode boundary change above : the two axes are
independent.

### Root cause of the broken-in-some-modes bug

The filter's diff cache is keyed on the roots passed to
`newTodoFilter.refresh(branch, roots, globs)`. Before this design those roots
come from `getWorkspaceSearchRoots()` -> `searchWorkspaces(roots)`, and
`searchWorkspaces` (`extension.js:1483`) is gated:

```js
if( scanMode === SCAN_MODE_WORKSPACE_AND_OPEN_FILES || scanMode === SCAN_MODE_WORKSPACE_ONLY )
```

So in current-file / open-files modes (without `general.rootFolder`), the roots
list is **empty**. `refresh(branch, [], globs)` early-returns an empty
`rangesByPath`. But matches in those modes come from the open documents, not from
the roots list. Every match is checked against an empty map -> `isNewTodo`
returns `false` -> **all** matches dropped. The file being inside the workspace is
irrelevant: the workspace root never enters the roots because the scan mode gates
it out; the diff never runs against any root.

**Fix:** the diff cache is populated by two complementary mechanisms, both writing
the same `coveredRoots` / `failedRoots` cache via `extendForRepo`:

1. **Eager seed (Piece 1, `collectDiffRoots`):** roots known *before* scanning :
   the workspace roots (modes 1/4 only) plus the owning repos of the explicit scan
   *targets* (open/current docs + notebooks). Runs once per rebuild, before
   `refresh()`. This is what fixes the empty-roots bug for open/current modes.
2. **Lazy backfill (`ensureRepoForFile`, at insertion sites):** the owning repo of
   any file *surfaced during scanning* that the eager seed didn't cover : chiefly
   files found by workspace search (not known to `collectDiffRoots` when it ran)
   and files in nested repos (E9). Runs at write time, per file, cache-gated so it
   fires once per distinct repo.

They are not competing : the eager seed handles roots derivable from scan targets;
the backfill handles files discovered only once the scan walks the workspace. A
file's owning repo is found via `git rev-parse --show-toplevel` (innermost repo
wins).

### Piece 1 : eager diff-root seed from scan targets

New helper in `extension.js`, run in `executeRebuild()` before
`newTodoFilter.refresh()`:

```
collectDiffRoots():
  roots = []
  // Workspace-root seed ONLY in workspace-family modes (1, 4), matching the
  // gate in searchWorkspaces() / isDocumentCoveredByWorkspaceSearch().
  if scanMode is workspace-family (mode 1 or 4):
    roots = getWorkspaceSearchRoots()                     // workspace folders / general.rootFolder
  // Per-scanned-file repo discovery: the root source for open-files/current-file
  // modes, and additive (nested repos, external files) for workspace modes.
  for each open/current scan target (getOpenDocumentsForScan + notebooks):
    dir = dirname(target.fsPath)
    repoRoot = revParseCache.get(dir) ?? git.findRepoRoot(dir)   // canonical or null
    revParseCache.set(dir, repoRoot)
    if repoRoot: roots.push(repoRoot)
  return dedupe(roots)                                     // by normalized path
```

**Why the workspace-root seed is mode-gated.** The seed must not be unconditional:
`getRootFolders()` returns `general.rootFolder` **regardless of scan mode**
(`extension.js:2284`, no gate), so with `general.rootFolder` set under mode 3/5 an
unconditional seed would diff the **entire root folder** even though the user chose
to scan only open/current files : a semantic mismatch and a perf regression (huge
repo diffed for one open file). So:

- **Workspace-family modes (1, 4):** seed the workspace roots up front.
- **Open-files / current-file modes (2, 3, 5):** no seed; roots come purely from
  the scanned files' owning repos (per-target `rev-parse`).

This mirrors how `searchWorkspaces` / `isDocumentCoveredByWorkspaceSearch`
(`extension.js:1479`, `:1529`) gate workspace-root usage, keeping the diff-root
gate and the scan-target gate consistent.

- `revParseCache: Map<dir, repoRoot|null>` is module-level in `extension.js`,
  **cleared at the start of each `executeRebuild()`** (repo membership may have
  changed since the last rebuild).
- **Mode 2** excludes external targets from the scan set, so the loop only
  `rev-parse`s in-workspace files : a file in the workspace's own repo resolves to
  the workspace folder's repo (diffed correctly without a seed); a nested-repo file
  resolves to the nested repo (B1).
- **Modes 1 / 4** get the seed *plus* per-target repos, adding nested repos and
  (mode 4) external open files on top of the workspace roots.
- One helper, one mode-gated branch : not a separate code path per mode.

### Piece 2 : fail-open / fail-closed for undiffable files

`isNewTodo` (before this design) can't distinguish "file unchanged" from "file
never diffed" : both are "absent from `rangesByPath` -> drop". Fail-open requires
that distinction, so `newTodoFilter` gains a notion of **covered roots**.

`newTodoFilter` state additions:

- `coveredRoots: string[]` : roots whose diff **succeeded** (`ok === true`),
  stored canonicalized/normalized.
- `failedRoots: string[]` : roots whose `findRepoRoot` succeeded but whose diff
  **failed** (e.g. base branch missing). Distinct from "no repo at all". Drives
  the per-reason tooltip.
- `showUndiffableFiles: boolean` : mirrors the setting, default `true`
  (fail-open).

**Owning-repo model (E9 : most-specific-repo-wins).** Membership is decided by a
file's **owning repo** : the single repo that `git rev-parse --show-toplevel`
returns from the file's directory, which is always the **innermost** repo
(verified: a file in `outer/inner/` resolves to `inner`, not `outer`). The filter
must never conclude "unchanged" from a *covered ancestor* when a *nested* repo
actually owns the file. Concretely:

- `coveredRoots` / `failedRoots` are matched by **longest prefix**, not "any
  prefix". The owning root for `fsPath` is the longest covered-or-failed root
  that is a path-prefix of `fsPath`.
- A file's status is decided **only** by its owning root. A covered ancestor is
  irrelevant once a more specific (nested) root exists. (E9b : if the owning repo
  is a *failed* root, the file is diff-failed/undiffable even if an ancestor is
  covered : owning repo wins, no ancestor fallback.)

`isNewTodo(fsPath, line)` logic:

1. `fsPath` has ranges -> in-range check (unchanged-but-edited file; untracked
   sentinel -> always true).
2. no ranges, `fsPath`'s **owning root** (longest covered prefix) is **covered**
   -> **drop** (genuinely unchanged file in a diffed repo).
3. otherwise undiffable (no covered owning root) -> `showUndiffableFiles === true`
   ? **keep** (fail-open) : **drop** (fail-closed).

`isNewTodo` stays **pure + sync** : it reads `rangesByPath` / `coveredRoots` /
`failedRoots` only. The work of ensuring a file's owning repo has been discovered
and diffed happens *before* filtering, at the insertion sites (see
`ensureRepoForFile`), so the cache is already correct when the sync predicate
runs.

**Undiffable reason (M1).** Classified by the file's **owning root**:
- **no-repo** : `findRepoRoot(dirname(fsPath))` returned `null` (no owning repo).
- **diff-failed** : the owning root is in `failedRoots` (repo exists, diff failed
  : base branch missing, or a nested repo that failed while an ancestor
  succeeded).
`newTodoFilter` exposes
`classifyUndiffable(fsPath) -> 'no-repo' | 'diff-failed' | null` (null =
diffable) so the extension can produce per-reason counts.

### Piece 3 : untracked files = all todos are new (E4)

`git diff <branch>` does not surface untracked files, so a brand-new file would
fall into case 2 above and be dropped : wrong, since every todo in a new file is
new. Fix at the git layer:

- `git.getUntrackedFiles(repoRoot, globs)` runs `git status --porcelain` and
  collects `??` entries.
- In `refresh()` (and `extendForRepo`), each untracked path is inserted into
  `rangesByPath` with a **whole-file sentinel range** `[[1, Infinity]]`, so
  `isNewTodo` returns `true` for any line in it.

## Current-file mode (diffability policy-first)

Current-file always scans the active file (boundary axis gone : modes have no
"workspace only" current-file variant). But the **diffability** axis still
applies:

- Active file undiffable (no repo / diff failed) and
  `newTodosShowUndiffableFiles: false` -> the active file shows **nothing**.
  - The combined status node shows a singular current-file copy, diffability-
    flavoured: "Current file not shown : not in a git repository" or
    "... could not be diffed (errors)" (via `classifyUndiffable`).
  - `Nothing found` is **suppressed** (the file was dropped by policy, not
    processed-with-zero-matches). Don't imply the file was processed with zero
    matches.
- Active file undiffable and `newTodosShowUndiffableFiles: true` (fail-open) ->
  shown dimmed, all todos; status node reports "shown without filtering".
- Active file diffable -> normal filtering.

So current-file special-casing is **only** the diffability axis; there is no
boundary special-case (no "outside the workspace" current-file path).

## Module changes

### `src/git.js`

Two new functions (sibling to `getChangedFilesAndLines`):

- `findRepoRoot(dir)` -> `Promise<string|null>`. Runs
  `git -C dir rev-parse --show-toplevel`. Resolves to the canonical repo root
  (rev-parse already resolves symlinks and emits forward slashes), or `null` on
  any non-zero exit ("not a git repository"). Never rejects for the not-a-repo
  case : `null` is the signal.
- `getUntrackedFiles(repoRoot, includeGlobs, excludeGlobs)` -> `Promise<string[]>`.
  Runs `git status --porcelain` (same glob pathspec treatment as
  `getChangedFilesAndLines`), returns relative paths of `??` entries. Rejects only
  on git error; the caller wraps per-root.

### `src/newTodoFilter.js`

- State: add `coveredRoots`, `failedRoots`, `showUndiffableFiles`.
- `setShowUndiffableFiles(bool)` setter (called from `executeRebuild` from the
  `filtering.newTodosShowUndiffableFiles` setting).
- `refresh(branch, roots, globs)`:
  - per root, run `getChangedFilesAndLines` **and** `getUntrackedFiles`, both
    `.catch`-wrapped to empty so one failure can't reject `Promise.all`.
  - a root is **covered** iff its diff resolved `ok` (untracked failure alone does
    not un-cover it).
  - build `next` map: changed-line ranges + untracked whole-file sentinels.
  - atomically swap `rangesByPath`; set `coveredRoots` / `failedRoots` from the
    per-root outcomes.
  - return `{ allFailed }` (unchanged from today : drives the existing
    all-roots-failed warning at `extension.js:2350`). Per-reason undiffable counts
    for the status node are derived separately via `classifyUndiffable` over the
    scanned files, so no extra return field is needed.
- `extendForRepo(repoRoot, branch, globs)` (lazy extend, used by E1 + E9): diff +
  status for a single repo, **merge** its entries into the live `rangesByPath`,
  add `repoRoot` to `coveredRoots` (or `failedRoots` if its diff failed).
  Idempotent : a no-op if `repoRoot` already covered/failed.
- `isOwningRepoKnown(repoRoot)` : whether `repoRoot` is already in
  `coveredRoots ∪ failedRoots` (lets the extension skip a redundant extend).
- `isNewTodo` : the three-case logic above.
- **Owning-root resolution helper** (E5 + E9): given `fsPath` and a set of roots,
  return the **longest** root that is a path-prefix of `fsPath`. Normalizes case
  on Windows (`toLowerCase`), normalizes separators, enforces a trailing-separator
  boundary (mirroring `isFileInSearchRoots`). Used against
  `coveredRoots ∪ failedRoots` to find the owning root, and to classify.
  Longest-prefix is what makes nested repos correct (inner root beats outer).
  Symlinked-but-not-canonical paths are a known gap, logged via `debug` : no
  `fs.realpath` in the hot path.
- **No** boundary logic here : the boundary axis is enforced entirely in
  `extension.js` at scan-target enumeration.

### `src/extension.js`

- Add `SCAN_MODE_OPEN_FILES_IN_WORKSPACE = 'open files in workspace'` (id pending
  confirmation) alongside the existing four constants (`:53-56`).
- **Scan-target enumeration** (`getOpenDocumentsForScan` /
  `getNotebookDocumentsForScan`, `:1754` / `:1729`): when
  `scanMode === SCAN_MODE_OPEN_FILES_IN_WORKSPACE`, filter out external targets
  (their results are not written). No status-node reason is produced : boundary
  exclusion is the explicit scan-mode choice, not a diffability outcome. Modes
  3/4/5 include external targets unconditionally.
- **Mode-family predicate audit.** Several sites branch on the scan-mode family.
  Mode 2 is **open-files-family** : at each of these, mode 2 follows the **same**
  branch as `'open files'` (mode 3), with external-exclusion applied separately at
  enumeration time:
  - `searchWorkspaces` gate (`:1479`): mode 2 does NOT add workspace folders to
    `searchList` (like `'open files'`). Diff roots come from `collectDiffRoots`
    over the scanned (in-workspace) open files.
  - `:1529`, `:1738`, `:1773`, `:1778`: wherever `'open files'` is special-cased,
    mode 2 takes the same branch.
  - autoRefresh gates (`:2632`, `:3902`): mode 2 behaves like `'open files'`
    (auto-refresh on; not workspace-only).
  - context-key + menu `when` clauses (`:2562`; `package.json:100`, `:105`,
    `:247`, `:252`): decide whether the existing
    `better-todo-tree-scan-mode == 'open files'` menu conditions should also fire
    for mode 2 (likely yes : same toolbar affordances). Enumerate and update each.
  - scan-mode-selection commands (`:2905-2920`): add a command + menu entry for
    the new mode, mirroring the existing per-mode commands.
- `collectDiffRoots()` + `revParseCache` (Piece 1); feed result to
  `newTodoFilter.refresh` in `executeRebuild`. Clear `revParseCache` at rebuild
  start.
- `setShowUndiffableFiles` from the setting at the same point `setEnabled` is
  called (`:2352`).
- **`ensureRepoForFile(fsPath, branch, globs)`** (covers E1 *and* E9) : the single
  mechanism that guarantees a file is evaluated against its **own** repo before
  filtering. Steps:
  1. `dir = dirname(fsPath)`; `repoRoot = revParseCache.get(dir) ?? findRepoRoot(dir)` (cached).
  2. `repoRoot === null` -> no-op (file is no-repo; predicate handles it).
  3. `repoRoot` already known (`isOwningRepoKnown`) -> no-op (cache already correct).
  4. otherwise `await` `extendForRepo(repoRoot, branch, globs)` **raced against a
     timeout** (`newTodosGitTimeoutMs`, default 2000). On timeout, resolve anyway
     and leave the repo unknown for now : the predicate treats the file as
     undiffable and still respects `newTodosShowUndiffableFiles` (timeout does
     **not** force fail-open), and a **late-resolution reconcile** (below)
     re-filters the file when the slow extend finishes.
  Because rev-parse returns the **innermost** repo, this discovers nested repos
  (submodules / nested clones / worktrees) regardless of how the file was found
  (full scan or open file), fixing E9. Cost is bounded : within one repo every
  file is a cache hit, so an extra rev-parse/extend fires only for **distinct
  nested-repo dirs**, not per file.
- **Await-before-write (no flicker, E1/E10):** insertion sites
  `await ensureRepoForFile(uri.fsPath, ...)` **before** the first
  `replaceSearchResults` for that file, so a file is only ever written to a store
  *already correctly classified* : never shown-all-then-trimmed. On the **rebuild
  path** there is no transient regardless, because results stage into
  `nextSearchResults` and only become visible at the end-of-rebuild swap (`:2372`).
  On the **incremental path** (open/save), the file appears one git-call later,
  already filtered, instead of flickering. **This no-transient guarantee has one
  deliberate exception only:** if a first-touch `extendForRepo` exceeds
  `newTodosGitTimeoutMs`, the timeout fallback may temporarily show the file in
  its optimistic fail-open/fail-closed state until the late reconcile runs.
- **Insertion-site wiring (async resolution, sync predicate):**
  `applyNewTodoFilterToResults` callers await `ensureRepoForFile` first, at all
  sites:
  - full-scan candidate path (`:2035`, inside `.then`) and regex path (`:2151`,
    inside `.then`) : already promise chains.
  - incremental `refreshTextDocumentResults` / `refreshNotebookResults` (`:1895`,
    `:1921`) : make these (and callers in `refreshScanTarget` / `refreshOpenFiles`)
    async so the await composes. `isNewTodo` itself stays sync. Guard the whole
    step behind `newTodoFilter.isEnabled()` so the filter-off path adds zero git
    work.
- **Late-resolution reconcile (timeout fallback only):** when a timed-out
  `extendForRepo` eventually resolves, it merges into the cache and triggers a
  one-file re-refresh (`refreshScanTarget`) for the affected target(s) so the
  optimistic state is corrected without waiting for the next full rebuild.
  Normal rebuild and incremental paths do **not** show an optimistic state; this
  reconcile path exists solely for the timeout fallback above. So the only path
  that can show a brief (bounded, rare) transient is: first touch of a repo,
  `extendForRepo` exceeds `newTodosGitTimeoutMs`, timeout fallback paints, then
  reconcile corrects it.

### `package.json` / `package.nls.json`

- Add the new enum value to **both** `better-todo-tree.tree.scanMode` and
  `todo-tree.tree.scanMode`, with a matching `markdownEnumDescriptions` entry.
- Update the four existing `markdownEnumDescriptions` to the new labels (table
  above).
- Update menu `when` clauses per the audit.
- Declare the new `filtering.*` settings (see "Settings").

## Combined omission/degradation status node

Reuse the existing status-node mechanism in `tree.js getChildren` (`tree.js:489`,
alongside `filterStatusNode` / `scanModeNode`); `isStatusNode: true`, icon
`git-branch`. **One** node, scoped **only to the diffability axis** : why a file's
todos couldn't be new-todo-filtered. It never explains the boundary axis : mode-2
external exclusion is the user's explicit scan-mode choice and is not surfaced
here (or anywhere as a status node).

- **Trigger:** filter ON and ≥1 *scanned* file is **undiffable** (no-repo or
  diff-failed) : either **hidden** (under `newTodosShowUndiffableFiles: false`) or
  **shown-but-unfiltered** (under fail-open). Driven by *scanned* files (the files
  that passed enumeration + boundary exclusion and were processed), so hiding the
  last undiffable file still leaves its explanation. Mode-2-excluded external files
  are not scanned and never count toward the trigger.
- **Counts:** **file** counts (not todos), per reason (`no-repo` / `diff-failed`).
- **Label:** compact summary : `New-todos: N not shown` /
  `New-todos: N shown without filtering` /
  `New-todos: N not shown, M without filtering`. `current-file` mode uses singular
  "Current file not shown : ..." copy.
- **Tooltip:** **two buckets** : `Hidden` then `Shown without filtering`; omit an
  empty bucket. One line per reason+count inside each; no-repo vs diff-failed split
  via `classifyUndiffable`; "errors" kept for diff-failed.
- **Click:** opens `filtering.newTodosShowUndiffableFiles` in settings
  (`workbench.action.openSettings`). Every reason in the node is a diffability
  reason now, so the click target is unconditional : no scan-mode picker command
  is needed.

The extension computes per-reason file counts from the **scanned** set (it already
knows each scanned file's `classifyUndiffable`) and threads them into the provider
like other status state. No new node *type*.

## Per-item visual layer

One per-file signal, surfaced on **every shown node for that file** when the file
is undiffable under fail-open. File/path nodes and todo nodes use different UI
hooks, but the user-visible meaning is the same: "this file is shown without
new-todo filtering".

- **File/path nodes:** use a single **`FileDecorationProvider`** registered in
  `activate` and disposed via `context.subscriptions`. It composes with the
  existing `showBadges` `resourceUri` delegation (VS Code merges decorations).
  The extension calls the provider's `onDidChangeFileDecorations` emitter after
  each rebuild / lazy-extend so decorations refresh.
- **Todo nodes:** apply the same dimmed visual treatment directly in
  `tree.js getTreeItem`, because todo nodes are not resource-backed file nodes and
  therefore do not participate in `FileDecorationProvider`.

The visual treatment consults `newTodoFilter` (active only when the filter is ON):

1. **Undiffable files shown under fail-open** (`showUndiffableFiles === true` and
   `classifyUndiffable(fsPath) !== null`): apply the **dimmed theme colour**
   `new vscode.ThemeColor('gitDecoration.ignoredResourceForeground')` to all shown
   nodes for that file.
   - For file/path nodes, this is the `FileDecoration.color`.
   - For todo nodes, use the nearest equivalent TreeItem styling hook so the todo
     item is visually dimmed as well.
   When `showUndiffableFiles` is `false` the file's nodes aren't shown at all, so
   no dimming applies.

**Reason tooltip (per shown node).** The full hover explanation lives on
`treeItem.tooltip`. When the filter is ON and the node belongs to an undiffable
file shown under fail-open, replace the tooltip with a reason-aware
`MarkdownString`. (Only shown nodes have tooltips; hidden files have no node, so
their explanation lives in the combined status node.)
- **no-repo:** "Not in a git repository : new-todo filtering can't be applied.
  Showing all todos."
- **diff-failed:** "git diff failed (repo may not have base branch
  `<baseBranch>`). Showing all todos."
- For **file/path nodes**, follow the reason line with the **fsPath** (as today).
- For **todo nodes**, prepend the reason line and then keep the node's existing
  tooltip content (full todo text / formatted todo tooltip), so the user still
  gets the todo-specific hover information.
Otherwise tooltips fall back to their existing behavior unchanged.

## Settings

Declared only under `better-todo-tree.*` (this filtering behavior is
new-in-development and does not exist in the original Todo Tree extension, so no
`todo-tree.*` legacy aliases for these new settings).

- `filtering.newTodosShowUndiffableFiles`: boolean, default `true`.
  - `true` : files in no git repo / failed diff show all their todos (fail-open).
  - `false` : such files show nothing (fail-closed).
- `filtering.newTodosGitTimeoutMs`: number, default `2000`.
  - Max time `ensureRepoForFile` waits for a first-touch `extendForRepo` (repo
    discovery + diff) before using the timeout fallback: paint the file in its
    optimistic fail-open/fail-closed state, then reconcile when the diff later
    resolves. Outside this timeout fallback, the design does **not** show an
    optimistic intermediate state. `0` disables the timeout (always wait).



## Edge cases

| ID | Case | Resolution |
|----|------|-----------|
| E1 | Open a file in open-files mode whose repo wasn't in the last diff (incremental path doesn't recompute roots) | `ensureRepoForFile` lazily `extendForRepo`s before filtering in the incremental path |
| E2 | Many open files in one repo | Dedupe diff roots by normalized path; one diff per repo |
| E3 | Out-of-workspace repo lacks the configured base branch (diff fails) | Failed root -> not covered -> undiffable -> fail-open (or hide). No per-repo warning (avoid spam) |
| E4 | Brand-new / untracked file | `git status --porcelain` -> whole-file sentinel range -> all todos shown |
| E5 | rev-parse returns canonical paths; VS Code `fsPath` may differ (symlinks, drive-letter case) | Normalize case + separators + trailing-sep boundary. Symlink realpath gap logged, not resolved |
| E6 | rev-parse cost | `revParseCache` per session (cleared per rebuild); bounded by distinct repo dirs (cache hit within a repo) |
| E7 | Out-of-workspace branch switch not auto-detected | **v2** : existing `.git/HEAD` watcher (`extension.js:2442`) covers workspace folders only |
| E9 | Nested repo / submodule / worktree under a workspace repo : parent covered but nested repo uncovered or diff-failed | **Owning-repo (most-specific) wins.** Longest-prefix match for the owning root; `ensureRepoForFile` discovers the nested repo (rev-parse returns innermost) regardless of how the file was found. A covered ancestor never decides a nested-repo file's status (E9b: failed owning repo -> diff-failed, no ancestor fallback) |
| E10 | Lazy-extend transient flicker: file shown-all then trimmed (fail-open) or missing then appears (fail-closed) | **Await-before-write**: classify before writing to any visible store. Rebuild path has no transient (staging swap); incremental path shows the file one git-call later, already correct. Slow first-touch bounded by `newTodosGitTimeoutMs`; on timeout, paint optimistically then **reconcile** via a one-file re-refresh when the diff resolves |
| B1 | Mode 2, open file inside workspace but in a **nested repo** | Still needs full owning-repo machinery. "Workspace only" is a *path* boundary, not a *repo* boundary : the file is in-workspace (kept) but its owning repo is the nested one, diffed via `ensureRepoForFile`. Mode name implies no simplification of the diff path |
| B2 | Mode 2, the only open files are all external | All excluded -> empty scan set -> plain `Nothing found`. No status node : boundary exclusion is the user's own scan-mode choice (a mode-2 user knows external files are excluded), so it isn't surfaced as an omission to explain |
| B3 | current-file, active file external | **Always scanned** (boundary axis gone). Diffable -> normal. Undiffable -> diffability policy-first (dimmed under fail-open; hidden + singular copy + suppressed `Nothing found` under fail-closed). No "outside the workspace" current-file path |
| B4 | Status-node click | Always opens `newTodosShowUndiffableFiles` (the node only ever holds diffability reasons). No outside-workspace reason, so no scan-mode-picker branch |

## Accepted trade-offs

- **Two omission axes on two surfaces.** Boundary lives in the scan-mode
  dropdown; diffability lives in `newTodosShowUndiffableFiles`. The status node
  explains only diffability. Boundary exclusion is left implicit in the selected
  scan mode rather than repeated in a second explanatory surface.

## Error handling

- Per-root diff/status failures are individually `.catch`-wrapped to empty : one
  bad root cannot reject the `Promise.all`.
- `findRepoRoot` resolves `null` for non-repos (no rejection).
- `extendForRepo` failure leaves the existing cache intact; the file is treated as
  undiffable (fail-open/hide per setting).
- Existing "all roots failed" warning behavior (`extension.js:2355`) is retained;
  the new node is additive and non-blocking.

## Testing

Repo convention: `test/*.behavior.test.js`.

- **`newTodoFilter.behavior.test.js`** (extend):
  - covered vs uncovered drop logic (the three `isNewTodo` cases).
  - untracked sentinel -> any line returns `true`.
  - `showUndiffableFiles` `true` vs `false`.
  - `classifyUndiffable` -> `no-repo` / `diff-failed` / `null` per `failedRoots`.
  - **owning-root / longest-prefix (E9):** nested covered root beats covered
    ancestor; file in nested *uncovered* root under covered ancestor -> undiffable
    (NOT dropped); file in nested *failed* root under covered ancestor ->
    diff-failed (E9b, no ancestor fallback).
  - path normalization boundaries (trailing sep, case on Windows-style paths).
  - `extendForRepo` merges without clobbering existing ranges; idempotent; routes a
    failed diff to `failedRoots`.
  - `coveredRoots` / `failedRoots` reflect diff outcomes correctly.
- **`ensureRepoForFile` / await-before-write (E10):**
  - resolves before write : a file is never written to a store in a state it will
    later be trimmed from (mock `extendForRepo` with a deferred promise; assert no
    optimistic write precedes resolution).
  - timeout path : when `extendForRepo` exceeds `newTodosGitTimeoutMs`, the file is
    painted per fail-open/closed, and the **late reconcile** re-refreshes that one
    file once the diff resolves (assert exactly one corrective refresh).
  - `newTodosGitTimeoutMs: 0` -> always waits, no timeout path.
- **`git.behavior.test.js`** (extend):
  - `findRepoRoot` : repo dir, nested dir, non-repo dir -> `null`.
  - `getUntrackedFiles` : parses `??` entries, applies globs.
- **Scan-target enumeration (boundary axis):**
  - mode 2 excludes external targets (in-workspace kept); modes 3/4/5 include
    them. Notebook + text-doc paths both.
  - the enum has exactly the five modes; mode 2 is open-files-family.
- **`collectDiffRoots` mode-gating:**
  - modes 1/4: workspace roots seeded (`getWorkspaceSearchRoots()`) + per-target
    repos.
  - modes 2/3/5: **no** workspace-root seed; roots derived only from scanned
    files' owning repos. Specifically, with `general.rootFolder` **set** and mode
    3 or 5, `collectDiffRoots` must NOT include the configured root folder (assert
    the diffed roots are exactly the scanned files' repos, not `rootFolder`).
  - mode 2, in-workspace file in the workspace's own repo -> its repo root is
    discovered from the file (resolves to the workspace folder's repo) without the
    seed; nested-repo file -> nested repo (B1).
- **Mode-family predicate audit:** for each updated branch (`:1479`, `:1529`,
  `:1738`, `:1773`, `:1778`, `:2632`, `:3902`), a test that mode 2 takes the
  open-files branch.
- **`FileDecorationProvider`** (unit): undiffable file -> dim colour only under
  fail-open; diffable file (in- or out-of-workspace) -> no decoration.
- **Todo-node dimming + tooltip** (unit): todo nodes under an undiffable fail-open
  file are dimmed too, and their tooltip prepends the undiffable reason while
  retaining the existing todo-specific tooltip content; normal todo nodes are
  unchanged.
- **Combined status node** (unit on the count/trigger computation):
  - trigger driven by *scanned* files : hiding the last undiffable file still
    produces the node.
  - both buckets (`Hidden` / `Shown without filtering`) populated simultaneously.
  - mode 2 with external (excluded) files present but **no** undiffable scanned
    file -> **no node** (boundary exclusion never triggers the node).
  - default settings + an undiffable file present -> "shown without filtering";
    all-diffable -> no node.
  - click always routes to `newTodosShowUndiffableFiles` (B4).
  - `current-file` undiffable + fail-closed -> singular copy, `Nothing found`
    suppressed, file shows nothing (B3).
- **Integration:** each scan mode (1-5) x file location (in-workspace, other-repo,
  no-repo) x `newTodosShowUndiffableFiles` (true/false). Plus: open a new-repo file
  in open-files mode triggers lazy extend; untracked file shows all todos; combined
  node appears with correct bucket/counts; mode 2 hides out-of-workspace open
  files; current-file external file is scanned (B3).

## Out of scope (v2)

- E7 : auto-refresh on branch switch in out-of-workspace repos (watcher only covers
  workspace folders today).
- `fs.realpath` symlink canonicalization for the covered-root check.
- Per-repo base-branch-missing warnings.
- **Per-file external-file marker (`⧉`).** A per-file visual indicator
  distinguishing shown open files outside the workspace (modes 3/4/5). Shown
  external files are treated as normal files in v1. Each available channel has a
  real drawback and none is clearly worth the complexity:
  - `FileDecoration.badge` : only renders when `tree.showBadges` is ON and competes
    for the single far-right badge slot with VS Code's git SCM badge.
  - `treeItem.description` : already used for per-file todo count when
    `tree.showCountsInTree` is ON (`tree.js:730`).
  - appending to `treeItem.label` : pollutes the label used by folder compaction /
    copy / search (`tree.js:625`) and has no independent hover.
  Revisit once a channel is chosen (likely label-append with the reason in
  `treeItem.tooltip`).
- **Per-repo base branches (E8).** Allow a different git base branch per repo
  (e.g. workspace repo diffs `main`, an opened library repo diffs `develop`).
  Drops in cleanly given this structure:
  - `git.getChangedFilesAndLines(baseBranch, repoPath, ...)` and `extendForRepo`
    already take the branch **per repo**.
  - `rangesByPath` is keyed by absolute path and `isNewTodo` is branch-agnostic, so
    the cache/predicate need no change.
  Future change is additive: a config (e.g.
  `filtering.newTodosBaseBranchByRepo: { "<repoPathOrGlob>": "<branch>" }`) with
  `newTodosGitBaseBranch` as fallback, plus a `resolveBranchForRoot(root)` resolver
  used inside `refresh`'s per-root map and at the `extendForRepo` call site.
  **Structuring hint for v1:** keep branch resolution at the per-root site (inside
  `roots.map(...)` in `refresh`, and at the `extendForRepo` call site) rather than
  assuming one global branch deeper in the pipeline, so E8 is a one-line swap of
  the scalar for the resolver.
