import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import * as vscode from 'vscode';
import { TransferQueueCommands } from './transferQueueCommands';
import { TransferTaskModel } from '../models/transferTask';

describe('TransferQueueCommands', () => {
  let mockOutputChannel: any;
  let commands: TransferQueueCommands;

  beforeAll(() => {
    // Set up vscode mocks
    mockOutputChannel = {
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn()
    };

    vi.spyOn(vscode.window, 'createOutputChannel').mockReturnValue(mockOutputChannel);
  });

  beforeEach(() => {
    commands = new TransferQueueCommands();
  });

  describe('buildTaskDetailsMarkdown', () => {
    it('should generate markdown with basic task information', () => {
      const task = {
        id: 'task-123',
        fileName: 'test.txt',
        type: 'upload',
        status: 'completed',
        hostName: 'Test Server',
        localPath: '/local/test.txt',
        remotePath: '/remote/test.txt',
        fileSize: 1024,
        transferred: 1024,
        progress: 100,
        createdAt: new Date('2024-01-01T10:00:00'),
        retryCount: 0,
        getDuration: () => undefined,
        getAverageSpeed: () => undefined
      } as unknown as TransferTaskModel;

      const markdown = (commands as any).buildTaskDetailsMarkdown(task);

      expect(markdown).toContain('# Transfer Task Details');
      expect(markdown).toContain('test.txt');
      expect(markdown).toContain('UPLOAD');
      expect(markdown).toContain('COMPLETED');
      expect(markdown).toContain('Test Server');
      expect(markdown).toContain('/local/test.txt');
      expect(markdown).toContain('/remote/test.txt');
      expect(markdown).toContain('task-123');
    });

    it('should include duration and average speed when available', () => {
      const task = {
        id: 'task-456',
        fileName: 'large-file.zip',
        type: 'download',
        status: 'completed',
        hostName: 'Prod Server',
        localPath: '/local/large-file.zip',
        remotePath: '/remote/large-file.zip',
        fileSize: 10485760, // 10 MB
        transferred: 10485760,
        progress: 100,
        createdAt: new Date('2024-01-01T10:00:00'),
        startedAt: new Date('2024-01-01T10:00:05'),
        completedAt: new Date('2024-01-01T10:01:05'),
        retryCount: 0,
        getDuration: () => 60000, // 60 seconds
        getAverageSpeed: () => 174762.67 // ~170 KB/s
      } as unknown as TransferTaskModel;

      const markdown = (commands as any).buildTaskDetailsMarkdown(task, 60000, 174762.67);

      expect(markdown).toContain('Duration');
      expect(markdown).toContain('1m 0s');
      expect(markdown).toContain('Average Speed');
      expect(markdown).toContain('KB/s');
    });

    it('should include retry information when retries occurred', () => {
      const task = {
        id: 'task-789',
        fileName: 'retry-test.dat',
        type: 'upload',
        status: 'completed',
        hostName: 'Unstable Server',
        localPath: '/local/retry-test.dat',
        remotePath: '/remote/retry-test.dat',
        fileSize: 2048,
        transferred: 2048,
        progress: 100,
        createdAt: new Date('2024-01-01T10:00:00'),
        retryCount: 2,
        maxRetries: 3,
        getDuration: () => undefined,
        getAverageSpeed: () => undefined
      } as unknown as TransferTaskModel;

      const markdown = (commands as any).buildTaskDetailsMarkdown(task);

      expect(markdown).toContain('Retry Information');
      expect(markdown).toContain('2 / 3');
    });

    it('should include error details when task failed', () => {
      const task = {
        id: 'task-error',
        fileName: 'failed-file.bin',
        type: 'upload',
        status: 'failed',
        hostName: 'Error Server',
        localPath: '/local/failed-file.bin',
        remotePath: '/remote/failed-file.bin',
        fileSize: 512,
        transferred: 256,
        progress: 50,
        createdAt: new Date('2024-01-01T10:00:00'),
        retryCount: 0,
        lastError: 'Connection timeout: Failed to connect to server',
        getDuration: () => undefined,
        getAverageSpeed: () => undefined
      } as unknown as TransferTaskModel;

      const markdown = (commands as any).buildTaskDetailsMarkdown(task);

      expect(markdown).toContain('Error Details');
      expect(markdown).toContain('Connection timeout: Failed to connect to server');
      expect(markdown).toContain('```');
    });

    it('should include timestamps for all events', () => {
      const createdAt = new Date('2024-01-01T10:00:00');
      const startedAt = new Date('2024-01-01T10:00:05');
      const completedAt = new Date('2024-01-01T10:01:05');

      const task = {
        id: 'task-timestamps',
        fileName: 'timestamp-test.log',
        type: 'download',
        status: 'completed',
        hostName: 'Time Server',
        localPath: '/local/timestamp-test.log',
        remotePath: '/remote/timestamp-test.log',
        fileSize: 128,
        transferred: 128,
        progress: 100,
        createdAt,
        startedAt,
        completedAt,
        retryCount: 0,
        getDuration: () => undefined,
        getAverageSpeed: () => undefined
      } as unknown as TransferTaskModel;

      const markdown = (commands as any).buildTaskDetailsMarkdown(task);

      expect(markdown).toContain('Timestamps');
      expect(markdown).toContain(createdAt.toLocaleString());
      expect(markdown).toContain(startedAt.toLocaleString());
      expect(markdown).toContain(completedAt.toLocaleString());
    });
  });

  describe('getStatusEmoji', () => {
    it('should return correct emoji for each status', () => {
      expect((commands as any).getStatusEmoji('pending')).toBe('⏳');
      expect((commands as any).getStatusEmoji('running')).toBe('🔄');
      expect((commands as any).getStatusEmoji('paused')).toBe('⏸️');
      expect((commands as any).getStatusEmoji('completed')).toBe('✅');
      expect((commands as any).getStatusEmoji('failed')).toBe('❌');
      expect((commands as any).getStatusEmoji('cancelled')).toBe('🚫');
    });

    it('should return default emoji for unknown status', () => {
      expect((commands as any).getStatusEmoji('unknown')).toBe('❓');
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect((commands as any).formatBytes(0)).toBe('0 B');
      expect((commands as any).formatBytes(1024)).toBe('1.00 KB');
      expect((commands as any).formatBytes(1048576)).toBe('1.00 MB');
      expect((commands as any).formatBytes(1073741824)).toBe('1.00 GB');
      expect((commands as any).formatBytes(500)).toBe('500.00 B'); // Implementation uses .toFixed(2)
      expect((commands as any).formatBytes(1536)).toBe('1.50 KB');
    });
  });

  describe('formatSpeed', () => {
    it('should format speed correctly', () => {
      expect((commands as any).formatSpeed(0)).toBe('0 B/s');
      expect((commands as any).formatSpeed(1024)).toBe('1.00 KB/s');
      expect((commands as any).formatSpeed(1048576)).toBe('1.00 MB/s');
      expect((commands as any).formatSpeed(2048)).toBe('2.00 KB/s');
    });
  });

  describe('formatDuration', () => {
    it('should format duration correctly', () => {
      expect((commands as any).formatDuration(1000)).toBe('1s');
      expect((commands as any).formatDuration(60000)).toBe('1m 0s');
      expect((commands as any).formatDuration(3661000)).toBe('1h 1m'); // Hours+minutes format doesn't show seconds
      expect((commands as any).formatDuration(90000)).toBe('1m 30s');
      expect((commands as any).formatDuration(500)).toBe('0s');
    });
  });
});
