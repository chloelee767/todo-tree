# Fix Git Diff Nonexistent-Branch Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `getChangedFilesAndLines` so a failed `git diff` (e.g. nonexistent base branch) rejects instead of silently resolving with an empty result, restoring the new-todos filter's error reporting and fail-open behavior.

**Architecture:** `src/git.js` `getChangedFilesAndLines` currently has a race: it settles the promise from BOTH the readline `'close'` event (resolve) and the process `'exit'` event (reject on non-zero). In real git, `readline 'close'` fires *before* `'exit'`, so a failed diff resolves with an empty Map before the rejection can fire. The fix: make `'close'` only record that stdout finished, and let the `'exit'` handler be the sole place the promise settles — resolve on exit code 0, reject otherwise. Tests are added against real temp git repos (not stubs), because the existing stub encoded the opposite event ordering and hid this bug.

**Tech Stack:** Node.js, `child_process` (`spawn`/`execFileSync`), `readline`, QUnit.

---

## Background: Root Cause (verified)

`src/git.js:61-82` settles one promise from two events:

```javascript
rl.on( 'close', () => { ...; resolve( lineRanges ); } );   // fires FIRST in real git
gitDiff.on( 'exit', ( code ) => { if( code !== 0 ) reject( ... ); } );  // fires SECOND
```

For a nonexistent branch, `git diff` writes nothing to stdout and exits 128. `readline 'close'` fires before `'exit'`, so the promise **resolves with an empty Map** and the rejection is a no-op (a promise settles once).

Downstream in `src/newTodoFilter.js`, a resolved-empty diff is treated as a *successful* diff with zero changes:
- the root goes into `coveredRoots` (not `failedRoots`)
- `refresh()` returns `allFailed: false` → no warning popup
- `classifyUndiffable()` returns `null` → no "diff-failed" status node
- `isNewTodo()` returns `false` for every tracked todo → tree shows "Nothing found"

This is why `filtering.newTodosShowUndiffableFiles=true` does not help: files are never *classified* as undiffable, so the fail-open path is never reached. (Untracked files still appear because `getUntrackedFiles` uses `git status`, which ignores the branch.)

The existing stub test at `test/git.behavior.test.js:136-147` passes because the stub emits `'exit'` on `nextTick` *before* the stdout stream drains — the opposite of real git ordering. Tasks 1 and 2 add real-repo tests so this class of bug is caught; Task 4 fixes the stub to match real ordering.

**Decisions locked in (from user):**
- Real-repo tests HARD FAIL if `git` is not on PATH (no skip logic).
- Add real-repo coverage at BOTH the `git.js` layer (Task 1) and the `newTodoFilter` layer (Task 2).
- Fix the stub in `git.behavior.test.js` to match real event ordering (Task 4).

---

## File Structure

- `test/git.realrepo.test.js` (Create) — real-repo tests for `git.js` `getChangedFilesAndLines` / `getUntrackedFiles`. Owns temp-repo setup/teardown helpers for the git layer.
- `test/newTodoFilter.realrepo.test.js` (Create) — real-repo end-to-end tests for `newTodoFilter` using the real `git.js`. Asserts the reported symptom (nonexistent branch → `diff-failed` + fail-open visible + `allFailed: true`).
- `src/git.js` (Modify) — fix the settle-order race in `getChangedFilesAndLines`.
- `test/git.behavior.test.js` (Modify) — fix the stub's non-zero-exit test to reproduce real ordering (rl `'close'` before `'exit'`).

---

## Notes for the implementing engineer

