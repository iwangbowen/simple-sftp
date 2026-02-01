import * as vscode from 'vscode';
import { HostConfig, GroupConfig, PathBookmark } from './types';
import { HostManager } from './hostManager';
import { AuthManager } from './authManager';
import { logger } from './logger';

/**
 * 拖放数据传输项
 */
interface DragDropData {
  type: TreeItemType;
  id: string;
}

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
      // Click host opens advanced configuration webview
      this.command = {
        command: 'simpleSftp.configureHostAdvanced',
        title: 'Advanced Configuration',
        arguments: [this]
      };
    } else if (type === 'bookmark') {
      const bookmark = data as PathBookmark;
      this.contextValue = 'bookmark';
      // Show bookmark icon with color if set
      this.iconPath = bookmark.color
        ? new vscode.ThemeIcon('bookmark', new vscode.ThemeColor(`charts.${bookmark.color}`))
        : new vscode.ThemeIcon('bookmark');
      this.description = bookmark.path;
      // Build tooltip with description if available
      const tooltipParts = [`Path: ${bookmark.path}`];
      if (bookmark.description) {
        tooltipParts.push(`Description: ${bookmark.description}`);
      }
      if (bookmark.color) {
        tooltipParts.push(`Color: ${bookmark.color}`);
      }
      this.tooltip = tooltipParts.join('\n');
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
export class HostTreeProvider implements vscode.TreeDataProvider<HostTreeItem>, vscode.TreeDragAndDropController<HostTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<HostTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private treeView?: vscode.TreeView<HostTreeItem>;

  // Drag and drop configuration
  dropMimeTypes = ['application/vnd.code.tree.simpleSftp.hosts'];
  dragMimeTypes = ['application/vnd.code.tree.simpleSftp.hosts'];

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
      logger.warn('TreeView not initialized, cannot expand all');
      return;
    }

    logger.info('Expanding all items in tree view');

    // Get all root items (groups and ungrouped hosts)
    const rootItems = await this.getRootItems();
    logger.info(`Found ${rootItems.length} root items to expand`);

    // Expand all root items with expand: 3 to expand up to 3 levels deep
    // This will expand: group → hosts → bookmarks
    const promises = rootItems
      .filter(item => item.collapsibleState !== vscode.TreeItemCollapsibleState.None)
      .map(async (item) => {
        try {
          await this.treeView!.reveal(item, { expand: 3, select: false, focus: false });
          logger.info(`Expanded: ${item.label}`);
        } catch (error: unknown) {
          logger.error(`Failed to expand ${item.label}: ${error}`);
        }
      });

    await Promise.all(promises);

    logger.info('Expand all completed');
  }

  getTreeItem(element: HostTreeItem): vscode.TreeItem {
    return element;
  }

  getParent(element: HostTreeItem): vscode.ProviderResult<HostTreeItem> {
    if (element.type === 'bookmark') {
      // Bookmark's parent is its host (use hostId from element)
      if (!element.hostId) {
        return undefined;
      }
      const hosts = this.hostManager.getHostsSync();
      const host = hosts.find((h: HostConfig) => h.id === element.hostId);
      if (host) {
        return new HostTreeItem(
          host.name,
          'host',
          host,
          vscode.TreeItemCollapsibleState.Collapsed,
          true, // hasAuth - doesn't matter for parent reference
          undefined,
          this.extensionPath
        );
      }
    } else if (element.type === 'host') {
      // Host's parent is its group (if any)
      const host = element.data as HostConfig;
      if (host.group) {
        const groups = this.hostManager.getGroupsSync();
        const group = groups.find((g: GroupConfig) => g.id === host.group);
        if (group) {
          return new HostTreeItem(
            group.name,
            'group',
            group,
            vscode.TreeItemCollapsibleState.Collapsed
          );
        }
      }
    }
    // Group has no parent
    return undefined;
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

  /**
   * 处理拖拽开始
   */
  async handleDrag(
    source: readonly HostTreeItem[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Only allow dragging hosts (not groups or bookmarks)
    const hosts = source.filter(item => item.type === 'host');
    if (hosts.length === 0) {
      // Don't set any data, which will disable dragging
      return;
    }

    const dragData: DragDropData[] = hosts.map(item => ({
      type: item.type,
      id: (item.data as HostConfig).id
    }));

    dataTransfer.set(
      'application/vnd.code.tree.simpleSftp.hosts',
      new vscode.DataTransferItem(dragData)
    );
  }

  /**
   * 处理放置
   */
  async handleDrop(
    target: HostTreeItem | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    const transferItem = dataTransfer.get('application/vnd.code.tree.simpleSftp.hosts');
    if (!transferItem) {
      return;
    }

    const dragData = transferItem.value as DragDropData[];
    if (!dragData || dragData.length === 0) {
      return;
    }

    // Determine target group ID
    let targetGroupId: string | undefined;

    if (target) {
      if (target.type === 'group') {
        // Dropped on a group
        targetGroupId = (target.data as GroupConfig).id;
      } else if (target.type === 'host') {
        // Dropped on a host - use the host's group
        const host = target.data as HostConfig;
        targetGroupId = host.group;
      } else {
        // Cannot drop on bookmarks
        vscode.window.showWarningMessage('Cannot move hosts to bookmarks');
        return;
      }
    }
    // If target is undefined, move to root (ungrouped)

    // Move each dragged host
    try {
      for (const item of dragData) {
        if (item.type === 'host') {
          await this.hostManager.moveHostToGroup(item.id, targetGroupId);
        }
      }

      this.refresh();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to move host(s): ${errorMessage}`);
      logger.error(`Failed to move host(s): ${errorMessage}`);
    }
  }
}
