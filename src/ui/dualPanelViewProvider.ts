import * as vscode from 'vscode';
import { HostConfig } from '../types';
import { TransferQueueService } from '../services/transferQueueService';
import { AuthManager } from '../authManager';
import { HostManager } from '../hostManager';
import { DualPanelBase } from './dualPanelBase';
import { SftpFileSystemProvider } from '../sftpFileSystemProvider';  // ← 添加导入

/**
 * WebviewView Provider for Dual Panel File Browser
 * Displays in bottom panel area (single instance)
 */
export class DualPanelViewProvider extends DualPanelBase implements vscode.WebviewViewProvider {
    public static readonly viewType = 'simpleSftp.dualPanelBrowser';

    private _view?: vscode.WebviewView;

    constructor(
        extensionUri: vscode.Uri,
        transferQueueService: TransferQueueService,
        authManager: AuthManager,
        hostManager: HostManager,
        sftpFsProvider?: SftpFileSystemProvider  // ← 添加参数
    ) {
        super(extensionUri, transferQueueService, authManager, hostManager, sftpFsProvider);
    }

    /**
     * Post message to webview
     */
    protected postMessage(message: any): void {
        this._view?.webview.postMessage(message);
    }

    /**
     * Get current webview
     */
    protected getWebview(): vscode.Webview | undefined {
        return this._view?.webview;
    }

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
     * Post message to webview
     */
    public postMessageToWebview(message: any): void {
        this._view?.webview.postMessage(message);
    }

    /**
     * Override openForHost to ensure panel is visible
     */
    public async openForHost(host: HostConfig, initialPath?: string): Promise<void> {
        // Show the panel if not visible
        if (!this._view?.visible) {
            await vscode.commands.executeCommand('simpleSftp.dualPanelBrowser.focus');
        }

        // Call base implementation
        await super.openForHost(host, initialPath);
    }

    /**
     * Execute commands with view availability check
     */
    public async executeRefresh(args: any): Promise<void> {
        if (!this._view) {
            await this.ensureViewVisible();
            if (!this._view) {
                return;
            }
        }
        await super.executeRefresh(args);
    }

    public async executeRename(args: any): Promise<void> {
        if (!this._view) {
            await this.ensureViewVisible();
            if (!this._view) {
                return;
            }
        }
        await super.executeRename(args);
    }

    public async executeBatchRename(args: any): Promise<void> {
        if (!this._view) {
            await this.ensureViewVisible();
            if (!this._view) {
                return;
            }
        }
        await super.executeBatchRename(args);
    }

    public async executeDelete(args: any): Promise<void> {
        if (!this._view) {
            await this.ensureViewVisible();
            if (!this._view) {
                return;
            }
        }
        await super.executeDelete(args);
    }

    public async executeCreateFolder(args: any): Promise<void> {
        if (!this._view) {
            await this.ensureViewVisible();
            if (!this._view) {
                return;
            }
        }
        await super.executeCreateFolder(args);
    }

    public async executeUpload(args: any): Promise<void> {
        if (!this._view) {
            await this.ensureViewVisible();
            if (!this._view) {
                return;
            }
        }
        await super.executeUpload(args);
    }

    public async executeDownload(args: any): Promise<void> {
        if (!this._view) {
            await this.ensureViewVisible();
            if (!this._view) {
                return;
            }
        }
        await super.executeDownload(args);
    }

    public async executeChangePermissions(args: any): Promise<void> {
        if (!this._view) {
            await this.ensureViewVisible();
            if (!this._view) {
                return;
            }
        }
        await super.executeChangePermissions(args);
    }

    public selectFileForCompare(context: any): void {
        if (!this._view) {
            vscode.window.showWarningMessage('Please open the file browser panel first');
            return;
        }
        super.selectFileForCompare(context);
    }

    public compareWithSelected(context: any): void {
        if (!this._view) {
            vscode.window.showWarningMessage('Please open the file browser panel first');
            return;
        }
        super.compareWithSelected(context);
    }

    /**
     * Check if there is an active view
     */
    public hasActiveView(): boolean {
        return this._view !== undefined;
    }

    /**
     * Ensure the view is visible
     */
    private async ensureViewVisible(): Promise<void> {
        if (!this._view) {
            await vscode.commands.executeCommand('simpleSftp.dualPanelBrowser.focus');
            // Give VS Code some time to create the view
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
}
