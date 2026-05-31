# Design: New-Todos-Only Filter across all scan modes

> **Status:** proposal. 
> **Note** : mutually exclusive with `2026-05-30-scan-modes-workspace-boundary-redesign.md` and its mockups. 
> It's an alternate UX for the same feature, we can only implement one of these designs, not both.

## Goal

The new-todos-only filter (`docs/superpowers/specs/2026-05-27-new-todos-filter-option-b-design.md`)
works correctly in **workspace-only** and **workspace + open files** scan modes,
but is broken in:

1. **current file only**
2. **open files only**

In those modes, with the filter ON, the tree shows **nothing** : even for files
that live inside the workspace. This design fixes all scan modes by deriving the
git-diff roots from the files actually scanned (not just workspace folders),
handling files in other repos and files in no repo, and surfacing a visible
indicator when filtering can't be applied.

## Root cause

The filter's diff cache is keyed on the roots passed to
`newTodoFilter.refresh(branch, roots, globs)`. Today those roots come from:

```
executeRebuild()
  searchList = getWorkspaceSearchRoots()
                 -> getRootFolders()        // [] unless general.rootFolder is set
                 -> searchWorkspaces(roots)  // adds workspace folders ONLY IF
                                             // scanMode is workspace-only or workspace+open
```

`searchWorkspaces` (`extension.js:1483`) is gated:

```js
if( scanMode === SCAN_MODE_WORKSPACE_AND_OPEN_FILES || scanMode === SCAN_MODE_WORKSPACE_ONLY )
```

So in current-file / open-files mode (and no `general.rootFolder`), `searchList`
is **empty**. `newTodoFilter.refresh(branch, [], globs)` early-returns with an
empty `rangesByPath` (`newTodoFilter.js:43`). Meanwhile matches in those modes
come from the open documents (`getOpenDocumentsForScan` / `refreshOpenFiles`),
not from `searchList`. Every match is then checked against an empty map :
`isNewTodo` returns `false` : so **all** matches are dropped.

The file being inside the workspace is irrelevant: the workspace root never
enters `searchList` because the scan mode gates it out. The diff never runs
against any root.

**Fix direction:** derive the diff roots from the files actually being scanned,
unioned with the workspace roots. For an in-workspace file, its repo root *is*
(or contains) the workspace folder; for an out-of-workspace file, discover its
repo via `git rev-parse`.

## Architecture

Three pieces, building on the existing `newTodoFilter.js` / `git.js` split.

### Piece 1 : derive diff roots from scanned files

New helper in `extension.js`, run in `executeRebuild()` before
`newTodoFilter.refresh()`:

```
collectDiffRoots():
  roots = getWorkspaceSearchRoots()                       // existing workspace roots
  for each open/current scan target (getOpenDocumentsForScan + notebooks):
    dir = dirname(target.fsPath)
    repoRoot = revParseCache.get(dir) ?? git.findRepoRoot(dir)   // canonical or null
    revParseCache.set(dir, repoRoot)
    if repoRoot: roots.push(repoRoot)
  return dedupe(roots)                                     // by normalized path
```

- Applies in **all scan modes** (unified root collection : one code path).
- `revParseCache: Map<dir, repoRoot|null>` is module-level in `extension.js`,
  **cleared at the start of each `executeRebuild()`** (a rebuild is the point at
  which repo membership may have changed).

### Piece 2 : fail-open / fail-closed for undiffable files

`isNewTodo` today can't distinguish "file unchanged" from "file never diffed" :
both are "absent from `rangesByPath` -> drop". Fail-open requires that
distinction, so `newTodoFilter` gains a notion of **covered roots**.

`newTodoFilter` state additions:

- `coveredRoots: string[]` : roots whose diff **succeeded** (`ok === true`),
  stored canonicalized/normalized.
- `failedRoots: string[]` : roots whose `findRepoRoot` succeeded but whose diff
  **failed** (e.g. base branch missing). Distinct from "no repo at all". Drives
  the per-reason marker (M1) and tooltip.
