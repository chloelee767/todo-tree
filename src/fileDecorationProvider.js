var vscode = require( 'vscode' );
var newTodoFilter = require( './newTodoFilter.js' );

function reasonTooltip( reason, baseBranch )
{
    if( reason === 'no-repo' )
    {
        return "Not in a git repository : new-todo filtering can't be applied. Showing all todos.";
    }
    if( reason === 'no-branch' )
    {
        return 'No base branch configured for new-todo filtering. Showing all todos.';
    }

    return "git diff failed (repo may not have base branch `" + baseBranch + "`). Showing all todos.";
}

function isTodoDecorationUri( uri )
{
    return uri && uri.query === 'better-todo-tree-node=todo';
}

function create( config )
{
    var emitter = new vscode.EventEmitter();

    function provideFileDecoration( uri )
    {
        if( newTodoFilter.isEnabled() !== true || config.newTodosShowUndiffableFiles() !== true )
        {
            return undefined;
        }

        var reason = newTodoFilter.classifyUndiffable( uri.fsPath );
        if( reason === null || reason === undefined )
        {
            return undefined;
        }

        return new vscode.FileDecoration(
            undefined,
            isTodoDecorationUri( uri ) ? undefined : reasonTooltip( reason, config.newTodosGitBaseBranch() ),
            new vscode.ThemeColor( 'gitDecoration.ignoredResourceForeground' )
        );
    }

    return {
        onDidChangeFileDecorations: emitter.event,
        provideFileDecoration: provideFileDecoration,
        refresh: function()
        {
            emitter.fire( undefined );
        }
    };
}

module.exports.create = create;
