# UI Mockups: New-Todos Filter across scan modes (workspace boundary as a scan mode)

Companion to `2026-05-30-scan-modes-workspace-boundary-redesign.md`. ASCII
mockups of the Todo Tree view in the key cases, to review behavior before
implementation. **Self-contained**: you do not need the older mockups doc.

## Conventions

- `[T]` = TODO item (leaf). `(N)` = todo count badge on a folder/file.
- Status nodes render at the top (existing `isStatusNode` pattern): scan-mode
  node (when `tree.showScanModeInTree`), filter-status node, and the **combined
  omission/degradation node** (one node for hidden + shown-without-filtering
  files; tooltip has two buckets `Hidden` / `Shown without filtering`).
- `~ icon` notes the codicon shown on a status node.
- `«dim»` before a filename = file label rendered in a dimmed theme colour
  (`gitDecoration.ignoredResourceForeground`) via the `FileDecorationProvider`
  (undiffable file shown under fail-open).
- Scenarios assume the new-todos filter is **ON** unless stated.

### No per-file external marker (v1)

The workspace boundary is now a **scan mode**, not a per-file setting. A shown
out-of-workspace file (in modes 3/4/5) is just a **normally-shown file** : it
carries **no** per-file visual marker. (The `⧉` glyph from earlier drafts is
gone : out of scope, see the design doc.) The only thing that distinguishes an
external file from an in-workspace one is its path / folder grouping in the tree.

### The five scan modes

| # | Label | Scan target | Out-of-workspace files |
|---|---|---|---|
| 1 | workspace only | whole workspace | n/a |
| 2 | open files (workspace only) | open files | excluded |
| 3 | open files (in and out of workspace) | open files | included |
| 4 | workspace + any open files | workspace + open | included |
| 5 | current file | active file | always included |

### Legend of file situations

- **changed** : tracked file with diff hunks vs base branch -> only changed-line todos show.
- **unchanged** : tracked file, no diff vs base -> dropped (no todos).
- **untracked** : brand-new file (`??`) -> ALL todos show (whole-file sentinel).
- **undiffable** : in no git repo, or its repo's diff failed -> depends on `newTodosShowUndiffableFiles`.
- **external** : an open/active file outside all workspace roots. In modes 3/4/5
  it is scanned + shown like any file. In mode 2 it is excluded.

---

## Baseline A : filter OFF (for comparison)

Mode 4 (workspace + any open files). All todos show regardless of git state.

```
TODO TREE
├─ Scan mode: workspace + any open files       ~ search
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

## Scenario 1 : mode 1 (workspace only), filter ON (already works today)

`auth.js` changed on lines 42 & 60; `utils.js` unchanged; new untracked
`payments.js`. Base branch `main`.

```
TODO TREE
├─ Scan mode: workspace only                   ~ search
├─ 1 filter active                             ~ filter
├─ my-app
│  ├─ src
│  │  ├─ auth.js (1)
│  │  │  └─ [T] TODO handle expiry               :60   <- on a changed line
│  │  └─ payments.js (2)                              <- untracked: ALL show
│  │     ├─ [T] TODO wire up Stripe              :5
│  │     └─ [T] TODO add idempotency key         :22
```

`utils.js` gone (unchanged -> dropped); `auth.js:42` dropped (not on a changed
line); untracked `payments.js` shows everything. No omission node : nothing was
hidden or shown-without-filtering.

---

## Scenario 2 : mode 5 (current file), file IN workspace : THE BUG vs THE FIX

Active file `src/auth.js` (in workspace), changed on line 60. Filter ON.

### 2a. Today (bug)

```
TODO TREE
├─ Scan mode: current file                     ~ search
├─ 1 filter active, Nothing found              ~ issues
```

Empty : the workspace root never enters the diff roots in current-file mode, so
every todo is dropped even though the file is changed.

### 2b. After fix

```
TODO TREE
├─ Scan mode: current file                     ~ search
├─ 1 filter active                             ~ filter
├─ auth.js (1)
│  └─ [T] TODO handle expiry                     :60
```

The file's repo root (the workspace folder) is now discovered and diffed.

---

## Scenario 3 : mode 3 (open files, in and out of workspace)

Open files:
- `~/my-app/src/auth.js` : in-workspace, changed (line 60).
- `~/other-lib/index.js` : different git repo, **external**, changed (line 12).
- `~/scratch/notes.js` : NOT in any git repo, **external**, undiffable.
- `~/my-app/src/payments.js` : in-workspace, untracked.

### 3a. `newTodosShowUndiffableFiles: true` (default, fail-open)

```
TODO TREE
├─ Scan mode: open files (in and out of workspace)   ~ search
├─ 1 filter active                                   ~ filter
├─ New-todos: 1 shown without filtering              ~ git-branch   <- combined node
├─ auth.js (1)             (~/my-app/src)
│  └─ [T] TODO handle expiry                     :60
├─ index.js (1)            (~/other-lib)              <- external, but just a normal file in mode 3
│  └─ [T] TODO drop legacy path                  :12
├─ payments.js (2)         (~/my-app/src)             <- untracked: ALL show
│  ├─ [T] TODO wire up Stripe                    :5
│  └─ [T] TODO add idempotency key               :22
├─ «dim»notes.js (3)       (~/scratch)                <- undiffable (dimmed): ALL show
│  ├─ [T] TODO buy milk                          :1
│  ├─ [T] TODO ask about Q3                       :4
│  └─ [T] TODO follow up                          :9
```

Visual signals:
- `index.js` : external but **diffable** -> filtered normally, normal colour, no
  marker. NOT in the node's counts.
- `notes.js` : in no git repo (undiffable), shown under fail-open -> dimmed.
  Counts as 1 "shown without filtering".

Combined-node tooltip (only the non-empty bucket shows):
```text
Files affected by the new-todos filter