- `showUndiffableFiles: boolean` : mirrors the new setting, default `true`
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

`isNewTodo(fsPath, line)` new logic:

1. `fsPath` has ranges -> in-range check (unchanged-but-edited file; untracked
   sentinel -> always true).
2. no ranges, `fsPath`'s **owning root** (longest covered prefix) is **covered**
   -> **drop** (genuinely unchanged file in a diffed repo).
3. otherwise undiffable (no covered owning root) -> `showUndiffableFiles === true`
   ? **keep** (fail-open) : **drop** (fail-closed).

`isNewTodo` stays **pure + sync** : it reads `rangesByPath` / `coveredRoots` /
`failedRoots` only. The work of ensuring a file's owning repo has been discovered
and diffed happens *before* filtering, at the insertion sites (see
`ensureRepoForFile` under `extension.js` below), so the cache is already correct
when the sync predicate runs.

**Undiffable reason (M1).** Classified by the file's **owning root**:
- **no-repo** : `findRepoRoot(dirname(fsPath))` returned `null` (no owning repo).
- **diff-failed** : the owning root is in `failedRoots` (repo exists, diff failed
  : e.g. base branch missing, or a nested repo that failed while an ancestor
  succeeded).
`newTodoFilter` exposes `classifyUndiffable(fsPath)` -> `'no-repo' | 'diff-failed' | null`
(null = diffable) so the extension can produce per-reason counts for the marker.

### Piece 3 : untracked files = all todos are new (E4)

`git diff <branch>` does not surface untracked files, so a brand-new file would
fall into case 2 above and be dropped : wrong, since every todo in a new file is
new. Fix at the git layer:

- `git.getUntrackedFiles(repoRoot, globs)` runs `git status --porcelain` and
  collects `??` entries.
- In `refresh()` (and `extendForRepo`, below), each untracked path is inserted
  into `rangesByPath` with a **whole-file sentinel range** `[[1, Infinity]]`, so
  `isNewTodo` returns `true` for any line in it.

## Module changes

### `src/git.js`

Two new functions (sibling to `getChangedFilesAndLines`):

- `findRepoRoot(dir)` -> Promise<string|null>. Runs
  `git -C dir rev-parse --show-toplevel`. Resolves to the canonical repo root
  (rev-parse already resolves symlinks and emits forward slashes), or `null` on
  any non-zero exit ("not a git repository"). Never rejects for the not-a-repo
  case : `null` is the signal.
- `getUntrackedFiles(repoRoot, includeGlobs, excludeGlobs)` -> Promise<string[]>.
  Runs `git status --porcelain` (with the same glob pathspec treatment as
  `getChangedFilesAndLines`), returns relative paths of `??` entries. Rejects
  only on git error; the caller wraps per-root like the diff.

### `src/newTodoFilter.js`

- State: add `coveredRoots`, `failedRoots`, and `showUndiffableFiles`.
- `setShowUndiffableFiles(bool)` setter (called from `executeRebuild` from the
  `filtering.newTodosShowUndiffableFiles` setting).
- `refresh(branch, roots, globs)`:
  - per root, run `getChangedFilesAndLines` **and** `getUntrackedFiles`, both
    `.catch`-wrapped to empty so one failure can't reject `Promise.all`.
  - a root is **covered** iff its diff resolved `ok` (untracked failure alone
    does not un-cover it).
  - build `next` map: changed-line ranges + untracked whole-file sentinels.
  - atomically swap `rangesByPath`; set `coveredRoots` / `failedRoots` from the
    per-root outcomes.
  - return `{ allFailed, undiffableEncountered }` (the latter feeds the marker).
- `extendForRepo(repoRoot, branch, globs)` (lazy extend, used by E1 + E9): diff +
  status for a single repo, **merge** its entries into the live `rangesByPath`,
  add `repoRoot` to `coveredRoots` (or `failedRoots` if its diff failed).
  Idempotent : a no-op if `repoRoot` already covered/failed.
- `isOwningRepoKnown(repoRoot)` : whether `repoRoot` is already in
  `coveredRoots ∪ failedRoots` (lets the extension skip a redundant extend).
