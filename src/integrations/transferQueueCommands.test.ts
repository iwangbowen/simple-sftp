import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransferQueueCommands } from './transferQueueCommands';
import { TransferQueueService } from '../services/transferQueueService';

// Mock dependencies
vi.mock('../services/transferQueueService');
vi.mock('../services/transferHistoryService');
vi.mock('../logger');

describe('TransferQueueCommands', () => {
  let commands: TransferQueueCommands;
  let mockQueueService: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock TransferQueueService
    mockQueueService = {
      pauseQueue: vi.fn(),
      resumeQueue: vi.fn(),
      pauseTask: vi.fn(),
      resumeTask: vi.fn(),
      cancelTask: vi.fn(),
      retryTask: vi.fn(),
      removeTask: vi.fn(),
      getAllTasks: vi.fn().mockReturnValue([]),
      clearCompleted: vi.fn(),
      clearAll: vi.fn(),
      getStats: vi.fn().mockReturnValue({
        total: 0,
        queued: 0,
        running: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      }),
      stats: {
        queued: 0,
        running: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      },
    };

    vi.mocked(TransferQueueService.getInstance).mockReturnValue(mockQueueService);

    commands = new TransferQueueCommands();
  });

  describe('Queue Management Commands', () => {
    it('should pause queue', async () => {
      await commands.pauseQueue();
      expect(mockQueueService.pauseQueue).toHaveBeenCalled();
    });

    it('should resume queue', async () => {
      await commands.resumeQueue();
      expect(mockQueueService.resumeQueue).toHaveBeenCalled();
    });

    it('should clear completed tasks', async () => {
      mockQueueService.getStats.mockReturnValue({
        total: 1,
        queued: 0,
        running: 0,
        paused: 0,
        completed: 1,
        failed: 0,
        cancelled: 0,
      });

      const vscode = await import('vscode');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Yes' as any);

      await commands.clearCompleted();

      expect(mockQueueService.clearCompleted).toHaveBeenCalled();
    });

    it('should not clear completed tasks if there are none', async () => {
      mockQueueService.getStats.mockReturnValue({
        total: 0,
        queued: 0,
        running: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      });

      await commands.clearCompleted();

      expect(mockQueueService.clearCompleted).not.toHaveBeenCalled();
    });

    it('should clear all tasks with confirmation', async () => {
      mockQueueService.getStats.mockReturnValue({
        total: 2,
        queued: 0,
        running: 1,
        paused: 0,
        completed: 1,
        failed: 0,
        cancelled: 0,
      });

      // Mock VS Code showWarningMessage to return 'Yes'
      const vscode = await import('vscode');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Yes' as any);

      await commands.clearAll();

      expect(mockQueueService.clearAll).toHaveBeenCalled();
    });

    it('should not clear all tasks if user cancels', async () => {
      mockQueueService.getStats.mockReturnValue({
        total: 1,
        queued: 0,
        running: 0,
        paused: 0,
        completed: 1,
        failed: 0,
        cancelled: 0,
      });

      const vscode = await import('vscode');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('No' as any);

      await commands.clearAll();

      expect(mockQueueService.clearAll).not.toHaveBeenCalled();
    });
  });

  describe('Task Management Commands', () => {
    it('should pause task when task is provided', async () => {
      const task: any = {
        id: 'task1',
        status: 'running',
        direction: 'upload' as const,
        localPath: '/local',
        remotePath: '/remote',
      };

      await commands.pauseTask(task);

      expect(mockQueueService.pauseTask).toHaveBeenCalledWith('task1');
    });

    it('should resume task when task is provided', async () => {
      const task: any = {
        id: 'task1',
        status: 'paused',
        direction: 'upload' as const,
        localPath: '/local',
        remotePath: '/remote',
      };

      await commands.resumeTask(task);

      expect(mockQueueService.resumeTask).toHaveBeenCalledWith('task1');
    });

    it('should cancel task when task is provided', async () => {
      const task: any = {
        id: 'task1',
        status: 'running',
        direction: 'upload' as const,
        localPath: '/local',
        remotePath: '/remote',
        fileName: 'file.txt',
      };

      const vscode = await import('vscode');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Confirm' as any);

      await commands.cancelTask(task);

      expect(mockQueueService.cancelTask).toHaveBeenCalledWith('task1');
    });

    it('should not cancel task if user cancels confirmation', async () => {
      const task: any = {
        id: 'task1',
        status: 'running',
        direction: 'upload' as const,
        localPath: '/local',
        remotePath: '/remote',
        fileName: 'file.txt',
      };

      const vscode = await import('vscode');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

      await commands.cancelTask(task);

      expect(mockQueueService.cancelTask).not.toHaveBeenCalled();
    });

    it('should retry task when task is provided', async () => {
      const task: any = {
        id: 'task1',
        status: 'failed',
        direction: 'upload' as const,
        localPath: '/local',
        remotePath: '/remote',
        fileName: 'file.txt',
        incrementRetry: vi.fn().mockReturnValue(true),
      };

      await commands.retryTask(task);

      expect(task.incrementRetry).toHaveBeenCalled();
    });

    it('should not retry task when max retries reached', async () => {
      const task: any = {
        id: 'task1',
        status: 'failed',
        direction: 'upload' as const,
        localPath: '/local',
        remotePath: '/remote',
        fileName: 'file.txt',
        incrementRetry: vi.fn().mockReturnValue(false),
      };

      const vscode = await import('vscode');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

      await commands.retryTask(task);

      expect(task.incrementRetry).toHaveBeenCalled();
      expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    });

    it('should remove task when task is provided', async () => {
      const task: any = {
        id: 'task1',
        status: 'completed',
        direction: 'upload' as const,
        localPath: '/local',
        remotePath: '/remote',
      };

      await commands.removeTask(task);

      expect(mockQueueService.removeTask).toHaveBeenCalledWith('task1');
    });
  });

  describe('getStatusColor', () => {
    it('should return correct color for each status', () => {
      expect((commands as any).getStatusColor('completed')).toBe('#4ec9b0');
      expect((commands as any).getStatusColor('failed')).toBe('#f48771');
      expect((commands as any).getStatusColor('running')).toBe('#569cd6');
      expect((commands as any).getStatusColor('paused')).toBe('#dcdcaa');
      expect((commands as any).getStatusColor('cancelled')).toBe('#858585');
    });

    it('should return default color for unknown status', () => {
      expect((commands as any).getStatusColor('unknown')).toBe('#d4d4d4');
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

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect((commands as any).escapeHtml('<script>alert("XSS")</script>')).toContain('&lt;');
      expect((commands as any).escapeHtml('<script>alert("XSS")</script>')).toContain('&gt;');
      expect((commands as any).escapeHtml('Test & Test')).toContain('&amp;');
      expect((commands as any).escapeHtml('"quoted"')).toContain('&quot;');
      // escapeHtml returns &#39; not &#039;
      expect((commands as any).escapeHtml("'apostrophe'")).toContain('&#39;');
    });

    it('should handle normal text without changes', () => {
      const normalText = 'This is normal text 123';
      expect((commands as any).escapeHtml(normalText)).toBe(normalText);
    });
  });
});
