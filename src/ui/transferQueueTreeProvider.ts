import * as vscode from 'vscode';
import { TransferQueueService } from '../services/transferQueueService';
import { TransferHistoryService } from '../services/transferHistoryService';
import { TransferTaskModel } from '../models/transferTask';
import { TaskStatus } from '../types/transfer.types';
import { formatBytes, formatDuration, formatSpeed } from '../utils/formatUtils';
import { logger } from '../logger';

/**
 * Transfer Queue Tree Item
 */
class TransferQueueTreeItem extends vscode.TreeItem {
  constructor(
    public readonly task: TransferTaskModel,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(task.fileName, collapsibleState);

    this.tooltip = TransferQueueTreeItem.buildTooltip(task);
    this.description = TransferQueueTreeItem.buildDescription(task);
    this.iconPath = TransferQueueTreeItem.getIconPath(task);
    this.contextValue = TransferQueueTreeItem.buildContextValue(task);

    // Add command for clicking on task
    this.command = {
      command: 'simpleSftp.showTaskDetails',
      title: 'Show Task Details',
      arguments: [task]
    };
  }

  private static buildTooltip(task: TransferTaskModel): string {
    const lines = [
      `File: ${task.fileName}`,
      `Type: ${task.type.toUpperCase()}`,
      `Status: ${task.status.toUpperCase()}`,
      `Host: ${task.hostName}`,
      `Local: ${task.localPath}`,
      `Remote: ${task.remotePath}`,
      `Size: ${formatBytes(task.fileSize)}`,
      `Progress: ${task.progress.toFixed(1)}%`
    ];

    if (task.status === 'running') {
      lines.push(`Speed: ${formatSpeed(task.speed)}`);
      if (task.estimatedTime) {
        lines.push(`Remaining: ${formatDuration(task.estimatedTime)}`);
      }
    }

    if (task.lastError) {
      lines.push(`Error: ${task.lastError}`);
    }

    return lines.join('\n');
  }

  private static buildDescription(task: TransferTaskModel): string {
    const parts: string[] = [];

    // Progress and size
    if (task.status === 'running' || task.status === 'paused') {
      parts.push(`${task.progress.toFixed(1)}%`, `${formatBytes(task.transferred)}/${formatBytes(task.fileSize)}`);
    } else if (task.status === 'completed') {
      parts.push(formatBytes(task.fileSize));
    }

    // Speed (for running tasks)
    if (task.status === 'running' && task.speed > 0) {
      parts.push(formatSpeed(task.speed));
    }

    // Status indicator
    parts.push(`[${task.status}]`);

    return parts.join(' · ');
  }

  private static getIconPath(task: TransferTaskModel): vscode.ThemeIcon {
    const iconMap: Record<TaskStatus, string> = {
      pending: 'circle-outline',
      running: 'sync~spin',
      paused: 'debug-pause',
      completed: 'check',
      failed: 'error',
      cancelled: 'circle-slash'
    };

    const icon = iconMap[task.status] || 'file';
    return new vscode.ThemeIcon(icon);
  }

  private static buildContextValue(task: TransferTaskModel): string {
    const values = ['transferTask', `status-${task.status}`];

    if (task.type === 'upload') {
      values.push('type-upload');
    } else {
      values.push('type-download');
    }

    return values.join('.');
  }
}

/**
 * Transfer Queue Tree Data Provider
 */
export class TransferQueueTreeProvider implements vscode.TreeDataProvider<TransferQueueTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TransferQueueTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly queueService: TransferQueueService;
  private historyService?: TransferHistoryService;

  private showCompleted: boolean = false;
  private showHistory: boolean = false;
  private filterStatus?: TaskStatus;

  private refreshTimer?: NodeJS.Timeout;
  private readonly refreshThrottleMs = 1000; // Throttle refreshes to every 1 second

  constructor() {
    this.queueService = TransferQueueService.getInstance();

    // Try to get history service (may not be initialized yet)
    try {
      this.historyService = TransferHistoryService.getInstance();
    } catch {
      // Will be initialized later
    }

    // Listen to queue changes - throttled refresh
    this.queueService.onQueueChanged(() => {
      this.scheduleRefresh();
    });

    this.queueService.onTaskUpdated(() => {
      this.scheduleRefresh();
    });
  }

  /**
   * Schedule a throttled refresh
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      return; // Already scheduled
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refresh();
    }, this.refreshThrottleMs);
  }

  /**
   * Refresh tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get tree item
   */
  getTreeItem(element: TransferQueueTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get children
   */
  getChildren(element?: TransferQueueTreeItem): Thenable<TransferQueueTreeItem[]> {
    if (element) {
      // No children for now (could add details in future)
      return Promise.resolve([]);
    }

    // Get tasks
    let tasks: TransferTaskModel[] = [];

    if (this.showHistory && this.historyService) {
      tasks = this.historyService.getRecentHistory(50);
      logger.info(`Transfer queue tree: showing ${tasks.length} history items`);
    } else {
      tasks = this.queueService.getAllTasks();
      logger.info(`Transfer queue tree: got ${tasks.length} tasks from queue`);

      // Filter by status if set
      if (this.filterStatus) {
        tasks = tasks.filter(t => t.status === this.filterStatus);
        logger.info(`Transfer queue tree: filtered to ${tasks.length} tasks with status ${this.filterStatus}`);
      }

      // Filter out completed unless showing them
      if (!this.showCompleted) {
        const beforeFilter = tasks.length;
        tasks = tasks.filter(t =>
          t.status !== 'completed' &&
          t.status !== 'failed' &&
          t.status !== 'cancelled'
        );
        logger.info(`Transfer queue tree: filtered out completed tasks (${beforeFilter} -> ${tasks.length})`);
      }
    }

    // If no tasks, show a placeholder message
    if (tasks.length === 0) {
      const placeholderItem = new vscode.TreeItem('No transfer tasks');
      placeholderItem.description = this.showHistory
        ? 'No transfer history available'
        : 'Queue is empty';
      placeholderItem.iconPath = new vscode.ThemeIcon('info');
      placeholderItem.contextValue = 'placeholder';
      logger.info('Transfer queue tree: showing placeholder (no tasks)');
      return Promise.resolve([placeholderItem as any]);
    }

    // Create tree items
    const items = tasks.map(task =>
      new TransferQueueTreeItem(task, vscode.TreeItemCollapsibleState.None)
    );

    logger.info(`Transfer queue tree: returning ${items.length} tree items`);
    return Promise.resolve(items);
  }

  /**
   * Toggle show completed tasks
   */
  toggleShowCompleted(): void {
    this.showCompleted = !this.showCompleted;
    this.refresh();
    logger.info(`Show completed: ${this.showCompleted}`);
  }

  /**
   * Toggle show history
   */
  toggleShowHistory(): void {
    this.showHistory = !this.showHistory;
    this.refresh();
    logger.info(`Show history: ${this.showHistory}`);
  }

  /**
   * Set status filter
   */
  setStatusFilter(status?: TaskStatus): void {
    this.filterStatus = status;
    this.refresh();
    logger.info(`Status filter: ${status || 'none'}`);
  }

  /**
   * Set history service (called after initialization)
   */
  setHistoryService(service: TransferHistoryService): void {
    this.historyService = service;

    // Listen to history changes
    this.historyService.onHistoryChanged(() => {
      if (this.showHistory) {
        this.refresh();
      }
    });
  }
}

