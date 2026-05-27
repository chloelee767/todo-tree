var path = require( 'path' );
var git = require( './git.js' );

var debug = function() {};
var enabled = false;
var baseBranch = '';
var rangesByPath = new Map();

function init( debug_ )
{
    debug = debug_ || function() {};
    git.init( debug );
}

function isEnabled()
{
    return enabled;
}

function setEnabled( value )
{
    enabled = value === true;
}

function isNewTodo( fsPath, line )
{
    var ranges = rangesByPath.get( fsPath );
    if( !ranges )
    {
        return false;
    }
    return ranges.some( function( range )
    {
        var end = range[ 0 ] + ( range[ 1 ] - 1 );
        return line >= range[ 0 ] && line <= end;
    } );
}

function refresh( branch, roots, globs )
{
    baseBranch = branch;

    if( enabled !== true || !branch || !roots || roots.length === 0 )
    {
        rangesByPath = new Map();
        return Promise.resolve( { allFailed: false } );
    }

    var include = ( globs && globs.include ) || [];
    var exclude = ( globs && globs.exclude ) || [];

    return Promise.all( roots.map( function( root )
    {
        return git.getChangedFilesAndLines( branch, root, include, exclude )
            .then( function( map ) { return { root: root, map: map, ok: true }; } )
            .catch( function( error )
            {
                debug( 'newTodoFilter: diff failed for ' + root + ': ' + error.message );
                return { root: root, map: new Map(), ok: false };
            } );
    } ) ).then( function( results )
    {
        var next = new Map();
        results.forEach( function( result )
        {
            result.map.forEach( function( lines, relPath )
            {
                next.set( path.join( result.root, relPath ), lines );
            } );
        } );
        rangesByPath = next;
        return { allFailed: results.length > 0 && results.every( function( r ) { return r.ok === false; } ) };
    } );
}

module.exports.init = init;
module.exports.isEnabled = isEnabled;
module.exports.setEnabled = setEnabled;
module.exports.isNewTodo = isNewTodo;
module.exports.refresh = refresh;
