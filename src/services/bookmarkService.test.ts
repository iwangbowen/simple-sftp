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
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('My Projects');
      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' } as HostConfig
      };

      await bookmarkService.addBookmark(hostItem);

      expect(mockHostManager.addBookmark).toHaveBeenCalledWith('host1', 'My Projects', '/remote/path/projects');
      expect(mockTreeProvider.refresh).toHaveBeenCalled();
    });

    it('should handle errors when adding bookmark', async () => {
      const showErrorSpy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
      mockAuthManager.getAuth.mockResolvedValue({ password: 'test' } as HostAuthConfig);
      mockBrowseCallback.mockResolvedValue('/remote/path');
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('Test Bookmark');
      mockHostManager.addBookmark.mockRejectedValue(new Error('Test error'));

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' } as HostConfig
      };

      await bookmarkService.addBookmark(hostItem);

      expect(showErrorSpy).toHaveBeenCalled();
      expect(showErrorSpy.mock.calls[0][0]).toContain('Failed to add bookmark');
    });

    it('should trim whitespace from bookmark name before adding', async () => {
      mockAuthManager.getAuth.mockResolvedValue({ password: 'test' } as HostAuthConfig);
      mockBrowseCallback.mockResolvedValue('/remote/path');
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('  Spaced Name  ');

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' } as HostConfig
      };

      await bookmarkService.addBookmark(hostItem);

      expect(mockHostManager.addBookmark).toHaveBeenCalledWith('host1', 'Spaced Name', '/remote/path');
    });

    it('should handle paths with special characters', async () => {
      mockAuthManager.getAuth.mockResolvedValue({ password: 'test' } as HostAuthConfig);
      mockBrowseCallback.mockResolvedValue('/remote/path/with spaces/[brackets]/and-dashes');
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('Special Path');

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' } as HostConfig
      };

      await bookmarkService.addBookmark(hostItem);

      expect(mockHostManager.addBookmark).toHaveBeenCalledWith('host1', 'Special Path', '/remote/path/with spaces/[brackets]/and-dashes');
    });

    it('should handle very long bookmark names', async () => {
      const longName = 'A'.repeat(200);
      mockAuthManager.getAuth.mockResolvedValue({ password: 'test' } as HostAuthConfig);
      mockBrowseCallback.mockResolvedValue('/remote/path');
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue(longName);

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' } as HostConfig
      };

      await bookmarkService.addBookmark(hostItem);

      expect(mockHostManager.addBookmark).toHaveBeenCalledWith('host1', longName, '/remote/path');
    });

    it('should handle paths with unicode characters', async () => {
      mockAuthManager.getAuth.mockResolvedValue({ password: 'test' } as HostAuthConfig);
      mockBrowseCallback.mockResolvedValue('/remote/项目/文件夹/日本語');
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('Unicode Path');

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' } as HostConfig
      };

      await bookmarkService.addBookmark(hostItem);

      expect(mockHostManager.addBookmark).toHaveBeenCalledWith('host1', 'Unicode Path', '/remote/项目/文件夹/日本語');
    });

    it('should handle special characters in bookmark name', async () => {
      mockAuthManager.getAuth.mockResolvedValue({ password: 'test' } as HostAuthConfig);
      mockBrowseCallback.mockResolvedValue('/remote/path');
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('Test-Bookmark_2023 (v1)');

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host', host: '192.168.1.1', port: 22, username: 'user' } as HostConfig
      };

      await bookmarkService.addBookmark(hostItem);

      expect(mockHostManager.addBookmark).toHaveBeenCalledWith('host1', 'Test-Bookmark_2023 (v1)', '/remote/path');
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
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('Test Bookmark');

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.renameBookmark(bookmarkItem);

      expect(mockHostManager.updateBookmark).not.toHaveBeenCalled();
    });

    it('should rename bookmark successfully', async () => {
      vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('New Bookmark Name');

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
        undefined
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
      expect(showErrorSpy.mock.calls[0][0]).toContain('Failed to rename bookmark');
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

  describe('editBookmarkDescription', () => {
    it('should show warning if not a bookmark', async () => {
      const hostItem: any = {
        type: 'host',
        data: {},
        hostId: 'host1'
      };

      await bookmarkService.editBookmarkDescription(hostItem);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Please select a bookmark');
      expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    });

    it('should update description when user enters new text', async () => {
      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'My Projects', path: '/remote/projects', description: 'Old description' },
        hostId: 'host1'
      };

      (vscode.window.showInputBox as any).mockResolvedValue('New description');

      await bookmarkService.editBookmarkDescription(bookmarkItem);

      expect(mockHostManager.updateBookmark).toHaveBeenCalledWith(
        'host1',
        'My Projects',
        'My Projects',
        '/remote/projects',
        'New description'
      );
      expect(mockTreeProvider.refresh).toHaveBeenCalled();
    });

    it('should clear description when user enters empty string', async () => {
      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'My Projects', path: '/remote/projects', description: 'Old description' },
        hostId: 'host1'
      };

      (vscode.window.showInputBox as any).mockResolvedValue('   '); // Empty with spaces

      await bookmarkService.editBookmarkDescription(bookmarkItem);

      expect(mockHostManager.updateBookmark).toHaveBeenCalledWith(
        'host1',
        'My Projects',
        'My Projects',
        '/remote/projects',
        undefined // Description is cleared
      );
      expect(mockTreeProvider.refresh).toHaveBeenCalled();
    });

    it('should not update if user cancels input', async () => {
      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'My Projects', path: '/remote/projects', description: 'Old description' },
        hostId: 'host1'
      };

      (vscode.window.showInputBox as any).mockResolvedValue(undefined); // User cancelled

      await bookmarkService.editBookmarkDescription(bookmarkItem);

      expect(mockHostManager.updateBookmark).not.toHaveBeenCalled();
      expect(mockTreeProvider.refresh).not.toHaveBeenCalled();
    });

    it('should not update if description has not changed', async () => {
      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'My Projects', path: '/remote/projects', description: 'Same description' },
        hostId: 'host1'
      };

      (vscode.window.showInputBox as any).mockResolvedValue('Same description');

      await bookmarkService.editBookmarkDescription(bookmarkItem);

      expect(mockHostManager.updateBookmark).not.toHaveBeenCalled();
      expect(mockTreeProvider.refresh).not.toHaveBeenCalled();
    });

    it('should return early if hostId is missing', async () => {
      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'My Projects', path: '/remote/projects' }
        // No hostId
      };

      await bookmarkService.editBookmarkDescription(bookmarkItem);

      expect(vscode.window.showInputBox).not.toHaveBeenCalled();
      expect(mockHostManager.updateBookmark).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle bookmark with empty name', async () => {
      const mockHost: any = {
        id: 'host1',
        name: 'Test Host',
        host: 'example.com',
        bookmarks: []
      };

      mockHostManager.getHosts.mockResolvedValue([mockHost]);
      (vscode.window.showInputBox as any)
        .mockResolvedValueOnce('/remote/path')
        .mockResolvedValueOnce(''); // Empty name

      await bookmarkService.addBookmark({ type: 'host', data: mockHost } as any);

      expect(mockHostManager.addBookmark).not.toHaveBeenCalled();
    });

    it('should handle missing data property in bookmark item', async () => {
      const invalidItem: any = {
        type: 'bookmark'
        // Missing data property
      };

      await bookmarkService.deleteBookmark(invalidItem);

      expect(mockHostManager.removeBookmark).not.toHaveBeenCalled();
    });

    it('should handle edit description when hostManager update fails', async () => {
      const showErrorSpy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'My Projects', path: '/remote/projects' },
        hostId: 'host1'
      };

      (vscode.window.showInputBox as any).mockResolvedValue('New description');
      mockHostManager.updateBookmark.mockRejectedValue(new Error('Update failed'));

      await bookmarkService.editBookmarkDescription(bookmarkItem);

      expect(showErrorSpy).toHaveBeenCalled();
      expect(showErrorSpy.mock.calls[0][0]).toContain('Failed to update description');
    });

    it('should handle delete bookmark confirmation with unexpected response', async () => {
      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Cancel' as any);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.deleteBookmark(bookmarkItem);

      expect(mockHostManager.removeBookmark).not.toHaveBeenCalled();
    });


    it('should handle concurrent bookmark delete operations', async () => {
      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test', path: '/path' },
        hostId: 'host1'
      };

      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Delete' as any);
      mockHostManager.removeBookmark.mockResolvedValue(undefined);

      // Simulate concurrent delete operations
      const promise1 = bookmarkService.deleteBookmark(bookmarkItem);
      const promise2 = bookmarkService.deleteBookmark(bookmarkItem);

      await Promise.all([promise1, promise2]);

      // Both should call removeBookmark (no race condition protection in service)
      expect(mockHostManager.removeBookmark).toHaveBeenCalledTimes(2);
    });
  });
});
