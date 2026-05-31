# Per-Repo New-Todos Base Branch Design

**Date:** 2026-05-31
**Status:** Approved (pending user spec review)

## Problem

The new-todos filter diffs every git repo in the workspace against a single base branch (`filtering.newTodosGitBaseBranch`). In a multi-root workspace whose folders come from different repos, those repos often want different base branches (e.g. `main` for one, `develop` for another). Today that's impossible: one setting applies to all roots.

This is the per-repo milestone anticipated by the "Forward note" in `docs/superpowers/specs/2026-05-31-new-todos-empty-base-branch-design.md:40`.

## Goal

Allow configuring the base branch **per repo**, keyed by absolute repo-root path. The existing single setting stays and is used as the fallback for any repo not listed.

Resolution per repo root:

```
resolve(root) = map[root]  (if present and non-blank)
              ↳ else newTodosGitBaseBranch  (the existing global setting)
              ↳ else "" (blank → repo is undiffable, 'no-branch')
```

## Scope

**In scope:**
- New map setting `filtering.newTodosGitBaseBranchPerRepo`.
- Per-root branch resolution in `config.js`.
- Threading per-root resolution through `newTodoFilter` (`refresh`, `extendForRepo`) and `extension.js` (`ensureRepoForFile` and call sites).
- Per-root `no-branch` detection (replaces the global `missingBranch` flag).
- Scan warning and toggle-on prompt logic updated for per-repo resolution.

**Out of scope:**
- UI for editing the map (edited by hand in `settings.json`).
- A `todo-tree.*` legacy mirror of the new setting — this is an in-development feature that never existed in the original Todo Tree plugin.
- Writing map entries from the toggle-on prompt (prompt keeps writing the global setting).
- Relative / `~` path keys, prefix/ancestor matching (exact normalized repo-root match only).

## Key design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repo key | Absolute repo-root path → branch, in one `object` setting | Matches how diff logic already keys work (by repo root); flexible |
| Path forms | Absolute only | Simplest, unambiguous; portability deferred (YAGNI) |
| Match rule | Exact, normalized repo-root match | Predictable; reuses existing `normalizePath` dedup logic |
| Blank map value | Falls through to global setting | A blank entry means "not configured", same as absent |
| Fallback | Per-repo overrides, else global `newTodosGitBaseBranch` | What the user asked for; old setting keeps working |
| Threading | Resolver function `resolveBranch(root)` passed into filter | Handles lazily-discovered repos (`extendForRepo`) naturally |
| `no-branch` model | Per-root (was a global flag) | Now branches differ per root; blank is a per-repo condition |
| Legacy mirror | None | Feature doesn't exist in upstream Todo Tree |

## Path normalization

Reuse `diffRootsHelper.normalizePath` (already exported, `src/diffRootsHelper.js:13`) on **both** map keys and the repo root before comparing:

- Backslashes → forward slashes.
- Windows drive-letter paths (`C:/…`) lowercased; other paths left as-is (so case-sensitive Linux works).

Exact equality of normalized strings. A key pointing at a subfolder of a repo does **not** match.

## Components & data flow

### 1. New setting (`package.json`)

Add **only** to the `better-todo-tree` namespace (no `todo-tree.*` mirror):

```json
"better-todo-tree.filtering.newTodosGitBaseBranchPerRepo": {
    "type": "object",
    "default": {},
    "additionalProperties": { "type": "string" },
    "markdownDescription": "%newTodosGitBaseBranchPerRepo.description%",
    "scope": "resource"
}
```

Description string in `package.nls.json`: keys are absolute git repo-root paths, values are the branch/revision to diff that repo against; repos not listed fall back to `#better-todo-tree.filtering.newTodosGitBaseBranch#`.

Description text to use:
> Per-repository version of #better-todo-tree.filtering.newTodosGitBaseBranch# setting. Keys are absolute paths to the git repo root; values are the git branch / revision. Falls back to #better-todo-tree.filtering.newTodosGitBaseBranch# when a repo is missing. Example: { "/home/me/code/repo-a": "main", "/home/me/code/repo-b": "develop" }

`getSetting` (`src/extensionIdentity.js:146`) checks the current namespace first and only falls to legacy if the current namespace has no explicit value, so a `better-todo-tree`-only setting resolves correctly without a legacy declaration.

### 2. Resolution (`config.js`)

Keep `newTodosGitBaseBranch()` unchanged (the fallback). Add:

```js
function newTodosGitBaseBranchPerRepo()
{
    return identity.getSetting( 'filtering.newTodosGitBaseBranchPerRepo', {} ) || {};
}

function resolveNewTodosGitBaseBranch( repoRoot )
{
    var map = newTodosGitBaseBranchPerRepo();
    var target = diffRootsHelper.normalizePath( repoRoot );
    var matched = '';
    Object.keys( map ).forEach( function( key )
    {
        if( diffRootsHelper.normalizePath( key ) === target )
        {
            matched = map[ key ];
        }
    } );
    if( matched && String( matched ).trim() !== '' )
    {
        return matched;
    }
    return newTodosGitBaseBranch();
}
```