/**
 * Transfer Statistics Panel Provider
 */
export class TransferStatsProvider {
  private readonly queueService: TransferQueueService;
  private panel?: vscode.WebviewPanel;

  constructor() {
    this.queueService = TransferQueueService.getInstance();
  }

  /**
   * Show statistics panel
   */
  show(context: vscode.ExtensionContext): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'transferStats',
      'Transfer Statistics',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.updateContent();

    // Update periodically while visible
    const interval = setInterval(() => {
      if (this.panel?.visible) {
        this.updateContent();
      }
    }, 1000);

    this.panel.onDidDispose(() => {
      clearInterval(interval);
      this.panel = undefined;
    });
  }

  /**
   * Update webview content
   */
  private updateContent(): void {
    if (!this.panel) {return;}

    const stats = this.queueService.getStats();
    const queueStatus = this.queueService.getQueueStatus();

    this.panel.webview.html = this.getHtml(stats, queueStatus);
  }

  /**
   * Generate HTML content
   */
  private getHtml(stats: any, queueStatus: any): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Transfer Statistics</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
    }
    .stat-group {
      margin-bottom: 30px;
    }
    .stat-group h2 {
      font-size: 18px;
      margin-bottom: 15px;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 5px;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .stat-label {
      font-weight: 500;
    }
    .stat-value {
      font-family: monospace;
    }
    .progress-bar {
      width: 100%;
      height: 8px;
      background-color: var(--vscode-progressBar-background);
      border-radius: 4px;
      overflow: hidden;
      margin: 5px 0;
    }
    .progress-fill {
      height: 100%;
      background-color: var(--vscode-progressBar-background);
      transition: width 0.3s ease;
    }
  </style>
</head>
<body>
  <div class="stat-group">
    <h2>Queue Status</h2>
    <div class="stat-row">
      <span class="stat-label">Status:</span>
      <span class="stat-value">${queueStatus.isPaused ? 'PAUSED' : 'ACTIVE'}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Running Tasks:</span>
      <span class="stat-value">${queueStatus.runningCount} / ${queueStatus.maxConcurrent}</span>
    </div>
  </div>

  <div class="stat-group">
    <h2>Tasks</h2>
    <div class="stat-row">
      <span class="stat-label">Total:</span>
      <span class="stat-value">${stats.total}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Pending:</span>
      <span class="stat-value">${stats.pending}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Running:</span>
      <span class="stat-value">${stats.running}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Paused:</span>
      <span class="stat-value">${stats.paused}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Completed:</span>
      <span class="stat-value">${stats.completed}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Failed:</span>
      <span class="stat-value">${stats.failed}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Cancelled:</span>
      <span class="stat-value">${stats.cancelled}</span>
    </div>
  </div>

  <div class="stat-group">
    <h2>Transfer Progress</h2>
    <div class="stat-row">
      <span class="stat-label">Total:</span>
      <span class="stat-value">${formatBytes(stats.totalBytes)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Transferred:</span>
      <span class="stat-value">${formatBytes(stats.transferredBytes)}</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${stats.totalBytes > 0 ? (stats.transferredBytes / stats.totalBytes * 100) : 0}%"></div>
    </div>
    <div class="stat-row">
      <span class="stat-label">Average Speed:</span>
      <span class="stat-value">${formatSpeed(stats.averageSpeed)}</span>
    </div>
  </div>
</body>
</html>`;
  }
}
