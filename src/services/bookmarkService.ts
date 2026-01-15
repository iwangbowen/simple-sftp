import * as vscode from 'vscode';
import * as path from 'path';
import { HostManager } from '../hostManager';
import { AuthManager } from '../authManager';
import { HostTreeProvider, HostTreeItem } from '../hostTreeProvider';
import { HostConfig, HostAuthConfig, PathBookmark } from '../types';

/**
 * Service for managing path bookmarks for hosts
 */
export class BookmarkService {
  constructor(
    private readonly hostManager: HostManager,
    private readonly authManager: AuthManager,
    private readonly treeProvider: HostTreeProvider,
    private readonly browseRemoteFilesCallback: (
      host: HostConfig,
      authConfig: HostAuthConfig,
      mode: 'selectPath' | 'browseFiles' | 'selectBookmark' | 'sync',
      title: string,
      initialPath?: string
    ) => Promise<string | { path: string; isDirectory: boolean } | undefined>
  ) {}

  /**
   * Add a bookmark for a host
   */
  async addBookmark(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {
      vscode.window.showWarningMessage('Please select a host');
      return;
    }

    const host = item.data as HostConfig;

    // Check authentication
    const authConfig = await this.authManager.getAuth(host.id);
    if (!authConfig) {
      vscode.window.showWarningMessage(`No authentication configured for ${host.name}`);
      return;
    }

    // Browse for remote path
    const result = await this.browseRemoteFilesCallback(
      host,
      authConfig,
      'selectBookmark',
      'Select Directory to Bookmark'
    );

    if (!result || typeof result !== 'string') {
      return;
    }

    const remotePath = result;

    // Get folder name as default bookmark name
    const folderName = path.basename(remotePath);

    // Ask for bookmark name
    const name = await vscode.window.showInputBox({
      prompt: 'Enter bookmark name',
      value: folderName, // Default to folder name
      placeHolder: 'e.g., Project Files',
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return 'Bookmark name cannot be empty';
        }
        return null;
      }
    });

    if (!name) {
      return;
    }

    try {
      await this.hostManager.addBookmark(host.id, name.trim(), remotePath);
      this.treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to add bookmark: ${error}`);
    }
  }

  /**
   * Delete a bookmark
   */
  async deleteBookmark(item: HostTreeItem): Promise<void> {
    if (item.type !== 'bookmark') {
      vscode.window.showWarningMessage('Please select a bookmark');
      return;
    }

    const bookmark = item.data as PathBookmark;
    const hostId = item.hostId;

    if (!hostId) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Delete bookmark '${bookmark.name}'?`,
      { modal: true },
      'Delete'
    );

    if (confirm !== 'Delete') {
      return;
    }

    await this.hostManager.removeBookmark(hostId, bookmark.name);
    this.treeProvider.refresh();
  }

  /**
   * Rename a bookmark
   */
  async renameBookmark(item: HostTreeItem): Promise<void> {
    if (item.type !== 'bookmark') {
      vscode.window.showWarningMessage('Please select a bookmark');
      return;
    }

    const bookmark = item.data as PathBookmark;
    const hostId = item.hostId;

    if (!hostId) {
      return;
    }

    const newName = await vscode.window.showInputBox({
      prompt: 'Enter new bookmark name',
      value: bookmark.name,
      placeHolder: 'e.g., Project Files',
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return 'Bookmark name cannot be empty';
        }
        return null;
      }
    });

    if (!newName || newName.trim() === bookmark.name) {
      return; // User cancelled or name unchanged
    }

    try {
      await this.hostManager.updateBookmark(hostId, bookmark.name, newName.trim(), bookmark.path, bookmark.description);
      this.treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to rename bookmark: ${error}`);
    }
  }

  /**
   * Edit bookmark description
   */
  async editBookmarkDescription(item: HostTreeItem): Promise<void> {
    if (item.type !== 'bookmark') {
      vscode.window.showWarningMessage('Please select a bookmark');
      return;
    }

    const bookmark = item.data as PathBookmark;
    const hostId = item.hostId;

    if (!hostId) {
      return;
    }

    const newDescription = await vscode.window.showInputBox({
      prompt: 'Enter bookmark description (optional)',
      value: bookmark.description || '',
      placeHolder: 'e.g., Main project source code directory',
    });

    // User cancelled or no change
    if (newDescription === undefined || newDescription.trim() === (bookmark.description || '')) {
      return;
    }

    try {
      await this.hostManager.updateBookmark(hostId, bookmark.name, bookmark.name, bookmark.path, newDescription.trim() || undefined);
      this.treeProvider.refresh();
      vscode.window.showInformationMessage(`Description updated for bookmark: ${bookmark.name}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update description: ${error}`);
    }
  }

  /**
   * Browse files from a bookmark
   */
  async browseBookmark(item: HostTreeItem): Promise<void> {
    if (item.type !== 'bookmark') {
      vscode.window.showWarningMessage('Please select a bookmark');
      return;
    }

    const bookmark = item.data as PathBookmark;
    const hostId = item.hostId;

    if (!hostId) {
      return;
    }

    // Get host config
    const hosts = await this.hostManager.getHosts();
    const host = hosts.find(h => h.id === hostId);

    if (!host) {
      vscode.window.showWarningMessage('Host not found');
      return;
    }

    // Check authentication
    const authConfig = await this.authManager.getAuth(host.id);
    if (!authConfig) {
      vscode.window.showWarningMessage(`No authentication configured for ${host.name}`);
      return;
    }

    // Browse from bookmark path using sync mode (allows both upload and download)
    // Pass bookmark path as initial path, do not record it to recent paths
    await this.browseRemoteFilesCallback(
      host,
      authConfig,
      'sync',
      `Browse: ${bookmark.name}`,
      bookmark.path  // Use bookmark path as initial path
    );
  }
}