- **Test runner:** `npx qunit`. QUnit auto-discovers `test/**/*.js`, so new files are picked up with no registration.
- **Run a single file:** `npx qunit test/git.realrepo.test.js`
- **Pre-existing failures:** the suite has 17 unrelated failures in `perf runtime benchmarks` and `release workflow scripts` (environment-specific). Ignore those; they are NOT caused by this work. Everything in `git` / `newTodoFilter` / `real-repo` modules must pass.
- **QUnit nested modules with hooks:** use `QUnit.module( 'name', function( hooks ) { hooks.beforeEach(...); QUnit.test(...) } )`. Async tests use `var done = assert.async();` and call `done()` in both `.then` and `.catch`.
- **`git.init( debug )`** must be called once before using `git.js` functions; pass `function() {}` as the no-op debug logger.
- **Branch naming:** create an explicit base branch named `base` in the test repo so the tests do not depend on the machine's default branch name (`main` vs `master`).
- **`fs.rmSync(..., { recursive: true, force: true })`** is available on the Node version used here; use it for teardown.

---

## Task 1: Real-repo tests for git.js (failing first)

**Files:**
- Create: `test/git.realrepo.test.js`

- [x] **Step 1: Write the failing tests**

Create `test/git.realrepo.test.js` with this exact content:

```javascript
var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );
var { execFileSync } = require( 'child_process' );
var git = require( '../src/git.js' );

function runGit( cwd, args )
{
    execFileSync( 'git', args, { cwd: cwd, stdio: 'ignore' } );
}

// Real git repo: one committed file (on branch 'base') that is then modified,
// plus one untracked file. Returns the repo root path.
function createRepo()
{
    var root = fs.mkdtempSync( path.join( os.tmpdir(), 'btt-git-' ) );
    runGit( root, [ 'init' ] );
    runGit( root, [ 'config', 'user.email', 'test@example.com' ] );
    runGit( root, [ 'config', 'user.name', 'test' ] );
    runGit( root, [ 'checkout', '-b', 'base' ] );
    fs.writeFileSync( path.join( root, 'tracked.js' ), 'line1\nold todo\nline3\n' );
    runGit( root, [ 'add', 'tracked.js' ] );
    runGit( root, [ 'commit', '-m', 'init' ] );
    fs.writeFileSync( path.join( root, 'tracked.js' ), 'line1\nold todo\nnew todo\n' );
    fs.writeFileSync( path.join( root, 'untracked.js' ), 'untracked todo\n' );
    return root;
}

QUnit.module( 'real-repo git', function( hooks )
{
    var root;

    hooks.before( function()
    {
        git.init( function() {} );
    } );

    hooks.beforeEach( function()
    {
        root = createRepo();
    } );

    hooks.afterEach( function()
    {
        fs.rmSync( root, { recursive: true, force: true } );
    } );

    QUnit.test( 'getChangedFilesAndLines: valid branch resolves with changed line ranges', function( assert )
    {
        var done = assert.async();
        git.getChangedFilesAndLines( 'base', root, [], [] ).then( function( map )
        {
            assert.deepEqual( map.get( 'tracked.js' ), [ [ 3, 1 ] ], 'reports the single added line' );
            done();
        } ).catch( function( err )
        {
            assert.ok( false, 'should not reject: ' + err.message );
            done();
        } );
    } );

    QUnit.test( 'getChangedFilesAndLines: nonexistent branch rejects', function( assert )
    {
        var done = assert.async();
        git.getChangedFilesAndLines( 'no-such-branch', root, [], [] ).then( function()
        {
            assert.ok( false, 'should reject for a nonexistent branch, not resolve' );
            done();
        } ).catch( function( err )
        {
            assert.ok( err instanceof Error, 'rejects with an Error' );
            done();
        } );
    } );

    QUnit.test( 'getChangedFilesAndLines: empty branch rejects', function( assert )
    {
        var done = assert.async();
        git.getChangedFilesAndLines( '', root, [], [] ).then( function()
        {
            assert.ok( false, 'should reject for an empty branch' );
            done();
        } ).catch( function( err )
        {
            assert.ok( /required/i.test( err.message ), 'rejects with required-args error' );
            done();
        } );
    } );

    QUnit.test( 'getUntrackedFiles: lists the untracked file', function( assert )
    {
        var done = assert.async();
        git.getUntrackedFiles( root, [], [] ).then( function( files )
        {
            assert.deepEqual( files, [ 'untracked.js' ], 'returns the untracked path' );
            done();
        } ).catch( function( err )
        {
            assert.ok( false, 'should not reject: ' + err.message );
            done();
        } );
    } );
} );
```

