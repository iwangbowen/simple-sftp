import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TransferHistoryService } from './transferHistoryService';
import { TransferTaskModel } from '../models/transferTask';
import { TaskStatus } from '../types/transfer.types';
import * as vscode from 'vscode';

describe('TransferHistoryService', () => {
  let service: TransferHistoryService;
  let mockContext: vscode.ExtensionContext;
  let globalStateStore: Map<string, any>;

  beforeEach(() => {
    // 重置单例
    (TransferHistoryService as any).instance = undefined;

    // 创建存储
    globalStateStore = new Map();

    // Mock ExtensionContext
    mockContext = {
      globalState: {
        get: vi.fn((key: string, defaultValue?: any) => {
          return globalStateStore.get(key) ?? defaultValue;
        }),
        update: vi.fn(async (key: string, value: any) => {
          globalStateStore.set(key, value);
        }),
        keys: vi.fn(() => Array.from(globalStateStore.keys())),
        setKeysForSync: vi.fn()
      }
    } as any;

    service = TransferHistoryService.initialize(mockContext);
  });

  afterEach(() => {
    service.dispose();
  });

  describe('Singleton Pattern', () => {
    it('should return same instance', () => {
      const instance2 = TransferHistoryService.getInstance();
      expect(service).toBe(instance2);
    });

    it('should throw error if getInstance called before initialize', () => {
      (TransferHistoryService as any).instance = undefined;
      expect(() => TransferHistoryService.getInstance()).toThrow(
        'TransferHistoryService not initialized. Call initialize() first.'
      );
    });

    it('should allow multiple initializations', () => {
      const service2 = TransferHistoryService.initialize(mockContext);
      expect(service2).toBe(service);
    });
  });

  describe('addToHistory', () => {
    it('should add completed task to history', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Test Host',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });

      task.start();
      task.complete();

      await service.addToHistory(task);
      const history = service.getHistory();

      expect(history).toHaveLength(1);
      expect(history[0].id).toBe(task.id);
    });

    it('should add failed task to history', async () => {
      const task = new TransferTaskModel({
        type: 'download',
        hostId: 'host1',
        hostName: 'Test Host',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });

      task.start();
      task.fail('Connection error');

      await service.addToHistory(task);
      const history = service.getHistory();

      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('failed');
    });

    it('should add cancelled task to history', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Test Host',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });

      task.start();
      task.cancel();

      await service.addToHistory(task);
      const history = service.getHistory();

      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('cancelled');
    });

    it('should not add pending task to history', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Test Host',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });

      await service.addToHistory(task);
      const history = service.getHistory();

      expect(history).toHaveLength(0);
    });

    it('should not add running task to history', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Test Host',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });

      task.start();

      await service.addToHistory(task);
      const history = service.getHistory();

      expect(history).toHaveLength(0);
    });

    it('should remove existing task with same ID before adding', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Test Host',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });

      task.start();
      task.complete();

      await service.addToHistory(task);
      await service.addToHistory(task);

      const history = service.getHistory();
      expect(history).toHaveLength(1);
    });

    it('should limit history size to MAX_HISTORY_SIZE', async () => {
      // 添加超过 100 个任务
      for (let i = 0; i < 110; i++) {
        const task = new TransferTaskModel({
          type: 'upload',
          hostId: `host${i}`,
          hostName: `Host ${i}`,
          localPath: `/file${i}.txt`,
          remotePath: `/remote${i}.txt`,
          fileName: `file${i}.txt`,
          fileSize: 1024
        });

        task.start();
        task.complete();

        await service.addToHistory(task);
      }

      const history = service.getHistory();
      expect(history).toHaveLength(100);
    });
  });

  describe('getHistory', () => {
    it('should return empty array initially', () => {
      const history = service.getHistory();
      expect(history).toEqual([]);
    });

    it('should return copy of history array', () => {
      const history1 = service.getHistory();
      const history2 = service.getHistory();
      expect(history1).not.toBe(history2);
    });
  });

  describe('getHistoryByHost', () => {
    it('should filter history by host ID', async () => {
      const task1 = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file1.txt',
        remotePath: '/remote1.txt',
        fileName: 'file1.txt',
        fileSize: 1024
      });
      task1.start();
      task1.complete();

      const task2 = new TransferTaskModel({
        type: 'upload',
        hostId: 'host2',
        hostName: 'Host 2',
        localPath: '/file2.txt',
        remotePath: '/remote2.txt',
        fileName: 'file2.txt',
        fileSize: 2048
      });
      task2.start();
      task2.complete();

      await service.addToHistory(task1);
      await service.addToHistory(task2);

      const host1History = service.getHistoryByHost('host1');
      expect(host1History).toHaveLength(1);
      expect(host1History[0].hostId).toBe('host1');
    });

    it('should return empty array for non-existent host', () => {
      const history = service.getHistoryByHost('non-existent');
      expect(history).toEqual([]);
    });
  });

  describe('getHistoryByStatus', () => {
    it('should filter history by status', async () => {
      const completedTask = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file1.txt',
        remotePath: '/remote1.txt',
        fileName: 'file1.txt',
        fileSize: 1024
      });
      completedTask.start();
      completedTask.complete();

      const failedTask = new TransferTaskModel({
        type: 'upload',
        hostId: 'host2',
        hostName: 'Host 2',
        localPath: '/file2.txt',
        remotePath: '/remote2.txt',
        fileName: 'file2.txt',
        fileSize: 2048
      });
      failedTask.start();
      failedTask.fail('Error');

      await service.addToHistory(completedTask);
      await service.addToHistory(failedTask);

      const completed = service.getHistoryByStatus('completed');
      expect(completed).toHaveLength(1);
      expect(completed[0].status).toBe('completed');
    });
  });

  describe('getHistoryByType', () => {
    it('should filter history by type', async () => {
      const uploadTask = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file1.txt',
        remotePath: '/remote1.txt',
        fileName: 'file1.txt',
        fileSize: 1024
      });
      uploadTask.start();
      uploadTask.complete();

      const downloadTask = new TransferTaskModel({
        type: 'download',
        hostId: 'host2',
        hostName: 'Host 2',
        localPath: '/file2.txt',
        remotePath: '/remote2.txt',
        fileName: 'file2.txt',
        fileSize: 2048
      });
      downloadTask.start();
      downloadTask.complete();

      await service.addToHistory(uploadTask);
      await service.addToHistory(downloadTask);

      const uploads = service.getHistoryByType('upload');
      expect(uploads).toHaveLength(1);
      expect(uploads[0].type).toBe('upload');
    });
  });

  describe('getHistoryByDateRange', () => {
    it('should filter history by date range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);

      const history = service.getHistoryByDateRange(yesterday, tomorrow);
      expect(history).toHaveLength(1);
    });

    it('should return empty for non-matching date range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);

      const history = service.getHistoryByDateRange(twoDaysAgo, yesterday);
      expect(history).toHaveLength(0);
    });
  });

  describe('getRecentHistory', () => {
    it('should return recent history with default limit', async () => {
      for (let i = 0; i < 30; i++) {
        const task = new TransferTaskModel({
          type: 'upload',
          hostId: `host${i}`,
          hostName: `Host ${i}`,
          localPath: `/file${i}.txt`,
          remotePath: `/remote${i}.txt`,
          fileName: `file${i}.txt`,
          fileSize: 1024
        });
        task.start();
        task.complete();
        await service.addToHistory(task);
      }

      const recent = service.getRecentHistory();
      expect(recent).toHaveLength(20);
    });

    it('should respect custom limit', async () => {
      for (let i = 0; i < 30; i++) {
        const task = new TransferTaskModel({
          type: 'upload',
          hostId: `host${i}`,
          hostName: `Host ${i}`,
          localPath: `/file${i}.txt`,
          remotePath: `/remote${i}.txt`,
          fileName: `file${i}.txt`,
          fileSize: 1024
        });
        task.start();
        task.complete();
        await service.addToHistory(task);
      }

      const recent = service.getRecentHistory(5);
      expect(recent).toHaveLength(5);
    });
  });

  describe('getSuccessfulTransfers', () => {
    it('should return only completed transfers', async () => {
      const completedTask = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file1.txt',
        remotePath: '/remote1.txt',
        fileName: 'file1.txt',
        fileSize: 1024
      });
      completedTask.start();
      completedTask.complete();

      const failedTask = new TransferTaskModel({
        type: 'upload',
        hostId: 'host2',
        hostName: 'Host 2',
        localPath: '/file2.txt',
        remotePath: '/remote2.txt',
        fileName: 'file2.txt',
        fileSize: 2048
      });
      failedTask.start();
      failedTask.fail('Error');

      await service.addToHistory(completedTask);
      await service.addToHistory(failedTask);

      const successful = service.getSuccessfulTransfers();
      expect(successful).toHaveLength(1);
      expect(successful[0].status).toBe('completed');
    });
  });

  describe('getFailedTransfers', () => {
    it('should return only failed transfers', async () => {
      const completedTask = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file1.txt',
        remotePath: '/remote1.txt',
        fileName: 'file1.txt',
        fileSize: 1024
      });
      completedTask.start();
      completedTask.complete();

      const failedTask = new TransferTaskModel({
        type: 'upload',
        hostId: 'host2',
        hostName: 'Host 2',
        localPath: '/file2.txt',
        remotePath: '/remote2.txt',
        fileName: 'file2.txt',
        fileSize: 2048
      });
      failedTask.start();
      failedTask.fail('Error');

      await service.addToHistory(completedTask);
      await service.addToHistory(failedTask);

      const failed = service.getFailedTransfers();
      expect(failed).toHaveLength(1);
      expect(failed[0].status).toBe('failed');
    });
  });

  describe('searchByFileName', () => {
    it('should search by file name', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/data/report.pdf',
        remotePath: '/remote/report.pdf',
        fileName: 'report.pdf',
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);

      const results = service.searchByFileName('report');
      expect(results).toHaveLength(1);
      expect(results[0].fileName).toBe('report.pdf');
    });

    it('should be case-insensitive', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/DATA/REPORT.PDF',
        remotePath: '/remote/report.pdf',
        fileName: 'REPORT.PDF',
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);

      const results = service.searchByFileName('report');
      expect(results).toHaveLength(1);
    });
  });

  describe('searchByPath', () => {
    it('should search by local path', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/home/user/documents/file.txt',
        remotePath: '/remote/file.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);

      const results = service.searchByPath('documents');
      expect(results).toHaveLength(1);
    });

    it('should search by remote path', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/local/file.txt',
        remotePath: '/var/www/html/file.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);

      const results = service.searchByPath('www');
      expect(results).toHaveLength(1);
    });
  });

  describe('getStatistics', () => {
    it('should calculate statistics', async () => {
      const task1 = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file1.txt',
        remotePath: '/remote1.txt',
        fileName: 'file1.txt',
        fileSize: 1024
      });
      task1.start();
      task1.complete();

      const task2 = new TransferTaskModel({
        type: 'download',
        hostId: 'host2',
        hostName: 'Host 2',
        localPath: '/file2.txt',
        remotePath: '/remote2.txt',
        fileName: 'file2.txt',
        fileSize: 2048
      });
      task2.start();
      task2.fail('Error');

      await service.addToHistory(task1);
      await service.addToHistory(task2);

      const stats = service.getStatistics();

      expect(stats.total).toBe(2);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.uploads).toBe(1);
      expect(stats.downloads).toBe(1);
    });
  });

  describe('clearHistoryByHost', () => {
    it('should clear history for specific host', async () => {
      const task1 = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file1.txt',
        remotePath: '/remote1.txt',
        fileName: 'file1.txt',
        fileSize: 1024
      });
      task1.start();
      task1.complete();

      const task2 = new TransferTaskModel({
        type: 'upload',
        hostId: 'host2',
        hostName: 'Host 2',
        localPath: '/file2.txt',
        remotePath: '/remote2.txt',
        fileName: 'file2.txt',
        fileSize: 2048
      });
      task2.start();
      task2.complete();

      await service.addToHistory(task1);
      await service.addToHistory(task2);
      await service.clearHistoryByHost('host1');

      const history = service.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].hostId).toBe('host2');
    });
  });

  describe('clearFailedTransfers', () => {
    it('should clear only failed transfers', async () => {
      const completedTask = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file1.txt',
        remotePath: '/remote1.txt',
        fileName: 'file1.txt',
        fileSize: 1024
      });
      completedTask.start();
      completedTask.complete();

      const failedTask = new TransferTaskModel({
        type: 'upload',
        hostId: 'host2',
        hostName: 'Host 2',
        localPath: '/file2.txt',
        remotePath: '/remote2.txt',
        fileName: 'file2.txt',
        fileSize: 2048
      });
      failedTask.start();
      failedTask.fail('Error');

      await service.addToHistory(completedTask);
      await service.addToHistory(failedTask);
      await service.clearFailedTransfers();

      const history = service.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('completed');
    });
  });

  describe('clearAllHistory', () => {
    it('should clear all history', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);
      await service.clearAllHistory();

      const history = service.getHistory();
      expect(history).toHaveLength(0);
    });
  });

  describe('removeFromHistory', () => {
    it('should remove specific task', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);
      await service.removeFromHistory(task.id);

      const history = service.getHistory();
      expect(history).toHaveLength(0);
    });
  });

  describe('exportHistory', () => {
    it('should export history as JSON', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);

      const exported = service.exportHistory();
      expect(exported).toBeTruthy();
      expect(() => JSON.parse(exported)).not.toThrow();
    });
  });

  describe('importHistory', () => {
    it('should import history from JSON', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });
      task.start();
      task.complete();

      const jsonData = JSON.stringify([task.toJSON()]);

      await service.importHistory(jsonData);
      const history = service.getHistory();

      expect(history).toHaveLength(1);
    });

    it('should handle invalid JSON', async () => {
      await expect(service.importHistory('invalid json')).rejects.toThrow();
    });

    it('should handle empty array import', async () => {
      await service.importHistory('[]');
      const history = service.getHistory();
      expect(history).toHaveLength(0);
    });


  });

  describe('Edge Cases', () => {
    it('should handle multiple tasks with same filename', async () => {
      const task1 = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/path1/file.txt',
        remotePath: '/remote1/file.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });
      task1.start();
      task1.complete();

      const task2 = new TransferTaskModel({
        type: 'download',
        hostId: 'host2',
        hostName: 'Host 2',
        localPath: '/path2/file.txt',
        remotePath: '/remote2/file.txt',
        fileName: 'file.txt',
        fileSize: 2048
      });
      task2.start();
      task2.complete();

      await service.addToHistory(task1);
      await service.addToHistory(task2);

      const results = service.searchByFileName('file.txt');
      expect(results).toHaveLength(2);
    });

    it('should handle very long filenames', async () => {
      const longName = 'A'.repeat(500) + '.txt';
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: `/path/${longName}`,
        remotePath: `/remote/${longName}`,
        fileName: longName,
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);
      const results = service.searchByFileName(longName);
      expect(results).toHaveLength(1);
      expect(results[0].fileName).toBe(longName);
    });

    it('should handle filenames with special characters', async () => {
      const specialName = 'test-file_[2023] (copy).txt';
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: `/path/${specialName}`,
        remotePath: `/remote/${specialName}`,
        fileName: specialName,
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);
      const results = service.searchByFileName('[2023]');
      expect(results).toHaveLength(1);
    });

    it('should handle unicode filenames', async () => {
      const unicodeName = '文件名称_日본語_파일.txt';
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: `/path/${unicodeName}`,
        remotePath:`/remote/${unicodeName}`,
        fileName: unicodeName,
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);
      const results = service.searchByFileName(unicodeName);
      expect(results).toHaveLength(1);
      expect(results[0].fileName).toBe(unicodeName);
    });

    it('should handle getRecentHistory with no history', () => {
      const recent = service.getRecentHistory(10);
      expect(recent).toHaveLength(0);
      expect(recent).toEqual([]);
    });

    it('should handle getRecentHistory with limit larger than history size', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);
      const recent = service.getRecentHistory(100);
      expect(recent).toHaveLength(1);
    });

    it('should handle clearAllHistory when already empty', async () => {
      await service.clearAllHistory();
      const history = service.getHistory();
      expect(history).toHaveLength(0);
    });

    it('should handle removeFromHistory for non-existent task', async () => {
      await service.removeFromHistory('non-existent-id');
      // Should not throw
      const history = service.getHistory();
      expect(history).toHaveLength(0);
    });

    it('should handle searchByFileName with empty string', () => {
      const results = service.searchByFileName('');
      expect(results).toHaveLength(0);
    });

    it('should handle searchByPath with empty string', () => {
      const results = service.searchByPath('');
      expect(results).toHaveLength(0);
    });

    it('should handle getHistoryByDateRange with invalid range (end before start)', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);

      const endDate = new Date();
      const startDate = new Date(Date.now() + 86400000); // Tomorrow
      const results = service.getHistoryByDateRange(startDate, endDate);
      expect(results).toHaveLength(0);
    });

    it('should handle getStatistics with empty history', () => {
      const stats = service.getStatistics();
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.cancelled).toBe(0);
      expect(stats.total).toBe(0);
    });

    it('should handle clearHistoryByHost for non-existent host', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 1024
      });
      task.start();
      task.complete();

      await service.addToHistory(task);
      await service.clearHistoryByHost('non-existent-host');

      const history = service.getHistory();
      expect(history).toHaveLength(1); // Task should still exist
    });

    it('should handle binary zero bytes in filename', async () => {
      const task = new TransferTaskModel({
        type: 'upload',
        hostId: 'host1',
        hostName: 'Host 1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 0
      });
      task.start();
      task.complete();

      await service.addToHistory(task);
      const history = service.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].fileSize).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should dispose resources', () => {
      expect(() => {
        service.dispose();
      }).not.toThrow();
    });
  });
});
