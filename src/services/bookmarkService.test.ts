import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookmarkService } from './bookmarkService';
import { HostManager } from '../hostManager';
import { AuthManager } from '../authManager';
import { HostTreeProvider } from '../hostTreeProvider';
import { HostConfig, HostAuthConfig } from '../types';
import * as vscode from 'vscode';

describe('BookmarkService', () => {
  let bookmarkService: BookmarkService;
  let mockHostManager: any;
  let mockAuthManager: any;
  let mockTreeProvider: any;
  let mockBrowseCallback: any;

  beforeEach(() => {
    // Mock HostManager
    mockHostManager = {
      getHosts: vi.fn().mockResolvedValue([]),
      addBookmark: vi.fn().mockResolvedValue(undefined),
      removeBookmark: vi.fn().mockResolvedValue(undefined),
      updateBookmark: vi.fn().mockResolvedValue(undefined)
    };

    // Mock AuthManager
    mockAuthManager = {
      getAuth: vi.fn()
    };

    // Mock TreeProvider
    mockTreeProvider = {
      refresh: vi.fn()
    };

    // Mock browse callback
    mockBrowseCallback = vi.fn();

    bookmarkService = new BookmarkService(
      mockHostManager,
      mockAuthManager,
      mockTreeProvider,
      mockBrowseCallback
    );

    // Clear all spy history
    vi.clearAllMocks();
  });

  describe('addBookmark', () => {
    it('should show warning when item is not a host', async () => {
      const showWarningSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

      const groupItem: any = {
        type: 'group',
        data: { id: 'group1', name: 'Group1' }
      };

      await bookmarkService.addBookmark(groupItem);

      expect(showWarningSpy).toHaveBeenCalledWith('Please select a host');
    });

    it('should show warning when auth is not configured', async () => {
      const showWarningSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);
      mockAuthManager.getAuth.mockResolvedValue(null);

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' } as HostConfig
      };

      await bookmarkService.addBookmark(hostItem);

      expect(showWarningSpy).toHaveBeenCalledWith('No authentication configured for Test Host');
    });

    it('should not add bookmark when user cancels path selection', async () => {
      mockAuthManager.getAuth.mockResolvedValue({ password: 'test' } as HostAuthConfig);
      mockBrowseCallback.mockResolvedValue(undefined);

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' } as HostConfig
      };

      await bookmarkService.addBookmark(hostItem);

      expect(mockHostManager.addBookmark).not.toHaveBeenCalled();
    });

    it('should not add bookmark when user cancels name input', async () => {
      mockAuthManager.getAuth.mockResolvedValue({ password: 'test' } as HostAuthConfig);
      mockBrowseCallback.mockResolvedValue('/remote/path/folder');
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue(undefined);

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' } as HostConfig
      };

      await bookmarkService.addBookmark(hostItem);

      expect(mockHostManager.addBookmark).not.toHaveBeenCalled();
    });

    it('should add bookmark successfully', async () => {
      mockAuthManager.getAuth.mockResolvedValue({ password: 'test' } as HostAuthConfig);
      mockBrowseCallback.mockResolvedValue('/remote/path/projects');
      vi.spyOn(vscode.window, 'showInputBox')
        .mockResolvedValueOnce('My Projects') // First call for name
        .mockResolvedValueOnce('Project description'); // Second call for description
      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' } as HostConfig
      };

      await bookmarkService.addBookmark(hostItem);

      expect(mockHostManager.addBookmark).toHaveBeenCalledWith('host1', 'My Projects', '/remote/path/projects', 'Project description');
      expect(mockTreeProvider.refresh).toHaveBeenCalled();
    });

    it('should handle errors when adding bookmark', async () => {
      const showErrorSpy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
      mockAuthManager.getAuth.mockResolvedValue({ password: 'test' } as HostAuthConfig);
      mockBrowseCallback.mockResolvedValue('/remote/path');
      vi.spyOn(vscode.window, 'showInputBox')
        .mockResolvedValueOnce('Test Bookmark')
        .mockResolvedValueOnce('Test description');
      mockHostManager.addBookmark.mockRejectedValue(new Error('Test error'));

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' } as HostConfig
      };

      await bookmarkService.addBookmark(hostItem);

      expect(showErrorSpy).toHaveBeenCalled();
      expect(showErrorSpy.mock.calls[0][0]).toContain('Failed to add bookmark');
    });
  });

  describe('deleteBookmark', () => {
    it('should show warning when item is not a bookmark', async () => {
      const showWarningSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host' }
      };

      await bookmarkService.deleteBookmark(hostItem);

      expect(showWarningSpy).toHaveBeenCalledWith('Please select a bookmark');
    });

    it('should return early when hostId is missing', async () => {
      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' }
      };

      await bookmarkService.deleteBookmark(bookmarkItem);

      expect(mockHostManager.removeBookmark).not.toHaveBeenCalled();
    });

    it('should not delete when user cancels confirmation', async () => {
      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.deleteBookmark(bookmarkItem);

      expect(mockHostManager.removeBookmark).not.toHaveBeenCalled();
    });

    it('should delete bookmark when user confirms', async () => {
      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Delete' as any);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.deleteBookmark(bookmarkItem);

      expect(mockHostManager.removeBookmark).toHaveBeenCalledWith('host1', 'Test Bookmark');
      expect(mockTreeProvider.refresh).toHaveBeenCalled();
    });
  });

  describe('renameBookmark', () => {
    it('should show warning when item is not a bookmark', async () => {
      const showWarningSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host' }
      };

      await bookmarkService.renameBookmark(hostItem);

      expect(showWarningSpy).toHaveBeenCalledWith('Please select a bookmark');
    });

    it('should return early when hostId is missing', async () => {
      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' }
      };

      await bookmarkService.renameBookmark(bookmarkItem);

      expect(mockHostManager.updateBookmark).not.toHaveBeenCalled();
    });

    it('should not rename when user cancels input', async () => {
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue(undefined);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.renameBookmark(bookmarkItem);

      expect(mockHostManager.updateBookmark).not.toHaveBeenCalled();
    });

    it('should not rename when new name is same as old name', async () => {
      vi.spyOn(vscode.window, 'showInputBox')
        .mockResolvedValueOnce('Test Bookmark') // name unchanged
        .mockResolvedValueOnce(''); // description unchanged (empty)

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.renameBookmark(bookmarkItem);

      expect(mockHostManager.updateBookmark).not.toHaveBeenCalled();
    });

    it('should rename bookmark successfully', async () => {
      vi.spyOn(vscode.window, 'showInputBox')
        .mockResolvedValueOnce('New Bookmark Name')
        .mockResolvedValueOnce('New description');

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Old Bookmark Name', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.renameBookmark(bookmarkItem);

      expect(mockHostManager.updateBookmark).toHaveBeenCalledWith(
        'host1',
        'Old Bookmark Name',
        'New Bookmark Name',
        '/remote/path',
        'New description'
      );
      expect(mockTreeProvider.refresh).toHaveBeenCalled();
    });

    it('should handle errors when renaming bookmark', async () => {
      const showErrorSpy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('New Name');
      mockHostManager.updateBookmark.mockRejectedValue(new Error('Update failed'));

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Old Name', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.renameBookmark(bookmarkItem);

      expect(showErrorSpy).toHaveBeenCalled();
      expect(showErrorSpy.mock.calls[0][0]).toContain('Failed to update bookmark');
    });
  });

  describe('browseBookmark', () => {
    it('should show warning when item is not a bookmark', async () => {
      const showWarningSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host' }
      };

      await bookmarkService.browseBookmark(hostItem);

      expect(showWarningSpy).toHaveBeenCalledWith('Please select a bookmark');
    });

    it('should return early when hostId is missing', async () => {
      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' }
      };

      await bookmarkService.browseBookmark(bookmarkItem);

      expect(mockBrowseCallback).not.toHaveBeenCalled();
    });

    it('should show warning when host is not found', async () => {
      const showWarningSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);
      mockHostManager.getHosts.mockResolvedValue([]);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.browseBookmark(bookmarkItem);

      expect(showWarningSpy).toHaveBeenCalledWith('Host not found');
    });

    it('should show warning when auth is not configured', async () => {
      const showWarningSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);
      const testHost = { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' };
      mockHostManager.getHosts.mockResolvedValue([testHost]);
      mockAuthManager.getAuth.mockResolvedValue(null);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.browseBookmark(bookmarkItem);

      expect(showWarningSpy).toHaveBeenCalledWith('No authentication configured for Test Host');
    });

    it('should browse bookmark successfully', async () => {
      const testHost = { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' };
      const testAuth = { password: 'test' } as HostAuthConfig;
      mockHostManager.getHosts.mockResolvedValue([testHost]);
      mockAuthManager.getAuth.mockResolvedValue(testAuth);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'My Projects', path: '/remote/projects' },
        hostId: 'host1'
      };

      await bookmarkService.browseBookmark(bookmarkItem);

      expect(mockBrowseCallback).toHaveBeenCalledWith(
        testHost,
        testAuth,
        'sync',
        'Browse: My Projects',
        '/remote/projects'
      );
    });
  });
});
