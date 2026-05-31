# UI Mockups: New-Todos Filter across scan modes

Companion to `2026-05-30-new-todos-filter-scan-modes-design.md`. ASCII mockups
of the Todo Tree view in the key cases, to review behavior before implementation.

Conventions used below:
- `[T]` = TODO item (leaf), `(N)` = todo count badge on a folder/file.
- Status nodes render at the top (existing `isStatusNode` pattern): scan-mode
  node (when `tree.showScanModeInTree`), filter-status node, and the **new
  combined omission/degradation node** (one node for hidden + shown-without-
  filtering files; tooltip has two buckets `Hidden` / `Shown without filtering`).
  See the conflicts doc "RESOLVED model". Older mockup labels like
  "New-todos filter: ..." below are shorthand for this node's summary label.
- `~ icon` notes the codicon shown on a status node.
- `«dim»` before a filename = file label rendered in a dimmed theme colour
  (`gitDecoration.ignoredResourceForeground`) via the FileDecorationProvider
  (undiffable file shown under fail-open).
- Scenarios assume the new-todos filter is **ON** unless stated.

> **v1 scope note:** a per-file external-file marker (the `⧉` glyph) is **out of
> scope** : see the design doc's "Out of scope (v2)". External open files are
> still shown/hidden by `newTodosShowOpenFilesOutsideWorkspace` and still drive
> the status node, but when shown they carry **no per-file visual marker** in
> v1. The `⧉` annotations below are retained only to illustrate *which* files
> are external; they do not render in v1.

Legend of file situations:
- **changed** : tracked file with diff hunks vs base branch -> only changed-line todos show.
- **unchanged** : tracked file, no diff vs base -> dropped (no todos).
- **untracked** : brand-new file (`??`) -> ALL todos show (whole-file sentinel).
- **undiffable** : in no git repo, or its repo's diff failed -> depends on `newTodosShowUndiffableFiles`.
- **external** : a *diffable* open file outside all workspace roots -> shown (no per-file marker in v1; `⧉` below is illustrative only) unless `newTodosShowOpenFilesOutsideWorkspace` is false.

---

## Baseline A : filter OFF (for comparison)

Scan mode: workspace. All todos show regardless of git state.

```
TODO TREE
├─ Scan mode: workspace and open files        ~ search
├─ my-app
│  ├─ src
│  │  ├─ auth.js (2)
│  │  │  ├─ [T] TODO refactor token refresh      :42
│  │  │  └─ [T] TODO handle expiry               :58
│  │  └─ utils.js (1)
│  │     └─ [T] TODO add unit tests              :10
│  └─ README.md (1)
│     └─ [T] TODO document setup                 :3
```

---

## Scenario 1 : workspace-only mode, filter ON (already works today)

`auth.js` has changes on lines 42 & 60; `utils.js` unchanged; a new untracked
`payments.js`. Base branch `main`.

```
TODO TREE
├─ Scan mode: workspace                       ~ search
├─ 1 filter active                            ~ filter
├─ my-app
│  ├─ src
│  │  ├─ auth.js (1)
│  │  │  └─ [T] TODO handle expiry               :60   <- on a changed line
│  │  └─ payments.js (2)                              <- untracked: ALL show
│  │     ├─ [T] TODO wire up Stripe              :5
│  │     └─ [T] TODO add idempotency key         :22
```

Note: `utils.js` is gone (unchanged -> dropped); `auth.js:42` dropped (not on a
changed line); untracked `payments.js` shows everything.

---

## Scenario 2 : current-file mode, file IN workspace : THE BUG vs THE FIX

Active file `src/auth.js` (in workspace), changed on line 60. Filter ON.

### 2a. Today (bug)

```
TODO TREE
├─ Scan mode: current file                    ~ search
├─ 1 filter active, Nothing found             ~ issues
```

Empty : the workspace root never enters the diff roots in current-file mode, so
every todo is dropped even though the file is changed.

### 2b. After fix

