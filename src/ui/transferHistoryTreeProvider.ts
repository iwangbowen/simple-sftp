import * as vscode from 'vscode';
import { TransferHistoryService } from '../services/transferHistoryService';
import { TransferTaskModel } from '../models/transferTask';
import { TaskStatus } from '../types/transfer.types';
import { formatBytes, formatDuration } from '../utils/formatUtils';
import { logger } from '../logger';

class TransferHistoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly task: TransferTaskModel,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(task.fileName, collapsibleState);

    this.tooltip = this.buildTooltip();
    this.description = this.buildDescription();
    this.iconPath = this.getIcon();
    this.contextValue = `historyTask.status-${task.status}`;

    this.command = {
      command: 'simpleSftp.showTaskDetails',
      title: 'Show Task Details',
      arguments: [task]
    };
  }

  private buildTooltip(): string {
    const task = this.task;
    const lines = [
      `File: ${task.fileName}`,
      `Type: ${task.type.toUpperCase()}`,
      `Status: ${task.status.toUpperCase()}`,
      `Host: ${task.hostName}`,
      `Local: ${task.localPath}`,
      `Remote: ${task.remotePath}`,
      `Size: ${formatBytes(task.fileSize)}`
    ];

    if (task.completedAt && task.startedAt) {
      const duration = task.completedAt.getTime() - task.startedAt.getTime();
      lines.push(`Duration: ${formatDuration(duration)}`);
    }

    if (task.lastError) {
      lines.push(`Error: ${task.lastError}`);
    }

    return lines.join('\n');
  }

  private buildDescription(): string {
    const task = this.task;
    const parts: string[] = [];

    parts.push(formatBytes(task.fileSize));

    if (task.completedAt && task.startedAt) {
      const duration = task.completedAt.getTime() - task.startedAt.getTime();
      parts.push(formatDuration(duration));
    }

    parts.push(`[${task.status}]`);

    return parts.join(' · ');
  }

  private getIcon(): vscode.ThemeIcon {
    const iconMap: Record<TaskStatus, string> = {
      pending: 'circle-outline',
      running: 'sync~spin',
      paused: 'debug-pause',
      completed: 'check',
      failed: 'error',
      cancelled: 'circle-slash'
    };

    const icon = iconMap[this.task.status] || 'file';
    return new vscode.ThemeIcon(icon);
  }
}

export class TransferHistoryTreeProvider implements vscode.TreeDataProvider<TransferHistoryTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TransferHistoryTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private historyService?: TransferHistoryService;
  private maxItems: number = 50;

  setHistoryService(service: TransferHistoryService): void {
    this.historyService = service;
    this.historyService.onHistoryChanged(() => {
      this.refresh();
    });
    logger.info('Transfer history tree provider initialized');
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TransferHistoryTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TransferHistoryTreeItem): Thenable<TransferHistoryTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    if (!this.historyService) {
      const placeholderItem = new vscode.TreeItem('History service not initialized');
      placeholderItem.iconPath = new vscode.ThemeIcon('warning');
      return Promise.resolve([placeholderItem as any]);
    }

    const tasks = this.historyService.getRecentHistory(this.maxItems);

    if (tasks.length === 0) {
      const placeholderItem = new vscode.TreeItem('No transfer history');
      placeholderItem.description = 'History is empty';
      placeholderItem.iconPath = new vscode.ThemeIcon('info');
      placeholderItem.contextValue = 'placeholder';
      return Promise.resolve([placeholderItem as any]);
    }

    const items = tasks.map(task =>
      new TransferHistoryTreeItem(task, vscode.TreeItemCollapsibleState.None)
    );

    logger.info(`Transfer history tree: returning ${items.length} items`);
    return Promise.resolve(items);
  }

  setMaxItems(max: number): void {
    this.maxItems = max;
    this.refresh();
  }
}
