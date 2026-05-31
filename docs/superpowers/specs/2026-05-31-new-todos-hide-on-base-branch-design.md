# New-Todos Hide-On-Base-Branch Design

**Date:** 2026-05-31
**Status:** Approved (pending user spec review)

## Problem

The new-todos filter already supports three distinct repo/file states:

- `no-repo`
- `diff-failed`
- `no-branch`

It also supports per-repo base branch resolution via `newTodosGitBaseBranch` / `newTodosGitBaseBranchPerRepo`.

One case is still missing: when a repo's **current branch is the same as its resolved new-todos base branch**, the repo is effectively diffing a branch against itself. In that case there are no "new" lines by definition, so the repo should contribute **0 todos** in new-todos-only mode.

Today that case falls through to normal diff behavior. The tree also has no explicit status for it, so users do not get a clear explanation that results are hidden because the repo is already on the configured base branch.

## Goal

When new-todos-only mode is enabled and a repo's current branch equals its resolved base branch:

- show **0 todos** for that repo
- ignore `better-todo-tree.filtering.newTodosShowUndiffableFiles` for that repo
- track the count separately from `noBranch`
- show that hidden count in the status node with text/tooltip that explains the reason

Required status-node behavior:

- Workspace mode, hidden only: `N not shown`
- Workspace mode, hidden + fail-open undiffables: `N not shown, M shown without filtering`
- Current-file mode: keep `Current file not shown`
- Tooltip: add a `Hidden:` bucket when needed, with `- N on git base branch`

## Scope

**In scope:**

- Detecting "current branch equals resolved base branch" per repo
- Hiding all todos from those repos in new-todos-only mode
- Threading a separate count/status bucket through scan/filter/tree status plumbing
- Preserving existing `noBranch` behavior as a separate reason

**Out of scope:**

- Changing how `noBranch` works
- Normalizing branch names beyond exact string equality
- Changing current-file label copy beyond keeping `Current file not shown`
- Any implementation beyond the spec/plan workflow

## Key design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Modeling | New separate reason/bucket: `on-base-branch` | Matches requested separate count from `noBranch` |
| Filtering behavior | Always hidden | Diffing a branch against itself should yield zero new todos, regardless of fail-open config |
| Equality | Exact current-branch string === resolved base-branch string | Smallest correct behavior; avoids ref normalization scope creep |
| Status node | Hidden count is separate from shown-without-filtering count | Matches requested `N not shown, M shown without filtering` wording |
| Current-file wording | Keep existing `Current file not shown` | User-approved |

## Components & data flow

### 1. `src/git.js`

Add a small helper to resolve the current branch name for a repo root, e.g. via `git branch --show-current` or equivalent.

Requirements:

- Input: repo root path
- Output: current branch string
- Reject on git errors so callers can fall back to existing behavior
- No branch-name normalization beyond trimming command output

This keeps git process handling inside the git layer instead of adding child-process logic to the filter.

### 2. `src/newTodoFilter.js`

Add a new tracked root bucket for repos whose current branch equals the resolved base branch, e.g. `onBaseBranchRoots`.

Behavior in `refresh( resolveBranch, roots, globs )`:

- Resolve branch per root as today
- If branch is blank: keep existing `noBranch` behavior
- If branch is non-blank: resolve current branch for the repo
- If current branch equals resolved base branch:
  - record the root in `onBaseBranchRoots`
  - skip git diff + untracked-file collection for that root
- Otherwise run the existing diff/untracked flow

Behavior in `extendForRepo( repoRoot, resolveBranch, globs )`:

- Apply the same branching logic for lazily discovered repos
- A root added to `onBaseBranchRoots` becomes a known owning repo, so repeated extends are skipped

Filtering/classification behavior:

- `isNewTodo( fsPath, line )` must return `false` for files owned by `onBaseBranchRoots`, regardless of `showUndiffableFiles`
- `classifyUndiffable( fsPath )` should continue to represent only undiffable reasons (`no-repo`, `diff-failed`, `no-branch`)
- Add a dedicated query for the new state, e.g. `classifyHidden(fsPath)` or `isOnBaseBranch(fsPath)`, so callers can count/report it without overloading undiffable classification

