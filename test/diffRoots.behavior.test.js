function loadExtensionHelpers()
{
    return require( '../src/diffRootsHelper.js' );
}

QUnit.module( 'behavioral diffRoots' );

QUnit.test( 'collectDiffRootsFrom: workspace-family seeds workspace roots + target repos', function( assert )
{
    var h = loadExtensionHelpers();
    var revParse = { '/ws/sub': '/ws', '/ext/dir': '/ext' };
    var roots = h.collectDiffRootsFrom(
        'workspace',
        [ '/ws' ],
        [ '/ws/sub', '/ext/dir' ],
        function( dir ) { return revParse[ dir ] || null; }
    );

    assert.deepEqual( roots.sort(), [ '/ext', '/ws' ], 'workspace root + external target repo' );
} );

QUnit.test( 'collectDiffRootsFrom: workspace-family resolves workspace subfolders to git repo roots', function( assert )
{
    var h = loadExtensionHelpers();
    var revParse = { '/repo/subdir': '/repo' };
    var roots = h.collectDiffRootsFrom(
        'workspace',
        [ '/repo/subdir' ],
        [],
        function( dir ) { return revParse[ dir ] || null; }
    );

    assert.deepEqual( roots, [ '/repo' ], 'workspace subfolder resolves to git repo root' );
} );

QUnit.test( 'collectDiffRootsFrom: open-files family does NOT seed workspace roots', function( assert )
{
    var h = loadExtensionHelpers();
    var revParse = { '/ws/sub': '/ws' };
    var roots = h.collectDiffRootsFrom(
        'open files',
        [ '/ws' ],
        [ '/ws/sub' ],
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

QUnit.test( 'excludesExternalTargets: only mode 2', function( assert )
{
    var h = loadExtensionHelpers();

    assert.equal( h.excludesExternalTargets( 'open files in workspace' ), true );
    assert.equal( h.excludesExternalTargets( 'open files' ), false );
    assert.equal( h.excludesExternalTargets( 'workspace' ), false );
    assert.equal( h.excludesExternalTargets( 'current file' ), false );
    assert.equal( h.excludesExternalTargets( 'workspace only' ), false );
} );

QUnit.test( 'isWorkspaceFamily: mode 2 is NOT workspace family', function( assert )
{
    var h = loadExtensionHelpers();

    assert.equal( h.isWorkspaceFamily( 'open files in workspace' ), false );
    assert.equal( h.isWorkspaceFamily( 'workspace' ), true );
    assert.equal( h.isWorkspaceFamily( 'workspace only' ), true );
} );

QUnit.test( 'scan-mode matrix: family + external-exclusion + diff-root gating', function( assert )
{
    var h = loadExtensionHelpers();
    var modes = [ 'workspace', 'open files', 'current file', 'workspace only', 'open files in workspace' ];
    var revParse = { '/ws/sub': '/ws', '/ext/dir': '/ext' };
    var rootsByMode = modes.map( function( mode )
    {
        return h.collectDiffRootsFrom(
            mode,
            [ '/ws' ],
            [ '/ws/sub', '/ext/dir' ],
            function( dir ) { return revParse[ dir ] || null; }
        ).sort();
    } );

    assert.deepEqual( modes.map( h.isWorkspaceFamily ), [ true, false, false, true, false ], 'workspace family = workspace + workspace only' );
    assert.deepEqual( modes.map( h.excludesExternalTargets ), [ false, false, false, false, true ], 'only open files in workspace excludes external targets' );
    assert.deepEqual( rootsByMode, [
        [ '/ext', '/ws' ],
        [ '/ext', '/ws' ],
        [ '/ext', '/ws' ],
        [ '/ext', '/ws' ],
        [ '/ext', '/ws' ]
    ], 'helper only models workspace-family seeding; boundary exclusion stays in enumeration' );
} );
