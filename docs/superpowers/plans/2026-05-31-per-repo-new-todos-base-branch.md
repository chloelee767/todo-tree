# Per-Repo New-Todos Base Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `new todos only` mode to resolve its git base branch per repo root, while keeping the existing global base-branch setting as the fallback.

**Architecture:** Add one new config map in the `better-todo-tree` namespace, resolve it in `src/config.js` using exact normalized repo-root matches, and pass a `resolveBranch(repoRoot)` function through the new-todo filter and extension scan paths. `src/newTodoFilter.js` becomes the source of truth for per-root `no-branch` accounting, and `src/extension.js` uses that per-root accounting for file refreshes, scan warnings, and toggle-on prompting without changing the existing status payload shape.

**Tech Stack:** Node.js, CommonJS, VS Code extension APIs, QUnit.

---

## File Structure

- `package.json` (Modify) - declare `better-todo-tree.filtering.newTodosGitBaseBranchPerRepo` with object schema, resource scope, and no legacy alias.
- `package.nls.json` (Modify) - add the English description string for the new per-repo setting.
- `package.nls.zh-cn.json` (Modify) - add the matching translation key so manifest tests keep passing.
- `src/config.js` (Modify) - expose `newTodosGitBaseBranchPerRepo()` and `resolveNewTodosGitBaseBranch(repoRoot)` while keeping `newTodosGitBaseBranch()` unchanged as the fallback.
- `src/newTodoFilter.js` (Modify) - replace the single-branch model with per-root branch resolution in `refresh()` and `extendForRepo()`, track blank-branch roots per repo, and expose summary data for warning logic.
- `src/extension.js` (Modify) - pass the resolver function through full scans and lazy open-file repo discovery, update the scan warning logic, and change toggle-on prompting to trigger only when every in-scope repo resolves blank.
- `test/package.manifest.test.js` (Modify) - verify the new manifest setting exists only in the current namespace and that both NLS files contain the new description key.
- `test/settings.compatibility.test.js` (Modify) - update manifest setting counts because one new current-namespace setting is added without a legacy mirror.
- `test/config.behavior.test.js` (Modify) - cover map lookup, fallback, and normalization rules for `resolveNewTodosGitBaseBranch()`.
- `test/newTodoFilter.behavior.test.js` (Modify) - cover mixed-root refresh, per-root blank handling, and `extendForRepo()` behavior with the new resolver function.
- `test/extension.scan-parity.test.js` (Modify) - verify provider status, warning behavior, and toggle-on prompting at the extension layer.

---

## Notes For The Implementing Engineer

- Reuse `diffRootsHelper.normalizePath()` for both stored map keys and incoming repo roots. Do not duplicate path normalization rules in `src/config.js`.
- Keep `config.newTodosGitBaseBranch()` unchanged. It is still the fallback and the informational `baseBranch` field sent to `provider.setNewTodoStatus(...)`.
- The new per-repo setting is `better-todo-tree` only. Do not add `todo-tree.filtering.newTodosGitBaseBranchPerRepo`.
- Blank map values fall through to the global base branch. They do not create a `no-branch` state when the global setting is non-blank.
- `newTodoFilter.classifyUndiffable()` already supports additive reasons. Preserve that shape and make `no-branch` per-root, not global.
- `ensureRepoForFile()` must keep its early `newTodoFilter.isEnabled() !== true` and `!fsPath` guards, but the branch blank check moves after repo-root discovery so it can be resolved per repo.
- `promptForNewTodosBranch()` still writes only `filtering.newTodosGitBaseBranch` at workspace scope.
- QUnit commands in this repo are file-scoped: `npx qunit test/<file>.js`.

---

## Task 1: Add manifest coverage for the new per-repo setting

**Files:**
- Modify: `package.json:1481-1506`
- Modify: `package.nls.json:295-304`
- Modify: `package.nls.zh-cn.json:295-297`
- Modify: `test/package.manifest.test.js`
- Modify: `test/settings.compatibility.test.js`

- [ ] **Step 1: Add the failing manifest test assertions**

Add this test near `QUnit.test( 'new filtering settings are declared under better-todo-tree only', ... )` in `test/package.manifest.test.js`:

```javascript
QUnit.test( 'per-repo new-todos base branch setting is current-namespace only', function( assert )
{
    var packageJson = readPackageJson();
    var englishNls = readPackageNls( 'package.nls.json' );
    var chineseNls = readPackageNls( 'package.nls.zh-cn.json' );
    var perRepoSetting = getConfigurationProperty( 'better-todo-tree.filtering.newTodosGitBaseBranchPerRepo' );

    function hasConfigurationProperty( propertyName, node )
    {
        if( node === undefined || node === null )
        {
            return false;
        }

        if( Array.isArray( node ) )
        {
            return node.some( function( entry )
            {
                return hasConfigurationProperty( propertyName, entry );
            } );
        }

        if( typeof ( node ) !== 'object' )
        {
            return false;
        }

        if( node.properties && Object.prototype.hasOwnProperty.call( node.properties, propertyName ) )
        {
            return true;
        }

        return Object.keys( node ).some( function( key )
        {
            return hasConfigurationProperty( propertyName, node[ key ] );
        } );
    }

    assert.ok( perRepoSetting, 'per-repo setting present' );
    assert.strictEqual( perRepoSetting.type, 'object' );
    assert.deepEqual( perRepoSetting.default, {} );
    assert.deepEqual( perRepoSetting.additionalProperties, { type: 'string' } );
    assert.strictEqual( perRepoSetting.scope, 'resource' );
    assert.equal( perRepoSetting.markdownDescription, '%newTodosGitBaseBranchPerRepo.description%' );
    assert.notOk(
        hasConfigurationProperty( 'todo-tree.filtering.newTodosGitBaseBranchPerRepo', packageJson.contributes.configuration ),
        'no legacy alias for per-repo setting'
    );
    assert.equal(
        englishNls[ 'newTodosGitBaseBranchPerRepo.description' ],
        'Per-repository version of #better-todo-tree.filtering.newTodosGitBaseBranch# setting. Keys are absolute paths to the git repo root; values are the git branch / revision. Falls back to #better-todo-tree.filtering.newTodosGitBaseBranch# when a repo is missing. Example: { "/home/me/code/repo-a": "main", "/home/me/code/repo-b": "develop" }'
    );
    assert.ok( typeof ( chineseNls[ 'newTodosGitBaseBranchPerRepo.description' ] ) === 'string' && chineseNls[ 'newTodosGitBaseBranchPerRepo.description' ].length > 0 );
} );
```

Update the count assertions in `test/settings.compatibility.test.js`:

```javascript
assert.equal( currentSettings.length, 78 );
assert.equal( legacySettings.length, 75 );
```

- [ ] **Step 2: Run the manifest-focused tests and confirm they fail first**

Run: `npx qunit test/package.manifest.test.js test/settings.compatibility.test.js`

Expected:
- `test/package.manifest.test.js` fails because `better-todo-tree.filtering.newTodosGitBaseBranchPerRepo` and its NLS key do not exist yet.
- `test/settings.compatibility.test.js` fails because the manifest count is still `77`.

- [ ] **Step 3: Add the manifest setting and both NLS strings**

Insert this block in `package.json` between `better-todo-tree.filtering.newTodosGitBaseBranch` and `todo-tree.filtering.newTodosGitBaseBranch`:

```json
"better-todo-tree.filtering.newTodosGitBaseBranchPerRepo": {
    "type": "object",
    "default": {},
    "additionalProperties": {
        "type": "string"
    },
    "markdownDescription": "%newTodosGitBaseBranchPerRepo.description%",
    "scope": "resource"
},
```

Add this line in `package.nls.json` after `"newTodosGitBaseBranch.description"`:

```json
"newTodosGitBaseBranchPerRepo.description": "Per-repository version of #better-todo-tree.filtering.newTodosGitBaseBranch# setting. Keys are absolute paths to the git repo root; values are the git branch / revision. Falls back to #better-todo-tree.filtering.newTodosGitBaseBranch# when a repo is missing. Example: { \"/home/me/code/repo-a\": \"main\", \"/home/me/code/repo-b\": \"develop\" }",
```

Add this line in `package.nls.zh-cn.json` before the closing `}`:

```json
"newTodosGitBaseBranchPerRepo.description": "`#better-todo-tree.filtering.newTodosGitBaseBranch#` 的按仓库版本。键为 git 仓库根目录的绝对路径，值为该仓库要对比的 git 分支或修订。仓库未配置时，会回退到 `#better-todo-tree.filtering.newTodosGitBaseBranch#`。示例：{ \"/home/me/code/repo-a\": \"main\", \"/home/me/code/repo-b\": \"develop\" }"
```

- [ ] **Step 4: Run the manifest-focused tests again**

Run: `npx qunit test/package.manifest.test.js test/settings.compatibility.test.js`

Expected:
- PASS: the new manifest test.
- PASS: the updated settings count assertion.

- [ ] **Step 5: Commit the manifest changes**

```bash
git add package.json package.nls.json package.nls.zh-cn.json test/package.manifest.test.js test/settings.compatibility.test.js
git commit -m "feat(new-todos): add per-repo base branch setting"
```

---

## Task 2: Add failing config tests for per-repo branch resolution

**Files:**
- Modify: `test/config.behavior.test.js`

- [ ] **Step 1: Add the failing config tests**

Update `loadConfigModule()` so the `./extensionIdentity.js` stub can return per-repo values:

```javascript
        './extensionIdentity.js': {
            getSetting: function( setting, defaultValue )
            {
                if( setting === 'ripgrep.ripgrep' )
                {
                    return options.configuredRipgrepPath !== undefined ? options.configuredRipgrepPath : defaultValue;
                }

                if( setting === 'git.path' )
                {
                    return options.configuredGitPath !== undefined ? options.configuredGitPath : defaultValue;
                }

                if( setting === 'filtering.newTodosGitBaseBranch' )
                {
                    return options.newTodosGitBaseBranch !== undefined ? options.newTodosGitBaseBranch : defaultValue;
                }

                if( setting === 'filtering.newTodosGitBaseBranchPerRepo' )
                {
                    return options.newTodosGitBaseBranchPerRepo !== undefined ? options.newTodosGitBaseBranchPerRepo : defaultValue;
                }

                return defaultValue;
            }
        }
