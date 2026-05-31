var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );
var { execFileSync } = require( 'child_process' );
var newTodoFilter = require( '../src/newTodoFilter.js' );

function runGit( cwd, args )
{
    execFileSync( 'git', args, { cwd: cwd, stdio: 'ignore' } );
}

function createRepo()
{
    var root = fs.mkdtempSync( path.join( os.tmpdir(), 'btt-ntf-' ) );
    runGit( root, [ 'init' ] );
    runGit( root, [ 'config', 'user.email', 'test@example.com' ] );
    runGit( root, [ 'config', 'user.name', 'test' ] );
    runGit( root, [ 'checkout', '-b', 'base' ] );
    fs.writeFileSync( path.join( root, 'tracked.js' ), 'line1\nold todo\nline3\n' );
    runGit( root, [ 'add', 'tracked.js' ] );
    runGit( root, [ 'commit', '-m', 'init' ] );
    fs.writeFileSync( path.join( root, 'tracked.js' ), 'line1\nold todo\nnew todo\n' );
    return root;
}

var GLOBS = { include: [], exclude: [] };

QUnit.module( 'real-repo newTodoFilter', function( hooks )
{
    var root;
    var trackedPath;

    hooks.before( function()
    {
        newTodoFilter.init( function() {} );
    } );

    hooks.beforeEach( function()
    {
        root = createRepo();
        trackedPath = path.join( root, 'tracked.js' );
        newTodoFilter.setEnabled( true );
    } );

    hooks.afterEach( function()
    {
        fs.rmSync( root, { recursive: true, force: true } );
    } );

    QUnit.test( 'valid branch: only added lines count as new todos', function( assert )
    {
        var done = assert.async();
        newTodoFilter.setShowUndiffableFiles( true );
        newTodoFilter.refresh( 'base', [ root ], GLOBS ).then( function( summary )
        {
            assert.strictEqual( summary.allFailed, false, 'valid branch is not all-failed' );
            assert.strictEqual( newTodoFilter.classifyUndiffable( trackedPath ), null, 'file is diffable' );
            assert.strictEqual( newTodoFilter.isNewTodo( trackedPath, 2 ), false, 'old line is not new' );
            assert.strictEqual( newTodoFilter.isNewTodo( trackedPath, 3 ), true, 'added line is new' );
            done();
        } ).catch( function( err )
        {
            assert.ok( false, 'should not reject: ' + err.message );
            done();
        } );
    } );

    QUnit.test( 'nonexistent branch: root marked failed, file classified diff-failed', function( assert )
    {
        var done = assert.async();
        newTodoFilter.setShowUndiffableFiles( true );
        newTodoFilter.refresh( 'no-such-branch', [ root ], GLOBS ).then( function( summary )
        {
            assert.strictEqual( summary.allFailed, true, 'all roots failed to diff' );
            assert.strictEqual( newTodoFilter.classifyUndiffable( trackedPath ), 'diff-failed', 'file is diff-failed, not covered' );
            done();
        } ).catch( function( err )
        {
            assert.ok( false, 'refresh should resolve with a summary, not reject: ' + err.message );
            done();
        } );
    } );

    QUnit.test( 'nonexistent branch, fail-open: tracked todos stay visible', function( assert )
    {
        var done = assert.async();
        newTodoFilter.setShowUndiffableFiles( true );
        newTodoFilter.refresh( 'no-such-branch', [ root ], GLOBS ).then( function()
        {
            assert.strictEqual( newTodoFilter.isNewTodo( trackedPath, 2 ), true, 'fail-open keeps undiffable todo visible' );
            done();
        } ).catch( function( err )
        {
            assert.ok( false, 'unexpected reject: ' + err.message );
            done();
        } );
    } );

    QUnit.test( 'nonexistent branch, fail-closed: tracked todos hidden', function( assert )
    {
        var done = assert.async();
        newTodoFilter.setShowUndiffableFiles( false );
        newTodoFilter.refresh( 'no-such-branch', [ root ], GLOBS ).then( function()
        {
            assert.strictEqual( newTodoFilter.isNewTodo( trackedPath, 2 ), false, 'fail-closed hides undiffable todo' );
            done();
        } ).catch( function( err )
        {
            assert.ok( false, 'unexpected reject: ' + err.message );
            done();
        } );
    } );
} );
