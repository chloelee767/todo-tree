# Configurable Git Binary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `src/git.js` run a user-configured git executable, while keeping the current `git`-from-`PATH` behavior when the setting is unset or empty.

**Architecture:** Add a dedicated manifest setting pair, `better-todo-tree.git.path` and the legacy fallback `todo-tree.git.path`, then expose that through `src/config.js` as `config.gitPath()`. Update every git subprocess in `src/git.js` to read that accessor so diff, rev-parse, and status all use the same binary, and cover the change with focused config, git, and manifest tests.

**Tech Stack:** Node.js, CommonJS modules, VS Code extension manifest JSON, QUnit, `child_process.spawn` stubs.

---

## File Structure

- `src/config.js` (Modify) - add the new `gitPath()` accessor next to other config accessors and export it.
- `src/git.js` (Modify) - require `./config.js` and replace hardcoded `'git'` spawn commands with `config.gitPath()`.
- `package.json` (Modify) - add a dedicated Git configuration section with `better-todo-tree.git.path` and `todo-tree.git.path`.
- `package.nls.json` (Modify) - add English strings for the new section title and both current/legacy setting descriptions.
- `package.nls.zh-cn.json` (Modify) - add Chinese strings for the new section title and both current/legacy setting descriptions.
- `test/config.behavior.test.js` (Modify) - add focused tests for `config.gitPath()` default, custom path, and empty-string fallback.
- `test/git.behavior.test.js` (Modify) - stub `./config.js` and assert every `src/git.js` entry point spawns the configured binary.
- `test/package.manifest.test.js` (Modify) - assert the manifest exposes the new settings in a dedicated section and that both NLS bundles contain the matching strings.

## Notes for the implementing engineer

- `src/extensionIdentity.js:146-160` already implements the current-namespace-first, legacy-fallback setting lookup. Do not add any extra compatibility layer in `src/config.js`; just call `identity.getSetting( 'git.path', 'git' )`.
- `src/config.js:246-263` shows the existing pattern for executable-path accessors via `ripgrepPath()`. `gitPath()` should be much smaller because it does not need filesystem probing or caching.
- `src/git.js:32`, `src/git.js:117`, and `src/git.js:167` are the three hardcoded git spawn sites that must all be routed through the new accessor.
- `test/config.behavior.test.js` already stubs `./extensionIdentity.js`; extend that stub instead of introducing a second loader helper.
- `test/git.behavior.test.js` already captures the last `spawn` call. Keep that harness and add one assertion per public git entry point.
- `test/package.manifest.test.js` already uses `getConfigurationProperty(...)` for manifest assertions and direct NLS reads for localization assertions. Follow that style.
- The test runner is `npx qunit`. New test files are not needed for this change; keep the edits inside the three existing targeted test files.

---

### Task 1: Add config coverage for `gitPath()`

**Files:**
- Modify: `test/config.behavior.test.js:26-58`
- Modify: `test/config.behavior.test.js` (append new tests after the existing `ripgrepPath` tests around lines 257-297)
- Modify: `src/config.js:411-484`

- [x] **Step 1: Extend the config test stub and add failing tests**

In `test/config.behavior.test.js`, first replace the `getSetting` stub inside `loadConfigModule(...)` with this version so tests can inject `git.path` values:

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

                return defaultValue;
            }
        }
```

Then append these three tests after the existing `ripgrepPath` coverage and before `newTodosGitBaseBranch returns the configured setting default`:

```javascript
QUnit.test( 'gitPath defaults to git', function( assert )
{
    var config = loadConfigModule();
    config.init( { workspaceState: { get: function( k, d ) { return d; } } } );

    assert.equal( config.gitPath(), 'git', 'defaults to git from PATH' );
} );

QUnit.test( 'gitPath returns a configured custom path', function( assert )
{
    var config = loadConfigModule( {
        configuredGitPath: '/custom/tools/git'
    } );
    config.init( { workspaceState: { get: function( k, d ) { return d; } } } );

    assert.equal( config.gitPath(), '/custom/tools/git', 'returns configured executable path' );
} );

