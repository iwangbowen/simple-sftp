import * as vscode from 'vscode';
import { HostConfig } from './types';
import { PortForwarding } from './types/portForward.types';
import { PortForwardService } from './services/portForwardService';
import { HostManager } from './hostManager';

/**
 * TreeView 项类型
 */
export type PortForwardTreeItemType = 'host' | 'forwarding';

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
      this.contextValue = 'portForwarding';
      this.iconPath = new vscode.ThemeIcon('arrow-both');

      // Label: 远程端口 → 本地端口
      this.label = `${forwarding.remotePort} → ${forwarding.localHost}:${forwarding.localPort}`;

      // Description: 进程名
      if (forwarding.runningProcess) {
        this.description = forwarding.runningProcess;
      }

      // Tooltip: 详细信息
      const tooltipParts = [
        `Remote Port: ${forwarding.remotePort}`,
        `Local: ${forwarding.localHost}:${forwarding.localPort}`,
        `Remote Host: ${forwarding.remoteHost || '0.0.0.0'}`
      ];
      if (forwarding.runningProcess) {
        tooltipParts.push(`Process: ${forwarding.runningProcess}`);
      }
      this.tooltip = tooltipParts.join('\n');
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
