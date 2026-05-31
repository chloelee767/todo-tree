# New-Todos Empty Base Branch Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Treat an empty `filtering.newTodosGitBaseBranch` as a distinct `no-branch` config error for new-todos filtering, while preserving existing fail-open or fail-closed behavior for undiffable files.

**Architecture:** Keep the change inside the existing undiffable pipeline. `src/newTodoFilter.js` becomes the single source of truth for the new `'no-branch'` reason via a small module-level flag, then `src/extension.js`, `src/tree.js`, and `src/fileDecorationProvider.js` only thread that reason through their existing counters, messages, and tooltips. Tests stay focused and mostly stub-based, with one extension-harness test to cover the rebuild popup and final provider payload.

**Tech Stack:** Node.js, CommonJS modules, VS Code extension APIs, QUnit.

---

## File Structure

- `src/newTodoFilter.js` (Modify) - detect blank base branch during `refresh()`, expose `'no-branch'` from `classifyUndiffable()`, leave `isNewTodo()` fail-open and fail-closed behavior unchanged.
- `src/tree.js` (Modify) - include `noBranch` in the undiffable status-node trigger, totals, tooltip buckets, and current-file `suppressNothingFound` logic.
- `src/fileDecorationProvider.js` (Modify) - map `'no-branch'` to a distinct tooltip string.
- `src/extension.js` (Modify) - track `'no-branch'` in `scannedUndiffable`, include `noBranch` in `provider.setNewTodoStatus(...)`, and show a rebuild warning when the filter is enabled but the configured base branch is blank.
- `test/newTodoFilter.behavior.test.js` (Modify) - add focused behavioral tests for empty and whitespace-only branches and fail-open or fail-closed behavior.
- `test/tree.behavior.test.js` (Modify) - add status-node tests for the additive `noBranch` bucket and current-file suppression behavior.
- `test/fileDecoration.behavior.test.js` (Modify) - add the `'no-branch'` tooltip case.
- `test/extension.scan-parity.test.js` (Modify) - add extension-level coverage for the rebuild warning and final `newTodoStatus.noBranch` payload. This is not listed in the spec's test section, but it is the smallest existing harness that can verify `extension.js` behavior directly.

---

## Notes For The Implementing Engineer

- The current early return in `src/newTodoFilter.js:119-125` clears `rangesByPath`, `coveredRoots`, and `failedRoots` and returns `{ allFailed: false }`. Keep that shape. The new behavior is only to compute and retain a separate `missingBranch` flag before that return.
- Treat both `''` and whitespace-only strings like `'   '` as missing branches. Use one small helper, or one inline normalization expression, and reuse it in both `newTodoFilter.js` and `extension.js` instead of duplicating slightly different checks.
- Do not change the status-node label copy in `src/tree.js`. The new requirement is additive tooltip detail only; `no-branch` must not become a dominant label.
- Do not change the fail-open path in `isNewTodo()`. `classifyUndiffable()` returning any non-null reason already feeds the existing `showUndiffableFiles` branch.
- Focused test command pattern in this repo is `npx qunit test/<file>.js`. QUnit auto-loads globals, so these tests do not import `QUnit` explicitly.
- `test/extension.scan-parity.test.js` already has a reusable `createExtensionHarness(...)` helper and captures warning popups in `harness.warningMessages`.

---

## Task 1: Add failing newTodoFilter tests for empty-branch behavior

**Files:**
- Modify: `test/newTodoFilter.behavior.test.js`

- [x] **Step 1: Add the failing tests**

Append these tests near the existing `classifyUndiffable` and `isNewTodo` coverage in `test/newTodoFilter.behavior.test.js`:

