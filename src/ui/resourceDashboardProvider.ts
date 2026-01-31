import * as vscode from 'vscode';
import * as path from 'node:path';
import { HostConfig, HostAuthConfig } from '../types';
import { ResourceDashboardService, SystemResourceInfo } from '../services/resourceDashboardService';
import { logger } from '../logger';

/**
 * Resource Dashboard WebView Panel Provider
 * Displays remote server resource information (CPU, Memory, Disk)
 */
export class ResourceDashboardProvider {
  private static readonly panels: Map<string, ResourceDashboardProvider> = new Map();
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private readonly hostConfig: HostConfig;
  private readonly authConfig: HostAuthConfig;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    hostConfig: HostConfig,
    authConfig: HostAuthConfig
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.hostConfig = hostConfig;
    this.authConfig = authConfig;

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
        ResourceDashboardProvider.panels.delete(hostConfig.id);
        this.dispose();
      },
      null,
      this.disposables
    );

    // Load resource data immediately after panel is created
    this.loadTabData('overview').catch(error => {
      logger.error('Failed to load initial tab data', error as Error);
    });
  }

  /**
   * Create or show the resource dashboard panel
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    hostConfig: HostConfig,
    authConfig: HostAuthConfig
  ): ResourceDashboardProvider {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If panel already exists for this host, reveal it and refresh
    const existingPanel = ResourceDashboardProvider.panels.get(hostConfig.id);
    if (existingPanel) {
      existingPanel.panel.reveal(column);
      existingPanel.loadTabData('overview');
      return existingPanel;
    }

    // Create new panel
    const panel = vscode.window.createWebviewPanel(
      'simpleSftpResourceDashboard',
      hostConfig.name,
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

    // Set icon for the webview tab
    panel.iconPath = new vscode.ThemeIcon('pulse');

    const provider = new ResourceDashboardProvider(
      panel,
      extensionUri,
      hostConfig,
      authConfig
    );

    // Store panel for future access
    ResourceDashboardProvider.panels.set(hostConfig.id, provider);

    return provider;
  }

  /**
   * Load data for specific tab
   */
  private async loadTabData(tab: string): Promise<void> {
    try {
      // Send loading state to webview
      this.panel.webview.postMessage({
        type: 'loading',
        data: true
      });

      logger.info(`Fetching ${tab} data for ${this.hostConfig.name}`);

      switch (tab) {
        case 'overview':
          await this.loadOverviewData();
          break;
        case 'processes':
          await this.loadProcessData();
          break;
        case 'network':
          await this.loadNetworkData();
          break;
        case 'io':
          await this.loadIOData();
          break;
        case 'disk':
          await this.loadDiskData();
          break;
        default:
          await this.loadOverviewData();
      }

      logger.info(`Successfully fetched ${tab} data for ${this.hostConfig.name}`);
    } catch (error) {
      logger.error(`Failed to fetch ${tab} data for ${this.hostConfig.name}`, error as Error);

      // Send error to webview
      this.panel.webview.postMessage({
        type: 'error',
        data: {
          message: `Failed to fetch ${tab} information: ${(error as Error).message}`
        }
      });
    }
  }

  /**
   * Load overview tab data (system resources)
   */
  private async loadOverviewData(): Promise<void> {
    const resourceInfo = await ResourceDashboardService.getSystemResources(
      this.hostConfig,
      this.authConfig
    );

    this.panel.webview.postMessage({
      type: 'resourceData',
      data: resourceInfo
    });
  }

  /**
   * Load processes tab data
   */
  private async loadProcessData(): Promise<void> {
    const processes = await ResourceDashboardService.getProcessList(
      this.hostConfig,
      this.authConfig
    );

    this.panel.webview.postMessage({
      type: 'processData',
      data: processes
    });
  }

  /**
   * Load network tab data
   */
  private async loadNetworkData(): Promise<void> {
    const networkStats = await ResourceDashboardService.getNetworkStats(
      this.hostConfig,
      this.authConfig
    );

    this.panel.webview.postMessage({
      type: 'networkData',
      data: networkStats
    });
  }

  /**
   * Load I/O tab data
   */
  private async loadIOData(): Promise<void> {
    const ioStats = await ResourceDashboardService.getDiskIOStats(
      this.hostConfig,
      this.authConfig
    );

    this.panel.webview.postMessage({
      type: 'ioData',
      data: ioStats
    });
  }

  /**
   * Load disk tab data (detailed disk info)
   */
  private async loadDiskData(): Promise<void> {
    const resourceInfo = await ResourceDashboardService.getSystemResources(
      this.hostConfig,
      this.authConfig
    );

    this.panel.webview.postMessage({
      type: 'diskData',
      data: resourceInfo.disk
    });
  }

  /**
   * Handle messages from webview
   */
  private async handleMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'refresh': {
        // Get tab from message, default to 'overview'
        const tab = message.tab || 'overview';
        await this.loadTabData(tab);
        break;
      }

      case 'showLogs':
        logger.show();
        break;
    }
  }

  /**
   * Get HTML content for webview
   */
  private getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'resource-dashboard.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'resource-dashboard.css')
    );
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
    );

    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};">
    <link href="${codiconsUri}" rel="stylesheet" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>Resource Dashboard</title>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 class="title">
                <i class="codicon codicon-pulse"></i>
                <span>Resource Dashboard</span>
            </h1>
            <div class="header-actions">
                <label class="auto-refresh-control">
                    <input type="checkbox" id="autoRefreshToggle" checked />
                    <span>Auto Refresh</span>
                </label>
                <select id="refreshInterval" class="refresh-interval-select">
                    <option value="0">Off</option>
                    <option value="5">5s</option>
                    <option value="10">10s</option>
                    <option value="20" selected>20s</option>
                    <option value="30">30s</option>
                    <option value="60">1min</option>
                    <option value="300">5min</option>
                </select>
                <button id="refreshBtn" class="icon-button" title="Refresh">
                    <i class="codicon codicon-refresh"></i>
                </button>
            </div>
        </div>

        <!-- Tab Navigation -->
        <div class="tab-nav">
            <button class="tab-button active" data-tab="overview">
                <i class="codicon codicon-dashboard"></i>
                Overview
            </button>
            <button class="tab-button" data-tab="processes">
                <i class="codicon codicon-server-process"></i>
                Processes
            </button>
            <button class="tab-button" data-tab="network">
                <i class="codicon codicon-globe"></i>
                Network
            </button>
            <button class="tab-button" data-tab="io">
                <i class="codicon codicon-database"></i>
                I/O
            </button>
            <button class="tab-button" data-tab="disk">
                <i class="codicon codicon-disc"></i>
                Disk
            </button>
        </div>

        <div id="loadingState" class="loading-state">
            <div class="spinner"></div>
            <p>Loading resource information...</p>
        </div>

        <div id="errorState" class="error-state" style="display: none;">
            <div class="error-message">
                <i class="codicon codicon-error"></i>
                <span id="errorText"></span>
            </div>
            <button id="viewLogsBtn" class="button-secondary">
                <i class="codicon codicon-output"></i>
                View Logs
            </button>
        </div>

        <div id="contentState" class="content-state" style="display: none;">
            <!-- Overview Tab -->
            <div id="overviewTab" class="tab-content active">
                <!-- System Info -->
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-server"></i>
                        <span>System</span>
                    </div>
                    <div class="section-content">
                        <div class="info-grid">
                            <div class="info-item">
                                <span class="info-label">Hostname</span>
                                <span class="info-value" id="hostname">-</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Operating System</span>
                                <span class="info-value" id="os">-</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Kernel</span>
                                <span class="info-value" id="kernel">-</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Uptime</span>
                                <span class="info-value" id="uptime">-</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- CPU Info -->
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-dashboard"></i>
                        <span>CPU</span>
                    </div>
                    <div class="section-content">
                        <div class="info-grid">
                            <div class="info-item">
                                <span class="info-label">Usage</span>
                                <span class="info-value" id="cpuUsage">-</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Cores</span>
                                <span class="info-value" id="cores">-</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Load (1/5/15 min)</span>
                                <span class="info-value" id="loadAvg">-</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Memory Info -->
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-server-process"></i>
                        <span>Memory</span>
                    </div>
                    <div class="section-content">
                        <div class="info-grid">
                            <div class="info-item">
                                <span class="info-label">Usage</span>
                                <span class="info-value" id="memoryUsage">-</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Total</span>
                                <span class="info-value" id="memoryTotal">-</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Used</span>
                                <span class="info-value" id="memoryUsed">-</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Available</span>
                                <span class="info-value" id="memoryAvailable">-</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Disk Summary (for Overview) -->
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-database"></i>
                        <span>Disk Summary</span>
                    </div>
                    <div class="section-content">
                        <div id="diskSummary"></div>
                    </div>
                </div>
            </div>

            <!-- Processes Tab -->
            <div id="processesTab" class="tab-content">
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-server-process"></i>
                        <span>Top Processes</span>
                    </div>
                    <div class="section-content">
                        <table class="process-table">
                            <thead>
                                <tr>
                                    <th>PID</th>
                                    <th>User</th>
                                    <th>CPU %</th>
                                    <th>MEM %</th>
                                    <th>Command</th>
                                </tr>
                            </thead>
                            <tbody id="processList">
                                <tr><td colspan="5" class="empty-state">No data available</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Network Tab -->
            <div id="networkTab" class="tab-content">
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-globe"></i>
                        <span>Network Interfaces</span>
                    </div>
                    <div class="section-content">
                        <table class="network-table">
                            <thead>
                                <tr>
                                    <th>Interface</th>
                                    <th>RX Bytes</th>
                                    <th>TX Bytes</th>
                                    <th>RX Rate</th>
                                    <th>TX Rate</th>
                                </tr>
                            </thead>
                            <tbody id="networkList">
                                <tr><td colspan="5" class="empty-state">No data available</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- I/O Tab -->
            <div id="ioTab" class="tab-content">
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-database"></i>
                        <span>Disk I/O Statistics</span>
                    </div>
                    <div class="section-content">
                        <table class="io-table">
                            <thead>
                                <tr>
                                    <th>Device</th>
                                    <th>Read Rate</th>
                                    <th>Write Rate</th>
                                    <th>Utilization</th>
                                </tr>
                            </thead>
                            <tbody id="ioList">
                                <tr><td colspan="4" class="empty-state">No data available</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Disk Tab -->
            <div id="diskTab" class="tab-content">
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-disc"></i>
                        <span>Disk Partitions</span>
                    </div>
                    <div class="section-content">
                        <div id="diskList"></div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
