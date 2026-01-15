import { TransferTask, TaskStatus, CreateTransferTaskOptions } from '../types/transfer.types';
import { logger } from '../logger';

/**
 * Transfer Task Model
 * Represents a single file transfer task with state management
 */
export class TransferTaskModel implements TransferTask {
  // Implementation of TransferTask interface
  id: string;
  type: 'upload' | 'download';
  status: TaskStatus;

  hostId: string;
  hostName: string;

  localPath: string;
  remotePath: string;
  fileName: string;
  fileSize: number;
  isDirectory: boolean;

  transferred: number;
  speed: number;
  progress: number;

createdAt!: Date;
  startedAt?: Date;
  completedAt?: Date;
  estimatedTime?: number;

  retryCount!: number;
  maxRetries!: number;
  lastError?: string;

  abortController?: AbortController;

  // Private fields for speed calculation
  private lastTransferred: number = 0;
  private lastUpdateTime: number = 0;

  constructor(options: CreateTransferTaskOptions) {
    this.id = TransferTaskModel.generateId();
    this.type = options.type;
    this.status = 'pending';

    this.hostId = options.hostId;
    this.hostName = options.hostName;

    this.localPath = options.localPath;
    this.remotePath = options.remotePath;
    this.fileName = options.fileName || TransferTaskModel.extractFileName(options.localPath);
    this.fileSize = options.fileSize || 0;
    this.isDirectory = options.isDirectory || false;

    this.transferred = 0;
    this.speed = 0;
    this.progress = 0;

    this.createdAt = new Date();
    this.retryCount = 0;
    this.maxRetries = options.maxRetries || 3;
  }

  /**
   * Generate unique task ID
   */
  private static generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Extract file name from path
   */
  private static extractFileName(path: string): string {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || 'unknown';
  }

  /**
   * Update transfer progress
   */
  updateProgress(transferred: number, total: number): void {
    this.transferred = transferred;

    if (total > 0) {
      this.progress = Math.min(100, (transferred / total) * 100);
      this.fileSize = total; // Update file size if it wasn't known
    }

    // Calculate speed
    const now = Date.now();
    if (this.lastUpdateTime > 0) {
      const timeDelta = (now - this.lastUpdateTime) / 1000; // seconds
      if (timeDelta > 0) {
        const bytesDelta = transferred - this.lastTransferred;
        this.speed = bytesDelta / timeDelta;

        // Calculate estimated time remaining
        if (this.speed > 0 && total > 0) {
          const remaining = total - transferred;
          this.estimatedTime = (remaining / this.speed) * 1000; // milliseconds
        }
      }
    }

    this.lastTransferred = transferred;
    this.lastUpdateTime = now;
  }

  /**
   * Start the task
   */
  start(): void {
    if (this.status === 'pending' || this.status === 'paused') {
      this.status = 'running';
      this.startedAt = this.startedAt || new Date();
      this.abortController = new AbortController();
      logger.info(`Task ${this.id} started: ${this.fileName}`);
    }
  }

  /**
   * Pause the task
   */
  pause(): void {
    if (this.status === 'running') {
      this.status = 'paused';
      this.abortController?.abort();
      this.abortController = undefined;
      logger.info(`Task ${this.id} paused: ${this.fileName}`);
    }
  }

  /**
   * Resume the task
   */
  resume(): void {
    if (this.status === 'paused') {
      this.status = 'pending';
      // SFTP supports resume - keep the current progress
      // Don't reset transferred, progress, or speed
      logger.info(`Task ${this.id} resuming from ${this.transferred} bytes: ${this.fileName}`);
    }
  }

  /**
   * Cancel the task
   */
  cancel(): void {
    if (this.status !== 'completed' && this.status !== 'failed') {
      this.status = 'cancelled';
      this.completedAt = new Date();
      this.abortController?.abort();
      this.abortController = undefined;
      logger.info(`Task ${this.id} cancelled: ${this.fileName}`);
    }
  }

  /**
   * Mark task as completed
   */
  complete(): void {
    if (this.status === 'running') {
      this.status = 'completed';
      this.completedAt = new Date();
      this.progress = 100;
      this.abortController = undefined;
      logger.info(`Task ${this.id} completed: ${this.fileName}`);
    }
  }

  /**
   * Mark task as failed
   */
  fail(error: string): void {
    this.status = 'failed';
    this.completedAt = new Date();
    this.lastError = error;
    this.abortController = undefined;
    logger.error(`Task ${this.id} failed: ${this.fileName} - ${error}`);
  }

  /**
   * Increment retry count
   */
  incrementRetry(): boolean {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      this.status = 'pending';
      this.lastError = undefined;
      logger.info(`Task ${this.id} retry ${this.retryCount}/${this.maxRetries}: ${this.fileName}`);
      return true;
    }
    return false;
  }

  /**
   * Check if task can be retried
   */
  canRetry(): boolean {
    return this.retryCount < this.maxRetries;
  }

  /**
   * Get task duration in milliseconds
   */
  getDuration(): number | undefined {
    if (this.startedAt && this.completedAt) {
      return this.completedAt.getTime() - this.startedAt.getTime();
    }
    return undefined;
  }

  /**
   * Get average speed
   */
  getAverageSpeed(): number | undefined {
    const duration = this.getDuration();
    if (duration && duration > 0) {
      return (this.transferred / duration) * 1000; // bytes/sec
    }
    return undefined;
  }

  /**
   * Serialize to JSON
   */
  toJSON(): any {
    return {
      id: this.id,
      type: this.type,
      status: this.status,
      hostId: this.hostId,
      hostName: this.hostName,
      localPath: this.localPath,
      remotePath: this.remotePath,
      fileName: this.fileName,
      fileSize: this.fileSize,
      isDirectory: this.isDirectory,
      transferred: this.transferred,
      speed: this.speed,
      progress: this.progress,
      createdAt: this.createdAt.toISOString(),
      startedAt: this.startedAt?.toISOString(),
      completedAt: this.completedAt?.toISOString(),
      estimatedTime: this.estimatedTime,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      lastError: this.lastError
    };
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON(data: any): TransferTaskModel {
    const task = new TransferTaskModel({
      type: data.type,
      hostId: data.hostId,
      hostName: data.hostName,
      localPath: data.localPath,
      remotePath: data.remotePath,
      fileName: data.fileName,
      fileSize: data.fileSize,
      isDirectory: data.isDirectory,
      maxRetries: data.maxRetries
    });

    task.id = data.id;
    task.status = data.status;
    task.transferred = data.transferred;
    task.speed = data.speed;
    task.progress = data.progress;
    task.createdAt = new Date(data.createdAt);
    task.startedAt = data.startedAt ? new Date(data.startedAt) : undefined;
    task.completedAt = data.completedAt ? new Date(data.completedAt) : undefined;
    task.estimatedTime = data.estimatedTime;
    task.retryCount = data.retryCount;
    task.lastError = data.lastError;

    return task;
  }
}
