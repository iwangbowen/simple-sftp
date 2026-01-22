import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { HostConfig } from '../types';
import { SshConnectionManager } from '../sshConnectionManager';
import { TransferQueueService } from '../services/transferQueueService';
import { AuthManager } from '../authManager';
import { HostManager } from '../hostManager';
import { logger } from '../logger';

export interface FileNode {
    name: string;
    path: string;
    isDirectory: boolean;
    size?: number;
    modifiedTime?: Date;
    mode?: number;
    permissions?: string;
    owner?: number;
    group?: number;
    expanded?: boolean;
    children?: FileNode[];
}

/**
 * Base class for dual panel file browser functionality
 * Provides shared logic for both panel and editor implementations
 */
export abstract class DualPanelBase {
    protected _currentHost?: HostConfig;
    protected _currentAuthConfig?: any;
    protected _localRootPath?: string;
    protected _remoteRootPath?: string;

    constructor(
        protected readonly _extensionUri: vscode.Uri,
        protected readonly transferQueueService: TransferQueueService,
        protected readonly authManager: AuthManager,
        protected readonly hostManager: HostManager
    ) {
        // Subscribe to task completion events
        this.transferQueueService.onTaskUpdated((task) => {
            if (task.type === 'upload' && task.status === 'completed') {
                this.handleUploadCompleted(task);
            } else if (task.type === 'download' && task.status === 'completed') {
                this.handleDownloadCompleted(task);
            }
        });
    }

    /**
     * Abstract method to post message to webview (implemented differently for panel and editor)
     */
    protected abstract postMessage(message: any): void;

    /**
     * Abstract method to get webview (implemented differently for panel and editor)
     */
    protected abstract getWebview(): vscode.Webview | undefined;

    /**
     * Open dual panel for a specific host
     */
    public async openForHost(host: HostConfig, initialPath?: string): Promise<void> {
        this._currentHost = host;
        this._currentAuthConfig = await this.authManager.getAuth(host.id);

        if (!this._currentAuthConfig) {
            const choice = await vscode.window.showWarningMessage(
                `No authentication configured for ${host.name}`,
                { modal: false },
                'Configure Authentication'
            );

            if (choice === 'Configure Authentication') {
                await vscode.commands.executeCommand('simpleSftp.configureAuth', { data: host, type: 'host' });
            }
            return;
        }

        this._remoteRootPath = initialPath || host.defaultRemotePath || '/';

        const workspaceFolders = vscode.workspace.workspaceFolders;
        this._localRootPath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '/';

        await this.loadLocalDirectory(this._localRootPath);

        this.postMessage({
            command: 'showRemoteLoading'
        });

        await this.loadRemoteDirectory(this._remoteRootPath);
    }

    /**
     * Handle messages from webview
     */
    protected async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'ready':
                if (this._currentHost && this._localRootPath && this._remoteRootPath) {
                    await this.loadLocalDirectory(this._localRootPath);
                    await this.loadRemoteDirectory(this._remoteRootPath);
                } else {
                    await this.showHostSelection();
                }
                break;

            case 'selectHost': {
                const hostId = message.hostId;
                const hosts = await this.hostManager.getHosts();
                const selectedHost = hosts.find(h => h.id === hostId);
                if (selectedHost) {
                    await this.openForHost(selectedHost);
                }
                break;
            }

            case 'openBookmark': {
                const bookmarkHostId = message.hostId;
                const bookmarkPath = message.path;
                const bookmarkHosts = await this.hostManager.getHosts();
                const bookmarkHost = bookmarkHosts.find(h => h.id === bookmarkHostId);
                if (bookmarkHost) {
                    await this.openForHost(bookmarkHost, bookmarkPath);
                }
                break;
            }

            case 'loadLocalDir':
                await this.loadLocalDirectory(message.path);
                break;

            case 'loadRemoteDir':
                await this.loadRemoteDirectory(message.path);
                break;