- `isNewTodo` : new three-case logic above.
- **Owning-root resolution helper** (E5 + E9): given `fsPath` and a set of roots,
  return the **longest** root that is a path-prefix of `fsPath`. Normalizes case
  on Windows (`toLowerCase`), normalizes separators, enforces a trailing-separator
  boundary (mirroring `isFileInSearchRoots`). Used against
  `coveredRoots ∪ failedRoots` to find the owning root, and to classify.
  Longest-prefix is what makes nested repos correct (inner root beats outer).
  Symlinked-but-not-canonical paths are a known gap, logged via `debug` : no
  `fs.realpath` in the hot path.

### `src/extension.js`

- `collectDiffRoots()` + `revParseCache` (Piece 1); feed result to
  `newTodoFilter.refresh` in `executeRebuild`. Clear `revParseCache` at rebuild
  start.
- `setShowUndiffableFiles` from the new setting at the same point `setEnabled`
  is called (`extension.js:2352`).
- **`ensureRepoForFile(fsPath, branch, globs)`** (covers E1 *and* E9) : the
  single mechanism that guarantees a file is evaluated against its **own** repo
  before filtering. Steps:
  1. `dir = dirname(fsPath)`; `repoRoot = revParseCache.get(dir) ?? findRepoRoot(dir)` (cached).
  2. `repoRoot === null` -> no-op (file is no-repo; predicate handles it).
  3. `repoRoot` already known (`isOwningRepoKnown`) -> no-op (cache already correct).
   4. otherwise `await` `extendForRepo(repoRoot, branch, globs)` **raced against a
      timeout** (`newTodosGitTimeoutMs`, default 2000). On timeout, resolve
      anyway and leave the repo unknown for now : the predicate treats the file as
      undiffable and still respects `newTodosShowUndiffableFiles` (timeout does
      **not** force fail-open), and a **late-resolution reconcile** (below)
      re-filters the file when the slow extend finishes.
  Because rev-parse returns the **innermost** repo, this discovers nested repos
  (submodules / nested clones / worktrees) regardless of how the file was found
  (full scan or open file), fixing E9. Cost is bounded : within one repo every
  file is a cache hit, so an extra rev-parse/extend fires only for **distinct
  nested-repo dirs**, not per file.
- **Await-before-write (no flicker, E1/4a):** insertion sites
  `await ensureRepoForFile(uri.fsPath, ...)` **before** the first
  `replaceSearchResults` for that file, so a file is only ever written to a store
  *already correctly classified* : never shown-all-then-trimmed. On the
  **rebuild path** there is no transient regardless, because results stage into
  `nextSearchResults` and only become visible at the end-of-rebuild swap
  (`extension.js:2372`). On the **incremental path** (open/save), the file simply
  appears one git-call later, already filtered, instead of flickering.
- **Insertion-site wiring (async resolution, sync predicate):**
  `applyNewTodoFilterToResults` callers await `ensureRepoForFile` first, at all
  sites:
  - full-scan candidate path (`extension.js:2035`, inside `.then`) and regex path
    (`:2151`, inside `.then`) : already promise chains, await fits.
  - incremental `refreshTextDocumentResults` / `refreshNotebookResults`
    (`:1895`, `:1921`) : make these (and their callers in `refreshScanTarget` /
    `refreshOpenFiles`) async so the await composes. `isNewTodo` itself stays
    sync. Guard the whole step behind `newTodoFilter.isEnabled()` so the
    filter-off path adds zero git work.
- **Late-resolution reconcile (timeout fallback only):** when a timed-out
  `extendForRepo` eventually resolves, it merges into the cache and triggers a
  one-file re-refresh (`refreshScanTarget`) for the affected target(s) so the
  optimistic state is corrected without waiting for the next full rebuild. This
  is the only path that can show a brief (bounded, rare) transient : it occurs
  *only* when a repo's first diff exceeds `newTodosGitTimeoutMs`.