- [x] **Step 2: Run the tests to verify the bug reproduces**

Run: `npx qunit test/git.realrepo.test.js`

Expected:
- PASS: `valid branch resolves with changed line ranges`
- **FAIL: `nonexistent branch rejects`** (current code resolves with an empty Map — this is the bug under test)
- PASS: `empty branch rejects` (already guarded by the required-args check at `src/git.js:13-15`)
- PASS: `getUntrackedFiles lists the untracked file`

If `git` is not on PATH, the test will throw from `createRepo` and the module fails — that is the intended hard-fail behavior; do not add skip logic.

- [x] **Step 3: Commit the failing test**

```bash
git add test/git.realrepo.test.js
git commit -m "test(git): real-repo coverage exposing nonexistent-branch race"
```

---

## Task 2: Real-repo end-to-end test for newTodoFilter (failing first)

**Files:**
- Create: `test/newTodoFilter.realrepo.test.js`

This asserts the user-visible symptom through the real `git.js`: a nonexistent branch must mark the root as failed (`allFailed: true`), classify files as `diff-failed`, and — with fail-open enabled — keep tracked todos visible.

- [x] **Step 1: Write the failing tests**

Create `test/newTodoFilter.realrepo.test.js` with this exact content:

```javascript
var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );
var { execFileSync } = require( 'child_process' );
var newTodoFilter = require( '../src/newTodoFilter.js' );

function runGit( cwd, args )
{
    execFileSync( 'git', args, { cwd: cwd, stdio: 'ignore' } );
}

function createRepo()
{
    var root = fs.mkdtempSync( path.join( os.tmpdir(), 'btt-ntf-' ) );
    runGit( root, [ 'init' ] );
    runGit( root, [ 'config', 'user.email', 'test@example.com' ] );
    runGit( root, [ 'config', 'user.name', 'test' ] );
    runGit( root, [ 'checkout', '-b', 'base' ] );
    fs.writeFileSync( path.join( root, 'tracked.js' ), 'line1\nold todo\nline3\n' );
    runGit( root, [ 'add', 'tracked.js' ] );
    runGit( root, [ 'commit', '-m', 'init' ] );
    fs.writeFileSync( path.join( root, 'tracked.js' ), 'line1\nold todo\nnew todo\n' );
    return root;
}

var GLOBS = { include: [], exclude: [] };

QUnit.module( 'real-repo newTodoFilter', function( hooks )
{
    var root;
    var trackedPath;

    hooks.before( function()
    {
        newTodoFilter.init( function() {} );
    } );

    hooks.beforeEach( function()
    {
        root = createRepo();
        trackedPath = path.join( root, 'tracked.js' );
        newTodoFilter.setEnabled( true );
    } );

    hooks.afterEach( function()
    {
        fs.rmSync( root, { recursive: true, force: true } );
    } );

    QUnit.test( 'valid branch: only added lines count as new todos', function( assert )
    {
        var done = assert.async();
        newTodoFilter.setShowUndiffableFiles( true );
        newTodoFilter.refresh( 'base', [ root ], GLOBS ).then( function( summary )
        {
            assert.strictEqual( summary.allFailed, false, 'valid branch is not all-failed' );
            assert.strictEqual( newTodoFilter.classifyUndiffable( trackedPath ), null, 'file is diffable' );
            assert.strictEqual( newTodoFilter.isNewTodo( trackedPath, 2 ), false, 'old line is not new' );
            assert.strictEqual( newTodoFilter.isNewTodo( trackedPath, 3 ), true, 'added line is new' );
            done();
        } ).catch( function( err )
        {
            assert.ok( false, 'should not reject: ' + err.message );
            done();
        } );
    } );

    QUnit.test( 'nonexistent branch: root marked failed, file classified diff-failed', function( assert )
    {
        var done = assert.async();
        newTodoFilter.setShowUndiffableFiles( true );
        newTodoFilter.refresh( 'no-such-branch', [ root ], GLOBS ).then( function( summary )
        {
            assert.strictEqual( summary.allFailed, true, 'all roots failed to diff' );
            assert.strictEqual( newTodoFilter.classifyUndiffable( trackedPath ), 'diff-failed', 'file is diff-failed, not covered' );
            done();
        } ).catch( function( err )
        {
            assert.ok( false, 'refresh should resolve with a summary, not reject: ' + err.message );
            done();
        } );
    } );

    QUnit.test( 'nonexistent branch, fail-open: tracked todos stay visible', function( assert )
    {
        var done = assert.async();
        newTodoFilter.setShowUndiffableFiles( true );
        newTodoFilter.refresh( 'no-such-branch', [ root ], GLOBS ).then( function()
        {
            assert.strictEqual( newTodoFilter.isNewTodo( trackedPath, 2 ), true, 'fail-open keeps undiffable todo visible' );
            done();
        } ).catch( function( err )
        {
            assert.ok( false, 'unexpected reject: ' + err.message );
            done();
        } );
    } );

    QUnit.test( 'nonexistent branch, fail-closed: tracked todos hidden', function( assert )
    {
        var done = assert.async();
        newTodoFilter.setShowUndiffableFiles( false );
        newTodoFilter.refresh( 'no-such-branch', [ root ], GLOBS ).then( function()
        {
            assert.strictEqual( newTodoFilter.isNewTodo( trackedPath, 2 ), false, 'fail-closed hides undiffable todo' );
            done();
        } ).catch( function( err )
        {
            assert.ok( false, 'unexpected reject: ' + err.message );
            done();
        } );
    } );
} );
```