```
TODO TREE
├─ Scan mode: current file                    ~ search
├─ 1 filter active                            ~ filter
├─ auth.js (1)
│  └─ [T] TODO handle expiry                     :60
```

The file's repo root (the workspace folder) is now discovered and diffed.

---

## Scenario 3 : open-files mode, files across multiple locations

Open files:
- `~/my-app/src/auth.js` : in-workspace, changed (line 60).
- `~/other-lib/index.js` : different git repo, changed (line 12).
- `~/scratch/notes.js` : NOT in any git repo (undiffable).
- `~/my-app/src/payments.js` : in-workspace, untracked.

### 3a. `newTodosShowUndiffableFiles: true` (default, fail-open)

```
TODO TREE
├─ Scan mode: open files                      ~ search
├─ 1 filter active                            ~ filter
├─ New-todos: 1 shown without filtering       ~ git-branch     <- combined node
├─ auth.js (1)              (~/my-app/src)
│  └─ [T] TODO handle expiry                     :60
├─ index.js ⧉ (1)          (~/other-lib)              <- external badge (out of workspace)
│  └─ [T] TODO drop legacy path                  :12
├─ payments.js (2)         (~/my-app/src)             <- untracked: ALL show
│  ├─ [T] TODO wire up Stripe                    :5
│  └─ [T] TODO add idempotency key               :22
├─ «dim»notes.js ⧉ (3)     (~/scratch)                <- undiffable (dimmed) + external (⧉): ALL show
│  ├─ [T] TODO buy milk                          :1
│  ├─ [T] TODO ask about Q3                       :4
│  └─ [T] TODO follow up                          :9
```

Visual signals:
- `index.js` : diffable but outside the workspace -> `⧉` badge. Normal colour.
  Shown is filtered normally, so it is NOT in the node's counts.
- `notes.js` : in no git repo (undiffable) **and** outside the workspace, but
  shown (external-show is on) -> dimmed + `⧉`. Counts as 1 "shown without
  filtering" (not "hidden" : it's displayed).

Combined-node tooltip (two buckets; only the non-empty one shows here):
```text
Files affected by the new-todos filter

Shown without filtering
- 1 file not in a git repository
```
Per-file hover on `notes.js` (`treeItem.tooltip`): "Not in a git repository :
new-todo filtering can't be applied. Showing all todos." + path.
Hover on `index.js` badge: "Open file outside the workspace."

### 3b. `newTodosShowUndiffableFiles: false` (fail-closed)

```
TODO TREE
├─ Scan mode: open files                      ~ search
├─ 1 filter active                            ~ filter
├─ New-todos: 1 not shown                      ~ git-branch
├─ auth.js (1)             (~/my-app/src)
│  └─ [T] TODO handle expiry                     :60
├─ index.js ⧉ (1)          (~/other-lib)
│  └─ [T] TODO drop legacy path                  :12
├─ payments.js (2)         (~/my-app/src)
│  ├─ [T] TODO wire up Stripe                    :5
│  └─ [T] TODO add idempotency key               :22
```