Export both `newTodosGitBaseBranchPerRepo` and `resolveNewTodosGitBaseBranch`.

### 3. Filter (`newTodoFilter.js`)

Replace the single `branch` parameter with a `resolveBranch( root )` function. The filter no longer holds a single `baseBranch`/`missingBranch`; it tracks blank-branch roots per root.

- **`refresh( resolveBranch, roots, globs )`**
  - For each root: `var branch = resolveBranch( root )`.
    - Blank (`!branch || String(branch).trim() === ''`) → record root as `no-branch`, skip git.
    - Non-blank → diff + untracked as today.
  - `missingBranch` becomes "≥1 in-scope root resolved blank" (derived from the per-root set), used by the scan warning. Keep the existing early-return shape for the disabled / no-roots case.
- **`extendForRepo( repoRoot, resolveBranch, globs )`**
  - Resolve the branch for the lazily-discovered root. Blank → mark the root known + `no-branch` (so `isOwningRepoKnown` is true and status is correct), skip git. Non-blank → diff as today.
- **`no-branch` roots** flow into the existing undiffable pipeline that drives `provider.setNewTodoStatus({ noBranch })`. The status node is already additive (one tooltip bucket per reason), so per-root `no-branch` coexists with `no-repo`/`diff-failed` — as future-proofed by the empty-base-branch design.

### 4. `extension.js`

- `ensureRepoForFile( fsPath, resolveBranch, globs )`: move the `!branch` short-circuit to **after** the repo root is resolved — resolve `resolveBranch(repoRoot)`, bail (mark `no-branch`) if blank, else `extendForRepo`. The early `newTodoFilter.isEnabled() !== true` / `!fsPath` guards stay.
- Call sites pass `config.resolveNewTodosGitBaseBranch` (the function) instead of `config.newTodosGitBaseBranch()`:
  - `refreshDocumentResults` (`src/extension.js:1936`)
  - `refreshNotebookResults` (`src/extension.js:1965`)
  - full-scan rebuild `newTodoFilter.refresh(...)` (`src/extension.js:2557`)
- **Scan warning** (`src/extension.js:2560-2566`): fire the "no base branch" warning when **any in-scope repo resolves blank** (from the filter's per-root `no-branch` count), instead of checking the single global setting.
- **`setNewTodoStatus.baseBranch`** (`src/extension.js:2595`): keep passing the global `config.newTodosGitBaseBranch()` — it's informational only. Per-repo display is out of scope.

### 5. Toggle-on prompt (`extension.js:3878-3917`)

- `doToggleNewTodosOnly`: prompt only when **all in-scope repos resolve blank** (global blank AND no map entry covers them). If ≥1 repo resolves to a branch, toggle on without prompting; blank repos show as undiffable. Determine "all blank" from the same per-root resolution used by the scan (e.g. resolve over the collected diff roots, or reuse the filter's `no-branch`-vs-covered accounting).
- `promptForNewTodosBranch`: still writes the global `filtering.newTodosGitBaseBranch` (Workspace target). Update the prompt copy to point at the map for per-repo control, e.g.:
  > Git branch / revision to diff against (applies to all repos; for per-repo branches set `filtering.newTodosGitBaseBranchPerRepo`)

## Error handling

- Map is not an object / malformed: `getSetting` returns the declared default `{}` (VS Code validates against the schema), so `resolveNewTodosGitBaseBranch` falls back to the global setting. The `|| {}` guard covers a null value.
- Blank map value: treated as unset (falls through to global) — never produces a blank branch when the global is set.
- A repo resolving blank is the `no-branch` undiffable state — fail-open per `newTodosShowUndiffableFiles`, same as today.

## Testing

**`config` behavior** (`test/config.behavior.test.js`):
- `resolveNewTodosGitBaseBranch`: map hit returns mapped branch; blank map value falls back to global; absent entry falls back to global; both blank → blank.
- Normalization: backslash key matches forward-slash root; `C:\Repo` key matches `c:/repo` root (drive-letter lowercasing); subfolder key does **not** match repo root.

**`newTodoFilter` behavior** (`test/tree.behavior.test.js` / filter tests):
- Mixed roots in one `refresh`: one mapped, one fallback (global), one blank → blank root reported `no-branch`, others diffed with their resolved branch.
- `extendForRepo`: mapped root diffs with its branch; blank-resolving root is marked known + `no-branch` without running git.
- Scan warning fires when ≥1 root is `no-branch`; does not fire when all roots resolve.

Test functions stay logic-light: pass a small `resolveBranch` stub / fake config map and assert on resolved branch + `no-branch` accounting, rather than re-deriving resolution in the test.
