import * as vscode from 'vscode';
import { TransferTaskModel } from '../models/transferTask';
import { TransferTask, TaskStatus } from '../types/transfer.types';
import { logger } from '../logger';

/**
 * Transfer History Service
 * Manages persistent storage of transfer history
 */
export class TransferHistoryService {
  private static instance: TransferHistoryService;
  private readonly STORAGE_KEY = 'simple-scp.transferHistory';
  private readonly MAX_HISTORY_SIZE = 100; // Keep last 100 transfers

  private context: vscode.ExtensionContext;
  private history: TransferTaskModel[] = [];

  private _onHistoryChanged = new vscode.EventEmitter<void>();
  readonly onHistoryChanged = this._onHistoryChanged.event;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadHistory();
  }

  /**
   * Initialize singleton instance
   */
  static initialize(context: vscode.ExtensionContext): TransferHistoryService {
    if (!TransferHistoryService.instance) {
      TransferHistoryService.instance = new TransferHistoryService(context);
    }
    return TransferHistoryService.instance;
  }

  /**
   * Get singleton instance
   */
  static getInstance(): TransferHistoryService {
    if (!TransferHistoryService.instance) {
      throw new Error('TransferHistoryService not initialized. Call initialize() first.');
    }
    return TransferHistoryService.instance;
  }

  /**
   * Load history from storage
   */
  private async loadHistory(): Promise<void> {
    try {
      const stored = this.context.globalState.get<any[]>(this.STORAGE_KEY, []);
      this.history = stored.map(data => TransferTaskModel.fromJSON(data));
      logger.info(`Loaded ${this.history.length} transfer history records`);
    } catch (error: any) {
      logger.error(`Failed to load transfer history: ${error.message}`);
      this.history = [];
    }
  }

  /**
   * Save history to storage
   */
  private async saveHistory(): Promise<void> {
    try {
      const data = this.history.map(task => task.toJSON());
      await this.context.globalState.update(this.STORAGE_KEY, data);
      logger.debug(`Saved ${this.history.length} transfer history records`);
    } catch (error: any) {
      logger.error(`Failed to save transfer history: ${error.message}`);
    }
  }

  /**
   * Add task to history
   */
  async addToHistory(task: TransferTaskModel): Promise<void> {
    // Only add completed, failed, or cancelled tasks
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      // Remove existing entry with same ID if exists
      this.history = this.history.filter(t => t.id !== task.id);

      // Add to beginning
      this.history.unshift(task);

      // Limit size
      if (this.history.length > this.MAX_HISTORY_SIZE) {
        this.history = this.history.slice(0, this.MAX_HISTORY_SIZE);
      }

      await this.saveHistory();
      this._onHistoryChanged.fire();

      logger.debug(`Added task ${task.id} to history`);
    }
  }

  /**
   * Get all history
   */
  getHistory(): TransferTaskModel[] {
    return [...this.history];
  }

  /**
   * Get history by host
   */
  getHistoryByHost(hostId: string): TransferTaskModel[] {
    return this.history.filter(t => t.hostId === hostId);
  }

  /**
   * Get history by status
   */
  getHistoryByStatus(status: TaskStatus): TransferTaskModel[] {
    return this.history.filter(t => t.status === status);
  }

  /**
   * Get history by type
   */
  getHistoryByType(type: 'upload' | 'download'): TransferTaskModel[] {
    return this.history.filter(t => t.type === type);
  }

  /**
   * Get history within date range
   */
  getHistoryByDateRange(startDate: Date, endDate: Date): TransferTaskModel[] {
    return this.history.filter(t => {
      const createdAt = t.createdAt.getTime();
      return createdAt >= startDate.getTime() && createdAt <= endDate.getTime();
    });
  }

  /**
   * Get recent history
   */
  getRecentHistory(limit: number = 20): TransferTaskModel[] {
    return this.history.slice(0, limit);
  }

  /**
   * Get successful transfers
   */
  getSuccessfulTransfers(): TransferTaskModel[] {
    return this.history.filter(t => t.status === 'completed');
  }

  /**
   * Get failed transfers
   */
  getFailedTransfers(): TransferTaskModel[] {
    return this.history.filter(t => t.status === 'failed');
  }

  /**
   * Search history by file name
   */
  searchByFileName(query: string): TransferTaskModel[] {
    const lowerQuery = query.toLowerCase();
    return this.history.filter(t =>
      t.fileName.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Search history by path
   */
  searchByPath(query: string): TransferTaskModel[] {
    const lowerQuery = query.toLowerCase();
    return this.history.filter(t =>
      t.localPath.toLowerCase().includes(lowerQuery) ||
      t.remotePath.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get statistics
   */
  getStatistics() {
    const total = this.history.length;
    const completed = this.history.filter(t => t.status === 'completed').length;
    const failed = this.history.filter(t => t.status === 'failed').length;
    const cancelled = this.history.filter(t => t.status === 'cancelled').length;

    const uploads = this.history.filter(t => t.type === 'upload').length;
    const downloads = this.history.filter(t => t.type === 'download').length;

    let totalBytes = 0;
    let totalDuration = 0;
    let transferCount = 0;

    this.history.forEach(task => {
      if (task.status === 'completed') {
        totalBytes += task.fileSize;
        const duration = task.getDuration();
        if (duration) {
          totalDuration += duration;
          transferCount++;
        }
      }
    });

    const averageSpeed = transferCount > 0 ? (totalBytes / totalDuration) * 1000 : 0;

    return {
      total,
      completed,
      failed,
      cancelled,
      uploads,
      downloads,
      totalBytes,
      averageSpeed,
      averageDuration: transferCount > 0 ? totalDuration / transferCount : 0
    };
  }

  /**
   * Clear history by host
   */
  async clearHistoryByHost(hostId: string): Promise<void> {
    this.history = this.history.filter(t => t.hostId !== hostId);
    await this.saveHistory();
    this._onHistoryChanged.fire();
    logger.info(`Cleared history for host ${hostId}`);
  }

  /**
   * Clear failed transfers
   */
  async clearFailedTransfers(): Promise<void> {
    this.history = this.history.filter(t => t.status !== 'failed');
    await this.saveHistory();
    this._onHistoryChanged.fire();
    logger.info('Cleared failed transfers from history');
  }

  /**
   * Clear all history
   */
  async clearAllHistory(): Promise<void> {
    this.history = [];
    await this.saveHistory();
    this._onHistoryChanged.fire();
    logger.info('Cleared all transfer history');
  }

  /**
   * Remove specific task from history
   */
  async removeFromHistory(taskId: string): Promise<void> {
    this.history = this.history.filter(t => t.id !== taskId);
    await this.saveHistory();
    this._onHistoryChanged.fire();
    logger.debug(`Removed task ${taskId} from history`);
  }

  /**
   * Export history to JSON
   */
  exportHistory(): string {
    return JSON.stringify(this.history.map(t => t.toJSON()), null, 2);
  }

  /**
   * Import history from JSON
   */
  async importHistory(jsonData: string): Promise<void> {
    try {
      const data = JSON.parse(jsonData);
      if (Array.isArray(data)) {
        const imported = data.map(item => TransferTaskModel.fromJSON(item));
        this.history.push(...imported);

        // Limit size
        if (this.history.length > this.MAX_HISTORY_SIZE) {
          this.history = this.history.slice(0, this.MAX_HISTORY_SIZE);
        }

        await this.saveHistory();
        this._onHistoryChanged.fire();
        logger.info(`Imported ${imported.length} history records`);
      }
    } catch (error: any) {
      logger.error(`Failed to import history: ${error.message}`);
      throw error;
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this._onHistoryChanged.dispose();
  }
}