QUnit.test( 'gitPath falls back to git when configured to an empty string', function( assert )
{
    var config = loadConfigModule( {
        configuredGitPath: ''
    } );
    config.init( { workspaceState: { get: function( k, d ) { return d; } } } );

    assert.equal( config.gitPath(), 'git', 'treats empty string like the default command' );
} );
```

- [x] **Step 2: Run the focused config tests and confirm they fail first**

Run: `npx qunit test/config.behavior.test.js`

Expected before implementing `src/config.js`:
- FAIL: `gitPath defaults to git`
- FAIL: `gitPath returns a configured custom path`
- FAIL: `gitPath falls back to git when configured to an empty string`
- Existing `ripgrepPath` and new-todos config tests still pass

The failure should be `TypeError: config.gitPath is not a function`.

- [x] **Step 3: Implement `config.gitPath()` in `src/config.js`**

In `src/config.js`, add this function immediately after `newTodosGitTimeoutMs()` and before `shouldShowNewTodosOnly()`:

```javascript
function gitPath()
{
    return identity.getSetting( 'git.path', 'git' ) || 'git';
}
```

Then export it by inserting this line with the other module exports near `module.exports.newTodosGitTimeoutMs`:

```javascript
module.exports.gitPath = gitPath;
```

The export block should end up like this around the new line:

```javascript
module.exports.newTodosGitBaseBranch = newTodosGitBaseBranch;
module.exports.newTodosShowUndiffableFiles = newTodosShowUndiffableFiles;
module.exports.newTodosGitTimeoutMs = newTodosGitTimeoutMs;
module.exports.gitPath = gitPath;
module.exports.shouldShowNewTodosOnly = shouldShowNewTodosOnly;
module.exports.shouldPassGlobsToGitDiff = shouldPassGlobsToGitDiff;
```

- [x] **Step 4: Re-run the focused config tests and confirm they pass**

Run: `npx qunit test/config.behavior.test.js`

Expected:
- PASS: all `gitPath` tests
- PASS: all pre-existing tests in `test/config.behavior.test.js`

- [x] **Step 5: Commit the config change**

```bash
git add test/config.behavior.test.js src/config.js
git commit -m "feat(config): add configurable git executable path"
```

---

### Task 2: Route every git subprocess through `config.gitPath()`

**Files:**
- Modify: `test/git.behavior.test.js:18-87`
- Modify: `test/git.behavior.test.js` (append new tests after the existing spawn-argument tests)
- Modify: `src/git.js:1-2`
- Modify: `src/git.js:32`
- Modify: `src/git.js:117`
- Modify: `src/git.js:167`

- [x] **Step 1: Stub `./config.js` in the git behavior harness and add failing tests**

In `test/git.behavior.test.js`, update `loadGitWithStubbedSpawn(...)` so the loaded module receives a configurable git path. Replace the `helpers.loadWithStubs(...)` call with this block:

```javascript
    var git = helpers.loadWithStubs( '../src/git.js', {
        child_process: {
            spawn: function( command, args, spawnOptions )
            {
                lastSpawnCall = {
                    command: command,
                    args: args,
                    options: spawnOptions
                };

                var proc = new EventEmitter();
                var stdoutChunks = stdoutLines.map( function( l ) { return l + "\n"; } );
                if( options.stdout !== undefined )
                {
                    stdoutChunks = [ options.stdout ];
                }

                proc.stdout = new Readable( { read: function() {} } );
                proc.stderr = new EventEmitter();

                process.nextTick( function()
                {
                    if( options.spawnError )
                    {
                        proc.emit( 'error', options.spawnError );
                        return;
                    }

                    stdoutChunks.forEach( function( chunk )
                    {
                        proc.stdout.push( chunk );
                    } );
                    proc.stdout.push( null );

                    if( stderrData !== undefined )
                    {
                        proc.stderr.emit( 'data', stderrData );
                    }

                    if( options.stderr !== undefined )
                    {
                        proc.stderr.emit( 'data', options.stderr );
                    }

                    if( options.exitAfterStdout )
                    {
                        proc.stdout.on( 'end', function()
                        {
                            proc.emit( 'exit', exitCode !== undefined ? exitCode : 0 );
                        } );
                        return;
                    }

                    proc.emit( 'exit', exitCode !== undefined ? exitCode : 0 );
                } );

                return proc;
            }
        },
        './config.js': {
            gitPath: function()
            {
                return options.configuredGitPath || 'git';
            }
        }
    } );
```

Then append these tests after `getUntrackedFiles: spawns git status with --porcelain -uall`:

```javascript
QUnit.test( 'getChangedFilesAndLines uses the configured git binary for diff', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( {
        stdoutLines: [ 'diff --git a.js a.js', '@@ -1,0 +3,1 @@' ],
        configuredGitPath: '/custom/bin/git'
    } );
    git.init( function() {} );

    git.getChangedFilesAndLines( 'main', '/repo', [], [] ).then( function()
    {
        assert.strictEqual( git._lastSpawnCall.command, '/custom/bin/git', 'diff uses configured git path' );
        done();
    } );
} );