Shown without filtering
- 1 file not in a git repository
```
Per-file hover on `notes.js` (`treeItem.tooltip`): "Not in a git repository :
new-todo filtering can't be applied. Showing all todos." + path.

### 3b. `newTodosShowUndiffableFiles: false` (fail-closed)

```
TODO TREE
├─ Scan mode: open files (in and out of workspace)   ~ search
├─ 1 filter active                                   ~ filter
├─ New-todos: 1 not shown                            ~ git-branch
├─ auth.js (1)             (~/my-app/src)
│  └─ [T] TODO handle expiry                     :60
├─ index.js (1)            (~/other-lib)
│  └─ [T] TODO drop legacy path                  :12
├─ payments.js (2)         (~/my-app/src)
│  ├─ [T] TODO wire up Stripe                    :5
│  └─ [T] TODO add idempotency key               :22
```

`notes.js` fully hidden (undiffable + fail-closed). Combined-node tooltip:
```text
Files affected by the new-todos filter

Hidden
- 1 file not in a git repository
```
`index.js` still shown (diffable, external is fine in mode 3).

---

## Scenario 4 : mode 2 (open files, workspace only) : external files excluded

Same open files as Scenario 3, but the mode now **excludes external files**
entirely. This is the mode you pick when you want only in-workspace open files.
`newTodosShowUndiffableFiles: true`.

```
TODO TREE
├─ Scan mode: open files (workspace only)        ~ search
├─ 1 filter active                               ~ filter
├─ New-todos: 2 not shown                        ~ git-branch
├─ auth.js (1)             (~/my-app/src)
│  └─ [T] TODO handle expiry                     :60
├─ payments.js (2)         (~/my-app/src)
│  ├─ [T] TODO wire up Stripe                    :5
│  └─ [T] TODO add idempotency key               :22
```

Both `index.js` (~/other-lib) and `notes.js` (~/scratch) are gone : external,
and mode 2 excludes external files. The combined node **stays** (driven by
*scanned* files), reporting the Hidden bucket. Per "Hidden wins", `notes.js`
(external **and** undiffable) is counted once, as outside-workspace:
```text
Files affected by the new-todos filter

Hidden
- 2 files outside the workspace
```
**Click** on this node opens the **scan-mode picker** (not a setting) so the user
can switch to mode 3/4 to include external files.

This is the same outcome the old `newTodosShowOpenFilesOutsideWorkspace: false`
produced : it is now mode 2 instead of a boolean.

---

## Scenario 5 : E1/E9 lazy extend : opening a new-repo file mid-session

Mode 3, filter ON. User opens `~/other-lib/index.js` (a repo NOT in the last
rebuild's diff roots). The incremental path resolves the repo
(`ensureRepoForFile`) **before** writing any results : **await-before-write**, so
there is no flicker.

### 5a. Before resolve (await-before-write)

The file is simply **not in the tree yet** : no optimistic write, no
shown-all-then-trimmed flicker. `index.js` just hasn't appeared:

```
├─ (other open files...)
   (index.js not shown yet : ensureRepoForFile in flight, ~one git call)
