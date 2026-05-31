var fs = require( 'fs' );
var path = require( 'path' );
var languageMatrix = require( './languageMatrix.js' );

function readPackageJson()
{
    return JSON.parse( fs.readFileSync( path.join( __dirname, '..', 'package.json' ), 'utf8' ) );
}

function readPackageNls( fileName )
{
    return JSON.parse( fs.readFileSync( path.join( __dirname, '..', fileName ), 'utf8' ) );
}

function getConfigurationProperty( propertyName )
{
    return languageMatrix.findConfigurationProperty( propertyName );
}

QUnit.module( 'package manifest' );

QUnit.test( 'stable hidden view ids are preserved while the public namespace is rebranded', function( assert )
{
    var packageJson = readPackageJson();
    var activityView = packageJson.contributes.viewsContainers.activitybar[ 0 ];
    var treeView = packageJson.contributes.views[ 'todo-tree-container' ][ 0 ];

    assert.equal( activityView.id, 'todo-tree-container' );
    assert.equal( treeView.id, 'todo-tree-view' );
    assert.equal( treeView.when, '!better-todo-tree-is-empty' );
} );

QUnit.test( 'public commands use the better-todo-tree namespace', function( assert )
{
    var packageJson = readPackageJson();
    var commands = packageJson.contributes.commands.map( function( entry )
    {
        return entry.command;
    } );

    assert.ok( commands.indexOf( 'better-todo-tree.showTreeView' ) !== -1 );
    assert.ok( commands.indexOf( 'better-todo-tree.importLegacySettings' ) !== -1 );
    assert.ok( commands.indexOf( 'todo-tree.showTreeView' ) === -1 );
} );

QUnit.test( 'prepublish builds are deterministic and codicon updates are explicit', function( assert )
{
    var scripts = readPackageJson().scripts;

    assert.equal( scripts[ 'vscode:prepublish' ], 'webpack --mode production' );
    assert.equal( scripts[ 'codicons:update' ], 'node ./buildCodiconNames.js' );
    assert.equal( scripts[ 'vscode:prepublish' ].indexOf( 'buildCodiconNames' ), -1 );
} );

QUnit.test( 'release packaging has the ripgrep-universal build dependency', function( assert )
{
    var packageJson = readPackageJson();

    assert.equal( packageJson.devDependencies[ '@vscode/ripgrep-universal' ], '^1.18.0' );
} );

QUnit.test( 'ripgrep executable setting documents packaged binary behavior', function( assert )
{
    var englishNls = readPackageNls( 'package.nls.json' );

    assert.equal(
        englishNls[ 'todo-tree.configuration.ripgrep.ripgrep.markdownDescription' ],
        'Custom ripgrep executable path. Empty value uses the packaged ripgrep binary.'
    );
    assert.equal(
        englishNls[ 'better-todo-tree.configuration.ripgrep.ripgrep.markdownDescription' ],
        'Custom ripgrep executable path. Empty value uses the packaged ripgrep binary.'
    );
} );

QUnit.test( 'git executable setting has current and legacy keys with PATH fallback wording', function( assert )
{
    var englishNls = readPackageNls( 'package.nls.json' );

    assert.equal( englishNls[ 'todo-tree.configuration.git.path.markdownDescription' ], 'Custom git executable path. Empty or unset uses the normal git from PATH.' );
    assert.equal( englishNls[ 'better-todo-tree.configuration.git.path.markdownDescription' ], 'Custom git executable path. Empty or unset uses the normal git from PATH.' );
} );

QUnit.test( 'legacy settings remain present and deprecated', function( assert )
{
    var currentSetting = getConfigurationProperty( 'better-todo-tree.general.tags' );
    var legacySetting = getConfigurationProperty( 'todo-tree.general.tags' );

    assert.ok( currentSetting );
    assert.ok( legacySetting );
    assert.equal( legacySetting.deprecationMessage, '%todo-tree.configuration.legacyNamespace.deprecationMessage%' );
    assert.equal( legacySetting.markdownDeprecationMessage, '%todo-tree.configuration.legacyNamespace.markdownDeprecationMessage%' );
} );

