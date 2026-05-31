var path = require( 'path' );
var helpers = require( './moduleHelpers.js' );

function loadFilter( gitStub )
{
    return helpers.loadWithStubs( '../src/newTodoFilter.js', {
        './git.js': Object.assign( {
            init: function() {},
            getChangedFilesAndLines: function() { return Promise.resolve( new Map() ); },
            getUntrackedFiles: function() { return Promise.resolve( [] ); }
        }, gitStub || {} )
    } );
}

function constantBranch( branch )
{
    return function()
    {
        return branch;
    };
}

QUnit.module( 'behavioral newTodoFilter' );

QUnit.test( 'isNewTodo: absent file with no owning root is controlled by fail-open/closed', function( assert )
{
    var f = loadFilter();
    f.init( function() {} );
    f.setShowUndiffableFiles( true );
    assert.equal( f.isNewTodo( '/repo/unchanged.js', 5 ), true, 'fail-open keeps undiffable file' );
    f.setShowUndiffableFiles( false );
    assert.equal( f.isNewTodo( '/repo/unchanged.js', 5 ), false, 'fail-closed drops undiffable file' );
} );

QUnit.test( 'isNewTodo: line inside a range returns true, outside returns false', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function() { return Promise.resolve( new Map( [ [ 'a.js', [ [ 5, 3 ] ] ] ] ) ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( constantBranch( 'main' ), [ '/repo' ], { include: [], exclude: [] } ).then( function()
    {
        var p = path.join( '/repo', 'a.js' );
        assert.equal( f.isNewTodo( p, 4 ), false, 'line before range' );
        assert.equal( f.isNewTodo( p, 5 ), true, 'range start' );
        assert.equal( f.isNewTodo( p, 7 ), true, 'range end (5 + 3 - 1)' );
        assert.equal( f.isNewTodo( p, 8 ), false, 'line after range' );
        done();
    } );
} );

QUnit.test( 'refresh: disabled produces empty map', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function() { return Promise.resolve( new Map( [ [ 'a.js', [ [ 1, 1 ] ] ] ] ) ); }
    } );
    f.init( function() {} );
    f.setEnabled( false );
    f.setShowUndiffableFiles( false );
    f.refresh( constantBranch( 'main' ), [ '/repo' ], { include: [], exclude: [] } ).then( function( summary )
    {
        assert.equal( f.isNewTodo( path.join( '/repo', 'a.js' ), 1 ), false, 'disabled => no ranges' );
        assert.equal( summary && summary.allFailed, false, 'allFailed false when disabled' );
        done();
    } );
} );

QUnit.test( 'refresh: one failing root does not discard another root, reports allFailed=false', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function( branch, root )
        {
            if( root === '/bad' ) { return Promise.reject( new Error( 'not a repo' ) ); }
            return Promise.resolve( new Map( [ [ 'good.js', [ [ 2, 1 ] ] ] ] ) );
        }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( constantBranch( 'main' ), [ '/good', '/bad' ], { include: [], exclude: [] } ).then( function( summary )
    {
        assert.equal( f.isNewTodo( path.join( '/good', 'good.js' ), 2 ), true, 'good root preserved' );
        assert.equal( summary.allFailed, false, 'not all failed' );
        done();
    } );
} );