```

Append these tests near the end of `test/config.behavior.test.js`:

```javascript
QUnit.test( 'resolveNewTodosGitBaseBranch prefers the per-repo map entry', function( assert )
{
    var config = loadConfigModule( {
        newTodosGitBaseBranch: 'main',
        newTodosGitBaseBranchPerRepo: {
            '/workspace/repo-a': 'develop'
        }
    } );

    assert.equal( config.resolveNewTodosGitBaseBranch( '/workspace/repo-a' ), 'develop' );
} );

QUnit.test( 'resolveNewTodosGitBaseBranch falls back to the global branch when the repo is missing', function( assert )
{
    var config = loadConfigModule( {
        newTodosGitBaseBranch: 'main',
        newTodosGitBaseBranchPerRepo: {
            '/workspace/repo-a': 'develop'
        }
    } );

    assert.equal( config.resolveNewTodosGitBaseBranch( '/workspace/repo-b' ), 'main' );
} );

QUnit.test( 'resolveNewTodosGitBaseBranch treats a blank per-repo value as unset', function( assert )
{
    var config = loadConfigModule( {
        newTodosGitBaseBranch: 'main',
        newTodosGitBaseBranchPerRepo: {
            '/workspace/repo-a': '   '
        }
    } );

    assert.equal( config.resolveNewTodosGitBaseBranch( '/workspace/repo-a' ), 'main' );
} );

QUnit.test( 'resolveNewTodosGitBaseBranch returns blank when both per-repo and global branches are blank', function( assert )
{
    var config = loadConfigModule( {
        newTodosGitBaseBranch: '',
        newTodosGitBaseBranchPerRepo: {
            '/workspace/repo-a': ''
        }
    } );

    assert.equal( config.resolveNewTodosGitBaseBranch( '/workspace/repo-a' ), '' );
} );

QUnit.test( 'resolveNewTodosGitBaseBranch normalizes slash direction and Windows drive-letter case', function( assert )
{
    var config = loadConfigModule( {
        newTodosGitBaseBranch: 'main',
        newTodosGitBaseBranchPerRepo: {
            'C:\\Repo': 'release',
            'D:\\Work\\Tree': 'develop'
        }
    } );

    assert.equal( config.resolveNewTodosGitBaseBranch( 'c:/repo' ), 'release' );
    assert.equal( config.resolveNewTodosGitBaseBranch( 'd:/work/tree' ), 'develop' );
} );

QUnit.test( 'resolveNewTodosGitBaseBranch requires an exact normalized repo-root match', function( assert )
{
    var config = loadConfigModule( {
        newTodosGitBaseBranch: 'main',
        newTodosGitBaseBranchPerRepo: {
            '/workspace/repo-a/subdir': 'develop'
        }
    } );

    assert.equal( config.resolveNewTodosGitBaseBranch( '/workspace/repo-a' ), 'main' );
} );
```

- [ ] **Step 2: Run the config test file and confirm it fails**

Run: `npx qunit test/config.behavior.test.js`

Expected:
- The new tests fail because `config.resolveNewTodosGitBaseBranch` and `config.newTodosGitBaseBranchPerRepo` do not exist yet.

- [ ] **Step 3: Commit the failing config tests**

```bash
git add test/config.behavior.test.js
git commit -m "test(new-todos): cover per-repo base branch resolution"
```

---

## Task 3: Implement config-side per-repo branch resolution

**Files:**
- Modify: `src/config.js:1-6`
- Modify: `src/config.js:411-414`
- Modify: `src/config.js:441-490`
- Test: `test/config.behavior.test.js`

- [ ] **Step 1: Import `diffRootsHelper` and add the two config helpers**

At the top of `src/config.js`, add the missing require:

```javascript
var diffRootsHelper = require( './diffRootsHelper.js' );
```

Add these functions directly after `newTodosGitBaseBranch()`:

```javascript
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

- [ ] **Step 2: Export the new helpers**

Add these exports near the existing new-todos exports at the bottom of `src/config.js`:

```javascript
module.exports.newTodosGitBaseBranch = newTodosGitBaseBranch;
module.exports.newTodosGitBaseBranchPerRepo = newTodosGitBaseBranchPerRepo;
module.exports.resolveNewTodosGitBaseBranch = resolveNewTodosGitBaseBranch;
```

- [ ] **Step 3: Run the config tests again**

Run: `npx qunit test/config.behavior.test.js`

Expected:
- PASS: the new resolution tests.
- PASS: all existing ripgrep config tests.

- [ ] **Step 4: Commit the config implementation**

```bash
git add src/config.js test/config.behavior.test.js
git commit -m "feat(new-todos): resolve base branch per repo"
```

---

## Task 4: Add failing filter tests for per-root resolution and no-branch accounting

**Files:**
- Modify: `test/newTodoFilter.behavior.test.js`

- [ ] **Step 1: Add the failing filter tests**

Append these tests after the existing `extendForRepo` coverage in `test/newTodoFilter.behavior.test.js`:

```javascript
QUnit.test( 'refresh resolves branches per root and marks only blank roots as no-branch', function( assert )
{
    var done = assert.async();
    var diffCalls = [];
    var f = loadFilter( {
        getChangedFilesAndLines: function( branch, root )
        {
            diffCalls.push( { branch: branch, root: root } );
            return Promise.resolve( new Map() );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); }
    } );

    f.init( function() {} );
    f.setEnabled( true );

    f.refresh( function( root )
    {
        if( root === '/mapped' ) { return 'develop'; }
        if( root === '/fallback' ) { return 'main'; }
        return '';
    }, [ '/mapped', '/fallback', '/blank' ], { include: [], exclude: [] } ).then( function( summary )
    {
        assert.equal( summary.allFailed, false );
        assert.deepEqual( diffCalls, [
            { branch: 'develop', root: '/mapped' },
            { branch: 'main', root: '/fallback' }
        ] );
        assert.equal( f.classifyUndiffable( '/blank/file.js' ), 'no-branch' );
        assert.equal( f.classifyUndiffable( '/mapped/file.js' ), null );
        done();
    } );
} );

QUnit.test( 'extendForRepo resolves the branch lazily for a discovered repo', function( assert )
{
    var done = assert.async();
    var seen = [];
    var f = loadFilter( {
        getChangedFilesAndLines: function( branch, root )
        {
            seen.push( { branch: branch, root: root } );
            return Promise.resolve( new Map( [ [ 'a.js', [ [ 1, 1 ] ] ] ] ) );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); }
    } );

    f.init( function() {} );
    f.setEnabled( true );

    f.refresh( function() { return 'main'; }, [ '/existing' ], { include: [], exclude: [] } ).then( function()
    {
        return f.extendForRepo( '/mapped', function( root )
        {
            return root === '/mapped' ? 'release' : 'main';
        }, { include: [], exclude: [] } );
    } ).then( function()
    {
        assert.deepEqual( seen[ seen.length - 1 ], { branch: 'release', root: '/mapped' } );
        assert.equal( f.isNewTodo( path.join( '/mapped', 'a.js' ), 1 ), true );
        done();
    } );
} );

QUnit.test( 'extendForRepo marks blank-resolving repos as known no-branch without running git', function( assert )
{
    var done = assert.async();
    var diffCalls = 0;
    var f = loadFilter( {
        getChangedFilesAndLines: function()
        {
            diffCalls++;
            return Promise.resolve( new Map() );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); }
    } );

    f.init( function() {} );
    f.setEnabled( true );

    f.refresh( function() { return 'main'; }, [ '/existing' ], { include: [], exclude: [] } ).then( function()
    {
        return f.extendForRepo( '/blank', function() { return '   '; }, { include: [], exclude: [] } );
    } ).then( function()
    {
        assert.equal( diffCalls, 1, 'only the initial refresh root ran git' );
        assert.equal( f.isOwningRepoKnown( '/blank' ), true, 'blank repo recorded as known' );
        assert.equal( f.classifyUndiffable( '/blank/a.js' ), 'no-branch' );
        done();
    } );
} );
```

- [ ] **Step 2: Run the filter test file and confirm the new assertions fail**

Run: `npx qunit test/newTodoFilter.behavior.test.js`

Expected:
- The new tests fail because `refresh()` and `extendForRepo()` still expect a branch string, not a resolver function.

- [ ] **Step 3: Commit the failing filter tests**

```bash
git add test/newTodoFilter.behavior.test.js
git commit -m "test(new-todos): cover per-root filter resolution"
```

---

## Task 5: Implement per-root resolution inside newTodoFilter

**Files:**
- Modify: `src/newTodoFilter.js`
- Test: `test/newTodoFilter.behavior.test.js`

- [ ] **Step 1: Replace the global missing-branch state with per-root arrays**

