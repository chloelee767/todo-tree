# New-Todos Hide-On-Base-Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide all todos from repos whose current branch already matches the resolved new-todos base branch, while reporting that hidden count separately from existing undiffable reasons.

**Architecture:** Add one git helper in `src/git.js` for current-branch lookup, use it in `src/newTodoFilter.js` to classify repo roots as `on-base-branch`, and keep that state separate from `no-repo` / `diff-failed` / `no-branch`. `src/extension.js` threads a separate per-file count into the tree provider, and `src/tree.js` renders the new hidden-vs-shown status copy and tooltip buckets without changing existing current-file wording.

**Tech Stack:** Node.js, CommonJS, VS Code extension APIs, QUnit.

---

## File Structure

- `src/git.js` (Modify) - add `getCurrentBranch(repoRoot)` next to the existing git process helpers.
- `src/newTodoFilter.js` (Modify) - track `onBaseBranchRoots`, hide those files regardless of fail-open settings, and expose a dedicated query API such as `isOnBaseBranch(fsPath)`.
- `src/extension.js` (Modify) - add a separate scanned hidden set for on-base-branch files, count them once per file, and pass `onBaseBranch` into `provider.setNewTodoStatus(...)`.
- `src/tree.js` (Modify) - update status-node labels, tooltip buckets, and current-file suppression logic to account for `onBaseBranch` as always-hidden.
- `test/git.behavior.test.js` (Modify) - cover the new git helper success / failure behavior.
- `test/git.realrepo.test.js` (Modify) - verify current-branch lookup against a real temporary git repository.
- `test/newTodoFilter.behavior.test.js` (Modify) - cover on-base-branch hiding, mixed-root behavior, and lazy repo discovery.
- `test/newTodoFilter.realrepo.test.js` (Modify) - verify the on-base-branch hide path against a real temporary git repository.
- `test/extension.scan-parity.test.js` (Modify) - verify `onBaseBranch` is counted separately from `noBranch` and only once per file.
- `test/tree.behavior.test.js` (Modify) - verify the new workspace / current-file status-node copy and tooltip output.

---

## Notes For The Implementing Engineer

- Keep `on-base-branch` out of `classifyUndiffable()`. It is a separate hidden state, not an undiffable reason.
- `newTodoFilter.isNewTodo(...)` must always return `false` for files owned by an on-base-branch repo, even when `newTodosShowUndiffableFiles()` is `true`.
- `git.getCurrentBranch(...)` should trim stdout but otherwise preserve the branch string exactly. Do not normalize refs.
- If current-branch lookup fails, log it with `debug(...)` and continue through the existing diff path. Only real diff failures should become `diff-failed`.
- `provider.setNewTodoStatus(...)` should always receive an `onBaseBranch` number so the tree can render without guessing.
- Do not change `src/fileDecorationProvider.js`. Hidden on-base-branch todos never render, so the existing undiffable decoration path remains correct.
- Do not rely on mocks alone for git semantics here. Add real-repo coverage in `test/git.realrepo.test.js` and `test/newTodoFilter.realrepo.test.js` for the branch-equality path.
- Focused QUnit commands in this repo are file-scoped: `npx qunit test/<file>.js`.

---

### Task 1: Add Git Current-Branch Lookup

**Files:**
- Modify: `src/git.js:107-205`
- Modify: `test/git.behavior.test.js`
- Modify: `test/git.realrepo.test.js`

- [ ] **Step 1: Write the failing git-helper tests**

Append these tests near the end of `test/git.behavior.test.js`:

```javascript
QUnit.test( 'getCurrentBranch returns the trimmed current branch on success', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( {
        stdout: 'feature/hide-base-branch\n',
        exitCode: 0,
        exitAfterStdout: true
    } );
    git.init( function() {} );

    git.getCurrentBranch( '/repo' ).then( function( branch )
    {
        assert.strictEqual( branch, 'feature/hide-base-branch' );
        assert.deepEqual( git._lastSpawnCall.args, [ 'branch', '--show-current' ] );
        assert.deepEqual( git._lastSpawnCall.options, { cwd: '/repo' } );
        done();
    } );
} );

QUnit.test( 'getCurrentBranch uses the configured git binary', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( {
        stdout: 'main\n',
        exitCode: 0,
        exitAfterStdout: true,
        configuredGitPath: '/custom/bin/git'
    } );
    git.init( function() {} );

    git.getCurrentBranch( '/repo' ).then( function()
    {
        assert.strictEqual( git._lastSpawnCall.command, '/custom/bin/git' );
        done();
    } );
} );

QUnit.test( 'getCurrentBranch rejects cleanly on git failure', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( {
        stderr: 'fatal: not a git repository',
        exitCode: 128,
        exitAfterStdout: true
    } );
    git.init( function() {} );

    git.getCurrentBranch( '/repo' ).then( function()
    {
        assert.ok( false, 'expected rejection' );
        done();
    } ).catch( function( error )
    {
        assert.ok( /Git branch stderr/i.test( error.message ) );
        done();
    } );
} );
```

- [ ] **Step 2: Run the git test file and confirm the new tests fail first**

Run: `npx qunit test/git.behavior.test.js`