QUnit.test( 'issue #905 filtering defaults keep Go files included without any file-type allowlist', function( assert )
{
    var currentIncludeGlobs = getConfigurationProperty( 'better-todo-tree.filtering.includeGlobs' );
    var legacyIncludeGlobs = getConfigurationProperty( 'todo-tree.filtering.includeGlobs' );
    var currentExcludeGlobs = getConfigurationProperty( 'better-todo-tree.filtering.excludeGlobs' );
    var legacyExcludeGlobs = getConfigurationProperty( 'todo-tree.filtering.excludeGlobs' );

    assert.deepEqual( currentIncludeGlobs.default, [] );
    assert.deepEqual( legacyIncludeGlobs.default, [] );
    assert.deepEqual( currentExcludeGlobs.default, [ '**/node_modules/*/**' ] );
    assert.deepEqual( legacyExcludeGlobs.default, [ '**/node_modules/*/**' ] );
} );

QUnit.test( 'issue #883 notebook scanning keeps vscode-notebook-cell enabled in the default schemes list', function( assert )
{
    var currentSchemes = getConfigurationProperty( 'better-todo-tree.general.schemes' );
    var legacySchemes = getConfigurationProperty( 'todo-tree.general.schemes' );

    assert.ok( currentSchemes.default.indexOf( 'vscode-notebook-cell' ) !== -1 );
    assert.ok( legacySchemes.default.indexOf( 'vscode-notebook-cell' ) !== -1 );
} );

QUnit.test( 'toggle new todos only button defaults to enabled', function( assert )
{
    var buttonSetting = getConfigurationProperty( 'better-todo-tree.tree.buttons.newTodosOnly' );

    assert.strictEqual( buttonSetting.default, true );
} );

QUnit.test( 'new filtering settings are declared under better-todo-tree only', function( assert )
{
    var packageJson = readPackageJson();
    var englishNls = readPackageNls( 'package.nls.json' );
    var chineseNls = readPackageNls( 'package.nls.zh-cn.json' );
    var showUndiffableSetting = getConfigurationProperty( 'better-todo-tree.filtering.newTodosShowUndiffableFiles' );
    var timeoutSetting = getConfigurationProperty( 'better-todo-tree.filtering.newTodosGitTimeoutMs' );

    function hasConfigurationProperty( propertyName, node )
    {
        if( node === undefined || node === null )
        {
            return false;
        }

        if( Array.isArray( node ) )
        {
            return node.some( function( entry )
            {
                return hasConfigurationProperty( propertyName, entry );
            } );
        }

        if( typeof ( node ) !== 'object' )
        {
            return false;
        }

        if( node.properties && Object.prototype.hasOwnProperty.call( node.properties, propertyName ) )
        {
            return true;
        }

        return Object.keys( node ).some( function( key )
        {
            return hasConfigurationProperty( propertyName, node[ key ] );
        } );
    }

    assert.ok( showUndiffableSetting, 'undiffable setting present' );
    assert.strictEqual( showUndiffableSetting.default, true );
    assert.equal( showUndiffableSetting.markdownDescription, '%newTodosShowUndiffableFiles.description%' );
    assert.ok( timeoutSetting, 'timeout setting present' );
    assert.strictEqual( timeoutSetting.default, 2000 );
    assert.strictEqual( timeoutSetting.minimum, 0 );
    assert.strictEqual( timeoutSetting.multipleOf, 1 );
    assert.equal( timeoutSetting.markdownDescription, '%newTodosGitTimeoutMs.description%' );
    assert.notOk( hasConfigurationProperty( 'todo-tree.filtering.newTodosShowUndiffableFiles', packageJson.contributes.configuration ), 'no legacy alias for undiffable setting' );
    assert.notOk( hasConfigurationProperty( 'todo-tree.filtering.newTodosGitTimeoutMs', packageJson.contributes.configuration ), 'no legacy alias for timeout setting' );
    assert.equal( englishNls[ 'newTodosShowUndiffableFiles.description' ], "When 'new todos only' is enabled and a file can't be git-diffed (not in a repo, or the diff failed), show all its todos (fail-open). When disabled, hide such files entirely (fail-closed)." );
    assert.equal( englishNls[ 'newTodosGitTimeoutMs.description' ], 'Maximum time (ms) to wait for first-touch git repo discovery + diff when filtering an open file. On timeout, the file is shown in its fail-open/fail-closed state, then corrected when the diff resolves. 0 disables the timeout (always wait).' );
    assert.equal( chineseNls[ 'newTodosShowUndiffableFiles.description' ], "启用“仅显示新待办”后，如果某个文件无法执行 git diff（不在仓库中，或 diff 失败），则显示该文件中的所有待办事项（fail-open）。禁用后，则完全隐藏这类文件（fail-closed）。" );
    assert.equal( chineseNls[ 'newTodosGitTimeoutMs.description' ], '筛选打开文件时，首次触发 git 仓库发现和 diff 的最大等待时间（毫秒）。超时后，文件会先按 fail-open 或 fail-closed 状态显示，待 diff 完成后再修正。设为 0 可禁用超时（始终等待）。' );
} );

