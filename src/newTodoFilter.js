var path = require( 'path' );
var git = require( './git.js' );

var debug = function() {};
var enabled = false;
var baseBranch = '';
var rangesByPath = new Map();
var coveredRoots = [];
var failedRoots = [];
var pendingRepoExtends = new Map();
var refreshGeneration = 0;
var showUndiffableFiles = true;
var missingBranch = false;

function isBlankBranch( branch )
{
    return !branch || String( branch ).trim() === '';
}

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

function normalizePath( p )
{
    var normalized = p.split( '\\' ).join( '/' );
    if( /^[a-zA-Z]:\//.test( normalized ) )
    {
        normalized = normalized.toLowerCase();
    }
    return normalized;
}

function isPrefixRoot( root, fsPath )
{
    var r = normalizePath( root );
    var f = normalizePath( fsPath );
    if( f === r )
    {
        return true;
    }
    var prefix = r.endsWith( '/' ) ? r : r + '/';
    return f.indexOf( prefix ) === 0;
}

function findOwningRoot( fsPath, roots )
{
    var owning = undefined;
    roots.forEach( function( root )
    {
        if( isPrefixRoot( root, fsPath ) )
        {
            if( owning === undefined || root.length > owning.length )
            {
                owning = root;
            }
        }
    } );
    return owning;
}

function setShowUndiffableFiles( value )
{
    showUndiffableFiles = value === true;
}

function classifyUndiffable( fsPath )
{
    if( rangesByPath.get( fsPath ) )
    {
        return null;
    }
    if( missingBranch === true )
    {
        return 'no-branch';
    }
    var coveredOwning = findOwningRoot( fsPath, coveredRoots );
    var failedOwning = findOwningRoot( fsPath, failedRoots );
    if( coveredOwning !== undefined && ( failedOwning === undefined || coveredOwning.length >= failedOwning.length ) )
    {
        return null;
    }
    if( failedOwning !== undefined )
    {
        return 'diff-failed';
    }
    return 'no-repo';
}

function isNewTodo( fsPath, line )
{
    var ranges = rangesByPath.get( fsPath );
    if( ranges )
    {
        return ranges.some( function( range )
        {
            var end = range[ 0 ] + ( range[ 1 ] - 1 );
            return line >= range[ 0 ] && line <= end;
        } );
    }

    if( classifyUndiffable( fsPath ) === null )
    {
        return false;
    }

    return showUndiffableFiles === true;
}

function refresh( branch, roots, globs )
{
    baseBranch = branch;
    missingBranch = enabled === true && isBlankBranch( branch );
    refreshGeneration += 1;
    var generation = refreshGeneration;
    pendingRepoExtends = new Map();

    if( enabled !== true || isBlankBranch( branch ) || !roots || roots.length === 0 )
    {
        rangesByPath = new Map();
        coveredRoots = [];
        failedRoots = [];
        return Promise.resolve( { allFailed: false } );
    }

    var include = ( globs && globs.include ) || [];
    var exclude = ( globs && globs.exclude ) || [];

    return Promise.all( roots.map( function( root )
    {
        var diffPromise = git.getChangedFilesAndLines( branch, root, include, exclude )
            .then( function( map ) { return { map: map, ok: true }; } )
            .catch( function( error )
            {
                debug( 'newTodoFilter: diff failed for ' + root + ': ' + error.message );
                return { map: new Map(), ok: false };
            } );
        var untrackedPromise = git.getUntrackedFiles( root, include, exclude )
            .catch( function( error )
            {
                debug( 'newTodoFilter: status failed for ' + root + ': ' + error.message );
                return [];
            } );
        return Promise.all( [ diffPromise, untrackedPromise ] ).then( function( both )
        {
            return { root: root, map: both[ 0 ].map, ok: both[ 0 ].ok, untracked: both[ 1 ] };
        } );
    } ) ).then( function( results )
    {
        if( generation !== refreshGeneration )
        {
            return { allFailed: false };
        }

        var next = new Map();
        var nextCovered = [];
        var nextFailed = [];
        results.forEach( function( result )
        {
            result.map.forEach( function( lines, relPath )
            {
                next.set( path.join( result.root, relPath ), lines );
            } );
            result.untracked.forEach( function( relPath )
            {
                next.set( path.join( result.root, relPath ), [ [ 1, Infinity ] ] );
            } );
            if( result.ok === true )
            {
                nextCovered.push( result.root );
            }
            else
            {
                nextFailed.push( result.root );
            }
        } );
        rangesByPath = next;
        coveredRoots = nextCovered;
        failedRoots = nextFailed;
        return { allFailed: results.length > 0 && results.every( function( r ) { return r.ok === false; } ) };
    } );
}

function isOwningRepoKnown( repoRoot )
{
    return coveredRoots.indexOf( repoRoot ) !== -1 || failedRoots.indexOf( repoRoot ) !== -1;
}

function extendForRepo( repoRoot, branch, globs )
{
    if( !repoRoot || isOwningRepoKnown( repoRoot ) )
    {
        return Promise.resolve();
    }

    if( pendingRepoExtends.has( repoRoot ) )
    {
        var pendingExtend = pendingRepoExtends.get( repoRoot );
        if( pendingExtend.generation === refreshGeneration )
        {
            return pendingExtend.promise;
        }
    }

    var generation = refreshGeneration;

    var include = ( globs && globs.include ) || [];
    var exclude = ( globs && globs.exclude ) || [];

    var diffPromise = git.getChangedFilesAndLines( branch, repoRoot, include, exclude )
        .then( function( map ) { return { map: map, ok: true }; } )
        .catch( function( error )
        {
            debug( 'newTodoFilter: extend diff failed for ' + repoRoot + ': ' + error.message );
            return { map: new Map(), ok: false };
        } );
    var untrackedPromise = git.getUntrackedFiles( repoRoot, include, exclude )
        .catch( function()
        {
            return [];
        } );

    var extendPromise = Promise.all( [ diffPromise, untrackedPromise ] ).then( function( both )
    {
        if( generation !== refreshGeneration )
        {
            return;
        }

        if( isOwningRepoKnown( repoRoot ) )
        {
            return;
        }

        var diff = both[ 0 ];
        var untracked = both[ 1 ];
        diff.map.forEach( function( lines, relPath )
        {
            rangesByPath.set( path.join( repoRoot, relPath ), lines );
        } );
        untracked.forEach( function( relPath )
        {
            rangesByPath.set( path.join( repoRoot, relPath ), [ [ 1, Infinity ] ] );
        } );
        if( diff.ok === true )
        {
            coveredRoots.push( repoRoot );
        }
        else
        {
            failedRoots.push( repoRoot );
        }
    } ).finally( function()
    {
        var currentPending = pendingRepoExtends.get( repoRoot );
        if( currentPending && currentPending.generation === generation && currentPending.promise === extendPromise )
        {
            pendingRepoExtends.delete( repoRoot );
        }
    } );

    pendingRepoExtends.set( repoRoot, { generation: generation, promise: extendPromise } );
    return extendPromise;
}

module.exports.init = init;
module.exports.isEnabled = isEnabled;
module.exports.setEnabled = setEnabled;
module.exports.setShowUndiffableFiles = setShowUndiffableFiles;
module.exports.isNewTodo = isNewTodo;
module.exports.classifyUndiffable = classifyUndiffable;
module.exports.refresh = refresh;
module.exports.extendForRepo = extendForRepo;
module.exports.isOwningRepoKnown = isOwningRepoKnown;
