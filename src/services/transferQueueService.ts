import * as vscode from 'vscode';
import * as fs from 'fs';
import { TransferTaskModel } from '../models/transferTask';
import {
  TransferTask,
  TaskStatus,
  CreateTransferTaskOptions,
  TransferStats,
  QueueStatus,
  RetryPolicy
} from '../types/transfer.types';import { HostConfig } from '../types';import { logger } from '../logger';
import { EventEmitter } from 'events';
import { SshConnectionManager } from '../sshConnectionManager';
import { HostManager } from '../hostManager';
import { AuthManager } from '../authManager';
/**
 * Transfer Queue Service
 * Manages file transfer queue with concurrency control
 */
export class TransferQueueService extends EventEmitter {
  private static instance: TransferQueueService;

  private queue: TransferTaskModel[] = [];
  private runningTasks: Set<string> = new Set();
  private maxConcurrent: number = 5; // Maximum concurrent transfers
  private isPaused: boolean = false;

  // Managers for host/auth configuration
  private hostManager?: HostManager;
  private authManager?: AuthManager;

  // Event emitter for UI updates
  private _onQueueChanged = new vscode.EventEmitter<void>();
  readonly onQueueChanged = this._onQueueChanged.event;

  private _onTaskUpdated = new vscode.EventEmitter<TransferTaskModel>();
  readonly onTaskUpdated = this._onTaskUpdated.event;

