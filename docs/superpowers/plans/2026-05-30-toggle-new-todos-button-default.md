# Toggle New Todos Button Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `tree.buttons.toggleNewTodosOnly` setting default to `true` in both current and legacy namespaces so the tree button is shown by default.

**Architecture:** Keep `package.json` as the single source of truth for the setting default. Change both manifest entries from `false` to `true` and add one focused manifest test in `test/package.manifest.test.js` that verifies both defaults together.

**Tech Stack:** Node.js, VS Code extension manifest (`package.json`), QUnit (`npx qunit`, `npm test`).

---

## File Structure

- **Modify** `package.json:1970-1978` — flip the default for both `toggleNewTodosOnly` settings to `true`.
- **Modify** `test/package.manifest.test.js:100-107` — add a focused QUnit test that asserts both namespace defaults are `true`.

---

### Task 1: Flip the manifest default and lock it with a manifest test

**Files:**
- Modify: `package.json:1970-1978`
- Modify: `test/package.manifest.test.js:100-107`

- [ ] **Step 1: Add the failing manifest test**

Insert this test after the existing notebook-schemes default test in `test/package.manifest.test.js`:

```js
QUnit.test( 'toggle new todos only button defaults to enabled in both namespaces', function( assert )
{
    var currentButtonSetting = getConfigurationProperty( 'better-todo-tree.tree.buttons.toggleNewTodosOnly' );
    var legacyButtonSetting = getConfigurationProperty( 'todo-tree.tree.buttons.toggleNewTodosOnly' );

    assert.strictEqual( currentButtonSetting.default, true );
    assert.strictEqual( legacyButtonSetting.default, true );
} );
```

- [ ] **Step 2: Run the targeted manifest test to verify it fails**

Run: `npx qunit test/package.manifest.test.js`
Expected: FAIL with an assertion showing the current default is `false`.

- [ ] **Step 3: Change both manifest defaults to `true`**

Update `package.json` so the two settings read:

```json
"better-todo-tree.tree.buttons.toggleNewTodosOnly": {
    "type": "boolean",
    "default": true,
    "markdownDescription": "%treeButtons.toggleNewTodosOnly%"
},
"todo-tree.tree.buttons.toggleNewTodosOnly": {
    "type": "boolean",
    "default": true,
    "markdownDescription": "%treeButtons.toggleNewTodosOnly%",
    "deprecationMessage": "%todo-tree.configuration.legacyNamespace.deprecationMessage%",
    "markdownDeprecationMessage": "%todo-tree.configuration.legacyNamespace.markdownDeprecationMessage%"
}
```

- [ ] **Step 4: Run the targeted manifest test to verify it passes**

Run: `npx qunit test/package.manifest.test.js`
Expected: PASS with the new default test green.

- [ ] **Step 5: Run the full test suite for regression coverage**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit the change**

```bash
git add package.json test/package.manifest.test.js
git commit -m "feat: enable new todos toggle button by default"
```