Change the module state near the top of `src/newTodoFilter.js` to this:

```javascript
var coveredRoots = [];
var failedRoots = [];
var noBranchRoots = [];
var pendingRepoExtends = new Map();
var refreshGeneration = 0;
var showUndiffableFiles = true;

function isBlankBranch( branch )
{
    return !branch || String( branch ).trim() === '';
}
```

Update `classifyUndiffable()` so `no-branch` is checked by owning root, not by one module-wide flag:

```javascript
function classifyUndiffable( fsPath )
{
    if( rangesByPath.get( fsPath ) )
    {
        return null;
    }

    var noBranchOwning = findOwningRoot( fsPath, noBranchRoots );
    var coveredOwning = findOwningRoot( fsPath, coveredRoots );
    var failedOwning = findOwningRoot( fsPath, failedRoots );

    if( noBranchOwning !== undefined &&
        ( coveredOwning === undefined || noBranchOwning.length >= coveredOwning.length ) &&
        ( failedOwning === undefined || noBranchOwning.length >= failedOwning.length ) )
    {
        return 'no-branch';
    }

    if( coveredOwning !== undefined && ( failedOwning === undefined || coveredOwning.length >= failedOwning.length ) )
    {
        return null;
    }

    if( failedOwning !== undefined )
    {
        return 'diff-failed';
    }

    return 'no-repo';
}
```

- [ ] **Step 2: Change `refresh()` to accept `resolveBranch(root)` and skip blank roots per repo**

Replace the start of `refresh()` with this shape:

```javascript
function refresh( resolveBranch, roots, globs )
{
    refreshGeneration += 1;
    var generation = refreshGeneration;
    pendingRepoExtends = new Map();

    if( enabled !== true || !roots || roots.length === 0 )
    {
        rangesByPath = new Map();
        coveredRoots = [];
        failedRoots = [];
        noBranchRoots = [];
        return Promise.resolve( { allFailed: false, noBranchRoots: [] } );
    }

    var include = ( globs && globs.include ) || [];
    var exclude = ( globs && globs.exclude ) || [];
    var blankRoots = [];
    var diffableRoots = roots.filter( function( root )
    {
        var branch = resolveBranch( root );
        if( isBlankBranch( branch ) )
        {
            blankRoots.push( root );
            return false;
        }
        return true;
    } );

    if( diffableRoots.length === 0 )
    {
        rangesByPath = new Map();
        coveredRoots = [];
        failedRoots = [];
        noBranchRoots = blankRoots;
        return Promise.resolve( { allFailed: false, noBranchRoots: blankRoots.slice() } );
    }

    return Promise.all( diffableRoots.map( function( root )
    {
        var branch = resolveBranch( root );
        var diffPromise = git.getChangedFilesAndLines( branch, root, include, exclude )
            .then( function( map ) { return { map: map, ok: true, branch: branch }; } )
            .catch( function( error )
            {
                debug( 'newTodoFilter: diff failed for ' + root + ': ' + error.message );
                return { map: new Map(), ok: false, branch: branch };
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
        if( generation !== refreshGeneration )
        {
            return { allFailed: false, noBranchRoots: [] };
        }

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
        noBranchRoots = blankRoots;

        return {
            allFailed: results.length > 0 && results.every( function( r ) { return r.ok === false; } ),
            noBranchRoots: blankRoots.slice()
        };
    } );
}
```

- [ ] **Step 3: Change `extendForRepo()` to use the resolver and record blank repos as known**

Update `isOwningRepoKnown()` and `extendForRepo()` like this:

```javascript
function isOwningRepoKnown( repoRoot )
{
    return coveredRoots.indexOf( repoRoot ) !== -1 ||
        failedRoots.indexOf( repoRoot ) !== -1 ||
        noBranchRoots.indexOf( repoRoot ) !== -1;
}

function extendForRepo( repoRoot, resolveBranch, globs )
{
    if( !repoRoot || isOwningRepoKnown( repoRoot ) )
    {
        return Promise.resolve();
    }

    if( pendingRepoExtends.has( repoRoot ) )
    {
        var pendingExtend = pendingRepoExtends.get( repoRoot );
        if( pendingExtend.generation === refreshGeneration )
        {
            return pendingExtend.promise;
        }
    }

    var branch = resolveBranch( repoRoot );
    if( isBlankBranch( branch ) )
    {
        noBranchRoots.push( repoRoot );
        return Promise.resolve();
    }

    var generation = refreshGeneration;
    var include = ( globs && globs.include ) || [];
    var exclude = ( globs && globs.exclude ) || [];
```

Keep the rest of the git diff merge logic intact, but use the resolved `branch` variable.

- [ ] **Step 4: Run the filter test file again**

Run: `npx qunit test/newTodoFilter.behavior.test.js`