- **Combined omission/degradation status node (Piece 3 UX).** Full UX rationale
  in `2026-05-30-new-todos-filter-scan-modes-ux-conflicts.md` -> "RESOLVED
  model"; this is the implementation summary. Reuse the existing status-node
  mechanism in `tree.js getChildren` (`tree.js:489`, alongside `filterStatusNode`
  / `scanModeNode`); `isStatusNode: true`, `icon: "git-branch"`. **One** node
  covers both hidden and shown-but-unfiltered files (supersedes the old
  per-reason "New-todos filter: ..." marker).
  - **Trigger:** filter ON and ≥1 *scanned* file is either **hidden** (external
    via `newTodosShowOpenFilesOutsideWorkspace: false`, or undiffable via
    `newTodosShowUndiffableFiles: false`) **or** **shown-but-unfiltered**
    (undiffable under fail-open). Driven by *scanned* files (computed
    pre-display), not displayed files, so hiding the last undiffable file still
    leaves its explanation.
  - **Counts:** **file** counts (not todos), per reason. Per-file precedence:
    a hidden file counts once under Hidden even if also undiffable.
  - **Label:** compact summary : `New-todos: N not shown` /
    `New-todos: N shown without filtering` /
    `New-todos: N not shown, M without filtering`. `current-file` mode uses
    singular "Current file not shown : ..." copy.
  - **Tooltip:** **two buckets** : `Hidden` then `Shown without filtering`; omit
    an empty bucket. One line per reason+count inside each; no-repo vs diff-failed
    split via M1 `classifyUndiffable`; "errors" kept for diff-failed.
    `outside the workspace` appears only under `Hidden`. (See the conflicts doc
    for the exact layout.)
  - **Click:** opens the setting responsible for the dominant reason
    (`workbench.action.openSettings` with that setting id).
  The extension computes per-reason file counts from the **scanned** set (it
  already knows which files were dropped/hidden per setting + each undiffable
  file's `classifyUndiffable`) and threads them into the provider like other
  status state. No new node *type*.

## Per-file visual layer

One per-file signal on file (path) nodes, via a single
**`FileDecorationProvider`** registered in `activate` and disposed via
`context.subscriptions`. It composes with the existing `showBadges` `resourceUri`
delegation (VS Code merges decorations), so it does not replace VS Code's own
file badges. The extension calls the provider's `onDidChangeFileDecorations`
emitter after each rebuild / lazy-extend so decorations refresh.

The provider keys on the file URI and consults `newTodoFilter` (active only when
the filter is ON):

1. **Undiffable files shown under fail-open** (`showUndiffableFiles === true`
   and `classifyUndiffable(fsPath) !== null`): apply a **dimmed theme colour**
   via `FileDecoration.color = new vscode.ThemeColor('gitDecoration.ignoredResourceForeground')`.
   No badge for this state (colour carries it). When `showUndiffableFiles` is
   `false` the files aren't shown at all, so no decoration applies.

> **Note (v2):** a per-file external-file marker (the `⧉` glyph distinguishing
> shown open files that live outside the workspace) is **out of scope** : see
> "Out of scope (v2)". External open files are still governed by
> `newTodosShowOpenFilesOutsideWorkspace` (shown/hidden, status node, current-file
> policy) : they simply carry no per-file visual marker when shown.

**Reason tooltip (per-file).** The full hover explanation lives on
`treeItem.tooltip` (which we already control; see "On existing tooltips" note in
the conversation : today it is the fsPath for file nodes, `tree.js:614`). When
the filter is ON and the node is undiffable, replace the tooltip with a
reason-aware `MarkdownString`. (Only files that are **shown** have a node and
thus a tooltip, i.e. undiffable under fail-open; hidden files have no node, so
there is no "Hidden" per-file tooltip : their explanation lives in the combined
status node.)
- **no-repo:** "Not in a git repository : new-todo filtering can't be applied.
  Showing all todos."
- **diff-failed:** "git diff failed (repo may not have base branch
  `<baseBranch>`). Showing all todos."