- [x] **Step 2: Run the tests to verify the bug reproduces**

Run: `npx qunit test/newTodoFilter.realrepo.test.js`

Expected:
- PASS: `valid branch: only added lines count as new todos`
- **FAIL: `nonexistent branch: root marked failed, file classified diff-failed`** (`summary.allFailed` is `false` and `classifyUndiffable` returns `null` today)
- **FAIL: `nonexistent branch, fail-open: tracked todos stay visible`** (`isNewTodo` returns `false` today because the file is wrongly treated as covered-with-no-changes)
- PASS: `nonexistent branch, fail-closed: tracked todos hidden` (returns `false` today, but for the wrong reason — it will still pass after the fix because fail-closed also yields `false`)

- [x] **Step 3: Commit the failing test**

```bash
git add test/newTodoFilter.realrepo.test.js
git commit -m "test(newTodoFilter): real-repo coverage for nonexistent-branch symptom"
```

---

## Task 3: Fix the settle-order race in git.js

**Files:**
- Modify: `src/git.js:61-82`

The fix: stop resolving inside `rl.on('close')`. Record that stdout finished and run a single `settle()` that resolves on exit code 0 and rejects otherwise. `settle()` runs only after BOTH stdout has closed AND the exit code is known, and guards against double-settling.

- [x] **Step 1: Replace the close/exit handlers**

In `src/git.js`, replace this block (currently lines 61-82):

```javascript
        rl.on( 'close', () =>
        {
            if( currentFile && currentFileLines.length > 0 )
            {
                lineRanges.set( currentFile, currentFileLines );
            }
            resolve( lineRanges );
        } );

        let stderrBuffer = '';
        gitDiff.stderr.on( 'data', ( data ) =>
        {
            stderrBuffer += data;
        } );

        gitDiff.on( 'exit', ( code ) =>
        {
            if( code !== 0 )
            {
                reject( new Error( `Git diff stderr: ${stderrBuffer}` ) );
            }
        } );
```

