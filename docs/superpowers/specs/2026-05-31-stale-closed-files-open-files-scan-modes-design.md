# Design: Closed files stay in tree (open-files scan modes)

**Status:** DRAFT — did not go through full brainstorming workflow.

## Bug

In scan modes `open files` and `open files in workspace`: closing a file leaves
its TODOs in the tree. Pressing refresh or toggling scan mode back and forth
does not remove them. Happens regardless of the new-todos-only filter.

## Root cause

The set of "open files" to scan is read from the in-memory `openDocuments` map
(`getOpenDocumentsForScan`, `src/extension.js:1785`). `openDocuments` is only
pruned by the `onDidCloseTextDocument` listener (`src/extension.js:4123`).

`onDidCloseTextDocument` does **not** fire when a tab is closed. It fires when
VS Code releases the underlying `TextDocument` model, which it does lazily and
on its own schedule. Closing a tab != closing a document. So `openDocuments`
keeps a stale entry, and every rebuild re-scans the closed file.

On refresh, `executeRebuild` clears the tree and rebuilds it entirely from the
open-files scan (the workspace scan is a no-op in these modes, gated at
`src/extension.js:1489`). The stale file is re-scanned, so its TODOs reappear.

Why the symptoms match:
- **Refresh doesn't help** — rebuilds from the same stale `openDocuments`.
- **Toggling scan mode doesn't help** — just triggers another rebuild from it.
- **Independent of new-todos-only** — filter runs downstream of file selection.
- **Only open-files modes** — these derive their file set entirely from
  `openDocuments`. Workspace mode scans disk, so a closed file legitimately
  stays and the bug isn't visible.

Why tests miss it: all tests drive `onDidCloseTextDocument` directly
(e.g. `test/extension.scan-parity.test.js:708`), simulating an event the real
editor often never sends on tab close.

## Proposed fix direction

Stop treating `openDocuments` as the source of truth for "which files are open".
Derive open files from the **tab model** instead:

- `vscode.window.tabGroups.all` → flatten `.tabs` → read `tab.input.uri` for
  `TabInputText` / `TabInputNotebook`.
- Reconcile on `vscode.window.tabGroups.onDidChangeTabs`.

Available since VS Code 1.67; engine is `^1.72.0`, so this is safe.

## Alternatives considered

1. **Full switch to `tabGroups`** as the source of truth for open files.
   Cleanest, but largest change; touches notebook handling and startup
   population too.
2. **Reconcile `openDocuments` against tabs at scan time** — keep the map but
   filter out any entry whose URI is no longer in any open tab before scanning.
   Smaller blast radius, leaves existing event wiring intact.
3. **Periodic / on-refresh prune** of `openDocuments` against
   `visibleTextEditors` or tabs. Cheapest, but `visibleTextEditors` only covers
   visible editors, not all open tabs — would wrongly drop backgrounded tabs.

Leaning toward (2) as the lowest-risk fix, but undecided.

## Open questions

- Does `onDidChangeTabs` cover all the cases the current `onDidClose` path
  handles (split editors, preview tabs, diff editors, custom editors)?
- Notebooks: `getNotebookDocumentsForScan` has a parallel registry — does it
  have the same staleness bug, or is it already tab/visible-editor driven?
- The close handler also does immediate removal + `documentScanCache` cleanup
  (`src/extension.js:4148-4149`). If we move to a tab-based source of truth,
  what triggers that cleanup, and is the cache cleanup still needed?
- Pinned/preview tabs and "keep editors open" settings — any edge cases where a
  tab exists but the file shouldn't be scanned, or vice versa?
- Testing: harness currently fakes `onDidCloseTextDocument`. A regression test
  needs to model "tab closed, no close event" — likely a fake `tabGroups`.
  How much harness work is that?

## Answered questions

- Does the same staleness affect `current file` mode via `getActiveScanTarget`,
  or is that always derived from the active editor (not `openDocuments`)?
    - Answer: current file scan mode has no issue, it updates immediately