QUnit.test( 'per-repo new-todos base branch setting is current-namespace only', function( assert )
{
    var packageJson = readPackageJson();
    var englishNls = readPackageNls( 'package.nls.json' );
    var chineseNls = readPackageNls( 'package.nls.zh-cn.json' );
    var perRepoSetting = getConfigurationProperty( 'better-todo-tree.filtering.newTodosGitBaseBranchPerRepo' );

    function hasConfigurationProperty( propertyName, node )
    {
        if( node === undefined || node === null )
        {
            return false;
        }

        if( Array.isArray( node ) )
        {
            return node.some( function( entry )
            {
                return hasConfigurationProperty( propertyName, entry );
            } );
        }

        if( typeof ( node ) !== 'object' )
        {
            return false;
        }

        if( node.properties && Object.prototype.hasOwnProperty.call( node.properties, propertyName ) )
        {
            return true;
        }

        return Object.keys( node ).some( function( key )
        {
            return hasConfigurationProperty( propertyName, node[ key ] );
        } );
    }

    assert.ok( perRepoSetting, 'per-repo setting present' );
    assert.strictEqual( perRepoSetting.type, 'object' );
    assert.deepEqual( perRepoSetting.default, {} );
    assert.deepEqual( perRepoSetting.additionalProperties, { type: 'string' } );
    assert.strictEqual( perRepoSetting.scope, 'resource' );
    assert.equal( perRepoSetting.markdownDescription, '%newTodosGitBaseBranchPerRepo.description%' );
    assert.notOk(
        hasConfigurationProperty( 'todo-tree.filtering.newTodosGitBaseBranchPerRepo', packageJson.contributes.configuration ),
        'no legacy alias for per-repo setting'
    );
    assert.equal(
        englishNls[ 'newTodosGitBaseBranchPerRepo.description' ],
        'Per-repository version of #better-todo-tree.filtering.newTodosGitBaseBranch# setting. Keys are absolute paths to the git repo root; values are the git branch / revision. Falls back to #better-todo-tree.filtering.newTodosGitBaseBranch# when a repo is missing. Example: { "/home/me/code/repo-a": "main", "/home/me/code/repo-b": "develop" }'
    );
    assert.equal(
        chineseNls[ 'newTodosGitBaseBranchPerRepo.description' ],
        '#better-todo-tree.filtering.newTodosGitBaseBranch# 的按仓库版本。键为 git 仓库根目录的绝对路径，值为该仓库要对比的 git 分支或修订。仓库未配置时，会回退到 #better-todo-tree.filtering.newTodosGitBaseBranch#。示例：{ "/home/me/code/repo-a": "main", "/home/me/code/repo-b": "develop" }'
    );
} );

