import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { HostConfig } from '../types';
import { SshConnectionManager } from '../sshConnectionManager';
import { TransferQueueService } from '../services/transferQueueService';
import { AuthManager } from '../authManager';
import { HostManager } from '../hostManager';
import { logger } from '../logger';
import { PortForwardService } from '../services/portForwardService';
import { PortForwardConfig, RemoteForwardConfig, DynamicForwardConfig } from '../types/portForward.types';

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
    protected _searchHistory: string[] = [];
    protected readonly MAX_SEARCH_HISTORY = 20;

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

        // Subscribe to port forwarding events
        const portForwardService = PortForwardService.getInstance();
        portForwardService.onPortForwardingEvent((event) => {
            // Notify webview to refresh port forwardings
            this.handlePortForwardingChanged(event);
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
                logger.info(`[DualPanelBase] openBookmark message received - hostId: ${bookmarkHostId}, path: ${bookmarkPath}, path type: ${typeof bookmarkPath}`);
                const bookmarkHosts = await this.hostManager.getHosts();
                const bookmarkHost = bookmarkHosts.find(h => h.id === bookmarkHostId);
                if (bookmarkHost) {
                    logger.info(`[DualPanelBase] Found bookmark host: ${bookmarkHost.name}, calling openForHost with path: ${bookmarkPath}`);
                    await this.openForHost(bookmarkHost, bookmarkPath);
                } else {
                    logger.warn(`[DualPanelBase] Bookmark host not found for ID: ${bookmarkHostId}`);
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

            case 'diffFiles':
                await this.handleDiffFiles(message.data);
                break;

            case 'createFolder':
                await this.handleCreateFolder(message.data);
                break;

            case 'createFile':
                await this.handleCreateFile(message.data);
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

            case 'batchRename':
                await this.handleBatchRename(message.data);
                break;

            case 'openFile':
                await this.handleOpenFile(message.data);
                break;

            case 'openFileAtLine':
                await this.handleOpenFileAtLine(message.data);
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

            case 'getBreadcrumbDirectory':
                await this.handleGetBreadcrumbDirectory(message.panel, message.path, message.isRoot, message.highlightPath);
                break;

            case 'getBreadcrumbSubMenu':
                await this.handleGetBreadcrumbSubMenu(message.panel, message.path);
                break;

            case 'getBreadcrumbTreeChildren':
                await this.handleGetBreadcrumbTreeChildren(message.panel, message.path);
                break;

            case 'performSearch':
                await this.performSearch(message.data);
                break;

            case 'getSearchHistory':
                this.postMessage({
                    command: 'searchHistory',
                    data: this._searchHistory
                });
                break;

            case 'getPortForwardings':
                await this.handleGetPortForwardings();
                break;

            case 'startPortForward':
                await this.handleStartPortForward(message.config);
                break;

            case 'startRemoteForward':
                await this.handleStartRemoteForward(message.config);
                break;

            case 'startDynamicForward':
                await this.handleStartDynamicForward(message.config);
                break;

            case 'stopPortForward':
                await this.handleStopPortForward(message.id);
                break;

            case 'deletePortForward':
                await this.handleDeletePortForward(message.id);
                break;

            case 'scanRemotePorts':
                await this.handleScanRemotePorts();
                break;

            case 'scanLocalPorts':
                await this.handleScanLocalPorts();
                break;

            case 'getFolderDetails':
                await this.handleGetFolderDetails(message.data);
                break;

            case 'openBrowser':
                await this.handleOpenBrowser(message.address);
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
            modifiedTime: item.mtime ? new Date(item.mtime) : new Date(), // 将时间戳转换为Date对象
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

    protected async handlePortForwardingChanged(event: any): Promise<void> {
        // Notify webview to refresh port forwardings when any port forwarding event occurs
        if (this._currentHost) {
            const service = PortForwardService.getInstance();
            // Send all forwardings, not just active ones
            const forwardings = service.getForwardingsForHost(this._currentHost.id);

            this.postMessage({
                command: 'portForwardings',
                data: forwardings
            });

            // Also send specific event notifications
            if (event.type === 'started') {
                this.postMessage({
                    command: 'portForwardingStarted',
                    forwarding: event.forwarding
                });
            } else if (event.type === 'stopped') {
                this.postMessage({
                    command: 'portForwardingStopped',
                    forwarding: event.forwarding
                });
            } else if (event.type === 'deleted') {
                this.postMessage({
                    command: 'portForwardingDeleted',
                    forwarding: event.forwarding
                });
            }
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

    protected async handleCreateFile(data: any): Promise<void> {
        const { parentPath, name, panel } = data;

        try {
            if (panel === 'local') {
                const filePath = path.join(parentPath, name);
                // Create empty file
                await fs.promises.writeFile(filePath, '', 'utf8');
                await this.loadLocalDirectory(parentPath);
                this.updateStatus(`Created file: ${name}`);
            } else if (panel === 'remote') {
                if (!this._currentHost || !this._currentAuthConfig) {
                    vscode.window.showErrorMessage('No host selected');
                    return;
                }

                const filePath = path.posix.join(parentPath, name);
                await SshConnectionManager.createRemoteFile(
                    this._currentHost,
                    this._currentAuthConfig,
                    filePath
                );
                await this.loadRemoteDirectory(parentPath);
                this.updateStatus(`Created file: ${name}`);
            }
        } catch (error) {
            logger.error(`Create file failed: ${error}`);
            vscode.window.showErrorMessage(`Create file failed: ${error}`);
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
        const totalCount = items.length;

        try {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
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

                // Update status text with progress
                this.updateStatus(`Deleting ${successCount + failCount} / ${totalCount} items...`);

                this.postMessage({
                    command: 'updateFooterProgress',
                    panel: panel,
                    message: `Deleting ${successCount + failCount}/${totalCount}...`
                });
            }

            // Refresh the directory
            if (panel === 'local' && this._localRootPath) {
                await this.loadLocalDirectory(this._localRootPath);
            } else if (panel === 'remote' && this._remoteRootPath) {
                await this.loadRemoteDirectory(this._remoteRootPath);
            }

            // Show final result
            if (failCount === 0) {
                this.updateStatus(`Successfully deleted ${successCount} item(s)`);
            } else {
                const errorMessage = `Deleted ${successCount} item(s), ${failCount} failed:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? '\n...' : ''}`;
                vscode.window.showWarningMessage(errorMessage);
                this.updateStatus(`Deleted ${successCount} item(s), ${failCount} failed`);
            }
        } catch (error) {
            logger.error(`Batch delete failed: ${error}`);
            vscode.window.showErrorMessage(`Batch delete failed: ${error}`);
            this.updateStatus('Batch delete failed');
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

    /**
     * Handle batch rename operation
     */
    protected async handleBatchRename(data: any): Promise<void> {
        const { files } = data;

        if (!files || files.length === 0) {
            vscode.window.showErrorMessage('No files to rename');
            return;
        }

        // Show progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Renaming ${files.length} ${files.length === 1 ? 'file' : 'files'}...`,
                cancellable: false
            },
            async (progress) => {
                let successCount = 0;
                let failCount = 0;
                const errors: string[] = [];

                // Group files by panel and parent directory for efficient refresh
                const localParents = new Set<string>();
                const remoteParents = new Set<string>();

                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const { oldPath, newName, panel } = file;

                    progress.report({
                        increment: (1 / files.length) * 100,
                        message: `${i + 1}/${files.length}: ${newName}`
                    });

                    try {
                        const parentPath = panel === 'local'
                            ? path.dirname(oldPath)
                            : path.posix.dirname(oldPath);
                        const newPath = panel === 'local'
                            ? path.join(parentPath, newName)
                            : path.posix.join(parentPath, newName);

                        if (panel === 'local') {
                            await fs.promises.rename(oldPath, newPath);
                            localParents.add(parentPath);
                        } else if (panel === 'remote') {
                            if (!this._currentHost || !this._currentAuthConfig) {
                                throw new Error('No host selected');
                            }

                            await SshConnectionManager.renameRemoteFile(
                                this._currentHost,
                                this._currentAuthConfig,
                                oldPath,
                                newPath
                            );
                            remoteParents.add(parentPath);
                        }

                        successCount++;
                        logger.info(`Renamed: ${oldPath} -> ${newName}`);
                    } catch (error) {
                        failCount++;
                        const errorMsg = `Failed to rename ${path.basename(oldPath)}: ${error}`;
                        errors.push(errorMsg);
                        logger.error(errorMsg);
                    }
                }

                // Refresh affected directories
                for (const parentPath of localParents) {
                    await this.loadLocalDirectory(parentPath);
                }
                for (const parentPath of remoteParents) {
                    await this.loadRemoteDirectory(parentPath);
                }

                // Show summary
                if (successCount > 0 && failCount === 0) {
                    this.updateStatus(`Successfully renamed ${successCount} ${successCount === 1 ? 'file' : 'files'}`);
                    vscode.window.showInformationMessage(`Successfully renamed ${successCount} ${successCount === 1 ? 'file' : 'files'}`);
                } else if (successCount > 0 && failCount > 0) {
                    this.updateStatus(`Renamed ${successCount} files, ${failCount} failed`);
                    vscode.window.showWarningMessage(
                        `Renamed ${successCount} files, ${failCount} failed. Check output for details.`
                    );
                    // Log errors
                    errors.forEach(err => logger.error(err));
                } else {
                    this.updateStatus(`Batch rename failed`);
                    vscode.window.showErrorMessage(`Batch rename failed. Check output for details.`);
                    errors.forEach(err => logger.error(err));
                }
            }
        );
    }

    protected async handleOpenFile(data: any): Promise<void> {
        const { path: filePath, panel } = data;

        logger.info(`handleOpenFile 被调用: ${filePath}, panel: ${panel}`);

        try {
            if (panel === 'local') {
                // 使用 vscode.open 命令,VS Code 会自动判断文件类型
                // 文本文件 → 文本编辑器,二进制文件 → 相应查看器
                // preview: false 禁用预览模式,避免新文件替换已打开的预览tab
                await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath), { preview: false });
            } else if (panel === 'remote') {
                if (!this._currentHost || !this._currentAuthConfig) {
                    vscode.window.showErrorMessage('No host selected');
                    return;
                }

                // Create SFTP URI using the registered file system
                // URI format: sftp://hostId/remote/path
                const uri = vscode.Uri.parse(`sftp://${this._currentHost.id}${filePath}`);

                // 使用 vscode.open 命令,VS Code 会自动判断文件类型并选择合适的编辑器/查看器
                // 文本文件 → 文本编辑器(自动语法高亮)
                // 图片文件 → 图片预览
                // PDF 文件 → PDF 查看器
                // 其他二进制文件 → 相应的查看器
                // preview: false 禁用预览模式,避免新文件替换已打开的预览tab
                await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
            }
        } catch (error) {
            logger.error(`Open file failed: ${error}`);
            vscode.window.showErrorMessage(`Open file failed: ${error}`);
        }
    }

    /**
     * Handle opening file at specific line with highlighting
     */
    protected async handleOpenFileAtLine(data: any): Promise<void> {
        const { path: filePath, panel, line, matchStart, matchEnd } = data;

        try {
            let doc: vscode.TextDocument;

            if (panel === 'local') {
                doc = await vscode.workspace.openTextDocument(filePath);
            } else if (panel === 'remote') {
                if (!this._currentHost || !this._currentAuthConfig) {
                    vscode.window.showErrorMessage('No host selected');
                    return;
                }

                const uri = vscode.Uri.parse(`sftp://${this._currentHost.id}${filePath}`);
                doc = await vscode.workspace.openTextDocument(uri);

                // Set language mode
                const fileName = path.basename(filePath);
                const languageId = this.getLanguageIdFromFileName(fileName);
                if (languageId) {
                    await vscode.languages.setTextDocumentLanguage(doc, languageId);
                }
            } else {
                return;
            }

            // Calculate line number (1-based to 0-based)
            const lineNumber = Math.max(0, (line || 1) - 1);

            // Show the document and position at the line
            const editor = await vscode.window.showTextDocument(doc, {
                preview: false,
                preserveFocus: false,
                selection: new vscode.Range(lineNumber, 0, lineNumber, 0)
            });

            // Highlight the match if matchStart and matchEnd are provided
            if (matchStart !== undefined && matchEnd !== undefined) {
                const selection = new vscode.Selection(
                    lineNumber,
                    matchStart,
                    lineNumber,
                    matchEnd
                );
                editor.selection = selection;
                editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            } else {
                // Just reveal the line
                const range = new vscode.Range(lineNumber, 0, lineNumber, 0);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            }

            logger.info(`Opened file at line ${line}: ${filePath}`);
        } catch (error) {
            logger.error(`Open file at line failed: ${error}`);
            vscode.window.showErrorMessage(`Open file at line failed: ${error}`);
        }
    }

    /**
     * Handle diff comparison between any two files
     */
    protected async handleDiffFiles(data: any): Promise<void> {
        const { firstPath, secondPath, firstPanel, secondPanel } = data;

        try {
            // Create URIs for both files based on their panels
            let firstUri: vscode.Uri;
            let secondUri: vscode.Uri;

            if (firstPanel === 'local') {
                firstUri = vscode.Uri.file(firstPath);
            } else {
                if (!this._currentHost) {
                    vscode.window.showErrorMessage('No host selected');
                    return;
                }
                firstUri = vscode.Uri.parse(`sftp://${this._currentHost.id}${firstPath}`);
            }

            if (secondPanel === 'local') {
                secondUri = vscode.Uri.file(secondPath);
            } else {
                if (!this._currentHost) {
                    vscode.window.showErrorMessage('No host selected');
                    return;
                }
                secondUri = vscode.Uri.parse(`sftp://${this._currentHost.id}${secondPath}`);
            }

            // Create descriptive title
            const firstName = path.basename(firstPath);
            const secondName = path.basename(secondPath);
            const title = `${firstName} ↔ ${secondName}`;

            // Open diff editor
            await vscode.commands.executeCommand(
                'vscode.diff',
                firstUri,
                secondUri,
                title
            );

            logger.info(`Diff comparison opened: ${firstPath} (${firstPanel}) ↔ ${secondPath} (${secondPanel})`);
        } catch (error) {
            logger.error(`Diff files failed: ${error}`);
            vscode.window.showErrorMessage(`Diff comparison failed: ${error}`);
        }
    }

    /**
     * Get language ID from file name
     */
    private getLanguageIdFromFileName(fileName: string): string | undefined {
        const ext = path.extname(fileName).toLowerCase();
        const languageMap: { [key: string]: string } = {
            '.js': 'javascript',
            '.ts': 'typescript',
            '.jsx': 'javascriptreact',
            '.tsx': 'typescriptreact',
            '.json': 'json',
            '.html': 'html',
            '.css': 'css',
            '.scss': 'scss',
            '.less': 'less',
            '.xml': 'xml',
            '.md': 'markdown',
            '.py': 'python',
            '.java': 'java',
            '.c': 'c',
            '.cpp': 'cpp',
            '.cs': 'csharp',
            '.php': 'php',
            '.rb': 'ruby',
            '.go': 'go',
            '.rs': 'rust',
            '.sh': 'shellscript',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.sql': 'sql',
            '.txt': 'plaintext',
            '.log': 'log'
        };

        return languageMap[ext];
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
        // Trigger inline rename in webview instead of showing input box
        // Extract panel from args based on webviewSection
        let panel = 'remote'; // default

        if (args?.webviewSection) {
            panel = args.webviewSection.includes('local') ? 'local' : 'remote';
        } else if (args?.panel) {
            panel = args.panel;
        }

        // Send message to webview to trigger inline rename
        this.postMessage({
            command: 'triggerRename',
            panel: panel
        });
    }

    public async executeBatchRename(args: any): Promise<void> {
        // Extract panel from args based on webviewSection
        // webviewSection can be 'localFile' or 'remoteFile'
        let panel = 'remote'; // default

        if (args?.webviewSection) {
            panel = args.webviewSection.includes('local') ? 'local' : 'remote';
        } else if (args?.panel) {
            panel = args.panel;
        }
        // Send message to webview to trigger batch rename with current selection
        this.postMessage({
            command: 'triggerBatchRename',
            panel: panel
        });
    }

    public async executeCopyFullPath(args: any): Promise<void> {
        const filePath = args?.filePath;
        if (!filePath) {
            vscode.window.showErrorMessage('No file path available');
            return;
        }

        await vscode.env.clipboard.writeText(filePath);
        vscode.window.showInformationMessage(`Copied: ${filePath}`);
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

    public async executeCreateFile(args: any): Promise<void> {
        const { panel } = args;
        const parentPath = panel === 'local' ? this._localRootPath : this._remoteRootPath;

        if (!parentPath) {
            vscode.window.showErrorMessage(`No ${panel} path selected`);
            return;
        }

        // Send message to webview to trigger inline file creation
        this.postMessage({
            command: 'triggerCreateFile',
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

    public async openInTerminal(args: any): Promise<void> {
        // Extract panel and current path
        const { panel, filePath, isDirectory, currentPath } = args;

        // Determine the directory path to open
        let targetPath: string;

        if (filePath) {
            // If a specific file/folder is selected
            targetPath = isDirectory ? filePath : path.dirname(filePath);
        } else if (currentPath) {
            // If using current directory
            targetPath = currentPath;
        } else {
            // Fallback to root path
            targetPath = panel === 'local' ? this._localRootPath || process.cwd() : this._remoteRootPath || '/';
        }

        if (panel === 'local') {
            // Open local terminal at the specified path
            const terminal = vscode.window.createTerminal({
                name: `Terminal: ${path.basename(targetPath)}`,
                cwd: targetPath,
                iconPath: new vscode.ThemeIcon('terminal')
            });

            terminal.show();
            logger.info(`Opened local terminal at: ${targetPath}`);
        } else {
            // Open SSH terminal and navigate to the remote path
            if (!this._currentHost || !this._currentAuthConfig) {
                vscode.window.showErrorMessage('No remote host connected');
                return;
            }

            const config = this._currentHost;
            const authConfig = this._currentAuthConfig;

            // Build the SSH command arguments
            const args: string[] = [];

            // Add port if not default
            if (config.port && config.port !== 22) {
                args.push('-p', config.port.toString());
            }

            // Add identity file if using private key auth
            if (authConfig.authType === 'privateKey' && authConfig.privateKeyPath) {
                args.push('-i', authConfig.privateKeyPath);
            }

            // Add the connection string
            args.push(`${config.username}@${config.host}`);

            // Create and show the terminal
            const terminal = vscode.window.createTerminal({
                name: `SSH: ${config.name}`,
                shellPath: 'ssh',
                shellArgs: args,
                iconPath: new vscode.ThemeIcon('terminal')
            });

            terminal.show();

            // After connection, navigate to the target directory
            // Small delay to ensure connection is established
            setTimeout(() => {
                terminal.sendText(`cd '${targetPath.replace(/'/g, "'\\''")}'`);
            }, 500);

            logger.info(`Opened SSH terminal at remote path: ${targetPath}`);
        }
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

        // Always get fresh host config from hostManager to ensure bookmarks are up-to-date
        const hosts = await this.hostManager.getHosts();
        const currentHost = hosts.find(h => h.id === this._currentHost!.id);

        if (!currentHost) {
            this.postMessage({
                command: 'updateBookmarks',
                data: { bookmarks: [] }
            });
            return;
        }

        // Update current host reference
        this._currentHost = currentHost;

        // Get bookmarks from fresh host config
        const bookmarks = currentHost.bookmarks || [];
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
            // Directly add bookmark using hostManager (no path selection needed)
            await this.hostManager.addBookmark(
                this._currentHost.id,
                name.trim(),
                data.path
            );

            vscode.window.showInformationMessage(`Bookmark "${name}" added`);

            // Refresh bookmarks list in webview
            await this.handleGetBookmarks();

            // Trigger tree view refresh via command
            await vscode.commands.executeCommand('simpleSftp.refresh');
        } catch (error: any) {
            logger.error(`Failed to add bookmark: ${error}`);
            vscode.window.showErrorMessage(`Failed to add bookmark: ${error.message}`);
        }
    }

    protected async handleGetBreadcrumbDirectory(panel: string, clickedPath: string, isRoot: boolean, highlightPath?: string): Promise<void> {
        try {
            let directoryPath: string;
            // Use highlightPath if provided, otherwise use clickedPath
            let currentPath: string = highlightPath || clickedPath;

            // Determine which directory to load
            if (isRoot) {
                // For root segment, just use the clicked path as is
                directoryPath = clickedPath;
            } else {
                // For non-root segments, get the parent directory
                const isWindows = panel === 'local' && /^[A-Za-z]:/.test(clickedPath);
                const separator = panel === 'local' && isWindows ? '\\' : '/';

                // Remove trailing separator if exists
                const normalizedPath = clickedPath.endsWith(separator) && clickedPath.length > 1
                    ? clickedPath.slice(0, -1)
                    : clickedPath;

                const lastSep = normalizedPath.lastIndexOf(separator);
                directoryPath = lastSep > 0 ? normalizedPath.substring(0, lastSep) : separator;

                // For Windows root (e.g., "C:"), add separator
                if (isWindows && directoryPath.length === 2 && directoryPath.endsWith(':')) {
                    directoryPath += separator;
                }
            }

            // Load directory contents
            let nodes: FileNode[] = [];

            if (panel === 'local') {
                if (directoryPath === 'drives://') {
                    nodes = await this.listWindowsDrives();
                } else {
                    nodes = await this.readLocalDirectory(directoryPath);
                }
            } else {
                // Remote panel
                if (!this._currentHost || !this._currentAuthConfig) {
                    vscode.window.showErrorMessage('Not connected to remote server');
                    return;
                }
                nodes = await this.readRemoteDirectory(this._currentHost, this._currentAuthConfig, directoryPath);
            }

            // Send results to webview
            this.postMessage({
                command: 'breadcrumbDirectory',
                data: {
                    panel: panel,
                    path: directoryPath,
                    nodes: nodes,
                    currentPath: currentPath
                }
            });
        } catch (error: any) {
            logger.error(`Failed to load breadcrumb directory: ${error}`);
            vscode.window.showErrorMessage(`Failed to load directory: ${error.message}`);
        }
    }

    protected async handleGetBreadcrumbSubMenu(panel: string, folderPath: string): Promise<void> {
        try {
            // Load directory contents
            let nodes: FileNode[] = [];

            if (panel === 'local') {
                if (folderPath === 'drives://') {
                    nodes = await this.listWindowsDrives();
                } else {
                    nodes = await this.readLocalDirectory(folderPath);
                }
            } else {
                // Remote panel
                if (!this._currentHost || !this._currentAuthConfig) {
                    vscode.window.showErrorMessage('Not connected to remote server');
                    return;
                }
                nodes = await this.readRemoteDirectory(this._currentHost, this._currentAuthConfig, folderPath);
            }

            // Send results to webview
            this.postMessage({
                command: 'breadcrumbSubMenu',
                data: {
                    panel: panel,
                    path: folderPath,
                    nodes: nodes
                }
            });
        } catch (error: any) {
            logger.error(`Failed to load breadcrumb submenu: ${error}`);
            // Don't show error message for submenu, just fail silently
        }
    }

    protected async handleGetBreadcrumbTreeChildren(panel: string, parentPath: string): Promise<void> {
        try {
            // Load directory contents (same as submenu)
            let nodes: FileNode[] = [];

            if (panel === 'local') {
                if (parentPath === 'drives://') {
                    nodes = await this.listWindowsDrives();
                } else {
                    nodes = await this.readLocalDirectory(parentPath);
                }
            } else {
                // Remote panel
                if (!this._currentHost || !this._currentAuthConfig) {
                    vscode.window.showErrorMessage('Not connected to remote server');
                    return;
                }
                nodes = await this.readRemoteDirectory(this._currentHost, this._currentAuthConfig, parentPath);
            }

            // Send results to webview
            this.postMessage({
                command: 'breadcrumbTreeChildren',
                data: {
                    panel: panel,
                    parentPath: parentPath,
                    nodes: nodes
                }
            });
        } catch (error: any) {
            logger.error(`Failed to load breadcrumb tree children: ${error}`);
            // Send empty result on error
            this.postMessage({
                command: 'breadcrumbTreeChildren',
                data: {
                    panel: panel,
                    parentPath: parentPath,
                    nodes: []
                }
            });
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
            // Shared port forwarding module
            const portForwardStyleUri = webview.asWebviewUri(
                vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'port-forward.css')
            );
            const portForwardScriptUri = webview.asWebviewUri(
                vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'port-forward.js')
            );

            const nonce = this.getNonce();

            const htmlPath = path.join(this._extensionUri.fsPath, 'resources', 'webview', 'dual-panel-browser.html');
            let html = fs.readFileSync(htmlPath, 'utf8');

            html = html.replaceAll('{{cspSource}}', webview.cspSource);
            html = html.replaceAll('{{nonce}}', nonce);
            html = html.replaceAll('{{styleUri}}', styleUri.toString());
            html = html.replaceAll('{{scriptUri}}', scriptUri.toString());
            html = html.replaceAll('{{codiconsUri}}', codiconsUri.toString());
            html = html.replaceAll('{{portForwardStyleUri}}', portForwardStyleUri.toString());
            html = html.replaceAll('{{portForwardScriptUri}}', portForwardScriptUri.toString());
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

    /**
     * Select file for comparison (context menu command)
     */
    public selectFileForCompare(context: any): void {
        if (context && context.filePath && context.fileName && context.panel && context.isFile) {
            this.postMessage({
                command: 'selectFileForCompare',
                data: {
                    path: context.filePath,
                    name: context.fileName,
                    panel: context.panel
                }
            });
            vscode.window.showInformationMessage(`Selected ${context.fileName} for comparison`);
        }
    }

    /**
     * Compare with previously selected file (context menu command)
     */
    public compareWithSelected(context: any): void {
        if (context && context.filePath && context.fileName && context.panel && context.isFile) {
            this.postMessage({
                command: 'compareWithSelected',
                data: {
                    path: context.filePath,
                    name: context.fileName,
                    panel: context.panel
                }
            });
        }
    }

    // ===== Search Operations =====

    /**
     * Perform remote file search (filename or content)
     */
    protected async performSearch(options: {
        query: string;
        filesInclude: string;
        filesExclude: string;
        filenameOnly: boolean;
        caseSensitive: boolean;
        wholeWord: boolean;
        useRegex: boolean;
        basePath: string;
    }): Promise<void> {
        if (!this._currentHost || !this._currentAuthConfig) {
            this.postMessage({
                command: 'searchError',
                data: { error: 'No host connected. Please select a host first.' }
            });
            return;
        }

        // Add to search history
        if (options.query && options.query.trim()) {
            this.addToSearchHistory(options.query.trim());
        }

        try {
            let results;

            if (options.filenameOnly) {
                // Filename search
                results = await this.searchByFilename(options);
            } else {
                // Content search
                results = await this.searchByContent(options);
            }

            this.postMessage({
                command: 'searchResults',
                data: results
            });
        } catch (error: any) {
            logger.error(`Search failed: ${error}`);
            this.postMessage({
                command: 'searchError',
                data: { error: error.message || 'Search failed' }
            });
        }
    }

    /**
     * Add query to search history (most recent first, avoid duplicates)
     */
    protected addToSearchHistory(query: string): void {
        // Remove if already exists
        const index = this._searchHistory.indexOf(query);
        if (index !== -1) {
            this._searchHistory.splice(index, 1);
        }

        // Add to front
        this._searchHistory.unshift(query);

        // Keep only max items
        if (this._searchHistory.length > this.MAX_SEARCH_HISTORY) {
            this._searchHistory = this._searchHistory.slice(0, this.MAX_SEARCH_HISTORY);
        }
    }

    /**
     * Execute SSH command and return output
     */
    private async executeSSHCommand(client: any, command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            let output = '';
            let errorOutput = '';

            client.exec(command, (err: Error | undefined, stream: any) => {
                if (err) {
                    reject(err);
                    return;
                }

                stream.on('data', (data: Buffer) => {
                    output += data.toString();
                });

                stream.stderr.on('data', (data: Buffer) => {
                    errorOutput += data.toString();
                });

                stream.on('close', (code: number) => {
                    if (code !== 0 && errorOutput) {
                        reject(new Error(errorOutput));
                    } else {
                        resolve(output);
                    }
                });

                stream.on('error', (error: Error) => {
                    reject(error);
                });
            });
        });
    }

    /**
     * Search files by filename pattern using SSH find command
     */
    protected async searchByFilename(options: {
        query: string;
        filesInclude: string;
        filesExclude: string;
        caseSensitive: boolean;
        useRegex: boolean;
        basePath: string;
    }): Promise<{ files: Array<{ path: string; name: string; matches?: any[] }> }> {

        // Build find command
        let findCmd = `find "${options.basePath}" -type f`;

        // Add name pattern
        if (options.useRegex) {
            // Use regex pattern
            findCmd += ` -regex '${options.query}'`;
            if (!options.caseSensitive) {
                findCmd += ` -iregex '${options.query}'`;
            }
        } else {
            // Convert glob to find pattern
            const pattern = options.query;
            const caseFlag = options.caseSensitive ? '-name' : '-iname';
            findCmd += ` ${caseFlag} '${pattern}'`;
        }

        // Add exclude patterns
        if (options.filesExclude) {
            const excludePatterns = options.filesExclude.split(',').map(p => p.trim()).filter(Boolean);
            for (const exclude of excludePatterns) {
                if (exclude.includes('/')) {
                    // Path-based exclusion
                    findCmd += ` -not -path '*/${exclude}'`;
                } else {
                    // Name-based exclusion
                    findCmd += ` -not -name '${exclude}'`;
                }
            }
        }

        // Limit results to prevent overwhelming output
        findCmd += ` 2>/dev/null | head -n 1000`;

        // Execute command via SSH
        const pool = (SshConnectionManager as any).connectionPool;
        const buildConfig = (SshConnectionManager as any).buildConnectConfig;
        const connectConfig = buildConfig.call(SshConnectionManager, this._currentHost, this._currentAuthConfig);
        const { client } = await pool.getConnection(
            this._currentHost,
            this._currentAuthConfig,
            connectConfig
        );

        try {
            const output = await this.executeSSHCommand(client, findCmd);
            const matchedFiles: Array<{ path: string; name: string }> = [];

            // Parse output
            const lines = output.split('\n').filter(l => l.trim());
            for (const line of lines) {
                const fullPath = line.trim();
                if (fullPath) {
                    matchedFiles.push({
                        path: fullPath,
                        name: path.basename(fullPath)
                    });
                }
            }

            return { files: matchedFiles };
        } catch (error: any) {
            // Check if command not found
            if (error.message && error.message.includes('command not found')) {
                throw new Error('The "find" command is not available on the remote server. Please ensure it is installed or use a different search method.');
            }
            throw error;
        } finally {
            pool.releaseConnection(this._currentHost);
        }
    }

    /**
     * Search files by content using SSH grep command
     */
    protected async searchByContent(options: {
        query: string;
        filesInclude: string;
        filesExclude: string;
        caseSensitive: boolean;
        wholeWord: boolean;
        useRegex: boolean;
        basePath: string;
    }): Promise<{ files: Array<{ path: string; name: string; matches: any[] }> }> {

        // Build grep command
        let grepCmd = 'grep -rn';

        // Add options
        if (!options.caseSensitive) {
            grepCmd += ' -i';
        }
        if (options.wholeWord) {
            grepCmd += ' -w';
        }
        if (!options.useRegex) {
            grepCmd += ' -F'; // Fixed string (not regex)
        }

        // Add include patterns
        if (options.filesInclude) {
            const includePatterns = options.filesInclude.split(',').map(p => p.trim()).filter(Boolean);
            for (const include of includePatterns) {
                grepCmd += ` --include='${include}'`;
            }
        }

        // Add exclude patterns
        if (options.filesExclude) {
            const excludePatterns = options.filesExclude.split(',').map(p => p.trim()).filter(Boolean);
            for (const exclude of excludePatterns) {
                if (exclude.endsWith('/**')) {
                    // Directory exclusion
                    const dir = exclude.replace('/**', '');
                    grepCmd += ` --exclude-dir='${dir}'`;
                } else {
                    grepCmd += ` --exclude='${exclude}'`;
                }
            }
        }

        // Add default exclusions
        grepCmd += ` --exclude-dir='.git' --exclude-dir='node_modules' --exclude-dir='.svn'`;

        // Add query and path
        const escapedQuery = options.query.replace(/'/g, "'\\''"); // Escape single quotes
        grepCmd += ` '${escapedQuery}' "${options.basePath}"`;

        // Limit output and suppress errors
        grepCmd += ` 2>/dev/null | head -n 2000`;

        // Execute command via SSH
        const pool = (SshConnectionManager as any).connectionPool;
        const buildConfig = (SshConnectionManager as any).buildConnectConfig;
        const connectConfig = buildConfig.call(SshConnectionManager, this._currentHost, this._currentAuthConfig);
        const { client } = await pool.getConnection(
            this._currentHost,
            this._currentAuthConfig,
            connectConfig
        );

        try {
            const output = await this.executeSSHCommand(client, grepCmd);

            // Parse grep output: filepath:line_number:matched_line
            const fileMatches = new Map<string, { name: string; matches: any[] }>();
            const lines = output.split('\n').filter(l => l.trim());

            for (const line of lines) {
                const match = line.match(/^([^:]+):(\d+):(.*)$/);
                if (match) {
                    const [, filePath, lineNum, matchedLine] = match;

                    if (!fileMatches.has(filePath)) {
                        fileMatches.set(filePath, {
                            name: path.basename(filePath),
                            matches: []
                        });
                    }

                    // Find match position in line
                    const searchPattern = options.useRegex
                        ? new RegExp(options.query, options.caseSensitive ? 'g' : 'gi')
                        : new RegExp(options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options.caseSensitive ? 'g' : 'gi');

                    const lineMatch = searchPattern.exec(matchedLine);
                    const matchStart = lineMatch ? lineMatch.index : 0;
                    const matchEnd = lineMatch ? matchStart + lineMatch[0].length : 0;

                    fileMatches.get(filePath)!.matches.push({
                        line: parseInt(lineNum, 10),
                        text: matchedLine,
                        matchStart,
                        matchEnd
                    });
                }
            }

            // Convert to array
            const matchedFiles = Array.from(fileMatches.entries()).map(([filePath, data]) => ({
                path: filePath,
                name: data.name,
                matches: data.matches
            }));

            return { files: matchedFiles };
        } catch (error: any) {
            // Check if command not found
            if (error.message && error.message.includes('command not found')) {
                throw new Error('The "grep" command is not available on the remote server. Please ensure it is installed or use a different search method.');
            }
            throw error;
        } finally {
            pool.releaseConnection(this._currentHost);
        }
    }

    // ===== Port Forwarding Operations =====

    protected async handleGetPortForwardings(): Promise<void> {
        if (!this._currentHost) {
            this.postMessage({
                command: 'portForwardings',
                data: []
            });
            return;
        }

        const service = PortForwardService.getInstance();
        const forwardings = service.getForwardingsForHost(this._currentHost.id);

        this.postMessage({
            command: 'portForwardings',
            data: forwardings
        });
    }

    protected async handleStartPortForward(config: PortForwardConfig): Promise<void> {
        logger.info(`[Port Forward] Starting port forwarding: ${JSON.stringify(config)}`);

        if (!this._currentHost || !this._currentAuthConfig) {
            const errorMsg = 'No remote host connected';
            logger.error(`[Port Forward] ${errorMsg}`);
            vscode.window.showErrorMessage(errorMsg);

            this.postMessage({
                command: 'portForwardingError',
                error: errorMsg
            });
            return;
        }

        try {
            const service = PortForwardService.getInstance();
            const forwarding = await service.startForwarding(
                this._currentHost,
                this._currentAuthConfig,
                config
            );

            logger.info(`[Port Forward] Successfully started: ${JSON.stringify(forwarding)}`);

            vscode.window.showInformationMessage(
                `Port forwarding started: localhost:${forwarding.localPort} → ${this._currentHost.host}:${forwarding.remotePort}`
            );

            this.postMessage({
                command: 'portForwardingStarted',
                data: forwarding
            });

            // Refresh list
            await this.handleGetPortForwardings();
        } catch (error: any) {
            logger.error(`[Port Forward] Failed to start port forwarding: ${error.message}`, error);
            vscode.window.showErrorMessage(`Failed to start port forwarding: ${error.message}`);

            this.postMessage({
                command: 'portForwardingError',
                error: error.message
            });
        }
    }

    protected async handleStartRemoteForward(config: RemoteForwardConfig): Promise<void> {
        logger.info(`[Remote Forward] Starting remote forwarding: ${JSON.stringify(config)}`);

        if (!this._currentHost || !this._currentAuthConfig) {
            const errorMsg = 'No remote host connected';
            logger.error(`[Remote Forward] ${errorMsg}`);
            vscode.window.showErrorMessage(errorMsg);

            this.postMessage({
                command: 'portForwardingError',
                error: errorMsg
            });
            return;
        }

        try {
            const service = PortForwardService.getInstance();
            const forwarding = await service.startRemoteForwarding(
                this._currentHost,
                this._currentAuthConfig,
                config
            );

            logger.info(`[Remote Forward] Successfully started: ${JSON.stringify(forwarding)}`);

            vscode.window.showInformationMessage(
                `Remote forwarding started: ${this._currentHost.host}:${forwarding.remotePort} → localhost:${forwarding.localPort}`
            );

            this.postMessage({
                command: 'portForwardingStarted',
                data: forwarding
            });

            // Refresh list
            await this.handleGetPortForwardings();
        } catch (error: any) {
            logger.error(`[Remote Forward] Failed to start remote forwarding: ${error.message}`, error);
            vscode.window.showErrorMessage(`Failed to start remote forwarding: ${error.message}`);

            this.postMessage({
                command: 'portForwardingError',
                error: error.message
            });
        }
    }

    protected async handleStartDynamicForward(config: DynamicForwardConfig): Promise<void> {
        logger.info(`[Dynamic Forward] Starting dynamic forwarding: ${JSON.stringify(config)}`);

        if (!this._currentHost || !this._currentAuthConfig) {
            const errorMsg = 'No remote host connected';
            logger.error(`[Dynamic Forward] ${errorMsg}`);
            vscode.window.showErrorMessage(errorMsg);

            this.postMessage({
                command: 'portForwardingError',
                error: errorMsg
            });
            return;
        }

        try {
            const service = PortForwardService.getInstance();
            const forwarding = await service.startDynamicForwarding(
                this._currentHost,
                this._currentAuthConfig,
                config
            );

            logger.info(`[Dynamic Forward] Successfully started: ${JSON.stringify(forwarding)}`);

            vscode.window.showInformationMessage(
                `Dynamic forwarding (SOCKS5) started: localhost:${forwarding.localPort}`
            );

            this.postMessage({
                command: 'portForwardingStarted',
                data: forwarding
            });

            // Refresh list
            await this.handleGetPortForwardings();
        } catch (error: any) {
            logger.error(`[Dynamic Forward] Failed to start dynamic forwarding: ${error.message}`, error);
            vscode.window.showErrorMessage(`Failed to start dynamic forwarding: ${error.message}`);

            this.postMessage({
                command: 'portForwardingError',
                error: error.message
            });
        }
    }

    protected async handleStopPortForward(id: string): Promise<void> {
        try {
            const service = PortForwardService.getInstance();
            await service.stopForwarding(id);

            vscode.window.showInformationMessage('Port forwarding stopped');

            this.postMessage({
                command: 'portForwardingStopped',
                id
            });

            // Refresh list
            await this.handleGetPortForwardings();
        } catch (error: any) {
            logger.error(`Failed to stop port forwarding: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to stop port forwarding: ${error.message}`);
        }
    }

    protected async handleDeletePortForward(id: string): Promise<void> {
        try {
            const service = PortForwardService.getInstance();
            await service.deleteForwarding(id);

            // Notify frontend about deletion
            this.postMessage({
                command: 'portForwardingDeleted',
                id
            });

            // Refresh list
            await this.handleGetPortForwardings();
        } catch (error: any) {
            logger.error(`Failed to delete port forwarding: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to delete port forwarding: ${error.message}`);
        }
    }

    protected async handleScanRemotePorts(): Promise<void> {
        if (!this._currentHost || !this._currentAuthConfig) {
            vscode.window.showErrorMessage('No remote host connected');
            return;
        }

        try {
            const service = PortForwardService.getInstance();
            const remotePorts = await service.scanRemotePorts(
                this._currentHost,
                this._currentAuthConfig
            );

            this.postMessage({
                command: 'remotePorts',
                data: remotePorts
            });
        } catch (error: any) {
            logger.error(`Failed to scan remote ports: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to scan remote ports: ${error.message}`);

            this.postMessage({
                command: 'remotePorts',
                data: []
            });
        }
    }

    protected async handleScanLocalPorts(): Promise<void> {
        try {
            const service = PortForwardService.getInstance();
            const localPorts = await service.scanLocalPorts();

            this.postMessage({
                command: 'localPorts',
                data: localPorts
            });
        } catch (error: any) {
            logger.error(`Failed to scan local ports: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to scan local ports: ${error.message}`);

            this.postMessage({
                command: 'localPorts',
                data: []
            });
        }
    }

    protected async handleGetFolderDetails(data: { path: string; panel: string }): Promise<void> {
        try {
            const { path: folderPath, panel } = data;

            if (panel === 'local') {
                // Get local folder details
                try {
                    const stat = await fs.promises.stat(folderPath);
                    const entries = await fs.promises.readdir(folderPath);

                    const folders: string[] = [];
                    const files: string[] = [];

                    for (const entry of entries) {
                        const entryPath = path.join(folderPath, entry);
                        try {
                            const entryStat = await fs.promises.stat(entryPath);
                            if (entryStat.isDirectory()) {
                                folders.push(entry);
                            } else {
                                files.push(entry);
                            }
                        } catch {
                            // Skip entries we can't access
                        }
                    }

                    // Calculate folder size (approximate - just count direct files)
                    let totalSize = 0;
                    for (const file of entries) {
                        const filePath = path.join(folderPath, file);
                        try {
                            const fileStat = await fs.promises.stat(filePath);
                            if (!fileStat.isDirectory()) {
                                totalSize += fileStat.size;
                            }
                        } catch {
                            // Skip files we can't access
                        }
                    }

                    this.postMessage({
                        command: 'folderDetails',
                        data: {
                            name: path.basename(folderPath),
                            modifiedTime: stat.mtime.toISOString(),
                            size: totalSize,
                            folders: [...folders].sort((a, b) => a.localeCompare(b)),
                            files: [...files].sort((a, b) => a.localeCompare(b))
                        }
                    });
                } catch (error: any) {
                    logger.error(`Failed to get local folder details: ${error.message}`);
                }
            } else if (panel === 'remote') {
                // Get remote folder details
                if (!this._currentHost || !this._currentAuthConfig) {
                    return;
                }

                try {
                    // Use existing listRemoteFiles method which handles connection pooling
                    const items = await SshConnectionManager.listRemoteFiles(
                        this._currentHost,
                        this._currentAuthConfig,
                        folderPath
                    );

                    const folders: string[] = [];
                    const files: string[] = [];
                    let totalSize = 0;
                    let latestMtime = 0;

                    for (const item of items) {
                        if (item.name === '.' || item.name === '..') {
                            continue;
                        }

                        if (item.type === 'directory') {
                            folders.push(item.name);
                        } else {
                            files.push(item.name);
                            totalSize += item.size || 0;
                        }

                        // Track latest modification time
                        if (item.mtime && item.mtime > latestMtime) {
                            latestMtime = item.mtime;
                        }
                    }

                    // Get the folder name from path
                    const parts = folderPath.split('/').filter(Boolean);
                    const folderName = parts.length > 0 ? parts[parts.length - 1] : folderPath;

                    this.postMessage({
                        command: 'folderDetails',
                        data: {
                            name: folderName,
                            modifiedTime: latestMtime > 0 ? new Date(latestMtime * 1000).toISOString() : new Date().toISOString(),
                            size: totalSize,
                            folders: [...folders].sort((a, b) => a.localeCompare(b)),
                            files: [...files].sort((a, b) => a.localeCompare(b))
                        }
                    });
                } catch (error: any) {
                    logger.error(`Failed to get remote folder details: ${error.message}`);
                }
            }
        } catch (error: any) {
            logger.error(`Failed to get folder details: ${error.message}`);
        }
    }

    protected async handleOpenBrowser(address: string): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('simpleSftp.portForwarding');
            const browserType = config.get<string>('browserType', 'simple-browser');
            const defaultProtocol = config.get<string>('defaultProtocol', 'http');

            // Add protocol if not present
            let url = address;
            if (!url.match(/^https?:\/\//)) {
                url = `${defaultProtocol}://${address}`;
            }

            if (browserType === 'simple-browser') {
                // Use VS Code Simple Browser
                await vscode.commands.executeCommand('simpleBrowser.show', url);
                logger.info(`Opened in Simple Browser: ${url}`);
            } else {
                // Use external browser
                await vscode.env.openExternal(vscode.Uri.parse(url));
                logger.info(`Opened in external browser: ${url}`);
            }
        } catch (error: any) {
            logger.error(`Failed to open browser: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to open browser: ${error.message}`);
        }
    }
}
