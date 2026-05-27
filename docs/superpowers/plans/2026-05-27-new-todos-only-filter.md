# New-Todos-Only Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "show only TODOs on lines changed vs a git base branch" mode to better-todo-tree, filtering matches at insertion time (Option B).

**Architecture:** A new `src/newTodoFilter.js` module owns a git-diff line-ranges cache (`Map<absPath, [[startLine,count],...]>`) and a sync predicate `isNewTodo(fsPath, line)`. The cache is rebuilt (async, via `git.js`) at rebuild start, on branch change, and on `.git` state changes. The scan and incremental-refresh paths in `extension.js` filter their `results` arrays through the predicate just before `replaceSearchResults`, so both full scans and per-file save-rescans stay consistent with no full-store sweep and no flash.

**Tech Stack:** Node.js, VS Code Extension API, QUnit tests (`test/*.behavior.test.js`, run via `npm test`), dependency injection via `test/moduleHelpers.js` `loadWithStubs`.

---

## Key facts (verified against the codebase)

- Match objects reaching the store have a **1-based `line`** field (`detection.js` sets `line: tagStart.line + 1`; `tree.js` does `result.line - 1` for display). Git diff hunk line numbers are also **1-based**. No off-by-one reconciliation needed.
- `git.js` from todo-tree commit `2566703` ports verbatim; its `getChangedFilesAndLines` returns `Map<relPath, [[startLine, count],...]>` and is the only git-touching code.
- All match insertions funnel through `extension.js` `replaceSearchResults(uri, results, store)`.
  - Full scan candidate path: `scanWorkspaceCandidates`, `.then(function(results){...})` (~line 2029).
  - Full scan regex path: `scanWorkspaceRegexMatches`, `.then(function(results){...})` (~line 2145).
  - Incremental: `refreshTextDocumentResults` (~line 1892), `refreshNotebookResults` (~line 1918).
- Commands are dual-registered via `registerCommandPair(suffix, handler)` (extension.js ~line 245); suffixes live in `commandSuffixes` array in `extensionIdentity.js` (~line 16).
- Context keys are set via `queueExtensionContextUpdates([{suffix, value}])` inside `setButtonsAndContext` (extension.js ~line 2489); suffixes live in `contextSuffixes` array in `extensionIdentity.js` (~line 64).
- Settings are read via `config`-level helpers calling `identity.getSetting(setting, default)`, which resolves `better-todo-tree.*` then `todo-tree.*` then default.
- `rebuild()` (extension.js ~line 2357) coalesces concurrent scans via `scanInFlight`/`pendingRescan`. `executeRebuild()` (~line 2289) sets `searchList = getWorkspaceSearchRoots()` then calls `iterateSearchList`.

---

## File Structure

- **Create** `src/git.js` — verbatim port; spawns `git diff`, parses hunks into line ranges. One responsibility: produce `Map<relPath,[[start,count]]>`.
- **Create** `src/newTodoFilter.js` — owns cache + predicate + async refresh. One responsibility: answer "is this match a new todo?" and maintain the cache.
- **Create** `test/git.behavior.test.js` — unit tests for hunk parsing.
- **Create** `test/newTodoFilter.behavior.test.js` — unit tests for predicate + refresh.
- **Modify** `src/config.js` — add `shouldShowNewTodosOnly()`, `newTodosGitBaseBranch()`, `shouldPassGlobsToGitDiff()` helpers + exports.
- **Modify** `src/extensionIdentity.js` — add command suffixes (`toggleNewTodosOnly`, `newTodosChangeBranch`) and context suffix (`show-toggle-new-todos-only-button`).
- **Modify** `src/extension.js` — init module; `applyNewTodoFilterToResults` helper; 4 insertion sites; refresh at rebuild start; 2 commands; button context; `.git` watcher.
- **Modify** `package.json` — settings, commands, menus, button keybinding contexts (both namespaces).
- **Modify** `package.nls.json` — strings.

---

## Task 1: Port `git.js`

