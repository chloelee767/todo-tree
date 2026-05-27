var path = require( 'path' );
var helpers = require( './moduleHelpers.js' );

function loadFilter( gitStub )
{
    return helpers.loadWithStubs( '../src/newTodoFilter.js', {
        './git.js': gitStub || { init: function() {}, getChangedFilesAndLines: function() { return Promise.resolve( new Map() ); } }
    } );
}

QUnit.module( 'behavioral newTodoFilter' );

QUnit.test( 'isNewTodo: absent file returns false (unchanged file dropped)', function( assert )
{
    var f = loadFilter();
    f.init( function() {} );
    assert.equal( f.isNewTodo( '/repo/unchanged.js', 5 ), false );
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
    f.refresh( 'main', [ '/repo' ], { include: [], exclude: [] } ).then( function()
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
    f.refresh( 'main', [ '/repo' ], { include: [], exclude: [] } ).then( function( summary )
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
    f.refresh( 'main', [ '/good', '/bad' ], { include: [], exclude: [] } ).then( function( summary )
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
    f.refresh( 'nope', [ '/a', '/b' ], { include: [], exclude: [] } ).then( function( summary )
    {
        assert.equal( summary.allFailed, true, 'all roots failed' );
        done();
    } );
} );
