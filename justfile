build:
    vsce package

install-only:
    code --install-extension todo-tree-cl-0.0.224.vsix

install: build install-only