**Files:**
- Create: `src/git.js`
- Test: `test/git.behavior.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/git.behavior.test.js
var helpers = require( './moduleHelpers.js' );

function loadGitWithStubbedSpawn( stdoutLines, stderrData )
{
    var EventEmitter = require( 'events' ).EventEmitter;
    var Readable = require( 'stream' ).Readable;

    return helpers.loadWithStubs( '../src/git.js', {
        child_process: {
            spawn: function()
            {
                var proc = new EventEmitter();
                proc.stdout = Readable.from( stdoutLines.map( function( l ) { return l + "\n"; } ) );
                proc.stderr = new EventEmitter();
                if( stderrData !== undefined )
                {
                    setImmediate( function() { proc.stderr.emit( 'data', stderrData ); } );
                }
                return proc;
            }
        }
    } );
}

QUnit.module( 'behavioral git' );

QUnit.test( 'parses diff hunks into [startLine, count] ranges keyed by file', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( [
        'diff --git a.js a.js',
        '@@ -1,0 +5,3 @@',
        '@@ -10,2 +20 @@'
    ] );
    git.init( function() {} );

    git.getChangedFilesAndLines( 'main', '/repo', [], [] ).then( function( map )
    {
        assert.deepEqual( map.get( 'a.js' ), [ [ 5, 3 ], [ 20, 1 ] ], 'two hunks, default count 1' );
        done();
    } );
} );

QUnit.test( 'rejects when base branch or repo path missing', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( [] );
    git.init( function() {} );
    git.getChangedFilesAndLines( '', '/repo', [], [] ).catch( function( err )
    {
        assert.ok( /required/i.test( err.message ), 'rejects with required-args error' );
        done();
    } );
} );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx qunit test/git.behavior.test.js`
Expected: FAIL — cannot find module `../src/git.js`.

- [ ] **Step 3: Create `src/git.js` (verbatim port from todo-tree commit 2566703)**

```js
const { spawn } = require( 'child_process' );
const readline = require( 'readline' );

var debug;

function init( debug_ )
{
    debug = debug_;
}

function getChangedFilesAndLines( baseBranch, repoPath, includeGlobs, excludeGlobs )
{
    if( !baseBranch || !repoPath )
    {
        return Promise.reject( new Error( 'Base branch and repository path are required.' ) );
    }

    return new Promise( ( resolve, reject ) =>
    {
        const lineRanges = new Map();

        let globArgs = [];
        if( ( includeGlobs.length + excludeGlobs.length ) > 0 )
        {
            globArgs.push( '--' );
            includeGlobs.forEach( element => { globArgs.push( `:(glob)${element}` ); } );
            excludeGlobs.forEach( element => { globArgs.push( `:(exclude)${element}` ); } );
        }

        const args = [ 'diff', baseBranch, '--unified=0', '--no-ext-diff', '--no-prefix', ...globArgs ];
        debug( `Git diff args: ${args}` );
        const gitDiff = spawn( 'git', args, { cwd: repoPath } );

        let currentFile = null;
        let currentFileLines = [];

        const rl = readline.createInterface( { input: gitDiff.stdout, crlfDelay: Infinity } );

        rl.on( 'line', ( line ) =>
        {
            if( line.startsWith( 'diff --git ' ) )
            {
                if( currentFile && currentFileLines.length > 0 )
                {
                    lineRanges.set( currentFile, currentFileLines );
                }
                const parts = line.substring( 'diff --git '.length ).split( ' ' );
                currentFile = parts[ 0 ].trim();
                currentFileLines = [];
            }
            else if( line.startsWith( '@@ ' ) && currentFile )
            {
                const match = line.match( /@@ -[\d,]+ \+(\d+)(?:,(\d+))?/ );
                if( match )
                {
                    currentFileLines.push( [ parseInt( match[ 1 ] ), parseInt( match[ 2 ] || 1 ) ] );
                }
            }
        } );

        rl.on( 'close', () =>
        {
            if( currentFile && currentFileLines.length > 0 )
            {
                lineRanges.set( currentFile, currentFileLines );
            }
            resolve( lineRanges );
        } );

        gitDiff.stderr.on( 'data', ( data ) =>
        {
            reject( new Error( `Git diff stderr: ${data}` ) );
        } );

        gitDiff.on( 'error', ( error ) => { reject( error ); } );
    } );
}

module.exports.init = init;
module.exports.getChangedFilesAndLines = getChangedFilesAndLines;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx qunit test/git.behavior.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/git.js test/git.behavior.test.js
git commit -m "feat: add git diff line-range parser (ported from todo-tree)"
```

