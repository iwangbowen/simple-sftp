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

            case 'upload':
                await this.handleUpload(message.data.localPath, message.data.remotePath);
                break;

            case 'requestFolderName':
                await this.handleRequestFolderName(message.data);
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

                nodes.push({
                    name: entry.name,
                    path: fullPath,
                    isDirectory: entry.isDirectory(),
                    size: entry.isFile() ? stats.size : undefined,
                    modifiedTime: stats.mtime,
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

    protected async handleRequestFolderName(data: any): Promise<void> {
        const { panel, currentPath } = data;

        const folderName = await vscode.window.showInputBox({
            prompt: `Enter folder name for ${panel} panel`,
            placeHolder: 'Folder name',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Folder name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Folder name cannot contain / or \\';
                }
                return null;
            }
        });

        if (!folderName) {
            return;
        }

        let parentPath: string | undefined = currentPath;

        if (!parentPath) {
            if (panel === 'local') {
                parentPath = this._localRootPath;
            } else {
                parentPath = this._remoteRootPath;
            }
        }

        if (!parentPath) {
            vscode.window.showErrorMessage(`No ${panel} path selected`);
            return;
        }

        await this.handleCreateFolder({ parentPath, name: folderName, panel });
    }

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

        this.postMessage({
            command: 'showHostSelection',
            hosts: sortedHosts.map(h => {
                const groupName = h.group ? groups.find(g => g.id === h.group)?.name : undefined;
                return {
                    id: h.id,
                    name: h.name,
                    host: h.host,
                    username: h.username,
                    port: h.port,
                    group: groupName,
                    starred: h.starred,
                    bookmarks: h.bookmarks || []
                };
            })
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
        const { filePath, isDirectory, panel } = args;
        const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to delete "${path.basename(filePath)}"?`,
            { modal: true },
            'Delete'
        );

        if (confirmed === 'Delete') {
            await this.handleDelete({ path: filePath, panel, isDir: isDirectory });
        }
    }

    public async executeCreateFolder(args: any): Promise<void> {
        const { panel } = args;
        const parentPath = panel === 'local' ? this._localRootPath : this._remoteRootPath;

        const folderName = await vscode.window.showInputBox({
            prompt: 'Enter folder name',
            validateInput: (value) => {
                if (!value) {
                    return 'Folder name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Invalid characters in folder name';
                }
                return null;
            }
        });

        if (!folderName || !parentPath) {
            return;
        }

        await this.handleCreateFolder({ parentPath, name: folderName, panel });
    }

    public async executeUpload(args: any): Promise<void> {
        const { filePath } = args;
        const remotePath = this._remoteRootPath;
        if (!remotePath) {
            vscode.window.showErrorMessage('No remote path selected');
            return;
        }
        await this.handleUpload(filePath, remotePath);
    }

    public async executeDownload(args: any): Promise<void> {
        const { filePath } = args;
        const localPath = this._localRootPath;
        if (!localPath) {
            vscode.window.showErrorMessage('No local path selected');
            return;
        }
        await this.handleDownload(filePath, localPath);
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