  private retryPolicy: RetryPolicy = {
    enabled: true,
    maxRetries: 3,
    retryDelay: 2000,
    backoffMultiplier: 2
  };

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): TransferQueueService {
    if (!TransferQueueService.instance) {
      TransferQueueService.instance = new TransferQueueService();
    }
    return TransferQueueService.instance;
  }

  /**
   * Initialize with managers
   */
  initialize(hostManager: HostManager, authManager: AuthManager): void {
    this.hostManager = hostManager;
    this.authManager = authManager;
    logger.info('TransferQueueService initialized with host and auth managers');
  }

  /**
   * Add task to queue
   */
  addTask(options: CreateTransferTaskOptions): TransferTaskModel {
    const task = new TransferTaskModel(options);
    this.queue.push(task);

    logger.info(`Task added to queue: ${task.fileName} (${task.type})`);
    this._onQueueChanged.fire();

    // Start processing queue
    this.processQueue();

    return task;
  }

  /**
   * Add multiple tasks to queue
   */
  addTasks(optionsList: CreateTransferTaskOptions[]): TransferTaskModel[] {
    const tasks = optionsList.map(options => new TransferTaskModel(options));
    this.queue.push(...tasks);

    logger.info(`${tasks.length} tasks added to queue`);
    this._onQueueChanged.fire();

    // Start processing queue
    this.processQueue();

    return tasks;
  }

  /**
   * Process queue - start pending tasks up to concurrency limit
   * Tasks are prioritized by:
   * 1. Priority level (high > normal > low)
   * 2. Creation time (earlier first)
   */
  private async processQueue(): Promise<void> {
    logger.debug(`processQueue called, isPaused: ${this.isPaused}, runningTasks: ${this.runningTasks.size}, maxConcurrent: ${this.maxConcurrent}`);

    if (this.isPaused) {
      logger.debug('Queue is paused, skipping processing');
      return;
    }

    // Find pending tasks and sort by priority
    const pendingTasks = this.queue
      .filter(t => t.status === 'pending')
      .sort((a, b) => {
        // Priority order: high > normal > low
        const priorityOrder = { high: 3, normal: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];

        if (priorityDiff !== 0) {
          return priorityDiff; // Sort by priority first
        }

        // If same priority, sort by creation time (earlier first)
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

    logger.debug(`Found ${pendingTasks.length} pending tasks (sorted by priority)`);

    // Start tasks up to concurrency limit
    for (const task of pendingTasks) {
      if (this.runningTasks.size >= this.maxConcurrent) {
        logger.debug('Concurrency limit reached');
        break;
      }

      if (!this.runningTasks.has(task.id)) {
        logger.info(`Starting task ${task.id}: ${task.fileName} (priority: ${task.priority})`);
        this.executeTask(task);
      } else {
        logger.debug(`Task ${task.id} already running`);
      }
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: TransferTaskModel): Promise<void> {
    try {
      this.runningTasks.add(task.id);
      task.start();
      this._onTaskUpdated.fire(task);

      logger.info(`Executing task ${task.id}: ${task.fileName}`);
      // TODO: Implement actual file transfer logic
      // This is a placeholder that will be replaced with real SFTP transfer
      await this.performTransfer(task);

      logger.info(`Transfer completed for task ${task.id}, marking as complete`);
      task.complete();
      this._onTaskUpdated.fire(task);
      logger.info(`Task ${task.id} completed successfully`);

    } catch (error: any) {
      // Check if task was paused (not a real error)
      if (task.status === 'paused') {
        logger.info(`Task ${task.id} paused: ${task.fileName}`);
        this._onTaskUpdated.fire(task);
        return; // Don't treat pause as failure
      }

      logger.error(`Task ${task.id} failed: ${error.message}`);

      // Check if we should retry
      if (this.retryPolicy.enabled && task.canRetry()) {
        task.fail(error.message);

        // Schedule retry with exponential backoff
        const retryDelay = this.retryPolicy.retryDelay *
          Math.pow(this.retryPolicy.backoffMultiplier || 1, task.retryCount - 1);

        logger.info(`Retrying task ${task.id} in ${retryDelay}ms (attempt ${task.retryCount}/${task.maxRetries})`);

        setTimeout(() => {
          if (task.incrementRetry()) {
            this._onTaskUpdated.fire(task);
            this.processQueue();
          }
        }, retryDelay);

      } else {
        task.fail(error.message);
        this._onTaskUpdated.fire(task);
      }

    } finally {
      this.runningTasks.delete(task.id);
      this._onQueueChanged.fire();

      // Process next task in queue
      this.processQueue();
    }
  }

  /**
   * Perform actual file transfer (placeholder)
   * TODO: Integrate with existing SSH/SFTP implementation
   */
  private async performTransfer(task: TransferTaskModel): Promise<void> {
    if (!this.hostManager || !this.authManager) {
      throw new Error('TransferQueueService not initialized with managers');
    }

    // Get host configuration
    const allHosts = await this.hostManager.getHosts();
    const host = allHosts.find((h: HostConfig) => h.id === task.hostId);

    if (!host) {
      throw new Error(`Host not found: ${task.hostId}`);
    }

    // Get auth configuration
    const authConfig = await this.authManager.getAuth(task.hostId);

    if (!authConfig) {
      throw new Error(`Auth configuration not found for host: ${task.hostId}`);
    }

    // Check file size if not set
    if (task.fileSize === 0 && fs.existsSync(task.localPath)) {
      const stats = fs.statSync(task.localPath);
      task.fileSize = stats.size;
      task.isDirectory = stats.isDirectory();
    }

    // Perform the transfer
    if (task.type === 'upload') {
      if (task.isDirectory) {
        await SshConnectionManager.uploadDirectory(
          host,
          authConfig,
          task.localPath,
          task.remotePath,
          (currentFile: string, percentage: number) => {
            // Update progress based on file count
            task.updateProgress(task.fileSize * percentage / 100, task.fileSize);
            this._onTaskUpdated.fire(task);
          },
          task.abortController?.signal
        );
      } else {
        await SshConnectionManager.uploadFile(
          host,
          authConfig,
          task.localPath,
          task.remotePath,
          (transferred: number, total: number) => {
            task.updateProgress(transferred, total);
            this._onTaskUpdated.fire(task);
          },
          task.abortController?.signal,
          task.transferred // 从已传输的位置开始（断点续传）
        );
      }
    } else if (task.type === 'download') {
      // Download
      if (task.isDirectory) {
        await SshConnectionManager.downloadDirectory(
          host,
          authConfig,
          task.remotePath,
          task.localPath,
          (currentFile: string, percentage: number) => {
            // Update progress based on file count
            task.updateProgress(task.fileSize * percentage / 100, task.fileSize);
            this._onTaskUpdated.fire(task);
          },
          task.abortController?.signal
        );
      } else {
        logger.info(`🚀 Starting downloadFile for task ${task.id}: ${task.remotePath} -> ${task.localPath}`);

        // Flag to track if chunks have been initialized
        let chunksInitialized = false;

        // Initialize chunk progress if this might be a parallel download
        const initializeChunks = (fileSize: number) => {
          if (!chunksInitialized && fileSize > 100 * 1024 * 1024) { // 100MB threshold
            const chunkSize = 10 * 1024 * 1024; // 10MB per chunk
            const totalChunks = Math.ceil(fileSize / chunkSize);
            logger.info(`Initializing ${totalChunks} chunks for file size: ${fileSize} bytes`);
            task.initializeChunkProgress(totalChunks, chunkSize, fileSize);
            chunksInitialized = true;
            this._onTaskUpdated.fire(task);
          }
        };

        await SshConnectionManager.downloadFile(
          host,
          authConfig,
          task.remotePath,
          task.localPath,
          {
            onProgress: (transferred: number, total: number) => {
              // Initialize chunks when we first learn the file size
              if (total > 0) {
                initializeChunks(total);
              }
              task.updateProgress(transferred, total);
              this._onTaskUpdated.fire(task);
            },
            signal: task.abortController?.signal,
            startOffset: task.transferred, // 从已传输的位置开始(断点续传)
            onChunkProgress: (chunkIndex: number, transferred: number, total: number, status: 'pending' | 'downloading' | 'completed' | 'failed') => {
              logger.debug(`Chunk ${chunkIndex} update: ${transferred}/${total} bytes, status: ${status}`);
              task.updateChunkProgress(chunkIndex, transferred, status);
              this._onTaskUpdated.fire(task);
            }
          }
        );
        logger.info(`✅ downloadFile completed for task ${task.id}: ${task.remotePath}`);
      }
    }
    logger.info(`🎯 performTransfer finished for task ${task.id}, returning to executeTask`);
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): TransferTaskModel | undefined {
    return this.queue.find(t => t.id === taskId);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): TransferTaskModel[] {
    return [...this.queue];
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(status: TaskStatus): TransferTaskModel[] {
    return this.queue.filter(t => t.status === status);
  }

  /**
   * Get running tasks
   */
  getRunningTasks(): TransferTaskModel[] {
    return this.queue.filter(t => t.status === 'running');
  }

  /**
   * Get pending tasks
   */
  getPendingTasks(): TransferTaskModel[] {
    return this.queue.filter(t => t.status === 'pending');
  }

  /**
   * Pause a specific task
   */
  pauseTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (task) {
      task.pause();
      // Force remove from running tasks to ensure it can be resumed
      this.runningTasks.delete(taskId);
      this._onTaskUpdated.fire(task);
      this._onQueueChanged.fire();
      logger.info(`Task force paused and removed from running set: ${taskId}`);
    }
  }

  /**
   * Resume a specific task
   */
  resumeTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (task) {
      task.resume();
      this._onTaskUpdated.fire(task);
      this.processQueue();
    }
  }

  /**
   * Cancel a specific task
   */
  async cancelTask(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (task) {
      task.cancel();

      // Clean up incomplete files
      if (task.type === 'download' && task.status === 'cancelled') {
        // Delete incomplete local file
        try {
          if (fs.existsSync(task.localPath)) {
            if (task.isDirectory) {
              fs.rmSync(task.localPath, { recursive: true, force: true });
              logger.info(`Deleted incomplete directory: ${task.localPath}`);
            } else {
              fs.unlinkSync(task.localPath);
              logger.info(`Deleted incomplete file: ${task.localPath}`);
            }
          }
        } catch (error: any) {
          logger.error(`Failed to delete incomplete local file: ${error.message}`);
        }
      } else if (task.type === 'upload' && task.status === 'cancelled' && this.hostManager && this.authManager) {
        // For upload, delete the incomplete remote file
        try {
          const allHosts = await this.hostManager.getHosts();
          const host = allHosts.find((h: HostConfig) => h.id === task.hostId);
          const authConfig = await this.authManager.getAuth(task.hostId);

          if (host && authConfig) {
            await SshConnectionManager.deleteRemoteFile(host, authConfig, task.remotePath);
            logger.info(`Deleted incomplete remote file: ${task.remotePath}`);
          }
        } catch (error: any) {
          logger.error(`Failed to delete incomplete remote file: ${error.message}`);
        }
      }

      // Force remove from running tasks
      this.runningTasks.delete(taskId);

      this._onTaskUpdated.fire(task);
      this._onQueueChanged.fire();
    }
  }

  /**
   * Remove a task from queue
   */
  removeTask(taskId: string): void {
    const index = this.queue.findIndex(t => t.id === taskId);
    if (index !== -1) {
      const task = this.queue[index];

      // Cancel if running
      if (task.status === 'running') {
        task.cancel();
      }

      this.queue.splice(index, 1);
      this.runningTasks.delete(taskId);

      logger.info(`Task ${taskId} removed from queue`);
      this._onQueueChanged.fire();
    }
  }

  /**
   * Pause entire queue
   */
  pauseQueue(): void {
    this.isPaused = true;

    // Pause all running tasks
    this.getRunningTasks().forEach(task => {
      task.pause();
      this._onTaskUpdated.fire(task);
    });

    logger.info('Queue paused');
    this._onQueueChanged.fire();
  }

  /**
   * Resume entire queue
   */
  resumeQueue(): void {
    this.isPaused = false;

    // Resume paused tasks
    this.getTasksByStatus('paused').forEach(task => {
      task.resume();
      this._onTaskUpdated.fire(task);
    });

    logger.info('Queue resumed');
    this.processQueue();
  }

  /**
   * Clear completed/failed/cancelled tasks
   */
  clearCompleted(): void {
    const toRemove = this.queue.filter(t =>
      t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
    );

    toRemove.forEach(task => {
      const index = this.queue.indexOf(task);
      if (index !== -1) {
        this.queue.splice(index, 1);
      }
    });

    logger.info(`Cleared ${toRemove.length} completed tasks`);
    this._onQueueChanged.fire();
  }

  /**
   * Clear all tasks
   */
  clearAll(): void {
    // Cancel running tasks
    this.getRunningTasks().forEach(task => task.cancel());

    this.queue = [];
    this.runningTasks.clear();

    logger.info('Queue cleared');
    this._onQueueChanged.fire();
  }

  /**
   * Get queue statistics
   */
  getStats(): TransferStats {
    const tasks = this.queue;

    const stats: TransferStats = {
      total: tasks.length,
      pending: 0,
      running: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      totalBytes: 0,
      transferredBytes: 0,
      averageSpeed: 0
    };

    let totalSpeed = 0;
    let speedCount = 0;

    tasks.forEach(task => {
      stats[task.status]++;
      stats.totalBytes += task.fileSize;
      stats.transferredBytes += task.transferred;

      if (task.status === 'running' && task.speed > 0) {
        totalSpeed += task.speed;
        speedCount++;
      }
    });

    if (speedCount > 0) {
      stats.averageSpeed = totalSpeed / speedCount;
    }

    return stats;
  }

  /**
   * Get queue status
   */
  /**
   * Get active task count (running tasks)
   */
  getActiveTaskCount(): number {
    return this.runningTasks.size;
  }

  getQueueStatus(): QueueStatus {
    return {
      isPaused: this.isPaused,
      maxConcurrent: this.maxConcurrent,
      runningCount: this.runningTasks.size,
      stats: this.getStats()
    };
  }

  /**
   * Set maximum concurrent transfers
   */
  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(1, max);
    logger.info(`Max concurrent transfers set to ${this.maxConcurrent}`);
    this.processQueue();
  }

  /**
   * Set retry policy
   */
  setRetryPolicy(policy: Partial<RetryPolicy>): void {
    this.retryPolicy = { ...this.retryPolicy, ...policy };
    logger.info('Retry policy updated');
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.clearAll();
    this._onQueueChanged.dispose();
    this._onTaskUpdated.dispose();
  }
}
