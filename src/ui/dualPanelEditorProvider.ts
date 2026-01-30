import * as vscode from 'vscode';
import { HostConfig } from '../types';
import { TransferQueueService } from '../services/transferQueueService';
import { AuthManager } from '../authManager';
import { HostManager } from '../hostManager';
import { DualPanelBase } from './dualPanelBase';
import { UI } from '../constants';
import { SftpFileSystemProvider } from '../sftpFileSystemProvider';  // ← 添加导入

/**
 * Manager for dual panel file browser in editor area
 * Supports multiple webview panel instances (one per host)
 */
export class DualPanelEditorManager extends DualPanelBase {
    // Map of host ID to webview panel
    private readonly panels: Map<string, vscode.WebviewPanel> = new Map();
    // Current active panel reference
    private currentPanel?: vscode.WebviewPanel;

    constructor(
        extensionUri: vscode.Uri,
        transferQueueService: TransferQueueService,
        authManager: AuthManager,
        hostManager: HostManager,
        sftpFsProvider?: SftpFileSystemProvider  // ← 添加参数
    ) {
        super(extensionUri, transferQueueService, authManager, hostManager, sftpFsProvider);

        // Subscribe to queue changes for all panels
        this.transferQueueService.onQueueChanged(() => {
            this.updateQueueStatusForAllPanels();
        });
        this.transferQueueService.onTaskUpdated(() => {
            this.updateQueueStatusForAllPanels();
        });
    }

    /**
     * Post message to current active webview panel
     */
    protected postMessage(message: any): void {
        this.currentPanel?.webview.postMessage(message);
    }

    /**
     * Get current active webview
     */
    protected getWebview(): vscode.Webview | undefined {
        return this.currentPanel?.webview;
    }

    /**
     * Open dual panel for a specific host
     * Reuses existing panel if already open for this host
     */
    public async openForHost(host: HostConfig, initialPath?: string): Promise<void> {
        // Check if panel already exists for this host
        let panel = this.panels.get(host.id);

        if (panel) {
            // Panel exists, reveal it and update path if needed
            panel.reveal(vscode.ViewColumn.One);
            this.currentPanel = panel;

            // If initial path provided, navigate to it
            if (initialPath) {
                await super.openForHost(host, initialPath);
            }
        } else {
            // Create new panel for this host
            panel = vscode.window.createWebviewPanel(
                'simpleSftp.dualPanelBrowser',  // Use same viewType as WebviewView for context menu compatibility
                `${host.name}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this._extensionUri, 'resources'),
                        vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
                    ]
                }
            );

            // Set custom icon for the panel (use VS Code built-in icon)
            panel.iconPath = new vscode.ThemeIcon(UI.ICONS.DUAL_PANEL_BROWSER);

            this.panels.set(host.id, panel);
            this.currentPanel = panel;

            // Set HTML content
            panel.webview.html = this.getHtmlForWebview(panel.webview);

            // Handle messages from this panel
            panel.webview.onDidReceiveMessage(async (message) => {
                // Set this panel as active before handling message
                this.currentPanel = panel;
                await this.handleMessage(message);
            });

            // Clean up when panel is disposed
            panel.onDidDispose(() => {
                this.panels.delete(host.id);
                if (this.currentPanel === panel) {
                    this.currentPanel = undefined;
                }
            });

            // Open for the host
            await super.openForHost(host, initialPath);
        }
    }

    /**
     * Update queue status for all open panels
     */
    private updateQueueStatusForAllPanels(): void {
        const activeCount = this.transferQueueService.getActiveTaskCount();

        for (const [, panel] of this.panels) {
            panel.webview.postMessage({
                command: 'updateQueue',
                count: activeCount
            });
        }
    }

    /**
     * Execute commands on the active panel
     */
    public async executeRefresh(args: any): Promise<void> {
        if (!this.currentPanel) {
            vscode.window.showWarningMessage('No active file browser panel');
            return;
        }
        await super.executeRefresh(args);
    }

    public async executeRename(args: any): Promise<void> {
        if (!this.currentPanel) {
            vscode.window.showWarningMessage('No active file browser panel');
            return;
        }
        await super.executeRename(args);
    }

    public async executeBatchRename(args: any): Promise<void> {
        if (!this.currentPanel) {
            vscode.window.showWarningMessage('No active file browser panel');
            return;
        }
        await super.executeBatchRename(args);
    }

    public async executeDelete(args: any): Promise<void> {
        if (!this.currentPanel) {
            vscode.window.showWarningMessage('No active file browser panel');
            return;
        }
        await super.executeDelete(args);
    }

    public async executeCreateFolder(args: any): Promise<void> {
        if (!this.currentPanel) {
            vscode.window.showWarningMessage('No active file browser panel');
            return;
        }
        await super.executeCreateFolder(args);
    }

    public async executeUpload(args: any): Promise<void> {
        if (!this.currentPanel) {
            vscode.window.showWarningMessage('No active file browser panel');
            return;
        }
        await super.executeUpload(args);
    }

    public async executeDownload(args: any): Promise<void> {
        if (!this.currentPanel) {
            vscode.window.showWarningMessage('No active file browser panel');
            return;
        }
        await super.executeDownload(args);
    }

    /**
     * Get count of open panels
     */
    public getPanelCount(): number {
        return this.panels.size;
    }

    /**     * Post message to current active panel
     */
    public postMessageToWebview(message: any): void {
        this.currentPanel?.webview.postMessage(message);
    }

    /**
     * Check if there is an active panel
     */
    public hasActivePanel(): boolean {
        return this.currentPanel !== undefined;
    }

    /**     * Close all panels
     */
    public dispose(): void {
        for (const [, panel] of this.panels) {
            panel.dispose();
        }
        this.panels.clear();
        this.currentPanel = undefined;
    }
}