---

## Task 2: Create `newTodoFilter.js` predicate

**Files:**
- Create: `src/newTodoFilter.js`
- Test: `test/newTodoFilter.behavior.test.js`

- [ ] **Step 1: Write the failing test for `isNewTodo`**

```js
// test/newTodoFilter.behavior.test.js
var path = require( 'path' );
var helpers = require( './moduleHelpers.js' );

function loadFilter( gitStub )
{
    return helpers.loadWithStubs( '../src/newTodoFilter.js', {
        './git.js': gitStub || { init: function() {}, getChangedFilesAndLines: function() { return Promise.resolve( new Map() ); } }
    } );
}

QUnit.module( 'behavioral newTodoFilter' );

QUnit.test( 'isNewTodo: absent file returns false (unchanged file dropped)', function( assert )
{
    var f = loadFilter();
    f.init( function() {} );
    assert.equal( f.isNewTodo( '/repo/unchanged.js', 5 ), false );
} );

QUnit.test( 'isNewTodo: line inside a range returns true, outside returns false', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function() { return Promise.resolve( new Map( [ [ 'a.js', [ [ 5, 3 ] ] ] ] ) ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( 'main', [ '/repo' ], { include: [], exclude: [] } ).then( function()
    {
        var p = path.join( '/repo', 'a.js' );
        assert.equal( f.isNewTodo( p, 4 ), false, 'line before range' );
        assert.equal( f.isNewTodo( p, 5 ), true, 'range start' );
        assert.equal( f.isNewTodo( p, 7 ), true, 'range end (5 + 3 - 1)' );
        assert.equal( f.isNewTodo( p, 8 ), false, 'line after range' );
        done();
    } );
} );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx qunit test/newTodoFilter.behavior.test.js`
Expected: FAIL — cannot find module `../src/newTodoFilter.js`.

- [ ] **Step 3: Create `src/newTodoFilter.js` (predicate + state only; refresh stubbed in next task)**

```js
var path = require( 'path' );
var git = require( './git.js' );

var debug = function() {};
var enabled = false;
var baseBranch = '';
var rangesByPath = new Map();

function init( debug_ )
{
    debug = debug_ || function() {};
    git.init( debug );
}

function isEnabled()
{
    return enabled;
}

function setEnabled( value )
{
    enabled = value === true;
}

function isNewTodo( fsPath, line )
{
    var ranges = rangesByPath.get( fsPath );
    if( !ranges )
    {
        return false;
    }
    return ranges.some( function( range )
    {
        var end = range[ 0 ] + ( range[ 1 ] - 1 );
        return line >= range[ 0 ] && line <= end;
    } );
}

function refresh( branch, roots, globs )
{
    baseBranch = branch;

    if( enabled !== true || !branch || !roots || roots.length === 0 )
    {
        rangesByPath = new Map();
        return Promise.resolve();
    }

    var include = ( globs && globs.include ) || [];
    var exclude = ( globs && globs.exclude ) || [];

    return Promise.all( roots.map( function( root )
    {
        return git.getChangedFilesAndLines( branch, root, include, exclude )
            .then( function( map ) { return { root: root, map: map, ok: true }; } )
            .catch( function( error )
            {
                debug( 'newTodoFilter: diff failed for ' + root + ': ' + error.message );
                return { root: root, map: new Map(), ok: false };
            } );
    } ) ).then( function( results )
    {
        var next = new Map();
        results.forEach( function( result )
        {
            result.map.forEach( function( lines, relPath )
            {
                next.set( path.join( result.root, relPath ), lines );
            } );
        } );
        rangesByPath = next;
        return { allFailed: results.length > 0 && results.every( function( r ) { return r.ok === false; } ) };
    } );
}

module.exports.init = init;
module.exports.isEnabled = isEnabled;
module.exports.setEnabled = setEnabled;
module.exports.isNewTodo = isNewTodo;
module.exports.refresh = refresh;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx qunit test/newTodoFilter.behavior.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/newTodoFilter.js test/newTodoFilter.behavior.test.js
git commit -m "feat: add newTodoFilter predicate and cache"
```

