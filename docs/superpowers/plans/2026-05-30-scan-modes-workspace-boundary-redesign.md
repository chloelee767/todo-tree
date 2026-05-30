# New-Todos-Only Filter across scan modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the new-todos-only filter work in every scan mode, encode the workspace boundary as a fifth scan mode, and surface undiffable files with a fail-open/fail-closed setting.

**Architecture:** Two orthogonal axes. **Boundary axis** (is a file inside the workspace?) is enforced in `extension.js` at scan-target enumeration and encoded as the scan mode. **Diffability axis** (can the file be git-diffed?) lives in `newTodoFilter.js`: it tracks covered/failed repo roots, decides each file by its owning (innermost) repo via longest-prefix match, and supports fail-open/fail-closed. Repo discovery happens before filtering (eager seed from scan targets + lazy per-file backfill); the `isNewTodo` predicate stays pure and sync.

**Tech Stack:** Node.js, VS Code Extension API, QUnit tests (`test/*.behavior.test.js`), git CLI via `child_process.spawn`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/git.js` | git CLI wrappers (diff, repo-root, untracked) | Add `findRepoRoot`, `getUntrackedFiles` |
| `src/newTodoFilter.js` | diffability state + `isNewTodo` predicate | Add covered/failed roots, owning-root resolution, fail-open, untracked sentinels, `extendForRepo` |
| `src/extension.js` | scan orchestration, boundary enforcement, repo seeding/backfill, status counts, decorations | New scan-mode constant, `collectDiffRoots`, `revParseCache`, `ensureRepoForFile`, await-before-write wiring, `FileDecorationProvider` |
| `src/config.js` | settings accessors | Add `newTodosShowUndiffableFiles`, `newTodosGitTimeoutMs` |
| `src/tree.js` | tree rendering, status node, todo-node dimming | Combined status node, todo-node dimming (sets `resourceUri`; no reason tooltip) |
| `package.json` | enum + settings + menus | New enum value, two new `filtering.*` settings, menu `when` audit, new command |
| `package.nls.json` | labels | Five scan-mode `markdownEnumDescriptions` |

**Build/test commands:** Tests run with `npm test` (alias for `qunit`). Run a single file with `npx qunit test/<file>.test.js`. Run all with `npm test`.

---

## Task ordering rationale

1. **Tasks 1-3** build the diffability foundation in `git.js` / `newTodoFilter.js` (pure logic, no VS Code). Fully testable in isolation.
2. **Tasks 4-6** wire diffability into `extension.js` (seed, backfill, await-before-write). This fixes the "filter broken in current-file/open-files modes" bug.
3. **Tasks 7-9** add the boundary axis: new scan mode, enumeration enforcement, predicate audit, package.json/nls.
4. **Tasks 10-12** add UI: config settings, combined status node, per-node dimming (reason tooltip on file/path-node decorations only).

Each task ends with a commit. Each is independently testable.

---

## Task 1: `git.js` — `findRepoRoot`

**Files:**
- Modify: `src/git.js`
- Test: `test/git.behavior.test.js`

`findRepoRoot(dir)` runs `git -C dir rev-parse --show-toplevel`. Resolves to the canonical repo root string (rev-parse emits forward slashes and resolves symlinks), or `null` on any non-zero exit ("not a git repository"). It must **never reject for the not-a-repo case** — `null` is the signal. It may reject only on spawn `error`.

- [x] **Step 1: Write the failing tests**

Add to `test/git.behavior.test.js`. The existing `loadGitWithStubbedSpawn` helper (lines 1-27) emits stdout lines then `exit` with a code. Reuse it.

```javascript
QUnit.test( 'findRepoRoot: returns repo root on success', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( [ '/repo/root' ], undefined, 0 );
    git.init( function() {} );
    git.findRepoRoot( '/repo/root/src' ).then( function( root )
    {
        assert.equal( root, '/repo/root', 'trimmed toplevel path' );
        done();
    } );
} );

QUnit.test( 'findRepoRoot: returns null when not a git repository', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( [ '' ], 'fatal: not a git repository', 128 );
    git.init( function() {} );
    git.findRepoRoot( '/tmp/notrepo' ).then( function( root )
    {
        assert.equal( root, null, 'null on non-zero exit' );
        done();
    } );
} );
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx qunit test/git.behavior.test.js`
Expected: FAIL with "git.findRepoRoot is not a function".

- [x] **Step 3: Implement `findRepoRoot`**

Add to `src/git.js` after `getChangedFilesAndLines` (before the `module.exports` block at the end). Mirror the existing spawn style.

```javascript
function findRepoRoot( dir )
{
    if( !dir )
    {
        return Promise.resolve( null );
    }

    return new Promise( ( resolve, reject ) =>
    {
        const args = [ '-C', dir, 'rev-parse', '--show-toplevel' ];
        debug( `Git rev-parse args: ${args}` );
        const proc = spawn( 'git', args );

        let stdout = '';
        proc.stdout.on( 'data', ( data ) => { stdout += data; } );
        proc.stderr.on( 'data', () => {} );

        proc.on( 'exit', ( code ) =>
        {
            if( code === 0 )
            {
                resolve( stdout.trim() || null );
            }
            else
            {
                resolve( null );
            }
        } );

        proc.on( 'error', ( error ) => { reject( error ); } );
    } );
}
```

- [x] **Step 4: Export it**

In the `module.exports` block at the end of `src/git.js`, add:

```javascript
module.exports.findRepoRoot = findRepoRoot;
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx qunit test/git.behavior.test.js`
Expected: PASS (all tests, including pre-existing ones).

- [x] **Step 6: Commit**

```bash
git add src/git.js test/git.behavior.test.js
git commit -m "feat(git): add findRepoRoot for owning-repo discovery"
```

---

## Task 2: `git.js` — `getUntrackedFiles`

**Files:**
- Modify: `src/git.js`
- Test: `test/git.behavior.test.js`

`getUntrackedFiles(repoRoot, includeGlobs, excludeGlobs)` runs `git status --porcelain` with the same glob pathspec treatment as `getChangedFilesAndLines`, and returns the relative paths of `??` (untracked) entries. Rejects only on git error.

`git status --porcelain` output lines look like `?? path/to/new.js` (two status chars, a space, then the path). Collect lines starting with `?? `.

- [x] **Step 1: Write the failing tests**

Add to `test/git.behavior.test.js`:

```javascript
QUnit.test( 'getUntrackedFiles: collects ?? entries, ignores tracked', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( [
        '?? newfile.js',
        ' M tracked.js',
        '?? sub/another.js',
        'A  staged.js'
    ], undefined, 0 );
    git.init( function() {} );
    git.getUntrackedFiles( '/repo', [], [] ).then( function( files )
    {
        assert.deepEqual( files, [ 'newfile.js', 'sub/another.js' ], 'only untracked paths' );
        done();
    } );
} );

QUnit.test( 'getUntrackedFiles: rejects on git error', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( [ '' ], 'fatal: bad', 128 );
    git.init( function() {} );
    git.getUntrackedFiles( '/repo', [], [] ).catch( function( err )
    {
        assert.ok( err, 'rejects' );
        done();
    } );
} );
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx qunit test/git.behavior.test.js`
Expected: FAIL with "git.getUntrackedFiles is not a function".

- [x] **Step 3: Implement `getUntrackedFiles`**

Add to `src/git.js` after `findRepoRoot`. Reuse the glob-args construction pattern from `getChangedFilesAndLines` (lines 22-28).

```javascript
function getUntrackedFiles( repoRoot, includeGlobs, excludeGlobs )
{
    if( !repoRoot )
    {
        return Promise.reject( new Error( 'Repository path is required.' ) );
    }

    return new Promise( ( resolve, reject ) =>
    {
        let globArgs = [];
        if( ( includeGlobs.length + excludeGlobs.length ) > 0 )
        {
            globArgs.push( '--' );
            includeGlobs.forEach( element => { globArgs.push( `:(glob)${element}` ); } );
            excludeGlobs.forEach( element => { globArgs.push( `:(exclude)${element}` ); } );
        }

        const args = [ 'status', '--porcelain', ...globArgs ];
        debug( `Git status args: ${args}` );
        const proc = spawn( 'git', args, { cwd: repoRoot } );

        const untracked = [];
        const rl = readline.createInterface( { input: proc.stdout, crlfDelay: Infinity } );
        rl.on( 'line', ( line ) =>
        {
            if( line.startsWith( '?? ' ) )
            {
                untracked.push( line.substring( 3 ) );
            }
        } );

        let stderrBuffer = '';
        proc.stderr.on( 'data', ( data ) => { stderrBuffer += data; } );

        rl.on( 'close', () => {} );

        proc.on( 'exit', ( code ) =>
        {
            if( code !== 0 )
            {
                reject( new Error( `Git status stderr: ${stderrBuffer}` ) );
            }
            else
            {
                resolve( untracked );
            }
        } );

        proc.on( 'error', ( error ) => { reject( error ); } );
    } );
}
```

- [x] **Step 4: Export it**

In `module.exports`:

```javascript
module.exports.getUntrackedFiles = getUntrackedFiles;
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx qunit test/git.behavior.test.js`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/git.js test/git.behavior.test.js
git commit -m "feat(git): add getUntrackedFiles for new-file detection"
```

---

## Task 3: `newTodoFilter.js` — covered/failed roots, owning-root resolution, fail-open, untracked sentinels

**Files:**
- Modify: `src/newTodoFilter.js`
- Test: `test/newTodoFilter.behavior.test.js`

This is the core of the diffability axis. The module gains:
- State: `coveredRoots` (diff succeeded), `failedRoots` (repo exists, diff failed), `showUndiffableFiles` (default `true`).
- An **owning-root resolver**: longest covered-or-failed root that is a path-prefix of `fsPath` (normalized: case-fold on Windows-style paths, separator normalization, trailing-separator boundary — mirroring `isFileInSearchRoots` in `extension.js:1496`).
- A new three-case `isNewTodo`.
- `classifyUndiffable(fsPath) -> 'no-repo' | 'diff-failed' | null`.
- `refresh` now also fetches untracked files and inserts whole-file sentinel ranges `[[1, Infinity]]`, and records covered/failed roots.
- `extendForRepo(repoRoot, branch, globs)` — lazy single-repo diff+status that merges into the live cache.
- `isOwningRepoKnown(repoRoot)`.
- `setShowUndiffableFiles(bool)`.

The untracked sentinel `[1, Infinity]` works with the existing `isNewTodo` range math: `end = 1 + (Infinity - 1) = Infinity`, so any line ≥ 1 matches.

### 3a: State, setter, normalization + owning-root resolver

- [x] **Step 1: Write the failing tests**

Add to `test/newTodoFilter.behavior.test.js`:

```javascript
QUnit.test( 'setShowUndiffableFiles + classifyUndiffable: no-repo when no covering root', function( assert )
{
    var f = loadFilter();
    f.init( function() {} );
    f.setEnabled( true );
    f.setShowUndiffableFiles( true );
    assert.equal( f.classifyUndiffable( '/elsewhere/file.js' ), 'no-repo', 'no covered/failed root' );
} );

QUnit.test( 'owning-root: longest prefix wins (nested covered beats covered ancestor)', function( assert )
{
    var done = assert.async();
    // outer repo diffs (covered), inner repo also diffs (covered), file lives in inner
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function( branch, root )
        {
            if( root === '/outer/inner' ) { return Promise.resolve( new Map( [ [ 'a.js', [ [ 10, 1 ] ] ] ] ) ); }
            return Promise.resolve( new Map() );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( 'main', [ '/outer', '/outer/inner' ], { include: [], exclude: [] } ).then( function()
    {
        // file in inner, line not in any range -> owning root is /outer/inner (covered) -> drop
        assert.equal( f.classifyUndiffable( '/outer/inner/b.js' ), null, 'owning root is covered -> diffable' );
        done();
    } );
} );
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx qunit test/newTodoFilter.behavior.test.js`
Expected: FAIL with "f.setShowUndiffableFiles is not a function".

- [x] **Step 3: Add state + setter + resolver helpers**

In `src/newTodoFilter.js`, extend the module state (after the existing `var rangesByPath = new Map();` at line 7):

```javascript
var coveredRoots = [];
var failedRoots = [];
var showUndiffableFiles = true;
```

Add the normalization + owning-root helpers (place after `setEnabled`, before `isNewTodo`):

```javascript
function normalizePath( p )
{
    var normalized = p.split( '\\' ).join( '/' );
    // Drive-letter / Windows path case-insensitivity; harmless on POSIX paths.
    if( /^[a-zA-Z]:\//.test( normalized ) )
    {
        normalized = normalized.toLowerCase();
    }
    return normalized;
}

function isPrefixRoot( root, fsPath )
{
    var r = normalizePath( root );
    var f = normalizePath( fsPath );
    if( f === r )
    {
        return true;
    }
    var prefix = r.endsWith( '/' ) ? r : r + '/';
    return f.indexOf( prefix ) === 0;
}

function findOwningRoot( fsPath, roots )
{
    var owning = undefined;
    roots.forEach( function( root )
    {
        if( isPrefixRoot( root, fsPath ) )
        {
            if( owning === undefined || root.length > owning.length )
            {
                owning = root;
            }
        }
    } );
    return owning;
}

function setShowUndiffableFiles( value )
{
    showUndiffableFiles = value === true;
}

function classifyUndiffable( fsPath )
{
    if( rangesByPath.get( fsPath ) )
    {
        return null;
    }
    var coveredOwning = findOwningRoot( fsPath, coveredRoots );
    var failedOwning = findOwningRoot( fsPath, failedRoots );
    // Owning repo = innermost = longest prefix across BOTH sets.
    if( coveredOwning !== undefined && ( failedOwning === undefined || coveredOwning.length >= failedOwning.length ) )
    {
        return null; // covered owning repo -> diffable
    }
    if( failedOwning !== undefined )
    {
        return 'diff-failed';
    }
    return 'no-repo';
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx qunit test/newTodoFilter.behavior.test.js`
Expected: PASS (the refresh-dependent test will be wired in 3b; if it fails on `getUntrackedFiles`/`findRepoRoot` not stubbed, that is expected to be addressed in 3b — proceed).

> Note: the second test calls `refresh`, which 3b modifies. If it fails here because `refresh` does not yet read untracked/covered roots, complete 3b before re-running. The first test (`classifyUndiffable` no-repo) must pass now.

- [x] **Step 5: Commit**

```bash
git add src/newTodoFilter.js test/newTodoFilter.behavior.test.js
git commit -m "feat(filter): add covered/failed roots state and owning-root resolver"
```

### 3b: `refresh` records covered/failed roots + untracked sentinels

- [x] **Step 1: Write the failing tests**

Add to `test/newTodoFilter.behavior.test.js`:

```javascript
QUnit.test( 'refresh: covered root recorded; failed diff -> failedRoots; untracked -> whole-file sentinel', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function( branch, root )
        {
            if( root === '/bad' ) { return Promise.reject( new Error( 'no base branch' ) ); }
            return Promise.resolve( new Map( [ [ 'changed.js', [ [ 5, 2 ] ] ] ] ) );
        },
        getUntrackedFiles: function( root )
        {
            if( root === '/good' ) { return Promise.resolve( [ 'brandnew.js' ] ); }
            return Promise.resolve( [] );
        },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( 'main', [ '/good', '/bad' ], { include: [], exclude: [] } ).then( function( summary )
    {
        assert.equal( summary.allFailed, false, 'one root succeeded' );
        assert.equal( f.classifyUndiffable( path.join( '/good', 'unchanged.js' ) ), null, '/good covered' );
        assert.equal( f.classifyUndiffable( path.join( '/bad', 'x.js' ) ), 'diff-failed', '/bad failed' );
        assert.equal( f.isNewTodo( path.join( '/good', 'brandnew.js' ), 999 ), true, 'untracked -> any line new' );
        done();
    } );
} );
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx qunit test/newTodoFilter.behavior.test.js`
Expected: FAIL (`summary.allFailed` wrong or untracked not surfaced).

- [x] **Step 3: Rewrite `refresh`**

Replace the existing `refresh` body (lines 39-74) with:

```javascript
function refresh( branch, roots, globs )
{
    baseBranch = branch;

    if( enabled !== true || !branch || !roots || roots.length === 0 )
    {
        rangesByPath = new Map();
        coveredRoots = [];
        failedRoots = [];
        return Promise.resolve( { allFailed: false } );
    }

    var include = ( globs && globs.include ) || [];
    var exclude = ( globs && globs.exclude ) || [];

    return Promise.all( roots.map( function( root )
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
            return { root: root, map: both[ 0 ].map, ok: both[ 0 ].ok, untracked: both[ 1 ] };
        } );
    } ) ).then( function( results )
    {
        var next = new Map();
        var nextCovered = [];
        var nextFailed = [];
        results.forEach( function( result )
        {
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
        return { allFailed: results.length > 0 && results.every( function( r ) { return r.ok === false; } ) };
    } );
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx qunit test/newTodoFilter.behavior.test.js`
Expected: PASS (including the 3a longest-prefix test now that refresh records covered roots).

- [x] **Step 5: Commit**

```bash
git add src/newTodoFilter.js test/newTodoFilter.behavior.test.js
git commit -m "feat(filter): refresh records covered/failed roots and untracked sentinels"
```

### 3c: New three-case `isNewTodo`

- [x] **Step 1: Write the failing tests**

Add to `test/newTodoFilter.behavior.test.js`:

```javascript
QUnit.test( 'isNewTodo three cases: in-range / unchanged-in-covered / undiffable fail-open vs closed', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function() { return Promise.resolve( new Map( [ [ 'changed.js', [ [ 5, 2 ] ] ] ] ) ); },
        getUntrackedFiles: function() { return Promise.resolve( [] ); },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.setShowUndiffableFiles( true );
    f.refresh( 'main', [ '/repo' ], { include: [], exclude: [] } ).then( function()
    {
        var changed = path.join( '/repo', 'changed.js' );
        var unchanged = path.join( '/repo', 'unchanged.js' );
        var external = '/other/x.js';
        // case 1: has ranges, line inside -> true; outside -> false
        assert.equal( f.isNewTodo( changed, 5 ), true, 'in range' );
        assert.equal( f.isNewTodo( changed, 99 ), false, 'has ranges, line outside' );
        // case 2: no ranges, owning root covered -> drop
        assert.equal( f.isNewTodo( unchanged, 3 ), false, 'unchanged file in covered repo dropped' );
        // case 3: undiffable, fail-open -> keep
        assert.equal( f.isNewTodo( external, 3 ), true, 'undiffable kept under fail-open' );
        // case 3: undiffable, fail-closed -> drop
        f.setShowUndiffableFiles( false );
        assert.equal( f.isNewTodo( external, 3 ), false, 'undiffable dropped under fail-closed' );
        done();
    } );
} );

QUnit.test( 'isNewTodo E9b: failed owning repo under covered ancestor -> fail-open keeps (no ancestor fallback)', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function( branch, root )
        {
            if( root === '/outer/inner' ) { return Promise.reject( new Error( 'no base' ) ); }
            return Promise.resolve( new Map() );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.setShowUndiffableFiles( false );
    f.refresh( 'main', [ '/outer', '/outer/inner' ], { include: [], exclude: [] } ).then( function()
    {
        // owning root is failed /outer/inner -> diff-failed -> fail-closed drops (NOT dropped as "unchanged in covered ancestor")
        assert.equal( f.classifyUndiffable( '/outer/inner/x.js' ), 'diff-failed', 'owning failed repo wins over covered ancestor' );
        assert.equal( f.isNewTodo( '/outer/inner/x.js', 3 ), false, 'fail-closed drops diff-failed file' );
        done();
    } );
} );
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx qunit test/newTodoFilter.behavior.test.js`
Expected: FAIL (current `isNewTodo` returns `false` for absent files unconditionally).

- [x] **Step 3: Rewrite `isNewTodo`**

Replace the existing `isNewTodo` body (lines 25-37) with:

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

    // No ranges: decide by owning root.
    if( classifyUndiffable( fsPath ) === null )
    {
        // Owning root is covered -> genuinely unchanged file -> drop.
        return false;
    }

    // Undiffable (no-repo or diff-failed): fail-open keeps, fail-closed drops.
    return showUndiffableFiles === true;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx qunit test/newTodoFilter.behavior.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/newTodoFilter.js test/newTodoFilter.behavior.test.js
git commit -m "feat(filter): three-case isNewTodo with fail-open/closed for undiffable files"
```

### 3d: `extendForRepo` + `isOwningRepoKnown`

- [x] **Step 1: Write the failing tests**

Add to `test/newTodoFilter.behavior.test.js`:

```javascript
QUnit.test( 'extendForRepo: merges ranges without clobbering, idempotent, routes failure to failedRoots', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function( branch, root )
        {
            if( root === '/r1' ) { return Promise.resolve( new Map( [ [ 'a.js', [ [ 1, 1 ] ] ] ] ) ); }
            if( root === '/r2' ) { return Promise.reject( new Error( 'fail' ) ); }
            return Promise.resolve( new Map() );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( 'main', [ '/r0' ], { include: [], exclude: [] } ).then( function()
    {
        assert.equal( f.isOwningRepoKnown( '/r1' ), false, 'not known before extend' );
        return f.extendForRepo( '/r1', 'main', { include: [], exclude: [] } );
    } ).then( function()
    {
        assert.equal( f.isNewTodo( path.join( '/r1', 'a.js' ), 1 ), true, 'merged range present' );
        assert.equal( f.isOwningRepoKnown( '/r1' ), true, 'known after extend' );
        return f.extendForRepo( '/r2', 'main', { include: [], exclude: [] } );
    } ).then( function()
    {
        assert.equal( f.classifyUndiffable( '/r2/x.js' ), 'diff-failed', 'failed extend -> failedRoots' );
        done();
    } );
} );
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx qunit test/newTodoFilter.behavior.test.js`
Expected: FAIL with "f.extendForRepo is not a function".

- [x] **Step 3: Implement `extendForRepo` + `isOwningRepoKnown`**

Add to `src/newTodoFilter.js` (after `refresh`):

```javascript
function isOwningRepoKnown( repoRoot )
{
    return coveredRoots.indexOf( repoRoot ) !== -1 || failedRoots.indexOf( repoRoot ) !== -1;
}