with:

```javascript
        let stdoutClosed = false;
        let exitCode;
        let settled = false;

        function settle()
        {
            if( settled || stdoutClosed !== true || exitCode === undefined )
            {
                return;
            }
            settled = true;
            if( exitCode !== 0 )
            {
                reject( new Error( `Git diff stderr: ${stderrBuffer}` ) );
                return;
            }
            resolve( lineRanges );
        }

        rl.on( 'close', () =>
        {
            if( currentFile && currentFileLines.length > 0 )
            {
                lineRanges.set( currentFile, currentFileLines );
            }
            stdoutClosed = true;
            settle();
        } );

        let stderrBuffer = '';
        gitDiff.stderr.on( 'data', ( data ) =>
        {
            stderrBuffer += data;
        } );

        gitDiff.on( 'exit', ( code ) =>
        {
            exitCode = code;
            settle();
        } );
```

Notes:
- The `gitDiff.on( 'error', ... )` handler at the end of the function is unchanged (spawn-level failures still reject directly).
- `exitCode === undefined` is the "not known yet" sentinel; git exit codes are always numbers, so 0 is distinguishable from undefined.
- `settle()` is guarded by `settled` so the spawn-`error` path and the exit path cannot double-settle.

- [x] **Step 2: Run the git.js real-repo tests to verify they pass**

Run: `npx qunit test/git.realrepo.test.js`

Expected: ALL PASS (4 tests), including `nonexistent branch rejects`.

- [x] **Step 3: Run the newTodoFilter real-repo tests to verify they pass**

Run: `npx qunit test/newTodoFilter.realrepo.test.js`

Expected: ALL PASS (4 tests), including the two that previously failed.

- [x] **Step 4: Commit the fix**

```bash
git add src/git.js
git commit -m "fix(git): reject failed diff instead of racing rl-close against exit"
```

---

## Task 4: Fix the stub to match real event ordering