```

### 5b. After resolve (steady state, appears already-correct)

```
├─ index.js (1)            (~/other-lib)         <- appears already filtered
│  └─ [T] TODO drop legacy path                  :12   <- only the changed-line todo
```

`index.js` appears one git-call later, **already** showing only the changed-line
todo (`:3`, an unchanged line, was never shown). Same for
`newTodosShowUndiffableFiles: false` : the file appears correct, never a wrong
intermediate.

### 5c. Timeout fallback (slow repo only, `newTodosShowUndiffableFiles: true`)

If `extendForRepo` exceeds `newTodosGitTimeoutMs` (default 2000), the file is
treated temporarily as undiffable, still respecting
`newTodosShowUndiffableFiles`, then **reconciled** when the diff lands. Here
fail-open, so the file is painted optimistically (dimmed) instead of staying
invisible:

```
  [t < timeout]   (index.js not shown yet)
  [t = timeout]   ├─ «dim»index.js (2)   (~/other-lib)   <- optimistic: all todos, dimmed
                  │  ├─ [T] TODO drop legacy path         :12
                  │  └─ [T] TODO old comment              :3
  [diff resolves] ├─ index.js (1)        (~/other-lib)   <- reconciled: trimmed + un-dimmed
                  │  └─ [T] TODO drop legacy path         :12
```

With `newTodosShowUndiffableFiles: false`, `index.js` stays hidden at timeout
and until the reconcile runs. This bounded, rare transient happens **only** past
the timeout; the normal fast path (5a/5b) never flickers.

---

## Scenario 6 : E3 : repo missing the configured base branch

Mode 3. Open `~/other-lib/index.js`; base branch is `main` but `other-lib` only
has `master` -> its diff fails -> treated as undiffable.

### `newTodosShowUndiffableFiles: true`

```
├─ New-todos: 1 shown without filtering          ~ git-branch
├─ «dim»index.js (2)       (~/other-lib)              <- fail-open (dimmed), diff-failed
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

### Both diffability reasons at once

A no-repo file and a diff-failed file open together (both fail-open):

```
├─ New-todos: 2 shown without filtering          ~ git-branch
```
Tooltip:
```text
Files affected by the new-todos filter

Shown without filtering
- 1 file not in a git repository
- 1 file could not be diffed (errors)
```

---

## Scenario 7 : everything diffable, nothing changed

Mode 3, filter ON, all open files tracked and unchanged vs base.

```
TODO TREE
├─ Scan mode: open files (in and out of workspace)   ~ search
├─ 1 filter active, Nothing found                    ~ issues
```

Correct empty state : every file was successfully diffed and genuinely has no new
todos. No omission node (nothing undiffable, nothing hidden). This is the
legitimate "nothing found" : distinct from the 2a bug, where the emptiness was
wrong.

---

## Scenario 8 : E9 nested repo / submodule under a workspace repo

Mode 1 (workspace only). Workspace repo `~/app` (covered, diff vs `main` OK). A
nested repo `~/app/vendor/lib` (submodule or nested clone). Files:
- `~/app/src/main.js` : owned by `app`, changed on line 8.
- `~/app/src/old.js` : owned by `app`, unchanged.
- `~/app/vendor/lib/widget.js` : owned by `lib`. `lib` has changes on line 30,
  not in `app`'s diff (different repo).
- `~/app/vendor/lib/util.js` : owned by `lib`, and `lib`'s diff **failed** (its
  base branch `main` is missing; `lib` uses `master`).

### 8a. Correct behavior (owning repo wins)

```
TODO TREE
├─ Scan mode: workspace only                     ~ search
├─ 1 filter active                               ~ filter
├─ New-todos: 1 shown without filtering          ~ git-branch
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

Tooltip:
```text
Files affected by the new-todos filter

Shown without filtering
- 1 file could not be diffed (errors)
```

### 8b. The bug this fixes (rejected "any covered ancestor wins" model)

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

## Scenario 9 : both buckets coexist (mode 2)

Mode 2 (open files, workspace only), filter ON,
`newTodosShowUndiffableFiles: true` (fail-open). Files:
- `~/app/src/auth.js` : in-workspace, changed (shown, filtered).
- `~/app/vendor/lib/x.js` : in-workspace path but owned by nested repo `lib`
  whose diff failed -> undiffable, **in-workspace** so NOT excluded -> shown dimmed.
- `~/other/util.js` : diffable, **external** -> excluded by mode 2.

```
TODO TREE
├─ Scan mode: open files (workspace only)        ~ search
├─ 1 filter active                               ~ filter
├─ New-todos: 1 not shown, 1 without filtering   ~ git-branch
├─ auth.js (1)             (~/app/src)
│  └─ [T] TODO handle expiry                     :60
├─ «dim»x.js (2)           (~/app/vendor/lib)         <- undiffable (diff-failed), shown dimmed
│  ├─ [T] TODO handle null                       :4
│  └─ [T] TODO add test                          :19
```

`util.js` hidden (external, excluded by mode 2); `x.js` shown dimmed (in-workspace
so not excluded, but diff-failed -> fail-open). Tooltip shows **both** buckets:
```text
Files affected by the new-todos filter

Hidden
- 1 file outside the workspace