QUnit.test( 'git executable setting is declared in a dedicated git section for current and legacy namespaces', function( assert )
{
    var packageJson = readPackageJson();
    var englishNls = readPackageNls( 'package.nls.json' );
    var chineseNls = readPackageNls( 'package.nls.zh-cn.json' );
    var currentSetting = getConfigurationProperty( 'better-todo-tree.git.path' );
    var legacySetting = getConfigurationProperty( 'todo-tree.git.path' );
    var gitSection = packageJson.contributes.configuration.find( function( section )
    {
        return section.title === '%better-todo-tree.configuration.git%';
    } );

    assert.ok( gitSection, 'git section exists' );
    assert.strictEqual( gitSection.order, 8 );
    assert.ok( currentSetting, 'current setting exists' );
    assert.strictEqual( currentSetting.type, 'string' );
    assert.strictEqual( currentSetting.default, 'git' );
    assert.equal( currentSetting.markdownDescription, '%better-todo-tree.configuration.git.path.markdownDescription%' );
    assert.ok( legacySetting, 'legacy setting exists' );
    assert.strictEqual( legacySetting.type, 'string' );
    assert.strictEqual( legacySetting.default, 'git' );
    assert.equal( legacySetting.markdownDescription, '%better-todo-tree.configuration.git.path.markdownDescription%' );
    assert.equal( legacySetting.deprecationMessage, '%todo-tree.configuration.legacyNamespace.deprecationMessage%' );
    assert.equal( legacySetting.markdownDeprecationMessage, '%todo-tree.configuration.legacyNamespace.markdownDeprecationMessage%' );
    assert.equal( englishNls[ 'todo-tree.configuration.git' ], 'Git' );
    assert.equal( englishNls[ 'better-todo-tree.configuration.git' ], 'Git' );
    assert.equal( chineseNls[ 'todo-tree.configuration.git' ], 'Git' );
    assert.equal( chineseNls[ 'better-todo-tree.configuration.git' ], 'Git' );
    assert.equal( chineseNls[ 'todo-tree.configuration.git.path.markdownDescription' ], '自定义 git 可执行文件路径。空值或未设置时，使用 PATH 中的普通 git。' );
    assert.equal( chineseNls[ 'better-todo-tree.configuration.git.path.markdownDescription' ], '自定义 git 可执行文件路径。空值或未设置时，使用 PATH 中的普通 git。' );
} );

QUnit.test( 'scan mode enums expose exactly five values including open files in workspace for current and legacy namespaces', function( assert )
{
    var currentScanMode = getConfigurationProperty( 'better-todo-tree.tree.scanMode' );
    var legacyScanMode = getConfigurationProperty( 'todo-tree.tree.scanMode' );
    var expectedModes = [
        'workspace',
        'open files',
        'current file',
        'workspace only',
        'open files in workspace'
    ];

    assert.deepEqual( currentScanMode.enum, expectedModes );
    assert.deepEqual( legacyScanMode.enum, expectedModes );
    assert.equal( currentScanMode.markdownEnumDescriptions.length, 5 );
    assert.equal( legacyScanMode.markdownEnumDescriptions.length, 5 );
} );

QUnit.test( 'context menus target stable todo-tree views with rebranded context keys', function( assert )
{
    var packageJson = readPackageJson();
    var menuEntry = packageJson.contributes.menus[ 'view/item/context' ].find( function( entry )
    {
        return entry.command === 'better-todo-tree.showTreeView';
    } );

    assert.equal( menuEntry.when, "view =~ /todo-tree/ && (better-todo-tree-flat == true || better-todo-tree-tags-only == true)" );
} );