QUnit.test( 'refresh: all roots failing reports allFailed=true', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function() { return Promise.reject( new Error( 'bad branch' ) ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( constantBranch( 'nope' ), [ '/a', '/b' ], { include: [], exclude: [] } ).then( function( summary )
    {
        assert.equal( summary.allFailed, true, 'all roots failed' );
        done();
    } );
} );

QUnit.test( 'setShowUndiffableFiles + classifyUndiffable: no-repo when no covering root', function( assert )
{
    var f = loadFilter();
    f.init( function() {} );
    f.setEnabled( true );
    f.setShowUndiffableFiles( true );
    assert.equal( f.classifyUndiffable( '/elsewhere/file.js' ), 'no-repo', 'no covered/failed root' );
} );

QUnit.test( 'refresh: enabled + empty branch classifies absent files as no-branch', function( assert )
{
    var done = assert.async();
    var f = loadFilter();
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( constantBranch( '' ), [ '/repo' ], { include: [], exclude: [] } ).then( function( summary )
    {
        assert.equal( summary.allFailed, false, 'blank branch does not report git failures' );
        assert.equal( f.classifyUndiffable( '/repo/a.js' ), 'no-branch', 'blank branch is a config error' );
        done();
    } );
} );

QUnit.test( 'refresh: enabled + whitespace-only branch also classifies as no-branch', function( assert )
{
    var done = assert.async();
    var f = loadFilter();
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( constantBranch( '   ' ), [ '/repo' ], { include: [], exclude: [] } ).then( function()
    {
        assert.equal( f.classifyUndiffable( '/repo/a.js' ), 'no-branch', 'whitespace is treated as missing' );
        done();
    } );
} );

QUnit.test( 'isNewTodo: no-branch still obeys fail-open and fail-closed', function( assert )
{
    var done = assert.async();
    var f = loadFilter();
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( constantBranch( '' ), [ '/repo' ], { include: [], exclude: [] } ).then( function()
    {
        f.setShowUndiffableFiles( true );
        assert.equal( f.isNewTodo( '/repo/a.js', 1 ), true, 'fail-open keeps the todo' );
        f.setShowUndiffableFiles( false );
        assert.equal( f.isNewTodo( '/repo/a.js', 1 ), false, 'fail-closed hides the todo' );
        done();
    } );
} );

QUnit.test( 'refresh: non-empty branch clears no-branch state', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        getChangedFilesAndLines: function() { return Promise.resolve( new Map() ); },
        getUntrackedFiles: function() { return Promise.resolve( [] ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( constantBranch( '' ), [ '/repo' ], { include: [], exclude: [] } ).then( function()
    {
        assert.equal( f.classifyUndiffable( '/repo/a.js' ), 'no-branch', 'sanity check: first refresh sets no-branch' );
        return f.refresh( constantBranch( 'main' ), [ '/repo' ], { include: [], exclude: [] } );
    } ).then( function()
    {
        assert.notEqual( f.classifyUndiffable( '/repo/a.js' ), 'no-branch', 'next refresh recomputes state and clears no-branch' );
        done();
    } );
} );

QUnit.test( 'owning-root: longest prefix wins (nested covered beats covered ancestor)', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function( branch, root )
        {
            if( root === '/outer/inner' ) { return Promise.resolve( new Map( [ [ 'a.js', [ [ 10, 1 ] ] ] ] ) ); }
            return Promise.resolve( new Map() );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( constantBranch( 'main' ), [ '/outer', '/outer/inner' ], { include: [], exclude: [] } ).then( function()
    {
        assert.equal( f.classifyUndiffable( '/outer/inner/b.js' ), null, 'owning root is covered -> diffable' );
        done();
    } );
} );

QUnit.test( 'refresh: covered root recorded; failed diff -> failedRoots; untracked -> whole-file sentinel', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function( branch, root )
        {
            if( root === '/bad' ) { return Promise.reject( new Error( 'no base branch' ) ); }
            return Promise.resolve( new Map( [ [ 'changed.js', [ [ 5, 2 ] ] ] ] ) );
        },
        getUntrackedFiles: function( root )
        {
            if( root === '/good' ) { return Promise.resolve( [ 'brandnew.js' ] ); }
            return Promise.resolve( [] );
        },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( constantBranch( 'main' ), [ '/good', '/bad' ], { include: [], exclude: [] } ).then( function( summary )
    {
        assert.equal( summary.allFailed, false, 'one root succeeded' );
        assert.equal( f.classifyUndiffable( path.join( '/good', 'unchanged.js' ) ), null, '/good covered' );
        assert.equal( f.classifyUndiffable( path.join( '/bad', 'x.js' ) ), 'diff-failed', '/bad failed' );
        assert.equal( f.isNewTodo( path.join( '/good', 'brandnew.js' ), 999 ), true, 'untracked -> any line new' );
        done();
    } );
} );

QUnit.test( 'isNewTodo three cases: in-range / unchanged-in-covered / undiffable fail-open vs closed', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function() { return Promise.resolve( new Map( [ [ 'changed.js', [ [ 5, 2 ] ] ] ] ) ); },
        getUntrackedFiles: function() { return Promise.resolve( [] ); },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.setShowUndiffableFiles( true );
    f.refresh( constantBranch( 'main' ), [ '/repo' ], { include: [], exclude: [] } ).then( function()
    {
        var changed = path.join( '/repo', 'changed.js' );
        var unchanged = path.join( '/repo', 'unchanged.js' );
        var external = '/other/x.js';
        assert.equal( f.isNewTodo( changed, 5 ), true, 'in range' );
        assert.equal( f.isNewTodo( changed, 99 ), false, 'has ranges, line outside' );
        assert.equal( f.isNewTodo( unchanged, 3 ), false, 'unchanged file in covered repo dropped' );
        assert.equal( f.isNewTodo( external, 3 ), true, 'undiffable kept under fail-open' );
        f.setShowUndiffableFiles( false );
        assert.equal( f.isNewTodo( external, 3 ), false, 'undiffable dropped under fail-closed' );
        done();
    } );
} );