Shown without filtering
- 1 file could not be diffed (errors)
```

(The two buckets can only coexist in **mode 2** : it's the only mode that hides
for being external. In modes 3/4/5 the Hidden:outside-workspace bucket never
appears.)

---

## Scenario 10 : mode 5 (current file), active file external

Mode 5, filter ON. The active editor is `~/other/scratch.js` (outside the
workspace). Current-file mode **always scans the active file** (no boundary
axis), so what happens depends on the **diffability** axis only.

### 10a. `scratch.js` is in a git repo, changed (diffable)

```
TODO TREE
├─ Scan mode: current file                       ~ search
├─ 1 filter active                               ~ filter
├─ scratch.js (1)          (~/other)
│  └─ [T] TODO fix this later                     :7
```

Filtered normally. External is irrelevant in current-file mode : no hiding, no
node.

### 10b. `scratch.js` not in any git repo, `newTodosShowUndiffableFiles: false`

```
TODO TREE
├─ Scan mode: current file                       ~ search
├─ 1 filter active                               ~ filter
├─ New-todos: current file not shown             ~ git-branch
```

The active file is undiffable and fail-closed -> shows nothing. Singular
current-file copy; `Nothing found` is **suppressed** (the file was dropped by the
diffability policy, not processed-with-zero-matches). Tooltip:
```text
Files affected by the new-todos filter

Hidden
- current file is not in a git repository
```

### 10c. Same as 10b but `newTodosShowUndiffableFiles: true` (fail-open)

```
TODO TREE
├─ Scan mode: current file                       ~ search
├─ 1 filter active                               ~ filter
├─ New-todos: current file shown without filtering   ~ git-branch
├─ «dim»scratch.js (2)     (~/other)
│  ├─ [T] TODO fix this later                     :7
│  └─ [T] TODO buy milk                            :2
```

Shown dimmed, all todos. (There is **no** "outside the workspace" current-file
copy anymore : the boundary axis does not apply to current-file mode.)

---

## Status node design : resolved decisions

One combined node (`isStatusNode`, icon `git-branch`, below "N filters active").

- **One combined node** (not separate external/undiffable).
- **Trigger = scanned files** (not displayed): appears when ≥1 scanned file is
  hidden (mode-2 external, or undiffable + fail-closed) or shown-without-filtering
  (fail-open undiffable). Survives hiding the last undiffable file.
- **Two-bucket tooltip:** `Hidden` then `Shown without filtering`; per-reason
  lines (no-repo vs diff-failed via `classifyUndiffable`; "errors" kept for
  diff-failed; "outside the workspace" only under Hidden, only in mode 2).
  Per-file precedence: Hidden wins.
- **Count = files** (not todos).
- **Click routing:**
  - diffability reason dominant -> opens `filtering.newTodosShowUndiffableFiles`.
  - outside-workspace reason dominant (mode 2) -> opens the **scan-mode picker**
    (no setting governs the boundary anymore).
- **current-file mode:** singular "current file ..." copy; diffability-only
  (no boundary path); suppresses `Nothing found` when the active file was dropped
  by fail-closed.

## Per-file visual layer : resolved decisions

- **Mechanism:** single `FileDecorationProvider` (label colour only) +
  reason-aware `treeItem.tooltip`. Composes with existing `showBadges`.
- **Undiffable colour:** dimmed theme colour
  `gitDecoration.ignoredResourceForeground` (no new config). Applies only under
  fail-open (`newTodosShowUndiffableFiles: true`).
- **External indicator:** none in v1. With the boundary as a scan mode, a shown
  external file is just a normal file. (The `⧉` glyph is out of scope.)
- **Reason tooltip:** `treeItem.tooltip` becomes reason-aware (no-repo vs
  diff-failed) when the filter is ON and the file is undiffable; otherwise falls
  back to the existing fsPath tooltip.

## Transient handling : resolved decisions (E10)

- **Await-before-write:** classify a file before writing it to any visible store
  -> no shown-all-then-trimmed (or missing-then-appears) flicker. Rebuild path
  never flickers (staging swap); incremental path shows the file one git-call
  later, already correct.
- **Timeout fallback:** `filtering.newTodosGitTimeoutMs` (default 2000) bounds the
  first-touch wait. On timeout, paint optimistically (dimmed, fail-open) then
  **reconcile** the one file when the diff resolves. Only path that can briefly
  flicker, and only for genuinely slow repos.

## Settings : resolved shapes

- `filtering.newTodosShowUndiffableFiles` : boolean, default `true` (fail-open).
- `filtering.newTodosGitTimeoutMs` : number, default `2000`. First-touch
  repo-resolve timeout; `0` = always wait.
- **No** `newTodosShowOpenFilesOutsideWorkspace` : the workspace boundary is the
  scan mode (modes 2 vs 3/4/5).
