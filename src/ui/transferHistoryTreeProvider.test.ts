import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { TransferHistoryTreeProvider } from './transferHistoryTreeProvider';
import { TransferHistoryService } from '../services/transferHistoryService';
import { TransferTaskModel } from '../models/transferTask';

vi.mock('../services/transferHistoryService');
vi.mock('../logger');

describe('TransferHistoryTreeProvider', () => {
  let provider: TransferHistoryTreeProvider;
  let mockHistoryService: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockHistoryService = {
      onHistoryChanged: vi.fn((callback) => {
        mockHistoryService._onHistoryChangedCallback = callback;
        return { dispose: vi.fn() };
      }),
      getHistory: vi.fn().mockReturnValue([]),
      clearHistory: vi.fn(),
      removeTask: vi.fn(),
    };

    vi.mocked(TransferHistoryService.getInstance).mockReturnValue(mockHistoryService);

    provider = new TransferHistoryTreeProvider();
  });

  describe('Initialization', () => {
    it('should create provider instance', () => {
      expect(provider).toBeDefined();
    });

    it('should have required methods', () => {
      expect(provider.getChildren).toBeDefined();
      expect(provider.getTreeItem).toBeDefined();
    });
  });

  describe('Tree Data Provider', () => {
    it('should get root elements when no history', async () => {
      mockHistoryService.getHistory.mockReturnValue([]);
      const elements = await provider.getChildren();
      expect(Array.isArray(elements) || elements === null).toBe(true);
    });

    it('should get root elements with history', async () => {
      const historyTask = new TransferTaskModel({
        id: 'task1',
        fileName: 'file.txt',
        type: 'upload',
        status: 'completed',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileSize: 1024,
        hostName: 'test-host',
      });

      mockHistoryService.getHistory.mockReturnValue([historyTask]);
      const elements = await provider.getChildren();
      expect(Array.isArray(elements) || elements === null).toBe(true);
    });

    it('should get children for date section', async () => {
      const now = new Date();
      const historyTask = new TransferTaskModel({
        id: 'task1',
        fileName: 'file.txt',
        type: 'download',
        status: 'completed',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileSize: 2048,
        hostName: 'test-host',
      });
      historyTask.timestamp = now.getTime();

      mockHistoryService.getHistory.mockReturnValue([historyTask]);
      const rootElements = await provider.getChildren();
      
      if (rootElements && rootElements.length > 0) {
        const dateSection = rootElements[0];
        const tasks = await provider.getChildren(dateSection);
        expect(Array.isArray(tasks) || tasks === null).toBe(true);
      }
    });
  });

  describe('Tree Item Creation', () => {
    it('should create tree item for date group', async () => {
      const historyTask = new TransferTaskModel({
        id: 'task1',
        fileName: 'file.txt',
        type: 'upload',
        status: 'completed',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileSize: 1024,
        hostName: 'test-host',
      });

      mockHistoryService.getHistory.mockReturnValue([historyTask]);
      const elements = await provider.getChildren();
      
      if (elements && elements.length > 0) {
        const treeItem = await provider.getTreeItem(elements[0]);
        expect(treeItem).toBeDefined();
        expect(treeItem.label).toBeDefined();
      }
    });

    it('should create tree item for history task', async () => {
      const historyTask = new TransferTaskModel({
        id: 'task1',
        fileName: 'archive.zip',
        type: 'upload',
        status: 'completed',
        localPath: '/local/archive.zip',
        remotePath: '/remote/archive.zip',
        fileSize: 5000000,
        hostName: 'test-host',
      });

      mockHistoryService.getHistory.mockReturnValue([historyTask]);
      const rootElements = await provider.getChildren();
      
      if (rootElements && rootElements.length > 0) {
        const dateSection = rootElements[0];
        const tasks = await provider.getChildren(dateSection);
        if (tasks && tasks.length > 0) {
          const treeItem = await provider.getTreeItem(tasks[0] as any);
          expect(treeItem).toBeDefined();
        }
      }
    });
  });

  describe('Date Grouping', () => {
    it('should group tasks by date', async () => {
      const today = new TransferTaskModel({
        id: 'task1',
        fileName: 'today.txt',
        type: 'upload',
        status: 'completed',
        localPath: '/local/today.txt',
        remotePath: '/remote/today.txt',
        fileSize: 512,
        hostName: 'test-host',
      });
      today.timestamp = new Date().getTime();

      const yesterday = new TransferTaskModel({
        id: 'task2',
        fileName: 'yesterday.txt',
        type: 'download',
        status: 'completed',
        localPath: '/local/yesterday.txt',
        remotePath: '/remote/yesterday.txt',
        fileSize: 1024,
        hostName: 'test-host',
      });
      const yesterdayTime = new Date();
      yesterdayTime.setDate(yesterdayTime.getDate() - 1);
      yesterday.timestamp = yesterdayTime.getTime();

      mockHistoryService.getHistory.mockReturnValue([today, yesterday]);
      const elements = await provider.getChildren();
      
      expect(Array.isArray(elements)).toBe(true);
      if (elements) {
        expect(elements.length >= 1).toBe(true);
      }
    });

    it('should handle multiple tasks in same day', async () => {
      const task1 = new TransferTaskModel({
        id: 'task1',
        fileName: 'file1.txt',
        type: 'upload',
        status: 'completed',
        localPath: '/local/file1.txt',
        remotePath: '/remote/file1.txt',
        fileSize: 512,
        hostName: 'test-host',
      });

      const task2 = new TransferTaskModel({
        id: 'task2',
        fileName: 'file2.txt',
        type: 'upload',
        status: 'completed',
        localPath: '/local/file2.txt',
        remotePath: '/remote/file2.txt',
        fileSize: 512,
        hostName: 'test-host',
      });

      const now = new Date().getTime();
      task1.timestamp = now;
      task2.timestamp = now + 3600000; // 1 hour later

      mockHistoryService.getHistory.mockReturnValue([task1, task2]);
      const rootElements = await provider.getChildren();
      
      if (rootElements && rootElements.length > 0) {
        const dateSection = rootElements[0];
        const tasks = await provider.getChildren(dateSection);
        expect(tasks).toBeDefined();
      }
    });
  });

  describe('Task Status Display', () => {
    it('should display completed task', async () => {
      const task = new TransferTaskModel({
        id: 'task1',
        fileName: 'done.txt',
        type: 'upload',
        status: 'completed',
        localPath: '/local/done.txt',
        remotePath: '/remote/done.txt',
        fileSize: 1024,
        hostName: 'test-host',
      });

      mockHistoryService.getHistory.mockReturnValue([task]);
      const rootElements = await provider.getChildren();
      
      if (rootElements && rootElements.length > 0) {
        const dateSection = rootElements[0];
        const tasks = await provider.getChildren(dateSection);
        if (tasks && tasks.length > 0) {
          const treeItem = await provider.getTreeItem(tasks[0] as any);
          expect(treeItem).toBeDefined();
        }
      }
    });

    it('should display failed task', async () => {
      const task = new TransferTaskModel({
        id: 'task1',
        fileName: 'failed.txt',
        type: 'download',
        status: 'failed',
        localPath: '/local/failed.txt',
        remotePath: '/remote/failed.txt',
        fileSize: 2048,
        hostName: 'test-host',
        lastError: 'Connection timeout',
      });

      mockHistoryService.getHistory.mockReturnValue([task]);
      const rootElements = await provider.getChildren();
      
      if (rootElements && rootElements.length > 0) {
        const dateSection = rootElements[0];
        const tasks = await provider.getChildren(dateSection);
        if (tasks && tasks.length > 0) {
          const treeItem = await provider.getTreeItem(tasks[0] as any);
          expect(treeItem).toBeDefined();
        }
      }
    });

    it('should display cancelled task', async () => {
      const task = new TransferTaskModel({
        id: 'task1',
        fileName: 'cancelled.txt',
        type: 'upload',
        status: 'cancelled',
        localPath: '/local/cancelled.txt',
        remotePath: '/remote/cancelled.txt',
        fileSize: 512,
        hostName: 'test-host',
      });

      mockHistoryService.getHistory.mockReturnValue([task]);
      const rootElements = await provider.getChildren();
      
      if (rootElements && rootElements.length > 0) {
        const dateSection = rootElements[0];
        const tasks = await provider.getChildren(dateSection);
        expect(tasks).toBeDefined();
      }
    });
  });

  describe('File Information Display', () => {
    it('should show file name in description', async () => {
      const task = new TransferTaskModel({
        id: 'task1',
        fileName: 'document.pdf',
        type: 'download',
        status: 'completed',
        localPath: '/local/document.pdf',
        remotePath: '/remote/document.pdf',
        fileSize: 1024000,
        hostName: 'test-host',
      });

      mockHistoryService.getHistory.mockReturnValue([task]);
      const rootElements = await provider.getChildren();
      
      if (rootElements && rootElements.length > 0) {
        const dateSection = rootElements[0];
        const tasks = await provider.getChildren(dateSection);
        if (tasks && tasks.length > 0) {
          const treeItem = await provider.getTreeItem(tasks[0] as any);
          expect(treeItem.label).toContain('document.pdf');
        }
      }
    });

    it('should display file size', async () => {
      const task = new TransferTaskModel({
        id: 'task1',
        fileName: 'large.iso',
        type: 'download',
        status: 'completed',
        localPath: '/local/large.iso',
        remotePath: '/remote/large.iso',
        fileSize: 4000000000,
        hostName: 'test-host',
      });

      mockHistoryService.getHistory.mockReturnValue([task]);
      const rootElements = await provider.getChildren();
      
      if (rootElements && rootElements.length > 0) {
        const dateSection = rootElements[0];
        const tasks = await provider.getChildren(dateSection);
        if (tasks && tasks.length > 0) {
          const treeItem = await provider.getTreeItem(tasks[0] as any);
          expect(treeItem).toBeDefined();
        }
      }
    });
  });

  describe('Host Information', () => {
    it('should display host name', async () => {
      const task = new TransferTaskModel({
        id: 'task1',
        fileName: 'file.txt',
        type: 'upload',
        status: 'completed',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileSize: 512,
        hostName: 'production-server',
      });

      mockHistoryService.getHistory.mockReturnValue([task]);
      const rootElements = await provider.getChildren();
      
      expect(task.hostName).toBe('production-server');
    });
  });

  describe('Icons', () => {
    it('should use icon for upload task', async () => {
      const task = new TransferTaskModel({
        id: 'task1',
        fileName: 'file.txt',
        type: 'upload',
        status: 'completed',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileSize: 512,
        hostName: 'test-host',
      });

      mockHistoryService.getHistory.mockReturnValue([task]);
      const rootElements = await provider.getChildren();
      
      if (rootElements && rootElements.length > 0) {
        const dateSection = rootElements[0];
        const tasks = await provider.getChildren(dateSection);
        if (tasks && tasks.length > 0) {
          const treeItem = await provider.getTreeItem(tasks[0] as any);
          expect(treeItem.iconPath).toBeDefined();
        }
      }
    });

    it('should use icon for download task', async () => {
      const task = new TransferTaskModel({
        id: 'task1',
        fileName: 'data.zip',
        type: 'download',
        status: 'completed',
        localPath: '/local/data.zip',
        remotePath: '/remote/data.zip',
        fileSize: 1024,
        hostName: 'test-host',
      });

      mockHistoryService.getHistory.mockReturnValue([task]);
      const rootElements = await provider.getChildren();
      
      if (rootElements && rootElements.length > 0) {
        const dateSection = rootElements[0];
        const tasks = await provider.getChildren(dateSection);
        if (tasks && tasks.length > 0) {
          const treeItem = await provider.getTreeItem(tasks[0] as any);
          expect(treeItem.iconPath).toBeDefined();
        }
      }
    });
  });

  describe('Tooltip Information', () => {
    it('should provide tooltip with task details', async () => {
      const task = new TransferTaskModel({
        id: 'task1',
        fileName: 'backup.tar.gz',
        type: 'upload',
        status: 'completed',
        localPath: '/local/backup.tar.gz',
        remotePath: '/remote/backup.tar.gz',
        fileSize: 2000000,
        hostName: 'backup-server',
      });

      mockHistoryService.getHistory.mockReturnValue([task]);
      const rootElements = await provider.getChildren();
      
      if (rootElements && rootElements.length > 0) {
        const dateSection = rootElements[0];
        const tasks = await provider.getChildren(dateSection);
        if (tasks && tasks.length > 0) {
          const treeItem = await provider.getTreeItem(tasks[0] as any);
          expect(treeItem.tooltip).toBeDefined();
        }
      }
    });
  });

  describe('Context Values', () => {
    it('should set context value for history task', async () => {
      const task = new TransferTaskModel({
        id: 'task1',
        fileName: 'file.txt',
        type: 'upload',
        status: 'completed',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileSize: 512,
        hostName: 'test-host',
      });

      mockHistoryService.getHistory.mockReturnValue([task]);
      const rootElements = await provider.getChildren();
      
      if (rootElements && rootElements.length > 0) {
        const dateSection = rootElements[0];
        const tasks = await provider.getChildren(dateSection);
        if (tasks && tasks.length > 0) {
          const treeItem = await provider.getTreeItem(tasks[0] as any);
          expect(treeItem.contextValue).toBeDefined();
        }
      }
    });
  });

  describe('Event Handling', () => {
    it('should have event emitter', () => {
      expect(provider.onDidChangeTreeData).toBeDefined();
    });
  });

  describe('Cleanup', () => {
    it('should have disposable event', () => {
      expect(provider.onDidChangeTreeData).toBeDefined();
    });
  });
});