Expected:
- PASS: the new mixed-root and lazy-resolution tests.
- PASS: the existing no-branch behavior tests after adapting them to pass a resolver function instead of a string.

- [ ] **Step 5: Commit the filter implementation**

```bash
git add src/newTodoFilter.js test/newTodoFilter.behavior.test.js
git commit -m "feat(new-todos): track per-repo no-branch roots"
```

---

## Task 6: Add failing extension tests for scan warnings and toggle-on prompting

**Files:**
- Modify: `test/extension.scan-parity.test.js`

- [ ] **Step 1: Add the failing extension tests**

Add these tests near the existing new-todos warning assertions in `test/extension.scan-parity.test.js`:

```javascript
QUnit.test( 'new-todos filter warns when at least one diff root resolves blank', function( assert )
{
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [
            { uri: matrixHelpers.createUri( '/repo-a' ), name: 'repo-a' },
            { uri: matrixHelpers.createUri( '/repo-b' ), name: 'repo-b' }
        ],
        newTodoFilterStub: {
            init: function() {},
            setEnabled: function() {},
            setShowUndiffableFiles: function() {},
            isEnabled: function() { return true; },
            classifyUndiffable: function() { return null; },
            isNewTodo: function() { return true; },
            refresh: function() { return Promise.resolve( { allFailed: false, noBranchRoots: [ '/repo-b' ] } ); }
        },
        configOverrides: {
            newTodosGitBaseBranch: function() { return 'main'; },
            resolveNewTodosGitBaseBranch: function( root )
            {
                return root === '/repo-a' ? 'main' : '';
            }
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.warningMessages.length, 1 );
        assert.equal(
            harness.warningMessages[ 0 ],
            'Better Todo Tree: no base branch set for new-todos filter (set filtering.newTodosGitBaseBranch)',
            'warns when at least one in-scope repo resolves blank'
        );
    } );
} );

QUnit.test( 'enabling new-todos skips the prompt when at least one in-scope repo resolves a branch', function( assert )
{
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [
            { uri: matrixHelpers.createUri( '/repo-a' ), name: 'repo-a' },
            { uri: matrixHelpers.createUri( '/repo-b' ), name: 'repo-b' }
        ],
        openTextDocuments: [
            matrixHelpers.createDocument( '/repo-a/src/a.js', '// TODO a' ),
            matrixHelpers.createDocument( '/repo-b/src/b.js', '// TODO b' )
        ],
        inputBoxResult: 'should-not-be-used',
        configOverrides: {
            shouldShowNewTodosOnly: function() { return false; },
            newTodosGitBaseBranch: function() { return ''; },
            resolveNewTodosGitBaseBranch: function( root )
            {
                return root === '/repo-a' ? 'main' : '';
            }
        },
        gitStub: {
            findRepoRoot: function( dir )
            {
                return Promise.resolve( dir.indexOf( '/repo-a/' ) === 0 ? '/repo-a' : '/repo-b' );
            }
        }
    } );

    harness.extension.activate( harness.context );

    return harness.commands[ 'better-todo-tree.enableNewTodosOnly' ]().then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.inputBoxCalls.length, 0, 'no prompt shown' );
        assert.deepEqual( harness.workspaceStateUpdates[ 0 ], { key: 'newTodosOnly', value: true } );
    } );
} );

QUnit.test( 'enabling new-todos prompts only when all in-scope repos resolve blank', function( assert )
{
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [
            { uri: matrixHelpers.createUri( '/repo-a' ), name: 'repo-a' },
            { uri: matrixHelpers.createUri( '/repo-b' ), name: 'repo-b' }
        ],
        openTextDocuments: [
            matrixHelpers.createDocument( '/repo-a/src/a.js', '// TODO a' ),
            matrixHelpers.createDocument( '/repo-b/src/b.js', '// TODO b' )
        ],
        inputBoxResult: 'develop',
        configOverrides: {
            shouldShowNewTodosOnly: function() { return false; },
            newTodosGitBaseBranch: function() { return ''; },
            resolveNewTodosGitBaseBranch: function() { return ''; }
        },
        gitStub: {
            findRepoRoot: function( dir )
            {
                return Promise.resolve( dir.indexOf( '/repo-a/' ) === 0 ? '/repo-a' : '/repo-b' );
            }
        }
    } );

    harness.extension.activate( harness.context );

    return harness.commands[ 'better-todo-tree.enableNewTodosOnly' ]().then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.inputBoxCalls.length, 1, 'prompt shown once' );
        assert.equal(
            harness.inputBoxCalls[ 0 ].prompt,
            'Git branch / revision to diff against (applies to all repos; for per-repo branches set filtering.newTodosGitBaseBranchPerRepo)'
        );
        assert.deepEqual( harness.configurationUpdates[ 0 ], {
            key: 'filtering.newTodosGitBaseBranch',
            value: 'develop',
            target: harness.vscode.ConfigurationTarget.Workspace
        } );
    } );
} );
```

