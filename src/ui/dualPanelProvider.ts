import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { HostConfig } from '../types';
import { SshConnectionManager } from '../sshConnectionManager';
import { TransferQueueService } from '../services/transferQueueService';
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

export class DualPanelProvider {
    public static readonly viewType = 'simpleSftp.dualPanelBrowser';
    private static _instance?: DualPanelProvider;

    private _panel?: vscode.WebviewPanel;
    private _currentHost?: HostConfig;
    private _currentAuthConfig?: any;
    private _localRootPath?: string;
    private _remoteRootPath?: string;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly transferQueueService: TransferQueueService
    ) {}

    /**
     * Create or show the dual panel browser
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        host: HostConfig,
        authConfig: any,
        transferQueueService: TransferQueueService
    ): void {
        // Create instance if it doesn't exist
        DualPanelProvider._instance ??= new DualPanelProvider(
            extensionUri,
            transferQueueService
        );

        // Open for the specific host
        DualPanelProvider._instance._openForHost(host, authConfig);
    }

    /**
     * Open dual panel browser for a specific host in a new panel
     */
    private async _openForHost(host: HostConfig, authConfig: any) {
        this._currentHost = host;
        this._currentAuthConfig = authConfig;
        this._remoteRootPath = host.defaultRemotePath || '/';

        // Get workspace folder as local root
        const workspaceFolders = vscode.workspace.workspaceFolders;
        this._localRootPath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '/';

        // Create or reveal panel
        if (this._panel) {
            this._panel.reveal();
        } else {
            this._panel = vscode.window.createWebviewPanel(
                DualPanelProvider.viewType,
                `SFTP: ${host.name}`,
                vscode.ViewColumn.Beside,  // Open beside current editor
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this._extensionUri, 'resources'),
                        vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
                    ]
                }
            );

            // Set HTML content
            this._panel.webview.html = this.getHtmlForWebview(this._panel.webview);

            // Handle messages from webview
            this._panel.webview.onDidReceiveMessage(async (message) => {
                await this._handleMessage(message);
            });

            // Clean up when panel is disposed
            this._panel.onDidDispose(() => {
                this._panel = undefined;
            }, null);
        }

        // Initialize both panels
        await this._loadLocalDirectory(this._localRootPath);
        await this._loadRemoteDirectory(this._remoteRootPath);

        // Listen to transfer queue changes
        this.transferQueueService.onTaskAdded(() => {
            this.updateQueueStatus();
        });
        this.transferQueueService.onTaskUpdated(() => {
            this.updateQueueStatus();
        });
    }

    private async _handleMessage(message: any) {
        switch (message.command) {
            case 'ready':
                // WebView ready, initialize if host is set
                if (this._currentHost && this._localRootPath && this._remoteRootPath) {
                    await this._loadLocalDirectory(this._localRootPath);
                    await this._loadRemoteDirectory(this._remoteRootPath);
                }
                break;

            case 'loadLocalDir':
                await this._loadLocalDirectory(message.path);
                break;

            case 'loadRemoteDir':
                await this._loadRemoteDirectory(message.path);
                break;

            case 'upload':
                await this._handleUpload(message.data.localPath, message.data.remotePath);
                break;

            case 'download':
                await this._handleDownload(message.data.remotePath, message.data.localPath);
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
                    await this._loadLocalDirectory(this._localRootPath);
                }
                break;

            case 'refreshRemote':
                if (this._remoteRootPath) {
                    await this._loadRemoteDirectory(this._remoteRootPath);
                }
                break;
        }
    }

    // ===== Local File System Operations =====

    private async _loadLocalDirectory(dirPath: string): Promise<void> {
        try {
            const nodes = await this._readLocalDirectory(dirPath);

            this._panel?.webview.postMessage({
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

    private async _readLocalDirectory(dirPath: string): Promise<FileNode[]> {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        const nodes: FileNode[] = [];

        for (const entry of entries) {
            // Skip hidden files based on settings
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

        // Sort: directories first, then files, alphabetically
        return nodes.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
    }

    // ===== Remote File System Operations =====

    private async _loadRemoteDirectory(dirPath: string): Promise<void> {
        if (!this._currentHost) {
            vscode.window.showErrorMessage('No host selected');
            return;
        }

        if (!this._currentAuthConfig) {
            vscode.window.showErrorMessage('Authentication not configured for this host');
            return;
        }

        try {
            const nodes = await this._readRemoteDirectory(this._currentHost, this._currentAuthConfig, dirPath);

            this._panel?.webview.postMessage({
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

    private async _readRemoteDirectory(
        host: HostConfig,
        authConfig: any,
        dirPath: string
    ): Promise<FileNode[]> {
        // Use SshConnectionManager.listRemoteFiles to get file list
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

        // Filter hidden files
        const filteredNodes = nodes.filter(node => {
            if (node.name.startsWith('.') && !this.shouldShowDotFiles()) {
                return false;
            }
            return true;
        });

        // Sort: directories first, then files
        return filteredNodes.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
    }

    // ===== Transfer Operations =====

    private async _handleUpload(localPath: string, remotePath: string): Promise<void> {
        if (!this._currentHost) return;

        try {
            const stat = await fs.promises.stat(localPath);
            const isDirectory = stat.isDirectory();

            // Determine target remote path
            const targetPath = path.posix.join(remotePath, path.basename(localPath));

            // Add to transfer queue
            this.transferQueueService.addTask({
                type: 'upload',
                localPath: localPath,
                remotePath: targetPath,
                hostId: this._currentHost.id,
                fileSize: isDirectory ? 0 : stat.size,
                priority: 'normal'
            });

            this.updateStatus(`Uploading ${path.basename(localPath)}...`);
        } catch (error) {
            logger.error(`Upload failed: ${error}`);
            vscode.window.showErrorMessage(`Upload failed: ${error}`);
        }
    }

    private async _handleDownload(remotePath: string, localPath: string): Promise<void> {
        if (!this._currentHost) return;
        if (!this._currentAuthConfig) return;

        try {
            // Determine target local path
            const targetPath = path.join(localPath, path.basename(remotePath));

            // Add to transfer queue (the queue will handle getting file size)
            this.transferQueueService.addTask({
                type: 'download',
                localPath: targetPath,
                remotePath: remotePath,
                hostId: this._currentHost.id,
                fileSize: 0, // Size will be determined during transfer
                priority: 'normal'
            });

            this.updateStatus(`Downloading ${path.basename(remotePath)}...`);
        } catch (error) {
            logger.error(`Download failed: ${error}`);
            vscode.window.showErrorMessage(`Download failed: ${error}`);
        }
    }

    // ===== Other Operations =====
    // Note: Create, delete, rename operations are simplified for MVP
    // They will be implemented in future versions with proper SFTP operations

    private async handleCreateFolder(data: any): Promise<void> {
        const { parentPath, name, panel } = data;

        try {
            if (panel === 'local') {
                const folderPath = path.join(parentPath, name);
                await fs.promises.mkdir(folderPath, { recursive: true });
                await this._loadLocalDirectory(parentPath);
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
                await this._loadLocalDirectory(path.dirname(itemPath));
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
                await this._loadLocalDirectory(parentPath);
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
                // Download to temp and open - planned for future version
                vscode.window.showInformationMessage('Opening remote files not yet implemented');
            }
        } catch (error) {
            logger.error(`Open file failed: ${error}`);
            vscode.window.showErrorMessage(`Open file failed: ${error}`);
        }
    }

    // ===== UI Updates =====

    private updateStatus(text: string): void {
        this._panel?.webview.postMessage({
            command: 'updateStatus',
            text: text
        });
    }

    private updateQueueStatus(): void {
        const activeCount = this.transferQueueService.getActiveTaskCount();
        this._panel?.webview.postMessage({
            command: 'updateQueue',
            count: activeCount
        });
    }

    // ===== Settings =====

    private shouldShowDotFiles(): boolean {
        return vscode.workspace.getConfiguration('simpleSftp').get('showDotFiles', true);
    }

    // ===== HTML Generation =====

    private getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'dual-panel-browser.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'dual-panel-browser.css')
        );
        // Use VS Code's built-in codicons
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
        );

        const nonce = this.getNonce();

        const htmlPath = path.join(this._extensionUri.fsPath, 'resources', 'webview', 'dual-panel-browser.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        // Replace placeholders
        html = html.replaceAll('{{cspSource}}', webview.cspSource);
        html = html.replaceAll('{{nonce}}', nonce);
        html = html.replaceAll('{{styleUri}}', styleUri.toString());
        html = html.replaceAll('{{scriptUri}}', scriptUri.toString());
        html = html.replaceAll('{{codiconsUri}}', codiconsUri.toString());
        html = html.replaceAll('{{localPath}}', this._localRootPath || '');
        html = html.replaceAll('{{remotePath}}', this._remoteRootPath || '');

        return html;
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
