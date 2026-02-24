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

  const attachQueueHistoryBridge = () => {
    return queueService.onTaskUpdated((task) => {
      if (task.status === 'completed' || task.status === 'failed') {
        void historyService.addToHistory(task);
      }
    });
  };

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
    const bridgeDisposable = attachQueueHistoryBridge();

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

  it('should keep queue unchanged when user declines clearCompleted confirmation', async () => {
    const pendingTask = queueService.addTask(createTaskOptions('stays-pending.txt'));
    const completedTask = queueService.addTask(createTaskOptions('stays-completed.txt'));
    completedTask.start();
    completedTask.complete();

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('No' as any);
    await commands.clearCompleted();

    const allTasks = queueService.getAllTasks();
    expect(allTasks).toHaveLength(2);
    expect(allTasks.map(task => task.id)).toEqual(expect.arrayContaining([
      pendingTask.id,
      completedTask.id
    ]));
  });

  it('should keep history records after queue clearCompleted removes terminal queue items', async () => {
    const bridgeDisposable = attachQueueHistoryBridge();

    const pendingTask = queueService.addTask(createTaskOptions('keep-queue-pending.txt'));

    const completedTask = queueService.addTask(createTaskOptions('history-completed.txt'));
    completedTask.start();
    completedTask.complete();

    const failedTask = queueService.addTask(createTaskOptions('history-failed.txt', 'download'));
    failedTask.start();
    failedTask.fail('permission denied');

    (queueService as any)._onTaskUpdated.fire(completedTask);
    (queueService as any)._onTaskUpdated.fire(failedTask);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(historyService.getHistory()).toHaveLength(2);

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Yes' as any);
    await commands.clearCompleted();

    const queueIds = queueService.getAllTasks().map(task => task.id);
    expect(queueIds).toEqual([pendingTask.id]);

    const historyIds = historyService.getHistory().map(task => task.id);
    expect(historyIds).toEqual(expect.arrayContaining([completedTask.id, failedTask.id]));
    expect(historyIds).toHaveLength(2);

    bridgeDisposable.dispose();
  });

  it('should not add cancelled tasks to history through queue update bridge', async () => {
    const bridgeDisposable = attachQueueHistoryBridge();

    const cancelledTask = queueService.addTask(createTaskOptions('cancel-only.txt'));
    cancelledTask.start();
    cancelledTask.cancel();

    (queueService as any)._onTaskUpdated.fire(cancelledTask);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(historyService.getHistory()).toHaveLength(0);
    expect(globalStateStore.get('simple-sftp.transferHistory')).toBeUndefined();

    bridgeDisposable.dispose();
  });

  it('should remove selected history item via command and persist the updated history', async () => {
    const firstTask = queueService.addTask(createTaskOptions('history-first.txt'));
    firstTask.start();
    firstTask.complete();

    const secondTask = queueService.addTask(createTaskOptions('history-second.txt'));
    secondTask.start();
    secondTask.complete();

    await historyService.addToHistory(firstTask);
    await historyService.addToHistory(secondTask);
    expect(historyService.getHistory()).toHaveLength(2);

    await commands.removeHistoryTask({ task: firstTask });
    await new Promise(resolve => setTimeout(resolve, 0));

    const history = historyService.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(secondTask.id);

    const stored = globalStateStore.get('simple-sftp.transferHistory') as any[];
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(secondTask.id);
  });

  it('should clear all queue tasks via command confirmation', async () => {
    queueService.addTask(createTaskOptions('clear-all-pending.txt'));

    const runningTask = queueService.addTask(createTaskOptions('clear-all-running.txt'));
    runningTask.start();

    const pausedTask = queueService.addTask(createTaskOptions('clear-all-paused.txt'));
    pausedTask.start();
    pausedTask.pause();

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Yes' as any);
    await commands.clearAll();

    expect(queueService.getAllTasks()).toHaveLength(0);
    expect(queueService.getStats().total).toBe(0);
  });

  it('should keep queue tasks when user declines clearAll confirmation', async () => {
    const pendingTask = queueService.addTask(createTaskOptions('decline-clear-all.txt'));

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('No' as any);
    await commands.clearAll();

    const queueIds = queueService.getAllTasks().map(task => task.id);
    expect(queueIds).toEqual([pendingTask.id]);
  });

  it('should show queue empty message when clearAll is called on empty queue', async () => {
    await commands.clearAll();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Queue is empty');
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('should show no completed tasks message when clearCompleted has no terminal tasks', async () => {
    queueService.addTask(createTaskOptions('pending-only.txt'));

    await commands.clearCompleted();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No completed tasks to clear');
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('should keep a single history record when duplicate task update events are emitted', async () => {
    const bridgeDisposable = attachQueueHistoryBridge();

    const completedTask = queueService.addTask(createTaskOptions('duplicate-event.txt'));
    completedTask.start();
    completedTask.complete();

    (queueService as any)._onTaskUpdated.fire(completedTask);
    (queueService as any)._onTaskUpdated.fire(completedTask);
    (queueService as any)._onTaskUpdated.fire(completedTask);
    await new Promise(resolve => setTimeout(resolve, 0));

    const history = historyService.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(completedTask.id);

    const stored = globalStateStore.get('simple-sftp.transferHistory') as any[];
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(completedTask.id);

    bridgeDisposable.dispose();
  });

  it('should show empty-history message when viewHistory is called without records', async () => {
    await commands.viewHistory();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No transfer history');
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('should keep history when user declines clearHistory confirmation', async () => {
    const completedTask = queueService.addTask(createTaskOptions('keep-history-on-decline.txt'));
    completedTask.start();
    completedTask.complete();
    await historyService.addToHistory(completedTask);

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    await commands.clearHistory();

    expect(historyService.getHistory()).toHaveLength(1);
    const stored = globalStateStore.get('simple-sftp.transferHistory') as any[];
    expect(stored).toHaveLength(1);
  });

  it('should warn when removeHistoryTask is called without a selected task', async () => {
    await commands.removeHistoryTask();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('No task selected');
  });
});
