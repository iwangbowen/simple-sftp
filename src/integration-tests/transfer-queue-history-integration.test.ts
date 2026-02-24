import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { TransferQueueService } from '../services/transferQueueService';
import { TransferHistoryService } from '../services/transferHistoryService';
import { TransferQueueCommands } from '../integrations/transferQueueCommands';
import { CreateTransferTaskOptions } from '../types/transfer.types';

describe('Transfer Queue + History integration', () => {
  let queueService: TransferQueueService;
  let historyService: TransferHistoryService;
  let commands: TransferQueueCommands;
  let context: vscode.ExtensionContext;
  let globalStateStore: Map<string, unknown>;

  const createTaskOptions = (
    fileName: string,
    type: 'upload' | 'download' = 'upload'
  ): CreateTransferTaskOptions => ({
    type,
    hostId: 'host-1',
    hostName: 'dev-host',
    localPath: `/local/${fileName}`,
    remotePath: `/remote/${fileName}`,
    fileName,
    fileSize: 1024
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset singleton instances to avoid cross-test pollution
    (TransferQueueService as any).instance = undefined;
    (TransferHistoryService as any).instance = undefined;

    globalStateStore = new Map<string, unknown>();

    context = {
      globalState: {
        get: vi.fn((key: string, defaultValue?: unknown) => {
          return globalStateStore.get(key) ?? defaultValue;
        }),
        update: vi.fn(async (key: string, value: unknown) => {
          globalStateStore.set(key, value);
        }),
        keys: vi.fn(() => Array.from(globalStateStore.keys())),
        setKeysForSync: vi.fn()
      }
    } as any;

    const hostManager = {
      getHosts: vi.fn().mockResolvedValue([])
    } as any;

    const authManager = {
      getAuth: vi.fn().mockResolvedValue(null)
    } as any;

    queueService = TransferQueueService.getInstance();
    queueService.initialize(hostManager, authManager);
    queueService.pauseQueue(); // Keep tasks deterministic in tests

    historyService = TransferHistoryService.initialize(context);
    commands = new TransferQueueCommands(context);

    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined as any);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined as any);
    vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined as any);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    queueService.dispose();
    historyService.dispose();
  });

  it('should clear terminal tasks and keep active tasks via command flow', async () => {
    const pendingTask = queueService.addTask(createTaskOptions('pending.txt'));

    const runningTask = queueService.addTask(createTaskOptions('running.txt'));
    runningTask.start();

    const pausedTask = queueService.addTask(createTaskOptions('paused.txt'));
    pausedTask.start();
    pausedTask.pause();

    const completedTask = queueService.addTask(createTaskOptions('completed.txt'));
    completedTask.start();
    completedTask.complete();

    const failedTask = queueService.addTask(createTaskOptions('failed.txt'));
    failedTask.start();
    failedTask.fail('network timeout');

    const cancelledTask = queueService.addTask(createTaskOptions('cancelled.txt'));
    cancelledTask.start();
    cancelledTask.cancel();

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Yes' as any);
    await commands.clearCompleted();

    const remainingTasks = queueService.getAllTasks();
    const remainingIds = remainingTasks.map(task => task.id);

    expect(remainingIds).toEqual(expect.arrayContaining([
      pendingTask.id,
      runningTask.id,
      pausedTask.id
    ]));

    expect(remainingIds).not.toEqual(expect.arrayContaining([
      completedTask.id,
      failedTask.id,
      cancelledTask.id
    ]));

    const stats = queueService.getStats();
    expect(stats.total).toBe(3);
    expect(stats.completed + stats.failed + stats.cancelled).toBe(0);
  });

  it('should persist terminal tasks through queue update bridge and reload from storage', async () => {
    const bridgeDisposable = queueService.onTaskUpdated((task) => {
      if (task.status === 'completed' || task.status === 'failed') {
        void historyService.addToHistory(task);
      }
    });

    const completedTask = queueService.addTask(createTaskOptions('build.zip'));
    completedTask.start();
    completedTask.complete();

    const failedTask = queueService.addTask(createTaskOptions('broken-sync.txt', 'download'));
    failedTask.start();
    failedTask.fail('checksum mismatch');

    // Simulate queue update events like extension.ts listener chain
    (queueService as any)._onTaskUpdated.fire(completedTask);
    (queueService as any)._onTaskUpdated.fire(failedTask);

    // Wait for async history persistence
    await new Promise(resolve => setTimeout(resolve, 0));

    const history = historyService.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe(failedTask.id);
    expect(history[1].id).toBe(completedTask.id);

    const stored = globalStateStore.get('simple-sftp.transferHistory');
    expect(Array.isArray(stored)).toBe(true);
    expect((stored as unknown[]).length).toBe(2);

    historyService.dispose();
    (TransferHistoryService as any).instance = undefined;
    historyService = TransferHistoryService.initialize(context);

    expect(historyService.getHistory()).toHaveLength(2);

    bridgeDisposable.dispose();
  });

  it('should open selected history task details from quick pick', async () => {
    const completedTask = queueService.addTask(createTaskOptions('history-item.txt'));
    completedTask.start();
    completedTask.complete();
    await historyService.addToHistory(completedTask);

    const detailsSpy = vi.spyOn(commands, 'showTaskDetails').mockResolvedValue();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ task: completedTask } as any);

    await commands.viewHistory();

    expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
    expect(detailsSpy).toHaveBeenCalledWith(completedTask);
  });

  it('should clear persisted history after user confirmation', async () => {
    const completedTask = queueService.addTask(createTaskOptions('clear-history.txt'));
    completedTask.start();
    completedTask.complete();
    await historyService.addToHistory(completedTask);

    expect(historyService.getHistory()).toHaveLength(1);

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Clear' as any);
    await commands.clearHistory();

    expect(historyService.getHistory()).toHaveLength(0);
    expect(globalStateStore.get('simple-sftp.transferHistory')).toEqual([]);
  });
});
