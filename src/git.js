const { spawn } = require('child_process');
const readline = require('readline');

var debug;

function init( debug_ ) {
    debug = debug_; 
}

function getChangedFilesAndLines(baseBranch, repoPath, includeGlobs, excludeGlobs) {
    if (!baseBranch || !repoPath) {
        return Promise.reject(new Error('Base branch and repository path are required.'));
    }

    return new Promise((resolve, reject) => {
        const lineRanges = new Map();

        let globArgs = [];
        if ( (includeGlobs.length + excludeGlobs.length) > 0 ) {
            globArgs.push('--');
            includeGlobs.forEach(element => {
                globArgs.push(`:(glob)${element}`);
            });
            excludeGlobs.forEach(element => {
                globArgs.push(`:(exclude)${element}`);
            });
        }

        // TODO get exact git binary
        const args = ['diff', baseBranch, '--unified=0', '--no-ext-diff', '--no-prefix', ...globArgs]
        debug( `Git diff args: ${args}` );
        const gitDiff = spawn('git', args, { cwd: repoPath });

        let currentFile = null;
        let currentFileLines = [];

        const rl = readline.createInterface({
            input: gitDiff.stdout,
            crlfDelay: Infinity
        });

        rl.on('line', (line) => {
            if (line.startsWith('diff --git ')) {
                // Process previous file if exists
                if (currentFile && currentFileLines.length > 0) {
                    lineRanges.set(currentFile, currentFileLines);
                }

                // Start new file
                const parts = line.substring('diff --git '.length).split(' ');
                currentFile = parts[0].trim();
                currentFileLines = [];
            } else if (line.startsWith('@@ ') && currentFile) {
                const match = line.match(/@@ -[\d,]+ \+(\d+)(?:,(\d+))?/);
                if (match) {
                    currentFileLines.push([parseInt(match[1]), parseInt(match[2] || 1)]);
                }
            }
        });

        rl.on('close', () => {
            // Process the last file
            if (currentFile && currentFileLines.length > 0) {
                lineRanges.set(currentFile, currentFileLines);
            }
            resolve(lineRanges);
        });

        gitDiff.stderr.on('data', (data) => {
            reject(new Error(`Git diff stderr: ${data}`));
        });

        gitDiff.on('error', (error) => {
            reject(error);
        });
    });
}

module.exports.init = init;
module.exports.getChangedFilesAndLines = getChangedFilesAndLines;