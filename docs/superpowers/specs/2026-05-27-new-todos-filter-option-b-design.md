# Design: New-Todos-Only Filter (Option B — pre-insert) for better-todo-tree

## Goal

Port the "filter new todos from git branch" feature (todo-tree commit
`2566703322990e485ce898d62bae74cd7e579593`) to better-todo-tree, using a
**pre-insert predicate** integrated with better-todo-tree's streaming /
incremental-rescan pipeline (Option B), rather than a post-scan
`store.filter()` pass (Option A).

When enabled, the tree shows only TODOs that sit on lines changed relative to a
configured git base branch (`git diff <baseBranch>`).

## Why Option B

better-todo-tree mutates the search store from two sources:

1. Full scan (`scanWorkspaceCandidates` / `scanWorkspaceRegexMatches`).
2. Incremental per-file rescan on save/edit (`refreshTextDocumentResults`,
   `refreshNotebookResults`), driven by `onDidSaveTextDocument`.

Both funnel through `replaceSearchResults(uri, results, store)`. A post-scan
filter (Option A) would leave incremental rescans unfiltered until a re-sweep,
causing stale/unfiltered matches to flash into the tree. Option B filters at
insertion time, so every path stays consistent with no full-store sweep and no
flash.

## Architecture

A new module `src/newTodoFilter.js` owns the git-diff line-ranges cache and the
per-match predicate. It is the single source of truth for "is this match a new
todo?".

```
                  ┌─────────────────────────────────────────┐
                  │  newTodoFilter.js (module-level state)     │
                  │  • rangesByPath: Map<absPath,[[s,c],...]>   │
                  │  • enabled, baseBranch                      │
                  │  • refresh(branch, roots, globs) ─ async ─  │
                  │  • isNewTodo(fsPath, line) ─ sync ─          │
                  └─────────────────────────────────────────┘
        refresh() ▲ (async)                    │ isNewTodo() (sync)
                  │                             ▼
   ┌──────────────┴───────┐      ┌──────────────────────────────────┐
   │ executeRebuild()      │      │ scanWorkspaceCandidates/Regex     │
   │ branch-change cmd     │      │ refreshTextDocumentResults        │
   │ .git watcher          │      │   → filter results[] →            │
   │ toggle command        │      │     replaceSearchResults(uri,...) │
   └───────────────────────┘      └──────────────────────────────────┘
```

`git.js` ports over **unchanged** from the original commit and is wrapped by
`newTodoFilter.js`.

## Module: `src/newTodoFilter.js`

State (module-level):

- `debug` — injected logger.
- `enabled` — mirrors `workspaceState 'newTodosOnly'`.
- `baseBranch` — current base branch/revision.
- `rangesByPath: Map<absPath, [[startLine, count], ...]>` — diff ranges.

API:

- `init(debug)` — inject logger.
- `isEnabled()` / `setEnabled(v)`.
- `isNewTodo(fsPath, line)` — **pure + sync**. Looks up `rangesByPath`.
  Absence of an entry (file unchanged vs base) returns `false` → matches
  dropped. A present entry returns `true` iff `line` falls within any
  `[start, start + count - 1]` range.
- `refresh(branch, roots, globs)` — **async, the only git-touching path**.
  Rebuilds the whole map from `git.getChangedFilesAndLines` over all roots,
  maps each root's relative paths to absolute via `path.join(root, relPath)`,
  and **atomically swaps** `rangesByPath` (no partial state ever visible).
  Returns an empty map when disabled, no branch, or no roots.

### Semantics decisions

- **Unchanged file (no diff entry):** drop all its matches. This is the "new
  todos only" semantics; matches the original commit (`ranges` defaults to `[]`,
  `.some()` → `false`).
- **Async git, sync filter:** the cache is precomputed (async) at well-defined
  trigger points and read synchronously by `isNewTodo`. The hot filter path
  never blocks on git.

## Wiring into the scan/refresh paths

Helper in `extension.js`:

```js
function applyNewTodoFilterToResults( uri, results ) {
    if( !newTodoFilter.isEnabled() ) { return results; }
    return results.filter( function( r ) {
        return newTodoFilter.isNewTodo( uri.fsPath, r.line );
    } );
}
```

Three insertion sites, each immediately before `replaceSearchResults(...)`:

1. **Full scan, candidate path** — `scanWorkspaceCandidates`, the
   `.then(function(results){...})` block (~`extension.js:2029`).
2. **Full scan, regex path** — `scanWorkspaceRegexMatches`, the
   `.then(function(results){...})` block (~`extension.js:2145`).
3. **Incremental refresh** — `refreshTextDocumentResults` (~`extension.js:1892`)
   and `refreshNotebookResults` (~`extension.js:1918`).

