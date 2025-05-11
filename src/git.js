const { spawn } = require('child_process');
const readline = require('readline');

function getChangedFilesAndLines(baseBranch, repoPath) {
    if (!baseBranch || !repoPath) {
        return Promise.reject(new Error('Base branch and repository path are required.'));
    }

    const lineRanges = new Map();

    // TODO use include/exclude glob patterns

    return new Promise((resolve, reject) => {
        // TODO get exact git binary
        const gitDiff = spawn('git', ['diff', baseBranch, '--unified=0', '--no-ext-diff', '--no-prefix'], { cwd: repoPath });

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

module.exports.getChangedFilesAndLines = getChangedFilesAndLines;