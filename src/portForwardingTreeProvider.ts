import * as vscode from 'vscode';
import { HostConfig } from './types';
import { PortForwarding, ForwardType } from './types/portForward.types';
import { PortForwardService } from './services/portForwardService';
import { HostManager } from './hostManager';

/**
 * TreeView 项类型
 */
export type PortForwardTreeItemType = 'host' | 'forwarding';

/**
 * Get display info for forward type
 */
function getForwardTypeInfo(forwardType: ForwardType): { label: string; icon: string; color?: string } {
  switch (forwardType) {
    case 'local':
      return { label: 'Local', icon: 'arrow-down', color: 'charts.blue' };
    case 'remote':
      return { label: 'Remote', icon: 'arrow-up', color: 'charts.purple' };
    case 'dynamic':
      return { label: 'SOCKS5', icon: 'globe', color: 'charts.orange' };
    default:
      return { label: 'Local', icon: 'arrow-down', color: 'charts.blue' };
  }
}

/**
 * 端口转发TreeView数据项
 */
export class PortForwardTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly type: PortForwardTreeItemType,
    public readonly data: HostConfig | PortForwarding,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);

    if (type === 'host') {
      const host = data as HostConfig;
      this.contextValue = 'portForwardHost';
      this.iconPath = new vscode.ThemeIcon('server');
      this.description = `${host.host}:${host.port}`;
      this.tooltip = `Host: ${host.name}\n${host.username}@${host.host}:${host.port}`;
    } else {
      const forwarding = data as PortForwarding;
      const forwardType = forwarding.forwardType || 'local';
      const typeInfo = getForwardTypeInfo(forwardType);

      // contextValue根据状态设置，用于控制菜单显示
      this.contextValue = forwarding.status === 'active' ? 'portForwardingActive' : 'portForwardingInactive';

      // 根据状态和类型设置不同的图标
      if (forwarding.status === 'active') {
        this.iconPath = new vscode.ThemeIcon(typeInfo.icon, new vscode.ThemeColor('charts.green'));
      } else {
        this.iconPath = new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('descriptionForeground'));
      }

      // Label based on forward type
      if (forwardType === 'local') {
        this.label = `${forwarding.remotePort} → ${forwarding.localHost}:${forwarding.localPort}`;
      } else if (forwardType === 'remote') {
        this.label = `${forwarding.localPort} → ${forwarding.remoteHost}:${forwarding.remotePort}`;
      } else if (forwardType === 'dynamic') {
        this.label = `SOCKS5 :${forwarding.localPort}`;
      }

      // Description: type badge + 状态 + 进程名
      const descParts: string[] = [`[${typeInfo.label}]`];
      if (forwarding.status === 'inactive') {
        descParts.push('Stopped');
      }
      if (forwarding.runningProcess) {
        descParts.push(forwarding.runningProcess);
      }
      this.description = descParts.join(' ');

      // Tooltip: 详细信息
      const tooltipParts = [
        `Type: ${typeInfo.label}`,
        `Status: ${forwarding.status === 'active' ? 'Active' : 'Stopped'}`
      ];

      if (forwardType === 'local') {
        tooltipParts.push(`Remote Port: ${forwarding.remotePort}`);
        tooltipParts.push(`Local: ${forwarding.localHost}:${forwarding.localPort}`);
      } else if (forwardType === 'remote') {
        tooltipParts.push(`Local Port: ${forwarding.localPort}`);
        tooltipParts.push(`Remote: ${forwarding.remoteHost}:${forwarding.remotePort}`);
      } else if (forwardType === 'dynamic') {
        tooltipParts.push(`SOCKS5 Proxy: ${forwarding.localHost}:${forwarding.localPort}`);
      }

      if (forwarding.runningProcess) {
        tooltipParts.push(`Process: ${forwarding.runningProcess}`);
      }
      this.tooltip = tooltipParts.join('\n');

      // If active and is local forwarding, add click command to open browser
      if (forwarding.status === 'active' && forwardType === 'local') {
        this.command = {
          command: 'simpleSftp.openPortForwardingInBrowser',
          title: 'Open in Browser',
          arguments: [`${forwarding.localHost}:${forwarding.localPort}`]
        };
      }
    }
  }
}

/**
 * 端口转发TreeView提供者
 */
export class PortForwardingTreeProvider implements vscode.TreeDataProvider<PortForwardTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<PortForwardTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly hostManager: HostManager,
    private readonly portForwardService: PortForwardService
  ) {
    // 监听端口转发变化，自动刷新树视图
    this.portForwardService.onPortForwardingEvent(() => {
      this.refresh();
    });
  }

  /**
   * 刷新树视图
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * 获取TreeItem
   */
  getTreeItem(element: PortForwardTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * 获取子节点
   */
  async getChildren(element?: PortForwardTreeItem): Promise<PortForwardTreeItem[]> {
    if (!element) {
      // 根节点：返回所有有活动转发的主机
      return this.getHostsWithForwardings();
    } else if (element.type === 'host') {
      // 主机节点：返回该主机的所有端口转发
      const host = element.data as HostConfig;
      return this.getForwardingsForHost(host);
    }

    return [];
  }

  /**
   * 获取所有有活动端口转发的主机
   */
  private async getHostsWithForwardings(): Promise<PortForwardTreeItem[]> {
    const forwardings = this.portForwardService.getAllForwardings();

    if (forwardings.length === 0) {
      return [];
    }

    // 获取所有主机配置
    const allHosts = this.hostManager.getHostsSync();
    const hostsMap = new Map(allHosts.map(h => [h.id, h]));

    // 按主机ID分组
    const hostMap = new Map<string, PortForwarding[]>();
    for (const fwd of forwardings) {
      if (!hostMap.has(fwd.hostId)) {
        hostMap.set(fwd.hostId, []);
      }
      hostMap.get(fwd.hostId)!.push(fwd);
    }

    // 创建主机节点
    const items: PortForwardTreeItem[] = [];
    for (const [hostId, fwds] of hostMap.entries()) {
      const host = hostsMap.get(hostId);
      if (host) {
        const label = `${host.name} (${fwds.length})`;
        items.push(new PortForwardTreeItem(
          label,
          'host',
          host,
          vscode.TreeItemCollapsibleState.Expanded
        ));
      }
    }

    return items;
  }

  /**
   * 获取指定主机的所有端口转发
   */
  private getForwardingsForHost(host: HostConfig): PortForwardTreeItem[] {
    const forwardings = this.portForwardService.getForwardingsForHost(host.id);

    return forwardings.map(fwd =>
      new PortForwardTreeItem(
        `${fwd.remotePort}`,
        'forwarding',
        fwd,
        vscode.TreeItemCollapsibleState.None
      )
    );
  }
}