**Files:**
- Modify: `test/git.behavior.test.js:62-72` (the stub's exit-emission logic) and `test/git.behavior.test.js:136-147` (the non-zero-exit test)

The stub currently emits `'exit'` before stdout drains (unless `exitAfterStdout` is set), so the non-zero-exit test passed even with the racy code. Make the non-zero-exit test use `exitAfterStdout: true` so the stub emits `'exit'` AFTER stdout closes — the real ordering. With the Task 3 fix this still rejects; without it, it would resolve (proving the stub now guards the race).

- [x] **Step 1: Update the non-zero-exit stub test**

In `test/git.behavior.test.js`, replace this test (currently lines 136-147):

```javascript
QUnit.test( 'rejects when git exits with non-zero code', function( assert )
{
    var done = assert.async();
    assert.timeout( 1000 );
    var git = loadGitWithStubbedSpawn( [ 'diff --git a.js a.js', '' ], 'fatal: bad revision', 1 );
    git.init( function() {} );
    git.getChangedFilesAndLines( 'main', '/repo', [], [] ).catch( function( err )
    {
        assert.ok( /Git diff stderr/i.test( err.message ), 'rejects with stderr error' );
        done();
    } );
} );
```

with (note `exitAfterStdout: true` and `assert.expect( 1 )` so a wrong resolve is caught as a missing assertion rather than a silent pass):

```javascript
QUnit.test( 'rejects when git exits with non-zero code after stdout closes', function( assert )
{
    var done = assert.async();
    assert.timeout( 1000 );
    assert.expect( 1 );
    var git = loadGitWithStubbedSpawn( {
        stdoutLines: [ 'diff --git a.js a.js', '' ],
        stderrData: 'fatal: bad revision',
        exitCode: 1,
        exitAfterStdout: true
    } );
    git.init( function() {} );
    git.getChangedFilesAndLines( 'main', '/repo', [], [] ).then( function()
    {
        assert.ok( false, 'must not resolve when git exits non-zero' );
        done();
    } ).catch( function( err )
    {
        assert.ok( /Git diff stderr/i.test( err.message ), 'rejects with stderr error after stdout drained' );
        done();
    } );
} );
```

(The options-object form is required because `exitAfterStdout` is only read when the first arg is an options object — see `loadGitWithStubbedSpawn` at `test/git.behavior.test.js:10-16` and the `exitAfterStdout` branch at lines 62-69.)

- [x] **Step 2: Run the stub-based git tests to verify they pass**

Run: `npx qunit test/git.behavior.test.js`

Expected: ALL PASS. The updated `rejects when git exits with non-zero code after stdout closes` now exercises the real ordering and still rejects thanks to the Task 3 fix.

- [x] **Step 3: Commit the stub fix**

```bash
git add test/git.behavior.test.js
git commit -m "test(git): stub non-zero exit after stdout close to guard the race"
```

---

## Task 5: Full-suite verification

**Files:** none (verification only)

- [x] **Step 1: Run the full suite**

Run: `npx qunit 2>&1 | tail -8`

Expected: the only failures are the 17 pre-existing, unrelated ones in `perf runtime benchmarks` and `release workflow scripts`. Confirm with:

Run: `npx qunit 2>&1 | grep -i "^not ok"`

Expected: every line is under `perf runtime benchmarks >` or `release workflow scripts >`. No failures in `git`, `real-repo git`, `real-repo newTodoFilter`, `behavioral git`, `behavioral newTodoFilter`, or `tree` modules.

- [x] **Step 2: Confirm the fix end-to-end against a throwaway repo (optional sanity check)**

Run:

```bash
node -e '
var ntf = require("./src/newTodoFilter.js");
ntf.init(function(){});
ntf.setEnabled(true);
ntf.setShowUndiffableFiles(true);
var cp = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
var r = fs.mkdtempSync(path.join(os.tmpdir(),"btt-check-"));
function g(a){ cp.execFileSync("git", a, {cwd:r, stdio:"ignore"}); }
g(["init"]); g(["config","user.email","t@t.com"]); g(["config","user.name","t"]); g(["checkout","-b","base"]);
fs.writeFileSync(path.join(r,"a.js"),"x\nold\ny\n"); g(["add","a.js"]); g(["commit","-m","i"]);
fs.writeFileSync(path.join(r,"a.js"),"x\nold\nnew\n");
ntf.refresh("no-such-branch",[r],{include:[],exclude:[]}).then(function(s){
  console.log("allFailed:", s.allFailed, "(expect true)");
  console.log("classify:", ntf.classifyUndiffable(path.join(r,"a.js")), "(expect diff-failed)");
  console.log("isNewTodo old line, fail-open:", ntf.isNewTodo(path.join(r,"a.js"),2), "(expect true)");
  fs.rmSync(r,{recursive:true,force:true});
});
'
```

Expected output:
```
allFailed: true (expect true)
classify: diff-failed (expect diff-failed)
isNewTodo old line, fail-open: true (expect true)
```

---

## Out of scope (flag to the user, do not implement here)

These were observed during root-cause analysis but are separate from the race fix:

1. **Empty-branch behavior differs from nonexistent-branch.** With an empty base branch, `newTodoFilter.refresh` early-returns (`src/newTodoFilter.js:119-125`) leaving `coveredRoots`/`failedRoots` empty, so files classify as `no-repo` (not `diff-failed`) and show fail-open with a status node — arguably acceptable, but inconsistent with the nonexistent-branch path. Decide separately whether empty branch should also surface a warning.
2. **Config-key naming.** The user referred to `filtering.newTodosGitBranch`, but the actual setting is `filtering.newTodosGitBaseBranch` (`src/config.js:413`). If they literally set `newTodosGitBranch`, it is silently ignored. Not a code bug; worth a docs/UX note.