QUnit.test( 'isNewTodo E9b: failed owning repo under covered ancestor -> fail-open keeps (no ancestor fallback)', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function( branch, root )
        {
            if( root === '/outer/inner' ) { return Promise.reject( new Error( 'no base' ) ); }
            return Promise.resolve( new Map() );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.setShowUndiffableFiles( false );
    f.refresh( constantBranch( 'main' ), [ '/outer', '/outer/inner' ], { include: [], exclude: [] } ).then( function()
    {
        assert.equal( f.classifyUndiffable( '/outer/inner/x.js' ), 'diff-failed', 'owning failed repo wins over covered ancestor' );
        assert.equal( f.isNewTodo( '/outer/inner/x.js', 3 ), false, 'fail-closed drops diff-failed file' );
        done();
    } );
} );

QUnit.test( 'extendForRepo: merges ranges without clobbering, idempotent, routes failure to failedRoots', function( assert )
{
    var done = assert.async();
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function( branch, root )
        {
            if( root === '/r1' ) { return Promise.resolve( new Map( [ [ 'a.js', [ [ 1, 1 ] ] ] ] ) ); }
            if( root === '/r2' ) { return Promise.reject( new Error( 'fail' ) ); }
            return Promise.resolve( new Map() );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( constantBranch( 'main' ), [ '/r0' ], { include: [], exclude: [] } ).then( function()
    {
        assert.equal( f.isOwningRepoKnown( '/r1' ), false, 'not known before extend' );
        return f.extendForRepo( '/r1', constantBranch( 'main' ), { include: [], exclude: [] } );
    } ).then( function()
    {
        assert.equal( f.isNewTodo( path.join( '/r1', 'a.js' ), 1 ), true, 'merged range present' );
        assert.equal( f.isOwningRepoKnown( '/r1' ), true, 'known after extend' );
        return f.extendForRepo( '/r2', constantBranch( 'main' ), { include: [], exclude: [] } );
    } ).then( function()
    {
        assert.equal( f.classifyUndiffable( '/r2/x.js' ), 'diff-failed', 'failed extend -> failedRoots' );
        done();
    } );
} );

QUnit.test( 'extendForRepo: concurrent calls for same repo do not double-add root', function( assert )
{
    var done = assert.async();
    var calls = 0;
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function() { calls++; return Promise.resolve( new Map() ); },
        getUntrackedFiles: function() { return Promise.resolve( [] ); },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );
    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( constantBranch( 'main' ), [ '/r0' ], { include: [], exclude: [] } ).then( function()
    {
        return Promise.all( [
            f.extendForRepo( '/r1', constantBranch( 'main' ), { include: [], exclude: [] } ),
            f.extendForRepo( '/r1', constantBranch( 'main' ), { include: [], exclude: [] } )
        ] );
    } ).then( function()
    {
        assert.equal( calls, 2, 'diff loaded once for refresh and once for concurrent extend' );
        assert.equal( f.isOwningRepoKnown( '/r1' ), true, 'root known once' );
        done();
    } );
} );

QUnit.test( 'extendForRepo: stale in-flight extend does not leak into newer refresh state', function( assert )
{
    var done = assert.async();
    var releaseExtend;
    var extendDeferred = new Promise( function( resolve )
    {
        releaseExtend = resolve;
    } );
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function( branch, root )
        {
            if( root === '/late' )
            {
                return extendDeferred.then( function()
                {
                    return new Map( [ [ 'late.js', [ [ 1, 1 ] ] ] ] );
                } );
            }

            if( root === '/fresh' )
            {
                return Promise.resolve( new Map( [ [ 'fresh.js', [ [ 2, 1 ] ] ] ] ) );
            }

            return Promise.resolve( new Map() );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );

    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( constantBranch( 'main' ), [ '/base' ], { include: [], exclude: [] } ).then( function()
    {
        var staleExtend = f.extendForRepo( '/late', constantBranch( 'main' ), { include: [], exclude: [] } );
        return f.refresh( constantBranch( 'main' ), [ '/fresh' ], { include: [], exclude: [] } ).then( function()
        {
            releaseExtend();
            return staleExtend;
        } );
    } ).then( function()
    {
        assert.equal( f.isOwningRepoKnown( '/late' ), false, 'stale extend does not mark repo as known after refresh' );
        assert.equal( f.isNewTodo( path.join( '/late', 'late.js' ), 1 ), true, 'stale repo remains undiffable under fail-open' );
        assert.equal( f.isNewTodo( path.join( '/fresh', 'fresh.js' ), 2 ), true, 'new refresh state remains intact' );
        done();
    } );
} );