QUnit.test( 'view title busy placeholders are scoped to the active control instead of duplicating across the whole title bar', function( assert )
{
    var packageJson = readPackageJson();
    var titleMenu = packageJson.contributes.menus[ 'view/title' ];
    var scanBusyEntries = titleMenu.filter( function( entry )
    {
        return entry.command === 'better-todo-tree.scanBusy';
    } );
    var cycleViewStyleEntry = titleMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.cycleViewStyle';
    } );
    var viewBusyEntry = titleMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.treeStateBusy' && entry.group === 'navigation@4';
    } );
    var expandBusyEntry = titleMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.treeStateBusy' && entry.group === 'navigation@9';
    } );
    var groupingBusyEntry = titleMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.treeStateBusy' && entry.group === 'navigation@5' && entry.when.indexOf( 'better-todo-tree-grouping-busy == true' ) >= 0;
    } );
    var groupByTagEntry = titleMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.groupByTag';
    } );
    var groupBySubTagEntry = titleMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.groupBySubTag';
    } );

    assert.equal( scanBusyEntries.length, 1 );
    assert.equal( scanBusyEntries[ 0 ].group, 'navigation@8' );
    assert.ok( cycleViewStyleEntry.when.indexOf( 'better-todo-tree-view-style-busy == false' ) >= 0 );
    assert.ok( viewBusyEntry.when.indexOf( 'better-todo-tree-view-style-busy == true' ) >= 0 );
    assert.ok( expandBusyEntry.when.indexOf( 'better-todo-tree-expansion-busy == true' ) >= 0 );
    assert.ok( groupingBusyEntry.when.indexOf( 'better-todo-tree-grouping-busy == true' ) >= 0 );
    assert.ok( groupByTagEntry.when.indexOf( 'better-todo-tree-grouping-busy == false' ) >= 0 );
    assert.ok( groupBySubTagEntry.when.indexOf( 'better-todo-tree-grouping-busy == false' ) >= 0 );
} );

QUnit.test( 'scan mode toolbar cycle includes open files in workspace and context menu exposes it', function( assert )
{
    var packageJson = readPackageJson();
    var titleMenu = packageJson.contributes.menus[ 'view/title' ];
    var contextMenu = packageJson.contributes.menus[ 'view/item/context' ];
    var scanButtons = titleMenu.filter( function( entry )
    {
        return [
            'better-todo-tree.scanOpenFilesOnly',
            'better-todo-tree.scanOpenFilesInWorkspaceOnly',
            'better-todo-tree.scanCurrentFileOnly',
            'better-todo-tree.scanWorkspaceOnly',
            'better-todo-tree.scanWorkspaceAndOpenFiles'
        ].indexOf( entry.command ) !== -1;
    } );
    var mode2ContextEntry = contextMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.scanOpenFilesInWorkspaceOnly';
    } );

    assert.deepEqual( scanButtons.map( function( entry )
    {
        return { command: entry.command, when: entry.when };
    } ), [
        {
            command: 'better-todo-tree.scanOpenFilesOnly',
            when: "view =~ /todo-tree/ && better-todo-tree-scan-mode == 'workspace' && better-todo-tree-show-scan-mode-button == true && better-todo-tree-scan-busy == false"
        },
        {
            command: 'better-todo-tree.scanOpenFilesInWorkspaceOnly',
            when: "view =~ /todo-tree/ && better-todo-tree-scan-mode == 'open files' && better-todo-tree-show-scan-mode-button == true && better-todo-tree-scan-busy == false"
        },
        {
            command: 'better-todo-tree.scanCurrentFileOnly',
            when: "view =~ /todo-tree/ && better-todo-tree-scan-mode == 'open files in workspace' && better-todo-tree-show-scan-mode-button == true && better-todo-tree-scan-busy == false"
        },
        {
            command: 'better-todo-tree.scanWorkspaceOnly',
            when: "view =~ /todo-tree/ && better-todo-tree-scan-mode == 'current file' && better-todo-tree-show-scan-mode-button == true && better-todo-tree-scan-busy == false"
        },
        {
            command: 'better-todo-tree.scanWorkspaceAndOpenFiles',
            when: "view =~ /todo-tree/ && better-todo-tree-scan-mode == 'workspace only' && better-todo-tree-show-scan-mode-button == true && better-todo-tree-scan-busy == false"
        }
    ] );
    assert.deepEqual( mode2ContextEntry, {
        command: 'better-todo-tree.scanOpenFilesInWorkspaceOnly',
        when: "view =~ /todo-tree/ && better-todo-tree-scan-mode != 'open files in workspace'",
        group: '3-view'
    } );
} );

