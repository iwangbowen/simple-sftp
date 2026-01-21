import * as vscode from 'vscode';
import { HostConfig } from '../types';
import { TransferQueueService } from '../services/transferQueueService';
import { AuthManager } from '../authManager';
import { HostManager } from '../hostManager';
import { DualPanelBase } from './dualPanelBase';

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
        hostManager: HostManager
    ) {
        super(extensionUri, transferQueueService, authManager, hostManager);
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
}
