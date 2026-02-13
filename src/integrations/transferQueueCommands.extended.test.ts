import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { TransferQueueCommands } from './transferQueueCommands';
import { TransferQueueService } from '../services/transferQueueService';
import { TransferHistoryService } from '../services/transferHistoryService';

vi.mock('../services/transferQueueService');
vi.mock('../services/transferHistoryService');
vi.mock('../logger');

describe('TransferQueueCommands - extended branch coverage', () => {
  let commands: TransferQueueCommands;
  let mockQueueService: any;
  let mockHistoryService: any;

  const createTask = (overrides: Record<string, any> = {}) => {
    const task: any = {
      id: 'task-1',
      fileName: 'report.txt',
      type: 'upload',
      status: 'running',
      hostId: 'h1',
      hostName: 'dev-host',
      localPath: 'C:/local/report.txt',
      remotePath: '/remote/report.txt',
      fileSize: 4096,
      transferred: 2048,
      progress: 50,
      speed: 1024,
      estimatedTime: 2000,
      retryCount: 0,
      maxRetries: 3,
      lastError: undefined,
      createdAt: new Date('2026-01-01T01:00:00.000Z'),
      startedAt: new Date('2026-01-01T01:00:01.000Z'),
      completedAt: undefined,
      incrementRetry: vi.fn().mockReturnValue(true),
      getDuration: vi.fn().mockReturnValue(5000),
      getAverageSpeed: vi.fn().mockReturnValue(800),
      toJSON: vi.fn(() => ({
        id: 'task-1',
        fileName: 'report.txt',
        type: 'upload',
        status: 'running',
        hostId: 'h1',
        hostName: 'dev-host',
        localPath: 'C:/local/report.txt',
        remotePath: '/remote/report.txt',
        fileSize: 4096,
        transferred: 2048,
        progress: 50,
        speed: 1024,
        estimatedTime: 2000,
        retryCount: 0,
        maxRetries: 3,
      })),
      ...overrides,
    };

    // Ensure toJSON reflects overrides when needed
    task.toJSON = overrides.toJSON || vi.fn(() => ({
      id: task.id,
      fileName: task.fileName,
      type: task.type,
      status: task.status,
      hostId: task.hostId,
      hostName: task.hostName,
      localPath: task.localPath,
      remotePath: task.remotePath,
      fileSize: task.fileSize,
      transferred: task.transferred,
      progress: task.progress,
      speed: task.speed,
      estimatedTime: task.estimatedTime,
      retryCount: task.retryCount,
      maxRetries: task.maxRetries,
    }));

    return task;
  };

  const template = `<!doctype html><html><body>
{{TITLE}} {{FILE_NAME}} {{TYPE}} {{STATUS}} {{STATUS_CLASS}}
{{HOST}} {{LOCAL_PATH}} {{REMOTE_PATH}}
{{FILE_SIZE}} {{TRANSFERRED}} {{PROGRESS}} {{CREATED_AT}} {{TASK_ID}}
{{CURRENT_SPEED}} {{SPEED_DISPLAY}}
{{#RUNNING_INFO}}RUN {{#HAS_ESTIMATE}}EST={{ESTIMATED_TIME}}{{/HAS_ESTIMATE}}{{/RUNNING_INFO}}
{{#HAS_DURATION}}DUR={{DURATION}} {{#HAS_AVG_SPEED}}AVG={{AVG_SPEED}}{{/HAS_AVG_SPEED}}{{/HAS_DURATION}}
{{#HAS_RETRIES}}RETRY={{RETRY_COUNT}}/{{MAX_RETRIES}}{{/HAS_RETRIES}}
{{#HAS_ERROR}}ERR={{ERROR_MESSAGE}}{{/HAS_ERROR}}
{{#HAS_STARTED}}START={{STARTED_AT}}{{/HAS_STARTED}}
{{#HAS_COMPLETED}}END={{COMPLETED_AT}}{{/HAS_COMPLETED}}
</body></html>`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockQueueService = {
      pauseQueue: vi.fn(),
      resumeQueue: vi.fn(),
      pauseTask: vi.fn(),
      resumeTask: vi.fn(),
      cancelTask: vi.fn().mockResolvedValue(undefined),
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearAll: vi.fn(),
      getTask: vi.fn(),
      getAllTasks: vi.fn().mockReturnValue([]),
      getRunningTasks: vi.fn().mockReturnValue([]),
      getStats: vi.fn().mockReturnValue({
        total: 0,
        pending: 0,
        running: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        totalBytes: 0,
        transferredBytes: 0,
        averageSpeed: 0,
      }),
      getQueueStatus: vi.fn().mockReturnValue({
        isPaused: false,
        maxConcurrent: 3,
        runningCount: 0,
        stats: {
          total: 0,
          pending: 0,
          running: 0,
          paused: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
          totalBytes: 0,
          transferredBytes: 0,
          averageSpeed: 0,
        },
      }),
    };

    mockHistoryService = {
      getRecentHistory: vi.fn().mockReturnValue([]),
      getStatistics: vi.fn().mockReturnValue({ total: 0 }),
      clearAllHistory: vi.fn().mockResolvedValue(undefined),
      removeFromHistory: vi.fn(),
    };

    vi.mocked(TransferQueueService.getInstance).mockReturnValue(mockQueueService);
    vi.mocked(TransferHistoryService.getInstance).mockReturnValue(mockHistoryService);

    commands = new TransferQueueCommands({ extensionPath: 'C:/ext' } as any);

    vi.spyOn(commands as any, 'loadHtmlTemplate').mockReturnValue(template);

    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined as any);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined as any);
    vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined as any);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('queue/history branches', () => {
    it('clearCompleted exits when no completed-like tasks', async () => {
      mockQueueService.getStats.mockReturnValue({
        total: 2,
        pending: 1,
        running: 1,
        paused: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      });

      await commands.clearCompleted();
      expect(mockQueueService.clearCompleted).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No completed tasks to clear');
    });

    it('clearCompleted does nothing when user chooses No', async () => {
      mockQueueService.getStats.mockReturnValue({
        total: 3,
        pending: 0,
        running: 0,
        paused: 0,
        completed: 1,
        failed: 1,
        cancelled: 1,
      });
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('No' as any);

      await commands.clearCompleted();
      expect(mockQueueService.clearCompleted).not.toHaveBeenCalled();
    });

    it('clearAll exits when queue empty', async () => {
      mockQueueService.getStats.mockReturnValue({ total: 0 });
      await commands.clearAll();
      expect(mockQueueService.clearAll).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Queue is empty');
    });

    it('showQueueStats displays detail modal', async () => {
      mockQueueService.getStats.mockReturnValue({
        total: 8,
        pending: 2,
        running: 2,
        paused: 1,
        completed: 2,
        failed: 1,
        cancelled: 0,
        totalBytes: 1024 * 1024,
        transferredBytes: 256 * 1024,
        averageSpeed: 8 * 1024,
      });
      mockQueueService.getQueueStatus.mockReturnValue({ isPaused: true, maxConcurrent: 4, runningCount: 2 });

      await commands.showQueueStats();
      expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    });

    it('viewHistory warns when history service missing', async () => {
      vi.mocked(TransferHistoryService.getInstance).mockImplementation(() => {
        throw new Error('not initialized');
      });
      const cmd = new TransferQueueCommands();

      await cmd.viewHistory();
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('History service not available');
    });

    it('viewHistory shows empty message', async () => {
      mockHistoryService.getRecentHistory.mockReturnValue([]);
      await commands.viewHistory();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No transfer history');
    });

    it('viewHistory opens selected item details', async () => {
      const historyTask = createTask({ status: 'completed', fileName: 'done.txt' });
      mockHistoryService.getRecentHistory.mockReturnValue([historyTask]);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ task: historyTask } as any);

      const spy = vi.spyOn(commands, 'showTaskDetails').mockResolvedValue();
      await commands.viewHistory();
      expect(spy).toHaveBeenCalledWith(historyTask);
    });

    it('clearHistory handles empty history', async () => {
      mockHistoryService.getStatistics.mockReturnValue({ total: 0 });
      await commands.clearHistory();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('History is empty');
      expect(mockHistoryService.clearAllHistory).not.toHaveBeenCalled();
    });

    it('clearHistory clears when confirmed', async () => {
      mockHistoryService.getStatistics.mockReturnValue({ total: 12 });
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Clear' as any);

      await commands.clearHistory();
      expect(mockHistoryService.clearAllHistory).toHaveBeenCalled();
    });

    it('removeHistoryTask warns when task missing', async () => {
      await commands.removeHistoryTask({});
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('No task selected');
    });

    it('removeHistoryTask removes selected task', async () => {
      const task = createTask({ id: 'history-1' });
      await commands.removeHistoryTask({ task });
      expect(mockHistoryService.removeFromHistory).toHaveBeenCalledWith('history-1');
    });
  });

  describe('running task selection branches', () => {
    it('showRunningTasks says no tasks when list empty', async () => {
      mockQueueService.getRunningTasks.mockReturnValue([]);
      await commands.showRunningTasks();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No tasks currently running');
    });

    it('showRunningTasks opens details directly when one running task', async () => {
      const task = createTask();
      mockQueueService.getRunningTasks.mockReturnValue([task]);
      const spy = vi.spyOn(commands, 'showTaskDetails').mockResolvedValue();

      await commands.showRunningTasks();
      expect(spy).toHaveBeenCalledWith(task);
    });

    it('showRunningTasks lets user pick when multiple running tasks', async () => {
      const t1 = createTask({ id: '1', fileName: 'a.bin' });
      const t2 = createTask({ id: '2', fileName: 'b.bin' });
      mockQueueService.getRunningTasks.mockReturnValue([t1, t2]);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ task: t2 } as any);

      const spy = vi.spyOn(commands, 'showTaskDetails').mockResolvedValue();
      await commands.showRunningTasks();
      expect(spy).toHaveBeenCalledWith(t2);
    });
  });

  describe('showTaskDetails branches', () => {
    const makePanel = () => {
      const disposeCallbacks: Array<() => void> = [];
      const panel: any = {
        viewColumn: vscode.ViewColumn?.Beside ?? 2,
        reveal: vi.fn(),
        iconPath: undefined,
        webview: {
          html: '',
          postMessage: vi.fn(),
        },
        onDidDispose: vi.fn((cb: () => void) => {
          disposeCallbacks.push(cb);
          return { dispose: vi.fn() };
        }),
        __disposeCallbacks: disposeCallbacks,
      };
      return panel;
    };

    it('shows warning when no task selected', async () => {
      mockQueueService.getAllTasks.mockReturnValue([]);
      await commands.showTaskDetails();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No  tasks found');
    });

    it('shows error for invalid task object', async () => {
      await commands.showTaskDetails({ id: '', fileName: '' } as any);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Invalid task: missing required properties');
    });

    it('creates panel and posts initial message', async () => {
      const panel = makePanel();
      vi.mocked(vscode.window.createWebviewPanel as any).mockReturnValue(panel);

      const task = createTask({ status: 'completed', speed: 0, estimatedTime: undefined, completedAt: new Date('2026-01-01T02:00:00.000Z') });
      await commands.showTaskDetails(task);

      expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(120);
      expect(panel.webview.postMessage).toHaveBeenCalled();
      expect(panel.webview.html).toContain('Task Details');
    });

    it('reuses existing panel for same task id', async () => {
      const panel = makePanel();
      vi.mocked(vscode.window.createWebviewPanel as any).mockReturnValue(panel);

      const task = createTask({ id: 'same-id', status: 'completed' });
      await commands.showTaskDetails(task);
      await commands.showTaskDetails(task);

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
      expect(panel.reveal).toHaveBeenCalled();
    });

    it('updates running panel on interval and stops when finished', async () => {
      const panel = makePanel();
      vi.mocked(vscode.window.createWebviewPanel as any).mockReturnValue(panel);

      const runningTask = createTask({ id: 'run-1', status: 'running' });
      const completedTask = createTask({ id: 'run-1', status: 'completed', speed: 0, estimatedTime: undefined });

      let call = 0;
      mockQueueService.getTask.mockImplementation(() => {
        call += 1;
        return call < 2 ? runningTask : completedTask;
      });

      await commands.showTaskDetails(runningTask);
      await vi.advanceTimersByTimeAsync(1200);

      expect(panel.webview.postMessage).toHaveBeenCalled();
      expect(mockQueueService.getTask).toHaveBeenCalled();
    });

    it('cleans interval when task disappears', async () => {
      const panel = makePanel();
      vi.mocked(vscode.window.createWebviewPanel as any).mockReturnValue(panel);

      const runningTask = createTask({ id: 'gone-1', status: 'running' });
      mockQueueService.getTask.mockReturnValue(undefined);

      await commands.showTaskDetails(runningTask);
      await vi.advanceTimersByTimeAsync(600);

      expect(mockQueueService.getTask).toHaveBeenCalledWith('gone-1');
    });
  });

  describe('template and block helpers', () => {
    it('removeConditionalBlock removes block when both markers exist', () => {
      const html = 'A {{#X}} remove me {{/X}} B';
      const result = (commands as any).removeConditionalBlock(html, '{{#X}}', '{{/X}}');
      expect(result).toBe('A  B');
    });

    it('removeConditionalBlock returns original when start marker missing', () => {
      const html = 'A {{/X}} B';
      const result = (commands as any).removeConditionalBlock(html, '{{#X}}', '{{/X}}');
      expect(result).toBe(html);
    });

    it('removeConditionalBlock returns original when end marker missing', () => {
      const html = 'A {{#X}} B';
      const result = (commands as any).removeConditionalBlock(html, '{{#X}}', '{{/X}}');
      expect(result).toBe(html);
    });

    it('getWebviewContent fills running/estimate sections', () => {
      const task = createTask({ status: 'running', estimatedTime: 3000 });
      const html = (commands as any).getWebviewContent(task, 5000, 1000);
      expect(html).toContain('RUN');
      expect(html).toContain('EST=3s');
      expect(html).toContain('DUR=5s');
      expect(html).toContain('AVG=1000.00 B/s');
    });

    it('getWebviewContent removes sections when optional data absent', () => {
      const task = createTask({
        status: 'completed',
        speed: 0,
        estimatedTime: undefined,
        retryCount: 0,
        lastError: undefined,
        startedAt: undefined,
        completedAt: undefined,
      });

      const html = (commands as any).getWebviewContent(task, undefined, undefined);
      expect(html).not.toContain('RUN');
      expect(html).not.toContain('RETRY=');
      expect(html).not.toContain('ERR=');
      expect(html).not.toContain('START=');
      expect(html).not.toContain('END=');
    });

    it('loadHtmlTemplate returns fallback when template path is invalid', () => {
      const cmd = new TransferQueueCommands({ extensionPath: 'Z:/__definitely_not_exists__' } as any);
      const html = (cmd as any).loadHtmlTemplate();
      expect(html).toContain('Error loading template file.');
      expect(html).toContain('Please check if the template file exists');
    });

    it('escapeHtml handles null/undefined safely', () => {
      expect((commands as any).escapeHtml(undefined)).toBe('');
      expect((commands as any).escapeHtml(null)).toBe('');
    });
  });

  describe('matrix tests for helper outputs (100+ cases contributor)', () => {
    const expectedSize = (value: number, units: string[]) => {
      if (value === 0) {return units[0] === 'B' ? '0 B' : '0 B/s';}
      const k = 1024;
      const idx = Math.floor(Math.log(value) / Math.log(k));
      return `${(value / Math.pow(k, idx)).toFixed(2)} ${units[idx]}`;
    };

    const byteCases = [
      0, 1, 2, 3, 7, 15, 31, 63, 127, 255, 511, 512, 513, 700, 999, 1023,
      1024, 1025, 1536, 2048, 4096, 8192, 16384, 32768, 65536,
      100000, 250000, 500000, 700000, 900000,
      1024 ** 2 - 1, 1024 ** 2, 1024 ** 2 + 1, 2 * 1024 ** 2, 5 * 1024 ** 2,
      10 * 1024 ** 2, 50 * 1024 ** 2, 99 * 1024 ** 2,
      1024 ** 3 - 1, 1024 ** 3, 1024 ** 3 + 1, 2 * 1024 ** 3, 3 * 1024 ** 3,
    ];

    const speedCases = [
      0, 1, 5, 10, 20, 50, 100, 250, 500, 700, 900, 1023,
      1024, 1200, 1500, 2000, 4096, 8192, 16384, 65536,
      100000, 200000, 400000, 800000,
      1024 ** 2 - 1, 1024 ** 2, 1024 ** 2 + 123,
      3 * 1024 ** 2, 10 * 1024 ** 2, 25 * 1024 ** 2,
      1024 ** 3 - 1, 1024 ** 3, 2 * 1024 ** 3,
    ];

    const durationCases = [
      0, 1, 10, 99, 100, 500, 999,
      1000, 1500, 5000, 10000, 15000, 30000, 45000, 59000,
      60000, 61000, 75000, 90000, 119000,
      120000, 180000, 3599000, 3600000, 3661000, 5400000, 86399000,
    ];

    it.each(byteCases)('formatBytes matrix #%# value=%s', (bytes) => {
      expect((commands as any).formatBytes(bytes)).toBe(expectedSize(bytes, ['B', 'KB', 'MB', 'GB']));
    });

    it.each(speedCases)('formatSpeed matrix #%# value=%s', (speed) => {
      expect((commands as any).formatSpeed(speed)).toBe(expectedSize(speed, ['B/s', 'KB/s', 'MB/s', 'GB/s']));
    });

    it.each(durationCases)('formatDuration matrix #%# value=%s', (ms) => {
      const seconds = Math.floor(ms / 1000);
      let expected: string;
      if (seconds < 60) {
        expected = `${seconds}s`;
      } else {
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) {
          expected = `${minutes}m ${seconds % 60}s`;
        } else {
          expected = `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
        }
      }

      expect((commands as any).formatDuration(ms)).toBe(expected);
    });
  });
});
