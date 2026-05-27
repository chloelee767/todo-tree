var helpers = require( './moduleHelpers.js' );

function loadGitWithStubbedSpawn( stdoutLines, stderrData, exitCode )
{
    var EventEmitter = require( 'events' ).EventEmitter;
    var Readable = require( 'stream' ).Readable;

    return helpers.loadWithStubs( '../src/git.js', {
        child_process: {
            spawn: function()
            {
                var proc = new EventEmitter();
                proc.stdout = Readable.from( stdoutLines.map( function( l ) { return l + "\n"; } ) );
                proc.stderr = new EventEmitter();
                if( stderrData !== undefined )
                {
                    process.nextTick( function()
                    {
                        proc.stderr.emit( 'data', stderrData );
                        proc.emit( 'exit', exitCode !== undefined ? exitCode : 1 );
                    } );
                }
                return proc;
            }
        }
    } );
}

QUnit.module( 'behavioral git' );

QUnit.test( 'parses diff hunks into [startLine, count] ranges keyed by file', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( [
        'diff --git a.js a.js',
        '@@ -1,0 +5,3 @@',
        '@@ -10,2 +20 @@'
    ] );
    git.init( function() {} );

    git.getChangedFilesAndLines( 'main', '/repo', [], [] ).then( function( map )
    {
        assert.deepEqual( map.get( 'a.js' ), [ [ 5, 3 ], [ 20, 1 ] ], 'two hunks, default count 1' );
        done();
    } );
} );

QUnit.test( 'parses diff header for filename containing spaces', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( [
        'diff --git foo bar.js foo bar.js',
        '@@ -1,0 +3,2 @@'
    ] );
    git.init( function() {} );

    git.getChangedFilesAndLines( 'main', '/repo', [], [] ).then( function( map )
    {
        assert.deepEqual( map.get( 'foo bar.js' ), [ [ 3, 2 ] ], 'filename with spaces parsed correctly' );
        done();
    } );
} );

QUnit.test( 'rejects when base branch or repo path missing', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( [] );
    git.init( function() {} );
    git.getChangedFilesAndLines( '', '/repo', [], [] ).catch( function( err )
    {
        assert.ok( /required/i.test( err.message ), 'rejects with required-args error' );
        done();
    } );
} );

QUnit.test( 'rejects when git exits with non-zero code', function( assert )
{
    var done = assert.async();
    assert.timeout( 1000 );
    var git = loadGitWithStubbedSpawn( [ 'diff --git a.js a.js', '' ], 'fatal: bad revision', 1 );
    git.init( function() {} );
    git.getChangedFilesAndLines( 'main', '/repo', [], [] ).catch( function( err )
    {
        assert.ok( /Git diff stderr/i.test( err.message ), 'rejects with stderr error' );
        done();
    } );
} );

QUnit.test( 'resolves when git writes to stderr but exits with code 0', function( assert )
{
    var done = assert.async();
    assert.timeout( 1000 );
    var git = loadGitWithStubbedSpawn( [ 'diff --git a.js a.js', '@@ -1,0 +5,1 @@' ], 'hint: fsckObjects enabled', 0 );
    git.init( function() {} );
    git.getChangedFilesAndLines( 'main', '/repo', [], [] ).then( function( map )
    {
        assert.ok( map.has( 'a.js' ), 'resolves with parsed diff despite stderr output' );
        done();
    } );
} );