```javascript
QUnit.test( 'refresh: enabled + empty branch classifies absent files as no-branch', function( assert )
{
    var done = assert.async();
    var f = loadFilter();
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( '', [ '/repo' ], { include: [], exclude: [] } ).then( function( summary )
    {
        assert.equal( summary.allFailed, false, 'blank branch does not report git failures' );
        assert.equal( f.classifyUndiffable( '/repo/a.js' ), 'no-branch', 'blank branch is a config error' );
        done();
    } );
} );

QUnit.test( 'refresh: enabled + whitespace-only branch also classifies as no-branch', function( assert )
{
    var done = assert.async();
    var f = loadFilter();
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( '   ', [ '/repo' ], { include: [], exclude: [] } ).then( function()
    {
        assert.equal( f.classifyUndiffable( '/repo/a.js' ), 'no-branch', 'whitespace is treated as missing' );
        done();
    } );
} );

QUnit.test( 'isNewTodo: no-branch still obeys fail-open and fail-closed', function( assert )
{
    var done = assert.async();
    var f = loadFilter();
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( '', [ '/repo' ], { include: [], exclude: [] } ).then( function()
    {
        f.setShowUndiffableFiles( true );
        assert.equal( f.isNewTodo( '/repo/a.js', 1 ), true, 'fail-open keeps the todo' );
        f.setShowUndiffableFiles( false );
        assert.equal( f.isNewTodo( '/repo/a.js', 1 ), false, 'fail-closed hides the todo' );
        done();
    } );
} );

QUnit.test( 'refresh: non-empty branch clears no-branch state', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        getChangedFilesAndLines: function() { return Promise.resolve( new Map() ); },
        getUntrackedFiles: function() { return Promise.resolve( [] ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( '', [ '/repo' ], { include: [], exclude: [] } ).then( function()
    {
        assert.equal( f.classifyUndiffable( '/repo/a.js' ), 'no-branch', 'sanity check: first refresh sets no-branch' );
        return f.refresh( 'main', [ '/repo' ], { include: [], exclude: [] } );
    } ).then( function()
    {
        assert.notEqual( f.classifyUndiffable( '/repo/a.js' ), 'no-branch', 'next refresh recomputes state and clears no-branch' );
        done();
    } );
} );
```

- [x] **Step 2: Run the focused test file and confirm the new assertions fail**

Run: `npx qunit test/newTodoFilter.behavior.test.js`

Expected:
- Existing tests still pass.
- New tests that expect `'no-branch'` fail because current `classifyUndiffable()` returns `'no-repo'`.

- [x] **Step 3: Commit the failing test file**

```bash
git add test/newTodoFilter.behavior.test.js
git commit -m "test(new-todos): cover empty base branch classification"
```

---

## Task 2: Implement no-branch classification in newTodoFilter

**Files:**
- Modify: `src/newTodoFilter.js:5-13`
- Modify: `src/newTodoFilter.js:73-90`
- Modify: `src/newTodoFilter.js:112-125`
- Test: `test/newTodoFilter.behavior.test.js`

- [ ] **Step 1: Add the missing-branch state and blank-branch helper**

Near the module-level state in `src/newTodoFilter.js`, add one flag and one helper:

```javascript
var showUndiffableFiles = true;
var missingBranch = false;

function isBlankBranch( branch )
{
    return !branch || String( branch ).trim() === '';
}
```

- [ ] **Step 2: Compute `missingBranch` at the start of `refresh()`**

Update the top of `refresh()` so it recomputes the flag on every call before the early return:

```javascript
function refresh( branch, roots, globs )
{
    baseBranch = branch;
    missingBranch = enabled === true && isBlankBranch( branch );
    refreshGeneration += 1;
    var generation = refreshGeneration;
    pendingRepoExtends = new Map();

    if( enabled !== true || !branch || !roots || roots.length === 0 )
    {
        rangesByPath = new Map();
        coveredRoots = [];
        failedRoots = [];
        return Promise.resolve( { allFailed: false } );
    }
```

Then tighten the early-return guard so whitespace-only branches also stop before any git work:

```javascript
    if( enabled !== true || isBlankBranch( branch ) || !roots || roots.length === 0 )
```

- [ ] **Step 3: Make `classifyUndiffable()` return `'no-branch'` first**