- [ ] **Step 2: Run the extension parity file and confirm these tests fail first**

Run: `npx qunit test/extension.scan-parity.test.js`

Expected:
- The new warning test fails because `executeRebuild()` still looks only at the global base branch.
- The new toggle tests fail because `doToggleNewTodosOnly()` still prompts whenever the global setting is blank.

- [ ] **Step 3: Commit the failing extension tests**

```bash
git add test/extension.scan-parity.test.js
git commit -m "test(new-todos): cover per-repo warning and prompt logic"
```

---

## Task 7: Thread per-repo resolution through extension.js

**Files:**
- Modify: `src/extension.js:1936-1966`
- Modify: `src/extension.js:2386-2425`
- Modify: `src/extension.js:2555-2569`
- Modify: `src/extension.js:3878-3917`
- Test: `test/extension.scan-parity.test.js`

- [ ] **Step 1: Pass the resolver function to document and notebook refreshes**

Change these two call sites in `src/extension.js`:

```javascript
return ensureRepoForFile( document.uri.fsPath, config.resolveNewTodosGitBaseBranch, getGitDiffGlobs() ).then( function()
```

```javascript
return ensureRepoForFile( notebook.uri.fsPath, config.resolveNewTodosGitBaseBranch, getGitDiffGlobs() ).then( function()
```

- [ ] **Step 2: Update `ensureRepoForFile()` to resolve the branch after repo-root discovery**

Replace `ensureRepoForFile()` with this shape:

```javascript
function ensureRepoForFile( fsPath, resolveBranch, globs )
{
    if( newTodoFilter.isEnabled() !== true || !fsPath )
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

        var branch = resolveBranch( repoRoot );
        if( !branch || String( branch ).trim() === '' )
        {
            return newTodoFilter.extendForRepo( repoRoot, resolveBranch, globs );
        }

        var extendPromise = newTodoFilter.extendForRepo( repoRoot, resolveBranch, globs );
        return raceWithTimeout( extendPromise, config.newTodosGitTimeoutMs(), function()
        {
            reconcileFileAfterLateExtend( fsPath );
        } );
    } );
}
```

The blank-branch branch still calls `extendForRepo()` so the filter can mark the repo as known `no-branch`.

- [ ] **Step 3: Update full-scan refresh and warning logic**

Change the rebuild path to pass the resolver function:

```javascript
return collectDiffRoots( searchList ).then( function( diffRoots )
{
    return newTodoFilter.refresh( config.resolveNewTodosGitBaseBranch, diffRoots, getGitDiffGlobs() );
} ).then( function( summary )
{
    var configuredBaseBranch = config.newTodosGitBaseBranch();
    var hasMissingResolvedBranch = summary && summary.noBranchRoots && summary.noBranchRoots.length > 0;

    if( newTodoFilter.isEnabled() === true && hasMissingResolvedBranch === true )
    {
        vscode.window.showWarningMessage( identity.DISPLAY_NAME + ': no base branch set for new-todos filter (set filtering.newTodosGitBaseBranch)' );
    }
    else if( summary && summary.allFailed === true && newTodoFilter.isEnabled() === true )
    {
        vscode.window.showWarningMessage( identity.DISPLAY_NAME + ": could not compute git diff for new-todos filter (check base branch '" + configuredBaseBranch + "')" );
    }
```

Do not change the `provider.setNewTodoStatus({ baseBranch: config.newTodosGitBaseBranch() })` line.

- [ ] **Step 4: Update the prompt copy and toggle-on decision**

Change `promptForNewTodosBranch()` to this prompt string:

```javascript
return vscode.window.showInputBox( {
    prompt: 'Git branch / revision to diff against (applies to all repos; for per-repo branches set filtering.newTodosGitBaseBranchPerRepo)',
    value: current
} ).then( function( branch )
```

Change `doToggleNewTodosOnly()` so it prompts only when all in-scope repos resolve blank:

```javascript
function doToggleNewTodosOnly()
{
    var current = config.shouldShowNewTodosOnly();
    var turningOn = !current;

    if( turningOn !== true )
    {
        newTodoFilter.setEnabled( false );
        context.workspaceState.update( 'newTodosOnly', false ).then( rebuild );
        return;
    }

    collectDiffRoots( searchList ).then( function( diffRoots )
    {
        var allBlank = diffRoots.length > 0 && diffRoots.every( function( root )
        {
            var branch = config.resolveNewTodosGitBaseBranch( root );
            return !branch || String( branch ).trim() === '';
        } );

        if( allBlank !== true )
        {
            newTodoFilter.setEnabled( true );
            return context.workspaceState.update( 'newTodosOnly', true ).then( rebuild );
        }

        return promptForNewTodosBranch().then( function( didSet )
        {
            if( didSet !== true )
            {
                return;
            }

            newTodoFilter.setEnabled( true );
            return context.workspaceState.update( 'newTodosOnly', true ).then( rebuild );
        } );
    } ).catch( function( err )
    {
        vscode.window.showErrorMessage( identity.DISPLAY_NAME + ': failed to set base branch (' + err.message + ')' );
    } );
}
```

