import * as vscode from 'vscode';
import { HostConfig } from '../types';
import { TransferQueueService } from '../services/transferQueueService';
import { AuthManager } from '../authManager';
import { HostManager } from '../hostManager';
import { DualPanelBase } from './dualPanelBase';
import { UI } from '../constants';
import { logger } from '../logger';

export interface DualPanelEditorOpenOptions {
    tabLabel?: string;
    contextKey?: string;
}

interface DualPanelEditorTarget {
    panelKey: string;
    title: string;
}

function normalizeContextPath(initialPath?: string): string | undefined {
    if (!initialPath) {
        return undefined;
    }

    const normalized = initialPath.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    if (normalized.length <= 1) {
        return normalized;
    }

    return normalized.replace(/\/+$/, '');
}

function deriveTabLabel(initialPath?: string, explicitLabel?: string): string | undefined {
    const trimmedLabel = explicitLabel?.trim();
    if (trimmedLabel) {
        return trimmedLabel;
    }

    const normalizedPath = normalizeContextPath(initialPath);
    if (!normalizedPath || normalizedPath === '/') {
        return undefined;
    }

    const segments = normalizedPath.split('/').filter(Boolean);
    return segments.at(-1) || normalizedPath;
}

export function buildDualPanelEditorTarget(
    host: HostConfig,
    initialPath?: string,
    options: DualPanelEditorOpenOptions = {}
): DualPanelEditorTarget {
    const normalizedPath = normalizeContextPath(initialPath);
    const contextKey = options.contextKey?.trim() || (normalizedPath ? `path:${normalizedPath}` : 'root');
    const tabLabel = deriveTabLabel(normalizedPath, options.tabLabel);

    return {
        panelKey: `${host.id}::${contextKey}`,
        title: tabLabel ? `${host.name} · ${tabLabel}` : host.name
    };
}

class DualPanelEditorSession extends DualPanelBase {
    constructor(
        extensionUri: vscode.Uri,
        transferQueueService: TransferQueueService,
        authManager: AuthManager,
        hostManager: HostManager,
        private readonly panel: vscode.WebviewPanel
    ) {
        super(extensionUri, transferQueueService, authManager, hostManager);

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
    }

    protected postMessage(message: any): void {
        this.panel.webview.postMessage(message);
    }

    protected getWebview(): vscode.Webview | undefined {
        return this.panel.webview;
    }

    public async handleWebviewMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'selectHost': {
                const hostId = message.hostId;
                const hosts = await this.hostManager.getHosts();
                const selectedHost = hosts.find(h => h.id === hostId);
                if (selectedHost) {
                    this.setTitle(selectedHost.name);
                    await this.openForHost(selectedHost);
                }
                return;
            }

            case 'openBookmark': {
                const bookmarkHostId = message.hostId;
                const bookmarkPath = message.path;
                const hosts = await this.hostManager.getHosts();
                const bookmarkHost = hosts.find(h => h.id === bookmarkHostId);
                if (bookmarkHost) {
                    this.setTitle(buildDualPanelEditorTarget(bookmarkHost, bookmarkPath).title);
                    await this.openForHost(bookmarkHost, bookmarkPath);
                }
                return;
            }

            default:
                await this.handleMessage(message);
        }
    }

    public getPanel(): vscode.WebviewPanel {
        return this.panel;
    }

    public reveal(column: vscode.ViewColumn = vscode.ViewColumn.One): void {
        this.panel.reveal(column);
    }

    public setTitle(title: string): void {
        this.panel.title = title;
    }

    public postMessageToWebview(message: any): void {
        this.panel.webview.postMessage(message);
    }

    public dispose(): void {
        this.panel.dispose();
    }
}

/**
 * Manager for dual panel file browser in editor area.
 * Reuses tabs for the same host/context and opens separate tabs for different contexts.
 */
