var helpers = require( './moduleHelpers.js' );

function loadProvider( filterStub )
{
    return helpers.loadWithStubs( '../src/fileDecorationProvider.js', {
        vscode: {
            ThemeColor: function( id ) { this.id = id; },
            EventEmitter: function()
            {
                this.event = function() {};
                this.fire = function() {};
            },
            FileDecoration: function( badge, tooltip, color )
            {
                this.badge = badge;
                this.tooltip = tooltip;
                this.color = color;
            }
        },
        './newTodoFilter.js': filterStub
    } );
}

function makeConfig()
{
    return {
        newTodosShowUndiffableFiles: function() { return true; },
        newTodosGitBaseBranch: function() { return 'main'; }
    };
}

QUnit.module( 'behavioral fileDecorationProvider' );

QUnit.test( 'no-repo -> dimmed decoration with tooltip mentioning not in git repository', function( assert )
{
    var mod = loadProvider( {
        isEnabled: function() { return true; },
        classifyUndiffable: function() { return 'no-repo'; }
    } );
    var provider = mod.create( makeConfig() );
    var deco = provider.provideFileDecoration( { fsPath: '/x/a.js' } );

    assert.ok( deco, 'decoration returned' );
    assert.equal( deco.color.id, 'gitDecoration.ignoredResourceForeground' );
    assert.ok( /not in a git repository/i.test( deco.tooltip ), 'no-repo reason in tooltip' );
} );

QUnit.test( 'diff-failed -> tooltip mentions diff failed and base branch', function( assert )
{
    var mod = loadProvider( {
        isEnabled: function() { return true; },
        classifyUndiffable: function() { return 'diff-failed'; }
    } );
    var provider = mod.create( makeConfig() );
    var deco = provider.provideFileDecoration( { fsPath: '/x/a.js' } );

    assert.ok( deco, 'decoration returned' );
    assert.ok( /diff failed/i.test( deco.tooltip ), 'diff-failed reason in tooltip' );
    assert.ok( /main/.test( deco.tooltip ), 'base branch named in tooltip' );
} );

QUnit.test( 'diffable -> no decoration', function( assert )
{
    var mod = loadProvider( {
        isEnabled: function() { return true; },
        classifyUndiffable: function() { return null; }
    } );
    var provider = mod.create( makeConfig() );

    assert.equal( provider.provideFileDecoration( { fsPath: '/x/a.js' } ), undefined );
} );

QUnit.test( 'filter off -> no decoration', function( assert )
{
    var mod = loadProvider( {
        isEnabled: function() { return false; },
        classifyUndiffable: function() { return 'no-repo'; }
    } );
    var provider = mod.create( makeConfig() );

    assert.equal( provider.provideFileDecoration( { fsPath: '/x/a.js' } ), undefined );
} );

QUnit.test( 'todo decoration URI -> dimmed decoration without reason tooltip', function( assert )
{
    var mod = loadProvider( {
        isEnabled: function() { return true; },
        classifyUndiffable: function() { return 'no-repo'; }
    } );
    var provider = mod.create( makeConfig() );
    var deco = provider.provideFileDecoration( { fsPath: '/x/a.js', query: 'better-todo-tree-node=todo' } );

    assert.ok( deco, 'decoration returned' );
    assert.equal( deco.color.id, 'gitDecoration.ignoredResourceForeground' );
    assert.equal( deco.tooltip, undefined, 'todo rows get no reason tooltip from file decoration provider' );
} );