The reason line is followed by the **fsPath** (as today), so hover still gives
the path. Otherwise the tooltip falls back to the existing fsPath only, so normal
nodes are unchanged.

## Settings

These settings should be declared only under `better-todo-tree.*`.
This scan-mode/undiffable-files behavior is still in development and does not
exist in the original Todo Tree extension, so we should not introduce new
`todo-tree.*` legacy aliases for it.

- `filtering.newTodosShowUndiffableFiles`: boolean, default `true`.
  - `true` : files in no git repo / failed diff show all their todos (fail-open).
  - `false` : such files show nothing (fail-closed).
- `filtering.newTodosShowOpenFilesOutsideWorkspace`: boolean, default `true`.
  - Controls display of **diffable** open files that are **outside** all
     workspace roots. `true` : show them (no per-file marker in v1 : the `⧉`
     badge is out of scope); `false` : hide them from the tree entirely.
     Independent of the filter being on/off,
     but only meaningful in open-files / current-file / workspace+open modes
     where out-of-workspace files can appear.
- `filtering.newTodosGitTimeoutMs`: number, default `2000`.
  - Max time `ensureRepoForFile` waits for a first-touch `extendForRepo` (repo
     discovery + diff) before painting the file optimistically and reconciling
     when the diff later resolves. `0` disables the timeout (always wait).

### Enforcing `newTodosShowOpenFilesOutsideWorkspace`

"External" = an open/current scan target whose `fsPath` is not under any
workspace root (reuse `isFileInSearchRoots` against `getWorkspaceSearchRoots()`).
When the setting is `false`, external targets are **excluded from the scan set**
(their results are not written / removed), and each excluded file is recorded as
a Hidden:outside-workspace reason for the status node. Enforcement lives where
the scan targets are enumerated (`getOpenDocumentsForScan` /
`getNotebookDocumentsForScan`, `extension.js:1754` / `:1729`) so it applies
uniformly to full-rebuild and incremental paths.

