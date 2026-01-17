import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { HostConfig } from '../types';
import { SshConnectionManager } from '../sshConnectionManager';
import { TransferQueueService } from '../services/transferQueueService';
import { AuthManager } from '../authManager';
import { HostManager } from '../hostManager';
import { logger } from '../logger';

interface FileNode {
    name: string;
    path: string;
    isDirectory: boolean;
    size?: number;
    modifiedTime?: Date;
    expanded?: boolean;
    children?: FileNode[];
}

/**
 * WebviewView Provider for Dual Panel File Browser
 * Displays in bottom panel area
 */
export class DualPanelViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'simpleSftp.dualPanelBrowser';

    private _view?: vscode.WebviewView;
    private _currentHost?: HostConfig;
    private _currentAuthConfig?: any;
    private _localRootPath?: string;
    private _remoteRootPath?: string;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly transferQueueService: TransferQueueService,
        private readonly authManager: AuthManager,
        private readonly hostManager: HostManager
    ) {}

    /**
     * Resolve webview view when it becomes visible
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'resources'),
                vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
            ]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        });

        // Listen to transfer queue changes
        this.transferQueueService.onQueueChanged(() => {
            this.updateQueueStatus();
        });
        this.transferQueueService.onTaskUpdated(() => {
            this.updateQueueStatus();
        });
    }

    /**
     * Open dual panel for a specific host
     */
    public async openForHost(host: HostConfig): Promise<void> {
        this._currentHost = host;
        this._currentAuthConfig = await this.authManager.getAuth(host.id);
        this._remoteRootPath = host.defaultRemotePath || '/';

        // Get workspace folder as local root
        const workspaceFolders = vscode.workspace.workspaceFolders;
        this._localRootPath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '/';

        // Show the panel if not visible
        if (!this._view?.visible) {
            await vscode.commands.executeCommand('simpleSftp.dualPanelBrowser.focus');
        }

        // Initialize both panels
        if (this._view) {
            await this.loadLocalDirectory(this._localRootPath);
            await this.loadRemoteDirectory(this._remoteRootPath);
        }
    }

    private async handleMessage(message: any) {
        switch (message.command) {
            case 'ready':
                if (this._currentHost && this._localRootPath && this._remoteRootPath) {
                    await this.loadLocalDirectory(this._localRootPath);
                    await this.loadRemoteDirectory(this._remoteRootPath);
                } else {
                    // 显示主机选择界面
                    await this.showHostSelection();
                }
                break;

            case 'selectHost':
                const hostId = message.hostId;
                const hosts = await this.hostManager.getHosts();
                const selectedHost = hosts.find(h => h.id === hostId);
                if (selectedHost) {
                    await this.openForHost(selectedHost);
                }
                break;

            case 'loadLocalDir':
                await this.loadLocalDirectory(message.path);
                break;

            case 'loadRemoteDir':
                await this.loadRemoteDirectory(message.path);
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

            case 'rename':
                await this.handleRename(message.data);
                break;

            case 'openFile':
                await this.handleOpenFile(message.data);
                break;

            case 'refreshLocal':
                if (this._localRootPath) {
                    await this.loadLocalDirectory(this._localRootPath);
                }
                break;

            case 'refreshRemote':
                if (this._remoteRootPath) {
                    await this.loadRemoteDirectory(this._remoteRootPath);
                }
                break;
        }
    }

    // ===== Local File System Operations =====

    private async loadLocalDirectory(dirPath: string): Promise<void> {
        try {
            const nodes = await this.readLocalDirectory(dirPath);

            this._view?.webview.postMessage({
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

    private async readLocalDirectory(dirPath: string): Promise<FileNode[]> {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        const nodes: FileNode[] = [];

        for (const entry of entries) {
            if (entry.name.startsWith('.') && !this.shouldShowDotFiles()) {
                continue;
            }

            const fullPath = path.join(dirPath, entry.name);
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
        }

        return nodes.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
    }

    // ===== Remote File System Operations =====

    private async loadRemoteDirectory(dirPath: string): Promise<void> {
        if (!this._currentHost || !this._currentAuthConfig) {
            vscode.window.showErrorMessage('No host selected or authentication not configured');
            return;
        }

        try {
            const nodes = await this.readRemoteDirectory(this._currentHost, this._currentAuthConfig, dirPath);

            this._view?.webview.postMessage({
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

    private async readRemoteDirectory(
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
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
    }

    // ===== Transfer Operations =====

    private async handleUpload(localPath: string, remotePath: string): Promise<void> {
        if (!this._currentHost) return;

        try {
            const stat = await fs.promises.stat(localPath);
            const targetPath = path.posix.join(remotePath, path.basename(localPath));

            this.transferQueueService.addTask({
                type: 'upload',
                localPath: localPath,
                remotePath: targetPath,
                hostId: this._currentHost.id,
                fileSize: stat.isDirectory() ? 0 : stat.size,
                priority: 'normal'
            });

            this.updateStatus(`Uploading ${path.basename(localPath)}...`);
        } catch (error) {
            logger.error(`Upload failed: ${error}`);
            vscode.window.showErrorMessage(`Upload failed: ${error}`);
        }
    }

    private async handleDownload(remotePath: string, localPath: string): Promise<void> {
        if (!this._currentHost) return;

        try {
            const targetPath = path.join(localPath, path.basename(remotePath));

            this.transferQueueService.addTask({
                type: 'download',
                localPath: targetPath,
                remotePath: remotePath,
                hostId: this._currentHost.id,
                fileSize: 0,
                priority: 'normal'
            });

            this.updateStatus(`Downloading ${path.basename(remotePath)}...`);
        } catch (error) {
            logger.error(`Download failed: ${error}`);
            vscode.window.showErrorMessage(`Download failed: ${error}`);
        }
    }

    // ===== Other Operations =====

    private async handleCreateFolder(data: any): Promise<void> {
        const { parentPath, name, panel } = data;

        try {
            if (panel === 'local') {
                const folderPath = path.join(parentPath, name);
                await fs.promises.mkdir(folderPath, { recursive: true });
                await this.loadLocalDirectory(parentPath);
                this.updateStatus(`Created folder: ${name}`);
            } else if (panel === 'remote') {
                vscode.window.showInformationMessage('Creating remote folders is not yet implemented');
            }
        } catch (error) {
            logger.error(`Create folder failed: ${error}`);
            vscode.window.showErrorMessage(`Create folder failed: ${error}`);
        }
    }

    private async handleDelete(data: any): Promise<void> {
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
                vscode.window.showInformationMessage('Deleting remote files is not yet implemented');
            }
        } catch (error) {
            logger.error(`Delete failed: ${error}`);
            vscode.window.showErrorMessage(`Delete failed: ${error}`);
        }
    }

    private async handleRename(data: any): Promise<void> {
        const { path: oldPath, newName, panel } = data;
        const parentPath = panel === 'local' ? path.dirname(oldPath) : path.posix.dirname(oldPath);
        const newPath = panel === 'local' ? path.join(parentPath, newName) : path.posix.join(parentPath, newName);

        try {
            if (panel === 'local') {
                await fs.promises.rename(oldPath, newPath);
                await this.loadLocalDirectory(parentPath);
                this.updateStatus(`Renamed to: ${newName}`);
            } else if (panel === 'remote') {
                vscode.window.showInformationMessage('Renaming remote files is not yet implemented');
            }
        } catch (error) {
            logger.error(`Rename failed: ${error}`);
            vscode.window.showErrorMessage(`Rename failed: ${error}`);
        }
    }

    private async handleOpenFile(data: any): Promise<void> {
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

    private updateStatus(text: string): void {
        this._view?.webview.postMessage({
            command: 'updateStatus',
            text: text
        });
    }

    private updateQueueStatus(): void {
        const activeCount = this.transferQueueService.getActiveTaskCount();
        this._view?.webview.postMessage({
            command: 'updateQueue',
            count: activeCount
        });
    }

    // ===== Settings =====

    private shouldShowDotFiles(): boolean {
        return vscode.workspace.getConfiguration('simpleSftp').get('showDotFiles', true);
    }

    /**
     * 显示主机选择界面
     */
    private async showHostSelection(): Promise<void> {
        const hosts = await this.hostManager.getHosts();
        this._view?.webview.postMessage({
            command: 'showHostSelection',
            hosts: hosts.map(h => ({
                id: h.id,
                name: h.name,
                host: h.host,
                username: h.username,
                port: h.port,
                group: h.group
            }))
        });
    }

    /**
     * 公共方法供外部命令调用
     */
    /**
     * 公共方法供外部命令调用
     */
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

    private getHtmlForWebview(webview: vscode.Webview) {
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

    private getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