            case 'loadDirectory':
                if (message.panel === 'local') {
                    await this.loadLocalDirectory(message.path);
                } else if (message.panel === 'remote') {
                    await this.loadRemoteDirectory(message.path);
                }
                break;

            case 'upload':
                await this.handleUpload(message.data.localPath, message.data.remotePath);
                break;

            case 'download':
                await this.handleDownload(message.data.remotePath, message.data.localPath);
                break;

            case 'createFolder':
                await this.handleCreateFolder(message.data);
                break;

            case 'delete':
                await this.handleDelete(message.data);
                break;

            case 'batchDelete':
                await this.handleBatchDelete(message.data);
                break;

            case 'requestDeleteConfirmation':
                await this.handleRequestDeleteConfirmation(message.data);
                break;

            case 'showError':
                vscode.window.showErrorMessage(message.message);
                break;

            case 'rename':
                await this.handleRename(message.data);
                break;

            case 'openFile':
                await this.handleOpenFile(message.data);
                break;

            case 'refreshLocal': {
                const localPath = message.path || this._localRootPath;
                if (localPath) {
                    await this.loadLocalDirectory(localPath);
                }
                break;
            }

            case 'refreshRemote': {
                const remotePath = message.path || this._remoteRootPath;
                if (remotePath) {
                    await this.loadRemoteDirectory(remotePath);
                }
                break;
            }

            case 'backToHostSelection':
                this._currentHost = undefined;
                this._currentAuthConfig = undefined;
                this._localRootPath = undefined;
                this._remoteRootPath = undefined;
                await this.showHostSelection();
                break;

            case 'batchUpload':
                await this.handleBatchUpload(message.data);
                break;

            case 'batchDownload':
                await this.handleBatchDownload(message.data);
                break;

            case 'applyPermissions':
                await this.applyPermissions(message.data);
                break;

            case 'getBookmarks':
                await this.handleGetBookmarks();
                break;