- [ ] **Step 5: Run the extension parity tests again**

Run: `npx qunit test/extension.scan-parity.test.js`

Expected:
- PASS: the new warning and prompt tests.
- PASS: the existing `noBranch` provider-status tests.

- [ ] **Step 6: Commit the extension threading changes**

```bash
git add src/extension.js test/extension.scan-parity.test.js
git commit -m "feat(new-todos): thread per-repo branches through extension"
```

---

## Task 8: Run the focused regression suite and fix anything it finds

**Files:**
- Modify as needed: `src/config.js`
- Modify as needed: `src/newTodoFilter.js`
- Modify as needed: `src/extension.js`
- Modify as needed: `test/package.manifest.test.js`
- Modify as needed: `test/settings.compatibility.test.js`
- Modify as needed: `test/config.behavior.test.js`
- Modify as needed: `test/newTodoFilter.behavior.test.js`
- Modify as needed: `test/extension.scan-parity.test.js`

- [ ] **Step 1: Run the focused regression suite**

Run: `npx qunit test/package.manifest.test.js test/settings.compatibility.test.js test/config.behavior.test.js test/newTodoFilter.behavior.test.js test/extension.scan-parity.test.js`

Expected:
- PASS: all focused tests for manifest, config, filter, and extension behavior.

- [ ] **Step 2: If any test fails, make the minimal fix and rerun the same command**

Use the failure output to make only the smallest necessary code or test change. Common fixes to watch for:

```javascript
// If blank roots are not reported during refresh, make sure the summary keeps them.
return Promise.resolve( { allFailed: false, noBranchRoots: blankRoots.slice() } );

// If ensureRepoForFile incorrectly skips blank repos, keep extendForRepo() on the blank path.
if( !branch || String( branch ).trim() === '' )
{
    return newTodoFilter.extendForRepo( repoRoot, resolveBranch, globs );
}
```

- [ ] **Step 3: Commit the regression fixes if any were needed**

```bash
git add src/config.js src/newTodoFilter.js src/extension.js test/package.manifest.test.js test/settings.compatibility.test.js test/config.behavior.test.js test/newTodoFilter.behavior.test.js test/extension.scan-parity.test.js
git commit -m "test(new-todos): stabilize per-repo base branch coverage"
```

Skip this commit if Step 2 made no changes.

---

## Task 9: Run the full test suite as the final verification

**Files:**
- No code changes expected

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected:
- PASS: the full QUnit suite.

- [ ] **Step 2: If full-suite failures reveal broader assumptions, make the smallest fix and rerun `npm test`**

Keep fixes minimal and local. The most likely fallout points are manifest counts, extension-harness assumptions about config stubs, and any older `newTodoFilter.refresh(...)` call sites still passing a string.

```javascript
// Example of the remaining call-site shape after the feature is complete.
newTodoFilter.refresh( config.resolveNewTodosGitBaseBranch, diffRoots, getGitDiffGlobs() );
```

- [ ] **Step 3: Commit the final verification fix if needed**

```bash
git add src/config.js src/newTodoFilter.js src/extension.js test/package.manifest.test.js test/settings.compatibility.test.js test/config.behavior.test.js test/newTodoFilter.behavior.test.js test/extension.scan-parity.test.js
git commit -m "fix(new-todos): complete per-repo base branch rollout"
```

Skip this commit if Step 2 made no changes.

---

## Self-Review

- Spec coverage:
  - New map setting and NLS copy: Task 1.
  - Resolution in `config.js`: Tasks 2-3.
  - Per-root `refresh()` and `extendForRepo()` behavior: Tasks 4-5.
  - `ensureRepoForFile()` and scan rebuild call sites: Task 7.
  - Per-root `no-branch` warning logic: Tasks 5 and 7.
  - Toggle-on prompt logic and updated prompt copy: Task 7.
  - Tests named in the spec plus manifest compatibility coverage required by the repo: Tasks 1-9.
- Placeholder scan:
  - No `TODO`, `TBD`, or "write tests" placeholders remain.
  - Every code-changing step includes concrete code or exact commands.
- Type consistency:
  - Resolver function name is `resolveNewTodosGitBaseBranch` in config and `resolveBranch` in function parameters.
  - Filter signatures are consistently `refresh( resolveBranch, roots, globs )` and `extendForRepo( repoRoot, resolveBranch, globs )`.
  - Summary shape is consistently `{ allFailed, noBranchRoots }` in both filter and extension tasks.