Because the incremental save path (`onDidSaveTextDocument` →
`refreshTextDocumentResults`) shares the helper, a file saved while the mode is
on is filtered automatically.

### Match line-field verification

The original commit used `match.line` (1-based). During implementation,
confirm better-todo-tree's match object field name and 0/1-based indexing
against what `git.js` ranges produce. The helper is the single place to adjust
if they differ.

## Cache refresh lifecycle

Triggers, all calling `newTodoFilter.refresh(branch, roots, globs)`:

1. **Rebuild start.** In `executeRebuild()` (~`extension.js:2289`), after
   `searchList = getWorkspaceSearchRoots()`, await `refresh(...)` **before**
   `iterateSearchList` so the cache is populated before any match is filtered.
   `globs` is derived from `currentSettingsSnapshot` / `getSetting` (which
   already resolve the `todo-tree.*` ↔ `better-todo-tree.*` fallback).
2. **Branch-change command** (`better-todo-tree.newTodosChangeBranch`): writes
   the setting, then calls `rebuild()` → flows through trigger 1.
3. **Git-state watcher**: a `FileSystemWatcher` per root on `.git/HEAD` and
   `.git/refs/**`, registered in `activate`, disposed via
   `context.subscriptions`. On change, debounced (~300ms), call `rebuild()`.
   The handler early-returns when `!newTodoFilter.isEnabled()` to avoid needless
   rebuilds while the feature is off. Covers branch switch / commit / rebase.
4. **Toggle command** (`better-todo-tree.toggleNewTodosOnly`): updates
   `workspaceState 'newTodosOnly'`, calls `newTodoFilter.setEnabled(...)`, then
   `rebuild()`. A full rescan is required when turning the filter **off** to
   restore previously-dropped matches.

`rebuild()` already coalesces concurrent requests via
`scanInFlight`/`pendingRescan` (~`extension.js:2357`).

## Settings, commands, manifest

Ported from the original commit, adapted to better-todo-tree conventions:

- Settings: `filtering.newTodosGitBaseBranch`, `tree.buttons.toggleNewTodosOnly`.
- Commands: `toggleNewTodosOnly`, `newTodosChangeBranch`.
- Button context key: `*-show-toggle-new-todos-only-button`, set in
  `setButtonsAndContext`.
- **Dual namespace** per `MIGRATION.md`: declare settings/commands under both
  `better-todo-tree.*` (public) and `todo-tree.*` (legacy hidden alias). Reads
  go through `getSetting`, which already implements the fallback. Command
  handlers registered once and aliased.
- `codiconNames.js`: do **not** copy from the original commit; regenerate via
  the repo's `buildCodiconNames.js` if new icons are needed.

## Error handling & edge cases

- **Per-root git failure** (non-repo, bad branch): each root's
  `getChangedFilesAndLines` is individually `.catch`-wrapped to return an empty
  map, so one bad root cannot reject `Promise.all`. A failed root contributes no
  ranges → its files show no matches (consistent with "drop unchanged").
- **All roots failed:** surface a single non-blocking `showWarningMessage` (e.g.
  base branch does not exist), so an empty tree is explained. No per-root spam.
- **Toggle on with no base branch:** prompt via the same input box
  (`newTodosChangeBranch` already prefills the current branch) instead of
  silently emptying the tree.
- **Generation/cancellation:** `refresh` is awaited before `iterateSearchList`;
  the per-match filter is sync inside callbacks already guarded by
  `assertGenerationActive`. No extra guarding needed.
- **Multi-root workspaces:** handled by abs-path mapping in `refresh`.
- **Notebooks:** same helper applied; mismatched `.ipynb` line semantics
  degrade to dropping matches, not crashing.
- **Watcher churn:** debounced; early-returns when disabled.

## Testing

Repo convention: `test/*.behavior.test.js`.

- **Unit — `newTodoFilter.behavior.test.js`:**
  - `isNewTodo` boundaries: line at range start / end / just outside; `count`
    edge values; absent file → `false`.
  - `refresh` builds correct absolute-path map from a mocked
    `git.getChangedFilesAndLines`.
  - Partial failure → empty map for the bad root, other roots intact.
  - Disabled / empty branch / no roots → empty map.
- **Integration:**
  - Toggle on → only changed-line todos appear.
  - Save adding a todo on a changed line → appears; on an unchanged line →
    does not.
  - Branch change re-filters.
  - Toggle off → all matches return.
- Match the existing JS test harness/style in `test/`.

## Out of scope

- Porting `codiconNames.js` verbatim (regenerate instead).
- Option A post-scan filter.
- Per-incremental-refresh git diff (rejected as too slow).
