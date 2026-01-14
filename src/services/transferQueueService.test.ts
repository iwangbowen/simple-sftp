import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TransferQueueService } from './transferQueueService';
import { TransferTaskModel } from '../models/transferTask';
import { CreateTransferTaskOptions, TaskStatus } from '../types/transfer.types';
import { HostManager } from '../hostManager';
import { AuthManager } from '../authManager';

describe('TransferQueueService', () => {
  let service: TransferQueueService;
  let mockHostManager: HostManager;
  let mockAuthManager: AuthManager;

  beforeEach(() => {
    // 重置单例
    (TransferQueueService as any).instance = undefined;
    service = TransferQueueService.getInstance();

    // Mock managers
    mockHostManager = {
      getHosts: vi.fn().mockResolvedValue([])
    } as any;

    mockAuthManager = {
      getAuth: vi.fn().mockResolvedValue(null)
    } as any;

    service.initialize(mockHostManager, mockAuthManager);
  });

  afterEach(() => {
    service.dispose();
  });

  describe('Singleton Pattern', () => {
    it('should return same instance', () => {
      const instance1 = TransferQueueService.getInstance();
      const instance2 = TransferQueueService.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should create only one instance', () => {
      const instance1 = TransferQueueService.getInstance();
      const instance2 = TransferQueueService.getInstance();
      const instance3 = TransferQueueService.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });
  });

  describe('initialize', () => {
    it('should initialize with managers', () => {
      expect(() => {
        service.initialize(mockHostManager, mockAuthManager);
      }).not.toThrow();
    });

    it('should allow re-initialization', () => {
      service.initialize(mockHostManager, mockAuthManager);
      service.initialize(mockHostManager, mockAuthManager);
      expect(service).toBeDefined();
    });
  });

  describe('addTask', () => {
    it('should add upload task to queue', () => {
      const options: CreateTransferTaskOptions = {
        type: 'upload',
        hostId: 'test-host',
        hostName: 'test-host',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileName: 'file.txt',
        fileSize: 1024
      };

      const task = service.addTask(options);

      expect(task).toBeInstanceOf(TransferTaskModel);
      expect(task.type).toBe('upload');
      expect(task.fileName).toBe('file.txt');
      expect(service.getAllTasks()).toHaveLength(1);
    });

    it('should add download task to queue', () => {
      const options: CreateTransferTaskOptions = {
        type: 'download',
        hostId: 'test-host',
        hostName: 'test-host',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileName: 'file.txt',
        fileSize: 2048
      };

      const task = service.addTask(options);

      expect(task.type).toBe('download');
      expect(task.fileSize).toBe(2048);
    });

    it('should add directory upload task', () => {
      const options: CreateTransferTaskOptions = {
        type: 'upload',
        hostId: 'test-host',
        hostName: 'test-host',
        localPath: '/local/folder',
        remotePath: '/remote/folder',
        fileName: 'folder',
        fileSize: 0,
        isDirectory: true
      };

      const task = service.addTask(options);

      expect(task.isDirectory).toBe(true);
    });
  });

  describe('addTasks', () => {
    it('should add multiple tasks', () => {
      const optionsList: CreateTransferTaskOptions[] = [
        {
          type: 'upload',
          hostId: 'host1',
        hostName: 'host1',
          localPath: '/file1.txt',
          remotePath: '/remote1.txt',
          fileName: 'file1.txt',
          fileSize: 100
        },
        {
          type: 'download',
          hostId: 'host2',
        hostName: 'host2',
          localPath: '/file2.txt',
          remotePath: '/remote2.txt',
          fileName: 'file2.txt',
          fileSize: 200
        }
      ];

      const tasks = service.addTasks(optionsList);

      expect(tasks).toHaveLength(2);
      expect(service.getAllTasks()).toHaveLength(2);
    });

    it('should handle empty array', () => {
      const tasks = service.addTasks([]);
      expect(tasks).toHaveLength(0);
      expect(service.getAllTasks()).toHaveLength(0);
    });

    it('should add many tasks efficiently', () => {
      const optionsList: CreateTransferTaskOptions[] = [];
      for (let i = 0; i < 50; i++) {
        optionsList.push({
          type: 'upload',
          hostId: `host${i}`,
          localPath: `/file${i}.txt`,
          remotePath: `/remote${i}.txt`,
          fileName: `file${i}.txt`,
          fileSize: i * 100
        });
      }

      const tasks = service.addTasks(optionsList);

      expect(tasks).toHaveLength(50);
      expect(service.getAllTasks()).toHaveLength(50);
    });
  });

  describe('getTask', () => {
    it('should get task by ID', () => {
      const options: CreateTransferTaskOptions = {
        type: 'upload',
        hostId: 'test-host',
        hostName: 'test-host',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileName: 'file.txt',
        fileSize: 1024
      };

      const task = service.addTask(options);
      const found = service.getTask(task.id);

      expect(found).toBe(task);
    });

    it('should return undefined for non-existent ID', () => {
      const found = service.getTask('non-existent-id');
      expect(found).toBeUndefined();
    });
  });

  describe('getAllTasks', () => {
    it('should return empty array initially', () => {
      expect(service.getAllTasks()).toEqual([]);
    });

    it('should return all tasks', () => {
      service.addTask({
        type: 'upload',
        hostId: 'host1',
        hostName: 'host1',
        localPath: '/file1.txt',
        remotePath: '/remote1.txt',
        fileName: 'file1.txt',
        fileSize: 100
      });

      service.addTask({
        type: 'download',
        hostId: 'host2',
        hostName: 'host2',
        localPath: '/file2.txt',
        remotePath: '/remote2.txt',
        fileName: 'file2.txt',
        fileSize: 200
      });

      const tasks = service.getAllTasks();
      expect(tasks).toHaveLength(2);
    });

    it('should return copy of tasks array', () => {
      const tasks1 = service.getAllTasks();
      const tasks2 = service.getAllTasks();
      expect(tasks1).not.toBe(tasks2);
    });
  });

  describe('getTasksByStatus', () => {
    it('should return empty array for non-matching status', () => {
      service.addTask({
        type: 'upload',
        hostId: 'host1',
        hostName: 'host1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 100
      });

      const completed = service.getTasksByStatus('completed');
      expect(completed).toHaveLength(0);
    });
  });

  describe('getRunningTasks', () => {
    it('should return running tasks', () => {
      const running = service.getRunningTasks();
      expect(Array.isArray(running)).toBe(true);
    });

    it('should return empty array initially', () => {
      expect(service.getRunningTasks()).toHaveLength(0);
    });
  });

  describe('pauseTask', () => {
    it('should pause a task', () => {
      const task = service.addTask({
        type: 'upload',
        hostId: 'host1',
        hostName: 'host1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 100
      });

      service.pauseTask(task.id);
      const found = service.getTask(task.id);
      expect(found?.status).toBe('paused');
    });

    it('should handle pausing non-existent task', () => {
      expect(() => {
        service.pauseTask('non-existent');
      }).not.toThrow();
    });
  });

  describe('resumeTask', () => {
    it('should handle resuming non-existent task', () => {
      expect(() => {
        service.resumeTask('non-existent');
      }).not.toThrow();
    });
  });

  describe('cancelTask', () => {
    it('should handle canceling non-existent task', async () => {
      await expect(service.cancelTask('non-existent')).resolves.not.toThrow();
    });
  });

  describe('removeTask', () => {
    it('should remove task from queue', () => {
      const task = service.addTask({
        type: 'upload',
        hostId: 'host1',
        hostName: 'host1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 100
      });

      service.removeTask(task.id);
      expect(service.getTask(task.id)).toBeUndefined();
      expect(service.getAllTasks()).toHaveLength(0);
    });

    it('should handle removing non-existent task', () => {
      expect(() => {
        service.removeTask('non-existent');
      }).not.toThrow();
    });
  });

  describe('pauseQueue', () => {
    it('should pause entire queue', () => {
      service.addTask({
        type: 'upload',
        hostId: 'host1',
        hostName: 'host1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 100
      });

      service.pauseQueue();
      const status = service.getQueueStatus();
      expect(status.isPaused).toBe(true);
    });
  });

  describe('resumeQueue', () => {
    it('should resume paused queue', () => {
      service.pauseQueue();
      service.resumeQueue();
      const status = service.getQueueStatus();
      expect(status.isPaused).toBe(false);
    });
  });

  describe('clearCompleted', () => {
    it('should remove completed tasks', () => {
      service.clearCompleted();
      expect(service.getAllTasks()).toHaveLength(0);
    });

    it('should not remove pending tasks', () => {
      service.addTask({
        type: 'upload',
        hostId: 'host1',
        hostName: 'host1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 100
      });

      service.clearCompleted();
      expect(service.getAllTasks()).toHaveLength(1);
    });
  });

  describe('clearAll', () => {
    it('should clear all tasks', () => {
      service.addTask({
        type: 'upload',
        hostId: 'host1',
        hostName: 'host1',
        localPath: '/file1.txt',
        remotePath: '/remote1.txt',
        fileName: 'file1.txt',
        fileSize: 100
      });

      service.addTask({
        type: 'download',
        hostId: 'host2',
        hostName: 'host2',
        localPath: '/file2.txt',
        remotePath: '/remote2.txt',
        fileName: 'file2.txt',
        fileSize: 200
      });

      service.clearAll();
      expect(service.getAllTasks()).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      const stats = service.getStats();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('cancelled');
      expect(stats.total).toBe(0);
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue status', () => {
      const status = service.getQueueStatus();

      expect(status).toHaveProperty('isPaused');
      expect(status).toHaveProperty('maxConcurrent');
      expect(status).toHaveProperty('runningCount');
      expect(status).toHaveProperty('stats');
      expect(status.isPaused).toBe(false);
    });
  });

  describe('setMaxConcurrent', () => {
    it('should update max concurrent transfers', () => {
      service.setMaxConcurrent(5);
      const status = service.getQueueStatus();
      expect(status.maxConcurrent).toBe(5);
    });

    it('should enforce minimum of 1', () => {
      service.setMaxConcurrent(0);
      const status = service.getQueueStatus();
      expect(status.maxConcurrent).toBe(1);
    });

    it('should handle negative values', () => {
      service.setMaxConcurrent(-5);
      const status = service.getQueueStatus();
      expect(status.maxConcurrent).toBe(1);
    });
  });

  describe('setRetryPolicy', () => {
    it('should update retry policy', () => {
      expect(() => {
        service.setRetryPolicy({
          enabled: false,
          maxRetries: 5
        });
      }).not.toThrow();
    });

    it('should allow partial updates', () => {
      expect(() => {
        service.setRetryPolicy({ enabled: true });
      }).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should dispose resources', () => {
      expect(() => {
        service.dispose();
      }).not.toThrow();
    });

    it('should clear all tasks on dispose', () => {
      service.addTask({
        type: 'upload',
        hostId: 'host1',
        hostName: 'host1',
        localPath: '/file.txt',
        remotePath: '/remote.txt',
        fileName: 'file.txt',
        fileSize: 100
      });

      service.dispose();
      expect(service.getAllTasks()).toHaveLength(0);
    });
  });
});