**`current-file` is policy-first** (per the conflicts doc): the rule applies in
current-file mode too. If the active file is external and the setting is `false`,
it is excluded (skip its `git diff` entirely), the node shows the singular
"Current file not shown : outside the workspace" copy, and `Nothing found` is
**suppressed** (don't imply the file was processed with zero matches). When the
active file is eligible, current-file behaves normally.

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
| E10 | Lazy-extend transient flicker (4a): file shown-all then trimmed (fail-open) or missing then appears (fail-closed) | **Await-before-write**: classify before writing to any visible store. Rebuild path has no transient (staging swap); incremental path shows the file one git-call later, already correct. Slow first-touch is bounded by `newTodosGitTimeoutMs`; on timeout, paint optimistically then **reconcile** via a one-file re-refresh when the diff resolves |

## Error handling

- Per-root diff/status failures are individually `.catch`-wrapped to empty :
  one bad root cannot reject the `Promise.all`.
- `findRepoRoot` resolves `null` for non-repos (no rejection).
- `extendForRepo` failure leaves the existing cache intact and the file is
  treated as undiffable (fail-open/hide per setting).
- Existing "all roots failed" warning behavior (`extension.js:2355`) is retained;
  the new marker is additive and non-blocking.

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
  - `extendForRepo` merges without clobbering existing ranges; idempotent;
    routes a failed diff to `failedRoots`.
  - `coveredRoots` / `failedRoots` reflect diff outcomes correctly.
- **`ensureRepoForFile` / await-before-write (E10):**
  - resolves before write : a file is never written to a store in a state it
    will later be trimmed from (mock `extendForRepo` with a deferred promise;
    assert no optimistic write precedes resolution).
  - timeout path : when `extendForRepo` exceeds `newTodosGitTimeoutMs`, the
     file is painted per fail-open/closed, and the **late reconcile** re-refreshes
     that one file once the diff resolves (assert exactly one corrective refresh).
  - `newTodosGitTimeoutMs: 0` -> always waits, no timeout path.
- **`git.behavior.test.js`** (extend):
  - `findRepoRoot` : repo dir, nested dir, non-repo dir -> `null`.
  - `getUntrackedFiles` : parses `??` entries, applies globs.
- **`FileDecorationProvider`** (unit): undiffable file -> dim colour only under
  fail-open; diffable file (in- or out-of-workspace) -> no decoration. (The
  external-file badge is out of scope for v1.)
- **Combined status node** (unit on the count/trigger computation):
  - trigger driven by *scanned* files : hiding the last undiffable file still
    produces the node (counts from scanned set, not displayed).
  - both buckets populated simultaneously (Scenario 9 shape).
  - Hidden-wins precedence : external+undiffable file counts once, under Hidden.
  - default settings + an undiffable file present -> node shows "shown without
    filtering"; all-diffable -> no node.
  - `current-file` external + setting off -> singular copy, `Nothing found`
    suppressed, no `git diff` attempted for the file.
- **Integration:** each scan mode (current-file, open-files, workspace-only,
  workspace+open) x file location (in-workspace, other-repo, no-repo) x
  `newTodosShowUndiffableFiles` (true/false). Plus: open a new-repo file in
   open-files mode triggers lazy extend; untracked file shows all todos; combined
   node appears with correct bucket/counts; `newTodosShowOpenFilesOutsideWorkspace: false`
   hides out-of-workspace open files (and current-file policy-first).

## Out of scope (v2)

- E7 : auto-refresh on branch switch in out-of-workspace repos (watcher only
  covers workspace folders today).
- `fs.realpath` symlink canonicalization for the covered-root check.
- Per-repo base-branch-missing warnings.
- **Per-file external-file marker (`⧉`).** A per-file visual indicator
  distinguishing *shown* open files that live outside all workspace roots
  (e.g. an external-link glyph + "Open file outside the workspace" hover).
  Deferred because each available channel has a real drawback and none is
  clearly worth the complexity for v1:
  - `FileDecoration.badge` : the natural mechanism, but only renders when
    `tree.showBadges` is ON (the marker depends on `resourceUri` being set,
    `tree.js:603`), and competes for the single far-right badge slot with VS
    Code's git SCM badge (`M`/`U`/...), which can suppress it.
  - `treeItem.description` : already used for the per-file todo count when
    `tree.showCountsInTree` is ON (`tree.js:730`), so the glyph would have to be
    concatenated with the count.
  - appending to `treeItem.label` : always visible, but pollutes the label
    string used by folder compaction / copy / search (`tree.js:625`) and has no
    independent hover tooltip.
  The functional behavior stays in v1 : `newTodosShowOpenFilesOutsideWorkspace`
  still shows/hides external open files, the combined status node still reports
  the Hidden "outside the workspace" bucket, and the current-file policy-first
  rule still applies. Only the *visual marker on a shown external file* is
  deferred : revisit once a channel is chosen (likely label-append with the
  reason folded into `treeItem.tooltip`).
- **Per-repo base branches (E8).** Allow a different git base branch per repo
  (e.g. workspace repo diffs against `main`, an opened library repo against
  `develop`). This is an independent effort and drops in cleanly given the
  structure here, because:
  - `git.getChangedFilesAndLines(baseBranch, repoPath, ...)` and
    `git.extendForRepo`/`extendForRepo` already take the branch **per repo**.
  - `rangesByPath` is keyed by absolute path and `isNewTodo` is
    branch-agnostic, so the cache/predicate need no change.
  The future change is additive: a new config (e.g.
  `filtering.newTodosBaseBranchByRepo: { "<repoPathOrGlob>": "<branch>" }`)
  with `newTodosGitBaseBranch` as the fallback, plus a
  `resolveBranchForRoot(root)` resolver used inside `refresh`'s per-root map and
  by the `extendForRepo` caller, replacing the single scalar `branch`.
  **Structuring hint for v1:** keep branch resolution at the per-root site
  (inside `roots.map(...)` in `refresh`, and at the `extendForRepo` call site)
  rather than assuming one global branch deeper in the pipeline, so E8 is a
  one-line swap of the scalar for the resolver.