`notes.js` is fully hidden (undiffable + fail-closed). Combined-node tooltip:
```text
Files affected by the new-todos filter

Hidden
- 1 file not in a git repository
```
`index.js` is still shown (it's diffable) and keeps its `⧉` external badge.

---

## Scenario 4 : E1/E9 lazy extend : opening a new-repo file mid-session

Open-files mode, filter ON. User opens `~/other-lib/index.js` (a repo NOT in the
last rebuild's diff roots). The incremental path resolves the repo
(`ensureRepoForFile`) **before** writing any results : **await-before-write**, so
there is no flicker.

### 4a. Before resolve (await-before-write)

The file is simply **not in the tree yet** : we don't write an optimistic state.
There is no shown-all-then-trimmed flicker; `index.js` just hasn't appeared:

```
├─ (other open files...)
   (index.js not shown yet : ensureRepoForFile in flight, ~one git call)
```

### 4b. After resolve (steady state, appears already-correct)

```
├─ index.js ⧉ (1)          (~/other-lib)         <- appears already filtered
│  └─ [T] TODO drop legacy path                  :12   <- only the changed-line todo
```

`index.js` appears one git-call later, **already** showing only the changed-line
todo (`:3`, an unchanged line, was never shown). The `⧉` external badge is
present (outside the workspace). Same for `newTodosShowUndiffableFiles: false` :
the file appears correct, never a wrong intermediate.

### 4c. Timeout fallback (slow repo only, `newTodosShowUndiffableFiles: true` example)

If `extendForRepo` exceeds `newTodosGitTimeoutMs` (default 2000), the file is
treated temporarily as undiffable, still respecting
`newTodosShowUndiffableFiles`, then **reconciled** when the diff lands. In this
example `newTodosShowUndiffableFiles: true`, so the file is painted
optimistically (dimmed, fail-open) instead of staying invisible:

```
  [t < timeout]   (index.js not shown yet)
  [t = timeout]   ├─ «dim»index.js ⧉ (2)   (~/other-lib)   <- optimistic: all todos, dimmed
                  │  ├─ [T] TODO drop legacy path           :12
                  │  └─ [T] TODO old comment                :3
  [diff resolves] ├─ index.js ⧉ (1)        (~/other-lib)   <- reconciled: trimmed + un-dimmed
                  │  └─ [T] TODO drop legacy path           :12
```

With `newTodosShowUndiffableFiles: false`, `index.js` stays hidden at timeout
and remains hidden until the reconcile runs. This bounded, rare transient
happens **only** past the timeout : the normal fast path (4a/4b) never flickers.

---

## Scenario 5 : E3 : repo missing the configured base branch

Open `~/other-lib/index.js`; base branch is `main` but `other-lib` only has
`master` -> its diff fails -> treated as undiffable.

### `newTodosShowUndiffableFiles: true`

```
├─ New-todos: 1 shown without filtering       ~ git-branch
├─ «dim»index.js ⧉ (2)     (~/other-lib)              <- fail-open (dimmed) + external (⧉)
│  ├─ [T] TODO drop legacy path                  :12
│  └─ [T] TODO old comment                        :3
```

The combined node distinguishes a **failed diff** (repo exists, base branch
missing) from a **no-repo** file via `classifyUndiffable`. Tooltip:
```text
Files affected by the new-todos filter

Shown without filtering
- 1 file could not be diffed (errors)
```

### Both reasons at once

If a no-repo file and a diff-failed file are open together (both fail-open):

```
├─ New-todos: 2 shown without filtering        ~ git-branch
```
Tooltip:
```text
Files affected by the new-todos filter

Shown without filtering
- 1 file not in a git repository
- 1 file could not be diffed (errors)
```

---

## Scenario 6 : everything diffable, nothing changed

Filter ON, all open/workspace files are tracked and unchanged vs base.

```
TODO TREE
├─ Scan mode: open files                      ~ search
├─ 1 filter active, Nothing found             ~ issues
```

Correct empty state : every file was successfully diffed and genuinely has no new
todos. No undiffable marker (nothing was undiffable). This is the legitimate
"nothing found" : distinct from the 2a bug, where the emptiness was wrong.

---

## Scenario 7 : `newTodosShowOpenFilesOutsideWorkspace: false`

Same open files as Scenario 3a, but external (out-of-workspace) open files are
hidden from the tree entirely. This setting is independent of the new-todos
filter : it controls whether out-of-workspace open files appear at all.

```
TODO TREE
├─ Scan mode: open files                      ~ search
├─ 1 filter active                            ~ filter
├─ New-todos: 2 not shown                      ~ git-branch
├─ auth.js (1)             (~/my-app/src)
│  └─ [T] TODO handle expiry                     :60
├─ payments.js (2)         (~/my-app/src)
│  ├─ [T] TODO wire up Stripe                    :5
│  └─ [T] TODO add idempotency key               :22
```

Both `index.js` (~/other-lib) and `notes.js` (~/scratch) are gone : they're
outside the workspace and `newTodosShowOpenFilesOutsideWorkspace` is false. No
`⧉` badges remain. The combined node **stays** (the model is driven by *scanned*
files, not displayed ones), now reporting the Hidden bucket. Per "Hidden wins",
`notes.js` (external **and** undiffable) is counted once, as outside-workspace:
```text
Files affected by the new-todos filter

Hidden
- 2 files outside the workspace
```

---

## Scenario 8 : E9 nested repo / submodule under a workspace repo

Workspace repo `~/app` (covered, diff vs `main` OK). A nested repo
`~/app/vendor/lib` (submodule or nested clone). Files:
- `~/app/src/main.js` : owned by `app`, changed on line 8.
- `~/app/src/old.js` : owned by `app`, unchanged.
- `~/app/vendor/lib/widget.js` : owned by `lib`. `lib` has changes on line 30,
  but those lines are NOT in `app`'s diff (different repo).
- `~/app/vendor/lib/util.js` : owned by `lib`, and `lib`'s diff **failed** (its
  base branch `main` is missing; `lib` uses `master`).

### 8a. Correct behavior (this design : owning repo wins)

```
TODO TREE
├─ Scan mode: workspace                        ~ search
├─ 1 filter active                             ~ filter
├─ New-todos: 1 shown without filtering        ~ git-branch
├─ app
│  ├─ src
│  │  └─ main.js (1)
│  │     └─ [T] TODO refactor                     :8     <- app-owned, changed line
│  └─ vendor/lib
│     ├─ widget.js (1)                                   <- lib-owned, lib covered
│     │  └─ [T] TODO rework layout                 :30
│     └─ «dim»util.js (2)                                <- lib diff failed -> undiffable, fail-open
│        ├─ [T] TODO handle null                   :4
│        └─ [T] TODO add test                      :19
```

- `old.js` (app-owned, unchanged) correctly **dropped**.
- `widget.js` evaluated against **`lib`'s** diff (its owning repo), so its
  changed-line todo shows : NOT forced to "drop" by the covered `app` ancestor.
- `util.js` : owning repo `lib` failed -> diff-failed/undiffable -> dimmed,
  fail-open (E9b: the covered `app` ancestor does NOT rescue it).

### 8b. The bug this fixes (old "any covered ancestor wins")

Under the rejected model, `widget.js` and `util.js` are "under covered root
`~/app`" with no `app` ranges -> **dropped**. The whole `vendor/lib` subtree
would vanish even though `lib` has new todos:

```
├─ app
│  └─ src
│     └─ main.js (1)
│        └─ [T] TODO refactor                     :8
```

---

## Scenario 9 : both buckets coexist

Open-files mode, filter ON. Settings: `newTodosShowUndiffableFiles: true`
(fail-open), `newTodosShowOpenFilesOutsideWorkspace: false` (hide external).
Files:
- `~/app/src/auth.js` : in-workspace, changed (shown, filtered).
- `~/app/vendor/lib/x.js` : in-workspace path but owned by nested repo `lib`
  whose diff failed -> undiffable, **in-workspace** so not hidden -> shown dimmed.
- `~/other/util.js` : diffable, **outside** workspace -> hidden.

```
TODO TREE
├─ Scan mode: open files                      ~ search
├─ 1 filter active                            ~ filter
├─ New-todos: 1 not shown, 1 without filtering  ~ git-branch
├─ auth.js (1)             (~/app/src)
│  └─ [T] TODO handle expiry                     :60
├─ «dim»x.js (2)           (~/app/vendor/lib)         <- undiffable (diff-failed), shown dimmed
│  ├─ [T] TODO handle null                       :4
│  └─ [T] TODO add test                          :19
```

`util.js` hidden (external); `x.js` shown dimmed (fail-open, diff-failed).
Tooltip shows **both** buckets:
```text
Files affected by the new-todos filter

Hidden
- 1 file outside the workspace

Shown without filtering
- 1 file could not be diffed (errors)
```

---

## Scenario 10 : current-file mode, external active file, policy-first

Current-file mode, filter ON, `newTodosShowOpenFilesOutsideWorkspace: false`.
The active editor is `~/other/scratch.js` (outside the workspace).

```
TODO TREE
├─ Scan mode: current file                    ~ search
├─ 1 filter active                            ~ filter
├─ New-todos: current file not shown          ~ git-branch
```

The active file is hidden by policy (external + setting off); `git diff` is
skipped for it. The node uses the singular current-file copy and `Nothing found`
is **suppressed** (the file wasn't processed-with-zero-matches, it was excluded).
Tooltip:
```text
Files affected by the new-todos filter

Hidden
- current file is outside the workspace
```

---

## Status node design : resolved decisions

Combined into one node (see conflicts doc "RESOLVED model"). The earlier M1-M4
points fold in as:

- **One combined node** (not separate external/undiffable). `isStatusNode`, icon
  `git-branch`, below "N filters active". Supersedes the old "New-todos filter:…"
  per-reason marker.
- **Trigger = scanned files** (not displayed): appears when ≥1 scanned file is
  hidden (external-off / undiffable-off) or shown-without-filtering (fail-open
  undiffable). So it survives hiding the last undiffable file.
- **Two-bucket tooltip:** `Hidden` then `Shown without filtering`; per-reason
  lines (no-repo vs diff-failed via `classifyUndiffable`; "errors" kept for
  diff-failed; "outside the workspace" only under Hidden). Per-file precedence:
  Hidden wins.
- **Count = files** (not todos).
- **Clickable = opens the setting** responsible for the dominant reason.
- `current-file` mode: singular "current file not shown" copy; policy-first
  (honors `newTodosShowOpenFilesOutsideWorkspace`); suppresses `Nothing found`
  when the active file was excluded.

## Per-file visual layer : resolved decisions

- **Mechanism:** single `FileDecorationProvider` (label colour only) +
  reason-aware `treeItem.tooltip`. Composes with existing `showBadges`.
- **Undiffable colour:** dimmed theme colour
  `gitDecoration.ignoredResourceForeground` (no new config). Applies only under
  fail-open (`newTodosShowUndiffableFiles: true`).
- **External indicator:** **out of scope for v1** (see design doc "Out of scope
  (v2)"). Shown external open files carry no per-file marker; the `⧉` glyph in
  the scenarios above is illustrative only. Their hide/show is still governed by
  `newTodosShowOpenFilesOutsideWorkspace` and reported by the status node.
- **Reason tooltip:** `treeItem.tooltip` becomes reason-aware (no-repo vs
  diff-failed) when the filter is ON and the file is undiffable; otherwise falls
  back to the existing fsPath tooltip.

## Transient handling : resolved decisions (E10)

- **Await-before-write:** classify a file before writing it to any visible store
  -> no shown-all-then-trimmed (or missing-then-appears) flicker. Rebuild path
  never flickers (staging swap); incremental path shows the file one git-call
  later, already correct.
- **Timeout fallback:** `filtering.newTodosGitTimeoutMs` (default 2000)
  bounds the first-touch wait. On timeout, paint optimistically (dimmed,
  fail-open) then **reconcile** the one file when the diff resolves. Only path
  that can briefly flicker, and only for genuinely slow repos.

## Settings : resolved shapes

- `filtering.newTodosShowUndiffableFiles` : boolean, default `true` (fail-open).
  (Refactored from the earlier `"show"`/`"hide"` string.)
- `filtering.newTodosShowOpenFilesOutsideWorkspace` : boolean, default `true`. Hides/shows
  diffable open files outside the workspace.
- `filtering.newTodosGitTimeoutMs` : number, default `2000`. First-touch
  repo-resolve timeout; `0` = always wait.
