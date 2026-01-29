import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { HostConfig } from '../types';
import { AuthManager } from '../authManager';
import { HostManager } from '../hostManager';
import { logger } from '../logger';
import { PortForwardService } from '../services/portForwardService';
import { PortForwardConfig, RemoteForwardConfig, DynamicForwardConfig } from '../types/portForward.types';
import { UI } from '../constants';

/**
 * Manager for standalone port forwarding webview panel
 * Provides port forwarding functionality independent of the file browser
 */
export class PortForwardEditorManager {
    // Map of host ID to webview panel
    private readonly panels: Map<string, vscode.WebviewPanel> = new Map();
    // Current active panel reference
    private currentPanel?: vscode.WebviewPanel;
    // Current host for the active panel
    private _currentHost?: HostConfig;
    // Current auth config for the active panel
    private _currentAuthConfig?: any;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly authManager: AuthManager,
        private readonly hostManager: HostManager
    ) {
        // Subscribe to port forwarding events
        const portForwardService = PortForwardService.getInstance();
        portForwardService.onPortForwardingEvent((event) => {
            this.handlePortForwardingChanged(event);
        });
    }

    /**
     * Post message to current active webview panel
     */
    private postMessage(message: any): void {
        this.currentPanel?.webview.postMessage(message);
    }

    /**
     * Open port forwarding panel for a specific host
     * Reuses existing panel if already open for this host
     */
    public async openForHost(host: HostConfig): Promise<void> {
        // Check if panel already exists for this host
        let panel = this.panels.get(host.id);

        if (panel) {
            // Panel exists, reveal it
            panel.reveal(vscode.ViewColumn.One);
            this.currentPanel = panel;
            this._currentHost = host;
            this._currentAuthConfig = await this.authManager.getAuth(host.id);
        } else {
            // Get auth config
            this._currentAuthConfig = await this.authManager.getAuth(host.id);

            if (!this._currentAuthConfig) {
                const choice = await vscode.window.showWarningMessage(
                    `No authentication configured for ${host.name}`,
                    'Configure Now',
                    'Cancel'
                );
                if (choice === 'Configure Now') {
                    await vscode.commands.executeCommand('simpleSftp.editHost', host);
                }
                return;
            }

            // Create new panel for this host
            panel = vscode.window.createWebviewPanel(
                'simpleSftp.portForwarding',
                `Port Forwarding: ${host.name}`,
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

            // Set custom icon for the panel
            panel.iconPath = new vscode.ThemeIcon(UI.ICONS.PORT_FORWARDING);

            this.panels.set(host.id, panel);
            this.currentPanel = panel;
            this._currentHost = host;

            // Set HTML content
            panel.webview.html = this.getHtmlForWebview(panel.webview, host);

            // Handle messages from this panel
            panel.webview.onDidReceiveMessage(async (message) => {
                // Set this panel as active before handling message
                this.currentPanel = panel;
                this._currentHost = host;
                await this.handleMessage(message);
            });

            // Clean up when panel is disposed
            panel.onDidDispose(() => {
                this.panels.delete(host.id);
                if (this.currentPanel === panel) {
                    this.currentPanel = undefined;
                    this._currentHost = undefined;
                    this._currentAuthConfig = undefined;
                }
            });

            // Send host info to webview
            panel.webview.postMessage({
                command: 'setHostInfo',
                hostName: host.host,
                hostLabel: host.name
            });
        }
    }

    /**
     * Handle messages from the webview
     */
    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
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

            case 'openBrowser':
                await this.handleOpenBrowser(message.address);
                break;

            case 'showError':
                vscode.window.showErrorMessage(message.message);
                break;
        }
    }

    /**
     * Handle port forwarding changes event
     */
    private handlePortForwardingChanged(event: any): void {
        // Notify all panels about the change
        for (const [hostId, panel] of this.panels) {
            if (event.hostId === hostId) {
                let commandType = 'portForwardingDeleted';
                if (event.type === 'started') {
                    commandType = 'portForwardingStarted';
                } else if (event.type === 'stopped') {
                    commandType = 'portForwardingStopped';
                } else if (event.type === 'error') {
                    commandType = 'portForwardingError';
                }

                panel.webview.postMessage({
                    command: commandType,
                    forwarding: event.forwarding,
                    id: event.forwarding?.id
                });
            }
        }
    }

    // ===== Port Forwarding Operations =====

    private async handleGetPortForwardings(): Promise<void> {
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

    private async handleStartPortForward(config: PortForwardConfig): Promise<void> {
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

    private async handleStartRemoteForward(config: RemoteForwardConfig): Promise<void> {
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

    private async handleStartDynamicForward(config: DynamicForwardConfig): Promise<void> {
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

    private async handleStopPortForward(id: string): Promise<void> {
        try {
            const service = PortForwardService.getInstance();
            await service.stopForwarding(id);

            vscode.window.showInformationMessage('Port forwarding stopped');

            this.postMessage({
                command: 'portForwardingStopped',
                id
            });

            await this.handleGetPortForwardings();
        } catch (error: any) {
            logger.error(`Failed to stop port forwarding: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to stop port forwarding: ${error.message}`);
        }
    }

    private async handleDeletePortForward(id: string): Promise<void> {
        try {
            const service = PortForwardService.getInstance();
            await service.deleteForwarding(id);

            this.postMessage({
                command: 'portForwardingDeleted',
                id
            });

            await this.handleGetPortForwardings();
        } catch (error: any) {
            logger.error(`Failed to delete port forwarding: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to delete port forwarding: ${error.message}`);
        }
    }

    private async handleScanRemotePorts(): Promise<void> {
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

    private async handleScanLocalPorts(): Promise<void> {
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

    private async handleOpenBrowser(address: string): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('simpleSftp.portForwarding');
            const browserType = config.get<string>('browserType', 'simple-browser');
            const defaultProtocol = config.get<string>('defaultProtocol', 'http');

            // Add protocol if not present
            let url = address;
            const protocolRegex = /^https?:\/\//;
            if (!protocolRegex.test(url)) {
                url = `${defaultProtocol}://${address}`;
            }

            if (browserType === 'simple-browser') {
                await vscode.commands.executeCommand('simpleBrowser.show', url);
                logger.info(`Opened in Simple Browser: ${url}`);
            } else {
                await vscode.env.openExternal(vscode.Uri.parse(url));
                logger.info(`Opened in external browser: ${url}`);
            }
        } catch (error: any) {
            logger.error(`Failed to open browser: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to open browser: ${error.message}`);
        }
    }

    // ===== HTML Generation =====

    private getHtmlForWebview(webview: vscode.Webview, host: HostConfig): string {
        try {
            const portForwardScriptUri = webview.asWebviewUri(
                vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'port-forward.js')
            );
            const portForwardStyleUri = webview.asWebviewUri(
                vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'port-forward.css')
            );
            const codiconsUri = webview.asWebviewUri(
                vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
            );

            const nonce = this.getNonce();

            const htmlPath = path.join(this._extensionUri.fsPath, 'resources', 'webview', 'port-forward.html');
            let html = fs.readFileSync(htmlPath, 'utf8');

            html = html.replaceAll('{{cspSource}}', webview.cspSource);
            html = html.replaceAll('{{nonce}}', nonce);
            html = html.replaceAll('{{portForwardStyleUri}}', portForwardStyleUri.toString());
            html = html.replaceAll('{{portForwardScriptUri}}', portForwardScriptUri.toString());
            html = html.replaceAll('{{codiconsUri}}', codiconsUri.toString());

            return html;
        } catch (error) {
            logger.error(`Failed to load HTML template: ${error}`);
            return `<html><body><h1>Error loading webview</h1><p>${error}</p></body></html>`;
        }
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Dispose all panels
     */
    public dispose(): void {
        for (const [, panel] of this.panels) {
            panel.dispose();
        }
        this.panels.clear();
    }
}