Update the top of `classifyUndiffable()` to check the new flag before covered or failed root logic:

```javascript
function classifyUndiffable( fsPath )
{
    if( rangesByPath.get( fsPath ) )
    {
        return null;
    }
    if( missingBranch === true )
    {
        return 'no-branch';
    }
    var coveredOwning = findOwningRoot( fsPath, coveredRoots );
    var failedOwning = findOwningRoot( fsPath, failedRoots );
```

Do not change `isNewTodo()`.

- [x] **Step 4: Run the focused filter tests again**

Run: `npx qunit test/newTodoFilter.behavior.test.js`

Expected:
- PASS: all existing tests.
- PASS: the four new empty-branch tests from Task 1.

- [x] **Step 5: Commit the implementation**

```bash
git add src/newTodoFilter.js test/newTodoFilter.behavior.test.js
git commit -m "feat(new-todos): classify empty base branch as no-branch"
```

---

## Task 3: Add failing tree and decoration tests for the new reason

**Files:**
- Modify: `test/tree.behavior.test.js`
- Modify: `test/fileDecoration.behavior.test.js`

- [x] **Step 1: Add tree status-node tests for `noBranch`**

Append these tests near the existing new-todo status-node block in `test/tree.behavior.test.js`:

```javascript
QUnit.test( 'status node: no-branch count contributes to label and tooltip', function( assert )
{
    var configStub = createConfig();
    var tree = loadTreeModule( configStub );
    var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );

    provider.setNewTodoStatus( {
        enabled: true,
        noRepo: 0,
        diffFailed: 0,
        noBranch: 2,
        showUndiffableFiles: true,
        scanMode: 'workspace',
        baseBranch: ''
    } );

    var node = provider.getChildren().find( function( child )
    {
        return child.isStatusNode === true && /New-todos/.test( child.label );
    } );
    var treeItem = provider.getTreeItem( node );

    assert.equal( node.label, 'New-todos: 2 shown without filtering' );
    assert.ok( /- 2 no base branch configured/.test( treeItem.tooltip.value ), 'no-branch tooltip line present' );
} );

QUnit.test( 'status node: no-branch stays additive beside no-repo', function( assert )
{
    var configStub = createConfig();
    var tree = loadTreeModule( configStub );
    var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );

    provider.setNewTodoStatus( {
        enabled: true,
        noRepo: 1,
        diffFailed: 0,
        noBranch: 2,
        showUndiffableFiles: true,
        scanMode: 'workspace',
        baseBranch: ''
    } );

    var node = provider.getChildren().find( function( child )
    {
        return child.isStatusNode === true && /New-todos/.test( child.label );
    } );
    var treeItem = provider.getTreeItem( node );

    assert.equal( node.label, 'New-todos: 3 shown without filtering' );
    assert.ok( /- 1 not in a git repository/.test( treeItem.tooltip.value ), 'no-repo line kept' );
    assert.ok( /- 2 no base branch configured/.test( treeItem.tooltip.value ), 'no-branch line added' );
} );

QUnit.test( 'current-file fail-closed: no-branch suppresses Nothing found', function( assert )
{
    var configStub = createConfig();
    var tree = loadTreeModule( configStub );
    var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );

    provider.setNewTodoStatus( {
        enabled: true,
        noRepo: 0,
        diffFailed: 0,
        noBranch: 1,
        showUndiffableFiles: false,
        scanMode: 'current file',
        baseBranch: ''
    } );

    var labels = provider.getChildren().map( function( child )
    {
        return child.label || '';
    } );

    assert.notOk( labels.some( function( label ) { return /Nothing found/.test( label ); } ), 'Nothing found suppressed' );
    assert.ok( labels.some( function( label ) { return /Current file not shown/.test( label ); } ), 'undiffable status still visible' );
} );
```

- [x] **Step 2: Add the file-decoration tooltip test**

Append this test in `test/fileDecoration.behavior.test.js`:

```javascript
QUnit.test( 'no-branch -> tooltip explains missing base branch', function( assert )
{
    var mod = loadProvider( {
        isEnabled: function() { return true; },
        classifyUndiffable: function() { return 'no-branch'; }
    } );
    var provider = mod.create( makeConfig() );
    var deco = provider.provideFileDecoration( { fsPath: '/x/a.js' } );

    assert.ok( deco, 'decoration returned' );
    assert.ok( /no base branch configured/i.test( deco.tooltip ), 'no-branch reason in tooltip' );
    assert.ok( /showing all todos/i.test( deco.tooltip ), 'fail-open explanation kept' );
} );
```

- [x] **Step 3: Run the two focused files and confirm they fail for the new reason**

Run: `npx qunit test/tree.behavior.test.js test/fileDecoration.behavior.test.js`

Expected:
- Tree tests fail because current status-node math ignores `noBranch`.
- Decoration test fails because `reasonTooltip()` has no `'no-branch'` case.

- [x] **Step 4: Commit the failing tests**

```bash
git add test/tree.behavior.test.js test/fileDecoration.behavior.test.js
git commit -m "test(new-todos): cover no-branch UI messaging"
```

---

## Task 4: Implement tree and decoration support for `no-branch`

**Files:**
- Modify: `src/tree.js:529-533`
- Modify: `src/tree.js:566-605`
- Modify: `src/fileDecorationProvider.js:4-12`
- Test: `test/tree.behavior.test.js`
- Test: `test/fileDecoration.behavior.test.js`

- [x] **Step 1: Include `noBranch` in current-file suppression logic**

In `src/tree.js`, change the `suppressNothingFound` condition to:

```javascript
var suppressNothingFound = nts2 && nts2.enabled === true &&
    nts2.scanMode === 'current file' &&
    nts2.showUndiffableFiles === false &&
    ( nts2.noRepo + nts2.diffFailed + nts2.noBranch ) > 0;
```

- [x] **Step 2: Include `noBranch` in status-node totals and tooltip**

Update the undiffable status-node block in `src/tree.js`:

```javascript
if( nts && nts.enabled === true && ( nts.noRepo + nts.diffFailed + nts.noBranch ) > 0 )
{
    var totalUndiffable = nts.noRepo + nts.diffFailed + nts.noBranch;
```

And append the new tooltip bucket line without changing label selection:

```javascript
if( nts.noBranch > 0 )
{
    tooltip.appendMarkdown( '- ' + nts.noBranch + ' no base branch configured\n' );
}
```

- [x] **Step 3: Add the `no-branch` decoration tooltip**

In `src/fileDecorationProvider.js`, expand `reasonTooltip()` to handle the new reason explicitly:

```javascript
function reasonTooltip( reason, baseBranch )
{
    if( reason === 'no-repo' )
    {
        return "Not in a git repository : new-todo filtering can't be applied. Showing all todos.";
    }
    if( reason === 'no-branch' )
    {
        return 'No base branch configured for new-todo filtering. Showing all todos.';
    }

    return "git diff failed (repo may not have base branch `" + baseBranch + "`). Showing all todos.";
}
```

- [x] **Step 4: Run the focused UI behavior tests again**

Run: `npx qunit test/tree.behavior.test.js test/fileDecoration.behavior.test.js`

Expected:
- PASS: existing tree and decoration tests.
- PASS: new `noBranch` status-node and tooltip tests.

- [x] **Step 5: Commit the implementation**

```bash
git add src/tree.js src/fileDecorationProvider.js test/tree.behavior.test.js test/fileDecoration.behavior.test.js
git commit -m "feat(new-todos): surface no-branch UI state"
```

---

## Task 5: Add failing extension-harness tests for warning popup and status payload

**Files:**
- Modify: `test/extension.scan-parity.test.js`

- [x] **Step 1: Add a status-payload test for `noBranch`**

Append this test near the other `new-todos filter` tests in `test/extension.scan-parity.test.js`:

```javascript
QUnit.test( 'new-todos filter threads no-branch counts to the provider', function( assert )
{
    var fixture = [ {
        uri: matrixHelpers.createUri( '/workspace/src/no-branch.js' ),
        actualTag: 'TODO',
        displayText: 'missing branch item',
        continuationText: [],
        line: 1
    } ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: [ {
            fsPath: 'src/no-branch.js',
            line: 1,
            column: 1,
            match: 'TODO missing branch item'
        } ],
        fileContents: {
            '/workspace/src/no-branch.js': '// TODO missing branch item'
        },
        scanTextImpl: function( uri )
        {
            return uri.fsPath === '/workspace/src/no-branch.js' ? fixture : [];
        },
        newTodosGitBaseBranch: '',
        newTodoFilterStub: {
            init: function() {},
            setEnabled: function() {},
            setShowUndiffableFiles: function() {},
            isEnabled: function() { return true; },
            classifyUndiffable: function( fsPath )
            {
                return fsPath === '/workspace/src/no-branch.js' ? 'no-branch' : null;
            },
            isNewTodo: function() { return false; },
            refresh: function() { return Promise.resolve( { allFailed: false } ); }
        },
        gitStub: {
            findRepoRoot: function() { return Promise.resolve( '/workspace' ); }
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.deepEqual( harness.provider.newTodoStatus, {
            enabled: true,
            noRepo: 0,
            diffFailed: 0,
            noBranch: 1,
            showUndiffableFiles: true,
            scanMode: 'workspace',
            baseBranch: ''
        } );
    } );
} );
```

- [x] **Step 2: Add a warning-popup test for blank base branch**

Append this test immediately after the payload test:

```javascript
QUnit.test( 'new-todos filter warns when enabled and base branch is blank', function( assert )
{
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        newTodosGitBaseBranch: '',
        newTodoFilterStub: {
            init: function() {},
            setEnabled: function() {},
            setShowUndiffableFiles: function() {},
            isEnabled: function() { return true; },
            classifyUndiffable: function() { return null; },
            isNewTodo: function() { return true; },
            refresh: function() { return Promise.resolve( { allFailed: false } ); }
        },
        gitStub: {
            findRepoRoot: function() { return Promise.resolve( '/workspace' ); }
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.warningMessages.length, 1, 'one warning shown' );
        assert.equal(
            harness.warningMessages[ 0 ],
            'Better TODO Tree: no base branch set for new-todos filter (set filtering.newTodosGitBaseBranch)',
            'warns with the new config-error copy'
        );
    } );
} );
```

- [x] **Step 3: Run the focused extension harness test file and confirm the new assertions fail**

Run: `npx qunit test/extension.scan-parity.test.js`

Expected:
- Existing extension parity tests still pass.
- New status-payload test fails because `provider.setNewTodoStatus(...)` does not yet include `noBranch`.
- New warning test fails because `executeRebuild()` only warns on `summary.allFailed === true`.

- [x] **Step 4: Commit the failing extension tests**

```bash
git add test/extension.scan-parity.test.js
git commit -m "test(extension): cover empty new-todos base branch warning"
```

---

## Task 6: Implement extension wiring for `no-branch`

**Files:**
- Modify: `src/extension.js:99`
- Modify: `src/extension.js:2242-2253`
- Modify: `src/extension.js:2528-2587`
- Test: `test/extension.scan-parity.test.js`

- [x] **Step 1: Track `no-branch` in `scannedUndiffable` and `applyNewTodoFilterToResults()`**

Update the module-level set map in `src/extension.js`:

```javascript
var scannedUndiffable = { 'no-repo': new Set(), 'diff-failed': new Set(), 'no-branch': new Set() };
```

Update the tracked-reason check in `applyNewTodoFilterToResults()`:

```javascript
if( reason === 'no-repo' || reason === 'diff-failed' || reason === 'no-branch' )
{
    scannedUndiffable[ reason ].add( uri.fsPath );
}
```

- [x] **Step 2: Clear and publish the new `noBranch` count during rebuild**