Expected:
- FAIL: `git.getCurrentBranch is not a function` in the new tests.
- PASS: the existing `getChangedFilesAndLines`, `findRepoRoot`, and `getUntrackedFiles` tests.

- [ ] **Step 3: Implement `getCurrentBranch(repoRoot)` in `src/git.js`**

Add this function after `findRepoRoot()` and export it at the bottom of the file:

```javascript
function getCurrentBranch( repoRoot )
{
    if( !repoRoot )
    {
        return Promise.reject( new Error( 'Repository path is required.' ) );
    }

    return new Promise( function( resolve, reject )
    {
        var args = [ 'branch', '--show-current' ];
        debug( 'Git branch args: ' + args );
        var proc = spawn( config.gitPath(), args, { cwd: repoRoot } );
        var stdoutBuffer = '';
        var stderrBuffer = '';

        proc.stdout.on( 'data', function( data )
        {
            stdoutBuffer += data;
        } );

        proc.stderr.on( 'data', function( data )
        {
            stderrBuffer += data;
        } );

        proc.on( 'exit', function( code )
        {
            if( code !== 0 )
            {
                reject( new Error( 'Git branch stderr: ' + stderrBuffer ) );
                return;
            }

            resolve( stdoutBuffer.trim() );
        } );

        proc.on( 'error', function( error )
        {
            reject( error );
        } );
    } );
}

module.exports.getCurrentBranch = getCurrentBranch;
```

- [ ] **Step 4: Run the git test file again**

Run: `npx qunit test/git.behavior.test.js`

Expected:
- PASS: the three new `getCurrentBranch(...)` tests.
- PASS: the full existing git helper test file.

- [ ] **Step 5: Add a real-repo test for `getCurrentBranch(...)`**

Append this test to `test/git.realrepo.test.js` inside the existing `QUnit.module( 'real-repo git', ... )` block:

```javascript
QUnit.test( 'getCurrentBranch returns the checked-out branch in a real repo', function( assert )
{
    var done = assert.async();
    git.getCurrentBranch( root ).then( function( branch )
    {
        assert.strictEqual( branch, 'base', 'returns the actual checked-out branch name' );
        done();
    } ).catch( function( err )
    {
        assert.ok( false, 'should not reject: ' + err.message );
        done();
    } );
} );
```

- [ ] **Step 6: Run the real-repo git test file**

Run: `npx qunit test/git.realrepo.test.js`

Expected:
- PASS: the new `getCurrentBranch(...)` real-repo test.
- PASS: the existing real-repo diff and untracked-file tests.

- [ ] **Step 7: Commit the git helper changes**

```bash
git add src/git.js test/git.behavior.test.js test/git.realrepo.test.js
git commit -m "feat(new-todos): add current branch git helper"
```

---

### Task 2: Hide On-Base-Branch Repos In `newTodoFilter`

**Files:**
- Modify: `src/newTodoFilter.js:5-324`
- Modify: `test/newTodoFilter.behavior.test.js`
- Modify: `test/newTodoFilter.realrepo.test.js`

- [ ] **Step 1: Extend the filter test harness with the new git helper stub**

Update `loadFilter()` in `test/newTodoFilter.behavior.test.js` so the default stub exposes `getCurrentBranch(...)`:

```javascript
function loadFilter( gitStub )
{
    return helpers.loadWithStubs( '../src/newTodoFilter.js', {
        './git.js': Object.assign( {
            init: function() {},
            getChangedFilesAndLines: function() { return Promise.resolve( new Map() ); },
            getUntrackedFiles: function() { return Promise.resolve( [] ); },
            getCurrentBranch: function() { return Promise.resolve( 'feature/work' ); }
        }, gitStub || {} )
    } );
}
```

- [ ] **Step 2: Add the failing on-base-branch behavior tests**

Append these tests near the existing `refresh(...)` / `extendForRepo(...)` coverage in `test/newTodoFilter.behavior.test.js`:

```javascript
QUnit.test( 'refresh hides files for repos already on the resolved base branch', function( assert )
{
    var done = assert.async();
    var diffCalls = 0;
    var f = loadFilter( {
        getCurrentBranch: function() { return Promise.resolve( 'main' ); },
        getChangedFilesAndLines: function()
        {
            diffCalls++;
            return Promise.resolve( new Map( [ [ 'a.js', [ [ 1, 1 ] ] ] ] ) );
        }
    } );

    f.init( function() {} );
    f.setEnabled( true );
    f.setShowUndiffableFiles( true );

    f.refresh( constantBranch( 'main' ), [ '/repo' ], { include: [], exclude: [] } ).then( function()
    {
        assert.equal( diffCalls, 0, 'git diff skipped when already on base branch' );
        assert.equal( f.isOnBaseBranch( '/repo/a.js' ), true, 'repo is tracked as hidden' );
        assert.equal( f.classifyUndiffable( '/repo/a.js' ), null, 'hidden is not an undiffable reason' );
        assert.equal( f.isNewTodo( '/repo/a.js', 1 ), false, 'todo stays hidden' );
        done();
    } );
} );

QUnit.test( 'refresh keeps normal diff behavior when current branch differs from base branch', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        getCurrentBranch: function() { return Promise.resolve( 'feature/work' ); },
        getChangedFilesAndLines: function() { return Promise.resolve( new Map( [ [ 'a.js', [ [ 5, 2 ] ] ] ] ) ); }
    } );

    f.init( function() {} );
    f.setEnabled( true );

    f.refresh( constantBranch( 'main' ), [ '/repo' ], { include: [], exclude: [] } ).then( function()
    {
        assert.equal( f.isOnBaseBranch( '/repo/a.js' ), false );
        assert.equal( f.isNewTodo( '/repo/a.js', 5 ), true );
        done();
    } );
} );

QUnit.test( 'refresh keeps on-base-branch separate from no-branch in mixed roots', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        getCurrentBranch: function( root )
        {
            return Promise.resolve( root === '/hidden' ? 'main' : 'feature/work' );
        },
        getChangedFilesAndLines: function( branch, root )
        {
            if( root === '/shown' )
            {
                return Promise.resolve( new Map( [ [ 'shown.js', [ [ 2, 1 ] ] ] ] ) );
            }

            return Promise.resolve( new Map() );
        }
    } );

    f.init( function() {} );
    f.setEnabled( true );

    f.refresh( function( root )
    {
        if( root === '/blank' ) { return ''; }
        return 'main';
    }, [ '/hidden', '/shown', '/blank' ], { include: [], exclude: [] } ).then( function( summary )
    {
        assert.deepEqual( summary.noBranchRoots, [ '/blank' ] );
        assert.equal( f.isOnBaseBranch( '/hidden/a.js' ), true );
        assert.equal( f.classifyUndiffable( '/blank/a.js' ), 'no-branch' );
        assert.equal( f.isNewTodo( '/shown/shown.js', 2 ), true );
        done();
    } );
} );

QUnit.test( 'extendForRepo records a lazily discovered repo as on-base-branch', function( assert )
{
    var done = assert.async();
    var diffCalls = 0;
    var f = loadFilter( {
        getCurrentBranch: function() { return Promise.resolve( 'main' ); },
        getChangedFilesAndLines: function()
        {
            diffCalls++;
            return Promise.resolve( new Map() );
        }
    } );

    f.init( function() {} );
    f.setEnabled( true );

    f.refresh( constantBranch( 'main' ), [ '/existing' ], { include: [], exclude: [] } ).then( function()
    {
        return f.extendForRepo( '/late', constantBranch( 'main' ), { include: [], exclude: [] } );
    } ).then( function()
    {
        assert.equal( diffCalls, 0, 'extend also skips git diff when already on base branch' );
        assert.equal( f.isOwningRepoKnown( '/late' ), true );
        assert.equal( f.isOnBaseBranch( '/late/file.js' ), true );
        done();
    } );
} );
```

- [ ] **Step 3: Run the filter test file and confirm the new tests fail first**

Run: `npx qunit test/newTodoFilter.behavior.test.js`

Expected:
- FAIL: `f.isOnBaseBranch is not a function`.
- FAIL: the new assertions that expect git diff to be skipped for on-base-branch repos.
- PASS: the existing no-branch / diff-failed coverage.

- [ ] **Step 4: Implement on-base-branch tracking in `src/newTodoFilter.js`**

Add the new root bucket and query API near the top of the file:

```javascript
var coveredRoots = [];
var failedRoots = [];
var noBranchRoots = [];
var onBaseBranchRoots = [];
var pendingRepoExtends = new Map();

function isOnBaseBranch( fsPath )
{
    var onBaseBranchOwning = findOwningRoot( fsPath, onBaseBranchRoots );
    var coveredOwning = findOwningRoot( fsPath, coveredRoots );
    var failedOwning = findOwningRoot( fsPath, failedRoots );
    var noBranchOwning = findOwningRoot( fsPath, noBranchRoots );

    return onBaseBranchOwning !== undefined &&
        ( coveredOwning === undefined || onBaseBranchOwning.length >= coveredOwning.length ) &&
        ( failedOwning === undefined || onBaseBranchOwning.length >= failedOwning.length ) &&
        ( noBranchOwning === undefined || onBaseBranchOwning.length >= noBranchOwning.length );
}
```

Add one small helper so `refresh(...)` and `extendForRepo(...)` share the same branch-comparison logic:

```javascript
function loadDiffStateForRoot( root, branch, include, exclude )
{
    function loadDiffAndUntracked()
    {
        var diffPromise = git.getChangedFilesAndLines( branch, root, include, exclude )
            .then( function( map ) { return { map: map, ok: true }; } )
            .catch( function( error )
            {
                debug( 'newTodoFilter: diff failed for ' + root + ': ' + error.message );
                return { map: new Map(), ok: false };
            } );
        var untrackedPromise = git.getUntrackedFiles( root, include, exclude )
            .catch( function( error )
            {
                debug( 'newTodoFilter: status failed for ' + root + ': ' + error.message );
                return [];
            } );

        return Promise.all( [ diffPromise, untrackedPromise ] ).then( function( both )
        {
            return {
                root: root,
                map: both[ 0 ].map,
                ok: both[ 0 ].ok,
                untracked: both[ 1 ],
                onBaseBranch: false
            };
        } );
    }

    return git.getCurrentBranch( root ).then( function( currentBranch )
    {
        if( String( currentBranch || '' ).trim() !== '' && currentBranch === branch )
        {
            return {
                root: root,
                map: new Map(),
                ok: true,
                untracked: [],
                onBaseBranch: true
            };
        }

        return loadDiffAndUntracked();
    } ).catch( function( error )
    {
        debug( 'newTodoFilter: current branch lookup failed for ' + root + ': ' + error.message );
        return loadDiffAndUntracked();
    } );
}
```

