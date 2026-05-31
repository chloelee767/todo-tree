# New-todos Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new-todos filter commands to the todo tree right-click context menu in their own section below scan mode settings.

**Architecture:** This is a manifest-first change. The commands, handlers, and localized titles already exist, so implementation is limited to exposing the commands in `contributes.menus["view/item/context"]` and extending the existing manifest test to lock in the new entries and group ordering.

**Tech Stack:** VS Code extension manifest (`package.json`), QUnit manifest tests, Node.js test runner

---

## File map

- Modify: `package.json`
  - Add `view/item/context` entries for `enableNewTodosOnly`, `disableNewTodosOnly`, and `newTodosChangeBranch`
  - Insert a new `4-new-todos` group below `3-view`
  - Renumber later context-menu groups from `4-tree`/`5-misc1`/`6-misc2` to `5-tree`/`6-misc1`/`7-misc2`
- Modify: `test/package.manifest.test.js`
  - Add or extend one manifest test that asserts the new context-menu entries and group ordering

## Pre-checks

- The commands already exist in `package.json:585-599`
- The english localization keys already exist in `package.nls.json:297-299`
- The command handlers already exist in `src/extension.js:3910-3919`
- The command identities already exist in `src/extensionIdentity.js:48-50`

No runtime code or localization changes are needed for this task.

### Task 1: Lock in manifest behavior with a failing test

**Files:**
- Modify: `test/package.manifest.test.js`
- Reference: `package.json:194-329`

- [x] **Step 1: Write the failing test**

Add a new QUnit test near the existing `view/item/context` assertions.

```js
QUnit.test( 'new todos context menu entries sit below scan mode in their own group', function( assert )
{
    var packageJson = readPackageJson();
    var contextMenu = packageJson.contributes.menus[ 'view/item/context' ];
    var newTodosEntries = contextMenu.filter( function( entry )
    {
        return [
            'better-todo-tree.enableNewTodosOnly',
            'better-todo-tree.disableNewTodosOnly',
            'better-todo-tree.newTodosChangeBranch'
        ].indexOf( entry.command ) !== -1;
    } );
    var expandEntry = contextMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.expand';
    } );
    var exportEntry = contextMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.exportTree';
    } );
    var revealEntry = contextMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.reveal';
    } );

    assert.deepEqual( newTodosEntries, [
        {
            command: 'better-todo-tree.enableNewTodosOnly',
            when: 'view =~ /todo-tree/ && better-todo-tree-new-todos-only == false',
            group: '4-new-todos'
        },
        {
            command: 'better-todo-tree.disableNewTodosOnly',
            when: 'view =~ /todo-tree/ && better-todo-tree-new-todos-only == true',
            group: '4-new-todos'
        },
        {
            command: 'better-todo-tree.newTodosChangeBranch',
            when: 'view =~ /todo-tree/ && better-todo-tree-new-todos-only == true',
            group: '4-new-todos'
        }
    ] );
    assert.equal( expandEntry.group, '5-tree@1' );
    assert.equal( exportEntry.group, '6-misc1' );
    assert.equal( revealEntry.group, '7-misc2' );
} );
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- --filter "new todos context menu entries sit below scan mode in their own group"`

Expected: FAIL because the new context-menu entries are missing and the old later-group names are still present.

- [x] **Step 3: Commit the failing test only if the repo convention allows it**

Do not commit a red state unless the user explicitly wants that workflow. Normally, continue directly to the implementation step.

### Task 2: Add the menu entries in the manifest

**Files:**
- Modify: `package.json:194-329`
- Test: `test/package.manifest.test.js`

- [x] **Step 1: Add the new context-menu entries**

In `contributes.menus["view/item/context"]`, insert these objects immediately after the existing `3-view` scan mode entries:

```json
{
    "command": "better-todo-tree.enableNewTodosOnly",
    "when": "view =~ /todo-tree/ && better-todo-tree-new-todos-only == false",
    "group": "4-new-todos"
},
{
    "command": "better-todo-tree.disableNewTodosOnly",
    "when": "view =~ /todo-tree/ && better-todo-tree-new-todos-only == true",
    "group": "4-new-todos"
},
{
    "command": "better-todo-tree.newTodosChangeBranch",
    "when": "view =~ /todo-tree/ && better-todo-tree-new-todos-only == true",
    "group": "4-new-todos"
}
```

- [x] **Step 2: Renumber the later context-menu groups**

Update the existing entries in the same `view/item/context` array:

```json
"group": "4-tree@1"  ->  "group": "5-tree@1"
"group": "4-tree@2"  ->  "group": "5-tree@2"
"group": "4-tree@3"  ->  "group": "5-tree@3"
"group": "4-tree@4"  ->  "group": "5-tree@4"
"group": "4-tree@5"  ->  "group": "5-tree@5"
"group": "4-tree@6"  ->  "group": "5-tree@6"
"group": "5-misc1"   ->  "group": "6-misc1"
"group": "6-misc2"   ->  "group": "7-misc2"
```

- [x] **Step 3: Run the focused test to verify it passes**

Run: `npm test -- --filter "new todos context menu entries sit below scan mode in their own group"`

Expected: PASS.

- [x] **Step 4: Run the broader manifest test file**

Run: `npm test -- test/package.manifest.test.js`

Expected: PASS with the existing manifest assertions still green.

- [x] **Step 5: Review the final diff**

Run: `git diff -- package.json test/package.manifest.test.js`

Expected:
- `package.json` only changes `view/item/context`
- `test/package.manifest.test.js` adds one focused assertion block
- no runtime source files or localization files are modified

- [x] **Step 6: Commit the implementation**

```bash
git add package.json test/package.manifest.test.js
git commit -m "feat(menu): add new todos context menu items"
```

### Task 3: Manual verification in VS Code

**Files:**
- Reference: `package.json`

- [x] **Step 1: Launch the extension host**

Run the repo's normal VS Code extension debug flow.

Expected: the extension host opens with the todo tree view available.

- [ ] **Step 2: Verify filter-off state**

In the todo tree, right-click an item while `new todos only` is off.

Expected:
- the scan mode section still appears
- a separate section below it contains `Show New Todos Only`
- `Show All Todos` is absent
- `New Todos: Change Base Branch` is absent

- [ ] **Step 3: Verify filter-on state**

Turn on `new todos only`, then right-click an item again.

Expected:
- the separate new-todos section now contains `Show All Todos`
- `New Todos: Change Base Branch` appears in the same section
- `Show New Todos Only` is absent

- [ ] **Step 4: Confirm unrelated groups remain below the new section**

Expected:
- tree actions remain below the new-todos group
- export remains below tree actions
- reveal remains below export

## Self-review checklist

- Spec coverage:
  - Add three context-menu entries: covered in Task 2, Step 1
  - Place them in a separate group below scan mode: covered in Task 1 and Task 2
  - Keep later numbering clean: covered in Task 2, Step 2
  - Avoid runtime and localization changes: covered in pre-checks and diff review
- Placeholder scan: no `TBD`, `TODO`, or vague test instructions remain
- Consistency check: all command IDs, group names, and file paths match the current codebase and approved spec
