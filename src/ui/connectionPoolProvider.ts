import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { SshConnectionPool } from '../sshConnectionPool';
import { HostManager } from '../hostManager';
import { logger } from '../logger';

/**
 * Connection Pool Status WebView Panel Provider
 * Displays SSH connection pool status and details
 */
export class ConnectionPoolProvider {
  private static currentPanel: ConnectionPoolProvider | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly hostManager: HostManager;
  private disposables: vscode.Disposable[] = [];
  private refreshInterval?: NodeJS.Timeout;
  private currentRefreshIntervalMs: number = 5000; // Default 5 seconds

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, hostManager: HostManager) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.hostManager = hostManager;

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
        ConnectionPoolProvider.currentPanel = undefined;
        this.dispose();
      },
      null,
      this.disposables
    );

    // Load initial data
    this.loadConnectionPoolData();

    // Send current refresh interval to webview
    this.sendRefreshInterval();

    // Auto-refresh with default interval
    this.startAutoRefresh();
  }

  /**
   * Create or show the connection pool status panel
   */
  public static createOrShow(extensionUri: vscode.Uri, hostManager: HostManager): ConnectionPoolProvider {
    const column = vscode.ViewColumn.One;

    // If panel already exists, reveal it and refresh
    if (ConnectionPoolProvider.currentPanel) {
      ConnectionPoolProvider.currentPanel.panel.reveal(column);
      ConnectionPoolProvider.currentPanel.loadConnectionPoolData();
      return ConnectionPoolProvider.currentPanel;
    }

    // Create new panel
    const panel = vscode.window.createWebviewPanel(
      'simpleSftpConnectionPool',
      'SSH Connection Pool Status',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'resources'),
          vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
        ]
      }
    );

    // Set icon for the webview tab
    panel.iconPath = new vscode.ThemeIcon('dashboard');

    const provider = new ConnectionPoolProvider(panel, extensionUri, hostManager);
    ConnectionPoolProvider.currentPanel = provider;

    return provider;
  }

  /**
   * Handle messages from the webview
   */
  private async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'refresh':
        this.loadConnectionPoolData();
        break;
      case 'changeRefreshInterval':
        this.changeRefreshInterval(message.intervalMs);
        break;
    }
  }

  /**
   * Change the auto-refresh interval
   */
  private changeRefreshInterval(intervalMs: number): void {
    this.currentRefreshIntervalMs = intervalMs;
    this.startAutoRefresh();
    this.sendRefreshInterval();
    logger.info(`Connection pool refresh interval changed to ${intervalMs}ms`);
  }

  /**
   * Start or restart the auto-refresh timer
   */
  private startAutoRefresh(): void {
    // Clear existing interval
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }

    // Start new interval
    this.refreshInterval = setInterval(() => {
      this.loadConnectionPoolData();
    }, this.currentRefreshIntervalMs);
  }

  /**
   * Send current refresh interval to webview
   */
  private sendRefreshInterval(): void {
    this.panel.webview.postMessage({
      command: 'updateRefreshInterval',
      intervalMs: this.currentRefreshIntervalMs
    });
  }

  /**
   * Load connection pool data and send to webview
   */
  private loadConnectionPoolData(): void {
    try {
      const pool = SshConnectionPool.getInstance();
      const status = pool.getDetailedPoolStatus();
      const hosts = this.hostManager.getHostsSync();

      // Replace hostId with hostName
      const enrichedConnections = status.connections.map(conn => {
        const host = hosts.find(h => h.id === conn.hostId);
        return {
          hostId: conn.hostId,
          hostName: host?.name || conn.hostId, // Fallback to hostId if host not found
          status: conn.status,
          createdAt: conn.createdAt,
          lastUsed: conn.lastUsed,
          idleTime: conn.idleTime
        };
      });

      logger.debug(`Connection pool data: ${JSON.stringify(enrichedConnections)}`);

      this.panel.webview.postMessage({
        command: 'updateData',
        data: {
          totalConnections: status.totalConnections,
          activeConnections: status.activeConnections,
          idleConnections: status.idleConnections,
          connections: enrichedConnections
        }
      });
    } catch (error) {
      logger.error('Failed to load connection pool data', error as Error);
      vscode.window.showErrorMessage(`Failed to load connection pool data: ${(error as Error).message}`);
    }
  }

  /**
   * Get HTML content for the webview
   */
  private getHtmlContent(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'connection-pool.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'connection-pool.js')
    );
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
    );

    const nonce = this.getNonce();

    // Read HTML template file
    const htmlPath = path.join(this.extensionUri.fsPath, 'resources', 'webview', 'connection-pool.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    // Replace placeholders
    html = html
      .replace(/\{\{cspSource\}\}/g, webview.cspSource)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{codiconsUri\}\}/g, codiconsUri.toString())
      .replace(/\{\{styleUri\}\}/g, styleUri.toString())
      .replace(/\{\{scriptUri\}\}/g, scriptUri.toString());

    return html;
  }

  /**
   * Generate a nonce for Content Security Policy
   */
  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  /**
   * Dispose of the provider and clean up resources
   */
  public dispose(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