Use that helper inside `refresh(...)` and track the new roots separately:

```javascript
if( enabled !== true || !roots || roots.length === 0 )
{
    rangesByPath = new Map();
    coveredRoots = [];
    failedRoots = [];
    noBranchRoots = [];
    onBaseBranchRoots = [];
    return Promise.resolve( { allFailed: false, noBranchRoots: [] } );
}

return Promise.all( diffableRoots.map( function( root )
{
    return loadDiffStateForRoot( root, resolveBranch( root ), include, exclude );
} ) ).then( function( results )
{
    var next = new Map();
    var nextCovered = [];
    var nextFailed = [];
    var nextOnBaseBranch = [];

    results.forEach( function( result )
    {
        if( result.onBaseBranch === true )
        {
            nextOnBaseBranch.push( result.root );
            return;
        }

        result.map.forEach( function( lines, relPath )
        {
            next.set( path.join( result.root, relPath ), lines );
        } );
        result.untracked.forEach( function( relPath )
        {
            next.set( path.join( result.root, relPath ), [ [ 1, Infinity ] ] );
        } );

        if( result.ok === true )
        {
            nextCovered.push( result.root );
        }
        else
        {
            nextFailed.push( result.root );
        }
    } );

    rangesByPath = next;
    coveredRoots = nextCovered;
    failedRoots = nextFailed;
    noBranchRoots = blankRoots;
    onBaseBranchRoots = nextOnBaseBranch;

    return {
        allFailed: results.filter( function( result ) { return result.onBaseBranch !== true; } ).length > 0 &&
            results.filter( function( result ) { return result.onBaseBranch !== true; } ).every( function( result ) { return result.ok === false; } ),
        noBranchRoots: blankRoots.slice()
    };
} );
```

Update `isNewTodo(...)`, `isOwningRepoKnown(...)`, and `extendForRepo(...)` to respect the new state:

```javascript
function isNewTodo( fsPath, line )
{
    var ranges = rangesByPath.get( fsPath );
    if( ranges )
    {
        return ranges.some( function( range )
        {
            var end = range[ 0 ] + ( range[ 1 ] - 1 );
            return line >= range[ 0 ] && line <= end;
        } );
    }

    if( isOnBaseBranch( fsPath ) )
    {
        return false;
    }

    if( classifyUndiffable( fsPath ) === null )
    {
        return false;
    }

    return showUndiffableFiles === true;
}

function isOwningRepoKnown( repoRoot )
{
    return coveredRoots.indexOf( repoRoot ) !== -1 ||
        failedRoots.indexOf( repoRoot ) !== -1 ||
        noBranchRoots.indexOf( repoRoot ) !== -1 ||
        onBaseBranchRoots.indexOf( repoRoot ) !== -1;
}

function extendForRepo( repoRoot, resolveBranch, globs )
{
    // keep the existing pending-generation logic

    return loadDiffStateForRoot( repoRoot, resolveBranch( repoRoot ), include, exclude ).then( function( result )
    {
        if( generation !== refreshGeneration || isOwningRepoKnown( repoRoot ) )
        {
            return;
        }

        if( result.onBaseBranch === true )
        {
            onBaseBranchRoots.push( repoRoot );
            return;
        }

        result.map.forEach( function( lines, relPath )
        {
            rangesByPath.set( path.join( repoRoot, relPath ), lines );
        } );
        result.untracked.forEach( function( relPath )
        {
            rangesByPath.set( path.join( repoRoot, relPath ), [ [ 1, Infinity ] ] );
        } );

        if( result.ok === true )
        {
            coveredRoots.push( repoRoot );
        }
        else
        {
            failedRoots.push( repoRoot );
        }
    } );
}

module.exports.isOnBaseBranch = isOnBaseBranch;
```

- [ ] **Step 5: Run the filter test file again**

Run: `npx qunit test/newTodoFilter.behavior.test.js`

Expected:
- PASS: the new on-base-branch tests.
- PASS: the existing no-branch / diff-failed / nested-root coverage.

- [ ] **Step 6: Add a real-repo test for the on-base-branch hide path**

Append this test to `test/newTodoFilter.realrepo.test.js` inside the existing `QUnit.module( 'real-repo newTodoFilter', ... )` block:

```javascript
QUnit.test( 'current branch equal to base branch hides tracked todos regardless of fail-open', function( assert )
{
    var done = assert.async();
    newTodoFilter.setShowUndiffableFiles( true );
    newTodoFilter.refresh( function() { return 'base'; }, [ root ], GLOBS ).then( function( summary )
    {
        assert.strictEqual( summary.allFailed, false, 'on-base-branch is not a diff failure' );
        assert.strictEqual( newTodoFilter.classifyUndiffable( trackedPath ), null, 'file is not classified as undiffable' );
        assert.strictEqual( newTodoFilter.isOnBaseBranch( trackedPath ), true, 'file is tracked as on-base-branch' );
        assert.strictEqual( newTodoFilter.isNewTodo( trackedPath, 2 ), false, 'old line stays hidden' );
        assert.strictEqual( newTodoFilter.isNewTodo( trackedPath, 3 ), false, 'new line stays hidden because repo is on base branch' );
        done();
    } ).catch( function( err )
    {
        assert.ok( false, 'should not reject: ' + err.message );
        done();
    } );
} );
```

- [ ] **Step 7: Run the real-repo filter test file**

Run: `npx qunit test/newTodoFilter.realrepo.test.js`

Expected:
- PASS: the new on-base-branch real-repo test.
- PASS: the existing real-repo diffable and diff-failed tests.

- [ ] **Step 8: Commit the filter changes**

```bash
git add src/newTodoFilter.js test/newTodoFilter.behavior.test.js test/newTodoFilter.realrepo.test.js
git commit -m "feat(new-todos): hide repos already on base branch"
```

---

### Task 3: Thread `onBaseBranch` Counts Through `extension.js`

**Files:**
- Modify: `src/extension.js:99-100`
- Modify: `src/extension.js:2242-2259`
- Modify: `src/extension.js:2534-2602`
- Modify: `test/extension.scan-parity.test.js`

- [ ] **Step 1: Update the extension test harness default newTodoFilter stub**

In `test/extension.scan-parity.test.js`, update the default stub inside `createExtensionHarness(...)`:

```javascript
'./newTodoFilter.js': Object.assign( {
    init: function() {},
    setEnabled: function() {},
    setShowUndiffableFiles: function() {},
    isEnabled: function() { return false; },
    isNewTodo: function() { return true; },
    classifyUndiffable: function() { return null; },
    isOnBaseBranch: function() { return false; },
    refresh: function() { return Promise.resolve( { allFailed: false } ); }
}, options.newTodoFilterStub || {} ),
```

- [ ] **Step 2: Add the failing extension parity tests for the new count**

Add these tests near the existing `newTodoFilter` provider-status assertions in `test/extension.scan-parity.test.js`:

```javascript
QUnit.test( 'new-todos filter threads on-base-branch counts separately from no-branch', function( assert )
{
    var fixture = [ {
        uri: matrixHelpers.createUri( '/workspace/src/hidden.js' ),
        actualTag: 'TODO',
        displayText: 'hidden item',
        continuationText: [],
        line: 1
    } ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: [ {
            fsPath: 'src/hidden.js',
            line: 1,
            column: 1,
            match: 'TODO hidden item'
        } ],
        fileContents: {
            '/workspace/src/hidden.js': '// TODO hidden item'
        },
        scanTextImpl: function( uri )
        {
            return uri.fsPath === '/workspace/src/hidden.js' ? fixture : [];
        },
        newTodoFilterStub: {
            init: function() {},
            setEnabled: function() {},
            setShowUndiffableFiles: function() {},
            isEnabled: function() { return true; },
            classifyUndiffable: function() { return null; },
            isOnBaseBranch: function( fsPath ) { return fsPath === '/workspace/src/hidden.js'; },
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
            noBranch: 0,
            onBaseBranch: 1,
            showUndiffableFiles: true,
            scanMode: 'workspace',
            baseBranch: ''
        } );
    } );
} );

QUnit.test( 'new-todos filter counts on-base-branch files once even when one file yields multiple todos', function( assert )
{
    var fixture = [ {
        uri: matrixHelpers.createUri( '/workspace/src/hidden.js' ),
        actualTag: 'TODO',
        displayText: 'first hidden item',
        continuationText: [],
        line: 1
    }, {
        uri: matrixHelpers.createUri( '/workspace/src/hidden.js' ),
        actualTag: 'TODO',
        displayText: 'second hidden item',
        continuationText: [],
        line: 2
    } ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: [ {
            fsPath: 'src/hidden.js',
            line: 1,
            column: 1,
            match: 'TODO first hidden item'
        } ],
        fileContents: {
            '/workspace/src/hidden.js': '// TODO first hidden item\n// TODO second hidden item'
        },
        scanTextImpl: function( uri )
        {
            return uri.fsPath === '/workspace/src/hidden.js' ? fixture : [];
        },
        newTodoFilterStub: {
            init: function() {},
            setEnabled: function() {},
            setShowUndiffableFiles: function() {},
            isEnabled: function() { return true; },
            classifyUndiffable: function() { return null; },
            isOnBaseBranch: function( fsPath ) { return fsPath === '/workspace/src/hidden.js'; },
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
        assert.equal( harness.provider.newTodoStatus.onBaseBranch, 1 );
    } );
} );
```

Update the existing `provider.newTodoStatus` `deepEqual(...)` expectations in this file to include `onBaseBranch: 0`.

- [ ] **Step 3: Run the extension parity file and confirm the new tests fail first**