QUnit.test( 'new todos context menu entries sit below scan mode in their own group', function( assert )
{
    var packageJson = readPackageJson();
    var contextMenu = packageJson.contributes.menus[ 'view/item/context' ];
    var newTodosEntries = contextMenu.filter( function( entry )
    {
        return [
            'better-todo-tree.enableNewTodosOnly',
            'better-todo-tree.disableNewTodosOnly',
            'better-todo-tree.newTodosChangeBranch'
        ].indexOf( entry.command ) !== -1;
    } );
    var expandEntry = contextMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.expand';
    } );
    var exportEntry = contextMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.exportTree';
    } );
    var revealEntry = contextMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.reveal';
    } );

    assert.deepEqual( newTodosEntries, [
        {
            command: 'better-todo-tree.enableNewTodosOnly',
            when: 'view =~ /todo-tree/ && better-todo-tree-new-todos-only == false',
            group: '4-new-todos@1'
        },
        {
            command: 'better-todo-tree.disableNewTodosOnly',
            when: 'view =~ /todo-tree/ && better-todo-tree-new-todos-only == true',
            group: '4-new-todos@2'
        },
        {
            command: 'better-todo-tree.newTodosChangeBranch',
            when: 'view =~ /todo-tree/ && better-todo-tree-new-todos-only == true',
            group: '4-new-todos@3'
        }
    ] );
    assert.equal( expandEntry.group, '5-tree@1' );
    assert.equal( exportEntry.group, '6-misc1' );
    assert.equal( revealEntry.group, '7-misc2' );
} );

QUnit.test( 'busy and composite tree commands have localization entries in both english and zh-cn bundles', function( assert )
{
    var english = readPackageNls( 'package.nls.json' );
    var chinese = readPackageNls( 'package.nls.zh-cn.json' );
    var requiredKeys = [
        'better-todo-tree.command.cycleViewStyle.title',
        'better-todo-tree.command.toggleTreeExpansion.title',
        'better-todo-tree.command.scanBusy.title',
        'better-todo-tree.command.treeStateBusy.title'
    ];

    requiredKeys.forEach( function( key )
    {
        assert.equal( typeof english[ key ], 'string', 'english bundle contains ' + key );
        assert.equal( typeof chinese[ key ], 'string', 'zh-cn bundle contains ' + key );
    } );

    assert.notOk( english[ 'better-todo-tree.command.scanBusy.title' ].indexOf( '$(' ) >= 0 );
    assert.notOk( english[ 'better-todo-tree.command.treeStateBusy.title' ].indexOf( '$(' ) >= 0 );
    assert.notOk( chinese[ 'better-todo-tree.command.scanBusy.title' ].indexOf( '$(' ) >= 0 );
    assert.notOk( chinese[ 'better-todo-tree.command.treeStateBusy.title' ].indexOf( '$(' ) >= 0 );
} );

QUnit.test( 'busy placeholder commands use spinner icons with plain localized titles', function( assert )
{
    var packageJson = readPackageJson();
    var treeStateBusy = packageJson.contributes.commands.find( function( entry )
    {
        return entry.command === 'better-todo-tree.treeStateBusy';
    } );
    var scanBusy = packageJson.contributes.commands.find( function( entry )
    {
        return entry.command === 'better-todo-tree.scanBusy';
    } );

    assert.equal( treeStateBusy.icon, '$(loading~spin)' );
    assert.equal( scanBusy.icon, '$(loading~spin)' );
    assert.equal( treeStateBusy.title, '%better-todo-tree.command.treeStateBusy.title%' );
    assert.equal( scanBusy.title, '%better-todo-tree.command.scanBusy.title%' );
} );
