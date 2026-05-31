var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );
var { execFileSync } = require( 'child_process' );
var helpers = require( './moduleHelpers.js' );
var git = helpers.loadWithStubs( '../src/git.js', {
    './config.js': {
        gitPath: function()
        {
            return 'git';
        }
    }
} );

function runGit( cwd, args )
{
    execFileSync( 'git', args, { cwd: cwd, stdio: 'ignore' } );
}

// Real git repo: one committed file (on branch 'base') that is then modified,
// plus one untracked file. Returns the repo root path.
function createRepo()
{
    var root = fs.mkdtempSync( path.join( os.tmpdir(), 'btt-git-' ) );
    runGit( root, [ 'init' ] );
    runGit( root, [ 'config', 'user.email', 'test@example.com' ] );
    runGit( root, [ 'config', 'user.name', 'test' ] );
    runGit( root, [ 'checkout', '-b', 'base' ] );
    fs.writeFileSync( path.join( root, 'tracked.js' ), 'line1\nold todo\nline3\n' );
    runGit( root, [ 'add', 'tracked.js' ] );
    runGit( root, [ 'commit', '-m', 'init' ] );
    fs.writeFileSync( path.join( root, 'tracked.js' ), 'line1\nold todo\nnew todo\n' );
    fs.writeFileSync( path.join( root, 'untracked.js' ), 'untracked todo\n' );
    return root;
}

QUnit.module( 'real-repo git', function( hooks )
{
    var root;

    hooks.before( function()
    {
        git.init( function() {} );
    } );

    hooks.beforeEach( function()
    {
        root = createRepo();
    } );

    hooks.afterEach( function()
    {
        fs.rmSync( root, { recursive: true, force: true } );
    } );

    QUnit.test( 'getChangedFilesAndLines: valid branch resolves with changed line ranges', function( assert )
    {
        var done = assert.async();
        git.getChangedFilesAndLines( 'base', root, [], [] ).then( function( map )
        {
            assert.deepEqual( map.get( 'tracked.js' ), [ [ 3, 1 ] ], 'reports the single added line' );
            done();
        } ).catch( function( err )
        {
            assert.ok( false, 'should not reject: ' + err.message );
            done();
        } );
    } );

    QUnit.test( 'getChangedFilesAndLines: nonexistent branch rejects', function( assert )
    {
        var done = assert.async();
        git.getChangedFilesAndLines( 'no-such-branch', root, [], [] ).then( function()
        {
            assert.ok( false, 'should reject for a nonexistent branch, not resolve' );
            done();
        } ).catch( function( err )
        {
            assert.ok( err instanceof Error, 'rejects with an Error' );
            done();
        } );
    } );

    QUnit.test( 'getChangedFilesAndLines: empty branch rejects', function( assert )
    {
        var done = assert.async();
        git.getChangedFilesAndLines( '', root, [], [] ).then( function()
        {
            assert.ok( false, 'should reject for an empty branch' );
            done();
        } ).catch( function( err )
        {
            assert.ok( /required/i.test( err.message ), 'rejects with required-args error' );
            done();
        } );
    } );

    QUnit.test( 'getUntrackedFiles: lists the untracked file', function( assert )
    {
        var done = assert.async();
        git.getUntrackedFiles( root, [], [] ).then( function( files )
        {
            assert.deepEqual( files, [ 'untracked.js' ], 'returns the untracked path' );
            done();
        } ).catch( function( err )
        {
            assert.ok( false, 'should not reject: ' + err.message );
            done();
        } );
    } );

    QUnit.test( 'getCurrentBranch returns the checked-out branch in a real repo', function( assert )
    {
        var done = assert.async();
        git.getCurrentBranch( root ).then( function( branch )
        {
            assert.strictEqual( branch, 'base', 'returns the actual checked-out branch name' );
            done();
        } ).catch( function( err )
        {
            assert.ok( false, 'should not reject: ' + err.message );
            done();
        } );
    } );
} );