Run: `npx qunit test/extension.scan-parity.test.js`

Expected:
- FAIL: the new assertions because `provider.setNewTodoStatus(...)` does not yet receive `onBaseBranch`.
- FAIL: any existing `deepEqual(...)` expectations until `onBaseBranch: 0` is added to them.

- [ ] **Step 4: Add the new scanned set and status payload in `src/extension.js`**

Add the new set near the existing `scannedUndiffable` state:

```javascript
var scannedUndiffable = { 'no-repo': new Set(), 'diff-failed': new Set(), 'no-branch': new Set() };
var scannedOnBaseBranch = new Set();
```

Update `applyNewTodoFilterToResults(...)` to account for the new hidden reason without overloading `classifyUndiffable(...)`:

```javascript
function applyNewTodoFilterToResults( uri, results )
{
    if( newTodoFilter.isEnabled() !== true )
    {
        return results;
    }

    var reason = newTodoFilter.classifyUndiffable( uri.fsPath );
    if( reason === 'no-repo' || reason === 'diff-failed' || reason === 'no-branch' )
    {
        scannedUndiffable[ reason ].add( uri.fsPath );
    }

    if( typeof ( newTodoFilter.isOnBaseBranch ) === 'function' && newTodoFilter.isOnBaseBranch( uri.fsPath ) === true )
    {
        scannedOnBaseBranch.add( uri.fsPath );
    }

    return results.filter( function( result )
    {
        return newTodoFilter.isNewTodo( uri.fsPath, result.line );
    } );
}
```

Clear the set at the start of `executeRebuild()` and pass the new count into `provider.setNewTodoStatus(...)`:

```javascript
scannedUndiffable[ 'no-repo' ].clear();
scannedUndiffable[ 'diff-failed' ].clear();
scannedUndiffable[ 'no-branch' ].clear();
scannedOnBaseBranch.clear();
```

```javascript
provider.setNewTodoStatus( {
    enabled: newTodoFilter.isEnabled(),
    noRepo: scannedUndiffable[ 'no-repo' ].size,
    diffFailed: scannedUndiffable[ 'diff-failed' ].size,
    noBranch: scannedUndiffable[ 'no-branch' ].size,
    onBaseBranch: scannedOnBaseBranch.size,
    showUndiffableFiles: typeof ( config.newTodosShowUndiffableFiles ) === 'function' ? config.newTodosShowUndiffableFiles() : true,
    scanMode: config.scanMode(),
    baseBranch: config.newTodosGitBaseBranch()
} );
```

- [ ] **Step 5: Run the extension parity file again**

Run: `npx qunit test/extension.scan-parity.test.js`

Expected:
- PASS: the new `onBaseBranch` count tests.
- PASS: the existing `noRepo`, `diffFailed`, and `noBranch` provider-status tests with `onBaseBranch: 0` added.

- [ ] **Step 6: Commit the extension plumbing changes**

```bash
git add src/extension.js test/extension.scan-parity.test.js
git commit -m "feat(new-todos): thread on-base-branch counts through scans"
```

---

### Task 4: Render The New Status Copy In `tree.js`

**Files:**
- Modify: `src/tree.js:473-610`
- Modify: `test/tree.behavior.test.js`

- [ ] **Step 1: Add the failing tree behavior tests**

Append these tests near the existing status-node coverage in `test/tree.behavior.test.js`:

```javascript
QUnit.test( 'status node: workspace hidden-only on-base-branch uses not-shown copy and hidden tooltip bucket', function( assert )
{
    var configStub = createConfig();
    var tree = loadTreeModule( configStub );
    var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );

    provider.setNewTodoStatus( {
        enabled: true,
        noRepo: 0,
        diffFailed: 0,
        noBranch: 0,
        onBaseBranch: 2,
        showUndiffableFiles: true,
        scanMode: 'workspace',
        baseBranch: 'main'
    } );

    var node = provider.getChildren().find( function( child )
    {
        return child.isStatusNode === true && /New-todos/.test( child.label );
    } );
    var treeItem = provider.getTreeItem( node );

    assert.equal( node.label, 'New-todos: 2 not shown' );
    assert.ok( /\*\*Hidden\*\*/.test( treeItem.tooltip.value ) );
    assert.ok( /- 2 on git base branch/.test( treeItem.tooltip.value ) );
} );

QUnit.test( 'status node: workspace combines hidden on-base-branch and shown fail-open undiffables', function( assert )
{
    var configStub = createConfig();
    var tree = loadTreeModule( configStub );
    var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );

    provider.setNewTodoStatus( {
        enabled: true,
        noRepo: 1,
        diffFailed: 1,
        noBranch: 1,
        onBaseBranch: 2,
        showUndiffableFiles: true,
        scanMode: 'workspace',
        baseBranch: 'main'
    } );

    var node = provider.getChildren().find( function( child )
    {
        return child.isStatusNode === true && /New-todos/.test( child.label );
    } );
    var treeItem = provider.getTreeItem( node );

    assert.equal( node.label, 'New-todos: 2 not shown, 3 shown without filtering' );
    assert.ok( /\*\*Hidden\*\*/.test( treeItem.tooltip.value ) );
    assert.ok( /- 2 on git base branch/.test( treeItem.tooltip.value ) );
    assert.ok( /\*\*Shown without filtering\*\*/.test( treeItem.tooltip.value ) );
    assert.ok( /- 1 not in a git repository/.test( treeItem.tooltip.value ) );
    assert.ok( /- 1 could not be diffed \(errors\)/.test( treeItem.tooltip.value ) );
    assert.ok( /- 1 no base branch configured/.test( treeItem.tooltip.value ) );
} );

QUnit.test( 'status node: current-file on-base-branch keeps Current file not shown copy', function( assert )
{
    var configStub = createConfig();
    var tree = loadTreeModule( configStub );
    var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );

    provider.setNewTodoStatus( {
        enabled: true,
        noRepo: 0,
        diffFailed: 0,
        noBranch: 0,
        onBaseBranch: 1,
        showUndiffableFiles: true,
        scanMode: 'current file',
        baseBranch: 'main'
    } );

    var node = provider.getChildren().find( function( child )
    {
        return child.isStatusNode === true && /Current file/.test( child.label );
    } );

    assert.equal( node.label, 'Current file not shown' );
} );
```

