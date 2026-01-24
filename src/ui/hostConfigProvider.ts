import * as vscode from 'vscode';
import * as path from 'node:path';
import { HostConfig, JumpHostConfig } from '../types';
import { HostManager } from '../hostManager';
import { AuthManager } from '../authManager';
import { SshConnectionManager } from '../sshConnectionManager';
import { logger } from '../logger';

/**
 * Host Configuration WebView Panel Provider
 * Handles basic settings and jump host configuration
 */
export class HostConfigProvider {
    private static currentPanel: HostConfigProvider | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];
    private currentHostId?: string;
    private onSaveCallback?: () => void;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private readonly hostManager: HostManager,
        private readonly authManager: AuthManager
    ) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        // Set webview content
        this.panel.webview.html = this.getHtmlContent(this.panel.webview);

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                await this.handleMessage(message);
            },
            null,
            this.disposables
        );

        // Clean up when panel is closed
        this.panel.onDidDispose(
            () => {
                HostConfigProvider.currentPanel = undefined;
                this.dispose();
            },
            null,
            this.disposables
        );
    }

    /**
     * Create or show the configuration panel
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        hostManager: HostManager,
        authManager: AuthManager,
        hostId?: string,
        onSave?: () => void
    ): HostConfigProvider {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If panel already exists, reveal it
        if (HostConfigProvider.currentPanel) {
            HostConfigProvider.currentPanel.panel.reveal(column);
            HostConfigProvider.currentPanel.currentHostId = hostId;
            HostConfigProvider.currentPanel.onSaveCallback = onSave;
            HostConfigProvider.currentPanel.loadHostConfig(hostId);
            return HostConfigProvider.currentPanel;
        }

        // Create new panel
        const panel = vscode.window.createWebviewPanel(
            'simpleSftpHostConfig',
            hostId ? 'Edit Host Configuration' : 'Add Host',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'resources'),
                    vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
                ]
            }
        );

        // Set icon for the webview tab using VS Code's built-in theme icon
        panel.iconPath = new vscode.ThemeIcon('server-process');

        const provider = new HostConfigProvider(panel, extensionUri, hostManager, authManager);
        provider.currentHostId = hostId;
        provider.onSaveCallback = onSave;
        HostConfigProvider.currentPanel = provider;

        // Load configuration if editing
        if (hostId) {
            provider.loadHostConfig(hostId);
        }

        return provider;
    }

    /**
     * Load host configuration into webview
     */
    private async loadHostConfig(hostId?: string): Promise<void> {
        if (!hostId) {
            this.panel.webview.postMessage({
                command: 'loadConfig',
                config: null
            });
            return;
        }

        const hosts = await this.hostManager.getHosts();
        const host = hosts.find(h => h.id === hostId);

        if (!host) {
            logger.error(`Host not found: ${hostId}`);
            return;
        }

        // Merge with auth config if available
        const authConfig = await this.authManager.getAuth(hostId);
        const fullConfig = {
            ...host,
            // Include auth config in the form
            authType: authConfig?.authType || 'password',
            password: authConfig?.password,
            privateKeyPath: authConfig?.privateKeyPath,
            passphrase: authConfig?.passphrase
        };

        this.panel.webview.postMessage({
            command: 'loadConfig',
            config: fullConfig
        });
    }

    /**
     * Handle messages from webview
     */
    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'ready':
                // Webview is ready, load config if editing
                if (this.currentHostId) {
                    await this.loadHostConfig(this.currentHostId);
                }
                break;

            case 'save':
                await this.handleSave(message.config, message.isEditMode);
                break;

            case 'cancel':
                this.panel.dispose();
                break;

            case 'testConnection':
                await this.handleTestConnection(message.config);
                break;

            case 'browsePrivateKey':
                await this.handleBrowsePrivateKey(message.context);
                break;

            case 'showError':
                vscode.window.showErrorMessage(message.message);
                break;

            case 'showInfo':
                vscode.window.showInformationMessage(message.message);
                break;
        }
    }

    /**
     * Handle save configuration
     */
    private async handleSave(config: Partial<HostConfig>, isEditMode: boolean): Promise<void> {
        try {
            if (isEditMode && this.currentHostId) {
                // Update existing host
                await this.hostManager.updateHost(this.currentHostId, config);
                vscode.window.showInformationMessage(`Host configuration updated: ${config.name}`);
            } else {
                // Add new host
                const newHost = await this.hostManager.addHost(config as Omit<HostConfig, 'id'>);
                this.currentHostId = newHost.id;
                vscode.window.showInformationMessage(`Host added: ${config.name}`);
            }

            // Trigger callback if provided
            if (this.onSaveCallback) {
                this.onSaveCallback();
            }

            // Close panel
            this.panel.dispose();
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to save host configuration: ${errorMessage}`);
            vscode.window.showErrorMessage(`Failed to save: ${errorMessage}`);
        }
    }

    /**
     * Handle test connection
     */
    private async handleTestConnection(config: any): Promise<void> {
        try {
            // Validate required fields
            if (!config.host || !config.port || !config.username) {
                vscode.window.showErrorMessage('Please fill in complete connection information');
                this.panel.webview.postMessage({
                    command: 'testConnectionResult',
                    success: false
                });
                return;
            }

            // Validate authentication info
            if (!config.authType) {
                vscode.window.showErrorMessage('Please select authentication method');
                this.panel.webview.postMessage({
                    command: 'testConnectionResult',
                    success: false
                });
                return;
            }

            // Use auth config from the form
            const authConfig: any = {
                hostId: 'test',
                authType: config.authType,
                password: config.password,
                privateKeyPath: config.privateKeyPath,
                passphrase: config.passphrase
            };

            // Prompt for password if needed and not provided
            if (config.authType === 'password' && !config.password) {
                const password = await vscode.window.showInputBox({
                    prompt: 'Enter password for testing',
                    password: true
                });
                if (!password) {
                    this.panel.webview.postMessage({
                        command: 'testConnectionResult',
                        success: false
                    });
                    return;
                }
                authConfig.password = password;
            } else if (config.authType === 'privateKey' && !config.privateKeyPath) {
                const privateKeyPath = await vscode.window.showInputBox({
                    prompt: 'Enter private key path',
                    value: '~/.ssh/id_rsa'
                });
                if (!privateKeyPath) {
                    this.panel.webview.postMessage({
                        command: 'testConnectionResult',
                        success: false
                    });
                    return;
                }
                authConfig.privateKeyPath = privateKeyPath;

                const passphrase = await vscode.window.showInputBox({
                    prompt: 'Enter passphrase (optional)',
                    password: true
                });
                if (passphrase) {
                    authConfig.passphrase = passphrase;
                }
            }

            // Test connection (with jump host if configured)
            await SshConnectionManager.testConnection(
                config as HostConfig,
                authConfig
            );

            // Send success result to webview (webview will show the message)
            this.panel.webview.postMessage({
                command: 'testConnectionResult',
                success: true
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Connection test failed: ${errorMessage}`);
            vscode.window.showErrorMessage(`Connection test failed: ${errorMessage}`);
            this.panel.webview.postMessage({
                command: 'testConnectionResult',
                success: false
            });
        }
    }

    /**
     * Handle browse for private key
     */
    private async handleBrowsePrivateKey(context: string): Promise<void> {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'Private Key': ['*'],
                'All Files': ['*']
            },
            title: 'Select Private Key File'
        });

        if (result && result[0]) {
            const keyPath = result[0].fsPath;
            this.panel.webview.postMessage({
                command: 'privateKeyPath',
                context: context,
                path: keyPath
            });
        }
    }

    /**
     * Get HTML content for webview
     */
    private getHtmlContent(webview: vscode.Webview): string {
        const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'host-config.html');
        const cssPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'host-config.css');
        const jsPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'host-config.js');
        const codiconsPath = vscode.Uri.joinPath(
            this.extensionUri,
            'node_modules',
            '@vscode',
            'codicons',
            'dist',
            'codicon.css'
        );

        const styleUri = webview.asWebviewUri(cssPath);
        const scriptUri = webview.asWebviewUri(jsPath);
        const codiconsUri = webview.asWebviewUri(codiconsPath);
        const cspSource = webview.cspSource;

        // Read HTML template
        const fs = require('fs');
        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // Replace placeholders
        html = html.replace(/{{styleUri}}/g, styleUri.toString());
        html = html.replace(/{{scriptUri}}/g, scriptUri.toString());
        html = html.replace(/{{codiconsUri}}/g, codiconsUri.toString());
        html = html.replace(/{{cspSource}}/g, cspSource);

        return html;
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
