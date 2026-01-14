import * as vscode from 'vscode';
import { HostConfig, GroupConfig, PathBookmark } from './types';
import { HostManager } from './hostManager';
import { AuthManager } from './authManager';

/**
 * TreeView 项类型
 */
export type TreeItemType = 'group' | 'host' | 'bookmark';

/**
 * TreeView 数据项
 */
export class HostTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly type: TreeItemType,
    public readonly data: HostConfig | GroupConfig | PathBookmark,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly hasAuth: boolean = true, // Whether authentication is configured
    public readonly hostId?: string, // Host ID for bookmark items
    private readonly extensionPath?: string // Extension path for custom icons
  ) {
    super(label, collapsibleState);

    if (type === 'host') {
      const host = data as HostConfig;
      this.contextValue = 'host';

      // Show different icon based on starred state and auth status
      if (host.starred) {
        // Starred hosts: custom golden star if configured, gray star if not configured
        if (extensionPath) {
          const iconName = hasAuth ? 'star-golden.svg' : 'star-gray.svg';
          const iconPath = vscode.Uri.file(
            extensionPath + '/resources/' + iconName
          );
          this.iconPath = {
            light: iconPath,
            dark: iconPath
          };
        } else {
          // Fallback to theme icon
          this.iconPath = hasAuth
            ? new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.orange'))
            : new vscode.ThemeIcon('star-full', new vscode.ThemeColor('descriptionForeground'));
        }
      } else if (hasAuth) {
        // Non-starred hosts with auth: server icon with optional user color
        this.iconPath = new vscode.ThemeIcon(
          'server',
          host.color ? new vscode.ThemeColor(`charts.${host.color}`) : undefined
        );
      } else {
        // Non-starred hosts without auth: warning icon
        this.iconPath = new vscode.ThemeIcon(
          'warning',
          new vscode.ThemeColor('errorForeground') // Red warning icon
        );
      }

      this.description = `${host.username}@${host.host}:${host.port}`;
      this.tooltip = this.generateTooltip(host, hasAuth);
      // Remove command so clicking host doesn't open edit dialog
      // User can still edit via context menu
    } else if (type === 'bookmark') {
      const bookmark = data as PathBookmark;
      this.contextValue = 'bookmark';
      this.iconPath = new vscode.ThemeIcon('bookmark');
      this.description = bookmark.path;
      this.tooltip = `Path: ${bookmark.path}`;
    } else {
      this.contextValue = 'group';
      this.iconPath = new vscode.ThemeIcon('folder');
    }
  }

  private generateTooltip(host: HostConfig, hasAuth: boolean): string {
    const authStatus = hasAuth ? 'Configured' : 'Not configured';

    return [
      `Name: ${host.name}`,
      `Address: ${host.host}:${host.port}`,
      `User: ${host.username}`,
      `Auth: ${authStatus}`,
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
  private treeView?: vscode.TreeView<HostTreeItem>;

  constructor(
    private readonly hostManager: HostManager,
    private readonly authManager: AuthManager,
    private readonly extensionPath: string
  ) {}

  setTreeView(treeView: vscode.TreeView<HostTreeItem>): void {
    this.treeView = treeView;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async expandAll(): Promise<void> {
    if (!this.treeView) {
      return;
    }

    // Get all groups
    const groups = await this.hostManager.getGroups();

    // Expand each group
    for (const group of groups) {
      const groupItem = new HostTreeItem(
        group.name,
        'group',
        group,
        vscode.TreeItemCollapsibleState.Collapsed
      );

      try {
        await this.treeView.reveal(groupItem, { expand: true });
      } catch (error) {
        // Ignore errors if item not found in tree
      }
    }

    // Also expand hosts with bookmarks
    const hosts = await this.hostManager.getHosts();
    for (const host of hosts) {
      const bookmarks = await this.hostManager.getBookmarks(host.id);
      if (bookmarks.length > 0) {
        const hostItem = new HostTreeItem(
          `${host.name} (${host.username}@${host.host})`,
          'host',
          host,
          vscode.TreeItemCollapsibleState.Collapsed
        );

        try {
          await this.treeView.reveal(hostItem, { expand: true });
        } catch (error) {
          // Ignore errors if item not found in tree
        }
      }
    }
  }

  getTreeItem(element: HostTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: HostTreeItem): Promise<HostTreeItem[]> {
    if (!element) {
      // 根节点:显示分组和未分组的主机
      return this.getRootItems();
    } else if (element.type === 'group') {
      // 分组节点:显示该分组下的主机
      const group = element.data as GroupConfig;
      return this.getHostsInGroup(group.id);
    } else if (element.type === 'host') {
      // 主机节点:显示该主机的书签
      const host = element.data as HostConfig;
      return this.getBookmarksForHost(host.id);
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

    // Add ungrouped hosts, starred first
    const ungroupedHosts = hosts.filter((h: HostConfig) => !h.group);

    // Sort: starred hosts first, then by name
    ungroupedHosts.sort((a, b) => {
      if (a.starred && !b.starred) {return -1;}
      if (!a.starred && b.starred) {return 1;}
      return a.name.localeCompare(b.name);
    });

    for (const host of ungroupedHosts) {
      const hasAuth = await this.authManager.hasAuth(host.id);
      const bookmarks = await this.hostManager.getBookmarks(host.id);
      // Host is collapsible if it has bookmarks
      const collapsibleState = bookmarks.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

      items.push(
        new HostTreeItem(
          host.name,
          'host',
          host,
          collapsibleState,
          hasAuth,
          undefined,
          this.extensionPath
        )
      );
    }

    return items;
  }

  private async getHostsInGroup(groupId: string): Promise<HostTreeItem[]> {
    const hosts = await this.hostManager.getHosts();
    const groupHosts = hosts.filter((h: HostConfig) => h.group === groupId);

    // Sort: starred hosts first, then by name
    groupHosts.sort((a, b) => {
      if (a.starred && !b.starred) {return -1;}
      if (!a.starred && b.starred) {return 1;}
      return a.name.localeCompare(b.name);
    });

    const items: HostTreeItem[] = [];
    for (const host of groupHosts) {
      const hasAuth = await this.authManager.hasAuth(host.id);
      const bookmarks = await this.hostManager.getBookmarks(host.id);
      // Host is collapsible if it has bookmarks
      const collapsibleState = bookmarks.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

      items.push(
        new HostTreeItem(
          host.name,
          'host',
          host,
          collapsibleState,
          hasAuth,
          undefined,
          this.extensionPath
        )
      );
    }

    return items;
  }

  private async getBookmarksForHost(hostId: string): Promise<HostTreeItem[]> {
    const bookmarks = await this.hostManager.getBookmarks(hostId);
    return bookmarks.map(bookmark =>
      new HostTreeItem(
        bookmark.name,
        'bookmark',
        bookmark,
        vscode.TreeItemCollapsibleState.None,
        true, // bookmarks don't need auth status
        hostId
      )
    );
  }
}