            case 'addBookmark':
                await this.handleAddBookmark(message.data);
                break;
        }
    }

    // ===== Local File System Operations =====

    protected async loadLocalDirectory(dirPath: string): Promise<void> {
        try {
            this._localRootPath = dirPath;

            if (dirPath === 'drives://') {
                const drives = await this.listWindowsDrives();
                this.postMessage({
                    command: 'updateLocalTree',
                    data: {
                        path: 'drives://',
                        nodes: drives
                    }
                });
                return;
            }

            const nodes = await this.readLocalDirectory(dirPath);

            this.postMessage({
                command: 'updateLocalTree',
                data: {
                    path: dirPath,
                    nodes: nodes
                }
            });
        } catch (error) {
            logger.error(`Failed to load local directory: ${error}`);
            vscode.window.showErrorMessage(`Failed to load local directory: ${error}`);
        }
    }

    protected async readLocalDirectory(dirPath: string): Promise<FileNode[]> {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        const nodes: FileNode[] = [];

        for (const entry of entries) {
            if (entry.name.startsWith('.') && !this.shouldShowDotFiles()) {
                continue;
            }

            const fullPath = path.join(dirPath, entry.name);

            try {
                const stats = await fs.promises.stat(fullPath);

                // 将数字模式转换为字符串权限 (例如: 0o755 -> 'rwxr-xr-x')
                const mode = stats.mode;
                const permissions = this.formatModeToString(mode);

                nodes.push({
                    name: entry.name,
                    path: fullPath,
                    isDirectory: entry.isDirectory(),
                    size: entry.isFile() ? stats.size : undefined,
                    modifiedTime: stats.mtime,
                    mode: mode,
                    permissions: permissions,
                    expanded: false,
                    children: entry.isDirectory() ? [] : undefined
                });
            } catch (error) {
                logger.debug(`Skipping ${fullPath}: ${error}`);
                continue;
            }
        }

        return nodes.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) {
                return -1;
            }
            if (!a.isDirectory && b.isDirectory) {
                return 1;
            }
            return a.name.localeCompare(b.name);
        });
    }

    protected async listWindowsDrives(): Promise<FileNode[]> {
        const drives: FileNode[] = [];

        if (process.platform === 'win32') {
            for (let i = 65; i <= 90; i++) {
                const driveLetter = String.fromCodePoint(i);
                const drivePath = `${driveLetter}:\\`;

                try {
                    await fs.promises.access(drivePath);
                    drives.push({
                        name: `${driveLetter}:`,
                        path: drivePath,
                        isDirectory: true,
                        expanded: false,
                        children: []
                    });
                } catch {
                    // Drive doesn't exist or not accessible
                }
            }
        } else {
            drives.push({
                name: '/',
                path: '/',
                isDirectory: true,
                expanded: false,
                children: []
            });
        }

        return drives;
    }

    // ===== Remote File System Operations =====

    protected async loadRemoteDirectory(dirPath: string): Promise<void> {
        if (!this._currentHost || !this._currentAuthConfig) {
            vscode.window.showErrorMessage('No host selected or authentication not configured');
            return;
        }

        try {
            this._remoteRootPath = dirPath;

            const nodes = await this.readRemoteDirectory(this._currentHost, this._currentAuthConfig, dirPath);

            this.postMessage({
                command: 'updateRemoteTree',
                data: {
                    path: dirPath,
                    nodes: nodes
                }
            });
        } catch (error) {
            logger.error(`Failed to load remote directory: ${error}`);
            vscode.window.showErrorMessage(`Failed to load remote directory: ${error}`);
        }
    }

    protected async readRemoteDirectory(
        host: HostConfig,
        authConfig: any,
        dirPath: string
    ): Promise<FileNode[]> {
        const items = await SshConnectionManager.listRemoteFiles(host, authConfig, dirPath);

        const nodes: FileNode[] = items.map((item) => ({
            name: item.name,
            path: path.posix.join(dirPath, item.name),
            isDirectory: item.type === 'directory',
            size: item.type === 'file' ? item.size : undefined,
            modifiedTime: new Date(),
            mode: item.mode,
            permissions: item.permissions,
            owner: item.owner,
            group: item.group,
            expanded: false,
            children: item.type === 'directory' ? [] : undefined
        }));

        const filteredNodes = nodes.filter(node => {
            if (node.name.startsWith('.') && !this.shouldShowDotFiles()) {
                return false;
            }
            return true;
        });

        return filteredNodes.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) {
                return -1;
            }
            if (!a.isDirectory && b.isDirectory) {
                return 1;
            }
            return a.name.localeCompare(b.name);
        });
    }

    // ===== Transfer Operations =====

    protected async handleUpload(localPath: string, remotePath: string): Promise<void> {
        if (!this._currentHost) {
            return;
        }

        try {
            const stat = await fs.promises.stat(localPath);
            const targetPath = path.posix.join(remotePath, path.basename(localPath));

            this.transferQueueService.addTask({
                type: 'upload',
                localPath: localPath,
                remotePath: targetPath,
                hostId: this._currentHost.id,
                hostName: this._currentHost.name,
                fileSize: stat.isDirectory() ? 0 : stat.size
            });

            this.updateStatus(`Uploading ${path.basename(localPath)}...`);
        } catch (error) {
            logger.error(`Upload failed: ${error}`);
            vscode.window.showErrorMessage(`Upload failed: ${error}`);
        }
    }

    protected async handleDownload(remotePath: string, localPath: string): Promise<void> {
        if (!this._currentHost) {
            return;
        }

        try {
            const targetPath = path.join(localPath, path.basename(remotePath));

            this.transferQueueService.addTask({
                type: 'download',
                localPath: targetPath,
                remotePath: remotePath,
                hostId: this._currentHost.id,
                hostName: this._currentHost.name,
                fileSize: 0
            });

            this.updateStatus(`Downloading ${path.basename(remotePath)}...`);
        } catch (error) {
            logger.error(`Download failed: ${error}`);
            vscode.window.showErrorMessage(`Download failed: ${error}`);
        }
    }

    protected async handleUploadCompleted(task: any): Promise<void> {
        if (!this._remoteRootPath) {
            return;
        }

        const remoteDir = path.posix.dirname(task.remotePath);

        if (remoteDir === this._remoteRootPath) {
            await this.loadRemoteDirectory(this._remoteRootPath);
        }
    }

    protected async handleDownloadCompleted(task: any): Promise<void> {
        if (!this._localRootPath) {
            return;
        }

        const localDir = path.dirname(task.localPath);

        if (localDir === this._localRootPath) {
            await this.loadLocalDirectory(this._localRootPath);
        }
    }

    // ===== Other Operations =====

    protected async handleCreateFolder(data: any): Promise<void> {
        const { parentPath, name, panel } = data;

        try {
            if (panel === 'local') {
                const folderPath = path.join(parentPath, name);
                await fs.promises.mkdir(folderPath, { recursive: true });
                await this.loadLocalDirectory(parentPath);
                this.updateStatus(`Created folder: ${name}`);
            } else if (panel === 'remote') {
                if (!this._currentHost || !this._currentAuthConfig) {
                    vscode.window.showErrorMessage('No host selected');
                    return;
                }

                const folderPath = path.posix.join(parentPath, name);
                await SshConnectionManager.createRemoteFolder(
                    this._currentHost,
                    this._currentAuthConfig,
                    folderPath
                );
                await this.loadRemoteDirectory(parentPath);
                this.updateStatus(`Created folder: ${name}`);
            }
        } catch (error) {
            logger.error(`Create folder failed: ${error}`);
            vscode.window.showErrorMessage(`Create folder failed: ${error}`);
        }
    }

    protected async handleDelete(data: any): Promise<void> {
        const { path: itemPath, panel, isDir } = data;

        try {
            if (panel === 'local') {
                if (isDir) {
                    await fs.promises.rm(itemPath, { recursive: true, force: true });
                } else {
                    await fs.promises.unlink(itemPath);
                }
                await this.loadLocalDirectory(path.dirname(itemPath));
                this.updateStatus(`Deleted: ${path.basename(itemPath)}`);
            } else if (panel === 'remote') {
                if (!this._currentHost || !this._currentAuthConfig) {
                    vscode.window.showErrorMessage('No host selected');
                    return;
                }

                await SshConnectionManager.deleteRemoteFile(
                    this._currentHost,
                    this._currentAuthConfig,
                    itemPath
                );

                const currentDir = path.posix.dirname(itemPath);
                await this.loadRemoteDirectory(currentDir);
                this.updateStatus(`Deleted: ${path.basename(itemPath)}`);
            }
        } catch (error) {
            logger.error(`Delete failed: ${error}`);
            vscode.window.showErrorMessage(`Delete failed: ${error}`);
        }
    }

    /**
     * Handle request for delete confirmation
     */
    protected async handleRequestDeleteConfirmation(data: any): Promise<void> {
        const { panel, items, folders } = data;

        // Build confirmation message
        const fileList = items.slice(0, 10).map((item: any) => `  • ${item.name}`).join('\n');
        const moreFiles = items.length > 10 ? `\n  ... and ${items.length - 10} more` : '';
        const hasRecursive = folders > 0 ? `\n\n⚠️ This will recursively delete ${folders} folder(s) and all contents!` : '';

        const message = `Are you sure you want to delete ${items.length} item(s)?${hasRecursive}\n\n${fileList}${moreFiles}`;

        const confirmed = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            'Delete'
        );

        if (confirmed === 'Delete') {
            // Send confirmation back to webview
            const webview = this.getWebview();
            webview?.postMessage({
                command: 'deleteConfirmationResult',
                data: { confirmed: true, panel, items }
            });
        }
    }

    /**
     * Handle batch delete operation
     */
    protected async handleBatchDelete(data: any): Promise<void> {
        const { items, panel } = data;

        if (!Array.isArray(items) || items.length === 0) {
            return;
        }

        let successCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        try {
            for (const item of items) {
                const { path: itemPath, isDir } = item;

                try {
                    if (panel === 'local') {
                        if (isDir) {
                            await fs.promises.rm(itemPath, { recursive: true, force: true });
                        } else {
                            await fs.promises.unlink(itemPath);
                        }
                        successCount++;
                    } else if (panel === 'remote') {
                        if (!this._currentHost || !this._currentAuthConfig) {
                            throw new Error('No host selected');
                        }

                        await SshConnectionManager.deleteRemoteFile(
                            this._currentHost,
                            this._currentAuthConfig,
                            itemPath
                        );
                        successCount++;
                    }
                } catch (error) {
                    failCount++;
                    const fileName = panel === 'local'
                        ? path.basename(itemPath)
                        : path.posix.basename(itemPath);
                    errors.push(`${fileName}: ${error}`);
                    logger.error(`Failed to delete ${itemPath}: ${error}`);
                }
            }

            // Refresh the directory
            if (panel === 'local' && this._localRootPath) {
                await this.loadLocalDirectory(this._localRootPath);
            } else if (panel === 'remote' && this._remoteRootPath) {
                await this.loadRemoteDirectory(this._remoteRootPath);
            }

            // Show result
            if (failCount === 0) {
                this.updateStatus(`Successfully deleted ${successCount} item(s)`);
            } else {
                const errorMessage = `Deleted ${successCount} item(s), ${failCount} failed:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? '\n...' : ''}`;
                vscode.window.showWarningMessage(errorMessage);
                this.updateStatus(`Batch delete completed with ${failCount} error(s)`);
            }
        } catch (error) {
            logger.error(`Batch delete failed: ${error}`);
            vscode.window.showErrorMessage(`Batch delete failed: ${error}`);
        }
    }

    /**
     * Handle batch upload operation
     */
    protected async handleBatchUpload(data: any): Promise<void> {
        const { localPaths, remotePath } = data;

        if (!Array.isArray(localPaths) || localPaths.length === 0) {
            return;
        }

        if (!this._currentHost || !this._currentAuthConfig) {
            vscode.window.showErrorMessage('No host selected');
            return;
        }

        this.updateStatus(`Uploading ${localPaths.length} item(s)...`);

        const tasks = localPaths.map(localPath => {
            const fileName = path.basename(localPath);
            const remoteFilePath = path.posix.join(remotePath, fileName);

            return {
                type: 'upload' as const,
                hostId: this._currentHost!.id,
                hostName: this._currentHost!.name,
                localPath,
                remotePath: remoteFilePath
            };
        });

        this.transferQueueService.addTasks(tasks);
        this.updateStatus(`Added ${localPaths.length} item(s) to upload queue`);
    }

    /**
     * Handle batch download operation
     */
    protected async handleBatchDownload(data: any): Promise<void> {
        const { remotePaths, localPath } = data;

        if (!Array.isArray(remotePaths) || remotePaths.length === 0) {
            return;
        }

        if (!this._currentHost || !this._currentAuthConfig) {
            vscode.window.showErrorMessage('No host selected');
            return;
        }

        this.updateStatus(`Downloading ${remotePaths.length} item(s)...`);

        const tasks = remotePaths.map(remotePath => {
            const fileName = path.posix.basename(remotePath);
            const localFilePath = path.join(localPath, fileName);

            return {
                type: 'download' as const,
                hostId: this._currentHost!.id,
                hostName: this._currentHost!.name,
                localPath: localFilePath,
                remotePath
            };
        });

        this.transferQueueService.addTasks(tasks);
        this.updateStatus(`Added ${remotePaths.length} item(s) to download queue`);
    }

    protected async handleRename(data: any): Promise<void> {
        const { path: oldPath, newName, panel } = data;
        const parentPath = panel === 'local' ? path.dirname(oldPath) : path.posix.dirname(oldPath);
        const newPath = panel === 'local' ? path.join(parentPath, newName) : path.posix.join(parentPath, newName);

        try {
            if (panel === 'local') {
                await fs.promises.rename(oldPath, newPath);
                await this.loadLocalDirectory(parentPath);
                this.updateStatus(`Renamed to: ${newName}`);
            } else if (panel === 'remote') {
                if (!this._currentHost || !this._currentAuthConfig) {
                    vscode.window.showErrorMessage('No host selected');
                    return;
                }

                await SshConnectionManager.renameRemoteFile(
                    this._currentHost,
                    this._currentAuthConfig,
                    oldPath,
                    newPath
                );
                await this.loadRemoteDirectory(parentPath);
                this.updateStatus(`Renamed to: ${newName}`);
            }
        } catch (error) {
            logger.error(`Rename failed: ${error}`);
            vscode.window.showErrorMessage(`Rename failed: ${error}`);
        }
    }

    protected async handleOpenFile(data: any): Promise<void> {
        const { path: filePath, panel } = data;

        try {
            if (panel === 'local') {
                const doc = await vscode.workspace.openTextDocument(filePath);
                await vscode.window.showTextDocument(doc);
            } else if (panel === 'remote') {
                vscode.window.showInformationMessage('Opening remote files not yet implemented');
            }
        } catch (error) {
            logger.error(`Open file failed: ${error}`);
            vscode.window.showErrorMessage(`Open file failed: ${error}`);
        }
    }

    // ===== UI Updates =====

    protected updateStatus(text: string): void {
        this.postMessage({
            command: 'updateStatus',
            text: text
        });
    }

    protected updateQueueStatus(): void {
        const activeCount = this.transferQueueService.getActiveTaskCount();
        this.postMessage({
            command: 'updateQueue',
            count: activeCount
        });
    }

    // ===== Settings =====

    protected shouldShowDotFiles(): boolean {
        return vscode.workspace.getConfiguration('simpleSftp').get('showDotFiles', true);
    }

    protected async showHostSelection(): Promise<void> {
        const hosts = await this.hostManager.getHosts();
        const groups = await this.hostManager.getGroups();

        const sortedHosts = [...hosts].sort((a, b) => {
            if (a.starred && !b.starred) {
                return -1;
            }
            if (!a.starred && b.starred) {
                return 1;
            }
            return 0;
        });

        // Check authentication status for each host
        const hostsWithAuth = await Promise.all(
            sortedHosts.map(async (h) => {
                const groupName = h.group ? groups.find(g => g.id === h.group)?.name : undefined;
                const hasAuth = await this.authManager.hasAuth(h.id);
                return {
                    id: h.id,
                    name: h.name,
                    host: h.host,
                    username: h.username,
                    port: h.port,
                    group: groupName,
                    starred: h.starred,
                    bookmarks: h.bookmarks || [],
                    hasAuth
                };
            })
        );

        this.postMessage({
            command: 'showHostSelection',
            hosts: hostsWithAuth
        });
    }

    // ===== Public Command Methods =====

    public async executeRefresh(args: any): Promise<void> {
        const { panel } = args;
        if (panel === 'local') {
            const currentPath = this._localRootPath;
            if (currentPath) {
                await this.loadLocalDirectory(currentPath);
                this.updateStatus('Local files refreshed');
            }
        } else if (panel === 'remote') {
            const currentPath = this._remoteRootPath;
            if (currentPath) {
                await this.loadRemoteDirectory(currentPath);
                this.updateStatus('Remote files refreshed');
            }
        }
    }

    public async executeRename(args: any): Promise<void> {
        const { filePath, panel } = args;
        const oldName = path.basename(filePath);
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new name',
            value: oldName,
            validateInput: (value) => {
                if (!value) {
                    return 'Name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Invalid characters in name';
                }
                return null;
            }
        });

        if (!newName || newName === oldName) {
            return;
        }

        await this.handleRename({ path: filePath, newName, panel });
    }

    public async executeDelete(args: any): Promise<void> {
        // Request webview to trigger delete confirmation with current selection
        this.postMessage({
            command: 'triggerDelete'
        });
    }

    public async executeChangePermissions(args: any): Promise<void> {
        const { filePath, panel } = args;

        // Get current file permissions
        let currentMode: number;

        try {
            if (panel === 'local') {
                // Local file
                const stats = await fs.promises.stat(filePath);
                currentMode = stats.mode & 0o777;
            } else {
                // Remote file
                if (!this._currentHost || !this._currentAuthConfig) {
                    vscode.window.showErrorMessage('No host selected');
                    return;
                }

                const stats = await SshConnectionManager.getFileStats(
                    this._currentHost,
                    this._currentAuthConfig,
                    filePath
                );

                currentMode = stats.mode & 0o777;
            }

            // Send message to webview to show permissions editor modal
            this.postMessage({
                command: 'showPermissionsEditor',
                data: {
                    fileName: path.basename(filePath),
                    filePath: filePath,
                    panel: panel,
                    mode: currentMode
                }
            });

        } catch (error: any) {
            logger.error(`Failed to get file permissions: ${error}`);
            vscode.window.showErrorMessage(`Failed to get file permissions: ${error.message}`);
        }
    }

    private async applyPermissions(data: any): Promise<void> {
        const { filePath, panel, mode } = data;

        try {
            if (panel === 'local') {
                // Change local file permissions
                await fs.promises.chmod(filePath, mode);
                vscode.window.showInformationMessage(
                    `Permissions changed to ${mode.toString(8)} for ${path.basename(filePath)}`
                );

                // Refresh local directory
                if (this._localRootPath) {
                    await this.loadLocalDirectory(this._localRootPath);
                }
            } else {
                // Change remote file permissions
                if (!this._currentHost || !this._currentAuthConfig) {
                    vscode.window.showErrorMessage('No host selected');
                    return;
                }

                await SshConnectionManager.changeFilePermissions(
                    this._currentHost,
                    this._currentAuthConfig,
                    filePath,
                    mode
                );

                vscode.window.showInformationMessage(
                    `Permissions changed to ${mode.toString(8)} for ${path.basename(filePath)}`
                );

                // Refresh remote directory
                if (this._remoteRootPath) {
                    await this.loadRemoteDirectory(this._remoteRootPath);
                }
            }
        } catch (error: any) {
            logger.error(`Failed to change permissions: ${error}`);
            vscode.window.showErrorMessage(`Failed to change permissions: ${error.message}`);
        }
    }

    private formatModeToString(mode: number): string {
        return [
            (mode & 0o400) ? 'r' : '-',
            (mode & 0o200) ? 'w' : '-',
            (mode & 0o100) ? 'x' : '-',
            (mode & 0o040) ? 'r' : '-',
            (mode & 0o020) ? 'w' : '-',
            (mode & 0o010) ? 'x' : '-',
            (mode & 0o004) ? 'r' : '-',
            (mode & 0o002) ? 'w' : '-',
            (mode & 0o001) ? 'x' : '-'
        ].join('');
    }

    private parsePermissionsToMode(perms: string): number {
        let mode = 0;
        if (perms.charAt(0) === 'r') mode |= 0o400;
        if (perms.charAt(1) === 'w') mode |= 0o200;
        if (perms.charAt(2) === 'x') mode |= 0o100;
        if (perms.charAt(3) === 'r') mode |= 0o040;
        if (perms.charAt(4) === 'w') mode |= 0o020;
        if (perms.charAt(5) === 'x') mode |= 0o010;
        if (perms.charAt(6) === 'r') mode |= 0o004;
        if (perms.charAt(7) === 'w') mode |= 0o002;
        if (perms.charAt(8) === 'x') mode |= 0o001;
        return mode;
    }

    public async executeCreateFolder(args: any): Promise<void> {
        const { panel } = args;
        const parentPath = panel === 'local' ? this._localRootPath : this._remoteRootPath;

        if (!parentPath) {
            vscode.window.showErrorMessage(`No ${panel} path selected`);
            return;
        }

        // Send message to webview to trigger inline folder creation
        this.postMessage({
            command: 'triggerCreateFolder',
            panel: panel
        });
    }

    public async executeUpload(args: any): Promise<void> {
        // Request webview to send selected items for upload
        this.postMessage({
            command: 'getSelectedForUpload'
        });
    }

    public async executeDownload(args: any): Promise<void> {
        // Request webview to send selected items for download
        this.postMessage({
            command: 'getSelectedForDownload'
        });
    }

    protected async handleGetBookmarks(): Promise<void> {
        if (!this._currentHost) {
            logger.debug('No current host, sending empty bookmarks');
            this.postMessage({
                command: 'updateBookmarks',
                data: { bookmarks: [] }
            });
            return;
        }

        // Get bookmarks from host config
        const bookmarks = this._currentHost.bookmarks || [];
        logger.debug(`Sending ${bookmarks.length} bookmarks for host ${this._currentHost.name}`, bookmarks);
        this.postMessage({
            command: 'updateBookmarks',
            data: { bookmarks }
        });
    }

    protected async handleAddBookmark(data: { path: string }): Promise<void> {
        if (!this._currentHost) {
            vscode.window.showErrorMessage('No host selected');
            return;
        }

        // Prompt for bookmark name
        const name = await vscode.window.showInputBox({
            prompt: 'Enter bookmark name',
            value: path.basename(data.path),
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Bookmark name cannot be empty';
                }
                return null;
            }
        });

        if (!name) {
            return; // User cancelled
        }

        try {
            // Use the existing bookmark service command
            await vscode.commands.executeCommand('simpleSftp.addBookmark', {
                data: this._currentHost,
                type: 'host',
                path: data.path,
                name: name.trim()
            });

            vscode.window.showInformationMessage(`Bookmark "${name}" added`);

            // Refresh bookmarks list
            await this.handleGetBookmarks();
        } catch (error: any) {
            logger.error(`Failed to add bookmark: ${error}`);
            vscode.window.showErrorMessage(`Failed to add bookmark: ${error.message}`);
        }
    }

    // ===== HTML Generation =====

    protected getHtmlForWebview(webview: vscode.Webview): string {
        try {
            const scriptUri = webview.asWebviewUri(
                vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'dual-panel-browser.js')
            );
            const styleUri = webview.asWebviewUri(
                vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'dual-panel-browser.css')
            );
            const codiconsUri = webview.asWebviewUri(
                vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
            );

            const nonce = this.getNonce();

            const htmlPath = path.join(this._extensionUri.fsPath, 'resources', 'webview', 'dual-panel-browser.html');
            let html = fs.readFileSync(htmlPath, 'utf8');

            html = html.replaceAll('{{cspSource}}', webview.cspSource);
            html = html.replaceAll('{{nonce}}', nonce);
            html = html.replaceAll('{{styleUri}}', styleUri.toString());
            html = html.replaceAll('{{scriptUri}}', scriptUri.toString());
            html = html.replaceAll('{{codiconsUri}}', codiconsUri.toString());
            html = html.replaceAll('{{localPath}}', this._localRootPath || 'No host selected');
            html = html.replaceAll('{{remotePath}}', this._remoteRootPath || 'No host selected');

            return html;
        } catch (error) {
            logger.error(`Failed to load HTML template: ${error}`);
            return `<html><body><h1>Error loading webview</h1><p>${error}</p></body></html>`;
        }
    }

    protected getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
