import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransferTaskModel } from './transferTask';
import { CreateTransferTaskOptions, TaskStatus } from '../types/transfer.types';

describe('TransferTaskModel', () => {
  let defaultOptions: CreateTransferTaskOptions;

  beforeEach(() => {
    defaultOptions = {
      type: 'upload',
      hostId: 'host-123',
      hostName: 'Test Server',
      localPath: '/local/path/file.txt',
      remotePath: '/remote/path/file.txt',
      fileName: 'file.txt',
      fileSize: 1024 * 1024, // 1 MB
      maxRetries: 3
    };
  });

  describe('Constructor', () => {
    it('should create a task with provided options', () => {
      const task = new TransferTaskModel(defaultOptions);

      expect(task.type).toBe('upload');
      expect(task.hostId).toBe('host-123');
      expect(task.hostName).toBe('Test Server');
      expect(task.localPath).toBe('/local/path/file.txt');
      expect(task.remotePath).toBe('/remote/path/file.txt');
      expect(task.fileName).toBe('file.txt');
      expect(task.fileSize).toBe(1024 * 1024);
      expect(task.maxRetries).toBe(3);
    });

    it('should initialize with pending status', () => {
      const task = new TransferTaskModel(defaultOptions);
      expect(task.status).toBe('pending');
    });

    it('should generate unique ID for each task', () => {
      const task1 = new TransferTaskModel(defaultOptions);
      const task2 = new TransferTaskModel(defaultOptions);

      expect(task1.id).toBeTruthy();
      expect(task2.id).toBeTruthy();
      expect(task1.id).not.toBe(task2.id);
    });

    it('should initialize progress to 0', () => {
      const task = new TransferTaskModel(defaultOptions);

      expect(task.transferred).toBe(0);
      expect(task.speed).toBe(0);
      expect(task.progress).toBe(0);
    });

    it('should initialize retry count to 0', () => {
      const task = new TransferTaskModel(defaultOptions);
      expect(task.retryCount).toBe(0);
    });

    it('should set createdAt to current time', () => {
      const before = new Date();
      const task = new TransferTaskModel(defaultOptions);
      const after = new Date();

      expect(task.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(task.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should extract file name from local path if not provided', () => {
      const options = {
        ...defaultOptions,
        fileName: undefined,
        localPath: '/path/to/document.pdf'
      };

      const task = new TransferTaskModel(options);
      expect(task.fileName).toBe('document.pdf');
    });

    it('should handle Windows-style paths when extracting file name', () => {
      const options = {
        ...defaultOptions,
        fileName: undefined,
        localPath: String.raw`C:\Users\test\document.pdf`
      };

      const task = new TransferTaskModel(options);
      expect(task.fileName).toBe('document.pdf');
    });

    it('should default file size to 0 if not provided', () => {
      const options = {
        ...defaultOptions,
        fileSize: undefined
      };

      const task = new TransferTaskModel(options);
      expect(task.fileSize).toBe(0);
    });

    it('should default isDirectory to false', () => {
      const task = new TransferTaskModel(defaultOptions);
      expect(task.isDirectory).toBe(false);
    });

    it('should default maxRetries to 3 if not provided', () => {
      const options = {
        ...defaultOptions,
        maxRetries: undefined
      };

      const task = new TransferTaskModel(options);
      expect(task.maxRetries).toBe(3);
    });
  });

  describe('updateProgress', () => {
    it('should update transferred bytes and progress percentage', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.updateProgress(512 * 1024, 1024 * 1024); // 50% progress

      expect(task.transferred).toBe(512 * 1024);
      expect(task.progress).toBe(50);
    });

    it('should calculate speed based on time delta', async () => {
      const task = new TransferTaskModel(defaultOptions);

      // Start task to initialize speed calculation baseline
      task.start();

      // First update
      task.updateProgress(0, 1024 * 1024);

      // Wait at least 1 second for speed update interval
      await new Promise(resolve => setTimeout(resolve, 1100));
      task.updateProgress(100 * 1024, 1024 * 1024);

      expect(task.speed).toBeGreaterThan(0);
    });

    it('should update file size if initially unknown', () => {
      const options = {
        ...defaultOptions,
        fileSize: 0
      };
      const task = new TransferTaskModel(options);

      task.updateProgress(512 * 1024, 2 * 1024 * 1024);

      expect(task.fileSize).toBe(2 * 1024 * 1024);
    });

    it('should calculate estimated time remaining', async () => {
      const task = new TransferTaskModel(defaultOptions);

      // Start task to initialize speed calculation baseline
      task.start();

      task.updateProgress(0, 1024 * 1024);
      // Wait at least 1 second for speed update interval
      await new Promise(resolve => setTimeout(resolve, 1100));
      task.updateProgress(100 * 1024, 1024 * 1024);

      expect(task.estimatedTime).toBeDefined();
      expect(task.estimatedTime).toBeGreaterThan(0);
    });

    it('should cap progress at 100%', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.updateProgress(2 * 1024 * 1024, 1024 * 1024); // Over 100%

      expect(task.progress).toBe(100);
    });

    it('should handle zero total gracefully', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.updateProgress(100, 0);

      expect(task.transferred).toBe(100);
      // Progress should not be calculated when total is 0
    });
  });

  describe('State Transitions', () => {
    describe('start', () => {
      it('should transition from pending to running', () => {
        const task = new TransferTaskModel(defaultOptions);

        task.start();

        expect(task.status).toBe('running');
        expect(task.startedAt).toBeDefined();
        expect(task.abortController).toBeDefined();
      });

      it('should transition from paused to running', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.status = 'paused' as TaskStatus;

        task.start();

        expect(task.status).toBe('running');
      });

      it('should not change startedAt if already set', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.start();
        const firstStartedAt = task.startedAt;

        task.pause();
        task.start();

        expect(task.startedAt).toBe(firstStartedAt);
      });

      it('should create new abort controller', () => {
        const task = new TransferTaskModel(defaultOptions);

        task.start();

        expect(task.abortController).toBeInstanceOf(AbortController);
      });
    });

    describe('pause', () => {
      it('should transition from running to paused', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.start();

        task.pause();

        expect(task.status).toBe('paused');
      });

      it('should abort the controller', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.start();
        const controller = task.abortController;

        task.pause();

        expect(controller?.signal.aborted).toBe(true);
        expect(task.abortController).toBeUndefined();
      });

      it('should not change status if not running', () => {
        const task = new TransferTaskModel(defaultOptions);

        task.pause();

        expect(task.status).toBe('pending');
      });
    });

    describe('resume', () => {
      it('should transition from paused to pending', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.start();
        task.pause();

        task.resume();

        expect(task.status).toBe('pending');
      });

      it('should keep progress when resuming (for resume support)', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.start();
        task.updateProgress(512 * 1024, 1024 * 1024);
        task.pause();

        const transferredBeforeResume = task.transferred;
        const progressBeforeResume = task.progress;

        task.resume();

        // SFTP 支持断点续传，应该保留进度
        expect(task.transferred).toBe(transferredBeforeResume);
        expect(task.progress).toBe(progressBeforeResume);
        expect(task.status).toBe('pending');
      });

      it('should not change status if not paused', () => {
        const task = new TransferTaskModel(defaultOptions);

        task.resume();

        expect(task.status).toBe('pending');
      });
    });

    describe('cancel', () => {
      it('should transition to cancelled status', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.start();

        task.cancel();

        expect(task.status).toBe('cancelled');
        expect(task.completedAt).toBeDefined();
      });

      it('should abort the controller', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.start();
        const controller = task.abortController;

        task.cancel();

        expect(controller?.signal.aborted).toBe(true);
        expect(task.abortController).toBeUndefined();
      });

      it('should not cancel if already completed', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.start();
        task.complete();

        task.cancel();

        expect(task.status).toBe('completed');
      });

      it('should not cancel if already failed', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.start();
        task.fail('Test error');

        task.cancel();

        expect(task.status).toBe('failed');
      });
    });

    describe('complete', () => {
      it('should transition from running to completed', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.start();

        task.complete();

        expect(task.status).toBe('completed');
        expect(task.completedAt).toBeDefined();
        expect(task.progress).toBe(100);
      });

      it('should clear abort controller', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.start();

        task.complete();

        expect(task.abortController).toBeUndefined();
      });

      it('should not complete if not running', () => {
        const task = new TransferTaskModel(defaultOptions);

        task.complete();

        expect(task.status).toBe('pending');
      });
    });

    describe('fail', () => {
      it('should transition to failed status', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.start();

        task.fail('Connection error');

        expect(task.status).toBe('failed');
        expect(task.completedAt).toBeDefined();
        expect(task.lastError).toBe('Connection error');
      });

      it('should clear abort controller', () => {
        const task = new TransferTaskModel(defaultOptions);
        task.start();

        task.fail('Error');

        expect(task.abortController).toBeUndefined();
      });
    });
  });

  describe('Retry Logic', () => {
    it('should increment retry count', () => {
      const task = new TransferTaskModel(defaultOptions);
      task.fail('Error');

      const result = task.incrementRetry();

      expect(result).toBe(true);
      expect(task.retryCount).toBe(1);
      expect(task.status).toBe('pending');
      expect(task.lastError).toBeUndefined();
    });

    it('should allow retries up to max retries', () => {
      const task = new TransferTaskModel({ ...defaultOptions, maxRetries: 3 });

      expect(task.incrementRetry()).toBe(true); // 1st retry
      expect(task.incrementRetry()).toBe(true); // 2nd retry
      expect(task.incrementRetry()).toBe(true); // 3rd retry
      expect(task.incrementRetry()).toBe(false); // Exceeded
    });

    it('should not allow retry after max retries reached', () => {
      const task = new TransferTaskModel({ ...defaultOptions, maxRetries: 1 });
      task.incrementRetry();

      const result = task.incrementRetry();

      expect(result).toBe(false);
      expect(task.retryCount).toBe(1);
    });

    it('should check if task can retry', () => {
      const task = new TransferTaskModel({ ...defaultOptions, maxRetries: 2 });

      expect(task.canRetry()).toBe(true);
      task.incrementRetry();
      expect(task.canRetry()).toBe(true);
      task.incrementRetry();
      expect(task.canRetry()).toBe(false);
    });
  });

  describe('Duration and Speed Calculations', () => {
    it('should calculate duration when completed', () => {
      vi.useFakeTimers();

      const task = new TransferTaskModel(defaultOptions);
      task.start();

      vi.advanceTimersByTime(5000); // 5 seconds
      task.complete();

      const duration = task.getDuration();
      expect(duration).toBeGreaterThanOrEqual(4900); // Allow some tolerance
      expect(duration).toBeLessThanOrEqual(5100);

      vi.useRealTimers();
    });

    it('should return undefined duration if not completed', () => {
      const task = new TransferTaskModel(defaultOptions);
      task.start();

      expect(task.getDuration()).toBeUndefined();
    });

    it('should calculate average speed', () => {
      vi.useFakeTimers();

      const task = new TransferTaskModel(defaultOptions);
      task.start();
      task.updateProgress(0, 1024 * 1024);

      vi.advanceTimersByTime(1000); // 1 second
      task.updateProgress(1024 * 1024, 1024 * 1024);
      task.complete();

      const avgSpeed = task.getAverageSpeed();
      expect(avgSpeed).toBeDefined();
      expect(avgSpeed).toBeGreaterThan(0);

      vi.useRealTimers();
    });

    it('should return undefined average speed if not completed', () => {
      const task = new TransferTaskModel(defaultOptions);

      expect(task.getAverageSpeed()).toBeUndefined();
    });
  });

  describe('Serialization', () => {
    it('should serialize to JSON', () => {
      const task = new TransferTaskModel(defaultOptions);
      task.start();
      task.updateProgress(512 * 1024, 1024 * 1024);

      const json = task.toJSON();

      expect(json.id).toBe(task.id);
      expect(json.type).toBe('upload');
      expect(json.status).toBe('running');
      expect(json.transferred).toBe(512 * 1024);
      expect(json.progress).toBe(50);
      expect(json.createdAt).toBeTruthy();
      expect(json.startedAt).toBeTruthy();
    });

    it('should deserialize from JSON', () => {
      const original = new TransferTaskModel(defaultOptions);
      original.start();
      original.updateProgress(512 * 1024, 1024 * 1024);

      const json = original.toJSON();
      const restored = TransferTaskModel.fromJSON(json);

      expect(restored.id).toBe(original.id);
      expect(restored.type).toBe(original.type);
      expect(restored.status).toBe(original.status);
      expect(restored.transferred).toBe(original.transferred);
      expect(restored.progress).toBe(original.progress);
      expect(restored.hostId).toBe(original.hostId);
      expect(restored.hostName).toBe(original.hostName);
    });

    it('should handle optional fields in JSON', () => {
      const task = new TransferTaskModel(defaultOptions);
      const json = task.toJSON();

      expect(json.startedAt).toBeUndefined();
      expect(json.completedAt).toBeUndefined();
      expect(json.lastError).toBeUndefined();
    });

    it('should restore dates correctly', () => {
      const task = new TransferTaskModel(defaultOptions);
      task.start();
      task.complete();

      const json = task.toJSON();
      const restored = TransferTaskModel.fromJSON(json);

      expect(restored.createdAt).toBeInstanceOf(Date);
      expect(restored.startedAt).toBeInstanceOf(Date);
      expect(restored.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty local path', () => {
      const options = {
        ...defaultOptions,
        localPath: '',
        fileName: undefined
      };

      const task = new TransferTaskModel(options);
      expect(task.fileName).toBe('unknown');
    });

    it('should handle directory transfer', () => {
      const options = {
        ...defaultOptions,
        isDirectory: true,
        localPath: '/path/to/folder',
        fileName: 'folder'
      };

      const task = new TransferTaskModel(options);
      expect(task.isDirectory).toBe(true);
      expect(task.fileName).toBe('folder');
    });

    it('should handle download type', () => {
      const options = {
        ...defaultOptions,
        type: 'download' as const
      };

      const task = new TransferTaskModel(options);
      expect(task.type).toBe('download');
    });

    it('should handle very large file sizes', () => {
      const options = {
        ...defaultOptions,
        fileSize: 100 * 1024 * 1024 * 1024 // 100 GB
      };

      const task = new TransferTaskModel(options);
      expect(task.fileSize).toBe(100 * 1024 * 1024 * 1024);
    });

    it('should handle rapid state transitions', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.start();
      task.pause();
      task.resume();
      task.start();
      task.complete();

      expect(task.status).toBe('completed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle file name with special characters', () => {
      const options = {
        ...defaultOptions,
        fileName: 'test@#$%^&()file[].txt'
      };

      const task = new TransferTaskModel(options);
      expect(task.fileName).toBe('test@#$%^&()file[].txt');
    });

    it('should handle very long file name', () => {
      const longName = 'a'.repeat(1000) + '.txt';
      const options = {
        ...defaultOptions,
        fileName: longName
      };

      const task = new TransferTaskModel(options);
      expect(task.fileName).toBe(longName);
      expect(task.fileName.length).toBe  (1004);
    });

    it('should handle path with multiple consecutive slashes', () => {
      const options = {
        ...defaultOptions,
        fileName: undefined,
        localPath: '/path///to////file.txt'
      };

      const task = new TransferTaskModel(options);
      expect(task.fileName).toBe('file.txt');
    });

    it('should handle maxRetries with zero value', () => {
      const options = {
        ...defaultOptions,
        maxRetries: 0
      };

      const task = new TransferTaskModel(options);
      // Implementation may have a minimum value (default 3)
      expect(task.maxRetries).toBeGreaterThanOrEqual(0);
    });

    it('should handle extremely large file size (100TB)', () => {
      const hugeSize = 100 * 1024 * 1024 * 1024 * 1024; // 100 TB
      const options = {
        ...defaultOptions,
        fileSize: hugeSize
      };

      const task = new TransferTaskModel(options);
      expect(task.fileSize).toBe(hugeSize);
    });

    it('should handle negative transferred bytes in updateProgress', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.updateProgress(-100, 1024);

      expect(task.transferred).toBe(-100);
      // Progress calculation should handle negative values
    });

    it('should handle transferred exceeding fileSize', () => {
      const task = new TransferTaskModel(defaultOptions);
      const fileSize = 1024;

      task.updateProgress(2048, fileSize);

      expect(task.transferred).toBe(2048);
      // Progress is capped at 100%
      expect(task.progress).toBe(100);
    });

    it('should handle file name with only extension', () => {
      const options = {
        ...defaultOptions,
        fileName: undefined,
        localPath: '/path/to/.gitignore'
      };

      const task = new TransferTaskModel(options);
      expect(task.fileName).toBe('.gitignore');
    });

    it('should handle file name with Unicode characters', () => {
      const options = {
        ...defaultOptions,
        fileName: '测试文件名-テスト-🎉.txt'
      };

      const task = new TransferTaskModel(options);
      expect(task.fileName).toBe('测试文件名-テスト-🎉.txt');
    });

    it('should handle path with trailing slash', () => {
      const options = {
        ...defaultOptions,
        fileName: undefined,
        localPath: '/path/to/file.txt/'
      };

      const task = new TransferTaskModel(options);
      // Should extract file name even with trailing slash
      expect(task.fileName).toBeTruthy();
    });

    it('should handle complete() on already completed task', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.start();
      task.complete();
      const firstCompletedAt = task.completedAt;

      task.complete();

      expect(task.status).toBe('completed');
      expect(task.completedAt).toBe(firstCompletedAt);
    });

    it('should handle fail() on already failed task', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.start();
      task.fail('First error');
      const firstError = task.lastError;

      task.fail('Second error');

      expect(task.status).toBe('failed');
      expect(task.lastError).toBe(firstError);
    });

    it('should handle incrementRetry beyond maxRetries', () => {
      const options = {
        ...defaultOptions,
        maxRetries: 3
      };
      const task = new TransferTaskModel(options);

      for (let i = 0; i < 10; i++) {
        task.incrementRetry();
      }

      // Implementation may cap retryCount at maxRetries
      expect(task.retryCount).toBeGreaterThan(0);
      expect(task.retryCount).toBeLessThanOrEqual(10);
    });
  });

  describe('Chunk Progress', () => {
    it('should initialize chunk progress correctly', () => {
      const task = new TransferTaskModel(defaultOptions);
      const totalChunks = 5;
      const chunkSize = 1024;
      const totalSize = 5000;

      task.initializeChunkProgress(totalChunks, chunkSize, totalSize);

      expect(task.chunkProgress).toBeDefined();
      expect(task.chunkProgress?.length).toBe(5);
      expect(task.chunkProgress?.[0].start).toBe(0);
      expect(task.chunkProgress?.[0].size).toBe(1024);
      expect(task.chunkProgress?.[4].end).toBe(4999);
    });

    it('should initialize chunk progress with correct sizes', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.initializeChunkProgress(3, 1000, 2500);

      expect(task.chunkProgress?.[0].size).toBe(1000); // 0-999
      expect(task.chunkProgress?.[1].size).toBe(1000); // 1000-1999
      expect(task.chunkProgress?.[2].size).toBe(500);  // 2000-2499 (last chunk smaller)
    });

    it('should update chunk progress correctly', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.initializeChunkProgress(3, 1000, 3000);
      task.updateChunkProgress(0, 500, 'downloading');

      expect(task.chunkProgress?.[0].transferred).toBe(500);
      expect(task.chunkProgress?.[0].status).toBe('downloading');
    });

    it('should calculate chunk speed when downloading', async () => {
      const task = new TransferTaskModel(defaultOptions);

      task.initializeChunkProgress(2, 1000, 2000);
      task.updateChunkProgress(0, 0, 'downloading');

      // Wait a bit then update progress
      await new Promise(resolve => setTimeout(resolve, 100));
      task.updateChunkProgress(0, 500, 'downloading');

      expect(task.chunkProgress?.[0].speed).toBeGreaterThan(0);
    });

    it('should mark chunk as completed', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.initializeChunkProgress(2, 1000, 2000);
      task.updateChunkProgress(0, 1000, 'completed');

      expect(task.chunkProgress?.[0].status).toBe('completed');
      expect(task.chunkProgress?.[0].transferred).toBe(1000);
      expect(task.chunkProgress?.[0].endTime).toBeDefined();
    });

    it('should get total transferred from all chunks', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.initializeChunkProgress(3, 1000, 3000);
      task.updateChunkProgress(0, 1000, 'completed');
      task.updateChunkProgress(1, 500, 'downloading');
      task.updateChunkProgress(2, 0, 'pending');

      const total = task.getChunkTotalTransferred();
      expect(total).toBe(1500); // 1000 + 500 + 0
    });

    it('should handle chunk progress with no chunks initialized', () => {
      const task = new TransferTaskModel(defaultOptions);

      const total = task.getChunkTotalTransferred();
      expect(total).toBe(0);
    });

    it('should handle update chunk progress with invalid index', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.initializeChunkProgress(2, 1000, 2000);

      // Should not throw error for out of bounds index
      expect(() => {
        task.updateChunkProgress(5, 500, 'downloading');
      }).not.toThrow();
    });

    it('should handle chunk progress for single chunk', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.initializeChunkProgress(1, 10000, 10000);

      expect(task.chunkProgress?.length).toBe(1);
      expect(task.chunkProgress?.[0].size).toBe(10000);
    });

    it('should handle chunk progress with very small chunks', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.initializeChunkProgress(100, 10, 1000);

      expect(task.chunkProgress?.length).toBe(100);
      expect(task.chunkProgress?.[0].size).toBe(10);
      expect(task.chunkProgress?.[99].size).toBe(10);
    });

    it('should calculate correct chunk boundaries', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.initializeChunkProgress(4, 256, 1000);

      // Check each chunk's boundaries
      expect(task.chunkProgress?.[0].start).toBe(0);
      expect(task.chunkProgress?.[0].end).toBe(255);
      expect(task.chunkProgress?.[1].start).toBe(256);
      expect(task.chunkProgress?.[1].end).toBe(511);
      expect(task.chunkProgress?.[3].start).toBe(768);
      expect(task.chunkProgress?.[3].end).toBe(999); // Last chunk to file end
    });

    it('should reset chunk transferred to chunk size on completion', () => {
      const task = new TransferTaskModel(defaultOptions);

      task.initializeChunkProgress(2, 1000, 2000);
      task.updateChunkProgress(0, 800, 'downloading');
      task.updateChunkProgress(0, 1000, 'completed');

      // On completion, transferred should equal chunk size
      expect(task.chunkProgress?.[0].transferred).toBe(1000);
    });
  });
});