---

## Task 3: `newTodoFilter.refresh` edge cases

**Files:**
- Modify: `test/newTodoFilter.behavior.test.js`

(Implementation already written in Task 2; these tests pin the documented edge-case behaviour.)

- [ ] **Step 1: Add failing tests**

```js
QUnit.test( 'refresh: disabled produces empty map', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function() { return Promise.resolve( new Map( [ [ 'a.js', [ [ 1, 1 ] ] ] ] ) ); }
    } );
    f.init( function() {} );
    f.setEnabled( false );
    f.refresh( 'main', [ '/repo' ], { include: [], exclude: [] } ).then( function()
    {
        assert.equal( f.isNewTodo( path.join( '/repo', 'a.js' ), 1 ), false, 'disabled => no ranges' );
        done();
    } );
} );

QUnit.test( 'refresh: one failing root does not discard another root, reports allFailed=false', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function( branch, root )
        {
            if( root === '/bad' ) { return Promise.reject( new Error( 'not a repo' ) ); }
            return Promise.resolve( new Map( [ [ 'good.js', [ [ 2, 1 ] ] ] ] ) );
        }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( 'main', [ '/good', '/bad' ], { include: [], exclude: [] } ).then( function( summary )
    {
        assert.equal( f.isNewTodo( path.join( '/good', 'good.js' ), 2 ), true, 'good root preserved' );
        assert.equal( summary.allFailed, false, 'not all failed' );
        done();
    } );
} );

QUnit.test( 'refresh: all roots failing reports allFailed=true', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function() { return Promise.reject( new Error( 'bad branch' ) ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( 'nope', [ '/a', '/b' ], { include: [], exclude: [] } ).then( function( summary )
    {
        assert.equal( summary.allFailed, true, 'all roots failed' );
        done();
    } );
} );
```

- [ ] **Step 2: Run tests**

Run: `npx qunit test/newTodoFilter.behavior.test.js`
Expected: PASS (5 tests total). If any fail, fix `refresh` in `src/newTodoFilter.js` to match.

- [ ] **Step 3: Commit**

```bash
git add test/newTodoFilter.behavior.test.js
git commit -m "test: cover newTodoFilter refresh edge cases"
```

---

## Task 4: Config helpers

**Files:**
- Modify: `src/config.js` (add functions before the `module.exports` block, ~line 320; add exports in the exports block)

- [ ] **Step 1: Write the failing test**

```js
// append to test/config.behavior.test.js, inside the existing 'behavioral config' module

QUnit.test( 'newTodosGitBaseBranch returns the configured setting default', function( assert )
{
    var config = loadConfigModule();
    config.init( { workspaceState: { get: function( k, d ) { return d; } } } );
    assert.equal( config.newTodosGitBaseBranch(), '', 'defaults to empty string' );
} );

QUnit.test( 'shouldShowNewTodosOnly reads workspaceState newTodosOnly', function( assert )
{
    var config = loadConfigModule();
    config.init( { workspaceState: { get: function( key, d ) { return key === 'newTodosOnly' ? true : d; } } } );
    assert.equal( config.shouldShowNewTodosOnly(), true );
} );
```

Note: `loadConfigModule` stubs `./extensionIdentity.js` `getSetting` to return the default. `newTodosGitBaseBranch` default is `''`; `shouldShowNewTodosOnly` reads `context.workspaceState.get('newTodosOnly', identity.getSetting('filtering.newTodosOnly', false))`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx qunit test/config.behavior.test.js`
Expected: FAIL — `config.newTodosGitBaseBranch is not a function`.

- [ ] **Step 3: Add helpers to `src/config.js`**

Add before the `module.exports` block:

```js
function newTodosGitBaseBranch()
{
    return identity.getSetting( 'filtering.newTodosGitBaseBranch', '' );
}