function extendForRepo( repoRoot, branch, globs )
{
    if( !repoRoot || isOwningRepoKnown( repoRoot ) )
    {
        return Promise.resolve();
    }

    var include = ( globs && globs.include ) || [];
    var exclude = ( globs && globs.exclude ) || [];

    var diffPromise = git.getChangedFilesAndLines( branch, repoRoot, include, exclude )
        .then( function( map ) { return { map: map, ok: true }; } )
        .catch( function( error )
        {
            debug( 'newTodoFilter: extend diff failed for ' + repoRoot + ': ' + error.message );
            return { map: new Map(), ok: false };
        } );
    var untrackedPromise = git.getUntrackedFiles( repoRoot, include, exclude )
        .catch( function() { return []; } );

    return Promise.all( [ diffPromise, untrackedPromise ] ).then( function( both )
    {
        if( isOwningRepoKnown( repoRoot ) )
        {
            return; // another extend resolved first; stay idempotent
        }
        var diff = both[ 0 ];
        var untracked = both[ 1 ];
        diff.map.forEach( function( lines, relPath )
        {
            rangesByPath.set( path.join( repoRoot, relPath ), lines );
        } );
        untracked.forEach( function( relPath )
        {
            rangesByPath.set( path.join( repoRoot, relPath ), [ [ 1, Infinity ] ] );
        } );
        if( diff.ok === true )
        {
            coveredRoots.push( repoRoot );
        }
        else
        {
            failedRoots.push( repoRoot );
        }
    } );
}
```

- [x] **Step 4: Export new functions**

In the `module.exports` block, add:

```javascript
module.exports.setShowUndiffableFiles = setShowUndiffableFiles;
module.exports.classifyUndiffable = classifyUndiffable;
module.exports.extendForRepo = extendForRepo;
module.exports.isOwningRepoKnown = isOwningRepoKnown;
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx qunit test/newTodoFilter.behavior.test.js`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/newTodoFilter.js test/newTodoFilter.behavior.test.js
git commit -m "feat(filter): add extendForRepo and isOwningRepoKnown for lazy repo discovery"
```

---

## Task 4: `config.js` — new settings accessors

**Files:**
- Modify: `src/config.js`
- Test: `test/config.behavior.test.js`

Add `newTodosShowUndiffableFiles()` (default `true`) and `newTodosGitTimeoutMs()` (default `2000`).

- [x] **Step 1: Inspect the existing config test style**

Run: `npx qunit test/config.behavior.test.js`
Expected: PASS (baseline). Open the file to mirror its stubbing of `identity.getSetting`.

- [x] **Step 2: Write the failing tests**

Add to `test/config.behavior.test.js`, mirroring how existing tests there stub `identity` / settings (follow the file's existing pattern for an accessor with a default). Example shape (adapt to the file's actual helper):

```javascript
QUnit.test( 'newTodosShowUndiffableFiles defaults to true', function( assert )
{
    var config = loadConfigWithSettings( {} ); // existing helper in this file
    assert.equal( config.newTodosShowUndiffableFiles(), true );
} );

QUnit.test( 'newTodosGitTimeoutMs defaults to 2000', function( assert )
{
    var config = loadConfigWithSettings( {} );
    assert.equal( config.newTodosGitTimeoutMs(), 2000 );
} );
```

> If `config.behavior.test.js` has no such helper, add the accessors and verify via the new `extension`-level integration tests in later tasks instead; keep these two unit tests only if the helper exists. Do not invent a helper.

- [x] **Step 3: Run tests to verify they fail**

Run: `npx qunit test/config.behavior.test.js`
Expected: FAIL with "config.newTodosShowUndiffableFiles is not a function".

- [x] **Step 4: Implement the accessors**

In `src/config.js`, after `shouldPassGlobsToGitDiff` (line 424):

```javascript
function newTodosShowUndiffableFiles()
{
    return identity.getSetting( 'filtering.newTodosShowUndiffableFiles', true );
}

function newTodosGitTimeoutMs()
{
    return identity.getSetting( 'filtering.newTodosGitTimeoutMs', 2000 );
}
```

Add to the `module.exports` block (after line 469):

```javascript
module.exports.newTodosShowUndiffableFiles = newTodosShowUndiffableFiles;
module.exports.newTodosGitTimeoutMs = newTodosGitTimeoutMs;
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx qunit test/config.behavior.test.js`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/config.js test/config.behavior.test.js
git commit -m "feat(config): add newTodosShowUndiffableFiles and newTodosGitTimeoutMs"
```

---

## Task 5: `extension.js` — `revParseCache` + `collectDiffRoots`, feed into `refresh`

**Files:**
- Modify: `src/extension.js`
- Test: `test/extension.scan-parity.test.js` (or a new `test/diffRoots.behavior.test.js` if extracting `collectDiffRoots` into a testable helper)

`collectDiffRoots()` produces the eager diff-root seed run in `executeRebuild` before `newTodoFilter.refresh`. It is **mode-gated**:
- Workspace-family modes (1 `'workspace only'`, 4 `'workspace'`): seed `getWorkspaceSearchRoots()` PLUS per-scan-target repo roots.
- Open-files/current-file modes (2, 3, 5): NO workspace-root seed; roots come only from scan targets' owning repos.

`revParseCache: Map<dir, repoRoot|null>` is module-level, cleared at the start of each `executeRebuild`.

> **Testability note:** `collectDiffRoots` lives inside the `activate` closure, so it is awkward to unit-test directly. Extract the pure mode-gating + dedupe logic into a small helper that takes `(scanMode, workspaceRoots, targetDirs, revParse)` and returns the deduped roots. This lets the mode-gating be tested without VS Code. The closure `collectDiffRoots` calls this helper.

- [x] **Step 1: Write the failing test for the pure helper**

Create `test/diffRoots.behavior.test.js`:

```javascript
var helpers = require( './moduleHelpers.js' );

function loadExtensionHelpers()
{
    // diffRootsHelper.js is a new pure module (no vscode dependency)
    return require( '../src/diffRootsHelper.js' );
}

QUnit.module( 'behavioral diffRoots' );

QUnit.test( 'collectDiffRootsFrom: workspace-family seeds workspace roots + target repos', function( assert )
{
    var h = loadExtensionHelpers();
    var revParse = { '/ws/sub': '/ws', '/ext/dir': '/ext' };
    var roots = h.collectDiffRootsFrom(
        'workspace',                 // mode 4
        [ '/ws' ],                   // workspace roots
        [ '/ws/sub', '/ext/dir' ],   // target dirs
        function( dir ) { return revParse[ dir ] || null; }
    );
    assert.deepEqual( roots.sort(), [ '/ext', '/ws' ], 'workspace root + external target repo' );
} );

QUnit.test( 'collectDiffRootsFrom: open-files family does NOT seed workspace roots', function( assert )
{
    var h = loadExtensionHelpers();
    var revParse = { '/ws/sub': '/ws' };
    var roots = h.collectDiffRootsFrom(
        'open files',                // mode 3
        [ '/ws' ],                   // workspace roots (must be ignored)
        [ '/ws/sub' ],               // target dir resolves to /ws via rev-parse
        function( dir ) { return revParse[ dir ] || null; }
    );
    assert.deepEqual( roots, [ '/ws' ], 'only the scanned file repo, NOT a rootFolder seed' );
} );

QUnit.test( 'collectDiffRootsFrom: dedupes by normalized path; drops null repos', function( assert )
{
    var h = loadExtensionHelpers();
    var roots = h.collectDiffRootsFrom(
        'open files',
        [],
        [ '/a/1', '/a/2', '/norepo' ],
        function( dir ) { return dir === '/norepo' ? null : '/a'; }
    );
    assert.deepEqual( roots, [ '/a' ], 'two targets in /a dedupe; /norepo dropped' );
} );
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx qunit test/diffRoots.behavior.test.js`
Expected: FAIL with "Cannot find module '../src/diffRootsHelper.js'".

- [x] **Step 3: Create the pure helper module**

Create `src/diffRootsHelper.js`:

```javascript
var WORKSPACE_FAMILY = [ 'workspace', 'workspace only' ];

function isWorkspaceFamily( scanMode )
{
    return WORKSPACE_FAMILY.indexOf( scanMode ) !== -1;
}

function dedupe( roots )
{
    var seen = {};
    var out = [];
    roots.forEach( function( root )
    {
        if( root && seen[ root ] !== true )
        {
            seen[ root ] = true;
            out.push( root );
        }
    } );
    return out;
}

// scanMode: current scan mode id
// workspaceRoots: getWorkspaceSearchRoots() result
// targetDirs: dirname() of each open/current/notebook scan target fsPath
// revParse: function( dir ) -> repoRoot | null   (caller caches)
function collectDiffRootsFrom( scanMode, workspaceRoots, targetDirs, revParse )
{
    var roots = [];
    if( isWorkspaceFamily( scanMode ) )
    {
        roots = roots.concat( workspaceRoots );
    }
    targetDirs.forEach( function( dir )
    {
        var repoRoot = revParse( dir );
        if( repoRoot )
        {
            roots.push( repoRoot );
        }
    } );
    return dedupe( roots );
}

