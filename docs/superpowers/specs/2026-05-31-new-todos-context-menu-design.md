# Design: New-todos filter items in the tree context menu

## Goal

Add right-click context menu items for the new-todos filter in the todo tree.

The new items should:

1. appear in `view/item/context`
2. be placed in a separate group directly below the scan mode settings
3. reuse the existing commands with no runtime behavior changes

## Chosen approach

Update `package.json` only.

The commands already exist and are already registered:

1. `better-todo-tree.enableNewTodosOnly`
2. `better-todo-tree.disableNewTodosOnly`
3. `better-todo-tree.newTodosChangeBranch`

This change only exposes those commands in the todo tree item context menu and
places them in their own ordered group.

## Alternatives considered

### 1. Add the commands to the existing scan mode group

This would be the smallest diff, but it would mix scan mode commands with
new-todos filter commands and would not match the requested UX.

### 2. Add a new group without renumbering later groups

This would avoid touching the later group names, but it would introduce an
inconsistent naming pattern such as `3b-*` or `3-new-*`. The existing menu uses
clean integer-prefixed group names, so renumbering keeps the section consistent.

## Implementation

### Manifest

Update the `contributes.menus["view/item/context"]` section in `package.json`.

Add these three menu entries after the existing `3-view` scan mode items:

1. `better-todo-tree.enableNewTodosOnly`
2. `better-todo-tree.disableNewTodosOnly`
3. `better-todo-tree.newTodosChangeBranch`

Use these `when` clauses:

1. `view =~ /todo-tree/ && better-todo-tree-new-todos-only == false`
2. `view =~ /todo-tree/ && better-todo-tree-new-todos-only == true`
3. `view =~ /todo-tree/ && better-todo-tree-new-todos-only == true`

Assign all three entries to a new group:

```json
"group": "4-new-todos"
```

### Group ordering

Renumber the later existing context-menu groups so the numbering stays clean:

1. `4-tree@...` -> `5-tree@...`
2. `5-misc1` -> `6-misc1`
3. `6-misc2` -> `7-misc2`

This is only a menu-ordering change. Group names are not used as stable runtime
identifiers by the extension.

### Runtime code

Do not change any runtime files.

No changes are needed in:

1. `src/extension.js`
2. `src/extensionIdentity.js`
3. `package.nls.json`

The command IDs and titles already exist, so the manifest change is sufficient.

## Expected behavior

When the user right-clicks inside the todo tree context menu:

1. the scan mode commands still appear in their current section
2. a new section below them shows the new-todos filter actions
3. `Show New Todos Only` appears when the filter is off
4. `Show All Todos` appears when the filter is on
5. `New Todos: Change Base Branch` appears only when the filter is on

These context menu items do not depend on
`better-todo-tree-show-toggle-new-todos-only-button`, because that setting is a
toolbar button visibility setting and existing context menu items generally do
not follow those toolbar visibility toggles.

## Risks

This is low risk.

The main risk is accidental menu mis-ordering from incorrect group renaming. The
change does not affect command registration, saved settings, or any runtime
filter behavior.

## Verification

Verify the manifest entries in `package.json` and confirm the new group sits
between scan mode and tree settings in the context menu section.

If the repo has manifest-level tests for menu contributions, update or add the
smallest focused test that asserts the new entries and group ordering.

## Out of scope

1. Changing the new-todos filter behavior
2. Changing toolbar button visibility behavior
3. Renaming command IDs or command titles