function shouldShowNewTodosOnly()
{
    return context.workspaceState.get( 'newTodosOnly', identity.getSetting( 'filtering.newTodosOnly', false ) );
}

function shouldPassGlobsToGitDiff()
{
    return identity.getSetting( 'filtering.passGlobsToGitDiff', true );
}
```

Add to the exports block:

```js
module.exports.newTodosGitBaseBranch = newTodosGitBaseBranch;
module.exports.shouldShowNewTodosOnly = shouldShowNewTodosOnly;
module.exports.shouldPassGlobsToGitDiff = shouldPassGlobsToGitDiff;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx qunit test/config.behavior.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.behavior.test.js
git commit -m "feat: add new-todos config helpers"
```

---

## Task 5: Register command + context suffixes in identity

**Files:**
- Modify: `src/extensionIdentity.js` (`commandSuffixes` ~line 16, `contextSuffixes` ~line 64)

- [ ] **Step 1: Add command suffixes**

In the `commandSuffixes` array, after `'toggleCompactFolders',` add:

```js
    'toggleNewTodosOnly',
    'newTodosChangeBranch',
```

- [ ] **Step 2: Add context suffix**

In the `contextSuffixes` array, after `'show-export-button',` add:

```js
    'show-toggle-new-todos-only-button',
```

- [ ] **Step 3: Verify nothing breaks**

Run: `npm test`
Expected: PASS (existing suite still green; new suffixes are additive).

- [ ] **Step 4: Commit**

```bash
git add src/extensionIdentity.js
git commit -m "feat: register new-todos command and context suffixes"
```

---

## Task 6: Wire predicate into scan + refresh paths

**Files:**
- Modify: `src/extension.js`

- [ ] **Step 1: Add the require and init**

Near the other requires (after `var searchResults = require( './searchResults.js' );`, ~line 20):

```js
var newTodoFilter = require( './newTodoFilter.js' );
```

In `activate`, after `utils.init( config );` (~line 268), add:

```js
    newTodoFilter.init( debug );
    newTodoFilter.setEnabled( config.shouldShowNewTodosOnly() === true );
```

- [ ] **Step 2: Add the helper**

Add near `applyGlobs` (before it, ~line 2189):

```js
    function applyNewTodoFilterToResults( uri, results )
    {
        if( newTodoFilter.isEnabled() !== true )
        {
            return results;
        }
        return results.filter( function( result )
        {
            return newTodoFilter.isNewTodo( uri.fsPath, result.line );
        } );
    }
