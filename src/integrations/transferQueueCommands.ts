/**
 * Transfer Queue Integration for CommandHandler
 *
 * This file contains the command handlers for transfer queue management.
 * These should be added to commandHandler.ts
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { TransferQueueService } from '../services/transferQueueService';
import { TransferHistoryService } from '../services/transferHistoryService';
import { TransferTaskModel } from '../models/transferTask';
import { TimeUtils } from '../timeUtils';
import { logger } from '../logger';
import { UI } from '../constants';

/**
 * Command handlers to add to CommandHandler class
 */
export class TransferQueueCommands {
  private readonly queueService: TransferQueueService;
  private readonly historyService?: TransferHistoryService;
  private readonly extensionContext?: vscode.ExtensionContext;

  constructor(extensionContext?: vscode.ExtensionContext) {
    this.queueService = TransferQueueService.getInstance();
    this.extensionContext = extensionContext;

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
      'Confirm'
    );

    if (confirm === 'Confirm') {
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

    // Only show message for active tasks
    if (task.status === 'running' || task.status === 'pending' || task.status === 'paused') {
      vscode.window.showInformationMessage(`Removed: ${task.fileName}`);
    }

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

  // Store active task detail panels
  private readonly taskDetailPanels = new Map<string, vscode.WebviewPanel>();
  private readonly taskUpdateIntervals = new Map<string, NodeJS.Timeout>();

  /**
   * Show task details using WebView panel with external HTML template
   */
  async showTaskDetails(task?: TransferTaskModel): Promise<void> {
    if (!task) {
      task = await this.selectTask();
      if (!task) {
        logger.warn('No task selected for showing details');
        return;
      }
    }

    // Validate task object
    if (!task || !task.id || !task.fileName) {
      logger.error('Invalid task object provided to showTaskDetails');
      vscode.window.showErrorMessage('Invalid task: missing required properties');
      return;
    }

    // Check if panel already exists for this task
    const existingPanel = this.taskDetailPanels.get(task.id);
    if (existingPanel) {
      try {
        // Reuse existing panel - reveal without changing column
        existingPanel.reveal(existingPanel.viewColumn);
        // Update content with latest data
        const duration = task.getDuration();
        const avgSpeed = task.getAverageSpeed();
        existingPanel.webview.html = this.getWebviewContent(task, duration, avgSpeed);
        return;
      } catch (error) {
        // Panel might be disposed, clean up and create new one
        logger.warn(`Failed to reuse panel for task ${task.id}: ${error}`);
        this.cleanupTaskPanel(task.id);
      }
    }

    const duration = task.getDuration();
    const avgSpeed = task.getAverageSpeed();

    // Create webview panel with scripts enabled
    const panel = vscode.window.createWebviewPanel(
      'taskDetails',
      `Task: ${task.fileName}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    // Set icon for the webview panel tab based on task type
    const iconName = task.type === 'upload' ? UI.ICONS.TASK_UPLOAD : UI.ICONS.TASK_DOWNLOAD;
    panel.iconPath = new vscode.ThemeIcon(iconName);

    // Store panel reference
    this.taskDetailPanels.set(task.id, panel);

    // Load HTML content from template
    panel.webview.html = this.getWebviewContent(task, duration, avgSpeed);

    // Setup real-time updates for running tasks
    if (task.status === 'running' || task.status === 'pending' || task.status === 'paused') {
      const updateInterval = setInterval(() => {
        const currentTask = this.queueService.getTask(task.id);
        if (!currentTask) {
          this.cleanupTaskPanel(task.id);
          return;
        }

        // Send update message to webview
        panel.webview.postMessage({
          type: 'update',
          task: {
            status: currentTask.status,
            progress: currentTask.progress,
            transferred: currentTask.transferred,
            fileSize: currentTask.fileSize,
            speed: currentTask.speed,
            estimatedTime: currentTask.estimatedTime,
            lastError: currentTask.lastError,
            startedAt: currentTask.startedAt,
            chunkProgress: currentTask.chunkProgress,
            speedHistory: currentTask.speedHistory
          }
        });

        // Stop updating if task is finished
        if (currentTask.status === 'completed' || currentTask.status === 'failed' || currentTask.status === 'cancelled') {
          // Only clear the interval, keep the panel open
          const interval = this.taskUpdateIntervals.get(task.id);
          if (interval) {
            clearInterval(interval);
            this.taskUpdateIntervals.delete(task.id);
          }
        }
      }, 500); // Update every 500ms

      this.taskUpdateIntervals.set(task.id, updateInterval);
    }

    // Cleanup when panel is closed
    panel.onDidDispose(() => {
      this.cleanupTaskPanel(task.id);
    });
  }

  /**
   * Cleanup task panel and interval
   */
  private cleanupTaskPanel(taskId: string): void {
    const interval = this.taskUpdateIntervals.get(taskId);
    if (interval) {
      clearInterval(interval);
      this.taskUpdateIntervals.delete(taskId);
    }
    this.taskDetailPanels.delete(taskId);
  }

  /**
   * Load and populate HTML template for task details
   */
  private getWebviewContent(task: TransferTaskModel, duration?: number, avgSpeed?: number): string {
    // Load HTML template
    let html = this.loadHtmlTemplate();

    // Check if html is valid string
    if (!html || typeof html !== 'string') {
      logger.error('Invalid HTML template loaded');
      return '<html><body><h1>Error loading template</h1></body></html>';
    }

    // Replace all placeholders with actual values
    const replacements: Record<string, string> = {
      '{{TITLE}}': `Task Details: ${task.fileName}`,
      '{{FILE_NAME}}': this.escapeHtml(task.fileName),
      '{{TYPE}}': task.type.toUpperCase(),
      '{{STATUS}}': task.status.toUpperCase(),
      '{{STATUS_CLASS}}': task.status.toLowerCase(),
      '{{HOST}}': this.escapeHtml(task.hostName),
      '{{LOCAL_PATH}}': this.escapeHtml(task.localPath),
      '{{REMOTE_PATH}}': this.escapeHtml(task.remotePath),
      '{{FILE_SIZE}}': this.formatBytes(task.fileSize),
      '{{TRANSFERRED}}': this.formatBytes(task.transferred),
      '{{PROGRESS}}': task.progress.toFixed(2),
      '{{CREATED_AT}}': TimeUtils.formatTime(task.createdAt.getTime()),
      '{{TASK_ID}}': task.id,
      '{{CURRENT_SPEED}}': this.formatSpeed(task.speed),
      '{{SPEED_DISPLAY}}': task.speed > 0 || task.status === 'running' ? 'flex' : 'none'
    };

    // Add running info
    if (task.status === 'running') {
      replacements['{{#RUNNING_INFO}}'] = '';
      replacements['{{/RUNNING_INFO}}'] = '';
      replacements['{{CURRENT_SPEED}}'] = this.formatSpeed(task.speed);

      if (task.estimatedTime) {
        replacements['{{#HAS_ESTIMATE}}'] = '';
        replacements['{{/HAS_ESTIMATE}}'] = '';
        replacements['{{ESTIMATED_TIME}}'] = this.formatDuration(task.estimatedTime);
      } else {
        html = this.removeConditionalBlock(html, '{{#HAS_ESTIMATE}}', '{{/HAS_ESTIMATE}}');
      }
    } else {
      html = this.removeConditionalBlock(html, '{{#RUNNING_INFO}}', '{{/RUNNING_INFO}}');
    }

    // Add duration and average speed
    if (duration) {
      replacements['{{#HAS_DURATION}}'] = '';
      replacements['{{/HAS_DURATION}}'] = '';
      replacements['{{DURATION}}'] = this.formatDuration(duration);

      if (avgSpeed) {
        replacements['{{#HAS_AVG_SPEED}}'] = '';
        replacements['{{/HAS_AVG_SPEED}}'] = '';
        replacements['{{AVG_SPEED}}'] = this.formatSpeed(avgSpeed);
      } else {
        html = this.removeConditionalBlock(html, '{{#HAS_AVG_SPEED}}', '{{/HAS_AVG_SPEED}}');
      }
    } else {
      html = this.removeConditionalBlock(html, '{{#HAS_DURATION}}', '{{/HAS_DURATION}}');
    }

    // Add retry information
    if (task.retryCount > 0) {
      replacements['{{#HAS_RETRIES}}'] = '';
      replacements['{{/HAS_RETRIES}}'] = '';
      replacements['{{RETRY_COUNT}}'] = task.retryCount.toString();
      replacements['{{MAX_RETRIES}}'] = task.maxRetries.toString();
    } else {
      html = this.removeConditionalBlock(html, '{{#HAS_RETRIES}}', '{{/HAS_RETRIES}}');
    }

    // Add error information
    if (task.lastError) {
      replacements['{{#HAS_ERROR}}'] = '';
      replacements['{{/HAS_ERROR}}'] = '';
      replacements['{{ERROR_MESSAGE}}'] = this.escapeHtml(task.lastError);
    } else {
      html = this.removeConditionalBlock(html, '{{#HAS_ERROR}}', '{{/HAS_ERROR}}');
    }

    // Add timestamps
    if (task.startedAt) {
      replacements['{{#HAS_STARTED}}'] = '';
      replacements['{{/HAS_STARTED}}'] = '';
      replacements['{{STARTED_AT}}'] = TimeUtils.formatTime(task.startedAt.getTime());
    } else {
      html = this.removeConditionalBlock(html, '{{#HAS_STARTED}}', '{{/HAS_STARTED}}');
    }

    if (task.completedAt) {
      replacements['{{#HAS_COMPLETED}}'] = '';
      replacements['{{/HAS_COMPLETED}}'] = '';
      replacements['{{COMPLETED_AT}}'] = TimeUtils.formatTime(task.completedAt.getTime());
    } else {
      html = this.removeConditionalBlock(html, '{{#HAS_COMPLETED}}', '{{/HAS_COMPLETED}}');
    }

    // Apply all replacements
    Object.entries(replacements).forEach(([key, value]) => {
      html = html.replaceAll(key, value);
    });

    return html;
  }

  /**
   * Load HTML template from file
   */
  private loadHtmlTemplate(): string {
    try {
      // Get template path
      const templatePath = this.extensionContext
        ? path.join(this.extensionContext.extensionPath, 'resources', 'webview', 'task-details.html')
        : path.join(__dirname, '..', '..', 'resources', 'webview', 'task-details.html');

      // Read template file
      const fs = require('node:fs');
      const content = fs.readFileSync(templatePath, 'utf8');

      if (!content || content.trim().length === 0) {
        throw new Error('Template file is empty');
      }

      return content;
    } catch (error) {
      logger.error(`Failed to load HTML template: ${error}`);
      // Return a complete fallback HTML that doesn't use replaceAll
      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Task Details</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; }
    .error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <h1>Task Details</h1>
  <p class="error">Error loading template file.</p>
  <p>Error: ${String(error)}</p>
  <p>Please check if the template file exists at: resources/webview/task-details.html</p>
</body>
</html>`;
    }
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    // Handle undefined, null, or non-string values
    if (text === undefined || text === null) {
      return '';
    }

    const str = String(text);
    return str
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  /**
   * Get status color for WebView (kept for backward compatibility)
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
   * Show running tasks - called when clicking status bar
   */
  async showRunningTasks(): Promise<void> {
    const runningTasks = this.queueService.getRunningTasks();

    if (runningTasks.length === 0) {
      vscode.window.showInformationMessage('No tasks currently running');
      return;
    }

    // If only one task is running, show its details directly
    if (runningTasks.length === 1) {
      await this.showTaskDetails(runningTasks[0]);
      return;
    }

    // Multiple tasks running - let user choose
    const items = runningTasks.map(task => ({
      label: task.fileName,
      description: `${task.type} · ${task.progress.toFixed(1)}% · ${this.formatSpeed(task.speed)}`,
      detail: `${task.hostName} · ${this.formatBytes(task.transferred)} / ${this.formatBytes(task.fileSize)}`,
      task
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a running task to view details',
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (selected) {
      await this.showTaskDetails(selected.task);
    }
  }

  /**
   * Show queue statistics
   */
  async showQueueStats(): Promise<void> {
    const stats = this.queueService.getStats();
    const status = this.queueService.getQueueStatus();

    const details = [
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      'QUEUE STATUS',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `Status:          ${status.isPaused ? 'PAUSED' : 'ACTIVE'}`,
      `Running:         ${status.runningCount} / ${status.maxConcurrent}`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      'TASKS',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `Total:           ${stats.total}`,
      `Pending:         ${stats.pending}`,
      `Running:         ${stats.running}`,
      `Paused:          ${stats.paused}`,
      `Completed:       ${stats.completed}`,
      `Failed:          ${stats.failed}`,
      `Cancelled:       ${stats.cancelled}`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      'TRANSFER PROGRESS',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `Total Size:      ${this.formatBytes(stats.totalBytes)}`,
      `Transferred:     ${this.formatBytes(stats.transferredBytes)}`,
      `Average Speed:   ${this.formatSpeed(stats.averageSpeed)}`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
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
      'Clear'
    );

    if (confirm === 'Clear') {
      await this.historyService.clearAllHistory();
      vscode.window.showInformationMessage('History cleared');
      logger.info('History cleared by user');
    }
  }

  /**
   * Remove a task from history
   */
  async removeHistoryTask(treeItem?: any): Promise<void> {
    if (!this.historyService) {
      vscode.window.showWarningMessage('History service not available');
      return;
    }

    const task = treeItem?.task as TransferTaskModel | undefined;
    if (!task) {
      vscode.window.showWarningMessage('No task selected');
      return;
    }

    this.historyService.removeFromHistory(task.id);
    logger.info(`Removed task from history: ${task.id}`);
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

  /**
   * Helper: Remove conditional block from HTML template
   */
  private removeConditionalBlock(html: string, startMarker: string, endMarker: string): string {
    const startIndex = html.indexOf(startMarker);
    if (startIndex === -1) {
      return html; // Marker not found, return original
    }

    const endIndex = html.indexOf(endMarker, startIndex);
    if (endIndex === -1) {
      return html; // End marker not found, return original
    }

    // Remove everything from start marker to end marker (inclusive)
    return html.substring(0, startIndex) + html.substring(endIndex + endMarker.length);
  }
}