module.exports.isWorkspaceFamily = isWorkspaceFamily;
module.exports.collectDiffRootsFrom = collectDiffRootsFrom;
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx qunit test/diffRoots.behavior.test.js`
Expected: PASS.

- [x] **Step 5: Wire `collectDiffRoots` + `revParseCache` into `extension.js`**

Near the top of the `activate` closure (alongside the scan-mode constants at line 53-56), add the require and cache. At the top of the file with the other requires, add:

```javascript
var diffRootsHelper = require( './diffRootsHelper.js' );
```

Inside the `activate` closure (module-level relative to the closure), add:

```javascript
var revParseCache = new Map();
```

Add a `collectDiffRoots` function (place it near `getGitDiffGlobs` ~line 2204). It resolves each uncached target dir's repo root (caching the result), then builds the diff roots synchronously via the pure helper:

```javascript
function collectDiffRoots( searchList )
{
    var targets = getRefreshTargets( searchList );
    var targetDirs = targets.map( function( target )
    {
        var fsPath = target.uri ? target.uri.fsPath : target.fileName;
        return fsPath ? path.dirname( fsPath ) : undefined;
    } ).filter( function( dir ) { return dir !== undefined; } );

    var uncached = targetDirs.filter( function( dir ) { return !revParseCache.has( dir ); } );
    return Promise.all( uncached.map( function( dir )
    {
        return git.findRepoRoot( dir ).then( function( root )
        {
            revParseCache.set( dir, root );
        } ).catch( function()
        {
            revParseCache.set( dir, null );
        } );
    } ) ).then( function()
    {
        return diffRootsHelper.collectDiffRootsFrom(
            config.scanMode(),
            getWorkspaceSearchRoots(),
            targetDirs,
            function( dir ) { return revParseCache.get( dir ) || null; }
        );
    } );
}
```

Confirm `git` is required in `extension.js` (it is used by `newTodoFilter`; if not directly required, add `var git = require( './git.js' );` near the top).

- [x] **Step 6: Feed `collectDiffRoots` into `refresh` and clear cache in `executeRebuild`**

In `executeRebuild` (lines 2330-2348), at the very start of the function body add:

```javascript
revParseCache.clear();
```

Replace the `newTodoFilter.refresh(...)` call (line 2348) so the diff roots come from `collectDiffRoots` instead of just `searchList`:

```javascript
newTodoFilter.setEnabled( config.shouldShowNewTodosOnly() === true );
newTodoFilter.setShowUndiffableFiles( config.newTodosShowUndiffableFiles() );
return collectDiffRoots( searchList ).then( function( diffRoots )
{
    return newTodoFilter.refresh( config.newTodosGitBaseBranch(), diffRoots, getGitDiffGlobs() );
} ).then( function( summary )
{
    if( summary && summary.allFailed === true && newTodoFilter.isEnabled() === true )
    {
        vscode.window.showWarningMessage( identity.DISPLAY_NAME + ": could not compute git diff for new-todos filter (check base branch '" + config.newTodosGitBaseBranch() + "')" );
    }
    return iterateSearchList( generation, nextSearchResults );
} ).then( function()
```

(The rest of the `.then` chain is unchanged.)

- [x] **Step 7: Run the existing scan-parity + filter tests**

Run: `npx qunit test/extension.scan-parity.test.js test/newTodoFilter.behavior.test.js test/diffRoots.behavior.test.js`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/extension.js src/diffRootsHelper.js test/diffRoots.behavior.test.js
git commit -m "feat(scan): mode-gated diff-root seed (collectDiffRoots) fixes filter in open/current modes"
```

---

## Task 6: `extension.js` — `ensureRepoForFile` + await-before-write wiring + late reconcile

**Files:**
- Modify: `src/extension.js`
- Test: `test/newTodoFilter.behavior.test.js` (timeout/idempotency at the filter layer) + manual/integration

`ensureRepoForFile(fsPath, branch, globs)` guarantees a file's owning repo is discovered and diffed before filtering. Steps:
1. `dir = dirname(fsPath)`; `repoRoot = revParseCache.get(dir) ?? findRepoRoot(dir)` (cache result).
2. `repoRoot === null` → no-op.
3. `isOwningRepoKnown(repoRoot)` → no-op.
4. else `await extendForRepo(...)` raced against `newTodosGitTimeoutMs`. On timeout, resolve anyway (leave repo unknown); schedule a one-file reconcile when the slow extend resolves.

Insertion sites await `ensureRepoForFile` before the first `replaceSearchResults` for that file, guarded behind `newTodoFilter.isEnabled()`.

- [x] **Step 1: Implement a timeout race helper + `ensureRepoForFile`**

Add near `collectDiffRoots`:

```javascript
function raceWithTimeout( promise, timeoutMs, onTimeoutLateResolve )
{
    if( !timeoutMs || timeoutMs <= 0 )
    {
        return promise;
    }
    var timedOut = false;
    var timer;
    var timeoutPromise = new Promise( function( resolve )
    {
        timer = setTimeout( function()
        {
            timedOut = true;
            resolve();
        }, timeoutMs );
    } );
    promise.then( function()
    {
        clearTimeout( timer );
        if( timedOut === true && typeof ( onTimeoutLateResolve ) === 'function' )
        {
            onTimeoutLateResolve();
        }
    } ).catch( function() { clearTimeout( timer ); } );
    return Promise.race( [ promise, timeoutPromise ] );
}

function ensureRepoForFile( fsPath, branch, globs )
{
    if( newTodoFilter.isEnabled() !== true || !branch || !fsPath )
    {
        return Promise.resolve();
    }

    var dir = path.dirname( fsPath );

    function resolveRepoRoot()
    {
        if( revParseCache.has( dir ) )
        {
            return Promise.resolve( revParseCache.get( dir ) );
        }
        return git.findRepoRoot( dir ).then( function( root )
        {
            revParseCache.set( dir, root );
            return root;
        } ).catch( function()
        {
            revParseCache.set( dir, null );
            return null;
        } );
    }

    return resolveRepoRoot().then( function( repoRoot )
    {
        if( repoRoot === null || newTodoFilter.isOwningRepoKnown( repoRoot ) )
        {
            return;
        }
        var extendPromise = newTodoFilter.extendForRepo( repoRoot, branch, globs );
        return raceWithTimeout( extendPromise, config.newTodosGitTimeoutMs(), function()
        {
            reconcileFileAfterLateExtend( fsPath );
        } );
    } );
}
```

Implement `reconcileFileAfterLateExtend` using `openDocuments` / `notebookRegistry` to find the one target and re-refresh it (no new URI-lookup helper needed):

```javascript
function reconcileFileAfterLateExtend( fsPath )
{
    if( !activeSearchResults )
    {
        return;
    }
    var uri = vscode.Uri.file( fsPath );
    var doc = openDocuments[ uri.toString() ];
    var notebook = notebookRegistry.getByKey( uri.toString() );
    var target = notebook || doc;
    if( target )
    {
        refreshScanTarget( target, activeSearchResults );
        applyDirtyResultsToTree( { fullSort: false, refilterAll: false }, activeSearchResults );
    }
}
```

> Verify the exact key shape of `openDocuments` (the explore showed `Object.keys(openDocuments)`); if it is keyed by `uri.toString()`, the above works. If keyed differently, adapt the lookup to match. Inspect `openDocuments` population before finalizing.

- [x] **Step 2: Make incremental refresh functions async and await `ensureRepoForFile`**

Update `refreshTextDocumentResults` (lines 1877-1896) — make it return a promise and await the ensure before the final `replaceSearchResults`:

```javascript
function refreshTextDocumentResults( document, store )
{
    if( !document || !config.isValidScheme( document.uri ) || isIncluded( document.uri ) !== true )
    {
        replaceSearchResults( document.uri, [], store );
        return Promise.resolve();
    }

    if( config.scanMode() === SCAN_MODE_CURRENT_FILE )
    {
        var activeTarget = getActiveScanTarget();
        if( activeTarget !== document )
        {
            replaceSearchResults( document.uri, [], store );
            return Promise.resolve();
        }
    }

    return ensureRepoForFile( document.uri.fsPath, config.newTodosGitBaseBranch(), getGitDiffGlobs() ).then( function()
    {
        replaceSearchResults( document.uri, applyNewTodoFilterToResults( document.uri, getDocumentScanResults( document ) ), store );
    } );
}
```

Update `refreshNotebookResults` (lines 1898-1922) analogously, awaiting `ensureRepoForFile( notebook.uri.fsPath, ... )` before the final `replaceSearchResults`, returning `Promise.resolve()` on the early-return branches.

Update `refreshScanTarget` (lines 1924-1934) to return the promise:

```javascript
function refreshScanTarget( target, store )
{
    if( notebooks.isNotebookDocument( target ) )
    {
        return refreshNotebookResults( target, store );
    }
    return refreshTextDocumentResults( target, store );
}
```

Update `refreshOpenFiles` (lines 1984-1994) to await each target so `onTargetRefreshed` fires after the write (keep behavior: callback after refresh):

```javascript
function refreshOpenFiles( workspaceRoots, store, onTargetRefreshed )
{
    return Promise.all( getRefreshTargets( workspaceRoots ).map( function( target )
    {
        return Promise.resolve( refreshScanTarget( target, store ) ).then( function()
        {
            if( typeof ( onTargetRefreshed ) === 'function' )
            {
                onTargetRefreshed( target );
            }
        } );
    } ) );
}
```

> `executeRebuild` calls `refreshOpenFiles( searchList, nextSearchResults, ... )` synchronously (line 2360 area) then immediately does `flushStreamingTreeApply` / swap. Because the rebuild stages into `nextSearchResults` and only swaps at the end, await the `refreshOpenFiles` promise before the swap so files are written before becoming visible. Wrap the post-refresh swap logic in a `.then` on the `refreshOpenFiles` return. Inspect the exact `.then` block at lines 2356-2369 and chain accordingly:

```javascript
} ).then( function()
{
    assertGenerationActive( generation );
    var refreshTargets = getRefreshTargets( searchList );
    beginScanFinalization( generation, refreshTargets.length );
    return refreshOpenFiles( searchList, nextSearchResults, function( target )
    {
        completeScanFinalizationTarget( generation, target );
    } );
} ).then( function()
{
    assertGenerationActive( generation );
    flushStreamingTreeApply( generation, nextSearchResults, undefined );
    prepareStreamingTreeApply( generation, nextSearchResults );
    activeSearchResults = nextSearchResults;
    nextSearchResults = undefined;
    applyDirtyResultsToTree( { fullSort: true, refilterAll: needsFullFilter }, activeSearchResults );
} ).catch( function( error )
```

- [x] **Step 3: Add a filter-layer test for idempotent extend under concurrent calls**

Add to `test/newTodoFilter.behavior.test.js`:

```javascript
QUnit.test( 'extendForRepo: concurrent calls for same repo do not double-add root', function( assert )
{
    var done = assert.async();
    var calls = 0;
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function() { calls++; return Promise.resolve( new Map() ); },
        getUntrackedFiles: function() { return Promise.resolve( [] ); },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( 'main', [ '/r0' ], { include: [], exclude: [] } ).then( function()
    {
        return Promise.all( [
            f.extendForRepo( '/r1', 'main', { include: [], exclude: [] } ),
            f.extendForRepo( '/r1', 'main', { include: [], exclude: [] } )
        ] );
    } ).then( function()
    {
        assert.equal( f.isOwningRepoKnown( '/r1' ), true, 'root known once' );
        done();
    } );
} );
```

- [x] **Step 4: Run tests**

Run: `npx qunit test/newTodoFilter.behavior.test.js test/extension.scan-parity.test.js`
Expected: PASS.

- [x] **Step 5: Build to confirm no syntax errors in extension.js**

Run: `npm run webpack`
Expected: Build succeeds (no errors).

- [x] **Step 6: Commit**

```bash
git add src/extension.js test/newTodoFilter.behavior.test.js
git commit -m "feat(scan): ensureRepoForFile + await-before-write wiring with timeout reconcile"
```

---

## Task 7: New scan mode — constant, enum, labels, command

**Files:**
- Modify: `src/extension.js` (constant + command)
- Modify: `package.json` (enum on both declarations, command, menu entries)
- Modify: `package.nls.json` (five labels)
- Test: `test/package.manifest.test.js`, `test/settings.compatibility.test.js`

The new mode is `'open files in workspace'` → `SCAN_MODE_OPEN_FILES_IN_WORKSPACE`, mode 2. Existing ids keep their behavior; only labels change.

**Label mapping (per spec):** the `markdownEnumDescriptions` array order matches the `enum` array order. Current enum order: `workspace`, `open files`, `current file`, `workspace only`. Append `open files in workspace` last → 5 descriptions.

| enum index | id | description |
|---|---|---|
| 1 | `workspace` | "Scan the whole workspace and any open files (including files outside the workspace)" |
| 2 | `open files` | "Scan open files only, including files outside the workspace" |
| 3 | `current file` | "Scan the current file only (wherever it lives)" |
| 4 | `workspace only` | "Scan the workspace only" |
| 5 | `open files in workspace` | "Scan open files that are inside the workspace only" |

- [x] **Step 1: Write the failing manifest test**

Add to `test/package.manifest.test.js` (mirror its existing structure for reading `package.json`):

```javascript
QUnit.test( 'scanMode enum has exactly five values including open files in workspace', function( assert )
{
    var pkg = require( '../package.json' );
    var modes = pkg.contributes.configuration[ 0 ] ? undefined : undefined; // see note
    // Locate the better-todo-tree.tree.scanMode property; mirror how other tests in this file traverse config.
    var props = findConfigProperty( pkg, 'better-todo-tree.tree.scanMode' ); // use existing helper if present
    assert.deepEqual( props.enum, [
        'workspace', 'open files', 'current file', 'workspace only', 'open files in workspace'
    ] );
    assert.equal( props.markdownEnumDescriptions.length, 5, 'five descriptions' );
} );
```

> Inspect `test/package.manifest.test.js` first for the existing property-lookup pattern and reuse it (do not invent `findConfigProperty` if a different accessor exists). If the file has no helper, traverse `pkg.contributes.configuration` to the `properties` object directly.

- [x] **Step 2: Run test to verify it fails**

Run: `npx qunit test/package.manifest.test.js`
Expected: FAIL (enum has four values).

- [x] **Step 3: Update `package.json` enums**

In both `better-todo-tree.tree.scanMode` (line ~1689) and `todo-tree.tree.scanMode` (line ~1706), append to `enum`:

```json
"enum": [
    "workspace",
    "open files",
    "current file",
    "workspace only",
    "open files in workspace"
],
```

And append a 5th `markdownEnumDescriptions` entry to both:

```json
"markdownEnumDescriptions": [
    "%better-todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.1%",
    "%better-todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.2%",
    "%better-todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.3%",
    "%better-todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.4%",
    "%better-todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.5%"
],
```

- [x] **Step 4: Update `package.nls.json` labels**

Replace the four existing `...scanMode.markdownEnumDescriptions.1`-`.4` values (both `todo-tree.*` and `better-todo-tree.*` keys, lines ~248-255) with the new text and add `.5` for both namespaces:

```json
"todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.1": "Scan the whole workspace and any open files (including files outside the workspace)",
"better-todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.1": "Scan the whole workspace and any open files (including files outside the workspace)",
"todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.2": "Scan open files only, including files outside the workspace",
"better-todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.2": "Scan open files only, including files outside the workspace",
"todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.3": "Scan the current file only (wherever it lives)",
"better-todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.3": "Scan the current file only (wherever it lives)",
"todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.4": "Scan the workspace only",
"better-todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.4": "Scan the workspace only",
"todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.5": "Scan open files that are inside the workspace only",
"better-todo-tree.configuration.tree.scanMode.markdownEnumDescriptions.5": "Scan open files that are inside the workspace only",
```

- [x] **Step 5: Add the constant in `extension.js`**

After line 56 (the four existing constants):

```javascript
var SCAN_MODE_OPEN_FILES_IN_WORKSPACE = 'open files in workspace';
```

- [x] **Step 6: Add the scan-mode-selection command**

In `extension.js`, after `scanWorkspaceOnly` (line ~2918-2921):

```javascript
function scanOpenFilesInWorkspaceOnly()
{
    return updateSetting( 'tree.scanMode', SCAN_MODE_OPEN_FILES_IN_WORKSPACE, vscode.ConfigurationTarget.Workspace );
}
```

Register it alongside the other scan-mode command registrations (near lines 3849-3852):

```javascript
context.subscriptions.push( vscode.commands.registerCommand( 'better-todo-tree.scanOpenFilesInWorkspaceOnly', scanOpenFilesInWorkspaceOnly ) );
```

> Use the exact registration idiom found at lines 3849-3852 (it may register under both `better-todo-tree.*` and `todo-tree.*` namespaces — match the existing pattern for the other four scan commands).

Declare the command in `package.json` `contributes.commands` (mirror the existing `scanWorkspaceOnly` command entry — find it and copy its shape, with `command: "better-todo-tree.scanOpenFilesInWorkspaceOnly"` and a title like "Scan open files in workspace only"). Add the legacy `todo-tree.*` command entry too if the others have one.

- [x] **Step 7: Run manifest + compatibility tests**

Run: `npx qunit test/package.manifest.test.js test/settings.compatibility.test.js`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add package.json package.nls.json src/extension.js test/package.manifest.test.js
git commit -m "feat(scan): add 'open files in workspace' scan mode (enum, labels, command)"
```

---

## Task 8: Boundary enforcement at scan-target enumeration + mode-family predicate audit

**Files:**
- Modify: `src/extension.js`
- Test: `test/extension.scan-parity.test.js` (extend) or a focused enumeration test

Mode 2 (`'open files in workspace'`) is **open-files-family**: it behaves like `'open files'` everywhere, EXCEPT external targets are filtered out at enumeration.

### 8a: Enumeration filtering

- [x] **Step 1: Update `getOpenDocumentsForScan`**

In `getOpenDocumentsForScan` (lines 1749-1787), add a branch for the new mode. It returns the same `documents` as `'open files'` but filtered to in-workspace files. Insert before the `SCAN_MODE_OPEN_FILES` branch (line ~1773):

```javascript
if( scanMode === SCAN_MODE_OPEN_FILES_IN_WORKSPACE )
{
    return documents.filter( function( document )
    {
        return document.fileName !== undefined && isFileInSearchRoots( document.fileName, workspaceRoots );
    } );
}
```

- [x] **Step 2: Update `getNotebookDocumentsForScan`**

In `getNotebookDocumentsForScan` (lines 1724-1747), the existing `SCAN_MODE_WORKSPACE_ONLY` branch (line 1738) filters notebooks to in-workspace. Add the new mode to that same filter condition so mode 2 notebooks are also restricted:

```javascript
if( scanMode === SCAN_MODE_WORKSPACE_ONLY || scanMode === SCAN_MODE_OPEN_FILES_IN_WORKSPACE )
{
    return openNotebookTargets.filter( function( notebook )
    {
        return notebook.uri.fsPath === undefined || isFileInSearchRoots( notebook.uri.fsPath, workspaceRoots );
    } );
}
```

- [x] **Step 3: Write enumeration tests**

Inspect `test/extension.scan-parity.test.js` for how it exercises `getOpenDocumentsForScan` (it may load `extension.js` with vscode stubs). Add tests asserting:
- mode 2 with one in-workspace and one external open doc → only the in-workspace doc returned.
- mode 3 (`'open files'`) with the same inputs → both returned.
- mode 2 notebooks: external notebook excluded; in-workspace kept.

> Follow the file's existing stubbing harness exactly. If the file does not already invoke `getOpenDocumentsForScan` directly (it is a closure), extract the mode-2/3/4/5 inclusion predicate into a tiny pure helper `shouldIncludeExternalTarget(scanMode)` in `diffRootsHelper.js` and test that, then call it from the enumeration. Prefer testing the pure predicate if the closure is not reachable.

If extracting: add to `src/diffRootsHelper.js`:

```javascript
function excludesExternalTargets( scanMode )
{
    return scanMode === 'open files in workspace';
}
module.exports.excludesExternalTargets = excludesExternalTargets;
```

And in `getOpenDocumentsForScan` use `diffRootsHelper.excludesExternalTargets( scanMode )` for the new branch's filter decision. Test in `test/diffRoots.behavior.test.js`:

```javascript
QUnit.test( 'excludesExternalTargets: only mode 2', function( assert )
{
    var h = require( '../src/diffRootsHelper.js' );
    assert.equal( h.excludesExternalTargets( 'open files in workspace' ), true );
    assert.equal( h.excludesExternalTargets( 'open files' ), false );
    assert.equal( h.excludesExternalTargets( 'workspace' ), false );
    assert.equal( h.excludesExternalTargets( 'current file' ), false );
} );
```

- [x] **Step 4: Run tests**

Run: `npx qunit test/diffRoots.behavior.test.js test/extension.scan-parity.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/extension.js src/diffRootsHelper.js test/diffRoots.behavior.test.js test/extension.scan-parity.test.js
git commit -m "feat(scan): mode 2 excludes out-of-workspace targets at enumeration"
```

### 8b: Mode-family predicate audit

Each site that special-cases `'open files'` must also fire for mode 2. The sites (from the spec):
- `searchWorkspaces` gate (line 1479): mode 2 must NOT add workspace folders (same as `'open files'`). The gate already excludes anything not `WORKSPACE_AND_OPEN_FILES`/`WORKSPACE_ONLY`, so mode 2 is **already** correctly excluded — verify, no change needed.
- `isDocumentCoveredByWorkspaceSearch` (line 1529): same — already returns false for non-workspace modes. Verify.
- `getOpenDocumentsForScan` line 1773/1778: handled in 8a.
- autoRefresh gate `shouldRefreshFile` (line 2632): `!== SCAN_MODE_WORKSPACE_ONLY` — mode 2 should auto-refresh (it is open-files-family), and it is not workspace-only, so it already passes. Verify, no change.
- `onDidCloseTextDocument` gate (line 3902): same `!== SCAN_MODE_WORKSPACE_ONLY` — mode 2 should remove closed-doc results. Already correct. Verify.

- [x] **Step 1: Audit each site, confirm correctness, add a regression test**

For each site above, read the code and confirm mode 2 takes the intended branch. Most need NO change because the gates are written as `=== WORKSPACE_*` or `!== WORKSPACE_ONLY`, which already classify `'open files in workspace'` as open-files-family.

Add a focused test (in `test/diffRoots.behavior.test.js` or scan-parity) asserting the family classification via the helper:

```javascript
QUnit.test( 'isWorkspaceFamily: mode 2 is NOT workspace family', function( assert )
{
    var h = require( '../src/diffRootsHelper.js' );
    assert.equal( h.isWorkspaceFamily( 'open files in workspace' ), false );
    assert.equal( h.isWorkspaceFamily( 'workspace' ), true );
    assert.equal( h.isWorkspaceFamily( 'workspace only' ), true );
} );
```

- [x] **Step 2: Menu `when` clauses + context key**

The context key `better-todo-tree-scan-mode` is set to `config.scanMode()` (line 2562) — already carries the new value, no change.

For menus (`package.json` lines ~95-110 toolbar, ~246-264 context menu): the existing per-mode commands cycle modes. Decide the cycle and `when` clauses for the 5th mode. The simplest consistent approach: add `scanOpenFilesInWorkspaceOnly` to the **context menu** (right-click) group `3-view` with `when: "view =~ /todo-tree/ && better-todo-tree-scan-mode != 'open files in workspace'"`, mirroring the other four context-menu entries. For the toolbar single-button cycle, extend the cycle to include mode 2 (update the four existing `when` clauses' target modes so the cycle visits all five). Document the chosen cycle order in the commit message.

Add to `package.json` context menu (mirror the existing four entries at lines 246-264):

```json
{
    "command": "better-todo-tree.scanOpenFilesInWorkspaceOnly",
    "when": "view =~ /todo-tree/ && better-todo-tree-scan-mode != 'open files in workspace'",
    "group": "3-view"
}
```

For the toolbar cycle: the four toolbar entries (lines 95-110) each show when current mode is X and switch to Y. Extend so the cycle is `workspace → open files → open files in workspace → current file → workspace only → workspace`. Update each `when`/command pair to reflect the new next-mode, and add a fifth pair. Lay out the five pairs explicitly:

| current mode (`when`) | command (next mode) |
|---|---|
| `'workspace'` | `scanOpenFilesOnly` |
| `'open files'` | `scanOpenFilesInWorkspaceOnly` |
| `'open files in workspace'` | `scanCurrentFileOnly` |
| `'current file'` | `scanWorkspaceOnly` |
| `'workspace only'` | `scanWorkspaceAndOpenFiles` |

Rewrite the four existing toolbar entries' `when` + `command` to match this table and add the fifth.

- [x] **Step 3: Run manifest test**

Run: `npx qunit test/package.manifest.test.js test/diffRoots.behavior.test.js`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add package.json test/diffRoots.behavior.test.js
git commit -m "feat(scan): wire mode 2 into menus and confirm open-files-family predicate audit"
```

---

## Task 9: `tree.js` — combined diffability status node

**Files:**
- Modify: `src/extension.js` (compute per-reason scanned-file counts, thread to provider)
- Modify: `src/tree.js` (render the node)
- Test: `test/tree.behavior.test.js`

One status node, scoped to the **diffability** axis only. Driven by **scanned** files (those that passed enumeration + boundary exclusion). Counts are **file** counts per reason (`no-repo` / `diff-failed`).

The extension knows each scanned file's `classifyUndiffable`. Compute per-reason counts and thread them into the provider like other status state, then `tree.js getChildren` builds the node.

### 9a: Extension computes per-reason scanned-file counts

- [x] **Step 1: Add a counts accumulator keyed by reason**

In `extension.js`, after computing filter state in `executeRebuild`, accumulate undiffable counts over scanned files. The scanned set is the union of files written to `activeSearchResults`. Add a helper that, given the final store, iterates its file URIs and calls `newTodoFilter.classifyUndiffable`:

```javascript
function computeUndiffableCounts( store )
{
    var counts = { 'no-repo': 0, 'diff-failed': 0 };
    if( newTodoFilter.isEnabled() !== true )
    {
        return counts;
    }
    getSearchResultsStore( store ).forEachUri( function( uri )
    {
        var reason = newTodoFilter.classifyUndiffable( uri.fsPath );
        if( reason === 'no-repo' || reason === 'diff-failed' )
        {
            counts[ reason ]++;
        }
    } );
    return counts;
}
```

> The store's iteration API may differ (`forEachUri` may not exist). Inspect `src/searchResults.js` for the available iteration method (the explore noted `.count()`, `.filter()`, `.replaceUriResults()`, `.remove()`). Use the existing iteration primitive (likely `.filter()` or a `.forEach`/`.uris()` method) to enumerate file paths. Do NOT invent `forEachUri`; adapt to the real API.

> **Important re: trigger semantics:** the node must reflect files that were **scanned** (passed enumeration), not only files currently shown. Under fail-closed, undiffable files are dropped from results, so they won't be in the store. To count them, accumulate `classifyUndiffable` at the point each file is processed in `applyNewTodoFilterToResults` (before dropping), into a per-rebuild accumulator (e.g. `var scannedUndiffable = { 'no-repo': Set, 'diff-failed': Set }` cleared at rebuild start, adding `uri.fsPath`). Use the accumulator rather than scanning the final store, so hidden files still count. Implement the accumulator:

```javascript
// module-level in activate closure
var scannedUndiffable = { 'no-repo': new Set(), 'diff-failed': new Set() };
```

Clear it at the start of `executeRebuild` (next to `revParseCache.clear()`):

```javascript
scannedUndiffable[ 'no-repo' ].clear();
scannedUndiffable[ 'diff-failed' ].clear();
```

Record in `applyNewTodoFilterToResults` (lines 2192-2202), before filtering:

```javascript
function applyNewTodoFilterToResults( uri, results )
{
    if( newTodoFilter.isEnabled() !== true )
    {
        return results;
    }
    var reason = newTodoFilter.classifyUndiffable( uri.fsPath );
    if( reason === 'no-repo' || reason === 'diff-failed' )
    {
        scannedUndiffable[ reason ].add( uri.fsPath );
    }
    return results.filter( function( result )
    {
        return newTodoFilter.isNewTodo( uri.fsPath, result.line );
    } );
}
```

> Remove `computeUndiffableCounts` if you use the accumulator approach (avoid dead code). The accumulator is preferred because it captures hidden-but-scanned files.

- [x] **Step 2: Thread counts to the provider**

Find how other status state (e.g. scan-mode, filter counts) is passed to the provider. The provider reads `config.*` directly for scan mode; for the new counts, add a provider setter `provider.setNewTodoStatus({ counts, showUndiffableFiles, scanMode, baseBranch })` called at the end of `executeRebuild` (after the swap), then have `getChildren` read it.

In `executeRebuild`, after `applyDirtyResultsToTree(...)` in the success `.then`, add:

```javascript
provider.setNewTodoStatus( {
    enabled: newTodoFilter.isEnabled(),
    noRepo: scannedUndiffable[ 'no-repo' ].size,
    diffFailed: scannedUndiffable[ 'diff-failed' ].size,
    showUndiffableFiles: config.newTodosShowUndiffableFiles(),
    scanMode: config.scanMode(),
    baseBranch: config.newTodosGitBaseBranch()
} );
```

> Verify how the provider instance is referenced (`provider`) and that it has a refresh after state set; if `applyDirtyResultsToTree` already triggers a tree refresh, calling the setter just before it is sufficient. Place the setter call before `applyDirtyResultsToTree`.

- [x] **Step 3: Commit (extension side)**

```bash
git add src/extension.js
git commit -m "feat(scan): accumulate per-reason undiffable scanned-file counts and thread to provider"
```

### 9b: Provider state + status node rendering

- [x] **Step 1: Write the failing test**

Add to `test/tree.behavior.test.js` (mirror its existing provider-construction + `getChildren` harness):

```javascript
QUnit.test( 'status node: fail-open with undiffable files -> "shown without filtering"', function( assert )
{
    var provider = makeProvider(); // existing harness in this file
    provider.setNewTodoStatus( {
        enabled: true, noRepo: 2, diffFailed: 0,
        showUndiffableFiles: true, scanMode: 'workspace', baseBranch: 'main'
    } );
    var children = provider.getChildren();
    var node = children.find( function( c ) { return c.isStatusNode && /New-todos/.test( c.label ); } );
    assert.ok( node, 'status node present' );
    assert.ok( /shown without filtering/.test( node.label ), 'fail-open copy' );
} );

QUnit.test( 'status node: no undiffable files -> no node', function( assert )
{
    var provider = makeProvider();
    provider.setNewTodoStatus( {
        enabled: true, noRepo: 0, diffFailed: 0,
        showUndiffableFiles: true, scanMode: 'workspace', baseBranch: 'main'
    } );
    var children = provider.getChildren();
    var node = children.find( function( c ) { return c.isStatusNode && /New-todos/.test( c.label ); } );
    assert.notOk( node, 'no status node when nothing undiffable' );
} );
```

> Inspect `test/tree.behavior.test.js` for the real provider constructor signature and the `getChildren` root-level invocation. Adapt `makeProvider()` to the file's actual setup. If `getChildren` requires a root arg, pass the same as existing tests.

- [x] **Step 2: Run test to verify it fails**

Run: `npx qunit test/tree.behavior.test.js`
Expected: FAIL with "provider.setNewTodoStatus is not a function".

- [x] **Step 3: Add provider state + setter**

In `src/tree.js` provider constructor (lines 447-469), initialize:

```javascript
this._newTodoStatus = undefined;
```

Add the setter method on the provider class:

```javascript
setNewTodoStatus( status )
{
    this._newTodoStatus = status;
}
```

- [x] **Step 4: Render the node in `getChildren`**

In `getChildren` (after the scan-mode node block, lines ~537-548), add the diffability node. Build label/tooltip per the spec:

```javascript
var nts = this._newTodoStatus;
if( nts && nts.enabled === true && ( nts.noRepo + nts.diffFailed ) > 0 )
{
    var totalUndiffable = nts.noRepo + nts.diffFailed;
    var label;
    if( nts.scanMode === 'current file' )
    {
        label = nts.showUndiffableFiles === true
            ? "Current file shown without filtering"
            : "Current file not shown";
    }
    else if( nts.showUndiffableFiles === true )
    {
        label = "New-todos: " + totalUndiffable + " shown without filtering";
    }
    else
    {
        label = "New-todos: " + totalUndiffable + " not shown";
    }

    var tooltip = new vscode.MarkdownString();
    function reasonLines( prefix, noRepo, diffFailed )
    {
        var lines = [];
        if( noRepo > 0 ) { lines.push( prefix + noRepo + " not in a git repository" ); }
        if( diffFailed > 0 ) { lines.push( prefix + diffFailed + " could not be diffed (errors)" ); }
        return lines;
    }
    var bucketLabel = nts.showUndiffableFiles === true ? "Shown without filtering" : "Hidden";
    tooltip.appendMarkdown( "**" + bucketLabel + "**\n\n" );
    reasonLines( "- ", nts.noRepo, nts.diffFailed ).forEach( function( line )
    {
        tooltip.appendMarkdown( line + "\n" );
    } );

    var newTodoNode = {
        label: label,
        notExported: true,
        isStatusNode: true,
        icon: "git-branch",
        tooltip: tooltip,
        opensUndiffableSetting: true
    };
    result.unshift( newTodoNode );
}
```

> The spec's tooltip wants **two buckets** (`Hidden` then `Shown without filtering`) only when BOTH can be populated simultaneously (fail-closed hides while a per-file fail-open is impossible globally since the setting is one boolean — so in practice exactly one bucket per rebuild). Keep the single-bucket rendering above for v1; the combined-bucket case only arises if mixing, which the single boolean prevents. If `tree.behavior.test.js` asserts both buckets, extend `reasonLines` to emit both bucket headers — but per the design the setting is global, so one bucket is correct. Match the test you write; keep it consistent with the spec's "omit an empty bucket".

- [x] **Step 5: Make the node clickable (opens the setting)**

In `getTreeItem` status-node branch (lines 720-726), when `node.opensUndiffableSetting`, set a command:

```javascript
else
{
    treeItem.description = node.label;
    treeItem.label = "";
    treeItem.tooltip = node.tooltip;
    treeItem.iconPath = new vscode.ThemeIcon( node.icon );
    if( node.opensUndiffableSetting === true )
    {
        treeItem.command = {
            command: 'workbench.action.openSettings',
            arguments: [ 'better-todo-tree.filtering.newTodosShowUndiffableFiles' ]
        };
    }
}
```

- [x] **Step 6: Run tests to verify they pass**

Run: `npx qunit test/tree.behavior.test.js`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/tree.js test/tree.behavior.test.js
git commit -m "feat(tree): combined diffability status node with click-to-settings"
```

---

## Task 10: Per-item dimming (todo nodes + FileDecorationProvider)

**Files:**
- Modify: `src/tree.js` (todo-node dimming via `resourceUri`)
- Create: `src/fileDecorationProvider.js`
- Modify: `src/extension.js` (register provider, fire change emitter after rebuild/extend)
- Test: `test/tree.behavior.test.js`, `test/fileDecoration.behavior.test.js`

Undiffable files shown under fail-open get dimmed on every shown node. Both node kinds dim through a single `FileDecorationProvider` keyed on `resourceUri`: file/path nodes already carry `resourceUri`; todo nodes set `resourceUri` (their file's URI) in `getTreeItem` so the provider dims them too.

The reason explanation rides on the **`FileDecoration.tooltip`** (file/path-node decorations). Todo nodes get **no** reason tooltip — their existing tooltip is left unchanged. The combined status node (Task 9) remains the single place reasons are spelled out in full.

The decoration consults `newTodoFilter`: active only when filter is ON, `showUndiffableFiles === true`, and `classifyUndiffable(fsPath) !== null`. Color: `new vscode.ThemeColor('gitDecoration.ignoredResourceForeground')`.

### 10a: FileDecorationProvider

- [x] **Step 1: Write the failing test**

Create `test/fileDecoration.behavior.test.js`:

```javascript
var helpers = require( './moduleHelpers.js' );

function loadProvider( filterStub )
{
    return helpers.loadWithStubs( '../src/fileDecorationProvider.js', {
        vscode: {
            ThemeColor: function( id ) { this.id = id; },
            EventEmitter: function() { this.event = function() {}; this.fire = function() {}; },
            FileDecoration: function( badge, tooltip, color ) { this.badge = badge; this.tooltip = tooltip; this.color = color; }
        },
        './newTodoFilter.js': filterStub
    } );
}

function makeConfig()
{
    return {
        newTodosShowUndiffableFiles: function() { return true; },
        newTodosGitBaseBranch: function() { return 'main'; }
    };
}

QUnit.module( 'behavioral fileDecorationProvider' );

QUnit.test( 'undiffable no-repo file -> dimmed decoration with no-repo tooltip', function( assert )
{
    var mod = loadProvider( {
        isEnabled: function() { return true; },
        classifyUndiffable: function() { return 'no-repo'; }
    } );
    var provider = mod.create( makeConfig() );
    var deco = provider.provideFileDecoration( { fsPath: '/x/a.js' } );
    assert.ok( deco, 'decoration returned' );
    assert.equal( deco.color.id, 'gitDecoration.ignoredResourceForeground' );
    assert.ok( /not in a git repository/i.test( deco.tooltip ), 'no-repo reason in tooltip' );
} );

QUnit.test( 'undiffable diff-failed file -> tooltip names base branch', function( assert )
{
    var mod = loadProvider( {
        isEnabled: function() { return true; },
        classifyUndiffable: function() { return 'diff-failed'; }
    } );
    var provider = mod.create( makeConfig() );
    var deco = provider.provideFileDecoration( { fsPath: '/x/a.js' } );
    assert.ok( deco, 'decoration returned' );
    assert.ok( /diff failed/i.test( deco.tooltip ), 'diff-failed reason in tooltip' );
    assert.ok( /main/.test( deco.tooltip ), 'base branch named in tooltip' );
} );

QUnit.test( 'diffable file -> no decoration', function( assert )
{
    var mod = loadProvider( {
        isEnabled: function() { return true; },
        classifyUndiffable: function() { return null; }
    } );
    var provider = mod.create( makeConfig() );
    assert.equal( provider.provideFileDecoration( { fsPath: '/x/a.js' } ), undefined );
} );

QUnit.test( 'filter off -> no decoration', function( assert )
{
    var mod = loadProvider( {
        isEnabled: function() { return false; },
        classifyUndiffable: function() { return 'no-repo'; }
    } );
    var provider = mod.create( makeConfig() );
    assert.equal( provider.provideFileDecoration( { fsPath: '/x/a.js' } ), undefined );
} );
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx qunit test/fileDecoration.behavior.test.js`
Expected: FAIL ("Cannot find module '../src/fileDecorationProvider.js'").

- [x] **Step 3: Create `src/fileDecorationProvider.js`**

```javascript
var vscode = require( 'vscode' );
var newTodoFilter = require( './newTodoFilter.js' );

function reasonTooltip( reason, baseBranch )
{
    if( reason === 'no-repo' )
    {
        return "Not in a git repository : new-todo filtering can't be applied. Showing all todos.";
    }
    return "git diff failed (repo may not have base branch `" + baseBranch + "`). Showing all todos.";
}

function create( config )
{
    var emitter = new vscode.EventEmitter();

    function provideFileDecoration( uri )
    {
        if( newTodoFilter.isEnabled() !== true || config.newTodosShowUndiffableFiles() !== true )
        {
            return undefined;
        }
        var reason = newTodoFilter.classifyUndiffable( uri.fsPath );
        if( reason === null || reason === undefined )
        {
            return undefined;
        }
        return new vscode.FileDecoration(
            undefined,
            reasonTooltip( reason, config.newTodosGitBaseBranch() ),
            new vscode.ThemeColor( 'gitDecoration.ignoredResourceForeground' )
        );
    }

    return {
        onDidChangeFileDecorations: emitter.event,
        provideFileDecoration: provideFileDecoration,
        refresh: function() { emitter.fire( undefined ); }
    };
}

module.exports.create = create;
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx qunit test/fileDecoration.behavior.test.js`
Expected: PASS.

- [x] **Step 5: Register provider + fire on rebuild/extend in `extension.js`**

In `activate`, register and store the provider:

```javascript
var fileDecorationProvider = require( './fileDecorationProvider.js' ).create( config );
context.subscriptions.push( vscode.window.registerFileDecorationProvider( fileDecorationProvider ) );
```

After each rebuild swap (end of `executeRebuild` success `.then`, after `setNewTodoStatus`) and after a late `extendForRepo` reconcile, call:

```javascript
fileDecorationProvider.refresh();
```

> Confirm `config` exposes `newTodosShowUndiffableFiles` (added in Task 4) and `newTodosGitBaseBranch` (pre-existing) — it does. The provider requires `./newTodoFilter.js` directly (singleton module), so it sees the live state.

- [x] **Step 6: Commit**

```bash
git add src/fileDecorationProvider.js src/extension.js test/fileDecoration.behavior.test.js
git commit -m "feat(tree): FileDecorationProvider dims undiffable fail-open file nodes"
```

### 10b: Todo-node dimming (resourceUri only)

- [x] **Step 1: Write the failing test**

Add to `test/tree.behavior.test.js`. The harness must let the provider see filter state; stub `newTodoFilter` if the provider imports it, or inject via the existing test setup. Assert that a todo node under an undiffable fail-open file sets `resourceUri` to its file's URI (so the `FileDecorationProvider` dims it) and that its existing tooltip is left **unchanged** (no undiffable reason prepended).

```javascript
QUnit.test( 'todo node under undiffable fail-open file sets resourceUri, tooltip unchanged', function( assert )
{
    // Arrange a provider whose newTodoFilter reports the file undiffable + fail-open.
    // (Use the file's existing mechanism for injecting newTodoFilter / config.)
    var provider = makeProviderWithUndiffable( '/x/a.js', 'no-repo', true /*failOpen*/ );
    var todoNode = makeTodoNode( { fsPath: '/x/a.js', line: 3, label: 'TODO: thing' } );
    var item = provider.getTreeItem( todoNode );
    assert.ok( item.resourceUri, 'resourceUri set so FileDecorationProvider can dim the row' );
    assert.equal( item.resourceUri.fsPath, '/x/a.js', 'resourceUri is the file URI' );
    // No undiffable reason text injected into the todo tooltip.
    var tip = item.tooltip === undefined ? '' : ( item.tooltip.value !== undefined ? item.tooltip.value : String( item.tooltip ) );
    assert.notOk( /git repository/i.test( tip ), 'no undiffable reason prepended to todo tooltip' );
} );

QUnit.test( 'diffable todo node: no resourceUri injected by undiffable path', function( assert )
{
    var provider = makeProviderWithUndiffable( '/x/a.js', null /*diffable*/, true );
    var todoNode = makeTodoNode( { fsPath: '/x/a.js', line: 3, label: 'TODO: thing' } );
    var item = provider.getTreeItem( todoNode );
    assert.notOk( item.resourceUri, 'no resourceUri added for a diffable todo node' );
} );
```

> Adapt `makeProviderWithUndiffable` / `makeTodoNode` to the real harness in `tree.behavior.test.js`. If the provider reads `newTodoFilter` via `require`, stub it with `helpers.loadWithStubs` when loading `tree.js`. Inspect how the existing tree tests construct todo nodes and reuse those builders. (If todo nodes already set `resourceUri` for another reason, assert it is the file URI rather than asserting it was newly added.)

- [x] **Step 2: Run test to verify it fails**

Run: `npx qunit test/tree.behavior.test.js`
Expected: FAIL (no `resourceUri` set on todo nodes by the undiffable path).

- [x] **Step 3: Set `resourceUri` on undiffable-fail-open todo nodes in `getTreeItem`**

In the todo-node branch of `getTreeItem` (lines 679-718), after the existing command setup, add:

```javascript
if( newTodoFilter.isEnabled() === true && config.newTodosShowUndiffableFiles() === true )
{
    var reason = newTodoFilter.classifyUndiffable( node.fsPath );
    if( reason !== null && reason !== undefined )
    {
        // resourceUri lets the single FileDecorationProvider dim this row by the
        // file's URI (same colour the parent file node gets). No reason tooltip on
        // todo nodes -- the reason rides on the file/path-node FileDecoration; the
        // existing todo tooltip is left untouched.
        treeItem.resourceUri = vscode.Uri.file( node.fsPath );
    }
}
```

> Verify `tree.js` requires `newTodoFilter` and `config` at the top; add `var newTodoFilter = require( './newTodoFilter.js' );` if absent (the explore did not list it as imported — check and add). `config` is already used in `tree.js`.

> **Dimming hook:** stable VS Code TreeItem has no label-foreground API; `resourceUri` + `FileDecorationProvider` is the dim mechanism, and it is shared by both node kinds. The `FileDecoration` carries colour only (no badge), so the todo node and its parent file node both dimming is the intended "every shown node dimmed" effect, not a conflicting double-badge. Do **not** add a reason tooltip here (that lives on the file/path-node decoration and the status node) — only set `resourceUri`.

- [x] **Step 4: Run tests to verify they pass**

Run: `npx qunit test/tree.behavior.test.js`
Expected: PASS.

- [x] **Step 5: Build the extension**

Run: `npm run webpack`
Expected: Build succeeds.

- [x] **Step 6: Commit**

```bash
git add src/tree.js test/tree.behavior.test.js
git commit -m "feat(tree): dim undiffable fail-open todo nodes via resourceUri (no reason tooltip)"
```

---

## Task 11: `package.json` — declare the two new settings

**Files:**
- Modify: `package.json`
- Modify: `package.nls.json`
- Test: `test/package.manifest.test.js`

Declare `filtering.newTodosShowUndiffableFiles` (boolean, default `true`) and `filtering.newTodosGitTimeoutMs` (number, default `2000`) under `better-todo-tree.*` ONLY (no `todo-tree.*` legacy aliases — these are new settings).

- [x] **Step 1: Write the failing test**

Add to `test/package.manifest.test.js`:

```javascript
QUnit.test( 'new filtering settings declared under better-todo-tree only', function( assert )
{
    var pkg = require( '../package.json' );
    var props = getConfigProperties( pkg ); // use the file's existing properties accessor
    assert.ok( props[ 'better-todo-tree.filtering.newTodosShowUndiffableFiles' ], 'undiffable setting present' );
    assert.equal( props[ 'better-todo-tree.filtering.newTodosShowUndiffableFiles' ].default, true );
    assert.ok( props[ 'better-todo-tree.filtering.newTodosGitTimeoutMs' ], 'timeout setting present' );
    assert.equal( props[ 'better-todo-tree.filtering.newTodosGitTimeoutMs' ].default, 2000 );
    assert.notOk( props[ 'todo-tree.filtering.newTodosShowUndiffableFiles' ], 'no legacy alias' );
} );
```

> Use whatever properties accessor `test/package.manifest.test.js` already has; if it inspects `pkg.contributes.configuration` directly, traverse to the `properties` object the same way.

- [x] **Step 2: Run test to verify it fails**

Run: `npx qunit test/package.manifest.test.js`
Expected: FAIL (settings not declared).

- [x] **Step 3: Declare the settings**

In `package.json`, near the other `better-todo-tree.filtering.*` settings (around line 1436-1459), add:

```json
"better-todo-tree.filtering.newTodosShowUndiffableFiles": {
    "default": true,
    "markdownDescription": "%newTodosShowUndiffableFiles.description%",
    "type": "boolean"
},
"better-todo-tree.filtering.newTodosGitTimeoutMs": {
    "default": 2000,
    "markdownDescription": "%newTodosGitTimeoutMs.description%",
    "type": "number"
},
```

- [x] **Step 4: Add NLS descriptions**

In `package.nls.json`, near the other filtering descriptions (lines ~287-288):

```json
"newTodosShowUndiffableFiles.description": "When 'new todos only' is enabled and a file can't be git-diffed (not in a repo, or the diff failed), show all its todos (fail-open). When disabled, hide such files entirely (fail-closed).",
"newTodosGitTimeoutMs.description": "Maximum time (ms) to wait for first-touch git repo discovery + diff when filtering an open file. On timeout, the file is shown in its fail-open/fail-closed state, then corrected when the diff resolves. 0 disables the timeout (always wait).",
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx qunit test/package.manifest.test.js`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add package.json package.nls.json test/package.manifest.test.js
git commit -m "feat(settings): declare newTodosShowUndiffableFiles and newTodosGitTimeoutMs"
```

---

## Task 12: Current-file mode diffability copy + `Nothing found` suppression

**Files:**
- Modify: `src/tree.js`
- Test: `test/tree.behavior.test.js`

Current-file mode (5) always scans the active file (no boundary axis). Diffability still applies:
- Undiffable + fail-closed → file shows nothing, status node shows singular "Current file not shown : ..." copy, and `Nothing found` is **suppressed**.
- Undiffable + fail-open → shown dimmed (handled in Task 10), status node "Current file shown without filtering".
- Diffable → normal.

Task 9 already renders the singular current-file label. This task adds `Nothing found` suppression for the fail-closed current-file case.

- [x] **Step 1: Write the failing test**

Add to `test/tree.behavior.test.js`:

```javascript
QUnit.test( 'current-file undiffable fail-closed: Nothing found suppressed, singular node shown', function( assert )
{
    var provider = makeProvider();
    provider.setNewTodoStatus( {
        enabled: true, noRepo: 1, diffFailed: 0,
        showUndiffableFiles: false, scanMode: 'current file', baseBranch: 'main'
    } );
    var children = provider.getChildren(); // empty result set (file dropped)
    var labels = children.map( function( c ) { return c.label || ''; } );
    assert.notOk( labels.some( function( l ) { return /Nothing found/.test( l ); } ), 'Nothing found suppressed' );
    assert.ok( labels.some( function( l ) { return /Current file not shown/.test( l ); } ), 'singular copy shown' );
} );
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx qunit test/tree.behavior.test.js`
Expected: FAIL (`Nothing found` still appended when result set is empty).

- [x] **Step 3: Suppress `Nothing found` in the current-file fail-closed case**

In `getChildren`, the `Nothing found` block is at lines ~520-530. Guard it so it does NOT fire when the current-file-mode file was dropped by diffability policy. Add a condition using `this._newTodoStatus`:

```javascript
if( result.length === 0 )
{
    var nts2 = this._newTodoStatus;
    var suppressNothingFound = nts2 && nts2.enabled === true &&
        nts2.scanMode === 'current file' &&
        nts2.showUndiffableFiles === false &&
        ( nts2.noRepo + nts2.diffFailed ) > 0;
    if( suppressNothingFound !== true )
    {
        if( filterStatusNode.label !== "" ) { filterStatusNode.label += ", "; }
        filterStatusNode.label += "Nothing found";
        filterStatusNode.icon = "issues";
        filterStatusNode.empty = availableNodes.length === 0;
    }
}
```

> Ensure the diffability status node (Task 9) is `unshift`ed AFTER this block so it still appears. The order of `unshift` calls determines top-to-bottom display; confirm the new-todo node ends up visible. Re-check the relative `unshift` order in `getChildren`.

- [x] **Step 4: Run tests to verify they pass**

Run: `npx qunit test/tree.behavior.test.js`
Expected: PASS.

- [x] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (entire suite).

- [x] **Step 6: Commit**

```bash
git add src/tree.js test/tree.behavior.test.js
git commit -m "feat(tree): suppress 'Nothing found' for current-file fail-closed undiffable case"
```

---

## Task 13: Integration sweep + final verification

**Files:**
- Test: `test/extension.scan-parity.test.js` (extend) or new integration test

Add coverage for the cross-product the spec calls out, where feasible within the existing test harness. Where full VS Code integration is impractical, assert the pure-helper + filter-layer behaviors that compose into the integration cases.

- [x] **Step 1: Add integration-style tests**

For each scan mode (1-5) × file location (in-workspace / other-repo / no-repo) × `newTodosShowUndiffableFiles` (true/false), assert via the filter + helper layers:
- mode 2 excludes external files (Task 8 enumeration test covers this).
- untracked file shows all todos (Task 3b sentinel test covers this).
- open a new-repo file in open-files mode triggers lazy extend (assert `ensureRepoForFile` → `extendForRepo` discovers the repo; can be tested at the filter layer with `extendForRepo`).
- current-file external file is scanned (Task 8 / enumeration: mode 5 includes external).

Add a consolidated test documenting the matrix coverage in `test/diffRoots.behavior.test.js` or a new `test/scanModeMatrix.behavior.test.js` that exercises `collectDiffRootsFrom`, `excludesExternalTargets`, and `isWorkspaceFamily` across all five modes:

```javascript
QUnit.test( 'scan-mode matrix: family + external-exclusion + diff-root gating', function( assert )
{
    var h = require( '../src/diffRootsHelper.js' );
    var modes = [ 'workspace', 'open files', 'current file', 'workspace only', 'open files in workspace' ];
    var family = modes.map( h.isWorkspaceFamily );
    assert.deepEqual( family, [ true, false, false, true, false ], 'workspace family = 1 and 4' );
    var excludes = modes.map( h.excludesExternalTargets );
    assert.deepEqual( excludes, [ false, false, false, false, true ], 'only mode 2 excludes external' );
} );
```

- [x] **Step 2: Run the full suite**

Run: `npm test`
Expected: PASS (entire suite).

Actual on this macOS machine: FAIL with known unrelated environment-specific failures in `test/perf.run-all.test.js` and `test/release.workflow-scripts.test.js` (`/etc/os-release`, `mapfile`, `local -n`).

- [x] **Step 3: Build for production**

Run: `npm run webpack`
Expected: Build succeeds with no errors.

- [x] **Step 4: Commit**

```bash
git add test/
git commit -m "test: scan-mode matrix coverage for boundary + diffability axes"
```

---

## Self-Review notes (for the executor)

When executing, watch these consistency points:

- **Constant name:** `SCAN_MODE_OPEN_FILES_IN_WORKSPACE = 'open files in workspace'` used identically in `extension.js` and matched in `diffRootsHelper.js` string checks and `package.json` enum.
- **Filter method names:** `setShowUndiffableFiles`, `classifyUndiffable`, `extendForRepo`, `isOwningRepoKnown` — used identically across `newTodoFilter.js`, `extension.js`, `fileDecorationProvider.js`, tests.
- **Provider setter:** `setNewTodoStatus({ enabled, noRepo, diffFailed, showUndiffableFiles, scanMode, baseBranch })` — same shape in `extension.js` caller and `tree.js` reader and tests.
- **Untracked sentinel:** `[[1, Infinity]]` everywhere (refresh + extendForRepo).
- **Store iteration API:** verify the real method on `searchResults` store before using it in the counts accumulator (Task 9a uses an `applyNewTodoFilterToResults` accumulator instead, avoiding store iteration — prefer that).
- **`tree.js` requires `newTodoFilter`:** add the require if absent (Tasks 9, 10, 12 depend on it).
- **Menu cycle order:** the five-mode toolbar cycle table in Task 8b must match the registered command names exactly.
