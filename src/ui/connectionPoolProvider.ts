import * as vscode from 'vscode';
import * as path from 'node:path';
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
          ...conn,
          hostName: host?.name || conn.hostId // Fallback to hostId if host not found
        };
      });

      this.panel.webview.postMessage({
        command: 'updateData',
        data: {
          ...status,
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

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <link href="${codiconsUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>SSH Connection Pool Status</title>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="title">
                <i class="codicon codicon-dashboard"></i>
                SSH Connection Pool Status
            </div>
            <div class="header-controls">
                <div class="refresh-interval-selector">
                    <label for="refreshIntervalSelect">Refresh:</label>
                    <select id="refreshIntervalSelect">
                        <option value="2000">2s</option>
                        <option value="5000" selected>5s</option>
                        <option value="10000">10s</option>
                        <option value="30000">30s</option>
                        <option value="60000">1m</option>
                    </select>
                </div>
                <button class="icon-button" id="refreshBtn" title="Refresh">
                    <i class="codicon codicon-refresh"></i>
                </button>
            </div>
        </div>

        <div class="summary">
            <div class="summary-item">
                <div class="summary-label">Total Connections</div>
                <div class="summary-value" id="totalConnections">0</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Active (In Use)</div>
                <div class="summary-value active" id="activeConnections">0</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Idle (Available)</div>
                <div class="summary-value idle" id="idleConnections">0</div>
            </div>
        </div>

        <div class="table-container">
            <table class="connections-table">
                <thead>
                    <tr>
                        <th>Host</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Last Used</th>
                        <th>Idle Time</th>
                    </tr>
                </thead>
                <tbody id="connectionsTableBody">
                    <tr class="empty-state">
                        <td colspan="5">No connections in pool</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="footer">
            <div class="info-text">
                <i class="codicon codicon-info"></i>
                Connection pool improves performance by reusing SSH connections. Idle connections are automatically closed after 5 minutes.
            </div>
        </div>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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
