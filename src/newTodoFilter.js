var path = require( 'path' );
var git = require( './git.js' );

var debug = function() {};
var enabled = false;
var rangesByPath = new Map();
var coveredRoots = [];
var failedRoots = [];
var noBranchRoots = [];
var pendingRepoExtends = new Map();
var refreshGeneration = 0;
var showUndiffableFiles = true;

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

    var noBranchOwning = findOwningRoot( fsPath, noBranchRoots );
    var coveredOwning = findOwningRoot( fsPath, coveredRoots );
    var failedOwning = findOwningRoot( fsPath, failedRoots );

    if( noBranchOwning !== undefined &&
        ( coveredOwning === undefined || noBranchOwning.length >= coveredOwning.length ) &&
        ( failedOwning === undefined || noBranchOwning.length >= failedOwning.length ) )
    {
        return 'no-branch';
    }

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

function refresh( resolveBranch, roots, globs )
{
    refreshGeneration += 1;
    var generation = refreshGeneration;
    pendingRepoExtends = new Map();

    if( enabled !== true || !roots || roots.length === 0 )
    {
        rangesByPath = new Map();
        coveredRoots = [];
        failedRoots = [];
        noBranchRoots = [];
        return Promise.resolve( { allFailed: false, noBranchRoots: [] } );
    }

    var include = ( globs && globs.include ) || [];
    var exclude = ( globs && globs.exclude ) || [];
    var blankRoots = [];
    var diffableRoots = roots.filter( function( root )
    {
        var branch = resolveBranch( root );
        if( isBlankBranch( branch ) )
        {
            blankRoots.push( root );
            return false;
        }
        return true;
    } );

    if( diffableRoots.length === 0 )
    {
        rangesByPath = new Map();
        coveredRoots = [];
        failedRoots = [];
        noBranchRoots = blankRoots;
        return Promise.resolve( { allFailed: false, noBranchRoots: blankRoots.slice() } );
    }

    return Promise.all( diffableRoots.map( function( root )
    {
        var branch = resolveBranch( root );
        var diffPromise = git.getChangedFilesAndLines( branch, root, include, exclude )
            .then( function( map ) { return { map: map, ok: true, branch: branch }; } )
            .catch( function( error )
            {
                debug( 'newTodoFilter: diff failed for ' + root + ': ' + error.message );
                return { map: new Map(), ok: false, branch: branch };
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
            return { allFailed: false, noBranchRoots: [] };
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
        noBranchRoots = blankRoots;
        return {
            allFailed: results.length > 0 && results.every( function( r ) { return r.ok === false; } ),
            noBranchRoots: blankRoots.slice()
        };
    } );
}

function isOwningRepoKnown( repoRoot )
{
    return coveredRoots.indexOf( repoRoot ) !== -1 ||
        failedRoots.indexOf( repoRoot ) !== -1 ||
        noBranchRoots.indexOf( repoRoot ) !== -1;
}

function extendForRepo( repoRoot, resolveBranch, globs )
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

    var branch = resolveBranch( repoRoot );
    if( isBlankBranch( branch ) )
    {
        noBranchRoots.push( repoRoot );
        return Promise.resolve();
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
