/**
 * Transfer Queue Integration for CommandHandler
 *
 * This file contains the command handlers for transfer queue management.
 * These should be added to commandHandler.ts
 */

import * as vscode from 'vscode';
import { TransferQueueService } from '../services/transferQueueService';
import { TransferHistoryService } from '../services/transferHistoryService';
import { TransferTaskModel } from '../models/transferTask';
import { logger } from '../logger';

/**
 * Command handlers to add to CommandHandler class
 */
export class TransferQueueCommands {
  private queueService: TransferQueueService;
  private historyService?: TransferHistoryService;

  constructor() {
    this.queueService = TransferQueueService.getInstance();

    try {
      this.historyService = TransferHistoryService.getInstance();
    } catch {
      // Will be initialized later
    }
  }

  /**
   * Pause the entire transfer queue
   */
  async pauseQueue(): Promise<void> {
    this.queueService.pauseQueue();
    logger.info('Transfer queue paused by user');
  }

  /**
   * Resume the transfer queue
   */
  async resumeQueue(): Promise<void> {
    this.queueService.resumeQueue();
    logger.info('Transfer queue resumed by user');
  }

  /**
   * Pause a specific task
   */
  async pauseTask(task?: TransferTaskModel): Promise<void> {
    if (!task) {
      task = await this.selectTask('running');
      if (!task) {return;}
    }

    this.queueService.pauseTask(task.id);
    vscode.window.showInformationMessage(`Paused: ${task.fileName}`);
    logger.info(`Task paused: ${task.id}`);
  }

  /**
   * Resume a specific task
   */
  async resumeTask(task?: TransferTaskModel): Promise<void> {
    if (!task) {
      task = await this.selectTask('paused');
      if (!task) {return;}
    }

    this.queueService.resumeTask(task.id);
    vscode.window.showInformationMessage(`Resumed: ${task.fileName}`);
    logger.info(`Task resumed: ${task.id}`);
  }

  /**
   * Cancel a specific task
   */
  async cancelTask(task?: TransferTaskModel): Promise<void> {
    if (!task) {
      task = await this.selectTask();
      if (!task) {return;}
    }

    const confirm = await vscode.window.showWarningMessage(
      `Cancel transfer: ${task.fileName}?`,
      { modal: true },
      'Yes', 'No'
    );

    if (confirm === 'Yes') {
      await this.queueService.cancelTask(task.id);
      vscode.window.showInformationMessage(`Cancelled: ${task.fileName}`);
      logger.info(`Task cancelled: ${task.id}`);
    }
  }

  /**
   * Retry a failed task
   */
  async retryTask(task?: TransferTaskModel): Promise<void> {
    if (!task) {
      task = await this.selectTask('failed');
      if (!task) {return;}
    }

    if (task.incrementRetry()) {
      vscode.window.showInformationMessage(`Retrying: ${task.fileName}`);
      logger.info(`Task retry initiated: ${task.id}`);
    } else {
      vscode.window.showWarningMessage(`Cannot retry: ${task.fileName} (max retries reached)`);
    }
  }

  /**
   * Remove a task from queue
   */
  async removeTask(task?: TransferTaskModel): Promise<void> {
    if (!task) {
      task = await this.selectTask();
      if (!task) {return;}
    }

    this.queueService.removeTask(task.id);
    vscode.window.showInformationMessage(`Removed: ${task.fileName}`);
    logger.info(`Task removed: ${task.id}`);
  }

  /**
   * Clear completed tasks
   */
  async clearCompleted(): Promise<void> {
    const stats = this.queueService.getStats();
    const completedCount = stats.completed + stats.failed + stats.cancelled;

    if (completedCount === 0) {
      vscode.window.showInformationMessage('No completed tasks to clear');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Clear ${completedCount} completed tasks?`,
      { modal: false },
      'Yes', 'No'
    );

    if (confirm === 'Yes') {
      this.queueService.clearCompleted();
      vscode.window.showInformationMessage(`Cleared ${completedCount} tasks`);
      logger.info(`Cleared ${completedCount} completed tasks`);
    }
  }

  /**
   * Clear all tasks
   */
  async clearAll(): Promise<void> {
    const stats = this.queueService.getStats();

    if (stats.total === 0) {
      vscode.window.showInformationMessage('Queue is empty');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Clear all ${stats.total} tasks? Running transfers will be cancelled.`,
      { modal: true },
      'Yes', 'No'
    );

    if (confirm === 'Yes') {
      this.queueService.clearAll();
      vscode.window.showInformationMessage('Queue cleared');
      logger.info('Queue cleared by user');
    }
  }