```

- [ ] **Step 3: Insert at the three result sites**

In `scanWorkspaceCandidates` `.then( function( results )` (~line 2029), change:

```js
                    assertGenerationActive( generation );
                    replaceSearchResults( uri, results, store );
```
to:
```js
                    assertGenerationActive( generation );
                    replaceSearchResults( uri, applyNewTodoFilterToResults( uri, results ), store );
```

In `scanWorkspaceRegexMatches` `.then( function( results )` (~line 2148), apply the identical change (`replaceSearchResults( uri, applyNewTodoFilterToResults( uri, results ), store )`).

In `refreshTextDocumentResults` (~line 1892), change the final line:

```js
        replaceSearchResults( document.uri, getDocumentScanResults( document ), store );
```
to:
```js
        replaceSearchResults( document.uri, applyNewTodoFilterToResults( document.uri, getDocumentScanResults( document ) ), store );
```

In `refreshNotebookResults` (~line 1918), change:

```js
        replaceSearchResults( notebook.uri, scanNotebookDocument( notebook ), store );
```
to:
```js
        replaceSearchResults( notebook.uri, applyNewTodoFilterToResults( notebook.uri, scanNotebookDocument( notebook ) ), store );
```

- [ ] **Step 4: Verify the build/test suite still passes**

Run: `npm test`
Expected: PASS — the helper is a no-op while `isEnabled()` is false, so existing scan-parity tests are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/extension.js
git commit -m "feat: filter scan and refresh results through newTodoFilter"
```

---

## Task 7: Refresh the cache at rebuild start + getGlobs helper

**Files:**
- Modify: `src/extension.js` (`executeRebuild` ~line 2289)

- [ ] **Step 1: Add a `getGitDiffGlobs` helper**

Add near `applyNewTodoFilterToResults`:

```js
    function getGitDiffGlobs()
    {
        if( config.shouldPassGlobsToGitDiff() !== true )
        {
            return { include: [], exclude: [] };
        }

        var includeGlobs = []
            .concat( getSetting( 'filtering.includeGlobs', [] ) )
            .concat( context.workspaceState.get( 'includeGlobs' ) || [] );
        var excludeGlobs = []
            .concat( getSetting( 'filtering.excludeGlobs', [] ) )
            .concat( context.workspaceState.get( 'excludeGlobs' ) || [] );

        if( config.shouldUseBuiltInFileExcludes() )
        {
            excludeGlobs = addGlobs( vscode.workspace.getConfiguration( 'files.exclude' ), excludeGlobs );
        }
        if( config.shouldUseBuiltInSearchExcludes() )
        {
            excludeGlobs = addGlobs( vscode.workspace.getConfiguration( 'search.exclude' ), excludeGlobs );
        }

        return { include: includeGlobs, exclude: excludeGlobs };
    }
```

(Reuses the existing `addGlobs` helper already present in `extension.js`, used by `isIncluded`.)

- [ ] **Step 2: Await refresh before scanning**

In `executeRebuild` (~line 2306), change:

```js
        return iterateSearchList( generation, nextSearchResults ).then( function()
```
to:
```js
        newTodoFilter.setEnabled( config.shouldShowNewTodosOnly() === true );
        return newTodoFilter.refresh( config.newTodosGitBaseBranch(), searchList, getGitDiffGlobs() ).then( function( summary )
        {
            if( summary && summary.allFailed === true && newTodoFilter.isEnabled() === true )
            {
                vscode.window.showWarningMessage( identity.DISPLAY_NAME + ": could not compute git diff for new-todos filter (check base branch '" + config.newTodosGitBaseBranch() + "')" );
            }
            return iterateSearchList( generation, nextSearchResults );
        } ).then( function()
```

(The rest of the existing `.then` body and the trailing `.catch` are unchanged. Verify the closing braces still balance after the edit.)

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: PASS — with the feature off (`shouldShowNewTodosOnly` false by default), `refresh` returns an empty map immediately and `iterateSearchList` runs as before.

- [ ] **Step 4: Manual smoke test**

```
code --extensionDevelopmentPath=$(pwd)
```
Open a git repo, confirm the tree still populates normally (feature off).

- [ ] **Step 5: Commit**

```bash
git add src/extension.js
git commit -m "feat: refresh new-todo diff cache at rebuild start"
```

---

## Task 8: Toggle + change-branch commands

**Files:**
- Modify: `src/extension.js` (command registrations, near the other `registerCommandPair` calls ~line 3573)

- [ ] **Step 1: Register the two commands**

After the `registerCommandPair( 'toggleCompactFolders', ... )` block (~line 3585), add:

```js
        function promptForNewTodosBranch()
        {
            var current = config.newTodosGitBaseBranch();
            return vscode.window.showInputBox( { prompt: "Git branch / revision to diff against", value: current } ).then( function( branch )
            {
                if( !branch )
                {
                    return false;
                }
                debug( "Setting newTodosGitBaseBranch to " + branch );
                return identity.updateSetting( 'filtering.newTodosGitBaseBranch', branch, vscode.ConfigurationTarget.Workspace ).then( function() { return true; } );
            } );
        }

        registerCommandPair( 'toggleNewTodosOnly', function()
        {
            var current = config.shouldShowNewTodosOnly();
            var turningOn = !current;

            // Turning on with no base branch configured: prompt first (spec: error handling).
            if( turningOn === true && !config.newTodosGitBaseBranch() )
            {
                promptForNewTodosBranch().then( function( didSet )
                {
                    if( didSet !== true )
                    {
                        return;
                    }
                    newTodoFilter.setEnabled( true );
                    context.workspaceState.update( 'newTodosOnly', true ).then( rebuild );
                } );
                return;
            }

            newTodoFilter.setEnabled( turningOn );
            context.workspaceState.update( 'newTodosOnly', turningOn ).then( rebuild );
        } );

        registerCommandPair( 'newTodosChangeBranch', function()
        {
            promptForNewTodosBranch().then( function( didSet )
            {
                if( didSet === true )
                {
                    rebuild();
                }
            } );
        } );
```

Note: `identity.updateSetting( setting, value, target, uri )` is confirmed present (writes to `CURRENT_NAMESPACE`).

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Launch extension dev host, run command palette → "Better Todo Tree: Toggle New Todos Only"; confirm the tree filters to only todos on changed lines; run "...: Change Branch", enter a branch, confirm re-filter; toggle off, confirm all todos return.

- [ ] **Step 4: Commit**

```bash
git add src/extension.js
git commit -m "feat: add toggleNewTodosOnly and newTodosChangeBranch commands"
```

---

## Task 9: Button context key

**Files:**
- Modify: `src/extension.js` (`setButtonsAndContext` ~line 2480 and ~line 2498)

- [ ] **Step 1: Read the button setting**

After `var showExportButton = treeButtons.export === true;` (~line 2480) add:

```js
        var showToggleNewTodosOnlyButton = treeButtons.toggleNewTodosOnly === true;
```

- [ ] **Step 2: Add the context update**

In the `queueExtensionContextUpdates([...])` array, after `{ suffix: 'show-export-button', value: showExportButton },` (~line 2498) add:

```js
            { suffix: 'show-toggle-new-todos-only-button', value: showToggleNewTodosOnlyButton },
```

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/extension.js
git commit -m "feat: expose toggle-new-todos-only button context key"
```

---

## Task 10: `.git` state watcher

**Files:**
- Modify: `src/extension.js` (in `activate`, near other `context.subscriptions.push` of watchers)

- [ ] **Step 1: Add a debounced watcher**

In `activate`, after the existing configuration/watcher setup, add:

```js
    var gitStateRefreshTimer;
    function scheduleGitStateRescan()
    {
        if( newTodoFilter.isEnabled() !== true )
        {
            return;
        }
        clearTimeout( gitStateRefreshTimer );
        gitStateRefreshTimer = setTimeout( rebuild, 300 );
    }

    var gitHeadWatcher = vscode.workspace.createFileSystemWatcher( '**/.git/HEAD' );
    var gitRefsWatcher = vscode.workspace.createFileSystemWatcher( '**/.git/refs/**' );
    [ gitHeadWatcher, gitRefsWatcher ].forEach( function( watcher )
    {
        watcher.onDidChange( scheduleGitStateRescan );
        watcher.onDidCreate( scheduleGitStateRescan );
        watcher.onDidDelete( scheduleGitStateRescan );
        context.subscriptions.push( watcher );
    } );
```

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

With the feature on, switch git branches in the terminal; confirm the tree auto-refreshes within ~0.3s. With the feature off, switching branches triggers no rescan.

- [ ] **Step 4: Commit**

```bash
git add src/extension.js
git commit -m "feat: auto-refresh new-todo filter on git state changes"
```

---

## Task 11: Manifest — settings, commands, menus, button

**Files:**
- Modify: `package.json`
- Modify: `package.nls.json`

- [ ] **Step 1: Add settings (both namespaces)**

In `contributes.configuration` properties, add under both the `better-todo-tree.*` and `todo-tree.*` blocks (mirror how `filtering.includeGlobs` is dual-declared):

```json
"<ns>.filtering.newTodosGitBaseBranch": {
    "type": "string",
    "default": "",
    "markdownDescription": "%newTodosGitBaseBranch.description%",
    "scope": "resource"
},
"<ns>.filtering.passGlobsToGitDiff": {
    "type": "boolean",
    "default": true,
    "markdownDescription": "%passGlobsToGitDiff.description%",
    "scope": "resource"
}
```

And add `toggleNewTodosOnly` to the existing `<ns>.tree.buttons` object's `properties` (alongside `refresh`, `expand`, `export`):

```json
"toggleNewTodosOnly": { "type": "boolean", "default": false, "markdownDescription": "%treeButtons.toggleNewTodosOnly%" }
```

Replace `<ns>` with each of `better-todo-tree` and `todo-tree`.

- [ ] **Step 2: Add commands**

In `contributes.commands`, add (mirror an existing dual-registered command's `title`/`category`/`icon` shape):

```json
{ "command": "better-todo-tree.toggleNewTodosOnly", "title": "%better-todo-tree.command.toggleNewTodosOnly.title%", "category": "%better-todo-tree.command.category%", "icon": "$(git-pull-request)" },
{ "command": "better-todo-tree.newTodosChangeBranch", "title": "%better-todo-tree.command.newTodosChangeBranch.title%", "category": "%better-todo-tree.command.category%" }
```

(Legacy `todo-tree.*` aliases are registered at runtime via `registerCommandPair`; the manifest only needs the public `better-todo-tree.*` entries. Match the `category`/`icon` shape of an existing command like `better-todo-tree.refresh`.)

- [ ] **Step 3: Add the view title menu button**

In `contributes.menus."view/title"` (the array starts ~line 81; existing groups run `navigation@1`..`navigation@9`), add as a new highest group so it sits at the end of the toolbar:

```json
{ "command": "better-todo-tree.toggleNewTodosOnly", "when": "view == todo-tree-view && better-todo-tree-show-toggle-new-todos-only-button", "group": "navigation@10" }
```

- [ ] **Step 4: Add NLS strings**

In `package.nls.json`:

```json
"newTodosGitBaseBranch.description": "Git branch or revision to diff against when 'new todos only' mode is enabled. Only TODOs on lines changed relative to this ref are shown.",
"passGlobsToGitDiff.description": "Apply the configured include/exclude globs to the git diff used by 'new todos only' mode.",
"treeButtons.toggleNewTodosOnly": "Show a tree view button to toggle 'new todos only' mode.",
"better-todo-tree.command.toggleNewTodosOnly.title": "Toggle New Todos Only",
"better-todo-tree.command.newTodosChangeBranch.title": "New Todos: Change Base Branch"
```

Use whatever `markdownDescription`/`%...%` key names the `<ns>.filtering.*` settings in Step 1 reference (keep them consistent between `package.json` and `package.nls.json`). The two `command.*.title` keys above must exactly match the `title` values used in Step 2.

- [ ] **Step 5: Validate JSON + run tests**

Run: `node -e "require('./package.json'); require('./package.nls.json'); console.log('ok')"`
Expected: prints `ok` (no JSON parse error).

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package.nls.json
git commit -m "feat: manifest entries for new-todos-only filter"
```

---

## Task 12: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS (all suites, including new `git` and `newTodoFilter` modules).

- [ ] **Step 2: Package the extension**

Run: `npx vsce package` (or `just` target if defined)
Expected: produces a `.vsix` with no manifest errors.

- [ ] **Step 3: Manual acceptance in dev host**

In a multi-folder git workspace, with a feature branch that adds some TODOs:
- Toggle on → only TODOs on changed lines appear, across all folders.
- Edit a file, add a TODO on a changed line, save → it appears (incremental path filtered).
- Add a TODO on an unchanged line, save → it does NOT appear.
- Change base branch via command → tree re-filters.
- Switch git branch in terminal → tree auto-refreshes (~0.3s).
- Toggle off → all TODOs return.
- Set base branch to a non-existent ref, toggle on → single warning shown, tree empties gracefully.

- [ ] **Step 4: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end verification"
```

---

## Notes / risks

- **Notebook line semantics:** `.ipynb` matches degrade to "dropped" if line numbers don't align with the diff — acceptable per spec, not a crash.
- **`addGlobs` reuse (Task 7):** confirm `addGlobs` is in scope where `getGitDiffGlobs` is defined (it's a closure inside `activate`, same as `isIncluded`).
