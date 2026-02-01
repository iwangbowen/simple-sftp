import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookmarkService } from './bookmarkService';
import { HostAuthConfig } from '../types';
import * as vscode from 'vscode';

describe('BookmarkService - changeBookmarkColor', () => {
  let bookmarkService: BookmarkService;
  let mockHostManager: any;
  let mockAuthManager: any;
  let mockTreeProvider: any;
  let mockBrowseCallback: any;

  beforeEach(() => {
    // Mock HostManager
    mockHostManager = {
      getHosts: vi.fn().mockResolvedValue([]),
      updateBookmarkColor: vi.fn().mockResolvedValue(undefined)
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

  describe('changeBookmarkColor', () => {
    it('should show warning when item is not a bookmark', async () => {
      const showWarningSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

      const hostItem: any = {
        type: 'host',
        data: { id: 'host1', name: 'Test Host' }
      };

      await bookmarkService.changeBookmarkColor(hostItem);

      expect(showWarningSpy).toHaveBeenCalledWith('Please select a bookmark');
      expect(mockHostManager.updateBookmarkColor).not.toHaveBeenCalled();
    });

    it('should return early when hostId is missing', async () => {
      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' }
      };

      await bookmarkService.changeBookmarkColor(bookmarkItem);

      expect(mockHostManager.updateBookmarkColor).not.toHaveBeenCalled();
    });

    it('should not change color when user cancels quick pick', async () => {
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.changeBookmarkColor(bookmarkItem);

      expect(mockHostManager.updateBookmarkColor).not.toHaveBeenCalled();
      expect(mockTreeProvider.refresh).not.toHaveBeenCalled();
    });

    it('should update bookmark color to red', async () => {
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '🔴 Red', value: 'red' } as any);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.changeBookmarkColor(bookmarkItem);

      expect(mockHostManager.updateBookmarkColor).toHaveBeenCalledWith('host1', 'Test Bookmark', 'red');
      expect(mockTreeProvider.refresh).toHaveBeenCalled();
    });

    it('should update bookmark color to green', async () => {
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '🟢 Green', value: 'green' } as any);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.changeBookmarkColor(bookmarkItem);

      expect(mockHostManager.updateBookmarkColor).toHaveBeenCalledWith('host1', 'Test Bookmark', 'green');
      expect(mockTreeProvider.refresh).toHaveBeenCalled();
    });

    it('should clear bookmark color when default is selected', async () => {
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '⚫ Default (No color)', value: undefined } as any);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path', color: 'red' },
        hostId: 'host1'
      };

      await bookmarkService.changeBookmarkColor(bookmarkItem);

      expect(mockHostManager.updateBookmarkColor).toHaveBeenCalledWith('host1', 'Test Bookmark', undefined);
      expect(mockTreeProvider.refresh).toHaveBeenCalled();
    });

    it('should not update when same color is selected', async () => {
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '🔴 Red', value: 'red' } as any);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path', color: 'red' },
        hostId: 'host1'
      };

      await bookmarkService.changeBookmarkColor(bookmarkItem);

      expect(mockHostManager.updateBookmarkColor).not.toHaveBeenCalled();
      expect(mockTreeProvider.refresh).not.toHaveBeenCalled();
    });

    it('should handle errors when updating color', async () => {
      const showErrorSpy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
      vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '🔴 Red', value: 'red' } as any);
      mockHostManager.updateBookmarkColor.mockRejectedValue(new Error('Test error'));

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.changeBookmarkColor(bookmarkItem);

      expect(showErrorSpy).toHaveBeenCalled();
      expect(showErrorSpy.mock.calls[0][0]).toContain('Failed to change bookmark color');
    });

    it('should show all available colors in quick pick', async () => {
      const showQuickPickSpy = vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.changeBookmarkColor(bookmarkItem);

      expect(showQuickPickSpy).toHaveBeenCalled();
      const colors = showQuickPickSpy.mock.calls[0][0] as any[];
      expect(colors).toHaveLength(7); // red, green, blue, yellow, orange, purple, default
      expect(colors.map((c: any) => c.value)).toEqual(['red', 'green', 'blue', 'yellow', 'orange', 'purple', undefined]);
    });

    it('should display current color in placeholder', async () => {
      const showQuickPickSpy = vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path', color: 'blue' },
        hostId: 'host1'
      };

      await bookmarkService.changeBookmarkColor(bookmarkItem);

      expect(showQuickPickSpy).toHaveBeenCalled();
      const options = showQuickPickSpy.mock.calls[0][1] as any;
      expect(options.placeHolder).toContain('🔵 Blue');
    });

    it('should display default in placeholder when no color is set', async () => {
      const showQuickPickSpy = vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);

      const bookmarkItem: any = {
        type: 'bookmark',
        data: { name: 'Test Bookmark', path: '/remote/path' },
        hostId: 'host1'
      };

      await bookmarkService.changeBookmarkColor(bookmarkItem);

      expect(showQuickPickSpy).toHaveBeenCalled();
      const options = showQuickPickSpy.mock.calls[0][1] as any;
      expect(options.placeHolder).toContain('Default (No color)');
    });
  });
});
