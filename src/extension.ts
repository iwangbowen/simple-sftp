import * as vscode from 'vscode';
import { HostManager } from './hostManager';
import { AuthManager } from './authManager';
import { HostTreeProvider } from './hostTreeProvider';
import { PortForwardingTreeProvider } from './portForwardingTreeProvider';
import { CommandHandler } from './commandHandler';
import { TransferQueueService } from './services/transferQueueService';
import { PortForwardService } from './services/portForwardService';
import { PortForwarding, PortForwardConfig } from './types/portForward.types';
import { TransferHistoryService } from './services/transferHistoryService';
import { TransferQueueTreeProvider } from './ui/transferQueueTreeProvider';
import { TransferHistoryTreeProvider } from './ui/transferHistoryTreeProvider';
import { HelpFeedbackTreeProvider } from './ui/helpFeedbackTreeProvider';
import { DualPanelViewProvider } from './ui/dualPanelViewProvider';
import { DualPanelEditorManager } from './ui/dualPanelEditorProvider';
import { TransferQueueCommands } from './integrations/transferQueueCommands';
import { SftpFileSystemProvider } from './sftpFileSystemProvider';
import { SshConnectionPool } from './sshConnectionPool';
import { formatSpeed } from './utils/formatUtils';
import { logger } from './logger';

/**
 * Called when extension is activated
 */