export class DualPanelEditorManager {
    private readonly sessions: Map<string, DualPanelEditorSession> = new Map();
    private activeSession?: DualPanelEditorSession;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly transferQueueService: TransferQueueService,
        private readonly authManager: AuthManager,
        private readonly hostManager: HostManager
    ) {
        this.transferQueueService.onQueueChanged(() => {
            this.updateQueueStatusForAllPanels();
        });
        this.transferQueueService.onTaskUpdated(() => {
            this.updateQueueStatusForAllPanels();
        });
    }

    public async openForHost(
        host: HostConfig,
        initialPath?: string,
        options: DualPanelEditorOpenOptions = {}
    ): Promise<void> {
        const target = buildDualPanelEditorTarget(host, initialPath, options);
        let session = this.sessions.get(target.panelKey);

        logger.info(
            `[DualPanelEditorProvider] openForHost called - host: ${host.name}, initialPath: ${initialPath}, panelKey: ${target.panelKey}, panel exists: ${!!session}`
        );

        if (session) {
            session.setTitle(target.title);
            session.reveal(vscode.ViewColumn.One);
            this.activeSession = session;

            if (initialPath) {
                await session.openForHost(host, initialPath);
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'simpleSftp.dualPanelBrowser',
            target.title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.extensionUri, 'resources'),
                    vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
                ]
            }
        );

        panel.iconPath = new vscode.ThemeIcon(UI.ICONS.DUAL_PANEL_BROWSER);

        session = new DualPanelEditorSession(
            this.extensionUri,
            this.transferQueueService,
            this.authManager,
            this.hostManager,
            panel
        );

        this.sessions.set(target.panelKey, session);
        this.activeSession = session;

        panel.webview.onDidReceiveMessage(async (message) => {
            this.activeSession = session;
            await session.handleWebviewMessage(message);
        });

        panel.onDidChangeViewState((event) => {
            if (event.webviewPanel.active) {
                this.activeSession = session;
            }
        });

        panel.onDidDispose(() => {
            this.sessions.delete(target.panelKey);
            if (this.activeSession === session) {
                this.activeSession = undefined;
            }
        });

        await session.openForHost(host, initialPath);
    }

    public async switchViewMode(panel: string, mode: 'list' | 'grid'): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.switchViewMode(panel, mode);
    }

    public async executeRefresh(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executeRefresh(args);
    }

    public async executeRename(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executeRename(args);
    }

    public async executeBatchRename(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executeBatchRename(args);
    }

    public async executeDelete(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executeDelete(args);
    }

    public async executeCreateFolder(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executeCreateFolder(args);
    }

    public async executeCreateFile(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executeCreateFile(args);
    }

    public async executeUpload(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executeUpload(args);
    }

    public async executeDownload(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executeDownload(args);
    }

    public async executeDownloadTo(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executeDownloadTo(args);
    }

    public async executeUploadFiles(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executeUploadFiles(args);
    }

    public async executeChangePermissions(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executeChangePermissions(args);
    }

    public async executeCopyFullPath(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executeCopyFullPath(args);
    }

    public async executeDuplicate(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executeDuplicate(args);
    }

    public async executePreviewImageInWebview(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.executePreviewImageInWebview(args);
    }

    public async openInTerminal(args: any): Promise<void> {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        await session.openInTerminal(args);
    }

    public selectFileForCompare(context: any): void {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        session.selectFileForCompare(context);
    }

    public compareWithSelected(context: any): void {
        const session = this.getActiveSessionOrWarn();
        if (!session) {
            return;
        }
        session.compareWithSelected(context);
    }

    public postMessageToWebview(message: any): void {
        this.activeSession?.postMessageToWebview(message);
    }

    public hasActivePanel(): boolean {
        return this.activeSession !== undefined;
    }

    public getPanelCount(): number {
        return this.sessions.size;
    }

    public dispose(): void {
        for (const session of this.sessions.values()) {
            session.dispose();
        }
        this.sessions.clear();
        this.activeSession = undefined;
    }

    private getActiveSessionOrWarn(): DualPanelEditorSession | undefined {
        if (!this.activeSession) {
            vscode.window.showWarningMessage('No active file browser panel');
            return undefined;
        }

        return this.activeSession;
    }

    private updateQueueStatusForAllPanels(): void {
        const activeCount = this.transferQueueService.getActiveTaskCount();

        for (const session of this.sessions.values()) {
            session.postMessageToWebview({
                command: 'updateQueue',
                count: activeCount
            });
        }
    }
}
