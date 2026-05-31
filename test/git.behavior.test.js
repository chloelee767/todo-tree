var helpers = require( './moduleHelpers.js' );

function loadGitWithStubbedSpawn( stdoutLines, stderrData, exitCode )
{
    var EventEmitter = require( 'events' ).EventEmitter;
    var Readable = require( 'stream' ).Readable;
    var options = {};
    var lastSpawnCall = null;

    if( stdoutLines && !Array.isArray( stdoutLines ) )
    {
        options = stdoutLines;
        stdoutLines = options.stdoutLines || [];
        stderrData = options.stderrData;
        exitCode = options.exitCode;
    }

    var git = helpers.loadWithStubs( '../src/git.js', {
        child_process: {
            spawn: function( command, args, spawnOptions )
            {
                lastSpawnCall = {
                    command: command,
                    args: args,
                    options: spawnOptions
                };

                var proc = new EventEmitter();
                var stdoutChunks = stdoutLines.map( function( l ) { return l + "\n"; } );
                if( options.stdout !== undefined )
                {
                    stdoutChunks = [ options.stdout ];
                }

                proc.stdout = new Readable( { read: function() {} } );
                proc.stderr = new EventEmitter();

                process.nextTick( function()
                {
                    if( options.spawnError )
                    {
                        proc.emit( 'error', options.spawnError );
                        return;
                    }

                    stdoutChunks.forEach( function( chunk )
                    {
                        proc.stdout.push( chunk );
                    } );
                    proc.stdout.push( null );

                    if( stderrData !== undefined )
                    {
                        proc.stderr.emit( 'data', stderrData );
                    }

                    if( options.stderr !== undefined )
                    {
                        proc.stderr.emit( 'data', options.stderr );
                    }

                    if( options.exitAfterStdout )
                    {
                        proc.stdout.on( 'end', function()
                        {
                            proc.emit( 'exit', exitCode !== undefined ? exitCode : 0 );
                        } );
                        return;
                    }

                    proc.emit( 'exit', exitCode !== undefined ? exitCode : 0 );
                } );

                return proc;
            }
        }
    } );

    Object.defineProperty( git, '_lastSpawnCall', {
        get: function()
        {
            return lastSpawnCall;
        }
    } );

    return git;
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

QUnit.test( 'rejects when git exits with non-zero code after stdout closes', function( assert )
{
    var done = assert.async();
    assert.timeout( 1000 );
    assert.expect( 1 );
    var git = loadGitWithStubbedSpawn( {
        stdoutLines: [ 'diff --git a.js a.js', '' ],
        stderrData: 'fatal: bad revision',
        exitCode: 1,
        exitAfterStdout: true
    } );
    git.init( function() {} );
    git.getChangedFilesAndLines( 'main', '/repo', [], [] ).then( function()
    {
        assert.ok( false, 'must not resolve when git exits non-zero' );
        done();
    } ).catch( function( err )
    {
        assert.ok( /Git diff stderr/i.test( err.message ), 'rejects with stderr error after stdout drained' );
        done();
    } );
} );

QUnit.test( 'getUntrackedFiles: collects ?? entries, ignores tracked', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( [
        '?? newfile.js',
        ' M tracked.js',
        '?? sub/another.js',
        'A  staged.js'
    ], undefined, 0 );
    git.init( function() {} );
    git.getUntrackedFiles( '/repo', [], [] ).then( function( files )
    {
        assert.deepEqual( files, [ 'newfile.js', 'sub/another.js' ], 'only untracked paths' );
        done();
    } );
} );

QUnit.test( 'getUntrackedFiles: spawns git status with --porcelain -uall', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( [ '?? newdir/file.js' ], undefined, 0 );
    git.init( function() {} );

    git.getUntrackedFiles( '/repo', [], [] ).then( function()
    {
        assert.strictEqual( git._lastSpawnCall.command, 'git', 'spawns git' );
        assert.deepEqual( git._lastSpawnCall.args, [ 'status', '--porcelain', '-uall' ], 'requests individual untracked files, including inside new directories' );
        done();
    } );
} );

