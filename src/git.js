const { spawn } = require( 'child_process' );
const readline = require( 'readline' );

var debug;

function init( debug_ )
{
    debug = debug_;
}

function getChangedFilesAndLines( baseBranch, repoPath, includeGlobs, excludeGlobs )
{
    if( !baseBranch || !repoPath )
    {
        return Promise.reject( new Error( 'Base branch and repository path are required.' ) );
    }

    return new Promise( ( resolve, reject ) =>
    {
        const lineRanges = new Map();

        let globArgs = [];
        if( ( includeGlobs.length + excludeGlobs.length ) > 0 )
        {
            globArgs.push( '--' );
            includeGlobs.forEach( element => { globArgs.push( `:(glob)${element}` ); } );
            excludeGlobs.forEach( element => { globArgs.push( `:(exclude)${element}` ); } );
        }

        const args = [ 'diff', baseBranch, '--unified=0', '--no-ext-diff', '--no-prefix', ...globArgs ];
        debug( `Git diff args: ${args}` );
        const gitDiff = spawn( 'git', args, { cwd: repoPath } );

        let currentFile = null;
        let currentFileLines = [];

        const rl = readline.createInterface( { input: gitDiff.stdout, crlfDelay: Infinity } );

        rl.on( 'line', ( line ) =>
        {
            if( line.startsWith( 'diff --git ' ) )
            {
                if( currentFile && currentFileLines.length > 0 )
                {
                    lineRanges.set( currentFile, currentFileLines );
                }
                const rest = line.substring( 'diff --git '.length );
                currentFile = rest.slice( 0, ( rest.length - 1 ) / 2 );
                currentFileLines = [];
            }
            else if( line.startsWith( '@@ ' ) && currentFile )
            {
                const match = line.match( /@@ -[\d,]+ \+(\d+)(?:,(\d+))?/ );
                if( match )
                {
                    currentFileLines.push( [ parseInt( match[ 1 ] ), parseInt( match[ 2 ] || 1 ) ] );
                }
            }
        } );

        rl.on( 'close', () =>
        {
            if( currentFile && currentFileLines.length > 0 )
            {
                lineRanges.set( currentFile, currentFileLines );
            }
            resolve( lineRanges );
        } );

        let stderrBuffer = '';
        gitDiff.stderr.on( 'data', ( data ) =>
        {
            stderrBuffer += data;
        } );

        gitDiff.on( 'exit', ( code ) =>
        {
            if( code !== 0 )
            {
                reject( new Error( `Git diff stderr: ${stderrBuffer}` ) );
            }
        } );

        gitDiff.on( 'error', ( error ) => { reject( error ); } );
    } );
}

function findRepoRoot( dir )
{
    if( !dir )
    {
        return Promise.resolve( null );
    }

    return new Promise( ( resolve, reject ) =>
    {
        const args = [ '-C', dir, 'rev-parse', '--show-toplevel' ];
        debug( `Git rev-parse args: ${args}` );
        const proc = spawn( 'git', args );
        let stdoutBuffer = '';

        proc.stdout.on( 'data', ( data ) =>
        {
            stdoutBuffer += data;
        } );

        proc.stderr.on( 'data', () =>
        {
            // ignore stderr and treat non-zero exit as a non-repo result
        } );

        proc.on( 'exit', ( code ) =>
        {
            if( code === 0 )
            {
                resolve( stdoutBuffer.trim() || null );
                return;
            }

            resolve( null );
        } );

        proc.on( 'error', ( error ) =>
        {
            reject( error );
        } );
    } );
}

function getUntrackedFiles( repoRoot, includeGlobs, excludeGlobs )
{
    if( !repoRoot )
    {
        return Promise.reject( new Error( 'Repository path is required.' ) );
    }

    return new Promise( ( resolve, reject ) =>
    {
        let globArgs = [];
        if( ( includeGlobs.length + excludeGlobs.length ) > 0 )
        {
            globArgs.push( '--' );
            includeGlobs.forEach( element => { globArgs.push( `:(glob)${element}` ); } );
            excludeGlobs.forEach( element => { globArgs.push( `:(exclude)${element}` ); } );
        }

        const args = [ 'status', '--porcelain', '-uall', ...globArgs ];
        debug( `Git status args: ${args}` );
        const proc = spawn( 'git', args, { cwd: repoRoot } );

        const untracked = [];
        const rl = readline.createInterface( { input: proc.stdout, crlfDelay: Infinity } );
        rl.on( 'line', ( line ) =>
        {
            if( line.startsWith( '?? ' ) )
            {
                untracked.push( line.substring( 3 ) );
            }
        } );

        let stderrBuffer = '';
        proc.stderr.on( 'data', ( data ) =>
        {
            stderrBuffer += data;
        } );

        proc.on( 'exit', ( code ) =>
        {
            if( code !== 0 )
            {
                reject( new Error( `Git status stderr: ${stderrBuffer}` ) );
            }
            else
            {
                resolve( untracked );
            }
        } );

        proc.on( 'error', ( error ) => { reject( error ); } );
    } );
}

module.exports.init = init;
module.exports.getChangedFilesAndLines = getChangedFilesAndLines;
module.exports.findRepoRoot = findRepoRoot;
module.exports.getUntrackedFiles = getUntrackedFiles;