  /**
   * Show task details using WebView panel
   */
  async showTaskDetails(task?: TransferTaskModel): Promise<void> {
    if (!task) {
      task = await this.selectTask();
      if (!task) {return;}
    }

    const duration = task.getDuration();
    const avgSpeed = task.getAverageSpeed();

    const details = [
      `**File:** ${task.fileName}`,
      `**Type:** ${task.type.toUpperCase()}`,
      `**Status:** ${task.status.toUpperCase()}`,
      '',
      `**Host:** ${task.hostName}`,
      `**Local:** ${task.localPath}`,
      `**Remote:** ${task.remotePath}`,
      '',
      `**Size:** ${this.formatBytes(task.fileSize)}`,
      `**Transferred:** ${this.formatBytes(task.transferred)}`,
      `**Progress:** ${task.progress.toFixed(2)}%`,
      ''
    ];

    if (task.status === 'running') {
      details.push(`**Speed:** ${this.formatSpeed(task.speed)}`);
      if (task.estimatedTime) {
        details.push(`**Estimated Time:** ${this.formatDuration(task.estimatedTime)}`);
      }
    }

    if (duration) {
      details.push(`**Duration:** ${this.formatDuration(duration)}`);
    }

    if (avgSpeed) {
      details.push(`**Average Speed:** ${this.formatSpeed(avgSpeed)}`);
    }

    if (task.retryCount > 0) {
      details.push(`**Retries:** ${task.retryCount}/${task.maxRetries}`);
    }

    if (task.lastError) {
      details.push('', `**Error:** ${task.lastError}`);
    }

    // Create webview panel to display markdown
    const panel = vscode.window.createWebviewPanel(
      'taskDetails',
      `Task: ${task.fileName}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: false,
        retainContextWhenHidden: true
      }
    );

    // Convert markdown to HTML
    const htmlContent = this.markdownToHtml(details.join('\n\n'), task);
    panel.webview.html = htmlContent;
  }

  /**
   * Convert markdown to HTML for webview
   */
  private markdownToHtml(markdown: string, task: TransferTaskModel): string {
    // Simple markdown to HTML conversion
    let html = markdown
      .replaceAll(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replaceAll('\n\n', '<br><br>')
      .replaceAll('\n', '<br>');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Task Details</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      line-height: 1.6;
    }
    strong {
      color: var(--vscode-textLink-foreground);
    }
    .status-${task.status} {
      color: ${this.getStatusColor(task.status)};
    }
    .header {
      font-size: 1.2em;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
  </style>
</head>
<body>
  <div class="header">
    <strong>Task Details: ${task.fileName}</strong>
  </div>
  <div>
    ${html}
  </div>
</body>
</html>`;
  }

  /**
   * Get status color for WebView
   */
  private getStatusColor(status: string): string {
    switch (status) {
      case 'completed':
        return '#4ec9b0';
      case 'failed':
        return '#f48771';
      case 'running':
        return '#569cd6';
      case 'paused':
        return '#dcdcaa';
      case 'cancelled':
        return '#858585';
      default:
        return '#d4d4d4';
    }
  }

  /**
   * Show queue statistics
   */
  async showQueueStats(): Promise<void> {
    const stats = this.queueService.getStats();
    const status = this.queueService.getQueueStatus();

    const details = [
      `**Queue Status:** ${status.isPaused ? 'PAUSED' : 'ACTIVE'}`,
      `**Running:** ${status.runningCount} / ${status.maxConcurrent}`,
      '',
      `**Total Tasks:** ${stats.total}`,
      `**Pending:** ${stats.pending}`,
      `**Running:** ${stats.running}`,
      `**Paused:** ${stats.paused}`,
      `**Completed:** ${stats.completed}`,
      `**Failed:** ${stats.failed}`,
      `**Cancelled:** ${stats.cancelled}`,
      '',
      `**Total Size:** ${this.formatBytes(stats.totalBytes)}`,
      `**Transferred:** ${this.formatBytes(stats.transferredBytes)}`,
      `**Average Speed:** ${this.formatSpeed(stats.averageSpeed)}`
    ];

    vscode.window.showInformationMessage(
      'Transfer Queue Statistics',
      { modal: true, detail: details.join('\n') }
    );
  }

  /**
   * View transfer history
   */
  async viewHistory(): Promise<void> {
    if (!this.historyService) {
      vscode.window.showWarningMessage('History service not available');
      return;
    }

    const history = this.historyService.getRecentHistory(20);

    if (history.length === 0) {
      vscode.window.showInformationMessage('No transfer history');
      return;
    }

    const items = history.map(task => ({
      label: task.fileName,
      description: `${task.type} · ${task.status} · ${this.formatBytes(task.fileSize)}`,
      detail: `${task.hostName} · ${new Date(task.createdAt).toLocaleString()}`,
      task
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a transfer to view details',
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (selected) {
      await this.showTaskDetails(selected.task);
    }
  }

  /**
   * Clear history
   */
  async clearHistory(): Promise<void> {
    if (!this.historyService) {
      vscode.window.showWarningMessage('History service not available');
      return;
    }

    const stats = this.historyService.getStatistics();

    if (stats.total === 0) {
      vscode.window.showInformationMessage('History is empty');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Clear all ${stats.total} history records?`,
      { modal: true },
      'Yes', 'No'
    );

    if (confirm === 'Yes') {
      await this.historyService.clearAllHistory();
      vscode.window.showInformationMessage('History cleared');
      logger.info('History cleared by user');
    }
  }

  /**
   * Helper: Select a task from queue
   */
  private async selectTask(filterStatus?: string): Promise<TransferTaskModel | undefined> {
    let tasks = this.queueService.getAllTasks();

    if (filterStatus) {
      tasks = tasks.filter(t => t.status === filterStatus);
    }

    if (tasks.length === 0) {
      vscode.window.showInformationMessage(`No ${filterStatus || ''} tasks found`);
      return undefined;
    }

    const items = tasks.map(task => ({
      label: task.fileName,
      description: `${task.status} · ${task.progress.toFixed(1)}% · ${this.formatBytes(task.fileSize)}`,
      detail: task.hostName,
      task
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a task',
      matchOnDescription: true
    });

    return selected?.task;
  }

  /**
   * Helper: Format bytes
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) {return '0 B';}
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  /**
   * Helper: Format speed
   */
  private formatSpeed(bytesPerSec: number): string {
    if (bytesPerSec === 0) {return '0 B/s';}
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return `${(bytesPerSec / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  /**
   * Helper: Format duration
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {return `${seconds}s`;}
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {return `${minutes}m ${seconds % 60}s`;}
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
}