QUnit.test( 'getUntrackedFiles: rejects on git error', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( [ '' ], 'fatal: bad', 128 );
    git.init( function() {} );
    git.getUntrackedFiles( '/repo', [], [] ).catch( function( err )
    {
        assert.ok( err, 'rejects' );
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

QUnit.test( 'findRepoRoot returns canonical repo root string on success', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( { stdout: '/repo/root\n', exitCode: 0, exitAfterStdout: true } );
    git.init( function() {} );

    git.findRepoRoot( '/repo/subdir' ).then( function( repoRoot )
    {
        assert.strictEqual( repoRoot, '/repo/root', 'returns trimmed repo root path' );
        done();
    } );
} );

QUnit.test( 'findRepoRoot returns null for non-git directory when git exits 128', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( { stderr: 'fatal: not a git repository', exitCode: 128, exitAfterStdout: true } );
    git.init( function() {} );

    git.findRepoRoot( '/not-a-repo' ).then( function( repoRoot )
    {
        assert.strictEqual( repoRoot, null, 'returns null instead of rejecting for non-git directories' );
        done();
    } );
} );

QUnit.test( 'findRepoRoot returns null immediately for falsy dir without spawning git', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn();
    git.init( function() {} );

    git.findRepoRoot( '' ).then( function( repoRoot )
    {
        assert.strictEqual( repoRoot, null, 'returns null for falsy dir' );
        assert.strictEqual( git._lastSpawnCall, null, 'does not spawn git when dir is falsy' );
        done();
    } );
} );

QUnit.test( 'findRepoRoot returns null when git succeeds with empty stdout', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( { stdout: '', exitCode: 0, exitAfterStdout: true } );
    git.init( function() {} );

    git.findRepoRoot( '/repo/subdir' ).then( function( repoRoot )
    {
        assert.strictEqual( repoRoot, null, 'maps empty stdout to null on success' );
        done();
    } );
} );

QUnit.test( 'findRepoRoot spawns git with -C dir rev-parse --show-toplevel', function( assert )
{
    var done = assert.async();
    var git = loadGitWithStubbedSpawn( { stdout: '/repo/root\n', exitCode: 0, exitAfterStdout: true } );
    git.init( function() {} );

    git.findRepoRoot( '/repo/subdir' ).then( function()
    {
        assert.strictEqual( git._lastSpawnCall.command, 'git', 'spawns git' );
        assert.deepEqual( git._lastSpawnCall.args, [ '-C', '/repo/subdir', 'rev-parse', '--show-toplevel' ], 'spawns git rev-parse with the requested directory' );
        done();
    } );
} );

QUnit.test( 'findRepoRoot logs the planned rev-parse args', function( assert )
{
    var done = assert.async();
    assert.expect( 2 );
    var git = loadGitWithStubbedSpawn( { stdout: '/repo/root\n', exitCode: 0, exitAfterStdout: true } );
    var debugCalls = [];
    git.init( function( message )
    {
        debugCalls.push( message );
    } );

    git.findRepoRoot( '/repo/subdir' ).then( function()
    {
        assert.strictEqual( debugCalls.length, 1, 'logs exactly once' );
        assert.strictEqual( debugCalls[ 0 ], 'Git rev-parse args: -C,/repo/subdir,rev-parse,--show-toplevel', 'logs the exact rev-parse args string' );
        done();
    } );
} );

QUnit.test( 'findRepoRoot rejects when spawning git fails', function( assert )
{
    var done = assert.async();
    assert.timeout( 1000 );
    var git = loadGitWithStubbedSpawn( { spawnError: new Error( 'spawn failed' ) } );
    git.init( function() {} );

    git.findRepoRoot( '/repo/subdir' ).catch( function( err )
    {
        assert.strictEqual( err.message, 'spawn failed', 'rejects with the spawn error' );
        done();
    } );
} );
