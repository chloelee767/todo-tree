# Design: Default toggleNewTodosOnly tree button to enabled

## Goal

Make the `tree.buttons.toggleNewTodosOnly` setting default to `true` so the
tree view button for toggling new-todos-only mode is shown by default.

Because this feature is still in development, the default should change in both
the current public namespace and the deprecated legacy namespace:

1. `better-todo-tree.tree.buttons.toggleNewTodosOnly`
2. `todo-tree.tree.buttons.toggleNewTodosOnly`

## Chosen approach

Use the manifest as the only source of truth for the default value.

This means changing the `default` field for both settings in `package.json`
from `false` to `true`, and leaving runtime code unchanged.

## Alternatives considered

### 1. Manifest-only default change without a test

This is the smallest possible code change, but it leaves the new default more
exposed to future regressions.

### 2. Runtime fallback override

This would keep the manifest unchanged and force `true` in code when the user
has not set a value. It was rejected because it duplicates the manifest's role,
adds unnecessary complexity, and can drift from the Settings UI.

## Implementation

### Manifest

Update these two configuration entries in `package.json`:

1. `better-todo-tree.tree.buttons.toggleNewTodosOnly`
2. `todo-tree.tree.buttons.toggleNewTodosOnly`

For both, change:

```json
"default": false
```

to:

```json
"default": true
```

### Tests

Add one focused manifest test in `test/package.manifest.test.js`.

The test should follow the existing repo pattern for manifest assertions:

1. Look up both settings with `getConfigurationProperty(...)`
2. Assert that each `.default` value is `true`

This keeps the change aligned with existing tests that validate defaults across
the current and legacy namespaces together.

### Runtime behavior

Do not change `src/extension.js` or any other runtime code.

The extension already reads the resolved setting value, so once the manifest
default changes, the button will appear by default for users who have not set a
value explicitly.

## Expected behavior

### Fresh or unset configurations

Users with no explicit setting value will see the toggle button by default.

### Existing explicit settings

Users who already set either namespace explicitly keep their chosen value.

No migration or forced override is needed.

## Risks

This is a low-risk change.

The main regression risk is changing only one namespace and leaving the other at
the old default. The manifest test addresses that directly.

## Verification

Run the manifest/settings test subset after the change, focusing on the tests
that validate package configuration behavior.

## Out of scope

1. Runtime overrides for unset values
2. Migration logic for existing user settings
3. Any behavior changes to the new-todos-only filter itself
