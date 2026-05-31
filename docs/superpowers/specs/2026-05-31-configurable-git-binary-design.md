# Design: configurable git binary

## Goal

Allow `src/git.js` to use a configured git executable instead of always spawning
plain `git` from `PATH`.

Required behavior:

1. a user can set a git binary path in settings
2. when that setting is unset or empty, behavior stays exactly the same as today
3. all git subprocesses in `src/git.js` use the same configured value

## Chosen approach

Add a new dedicated setting:

`better-todo-tree.git.path`

Expose it through `src/config.js` as `config.gitPath()`, with default `'git'`.
Then update `src/git.js` to use that accessor instead of hardcoding `'git'` in
each `spawn(...)` call.

This keeps the change small, matches the requested dedicated git section, and
fits the repo's existing pattern of executable-path settings such as
`better-todo-tree.ripgrep.ripgrep`.

## Alternatives considered

### 1. Put the setting under `filtering`

Example: `better-todo-tree.filtering.gitPath`

This would place it near `newTodosGitBaseBranch`, but `src/git.js` is not only
used for the new-todos filter. It also handles repo-root discovery and
untracked-file queries. A filtering-only setting would therefore be a weaker
fit.

### 2. Mirror the ripgrep key shape exactly

Example: `better-todo-tree.git.git`

This is consistent mechanically, but the setting name is awkward and less clear
than `git.path`.

## Implementation

### Manifest and settings text

Update `package.json` to add:

1. `better-todo-tree.git.path`
2. `todo-tree.git.path`

Use a dedicated git configuration section title so the setting is grouped
cleanly in the settings UI.

The setting should:

1. be a string
2. default to `"git"`
3. describe that empty or unset uses the normal `git` from `PATH`

Add matching strings in `package.nls.json` and `package.nls.zh-cn.json`.

Including the legacy namespace keeps the config surface consistent with most of
the existing settings model, where `extensionIdentity.getSetting(...)` reads the
current namespace first and then falls back to the legacy one if it has an
explicit value.

### `src/config.js`

Add:

```js
function gitPath()
{
    return identity.getSetting( 'git.path', 'git' ) || 'git';
}
```

Export it alongside the other config accessors.

Why `|| 'git'` instead of only relying on the default value:

1. it preserves the current behavior when the setting is explicitly set to `''`
2. it matches the requested fallback semantics for both unset and empty values
3. it avoids pushing blank-command handling into `src/git.js`

No filesystem existence check is added. This setting should behave like a normal
command path: if the user points it to something invalid, the existing spawn
error path should surface the failure.

### `src/git.js`

Read the configured binary once per operation and use it for all git commands:

1. `getChangedFilesAndLines(...)`
2. `findRepoRoot(...)`
3. `getUntrackedFiles(...)`

Implementation detail:

1. add `var config = require( './config.js' );`
2. replace each hardcoded `spawn( 'git', ... )` with `spawn( config.gitPath(), ... )`

No other behavior changes:

1. arguments stay the same
2. working directories stay the same
3. stderr and exit handling stay the same

## Expected behavior

When `better-todo-tree.git.path` is:

1. unset: commands still run as `git ...`
2. `''`: commands still run as `git ...`
3. `/custom/bin/git`: commands run as `/custom/bin/git ...`

This applies to diff, status, and rev-parse calls.

## Risks

This is low risk.

The main risk is choosing a bad configured command path. That is acceptable and
should fail through the existing subprocess error handling, which is already the
normal failure path for git invocation problems.

Another small risk is forgetting to route one call site through the new config.
Tests should cover all three `src/git.js` entry points to prevent that.

## Verification

Add or update the smallest focused tests for:

1. `config.gitPath()` defaulting to `git`
2. `config.gitPath()` returning a configured custom path
3. `src/git.js` using the configured binary for diff
4. `src/git.js` using the configured binary for rev-parse
5. `src/git.js` using the configured binary for status
6. package manifest and NLS entries for the new setting

## Files touched

1. `package.json`
2. `package.nls.json`
3. `package.nls.zh-cn.json`
4. `src/config.js`
5. `src/git.js`
6. `test/config.behavior.test.js`
7. `test/git.behavior.test.js`
8. `test/package.manifest.test.js`
