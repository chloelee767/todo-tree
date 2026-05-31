var WORKSPACE_FAMILY = [ 'workspace', 'workspace only' ];

function isWorkspaceFamily( scanMode )
{
    return WORKSPACE_FAMILY.indexOf( scanMode ) !== -1;
}

function excludesExternalTargets( scanMode )
{
    return scanMode === 'open files in workspace';
}

function normalizePath( root )
{
    var normalized = root.split( '\\' ).join( '/' );

    if( /^[a-zA-Z]:\//.test( normalized ) )
    {
        normalized = normalized.toLowerCase();
    }

    return normalized;
}

function dedupe( roots )
{
    var seen = {};
    var out = [];

    roots.forEach( function( root )
    {
        var normalized;

        if( !root )
        {
            return;
        }

        normalized = normalizePath( root );
        if( seen[ normalized ] === true )
        {
            return;
        }

        seen[ normalized ] = true;
        out.push( root );
    } );

    return out;
}

function collectDiffRootsFrom( scanMode, workspaceRoots, targetDirs, revParse )
{
    var roots = [];

    if( isWorkspaceFamily( scanMode ) )
    {
        roots = roots.concat( workspaceRoots.map( function( root )
        {
            return revParse( root ) || root;
        } ) );
    }

    targetDirs.forEach( function( dir )
    {
        var repoRoot = revParse( dir );

        if( repoRoot )
        {
            roots.push( repoRoot );
        }
    } );

    return dedupe( roots );
}

module.exports.WORKSPACE_FAMILY = WORKSPACE_FAMILY;
module.exports.isWorkspaceFamily = isWorkspaceFamily;
module.exports.excludesExternalTargets = excludesExternalTargets;
module.exports.normalizePath = normalizePath;
module.exports.dedupe = dedupe;
module.exports.collectDiffRootsFrom = collectDiffRootsFrom;
