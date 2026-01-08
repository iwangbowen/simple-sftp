import * as vscode from 'vscode';
import { HostConfig, GroupConfig } from './types';
import { HostManager } from './hostManager';

/**
 * TreeView 项类型
 */
export type TreeItemType = 'group' | 'host';

/**
 * TreeView 数据项
 */
export class HostTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly type: TreeItemType,
    public readonly data: HostConfig | GroupConfig,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);

    if (type === 'host') {
      const host = data as HostConfig;
      this.contextValue = 'host';
      this.iconPath = new vscode.ThemeIcon(
        'server',
        host.color ? new vscode.ThemeColor(`charts.${host.color}`) : undefined
      );
      this.description = `${host.username}@${host.host}:${host.port}`;
      this.tooltip = this.generateTooltip(host);
      this.command = {
        command: 'simpleScp.editHost',
        title: 'Edit Host',
        arguments: [this],
      };
    } else {
      this.contextValue = 'group';
      this.iconPath = new vscode.ThemeIcon('folder');
    }
  }

  private generateTooltip(host: HostConfig): string {
    let authType: string;
    if (host.authType === 'password') {
      authType = 'Password';
    } else if (host.authType === 'privateKey') {
      authType = 'Private Key';
    } else {
      authType = 'SSH Agent';
    }

    return [
      `Name: ${host.name}`,
      `Address: ${host.host}:${host.port}`,
      `User: ${host.username}`,
      `Auth: ${authType}`,
      host.defaultRemotePath ? `Default Path: ${host.defaultRemotePath}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}

/**
 * 主机列表 TreeView 提供程序
 */
export class HostTreeProvider implements vscode.TreeDataProvider<HostTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<HostTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly hostManager: HostManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: HostTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: HostTreeItem): Promise<HostTreeItem[]> {
    if (!element) {
      // 根节点：显示分组和未分组的主机
      return this.getRootItems();
    } else if (element.type === 'group') {
      // 分组节点：显示该分组下的主机
      return this.getHostsInGroup(element.data.id);
    }
    return [];
  }

  private async getRootItems(): Promise<HostTreeItem[]> {
    const groups = await this.hostManager.getGroups();
    const hosts = await this.hostManager.getHosts();
    const items: HostTreeItem[] = [];

    // Add all groups (including empty ones)
    for (const group of groups) {
      items.push(
        new HostTreeItem(
          group.name,
          'group',
          group,
          vscode.TreeItemCollapsibleState.Collapsed
        )
      );
    }

    // Add ungrouped hosts
    const ungroupedHosts = hosts.filter((h: HostConfig) => !h.group);
    for (const host of ungroupedHosts) {
      items.push(
        new HostTreeItem(
          host.name,
          'host',
          host,
          vscode.TreeItemCollapsibleState.None
        )
      );
    }

    return items;
  }

  private async getHostsInGroup(groupId: string): Promise<HostTreeItem[]> {
    const hosts = await this.hostManager.getHosts();
    return hosts
      .filter((h: HostConfig) => h.group === groupId)
      .map(
        (host: HostConfig) =>
          new HostTreeItem(
            host.name,
            'host',
            host,
            vscode.TreeItemCollapsibleState.None
          )
      );
  }
}