QUnit.test( 'findRepoRoot uses the configured git binary for rev-parse', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( {
        stdout: '/repo/root\n',
        exitCode: 0,
        exitAfterStdout: true,
        configuredGitPath: '/custom/bin/git'
    } );
    git.init( function() {} );

    git.findRepoRoot( '/repo/subdir' ).then( function()
    {
        assert.strictEqual( git._lastSpawnCall.command, '/custom/bin/git', 'rev-parse uses configured git path' );
        done();
    } );
} );

QUnit.test( 'getUntrackedFiles uses the configured git binary for status', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( {
        stdoutLines: [ '?? newfile.js' ],
        configuredGitPath: '/custom/bin/git'
    } );
    git.init( function() {} );

    git.getUntrackedFiles( '/repo', [], [] ).then( function()
    {
        assert.strictEqual( git._lastSpawnCall.command, '/custom/bin/git', 'status uses configured git path' );
        done();
    } );
} );
```

- [x] **Step 2: Run the focused git behavior tests and confirm the new assertions fail first**

Run: `npx qunit test/git.behavior.test.js`

Expected before implementing `src/git.js`:
- FAIL: `getChangedFilesAndLines uses the configured git binary for diff`
- FAIL: `findRepoRoot uses the configured git binary for rev-parse`
- FAIL: `getUntrackedFiles uses the configured git binary for status`

Each new failure should show `actual: git` and `expected: /custom/bin/git`.

- [x] **Step 3: Update `src/git.js` to require config and use `config.gitPath()` everywhere**

At the top of `src/git.js`, add the config import:

```javascript
const { spawn } = require( 'child_process' );
const readline = require( 'readline' );
var config = require( './config.js' );
```

Then replace the three hardcoded spawn calls.

Replace:

```javascript
        const gitDiff = spawn( 'git', args, { cwd: repoPath } );
```

with:

```javascript
        const gitDiff = spawn( config.gitPath(), args, { cwd: repoPath } );
```

Replace:

```javascript
        const proc = spawn( 'git', args );
```

with:

```javascript
        const proc = spawn( config.gitPath(), args );
```

Replace:

```javascript
        const proc = spawn( 'git', args, { cwd: repoRoot } );
```

with:

```javascript
        const proc = spawn( config.gitPath(), args, { cwd: repoRoot } );