This keeps `on-base-branch` semantically distinct from undiffable reasons.

### 3. `src/extension.js`

Add a separate scanned count/set for the new reason, parallel to `scannedUndiffable`, e.g. `scannedHidden.onBaseBranch` or a new `scannedOnBaseBranch` set.

Plumbing changes:

- Clear the new set on rebuild
- In `applyNewTodoFilterToResults( uri, results )`:
  - keep existing `classifyUndiffable()` accounting for `no-repo` / `diff-failed` / `no-branch`
  - separately query the new filter API and record the file in the on-base-branch set when applicable
- Thread the count into `provider.setNewTodoStatus(...)`, e.g. `onBaseBranch: scannedOnBaseBranch.size`

This preserves the requested count separation:

- `noBranch` remains its own count
- `onBaseBranch` is reported independently

### 4. `src/tree.js`

Update the new-todo status node to support both:

- hidden counts from `onBaseBranch`
- shown-without-filtering counts from existing undiffable fail-open reasons

Workspace-mode label rules:

- If `onBaseBranch > 0` and shown-without-filtering count is `0`: `New-todos: N not shown`
- If `onBaseBranch > 0` and shown-without-filtering count is `> 0`: `New-todos: N not shown, M shown without filtering`
- Existing label behavior can remain for cases with zero `onBaseBranch`

Current-file label rules:

- If current file is hidden due to `onBaseBranch`: keep `Current file not shown`
- Existing current-file wording for undiffable cases remains unchanged

Tooltip rules:

- Add `Hidden:` section when `onBaseBranch > 0`
- Add bullet `- N on git base branch`
- Preserve the existing shown/hidden undiffable sections for `no-repo` / `diff-failed` / `no-branch`
- If both hidden and shown reasons exist, include both sections in the same tooltip

## Error handling & edge cases

- **Blank resolved base branch:** keep existing `noBranch` behavior. Do not reclassify it as `on-base-branch`.
- **Detached HEAD / unusual refs:** only count as `on-base-branch` if the current-branch helper returns the exact same non-blank string as the resolved base branch.
- **Current-branch lookup failure:** do not classify as `on-base-branch`; continue to the existing diff path. Only actual diff failures become `diff-failed`.
- **Mixed workspace states:** `onBaseBranch` can coexist with `noRepo`, `diffFailed`, and `noBranch` in the same scan. The status node must report both hidden and shown-without-filtering counts when applicable.
- **`newTodosShowUndiffableFiles = true`:** still does not show todos from `on-base-branch` repos.

## Testing

### `test/newTodoFilter.behavior.test.js`

- Repo whose current branch equals resolved base branch -> files under that root always return `false` from `isNewTodo`
- Same repo does not classify as `noBranch`
- Repo on a different branch still uses normal diff ranges
- Mixed roots: one `on-base-branch`, one diffable, one `noBranch`
- `showUndiffableFiles = true` does not override `on-base-branch`

### `test/tree.behavior.test.js`

- Workspace mode, only `onBaseBranch > 0` -> label `New-todos: N not shown`, tooltip contains `Hidden:` and `- N on git base branch`
- Workspace mode, `onBaseBranch > 0` plus fail-open undiffables -> label `New-todos: N not shown, M shown without filtering`
- Current-file mode, `onBaseBranch > 0` -> label `Current file not shown`

### Extension behavior tests

Add or update the closest extension scan/filter behavior tests so they verify:

- `onBaseBranch` count is threaded separately from `noBranch`
- files are counted once even when they contain multiple todos

### Git helper tests

Add a small unit test for the new git helper:

- returns current branch string on success
- rejects cleanly on git failure

## Files expected to change in implementation

- `src/git.js`
- `src/newTodoFilter.js`
- `src/extension.js`
- `src/tree.js`
- `test/newTodoFilter.behavior.test.js`
- `test/tree.behavior.test.js`
- extension/git behavior tests as needed
