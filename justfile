build:
    vsce package

install-only:
    code --install-extension todo-tree-cl-0.0.224.vsix

install: build install-only

clean:
    # remove vsix files, if any
    ls *.vsix 2>/dev/null && rm *.vsix || true