```

Do not change any debug messages, arguments, cwd handling, error handling, or result parsing.

- [x] **Step 4: Re-run the focused git behavior tests and confirm they pass**

Run: `npx qunit test/git.behavior.test.js`

Expected:
- PASS: the three new configured-binary tests
- PASS: the pre-existing behavioral git tests

- [x] **Step 5: Commit the git wiring change**

```bash
git add test/git.behavior.test.js src/git.js
git commit -m "feat(git): use configured git executable"
```

---

### Task 3: Add the manifest setting and localization

**Files:**
- Modify: `test/package.manifest.test.js:62-74`
- Modify: `test/package.manifest.test.js:116-169`
- Modify: `package.json:2099-2155`
- Modify: `package.nls.json:194-203`
- Modify: `package.nls.zh-cn.json:192-201`

- [x] **Step 1: Add failing manifest and NLS assertions**

In `test/package.manifest.test.js`, insert this new test after `ripgrep executable setting documents packaged binary behavior`:

```javascript
QUnit.test( 'git executable setting has current and legacy keys with PATH fallback wording', function( assert )
{
    var englishNls = readPackageNls( 'package.nls.json' );

    assert.equal( englishNls[ 'todo-tree.configuration.git.path.markdownDescription' ], 'Custom git executable path. Empty or unset uses the normal git from PATH.' );
    assert.equal( englishNls[ 'better-todo-tree.configuration.git.path.markdownDescription' ], 'Custom git executable path. Empty or unset uses the normal git from PATH.' );
} );
```

Then insert this new manifest-focused test after `new filtering settings are declared under better-todo-tree only`:

```javascript
QUnit.test( 'git executable setting is declared in a dedicated git section for current and legacy namespaces', function( assert )
{
    var packageJson = readPackageJson();
    var englishNls = readPackageNls( 'package.nls.json' );
    var chineseNls = readPackageNls( 'package.nls.zh-cn.json' );
    var currentSetting = getConfigurationProperty( 'better-todo-tree.git.path' );
    var legacySetting = getConfigurationProperty( 'todo-tree.git.path' );
    var gitSection = packageJson.contributes.configuration.find( function( section )
    {
        return section.title === '%better-todo-tree.configuration.git%';
    } );

    assert.ok( gitSection, 'git section exists' );
    assert.strictEqual( gitSection.order, 8 );
    assert.ok( currentSetting, 'current setting exists' );
    assert.strictEqual( currentSetting.type, 'string' );
    assert.strictEqual( currentSetting.default, 'git' );
    assert.equal( currentSetting.markdownDescription, '%better-todo-tree.configuration.git.path.markdownDescription%' );
    assert.ok( legacySetting, 'legacy setting exists' );
    assert.strictEqual( legacySetting.type, 'string' );
    assert.strictEqual( legacySetting.default, 'git' );
    assert.equal( legacySetting.markdownDescription, '%better-todo-tree.configuration.git.path.markdownDescription%' );
    assert.equal( legacySetting.deprecationMessage, '%todo-tree.configuration.legacyNamespace.deprecationMessage%' );
    assert.equal( legacySetting.markdownDeprecationMessage, '%todo-tree.configuration.legacyNamespace.markdownDeprecationMessage%' );
    assert.equal( englishNls[ 'todo-tree.configuration.git' ], 'Git' );
    assert.equal( englishNls[ 'better-todo-tree.configuration.git' ], 'Git' );
    assert.equal( chineseNls[ 'todo-tree.configuration.git' ], 'Git' );
    assert.equal( chineseNls[ 'better-todo-tree.configuration.git' ], 'Git' );
    assert.equal( chineseNls[ 'todo-tree.configuration.git.path.markdownDescription' ], '自定义 git 可执行文件路径。空值或未设置时，使用 PATH 中的普通 git。' );
    assert.equal( chineseNls[ 'better-todo-tree.configuration.git.path.markdownDescription' ], '自定义 git 可执行文件路径。空值或未设置时，使用 PATH 中的普通 git。' );
} );
```

- [x] **Step 2: Run the manifest tests and confirm they fail first**

Run: `npx qunit test/package.manifest.test.js`

Expected before updating the manifest files:
- FAIL: `git executable setting has current and legacy keys with PATH fallback wording`
- FAIL: `git executable setting is declared in a dedicated git section for current and legacy namespaces`

The likely failures are missing NLS keys and `currentSetting` / `legacySetting` being `undefined`.

- [x] **Step 3: Add the Git settings section to `package.json`**

In `package.json`, leave the existing ripgrep properties where they are and append a new configuration section after the current Ripgrep section (`package.json:2125-2155`). Add this exact block before the closing `]` of `contributes.configuration`:

```json
            },
            {
                "title": "%better-todo-tree.configuration.git%",
                "order": 8,
                "type": "object",
                "properties": {
                    "better-todo-tree.git.path": {
                        "default": "git",
                        "markdownDescription": "%better-todo-tree.configuration.git.path.markdownDescription%",
                        "type": "string"
                    },
                    "todo-tree.git.path": {
                        "default": "git",
                        "markdownDescription": "%better-todo-tree.configuration.git.path.markdownDescription%",
                        "type": "string",
                        "deprecationMessage": "%todo-tree.configuration.legacyNamespace.deprecationMessage%",
                        "markdownDeprecationMessage": "%todo-tree.configuration.legacyNamespace.markdownDeprecationMessage%"
                    }
                }
```

When you apply it, the end of `contributes.configuration` should look like this:

```json
            {
                "title": "%better-todo-tree.configuration.ripgrep%",
                "order": 7,
                "type": "object",
                "properties": {
                    "better-todo-tree.ripgrep.ripgrepMaxBuffer": {
                        "default": 200,
                        "markdownDescription": "%better-todo-tree.configuration.ripgrep.ripgrepMaxBuffer.markdownDescription%",
                        "type": "integer"
                    },
                    "todo-tree.ripgrep.ripgrepMaxBuffer": {
                        "default": 200,
                        "markdownDescription": "%better-todo-tree.configuration.ripgrep.ripgrepMaxBuffer.markdownDescription%",
                        "type": "integer",
                        "deprecationMessage": "%todo-tree.configuration.legacyNamespace.deprecationMessage%",
                        "markdownDeprecationMessage": "%todo-tree.configuration.legacyNamespace.markdownDeprecationMessage%"
                    },
                    "better-todo-tree.ripgrep.usePatternFile": {
                        "default": true,
                        "markdownDescription": "%better-todo-tree.configuration.ripgrep.usePatternFile.markdownDescription%",
                        "type": "boolean"
                    },
                    "todo-tree.ripgrep.usePatternFile": {
                        "default": true,
                        "markdownDescription": "%better-todo-tree.configuration.ripgrep.usePatternFile.markdownDescription%",
                        "type": "boolean",
                        "deprecationMessage": "%todo-tree.configuration.legacyNamespace.deprecationMessage%",
                        "markdownDeprecationMessage": "%todo-tree.configuration.legacyNamespace.markdownDeprecationMessage%"
                    }
                }
            },
            {
                "title": "%better-todo-tree.configuration.git%",
                "order": 8,
                "type": "object",
                "properties": {
                    "better-todo-tree.git.path": {
                        "default": "git",
                        "markdownDescription": "%better-todo-tree.configuration.git.path.markdownDescription%",
                        "type": "string"
                    },
                    "todo-tree.git.path": {
                        "default": "git",
                        "markdownDescription": "%better-todo-tree.configuration.git.path.markdownDescription%",
                        "type": "string",
                        "deprecationMessage": "%todo-tree.configuration.legacyNamespace.deprecationMessage%",
                        "markdownDeprecationMessage": "%todo-tree.configuration.legacyNamespace.markdownDeprecationMessage%"
                    }
                }
            }
```

- [x] **Step 4: Add the English and Chinese NLS entries**

In `package.nls.json`, insert these four entries next to the existing Ripgrep strings:

```json
    "todo-tree.configuration.git": "Git",
    "better-todo-tree.configuration.git": "Git",
    "todo-tree.configuration.git.path.markdownDescription": "Custom git executable path. Empty or unset uses the normal git from PATH.",
    "better-todo-tree.configuration.git.path.markdownDescription": "Custom git executable path. Empty or unset uses the normal git from PATH.",
```

In `package.nls.zh-cn.json`, insert these four entries next to the existing Ripgrep strings:

```json
    "todo-tree.configuration.git": "Git",
    "better-todo-tree.configuration.git": "Git",
    "todo-tree.configuration.git.path.markdownDescription": "自定义 git 可执行文件路径。空值或未设置时，使用 PATH 中的普通 git。",
    "better-todo-tree.configuration.git.path.markdownDescription": "自定义 git 可执行文件路径。空值或未设置时，使用 PATH 中的普通 git。",
```

- [x] **Step 5: Re-run the manifest tests and confirm the new git-setting assertions pass**

Known unrelated failure remains in this file while the new git-setting assertions pass:
- `new todos context menu entries sit below scan mode in their own group`

Run: `npx qunit test/package.manifest.test.js`

Expected:
- PASS: the two new git manifest tests
- PASS: the pre-existing manifest tests

- [x] **Step 6: Commit the manifest and localization change**

```bash
git add test/package.manifest.test.js package.json package.nls.json package.nls.zh-cn.json
git commit -m "feat(manifest): add configurable git binary setting"
```

---

### Task 4: Final verification

**Files:** none

- [x] **Step 1: Run the three focused test files together**

Run: `npx qunit test/config.behavior.test.js test/git.behavior.test.js test/package.manifest.test.js`

Expected:
- All tests in the three touched files pass
- No failures mention `gitPath`, `better-todo-tree.git.path`, `todo-tree.git.path`, or configured git binary behavior

Actual:
- Config and git focused tests passed
- New git-setting manifest assertions passed
- One unrelated pre-existing manifest failure remains: `new todos context menu entries sit below scan mode in their own group`

- [x] **Step 2: Run the full suite once to check for regressions outside the touched area**

Run: `npx qunit`

Expected:
- No new failures introduced by this change
- If the repo already has unrelated failures, confirm they are unrelated to `config`, `git`, or `package manifest`

Actual:
- New git-setting work required one compatibility-count update in `test/settings.compatibility.test.js`, which now passes
- Remaining full-suite failures are unrelated to `config`, `git`, or `package manifest`: one pre-existing manifest group assertion, perf environment failures, and shell/release workflow failures on this macOS environment

- [x] **Step 3: Review the final diff before handing off**

Run: `git diff -- src/config.js src/git.js package.json package.nls.json package.nls.zh-cn.json test/config.behavior.test.js test/git.behavior.test.js test/package.manifest.test.js`

Expected in the diff:
- `src/config.js` contains exactly one new accessor, `gitPath()`
- `src/git.js` uses `config.gitPath()` in all three spawn sites
- `package.json` contains a dedicated Git section with current and legacy keys defaulting to `"git"`
- Both NLS bundles define the new Git title and description strings
- The three touched test files each have focused, minimal assertions for this feature only

---