- [ ] **Step 2: Run the tree test file and confirm the new tests fail first**

Run: `npx qunit test/tree.behavior.test.js`

Expected:
- FAIL: the new label and tooltip assertions because `tree.js` does not yet know about `onBaseBranch`.
- PASS: the existing undiffable status-node tests.

- [ ] **Step 3: Implement the new hidden / shown status math in `src/tree.js`**

Default the new field in `setNewTodoStatus(...)`:

```javascript
setNewTodoStatus( status )
{
    this._newTodoStatus = status ? Object.assign( { noBranch: 0, onBaseBranch: 0 }, status ) : status;
}
```

Update the root-level status-node logic inside `getChildren(undefined)` to compute separate hidden and shown counts:

```javascript
var nts = this._newTodoStatus;
if( nts && nts.enabled === true )
{
    var shownWithoutFiltering = nts.showUndiffableFiles === true ? ( nts.noRepo + nts.diffFailed + nts.noBranch ) : 0;
    var hiddenUndiffable = nts.showUndiffableFiles === true ? 0 : ( nts.noRepo + nts.diffFailed + nts.noBranch );
    var hiddenCount = nts.onBaseBranch + hiddenUndiffable;

    if( hiddenCount > 0 || shownWithoutFiltering > 0 )
    {
        var label;

        if( nts.scanMode === 'current file' )
        {
            label = hiddenCount > 0 ? 'Current file not shown' : 'Current file shown without filtering';
        }
        else if( hiddenCount > 0 && shownWithoutFiltering > 0 )
        {
            label = 'New-todos: ' + hiddenCount + ' not shown, ' + shownWithoutFiltering + ' shown without filtering';
        }
        else if( hiddenCount > 0 )
        {
            label = 'New-todos: ' + hiddenCount + ' not shown';
        }
        else
        {
            label = 'New-todos: ' + shownWithoutFiltering + ' shown without filtering';
        }

        var tooltip = new vscode.MarkdownString();

        if( hiddenCount > 0 )
        {
            tooltip.appendMarkdown( '**Hidden**\n\n' );
            if( nts.onBaseBranch > 0 )
            {
                tooltip.appendMarkdown( '- ' + nts.onBaseBranch + ' on git base branch\n' );
            }
            if( nts.showUndiffableFiles !== true && nts.noRepo > 0 )
            {
                tooltip.appendMarkdown( '- ' + nts.noRepo + ' not in a git repository\n' );
            }
            if( nts.showUndiffableFiles !== true && nts.diffFailed > 0 )
            {
                tooltip.appendMarkdown( '- ' + nts.diffFailed + ' could not be diffed (errors)\n' );
            }
            if( nts.showUndiffableFiles !== true && nts.noBranch > 0 )
            {
                tooltip.appendMarkdown( '- ' + nts.noBranch + ' no base branch configured\n' );
            }
        }

        if( shownWithoutFiltering > 0 )
        {
            if( hiddenCount > 0 )
            {
                tooltip.appendMarkdown( '\n' );
            }
            tooltip.appendMarkdown( '**Shown without filtering**\n\n' );
            if( nts.noRepo > 0 )
            {
                tooltip.appendMarkdown( '- ' + nts.noRepo + ' not in a git repository\n' );
            }
            if( nts.diffFailed > 0 )
            {
                tooltip.appendMarkdown( '- ' + nts.diffFailed + ' could not be diffed (errors)\n' );
            }
            if( nts.noBranch > 0 )
            {
                tooltip.appendMarkdown( '- ' + nts.noBranch + ' no base branch configured\n' );
            }
        }

        result.unshift( {
            label: label,
            notExported: true,
            isStatusNode: true,
            icon: 'git-branch',
            tooltip: tooltip,
            opensUndiffableSetting: true
        } );
    }
}
```

Update the `Nothing found` suppression check to count `onBaseBranch` as hidden in current-file mode:

```javascript
var suppressNothingFound = nts2 && nts2.enabled === true &&
    nts2.scanMode === 'current file' &&
    ( nts2.onBaseBranch + ( nts2.showUndiffableFiles === true ? 0 : ( nts2.noRepo + nts2.diffFailed + nts2.noBranch ) ) ) > 0;
```

- [ ] **Step 4: Run the tree test file again**

Run: `npx qunit test/tree.behavior.test.js`

Expected:
- PASS: the new on-base-branch label / tooltip tests.
- PASS: the existing status-node regression coverage.

- [ ] **Step 5: Commit the tree changes**

```bash
git add src/tree.js test/tree.behavior.test.js
git commit -m "feat(new-todos): show on-base-branch hidden status"
```

---

### Task 5: Run The Focused Regression Suite And Fix The Smallest Breakage

**Files:**
- Modify as needed: `src/git.js`
- Modify as needed: `src/newTodoFilter.js`
- Modify as needed: `src/extension.js`
- Modify as needed: `src/tree.js`
- Modify as needed: `test/git.behavior.test.js`
- Modify as needed: `test/git.realrepo.test.js`
- Modify as needed: `test/newTodoFilter.behavior.test.js`
- Modify as needed: `test/newTodoFilter.realrepo.test.js`
- Modify as needed: `test/extension.scan-parity.test.js`
- Modify as needed: `test/tree.behavior.test.js`

- [ ] **Step 1: Run the focused regression suite**

Run: `npx qunit test/git.behavior.test.js test/git.realrepo.test.js test/newTodoFilter.behavior.test.js test/newTodoFilter.realrepo.test.js test/extension.scan-parity.test.js test/tree.behavior.test.js`

Expected:
- PASS: all focused coverage for the new current-branch helper, real git behavior, filter behavior, extension status plumbing, and tree copy.

- [ ] **Step 2: If any test fails, make the smallest fix and rerun the same command**

Use the failure output to make only the minimal correction. The most likely fixes are:

```javascript
// Keep on-base-branch distinct from undiffable reasons.
if( classifyUndiffable( fsPath ) === null )
{
    return false;
}
```

```javascript
// Count hidden on-base-branch files once per file, not once per todo result.
if( typeof ( newTodoFilter.isOnBaseBranch ) === 'function' && newTodoFilter.isOnBaseBranch( uri.fsPath ) === true )
{
    scannedOnBaseBranch.add( uri.fsPath );
}
```

```javascript
// Current-file mode stays singular even when the hidden reason is on-base-branch.
label = hiddenCount > 0 ? 'Current file not shown' : 'Current file shown without filtering';
```

- [ ] **Step 3: Commit the focused regression fix if any changes were needed**

```bash
git add src/git.js src/newTodoFilter.js src/extension.js src/tree.js test/git.behavior.test.js test/git.realrepo.test.js test/newTodoFilter.behavior.test.js test/newTodoFilter.realrepo.test.js test/extension.scan-parity.test.js test/tree.behavior.test.js
git commit -m "test(new-todos): stabilize hide-on-base-branch behavior"
```

Skip this commit if Step 2 made no changes.

---

### Task 6: Run The Full Test Suite As Final Verification

**Files:**
- No code changes expected

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected:
- PASS: the full QUnit suite.

- [ ] **Step 2: If the full suite finds fallout, make the smallest local fix and rerun `npm test`**

Keep fixes local to the files already touched by this feature. Likely fallout points:

```javascript
// Existing exact-object assertions may need onBaseBranch: 0 added.
assert.deepEqual( harness.provider.newTodoStatus, {
    enabled: true,
    noRepo: 0,
    diffFailed: 1,
    noBranch: 0,
    onBaseBranch: 0,
    showUndiffableFiles: true,
    scanMode: 'workspace',
    baseBranch: ''
} );
```

```javascript
// Keep refresh reset logic symmetrical.
onBaseBranchRoots = [];
```

- [ ] **Step 3: Commit the final verification fix if needed**

```bash
git add src/git.js src/newTodoFilter.js src/extension.js src/tree.js test/git.behavior.test.js test/git.realrepo.test.js test/newTodoFilter.behavior.test.js test/newTodoFilter.realrepo.test.js test/extension.scan-parity.test.js test/tree.behavior.test.js
git commit -m "fix(new-todos): complete hide-on-base-branch rollout"
```

Skip this commit if Step 2 made no changes.

---

## Self-Review

- Spec coverage:
  - Current-branch detection in `src/git.js`: Task 1.
  - Real-repo current-branch and on-base-branch coverage: Tasks 1-2.
  - New `onBaseBranchRoots` filter state and hide behavior: Task 2.
  - Separate extension scan/status plumbing for `onBaseBranch`: Task 3.
  - Workspace/current-file status copy and tooltip buckets: Task 4.
  - Focused + full-suite verification: Tasks 5-6.
- Placeholder scan:
  - No `TODO`, `TBD`, or “implement later” placeholders remain.
  - Every code-changing step includes concrete code or exact commands.
- Type consistency:
  - New filter API is consistently `isOnBaseBranch(fsPath)`.
  - Status payload field is consistently `onBaseBranch`.
  - `classifyUndiffable(fsPath)` remains limited to `no-repo`, `diff-failed`, and `no-branch`.