QUnit.test( 'extendForRepo: newer refresh does not reuse stale pending promise for same repo', function( assert )
{
    var done = assert.async();
    var releaseFirstExtend;
    var firstExtendDeferred = new Promise( function( resolve )
    {
        releaseFirstExtend = resolve;
    } );
    var calls = 0;
    var f = loadFilter( {
        init: function() {},
        getChangedFilesAndLines: function( branch, root )
        {
            calls += 1;
            if( root === '/same' && calls === 2 )
            {
                return firstExtendDeferred.then( function()
                {
                    return new Map( [ [ 'stale.js', [ [ 1, 1 ] ] ] ] );
                } );
            }

            if( root === '/same' && calls === 4 )
            {
                return Promise.resolve( new Map( [ [ 'fresh.js', [ [ 2, 1 ] ] ] ] ) );
            }

            return Promise.resolve( new Map() );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); },
        findRepoRoot: function() { return Promise.resolve( null ); }
    } );

    f.init( function() {} );
    f.setEnabled( true );
    f.refresh( constantBranch( 'main' ), [ '/base' ], { include: [], exclude: [] } ).then( function()
    {
        var staleExtend = f.extendForRepo( '/same', constantBranch( 'main' ), { include: [], exclude: [] } );
        return f.refresh( constantBranch( 'main' ), [ '/base' ], { include: [], exclude: [] } ).then( function()
        {
            return f.extendForRepo( '/same', constantBranch( 'main' ), { include: [], exclude: [] } ).then( function()
            {
                releaseFirstExtend();
                return staleExtend;
            } );
        } );
    } ).then( function()
    {
        assert.equal( calls, 4, 'current generation issues a fresh extend call instead of reusing stale promise' );
        assert.equal( f.isOwningRepoKnown( '/same' ), true, 'repo becomes known for the current generation' );
        assert.equal( f.isNewTodo( path.join( '/same', 'fresh.js' ), 2 ), true, 'fresh extend results are applied' );
        done();
    } );
} );

QUnit.test( 'refresh resolves branches per root and marks only blank roots as no-branch', function( assert )
{
    var done = assert.async();
    var diffCalls = [];
    var f = loadFilter( {
        getChangedFilesAndLines: function( branch, root )
        {
            diffCalls.push( { branch: branch, root: root } );
            return Promise.resolve( new Map() );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); }
    } );

    f.init( function() {} );
    f.setEnabled( true );

    f.refresh( function( root )
    {
        if( root === '/mapped' ) { return 'develop'; }
        if( root === '/fallback' ) { return 'main'; }
        return '';
    }, [ '/mapped', '/fallback', '/blank' ], { include: [], exclude: [] } ).then( function( summary )
    {
        assert.equal( summary.allFailed, false );
        assert.deepEqual( diffCalls, [
            { branch: 'develop', root: '/mapped' },
            { branch: 'main', root: '/fallback' }
        ] );
        assert.equal( f.classifyUndiffable( '/blank/file.js' ), 'no-branch' );
        assert.equal( f.classifyUndiffable( '/mapped/file.js' ), null );
        done();
    } );
} );

QUnit.test( 'extendForRepo resolves the branch lazily for a discovered repo', function( assert )
{
    var done = assert.async();
    var seen = [];
    var f = loadFilter( {
        getChangedFilesAndLines: function( branch, root )
        {
            seen.push( { branch: branch, root: root } );
            return Promise.resolve( new Map( [ [ 'a.js', [ [ 1, 1 ] ] ] ] ) );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); }
    } );

    f.init( function() {} );
    f.setEnabled( true );

    f.refresh( function() { return 'main'; }, [ '/existing' ], { include: [], exclude: [] } ).then( function()
    {
        return f.extendForRepo( '/mapped', function( root )
        {
            return root === '/mapped' ? 'release' : 'main';
        }, { include: [], exclude: [] } );
    } ).then( function()
    {
        assert.deepEqual( seen[ seen.length - 1 ], { branch: 'release', root: '/mapped' } );
        assert.equal( f.isNewTodo( path.join( '/mapped', 'a.js' ), 1 ), true );
        done();
    } );
} );

QUnit.test( 'extendForRepo marks blank-resolving repos as known no-branch without running git', function( assert )
{
    var done = assert.async();
    var diffCalls = 0;
    var f = loadFilter( {
        getChangedFilesAndLines: function()
        {
            diffCalls++;
            return Promise.resolve( new Map() );
        },
        getUntrackedFiles: function() { return Promise.resolve( [] ); }
    } );

    f.init( function() {} );
    f.setEnabled( true );

    f.refresh( function() { return 'main'; }, [ '/existing' ], { include: [], exclude: [] } ).then( function()
    {
        return f.extendForRepo( '/blank', function() { return '   '; }, { include: [], exclude: [] } );
    } ).then( function()
    {
        assert.equal( diffCalls, 1, 'only the initial refresh root ran git' );
        assert.equal( f.isOwningRepoKnown( '/blank' ), true, 'blank repo recorded as known' );
        assert.equal( f.classifyUndiffable( '/blank/a.js' ), 'no-branch' );
        done();
    } );
} );
