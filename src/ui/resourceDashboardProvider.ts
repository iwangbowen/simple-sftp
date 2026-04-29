import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import { HostConfig, HostAuthConfig } from '../types';
import { ResourceDashboardService, type CrontabEntry } from '../services/resourceDashboardService';
import { SshConnectionManager } from '../sshConnectionManager';
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
  /** 当前活跃的 Docker 日志流（containerId → stop 句柄） */
  private readonly activeLogStreams = new Map<string, { stop: () => void }>();

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
        // Stop all active Docker log streams
        this.activeLogStreams.forEach(handle => { try { handle.stop(); } catch { /* ignore */ } });
        this.activeLogStreams.clear();
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
          vscode.Uri.joinPath(extensionUri, 'resources', 'codicons')
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
        case 'memory':
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
        case 'logs':
          await this.loadLogsData();
          break;
        case 'ports':
          await this.loadPortsData();
          break;
        case 'users':
          await this.loadUsersData();
          break;
        case 'services':
          await this.loadServicesData();
          break;
        case 'docker':
          await this.loadDockerData();
          break;
        case 'crontab':
          await this.loadCrontabData();
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

  private async loadLogsData(filePath?: string, lines: number = 200): Promise<void> {
    if (filePath) {
      const content = await ResourceDashboardService.readLogFile(
        this.hostConfig,
        this.authConfig,
        filePath,
        lines
      );
      this.panel.webview.postMessage({ type: 'logsContent', data: { filePath, content } });
    } else {
      // First visit: list available log files
      const files = await ResourceDashboardService.getAvailableLogs(
        this.hostConfig,
        this.authConfig
      );
      this.panel.webview.postMessage({ type: 'logsFiles', data: files });
    }
  }

  private async loadPortsData(): Promise<void> {
    const ports = await ResourceDashboardService.getPortList(this.hostConfig, this.authConfig);
    this.panel.webview.postMessage({ type: 'portsData', data: ports });
  }

  private async loadUsersData(): Promise<void> {
    const usersInfo = await ResourceDashboardService.getUsersInfo(this.hostConfig, this.authConfig);
    this.panel.webview.postMessage({ type: 'usersData', data: usersInfo });
  }

  private async loadServicesData(): Promise<void> {
    const services = await ResourceDashboardService.getServiceList(this.hostConfig, this.authConfig);
    this.panel.webview.postMessage({ type: 'servicesData', data: services });
  }

  private async loadDockerData(): Promise<void> {
    const containers = await ResourceDashboardService.getContainerList(this.hostConfig, this.authConfig);
    this.panel.webview.postMessage({ type: 'dockerData', data: containers });
  }

  private async loadCrontabData(): Promise<CrontabEntry[]> {
    const entries = await ResourceDashboardService.getCrontabList(this.hostConfig, this.authConfig);
    await this.panel.webview.postMessage({ type: 'crontabData', data: entries });
    return entries;
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

      case 'killProcess': {
        const pid = Number(message.pid);
        const signal = message.signal as 'SIGTERM' | 'SIGKILL' | 'SIGHUP' | 'SIGINT';
        const confirmed = await vscode.window.showWarningMessage(
          `Send ${signal} to process ${pid} on ${this.hostConfig.name}?`,
          { modal: true },
          'Confirm'
        );
        if (confirmed !== 'Confirm') {
          break;
        }
        try {
          await ResourceDashboardService.killProcess(this.hostConfig, this.authConfig, pid, signal);
          vscode.window.showInformationMessage(`Signal ${signal} sent to PID ${pid}.`);
          // Refresh process list after kill
          await this.loadProcessData();
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to kill PID ${pid}: ${(err as Error).message}`);
        }
        break;
      }

      case 'fetchLogs': {
        const filePath = typeof message.filePath === 'string' ? message.filePath : undefined;
        const lines = typeof message.lines === 'number' ? message.lines : 200;
        await this.loadLogsData(filePath, lines);
        break;
      }

      case 'downloadLog': {
        const remotePath = typeof message.filePath === 'string' ? message.filePath : undefined;
        if (!remotePath || !/^\/var\/log\/[a-zA-Z0-9_./@-]+$/.test(remotePath)) {
          vscode.window.showErrorMessage('Invalid log file path.');
          break;
        }
        const defaultName = path.basename(remotePath);
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(os.homedir(), defaultName)),
          filters: { 'Log files': ['log', 'txt', '*'], 'All files': ['*'] },
          title: `Save ${defaultName}`,
        });
        if (!saveUri) { break; }
        const localPath = saveUri.fsPath;
        this.panel.webview.postMessage({ type: 'logDownloadStart' });
        try {
          await SshConnectionManager.downloadFile(
            this.hostConfig,
            this.authConfig,
            remotePath,
            localPath
          );
          this.panel.webview.postMessage({ type: 'logDownloadEnd', success: true });
          const open = await vscode.window.showInformationMessage(
            `Downloaded: ${defaultName}`,
            'Open File',
            'Show in Explorer'
          );
          if (open === 'Open File') {
            const doc = await vscode.workspace.openTextDocument(saveUri);
            await vscode.window.showTextDocument(doc);
          } else if (open === 'Show in Explorer') {
            await vscode.commands.executeCommand('revealFileInOS', saveUri);
          }
        } catch (err) {
          this.panel.webview.postMessage({ type: 'logDownloadEnd', success: false });
          vscode.window.showErrorMessage(`Download failed: ${(err as Error).message}`);
        }
        break;
      }

      case 'serviceControl': {
        const unit = typeof message.unit === 'string' ? message.unit : '';
        const action = message.action as 'start' | 'stop' | 'restart';
        const allowedActions: string[] = ['start', 'stop', 'restart'];
        if (!unit || !allowedActions.includes(action)) { break; }
        const confirmed = await vscode.window.showWarningMessage(
          `${action.charAt(0).toUpperCase() + action.slice(1)} service "${unit}" on ${this.hostConfig.name}?`,
          { modal: true },
          'Confirm'
        );
        if (confirmed !== 'Confirm') { break; }
        try {
          await ResourceDashboardService.controlService(this.hostConfig, this.authConfig, unit, action);
          vscode.window.showInformationMessage(`Service "${unit}" ${action}ed successfully.`);
          await this.loadServicesData();
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to ${action} "${unit}": ${(err as Error).message}`);
        }
        break;
      }

      case 'showLogs':
        logger.show();
        break;

      case 'dockerLogs': {
        const containerId = typeof message.containerId === 'string' ? message.containerId : '';
        // Validate containerId before use
        if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
          this.panel.webview.postMessage({ type: 'dockerLogEnd', containerId, error: 'Invalid container ID' });
          break;
        }
        // Stop any existing stream for this container
        const existing = this.activeLogStreams.get(containerId);
        if (existing) { try { existing.stop(); } catch { /* ignore */ } this.activeLogStreams.delete(containerId); }

        try {
          const handle = await ResourceDashboardService.streamContainerLogs(
            this.hostConfig,
            this.authConfig,
            containerId,
            (chunk: string) => {
              this.panel.webview.postMessage({ type: 'dockerLogChunk', containerId, chunk });
            },
            (error?: Error) => {
              this.activeLogStreams.delete(containerId);
              this.panel.webview.postMessage({
                type: 'dockerLogEnd',
                containerId,
                error: error?.message
              });
            }
          );
          this.activeLogStreams.set(containerId, handle);
        } catch (err) {
          this.panel.webview.postMessage({
            type: 'dockerLogEnd',
            containerId,
            error: (err as Error).message
          });
        }
        break;
      }

      case 'stopDockerLogs': {
        const containerId = typeof message.containerId === 'string' ? message.containerId : '';
        const handle = this.activeLogStreams.get(containerId);
        if (handle) {
          try { handle.stop(); } catch { /* ignore */ }
          this.activeLogStreams.delete(containerId);
        }
        break;
      }

      case 'crontabWrite': {
        const entries = Array.isArray(message.entries) ? message.entries : [];
        try {
          await ResourceDashboardService.writeUserCrontab(
            this.hostConfig,
            this.authConfig,
            entries
          );
          let refreshedEntries: CrontabEntry[] | undefined;
          try {
            refreshedEntries = await this.loadCrontabData();
          } catch (refreshErr) {
            logger.warn(`Crontab write succeeded but refresh failed: ${(refreshErr as Error).message}`);
          }
          await this.panel.webview.postMessage({
            type: 'crontabWriteResult',
            success: true,
            data: refreshedEntries
          });
        } catch (err) {
          await this.panel.webview.postMessage({
            type: 'crontabWriteResult',
            success: false,
            error: (err as Error).message
          });
        }
        break;
      }

      case 'crontabDeleteRequest': {
        const entries = Array.isArray(message.entries) ? message.entries : [];
        const command = typeof message.command === 'string' ? message.command : '(unknown)';
        const truncated = command.length > 60 ? command.slice(0, 60) + '…' : command;
        const confirmed = await vscode.window.showWarningMessage(
          `Delete cron job "${truncated}" on ${this.hostConfig.name}?`,
          { modal: true },
          'Confirm'
        );
        if (confirmed !== 'Confirm') {
          await this.panel.webview.postMessage({
            type: 'crontabWriteResult',
            success: false,
            cancelled: true
          });
          break;
        }
        try {
          await this.panel.webview.postMessage({ type: 'crontabDeleteConfirmed' });
          await ResourceDashboardService.writeUserCrontab(this.hostConfig, this.authConfig, entries);
          let refreshedEntries: CrontabEntry[] | undefined;
          try {
            refreshedEntries = await this.loadCrontabData();
          } catch (refreshErr) {
            logger.warn(`Crontab delete succeeded but refresh failed: ${(refreshErr as Error).message}`);
          }
          await this.panel.webview.postMessage({
            type: 'crontabWriteResult',
            success: true,
            data: refreshedEntries
          });
        } catch (err) {
          await this.panel.webview.postMessage({
            type: 'crontabWriteResult',
            success: false,
            error: (err as Error).message
          });
        }
        break;
      }
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
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'codicons', 'codicon.css')
    );

    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource}; font-src ${cspSource};">
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
            <div class="tab-nav-tabs">
                <button class="tab-button active" data-tab="overview">
                    <i class="codicon codicon-dashboard"></i>
                    Overview
                </button>
                <button class="tab-button" data-tab="memory">
                    <i class="codicon codicon-server-process"></i>
                    Memory
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
                <button class="tab-button" data-tab="logs">
                    <i class="codicon codicon-output"></i>
                    Logs
                </button>
                <button class="tab-button" data-tab="ports">
                    <i class="codicon codicon-plug"></i>
                    Ports
                </button>
                <button class="tab-button" data-tab="users">
                    <i class="codicon codicon-account"></i>
                    Users
                </button>
                <button class="tab-button" data-tab="services">
                    <i class="codicon codicon-list-ordered"></i>
                    Services
                </button>
                <button class="tab-button" data-tab="docker">
                    <i class="codicon codicon-layers"></i>
                    Docker
                </button>
                <button class="tab-button" data-tab="crontab">
                    <i class="codicon codicon-calendar"></i>
                    Crontab
                </button>
            </div>
            <button id="tabMoreBtn" class="tab-more-btn" style="display:none;" title="More tabs">
                <i class="codicon codicon-ellipsis"></i>
            </button>
            <div id="tabMoreMenu" class="tab-more-menu"></div>
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
              <!-- Health Summary -->
              <div class="section health-section">
                <div class="section-header">
                  <i class="codicon codicon-shield"></i>
                  <span>Health Summary</span>
                </div>
                <div class="section-content">
                  <div class="health-summary-card">
                    <div class="health-summary-header">
                      <span id="healthBadge" class="health-badge health-healthy">Healthy</span>
                      <span id="healthUpdatedAt" class="health-updated-at">Updated just now</span>
                    </div>
                    <p id="healthSummary" class="health-summary-text">Loading health information...</p>
                    <div id="healthAlerts" class="health-alert-list">
                      <div class="health-alert-empty">No alerts</div>
                    </div>
                  </div>
                </div>
              </div>

                <!-- Metric Cards -->
                <div class="metric-cards">
                  <div class="metric-card expandable" id="metricCpuCard">
                    <div class="metric-card-header">
                      <i class="codicon codicon-dashboard"></i>
                      <span class="metric-card-title">CPU</span>
                      <span class="metric-card-expand-icon">›</span>
                    </div>
                    <div class="metric-card-value usage-normal" id="metricCpuValue">—</div>
                    <svg class="metric-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" id="cpuSparkline"></svg>
                    <div class="metric-card-detail" id="metricCpuDetail">
                      <svg class="metric-detail-chart" viewBox="0 0 100 50" preserveAspectRatio="none" id="cpuDetailChart"></svg>
                      <div class="metric-detail-labels">
                        <span id="cpuDetailMin"></span>
                        <span id="cpuDetailAvg"></span>
                        <span id="cpuDetailMax"></span>
                      </div>
                    </div>
                  </div>
                  <div class="metric-card expandable" id="metricMemCard">
                    <div class="metric-card-header">
                      <i class="codicon codicon-server-process"></i>
                      <span class="metric-card-title">Memory</span>
                      <span class="metric-card-expand-icon">›</span>
                    </div>
                    <div class="metric-card-value usage-normal" id="metricMemValue">—</div>
                    <svg class="metric-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" id="memSparkline"></svg>
                    <div class="metric-card-detail" id="metricMemDetail">
                      <svg class="metric-detail-chart" viewBox="0 0 100 50" preserveAspectRatio="none" id="memDetailChart"></svg>
                      <div class="metric-detail-labels">
                        <span id="memDetailMin"></span>
                        <span id="memDetailAvg"></span>
                        <span id="memDetailMax"></span>
                      </div>
                    </div>
                  </div>
                  <div class="metric-card" id="metricDiskCard">
                    <div class="metric-card-header">
                      <i class="codicon codicon-database"></i>
                      <span class="metric-card-title">Disk (max)</span>
                    </div>
                    <div class="metric-card-value usage-normal" id="metricDiskValue">—</div>
                    <div class="metric-disk-bar-bg"><div class="metric-disk-bar-fill usage-normal" id="metricDiskBar" style="width:0%"></div></div>
                  </div>
                  <div class="metric-card expandable" id="metricDiskIOCard">
                    <div class="metric-card-header">
                      <i class="codicon codicon-pulse"></i>
                      <span class="metric-card-title">Disk I/O</span>
                      <span class="metric-card-expand-icon">›</span>
                    </div>
                    <div class="metric-disk-io-speeds">
                      <span class="metric-disk-io-item read">
                        <span class="metric-disk-io-label">↓</span>
                        <span class="metric-disk-io-value" id="metricDiskIORead">—</span>
                      </span>
                      <span class="metric-disk-io-item write">
                        <span class="metric-disk-io-label">↑</span>
                        <span class="metric-disk-io-value" id="metricDiskIOWrite">—</span>
                      </span>
                    </div>
                    <svg class="metric-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" id="diskIOSparkline"></svg>
                    <div class="metric-card-detail" id="metricDiskIODetail">
                      <svg class="metric-detail-chart" viewBox="0 0 100 50" preserveAspectRatio="none" id="diskIODetailChart"></svg>
                      <div class="metric-detail-labels">
                        <span class="disk-read-label">↓ Read</span>
                        <span class="disk-write-label">↑ Write</span>
                      </div>
                    </div>
                  </div>
                </div>

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
                                <span class="info-label">Load-based Usage</span>
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
                            <div class="info-item">
                              <span class="info-label">Buffers</span>
                              <span class="info-value" id="memoryBuffers">-</span>
                            </div>
                            <div class="info-item">
                              <span class="info-label">Cache</span>
                              <span class="info-value" id="memoryCached">-</span>
                            </div>
                            <div class="info-item">
                              <span class="info-label">Swap</span>
                              <span class="info-value" id="memorySwap">-</span>
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

                <!-- Top 5 Processes (Overview) -->
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-server-process"></i>
                        <span>Top 5 Processes by CPU</span>
                    </div>
                    <div class="section-content">
                        <table class="process-mini-table">
                            <thead>
                                <tr>
                                    <th>PID</th>
                                    <th>Name</th>
                                    <th>User</th>
                                    <th>CPU %</th>
                                    <th>MEM %</th>
                                    <th>Command</th>
                                </tr>
                            </thead>
                            <tbody id="overviewTopProcesses">
                                <tr><td colspan="6" class="empty-state">No data — visit Processes tab to load</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Memory Tab -->
            <div id="memoryTab" class="tab-content">
              <div class="section">
                <div class="section-header">
                  <i class="codicon codicon-server-process"></i>
                  <span>Memory Overview</span>
                </div>
                <div class="section-content">
                  <div class="info-grid">
                    <div class="info-item">
                      <span class="info-label">Usage</span>
                      <span class="info-value" id="memoryTabUsage">-</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">Total</span>
                      <span class="info-value" id="memoryTabTotal">-</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">Used</span>
                      <span class="info-value" id="memoryTabUsed">-</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">Available</span>
                      <span class="info-value" id="memoryTabAvailable">-</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">Buffers</span>
                      <span class="info-value" id="memoryTabBuffers">-</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">Cache</span>
                      <span class="info-value" id="memoryTabCached">-</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">Swap</span>
                      <span class="info-value" id="memoryTabSwap">-</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">Memory Health</span>
                      <span class="info-value">
                        <span class="status-pill" id="memoryTabHealth">Unknown</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="section">
                <div class="section-header">
                  <i class="codicon codicon-graph"></i>
                  <span>Memory Breakdown</span>
                </div>
                <div class="section-content">
                  <div class="memory-breakdown-list">
                    <div class="memory-breakdown-row">
                      <div class="memory-breakdown-label">Used</div>
                      <div class="memory-breakdown-bar-bg">
                        <div id="memoryUsedBar" class="memory-breakdown-bar-fill usage-danger" style="width: 0%;"></div>
                      </div>
                      <div id="memoryUsedBarText" class="memory-breakdown-value">-</div>
                    </div>
                    <div class="memory-breakdown-row">
                      <div class="memory-breakdown-label">Available</div>
                      <div class="memory-breakdown-bar-bg">
                        <div id="memoryAvailableBar" class="memory-breakdown-bar-fill usage-normal" style="width: 0%;"></div>
                      </div>
                      <div id="memoryAvailableBarText" class="memory-breakdown-value">-</div>
                    </div>
                    <div class="memory-breakdown-row">
                      <div class="memory-breakdown-label">Swap</div>
                      <div class="memory-breakdown-bar-bg">
                        <div id="memorySwapBar" class="memory-breakdown-bar-fill usage-warn" style="width: 0%;"></div>
                      </div>
                      <div id="memorySwapBarText" class="memory-breakdown-value">-</div>
                    </div>
                  </div>
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
                        <div class="process-search-bar">
                            <i class="codicon codicon-search process-search-icon"></i>
                            <input id="processSearchInput" class="process-search-input" type="text" placeholder="Filter by name, user, PID, command…" autocomplete="off" spellcheck="false" />
                            <span id="processMatchCount" class="process-match-count"></span>
                            <button id="processClearSearch" class="process-clear-search-btn" title="Clear filter" style="display:none;">
                                <i class="codicon codicon-close"></i>
                            </button>
                        </div>
                        <table class="process-table">
                            <thead>
                                <tr>
                                    <th data-sort="pid">PID</th>
                                    <th data-sort="name">Name</th>
                                    <th data-sort="user">User</th>
                                  <th data-sort="stat">State</th>
                                    <th data-sort="cpu">CPU %</th>
                                    <th data-sort="mem">MEM %</th>
                                  <th data-sort="rss">RSS</th>
                                  <th data-sort="vsz">VSZ</th>
                                  <th data-sort="time">Time</th>
                                    <th data-sort="command">Command</th>
                                    <th class="process-actions-col">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="processList">
                                <tr><td colspan="11" class="empty-state">No data available</td></tr>
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
                                    <th data-sort="name">Interface</th>
                                  <th data-sort="state">State</th>
                                  <th data-sort="ipAddress">IP</th>
                                    <th data-sort="rxBytes">RX Bytes</th>
                                    <th data-sort="txBytes">TX Bytes</th>
                                    <th data-sort="rxRate">RX Rate</th>
                                    <th data-sort="txRate">TX Rate</th>
                                  <th data-sort="rxPackets">RX Packets</th>
                                  <th data-sort="txPackets">TX Packets</th>
                                  <th>RX Err/Drop</th>
                                  <th>TX Err/Drop</th>
                                </tr>
                            </thead>
                            <tbody id="networkList">
                                <tr><td colspan="11" class="empty-state">No data available</td></tr>
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
                                    <th data-sort="device">Device</th>
                                    <th data-sort="readKBps">Read Rate</th>
                                    <th data-sort="writeKBps">Write Rate</th>
                                    <th data-sort="utilization">Utilization</th>
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

            <!-- Logs Tab -->
            <div id="logsTab" class="tab-content">
                <div class="section logs-section">
                    <div class="section-header">
                        <i class="codicon codicon-output"></i>
                        <span>System Logs</span>
                        <div class="logs-controls">
                            <select id="logFileSelect" class="logs-file-select">
                                <option value="">-- Select a log file --</option>
                            </select>
                            <select id="logLinesSelect" class="logs-lines-select">
                                <option value="100">Last 100 lines</option>
                                <option value="200" selected>Last 200 lines</option>
                                <option value="500">Last 500 lines</option>
                                <option value="1000">Last 1000 lines</option>
                            </select>
                            <button id="logAutoRefreshBtn" class="logs-auto-refresh-btn" title="Toggle auto-refresh every 5s">
                                <i class="codicon codicon-eye"></i>
                            </button>
                            <button id="logRefreshBtn" class="logs-refresh-btn" title="Reload log">
                                <i class="codicon codicon-refresh"></i>
                            </button>
                            <button id="logDownloadBtn" class="logs-download-btn" title="Download full log file to local" disabled>
                                <i class="codicon codicon-cloud-download"></i>
                            </button>
                        </div>
                    </div>
                    <div class="logs-search-bar">
                        <i class="codicon codicon-search logs-search-icon"></i>
                        <input id="logSearchInput" class="logs-search-input" type="text" placeholder="Filter / highlight…" autocomplete="off" spellcheck="false" />
                        <button id="logFilterModeBtn" class="logs-filter-mode-btn" title="Switch between highlight and filter mode">Highlight</button>
                        <span id="logMatchCount" class="logs-match-count"></span>
                        <button id="logClearSearchBtn" class="logs-clear-search-btn" title="Clear search" style="display:none"><i class="codicon codicon-close"></i></button>
                    </div>
                    <div class="section-content logs-output-container">
                        <pre id="logOutput" class="log-output"><span class="log-placeholder">Select a log file above to view its contents.</span></pre>
                    </div>
                </div>
            </div>

            <!-- Ports Tab -->
            <div id="portsTab" class="tab-content">
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-plug"></i>
                        <span>Listening Ports</span>
                    </div>
                    <div class="section-content">
                        <table class="ports-table">
                            <thead>
                                <tr>
                                    <th data-sort="localPort">Port</th>
                                    <th data-sort="proto">Proto</th>
                                    <th data-sort="localAddress">Address</th>
                                    <th data-sort="processName">Process</th>
                                    <th data-sort="pid">PID</th>
                                </tr>
                            </thead>
                            <tbody id="portsList">
                                <tr><td colspan="5" class="empty-state">Loading…</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Users Tab -->
            <div id="usersTab" class="tab-content">
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-account"></i>
                        <span>Current Sessions</span>
                    </div>
                    <div class="section-content">
                        <table class="users-table">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>TTY</th>
                                    <th>From</th>
                                    <th>Login Time</th>
                                    <th>Idle</th>
                                    <th>What</th>
                                </tr>
                            </thead>
                            <tbody id="userSessionsList">
                                <tr><td colspan="6" class="empty-state">Loading…</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-history"></i>
                        <span>Login History (last 30)</span>
                    </div>
                    <div class="section-content">
                        <table class="users-table">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>TTY</th>
                                    <th>From</th>
                                    <th>Login Time</th>
                                    <th>Logout / Status</th>
                                    <th>Duration</th>
                                </tr>
                            </thead>
                            <tbody id="loginHistoryList">
                                <tr><td colspan="6" class="empty-state">Loading…</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Services Tab -->
            <div id="servicesTab" class="tab-content">
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-list-ordered"></i>
                        <span>Systemd Services</span>
                        <div class="services-filter-bar">
                            <input id="servicesFilter" class="services-filter-input" type="text" placeholder="Filter services…" autocomplete="off" spellcheck="false" />
                        </div>
                    </div>
                    <div class="section-content">
                        <table class="services-table">
                            <thead>
                                <tr>
                                    <th data-sort="unit">Unit</th>
                                    <th data-sort="active">Active</th>
                                    <th data-sort="sub">Sub</th>
                                    <th data-sort="load">Load</th>
                                    <th>Description</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="servicesList">
                                <tr><td colspan="6" class="empty-state">Loading…</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Docker Tab -->
            <div id="dockerTab" class="tab-content">
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-layers"></i>
                        <span>Docker Containers</span>
                    </div>
                    <div class="section-content">
                        <div id="dockerUnavailable" style="display:none;" class="docker-unavailable">
                            <i class="codicon codicon-info"></i>
                            Docker is not installed or not running on this host.
                        </div>
                        <table class="docker-table" id="dockerTable">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th data-sort="name">Name</th>
                                    <th data-sort="image">Image</th>
                                    <th data-sort="state">State</th>
                                    <th>Status</th>
                                    <th data-sort="cpuPercent">CPU%</th>
                                    <th data-sort="memPercent">Mem%</th>
                                    <th>Net I/O</th>
                                    <th>Ports</th>
                                </tr>
                            </thead>
                            <tbody id="dockerList">
                                <tr><td colspan="9" class="empty-state">Loading…</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Crontab Tab -->
            <div id="crontabTab" class="tab-content">
                <div class="section">
                    <div class="section-header">
                        <i class="codicon codicon-calendar"></i>
                        <span>Cron Jobs</span>
                        <button id="crontabAddBtn" class="crontab-add-btn" title="Add new cron job">
                            <i class="codicon codicon-add"></i>
                            Add Job
                        </button>
                    </div>
                    <div class="section-content">
                        <table class="crontab-table">
                            <thead>
                                <tr>
                                    <th data-sort="source">Source</th>
                                    <th>Schedule</th>
                                    <th data-sort="user">User</th>
                                    <th data-sort="command">Command</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="crontabList">
                                <tr><td colspan="5" class="empty-state">Loading…</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Process Detail Modal -->
    <div id="processDetailModal" class="process-detail-modal" style="display:none;">
        <div class="process-detail-overlay" id="processDetailOverlay"></div>
        <div class="process-detail-dialog">
            <div class="process-detail-header">
                <span class="process-detail-title">
                    <i class="codicon codicon-server-process"></i>
                    <span id="processDetailTitle">Process Details</span>
                </span>
                <button class="process-detail-close" id="processDetailClose" title="关闭">
                    <i class="codicon codicon-close"></i>
                </button>
            </div>
            <div class="process-detail-body" id="processDetailBody"></div>
        </div>
    </div>

    <!-- Docker Container Log Modal -->
    <div id="dockerLogModal" class="process-detail-modal" style="display:none;">
        <div class="process-detail-overlay" id="dockerLogOverlay"></div>
        <div class="process-detail-dialog docker-log-dialog">
            <div class="process-detail-header">
                <span class="process-detail-title">
                    <i class="codicon codicon-output"></i>
                    <span id="dockerLogTitle">Container Logs</span>
                </span>
                <div class="process-detail-header-actions">
                    <label class="docker-log-autoscroll-label" title="Auto-scroll to latest">
                        <input type="checkbox" id="dockerLogAutoScroll" checked />
                        <span>Auto-scroll</span>
                    </label>
                    <button class="icon-button" id="dockerLogClear" title="Clear log display">
                        <i class="codicon codicon-clear-all"></i>
                    </button>
                    <button class="process-detail-close" id="dockerLogClose" title="Close">
                        <i class="codicon codicon-close"></i>
                    </button>
                </div>
            </div>
            <pre id="dockerLogContent" class="docker-log-content"></pre>
            <div id="dockerLogStatus" class="docker-log-status">Connecting…</div>
        </div>
    </div>

    <!-- Crontab Edit Modal -->
    <div id="crontabModal" class="process-detail-modal" style="display:none;">
        <div class="process-detail-overlay" id="crontabModalOverlay"></div>
        <div class="process-detail-dialog crontab-modal-dialog">
            <div class="process-detail-header">
                <span class="process-detail-title">
                    <i class="codicon codicon-calendar"></i>
                    <span id="crontabModalTitle">Add Cron Job</span>
                </span>
                <button class="process-detail-close" id="crontabModalClose" title="Close">
                    <i class="codicon codicon-close"></i>
                </button>
            </div>
            <div class="crontab-modal-body">
                <div class="crontab-presets">
                    <span class="crontab-presets-label">Presets:</span>
                    <button class="crontab-preset-btn" data-preset="* * * * *">Every min</button>
                    <button class="crontab-preset-btn" data-preset="0 * * * *">Hourly</button>
                    <button class="crontab-preset-btn" data-preset="0 0 * * *">Daily</button>
                    <button class="crontab-preset-btn" data-preset="0 0 * * 0">Weekly</button>
                    <button class="crontab-preset-btn" data-preset="0 0 1 * *">Monthly</button>
                    <button class="crontab-preset-btn" data-preset="@reboot">@reboot</button>
                </div>
                <div class="crontab-modal-field">
                    <label class="crontab-modal-label">Schedule Expression</label>
                    <input class="crontab-modal-input" id="crontabScheduleInput"
                        placeholder="* * * * *" spellcheck="false" autocomplete="off" />
                    <span class="crontab-modal-hint">min&nbsp;hour&nbsp;day&nbsp;month&nbsp;weekday &mdash; or special like @reboot</span>
                </div>
                <div class="crontab-modal-field">
                    <label class="crontab-modal-label">Command</label>
                    <input class="crontab-modal-input" id="crontabCommandInput"
                        placeholder="/path/to/script.sh" spellcheck="false" autocomplete="off" />
                </div>
                <div id="crontabModalError" class="crontab-modal-error" style="display:none;"></div>
            </div>
            <div class="crontab-modal-footer">
                <button class="crontab-modal-btn crontab-modal-btn-cancel" id="crontabModalCancel">Cancel</button>
                <button class="crontab-modal-btn crontab-modal-btn-save" id="crontabModalSave">Save</button>
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