export async function activate(context: vscode.ExtensionContext) {
  logger.info('=== Extension Activated ===');

  // Initialize host manager (synced via globalState)
  const hostManager = new HostManager(context);
  await hostManager.initialize();

  // Initialize auth manager (local SecretStorage, not synced)
  const authManager = new AuthManager(context);
  logger.info('Auth manager initialized (local storage, not synced)');

  // Set auth manager for connection pool to enable jump host authentication
  SshConnectionPool.getInstance().setAuthManager(authManager);

  // Register SFTP FileSystem Provider
  const sftpFsProvider = new SftpFileSystemProvider(hostManager, authManager);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('sftp', sftpFsProvider, {
      isCaseSensitive: true,
      isReadonly: false  // Allow read/write for remote file editing
    })
  );
  logger.info('SFTP FileSystem Provider registered');

  // Initialize transfer queue services
  const transferQueueService = TransferQueueService.getInstance();
  transferQueueService.initialize(hostManager, authManager); // Initialize with managers
  const transferHistoryService = TransferHistoryService.initialize(context);
  logger.info('Transfer queue services initialized with host and auth managers');

  // Apply transfer queue configuration
  const transferConfig = vscode.workspace.getConfiguration('simpleSftp.transferQueue');
  transferQueueService.setMaxConcurrent(transferConfig.get('maxConcurrent', 2));
  transferQueueService.setRetryPolicy({
    enabled: transferConfig.get('autoRetry', true),
    maxRetries: transferConfig.get('maxRetries', 3),
    retryDelay: transferConfig.get('retryDelay', 2000),
    backoffMultiplier: 2
  });
  logger.info('Transfer queue configuration applied');

  // Create TreeView provider
  const treeProvider = new HostTreeProvider(hostManager, authManager, context.extensionPath);
  const treeView = vscode.window.createTreeView('simpleSftp.hosts', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: treeProvider,
  });

  context.subscriptions.push(treeView);

  // Set tree view reference for expand all functionality
  treeProvider.setTreeView(treeView);

  // Create transfer queue TreeView provider
  const transferQueueTreeProvider = new TransferQueueTreeProvider();
  transferQueueTreeProvider.setHistoryService(transferHistoryService);
  const transferQueueView = vscode.window.createTreeView('simpleSftp.transferQueue', {
    treeDataProvider: transferQueueTreeProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(transferQueueView);
  logger.info('Transfer queue tree view registered');

  // Create transfer history TreeView provider
  const transferHistoryTreeProvider = new TransferHistoryTreeProvider();
  transferHistoryTreeProvider.setHistoryService(transferHistoryService);
  const transferHistoryView = vscode.window.createTreeView('simpleSftp.transferHistory', {
    treeDataProvider: transferHistoryTreeProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(transferHistoryView);
  logger.info('Transfer history tree view registered');

  // Create help and feedback TreeView provider
  const helpFeedbackTreeProvider = new HelpFeedbackTreeProvider();
  const helpFeedbackView = vscode.window.createTreeView('simpleSftp.helpFeedback', {
    treeDataProvider: helpFeedbackTreeProvider
  });
  context.subscriptions.push(helpFeedbackView);
  logger.info('Help and feedback tree view registered');

  // Create port forwarding TreeView provider
  const portForwardService = PortForwardService.getInstance();
  portForwardService.initialize(context); // Initialize with context for globalState persistence
  logger.info('Port forwarding service initialized with globalState persistence');

  const portForwardingTreeProvider = new PortForwardingTreeProvider(hostManager, portForwardService);
  const portForwardingView = vscode.window.createTreeView('simpleSftp.portForwardings', {
    treeDataProvider: portForwardingTreeProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(portForwardingView);
  logger.info('Port forwarding tree view registered');

  // Register Dual Panel WebviewView provider (Panel mode)
  const dualPanelProvider = new DualPanelViewProvider(
    context.extensionUri,
    transferQueueService,
    authManager,
    hostManager
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DualPanelViewProvider.viewType,
      dualPanelProvider
    )
  );
  logger.info('Dual panel webview view provider registered');

  // Register Dual Panel Editor Manager (Editor mode)
  const dualPanelEditorManager = new DualPanelEditorManager(
    context.extensionUri,
    transferQueueService,
    authManager,
    hostManager
  );
  context.subscriptions.push({
    dispose: () => dualPanelEditorManager.dispose()
  });
  logger.info('Dual panel editor manager initialized');

  // Helper function to determine which manager to use based on actual active state
  const getActiveManager = (): 'editor' | 'panel' | null => {
    // First check if editor manager has an active panel
    if (dualPanelEditorManager.hasActivePanel()) {
      return 'editor';
    }
    // Then check if panel provider has an active view
    if (dualPanelProvider.hasActiveView()) {
      return 'panel';
    }
    // No active instance, fall back to configuration
    const openInEditor = vscode.workspace
      .getConfiguration('simpleSftp.browser')
      .get('openInEditor', false);
    return openInEditor ? 'editor' : 'panel';
  };

  // Register command handler with transfer queue service and both providers
  const commandHandler = new CommandHandler(
    hostManager,
    authManager,
    treeProvider,
    transferQueueService,
    dualPanelProvider
  );
  commandHandler.registerCommands(context);

  // Register transfer queue commands
  const transferQueueCommands = new TransferQueueCommands(context);

  context.subscriptions.push(
    // Queue control commands
    vscode.commands.registerCommand('simpleSftp.pauseQueue', () =>
      transferQueueCommands.pauseQueue()
    ),
    vscode.commands.registerCommand('simpleSftp.resumeQueue', () =>
      transferQueueCommands.resumeQueue()
    ),

    // Task control commands
    vscode.commands.registerCommand('simpleSftp.pauseTask', (treeItem) =>
      transferQueueCommands.pauseTask(treeItem?.task)
    ),
    vscode.commands.registerCommand('simpleSftp.resumeTask', (treeItem) =>
      transferQueueCommands.resumeTask(treeItem?.task)
    ),
    vscode.commands.registerCommand('simpleSftp.cancelTask', (treeItem) =>
      transferQueueCommands.cancelTask(treeItem?.task)
    ),
    vscode.commands.registerCommand('simpleSftp.retryTask', (treeItem) =>
      transferQueueCommands.retryTask(treeItem?.task)
    ),
    vscode.commands.registerCommand('simpleSftp.removeTask', (treeItem) =>
      transferQueueCommands.removeTask(treeItem?.task)
    ),

    // Queue management commands
    vscode.commands.registerCommand('simpleSftp.clearCompleted', () =>
      transferQueueCommands.clearCompleted()
    ),
    vscode.commands.registerCommand('simpleSftp.clearAll', () =>
      transferQueueCommands.clearAll()
    ),

    // Info commands
    vscode.commands.registerCommand('simpleSftp.showTaskDetails', (task) =>
      transferQueueCommands.showTaskDetails(task)
    ),

    // History commands
    vscode.commands.registerCommand('simpleSftp.viewTransferHistory', () =>
      transferQueueCommands.viewHistory()
    ),
    vscode.commands.registerCommand('simpleSftp.clearHistory', () =>
      transferQueueCommands.clearHistory()
    ),
    vscode.commands.registerCommand('simpleSftp.removeHistoryTask', (treeItem) =>
      transferQueueCommands.removeHistoryTask(treeItem)
    ),

    // Help and feedback commands
    vscode.commands.registerCommand('simpleSftp.openGitHubReadme', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/iwangbowen/simple-sftp#readme'));
    }),
    vscode.commands.registerCommand('simpleSftp.openIssues', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/iwangbowen/simple-sftp/issues'));
    }),
    vscode.commands.registerCommand('simpleSftp.reportIssue', () => {
      vscode.commands.executeCommand('workbench.action.openIssueReporter', {
        extensionId: 'WangBowen.simple-sftp'
      });
    }),
    vscode.commands.registerCommand('simpleSftp.openGitHubRepo', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/iwangbowen/simple-sftp'));
    }),

    // Port forwarding commands
    vscode.commands.registerCommand('simpleSftp.refreshPortForwardings', () => {
      portForwardingTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('simpleSftp.startPortForward', async (treeItem) => {
      if (!treeItem || treeItem.type !== 'forwarding') {
        return;
      }
      const forwarding = treeItem.data as PortForwarding;
      if (forwarding.status === 'active') {
        vscode.window.showWarningMessage('端口转发已在运行中');
        return;
      }

      // 从PortForwarding提取配置信息
      const config: PortForwardConfig = {
        remotePort: forwarding.remotePort,
        localPort: forwarding.localPort,
        localHost: forwarding.localHost,
        remoteHost: forwarding.remoteHost,
        label: forwarding.label
      };

      try {
        // 先删除旧的转发记录
        await portForwardService.deleteForwarding(forwarding.id);

        // 重新启动转发 - 需要获取主机配置和认证配置
        // 但这里没有dualPanelBase的实例，无法访问它的_currentHost和_currentAuthConfig
        // 所以需要从hostManager获取主机配置，并重新构建认证配置
        const host = hostManager.getHostsSync().find(h => h.id === forwarding.hostId);
        if (!host) {
          throw new Error('Host configuration not found');
        }

        // 构建认证配置 - 需要重新实现addAuthToConnectConfig的逻辑
        const authConfig = await authManager.addAuthToConnectConfig(host, {} as any);

        // 重新启动转发
        await portForwardService.startForwarding(host, authConfig, config);
        vscode.window.showInformationMessage(`已启动端口转发: ${forwarding.remotePort} → ${forwarding.localPort}`);
        portForwardingTreeProvider.refresh();
      } catch (error: any) {
        vscode.window.showErrorMessage(`启动端口转发失败: ${error.message}`);
      }
    }),
    vscode.commands.registerCommand('simpleSftp.stopPortForward', async (treeItem) => {
      if (!treeItem || treeItem.type !== 'forwarding') {
        return;
      }
      const forwarding = treeItem.data as PortForwarding;
      try {
        await portForwardService.stopForwarding(forwarding.id);
        vscode.window.showInformationMessage(`Port forwarding stopped: ${forwarding.remotePort} → ${forwarding.localPort}`);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to stop port forwarding: ${error.message}`);
      }
    }),
    vscode.commands.registerCommand('simpleSftp.deletePortForward', async (treeItem) => {
      if (!treeItem || treeItem.type !== 'forwarding') {
        return;
      }
      const forwarding = treeItem.data as PortForwarding;
      try {
        await portForwardService.deleteForwarding(forwarding.id);
        vscode.window.showInformationMessage(`Port forwarding deleted: ${forwarding.remotePort} → ${forwarding.localPort}`);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to delete port forwarding: ${error.message}`);
      }
    }),

    vscode.commands.registerCommand('simpleSftp.openPortForwardingInBrowser', async (address: string) => {
      try {
        const config = vscode.workspace.getConfiguration('simpleSftp.portForwarding');
        const browserType = config.get<string>('browserType', 'simple-browser');
        const defaultProtocol = config.get<string>('defaultProtocol', 'http');

        // Add protocol if not present
        let url = address;
        if (!url.match(/^https?:\/\//)) {
          url = `${defaultProtocol}://${address}`;
        }

        if (browserType === 'simple-browser') {
          // Use VS Code Simple Browser
          await vscode.commands.executeCommand('simpleBrowser.show', url);
        } else {
          // Use external browser
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
      } catch (error: any) {
        logger.error(`Failed to open browser: ${error.message}`);
        vscode.window.showErrorMessage(`打开浏览器失败: ${error.message}`);
      }
    }),

    // View control commands
    vscode.commands.registerCommand('simpleSftp.expandAll', () => {
      // Expand all groups in the hosts tree view
      treeProvider.expandAll();
    }),
    vscode.commands.registerCommand('simpleSftp.collapseAll', () => {
      // The tree view has built-in collapse all functionality
      // This command is just for consistency
    }),

    // Dual Panel Browser - open for selected host
    vscode.commands.registerCommand('simpleSftp.openDualPanelBrowser', async (item) => {
      if (!item?.data) {
        vscode.window.showErrorMessage('请先选择一个主机');
        return;
      }

      // Check configuration to decide which mode to use
      const openInEditor = vscode.workspace
        .getConfiguration('simpleSftp.browser')
        .get('openInEditor', false);

      if (openInEditor) {
        // Open in editor area (supports multiple instances)
        await dualPanelEditorManager.openForHost(item.data);
      } else {
        // Open in panel area (single instance)
        await dualPanelProvider.openForHost(item.data);
      }
    }),

    // Dual Panel WebView context menu commands - work with both modes
    vscode.commands.registerCommand('simpleSftp.dualPanel.upload', async (args) => {
      const activeManager = getActiveManager();
      if (activeManager === 'editor') {
        await dualPanelEditorManager.executeUpload(args);
      } else {
        await dualPanelProvider.executeUpload(args);
      }
    }),
    vscode.commands.registerCommand('simpleSftp.dualPanel.download', async (args) => {
      const activeManager = getActiveManager();
      if (activeManager === 'editor') {
        await dualPanelEditorManager.executeDownload(args);
      } else {
        await dualPanelProvider.executeDownload(args);
      }
    }),
    vscode.commands.registerCommand('simpleSftp.dualPanel.delete', async (args) => {
      const activeManager = getActiveManager();
      if (activeManager === 'editor') {
        await dualPanelEditorManager.executeDelete(args);
      } else {
        await dualPanelProvider.executeDelete(args);
      }
    }),
    vscode.commands.registerCommand('simpleSftp.dualPanel.changePermissions', async (args) => {
      const activeManager = getActiveManager();
      if (activeManager === 'editor') {
        await dualPanelEditorManager.executeChangePermissions(args);
      } else {
        await dualPanelProvider.executeChangePermissions(args);
      }
    }),
    vscode.commands.registerCommand('simpleSftp.dualPanel.rename', async (args) => {
      const activeManager = getActiveManager();
      if (activeManager === 'editor') {
        await dualPanelEditorManager.executeRename(args);
      } else {
        await dualPanelProvider.executeRename(args);
      }
    }),
    vscode.commands.registerCommand('simpleSftp.dualPanel.batchRename', async (args) => {
      const activeManager = getActiveManager();
      if (activeManager === 'editor') {
        await dualPanelEditorManager.executeBatchRename(args);
      } else {
        await dualPanelProvider.executeBatchRename(args);
      }
    }),
    vscode.commands.registerCommand('simpleSftp.dualPanel.createFolder', async (args) => {
      const activeManager = getActiveManager();
      if (activeManager === 'editor') {
        await dualPanelEditorManager.executeCreateFolder(args);
      } else {
        await dualPanelProvider.executeCreateFolder(args);
      }
    }),
    vscode.commands.registerCommand('simpleSftp.dualPanel.addBookmark', async (args) => {
      const activeManager = getActiveManager();

      // Get path from args
      let targetPath = args?.filePath;

      // If no filePath (empty area), use currentPath
      if (!targetPath && args?.currentPath) {
        targetPath = args.currentPath;
      }

      if (!targetPath) {
        vscode.window.showErrorMessage('No path available to bookmark');
        return;
      }

      // For files (not directories), use parent directory
      // For directories or empty area, use the path itself
      const isDirectory = args?.isDirectory === true || !args?.filePath; // True if directory or empty area
      const bookmarkPath = isDirectory ? targetPath : require('path').dirname(targetPath);

      // Post message to webview to add bookmark
      // The webview handler will refresh tree view after adding
      const messageData = { command: 'addBookmark', data: { path: bookmarkPath } };
      if (activeManager === 'editor') {
        await dualPanelEditorManager.postMessageToWebview(messageData);
      } else {
        await dualPanelProvider.postMessageToWebview(messageData);
      }
    }),
    vscode.commands.registerCommand('simpleSftp.dualPanel.selectForCompare', async (args) => {
      const activeManager = getActiveManager();
      if (activeManager === 'editor') {
        await dualPanelEditorManager.selectFileForCompare(args);
      } else {
        await dualPanelProvider.selectFileForCompare(args);
      }
    }),
    vscode.commands.registerCommand('simpleSftp.dualPanel.compareWithSelected', async (args) => {
      const activeManager = getActiveManager();
      if (activeManager === 'editor') {
        await dualPanelEditorManager.compareWithSelected(args);
      } else {
        await dualPanelProvider.compareWithSelected(args);
      }
    }),
    vscode.commands.registerCommand('simpleSftp.dualPanel.refresh', async (args) => {
      const activeManager = getActiveManager();
      if (activeManager === 'editor') {
        await dualPanelEditorManager.executeRefresh(args);
      } else {
        await dualPanelProvider.executeRefresh(args);
      }
    })
  );
  logger.info('Transfer queue commands registered');

  // Listen to configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('simpleSftp.transferQueue')) {
        const config = vscode.workspace.getConfiguration('simpleSftp.transferQueue');

        if (e.affectsConfiguration('simpleSftp.transferQueue.maxConcurrent')) {
          transferQueueService.setMaxConcurrent(config.get('maxConcurrent', 2));
          logger.info('Transfer queue max concurrent updated');
        }

        if (e.affectsConfiguration('simpleSftp.transferQueue.autoRetry') ||
            e.affectsConfiguration('simpleSftp.transferQueue.maxRetries') ||
            e.affectsConfiguration('simpleSftp.transferQueue.retryDelay')) {
          transferQueueService.setRetryPolicy({
            enabled: config.get('autoRetry', true),
            maxRetries: config.get('maxRetries', 3),
            retryDelay: config.get('retryDelay', 2000),
            backoffMultiplier: 2
          });
          logger.info('Transfer queue retry policy updated');
        }
      }
    })
  );

  // Listen to task updates for notifications and status bar
  const transferStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  context.subscriptions.push(transferStatusBar);

  let statusBarUpdateTimer: NodeJS.Timeout | undefined;
  const statusBarThrottleMs = 1000; // Throttle to 1 second for subsequent updates
  let lastUpdateTime = 0;

  // Check if status bar should be hidden
  const shouldHideStatusBar = (): boolean => {
    const config = vscode.workspace.getConfiguration('simpleSftp.ui');
    return config.get('hideStatusBar', false);
  };

  // Update status bar with queue info
  const updateStatusBar = () => {
    // If user configured to hide status bar, don't show it
    if (shouldHideStatusBar()) {
      transferStatusBar.hide();
      return;
    }

    const now = Date.now();
    const elapsed = now - lastUpdateTime;

    // For first update or if throttle time has passed, update immediately
    if (elapsed >= statusBarThrottleMs || lastUpdateTime === 0) {
      doUpdateStatusBar();
      lastUpdateTime = now;

      // Clear any pending timer
      if (statusBarUpdateTimer) {
        clearTimeout(statusBarUpdateTimer);
        statusBarUpdateTimer = undefined;
      }
    } else {
      // Schedule an update if not already scheduled
      if (!statusBarUpdateTimer) {
        statusBarUpdateTimer = setTimeout(() => {
          statusBarUpdateTimer = undefined;
          doUpdateStatusBar();
          lastUpdateTime = Date.now();
        }, statusBarThrottleMs - elapsed);
      }
    }
  };

  const doUpdateStatusBar = () => {
    // Double check if status bar should be hidden
    if (shouldHideStatusBar()) {
      transferStatusBar.hide();
      return;
    }

    const runningTasks = transferQueueService.getRunningTasks();
    const pendingTasks = transferQueueService.getPendingTasks();

    if (runningTasks.length > 0) {
      const task = runningTasks[0];
      const percentage = task.progress.toFixed(0);
      const speed = task.speed > 0 ? ` - ${formatSpeed(task.speed)}` : '';

      transferStatusBar.text = `$(sync~spin) ${task.fileName}: ${percentage}%${speed}`;
      transferStatusBar.tooltip = `Transferring: ${task.fileName}\n${runningTasks.length} running, ${pendingTasks.length} pending`;
      transferStatusBar.show();
    } else if (pendingTasks.length > 0) {
      transferStatusBar.text = `$(clock) ${pendingTasks.length} pending transfer(s)`;
      transferStatusBar.tooltip = 'Click to view transfer queue';
      transferStatusBar.show();
    } else {
      transferStatusBar.hide();
    }
  };

  // Listen to queue and task changes
  transferQueueService.onQueueChanged(() => {
    updateStatusBar();
  });

  transferQueueService.onTaskUpdated((task) => {
    // Update status bar
    updateStatusBar();

    const config = vscode.workspace.getConfiguration('simpleSftp.transferQueue');
    const showNotifications = config.get('showNotifications', true);

    if (showNotifications) {
      if (task.status === 'completed') {
        vscode.window.showInformationMessage(
          `Transfer completed: ${task.fileName}`,
          'View Details'
        ).then(action => {
          if (action === 'View Details') {
            transferQueueCommands.showTaskDetails(task);
          }
        });

        // Add to history
        transferHistoryService.addToHistory(task);
      } else if (task.status === 'failed') {
        vscode.window.showErrorMessage(
          `Transfer failed: ${task.fileName}`,
          'Retry', 'View Details'
        ).then(action => {
          if (action === 'Retry') {
            transferQueueCommands.retryTask(task);
          } else if (action === 'View Details') {
            transferQueueCommands.showTaskDetails(task);
          }
        });

        // Add to history
        transferHistoryService.addToHistory(task);
      }
    }
  });
  logger.info('Transfer queue event listeners registered');

  logger.info('=== Extension Ready ===');
}

/**
 * Called when extension is deactivated
 */
export function deactivate() {
  logger.info('Extension deactivating...');

  // Clean up port forwarding service
  try {
    const portForwardService = PortForwardService.getInstance();
    portForwardService.dispose();
    logger.info('Port forwarding service disposed');
  } catch (error) {
    logger.error(`Error disposing port forwarding service: ${error}`);
  }

  // Clean up transfer queue service
  try {
    const transferQueueService = TransferQueueService.getInstance();
    transferQueueService.dispose();
    logger.info('Transfer queue service disposed');
  } catch (error) {
    logger.error(`Error disposing transfer queue service: ${error}`);
  }

  logger.info('Extension deactivated');
}