In `executeRebuild()`, clear the extra set and include it in the final provider payload:

```javascript
scannedUndiffable[ 'no-repo' ].clear();
scannedUndiffable[ 'diff-failed' ].clear();
scannedUndiffable[ 'no-branch' ].clear();
```

```javascript
provider.setNewTodoStatus( {
    enabled: newTodoFilter.isEnabled(),
    noRepo: scannedUndiffable[ 'no-repo' ].size,
    diffFailed: scannedUndiffable[ 'diff-failed' ].size,
    noBranch: scannedUndiffable[ 'no-branch' ].size,
    showUndiffableFiles: typeof ( config.newTodosShowUndiffableFiles ) === 'function' ? config.newTodosShowUndiffableFiles() : true,
    scanMode: config.scanMode(),
    baseBranch: config.newTodosGitBaseBranch()
} );
```

- [x] **Step 3: Add the blank-branch rebuild warning**

Use the same blank-branch normalization as Task 2 and update the rebuild warning branch in `executeRebuild()`:

```javascript
var configuredBaseBranch = config.newTodosGitBaseBranch();
var missingBaseBranch = !configuredBaseBranch || String( configuredBaseBranch ).trim() === '';

if( newTodoFilter.isEnabled() === true && missingBaseBranch === true )
{
    vscode.window.showWarningMessage( identity.DISPLAY_NAME + ': no base branch set for new-todos filter (set filtering.newTodosGitBaseBranch)' );
}
else if( summary && summary.allFailed === true && newTodoFilter.isEnabled() === true )
{
    vscode.window.showWarningMessage( identity.DISPLAY_NAME + ": could not compute git diff for new-todos filter (check base branch '" + configuredBaseBranch + "')" );
}
```

Keep this branch inside the existing `.then( function( summary ) { ... } )` block so flow and timing stay unchanged.

- [x] **Step 4: Run the focused extension tests again**

Run: `npx qunit test/extension.scan-parity.test.js`

Expected:
- PASS: existing extension parity tests.
- PASS: new `noBranch` status-payload test.
- PASS: new blank-base-branch warning test.

- [x] **Step 5: Commit the implementation**

```bash
git add src/extension.js test/extension.scan-parity.test.js
git commit -m "feat(extension): warn for empty new-todos base branch"
```

---

## Task 7: Run final focused verification

**Files:**
- Verify only

- [x] **Step 1: Run the focused suite for all touched behavior**

Run:

```bash
npx qunit test/newTodoFilter.behavior.test.js test/tree.behavior.test.js test/fileDecoration.behavior.test.js test/extension.scan-parity.test.js
```

Expected:
- PASS: all tests in the four targeted files.
- No new failures introduced in the empty-base-branch path.

- [x] **Step 2: Optional broader confidence run before handing off**

Run:

```bash
npx qunit test/newTodoFilter.realrepo.test.js test/git.realrepo.test.js
```

Expected:
- PASS: existing real-repo tests still pass.
- Confirms the new empty-branch config-error path does not regress the separate nonexistent-branch failure path.

- [x] **Step 3: Commit the final verification-only checkpoint if needed**

```bash
git status --short
```

Expected:
- No unexpected modified files.
- If the branch is already clean after Task 6, do not create an extra commit.

---

## Spec Coverage Check

- `src/newTodoFilter.js` missing-branch flag and `'no-branch'` classification: covered by Tasks 1 and 2.
- Status node additive `noBranch` count and tooltip line: covered by Tasks 3 and 4.
- File decoration tooltip for `'no-branch'`: covered by Tasks 3 and 4.
- Rebuild popup for blank base branch: covered by Tasks 5 and 6.
- Fail-open and fail-closed behavior unchanged: covered by Task 1 and re-verified in Task 7.
- Whitespace-only branch handling: covered by Task 1 and implemented in Task 2.
- Forward-compatible additive status-node behavior: covered by the mixed `noRepo + noBranch` tree test in Task 3.

No uncovered spec requirements remain.
