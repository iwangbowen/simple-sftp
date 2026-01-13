import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { HostManager } from './hostManager';
import { AuthManager } from './authManager';
import { HostTreeProvider, HostTreeItem } from './hostTreeProvider';
import { SshConnectionManager } from './sshConnectionManager';
import { HostConfig, HostAuthConfig, FullHostConfig, GroupConfig } from './types';
import { logger } from './logger';
import { SshConnectionPool } from './sshConnectionPool';
import { formatFileSize, formatSpeed, formatRemainingTime } from './utils/formatUtils';
import { BookmarkService } from './services/bookmarkService';
import { RemoteBrowserService } from './services/remoteBrowserService';
import { DEFAULTS, LIMITS, TIMING, PROMPTS, PLACEHOLDERS, MESSAGES, INSTRUCTIONS, TOOLTIPS, LABELS } from './constants';

export class CommandHandler {
  private downloadStatusBar: vscode.StatusBarItem;
  private bookmarkService: BookmarkService;
  private remoteBrowserService: RemoteBrowserService;

  constructor(
    private hostManager: HostManager,
    private authManager: AuthManager,
    private treeProvider: HostTreeProvider
  ) {
    // Create status bar item for download progress
    this.downloadStatusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );

    // Initialize remote browser service
    this.remoteBrowserService = new RemoteBrowserService(
      hostManager,
      this.handleUploadToRemotePath.bind(this),
      this.handleDownloadFromRemotePath.bind(this)
    );

    // Initialize bookmark service
    this.bookmarkService = new BookmarkService(
      hostManager,
      authManager,
      treeProvider,
      this.remoteBrowserService.browseRemoteFilesGeneric.bind(this.remoteBrowserService)
    );
  }

  registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('simpleScp.addHost', () => this.addHost()),
      vscode.commands.registerCommand('simpleScp.addHostToGroup', (item: HostTreeItem) =>
        this.addHostToGroup(item)
      ),
      vscode.commands.registerCommand('simpleScp.editHost', (item: HostTreeItem) =>
        this.editHost(item)
      ),
      vscode.commands.registerCommand('simpleScp.duplicateHost', (item: HostTreeItem) =>
        this.duplicateHost(item)
      ),
      vscode.commands.registerCommand('simpleScp.deleteHost', (item: HostTreeItem, items?: HostTreeItem[]) =>
        this.deleteHost(item, items)
      ),
      vscode.commands.registerCommand('simpleScp.moveHostToGroup', (item: HostTreeItem, items?: HostTreeItem[]) =>
        this.moveHostToGroup(item, items)
      ),
      vscode.commands.registerCommand('simpleScp.toggleStar', (item: HostTreeItem) =>
        this.toggleStar(item)
      ),
      vscode.commands.registerCommand('simpleScp.addGroup', () => this.addGroup()),
      vscode.commands.registerCommand('simpleScp.editGroup', (item: HostTreeItem) =>
        this.editGroup(item)
      ),
      vscode.commands.registerCommand('simpleScp.importFromSshConfig', () =>
        this.importFromSshConfig()
      ),
      vscode.commands.registerCommand('simpleScp.uploadFile', (uri: vscode.Uri) =>
        this.uploadFile(uri)
      ),
      vscode.commands.registerCommand('simpleScp.browseFiles', (item: HostTreeItem) =>
        this.browseFiles(item)
      ),
      vscode.commands.registerCommand('simpleScp.downloadToLocal', (uri: vscode.Uri) =>
        this.downloadToLocal(uri)
      ),
      vscode.commands.registerCommand('simpleScp.setupPasswordlessLogin', (item: HostTreeItem) =>
        this.setupPasswordlessLogin(item)
      ),
      vscode.commands.registerCommand('simpleScp.testConnection', (item: HostTreeItem) =>
        this.testConnection(item)
      ),
      vscode.commands.registerCommand('simpleScp.configureAuth', (item: HostTreeItem) =>
        this.configureAuth(item)
      ),
      vscode.commands.registerCommand('simpleScp.copySshCommand', (item: HostTreeItem) =>
        this.copySshCommand(item)
      ),
      vscode.commands.registerCommand('simpleScp.addBookmark', (item: HostTreeItem) =>
        this.bookmarkService.addBookmark(item)
      ),
      vscode.commands.registerCommand('simpleScp.renameBookmark', (item: HostTreeItem) =>
        this.bookmarkService.renameBookmark(item)
      ),
      vscode.commands.registerCommand('simpleScp.deleteBookmark', (item: HostTreeItem) =>
        this.bookmarkService.deleteBookmark(item)
      ),
      vscode.commands.registerCommand('simpleScp.browseBookmark', (item: HostTreeItem) =>
        this.bookmarkService.browseBookmark(item)
      ),
      vscode.commands.registerCommand('simpleScp.refresh', () => this.refresh()),
      vscode.commands.registerCommand('simpleScp.showLogs', () => this.showLogs()),
      vscode.commands.registerCommand('simpleScp.showConnectionPool', () => this.showConnectionPoolStatus())
    );
  }

  private async addHost(groupId?: string): Promise<void> {
    // Step 1/6: Host name
    const name = await vscode.window.showInputBox({
      prompt: PROMPTS.hostName,
      placeHolder: PLACEHOLDERS.hostName,
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return MESSAGES.hostNameRequired;
        }
        return undefined;
      },
    });
    if (name === undefined) {return;}

    // Step 2/6: Host address
    const host = await vscode.window.showInputBox({
      prompt: PROMPTS.hostAddress,
      placeHolder: PLACEHOLDERS.hostAddress,
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return MESSAGES.hostAddressRequired;
        }
        return undefined;
      },
    });
    if (host === undefined) {return;}

    // Step 3/6: Port number
    const portStr = await vscode.window.showInputBox({
      prompt: PROMPTS.hostPort,
      value: PLACEHOLDERS.port,
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return undefined; // Empty is allowed, will use default
        }
        const port = parseInt(value);
        if (isNaN(port) || port < LIMITS.MIN_PORT || port > LIMITS.MAX_PORT) {
          return MESSAGES.portRange(LIMITS.MIN_PORT, LIMITS.MAX_PORT);
        }
        return undefined;
      },
    });
    if (portStr === undefined) {return;}
    const port = portStr.trim() ? parseInt(portStr) : DEFAULTS.PORT;

    // Step 4/6: Username
    const username = await vscode.window.showInputBox({
      prompt: PROMPTS.hostUsername,
      value: PLACEHOLDERS.username,
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return MESSAGES.usernameRequired;
        }
        return undefined;
      },
    });
    if (username === undefined) {return;}

    // Step 5/6: Save basic host info first
    let newHost: HostConfig;
    try {
      newHost = await this.hostManager.addHost({
        name: name.trim(),
        host: host.trim(),
        port,
        username: username.trim(),
        group: groupId, // Use the provided groupId or undefined
      });
    } catch (error) {
      vscode.window.showErrorMessage(MESSAGES.hostAddFailed + `: ${error}`);
      return;
    }

    // Step 6/6: Configure authentication
    const configureNow = await vscode.window.showQuickPick(
      [
        { label: MESSAGES.yes, value: true },
        { label: MESSAGES.no, value: false },
      ],
      { placeHolder: PROMPTS.hostAuthNow }
    );

    if (configureNow === undefined) {
      // User cancelled, but host is already created
      this.treeProvider.refresh();
      vscode.window.showWarningMessage(MESSAGES.hostAddedNoAuth(name));
      return;
    }

    if (configureNow.value) {
      // Configure authentication immediately
      const authConfigured = await this.configureAuthForHost(newHost.id);

      if (authConfigured) {
        this.treeProvider.refresh();
      } else {
        this.treeProvider.refresh();
        vscode.window.showWarningMessage(MESSAGES.hostAddedNoAuth(name));
      }
    } else {
      this.treeProvider.refresh();
      vscode.window.showInformationMessage(`Host "${name}" added. Remember to configure authentication.`);
    }
  }

  /**
   * Add host to a specific group (called from group context menu)
   */
  private async addHostToGroup(item: HostTreeItem): Promise<void> {
    if (item.type !== 'group') {
      return;
    }

    const groupConfig = item.data as import('./types').GroupConfig;
    logger.info(`Adding host to group: ${groupConfig.name}`);

    // Call addHost with the groupId
    await this.addHost(groupConfig.id);
  }

  /**
   * Configure authentication for a host (helper method)
   * Returns true if authentication was configured successfully
   */
  private async configureAuthForHost(hostId: string): Promise<boolean> {
    // Step 1: Select authentication method
    const authType = await vscode.window.showQuickPick(
      [
        { label: 'SSH Agent', value: 'agent', description: 'Use SSH agent (recommended if available)' },
        { label: 'Private Key', value: 'privateKey', description: 'Use SSH private key file' },
        { label: 'Password', value: 'password', description: 'Use password authentication' },
      ],
      { placeHolder: 'Select authentication method' }
    );

    if (!authType) {
      return false;
    }

    let password: string | undefined;
    let privateKeyPath: string | undefined;
    let passphrase: string | undefined;

    if (authType.value === 'password') {
      password = await vscode.window.showInputBox({
        prompt: 'Enter password',
        password: true,
        validateInput: (value) => {
          if (!value || !value.trim()) {
            return 'Password is required';
          }
          return undefined;
        },
      });
      if (!password) {
        return false;
      }
    } else if (authType.value === 'privateKey') {
      privateKeyPath = await vscode.window.showInputBox({
        prompt: 'Enter private key path',
        value: '~/.ssh/id_rsa',
        validateInput: (value) => {
          if (!value || !value.trim()) {
            return 'Private key path is required';
          }
          return undefined;
        },
      });
      if (!privateKeyPath) {
        return false;
      }

      // Optional passphrase - user can leave empty if key has no passphrase
      passphrase = await vscode.window.showInputBox({
        prompt: 'Enter passphrase (leave empty if no passphrase)',
        password: true,
        placeHolder: 'Press Enter to skip if key has no passphrase',
      });

      // User pressed ESC - cancel the whole process
      if (passphrase === undefined) {
        return false;
      }

      // Empty string means no passphrase, which is OK
    }

    // Save authentication config
    try {
      await this.authManager.saveAuth({
        hostId,
        authType: authType.value as any,
        password,
        privateKeyPath,
        passphrase: passphrase && passphrase.trim() ? passphrase : undefined, // Only save non-empty passphrase
      });
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save authentication: ${error}`);
      return false;
    }
  }

  /**
   * Configure authentication for a host (command)
   */
  private async configureAuth(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {
      return;
    }

    const config = item.data as HostConfig;
    const success = await this.configureAuthForHost(config.id);

    if (success) {
      this.treeProvider.refresh();
    }
  }

  private async editHost(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {return;}

    const config = item.data as HostConfig;

    const options = [
      { label: LABELS.editName, value: 'name' },
      { label: LABELS.editHostAddress, value: 'host' },
      { label: LABELS.editPort, value: 'port' },
      { label: LABELS.editRemotePath, value: 'remotePath' },
      { label: LABELS.changeGroup, value: 'group' },
      { label: LABELS.editColor, value: 'color' },
      { label: LABELS.configureAuth, value: 'auth' },
    ];

    const choice = await vscode.window.showQuickPick(options, {
      placeHolder: PROMPTS.editHost(config.name),
    });

    if (!choice) {return;}

    try {
      if (choice.value === 'name') {
        const name = await vscode.window.showInputBox({
          prompt: PROMPTS.editHostName,
          value: config.name,
          validateInput: (value) => {
            if (!value || !value.trim()) {
              return MESSAGES.hostNameRequired;
            }
            return undefined;
          },
        });
        if (name === undefined) {return;}

        await this.hostManager.updateHost(config.id, { name: name.trim() });
      } else if (choice.value === 'host') {
        const host = await vscode.window.showInputBox({
          prompt: PROMPTS.editHostAddress,
          value: config.host,
          placeHolder: PLACEHOLDERS.hostAddress,
          validateInput: (value) => {
            if (!value || !value.trim()) {
              return MESSAGES.hostAddressRequired;
            }
            return undefined;
          },
        });
        if (host === undefined) {return;}

        await this.hostManager.updateHost(config.id, { host: host.trim() });
      } else if (choice.value === 'port') {
        const portStr = await vscode.window.showInputBox({
          prompt: PROMPTS.editPort,
          value: config.port.toString(),
          placeHolder: PLACEHOLDERS.port,
          validateInput: (value) => {
            if (!value || !value.trim()) {
              return MESSAGES.portRequired;
            }
            const port = parseInt(value);
            if (isNaN(port) || port < LIMITS.MIN_PORT || port > LIMITS.MAX_PORT) {
              return MESSAGES.portInvalid;
            }
            return undefined;
          },
        });
        if (portStr === undefined) {return;}

        await this.hostManager.updateHost(config.id, { port: parseInt(portStr) });
      } else if (choice.value === 'remotePath') {
        const defaultRemotePath = await vscode.window.showInputBox({
          prompt: PROMPTS.editRemotePath,
          value: config.defaultRemotePath || DEFAULTS.REMOTE_PATH,
        });
        if (defaultRemotePath === undefined) {return;}

        await this.hostManager.updateHost(config.id, {
          defaultRemotePath: defaultRemotePath.trim() || undefined,
        });
      } else if (choice.value === 'group') {
        const groups = await this.hostManager.getGroups();

        const groupChoice = await vscode.window.showQuickPick(
          [
            { label: LABELS.noGroup, value: undefined },
            ...groups.map(g => ({
              label: g.name,
              value: g.id,
              description: config.group === g.id ? LABELS.current : undefined,
            })),
          ],
          { placeHolder: PROMPTS.selectGroup }
        );
        if (groupChoice === undefined) {return;}

        await this.hostManager.updateHost(config.id, {
          group: groupChoice.value,
        });
      } else if (choice.value === 'color') {
        const colorChoice = await vscode.window.showQuickPick(
          [
            { label: LABELS.noColor, value: undefined, description: LABELS.useDefaultColor },
            { label: LABELS.red, value: 'red', description: '🔴' },
            { label: LABELS.green, value: 'green', description: '🟢' },
            { label: LABELS.blue, value: 'blue', description: '🔵' },
            { label: LABELS.yellow, value: 'yellow', description: '🟡' },
            { label: LABELS.purple, value: 'purple', description: '🟣' },
          ],
          { placeHolder: PROMPTS.selectColor }
        );
        if (colorChoice === undefined) {return;}

        await this.hostManager.updateHost(config.id, {
          color: colorChoice.value,
        });
      } else if (choice.value === 'auth') {
        // Configure authentication
        await this.configureAuthForHost(config.id);
        this.treeProvider.refresh();
        return; // Early return after auth config
      }

      this.treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(MESSAGES.updateFailed(error));
    }
  }

  /**
   * Duplicate a host configuration
   */
  private async duplicateHost(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {
      return;
    }

    const sourceConfig = item.data as HostConfig;

    // Create a new host name with " (Copy)" suffix
    let newName = `${sourceConfig.name} (Copy)`;

    // Check if a host with this name already exists, append number if needed
    const existingHosts = await this.hostManager.getHosts();
    let counter = 2;
    while (existingHosts.some(h => h.name === newName)) {
      newName = `${sourceConfig.name} (Copy ${counter})`;
      counter++;
    }

    // Ask user to confirm or modify the name
    const confirmedName = await vscode.window.showInputBox({
      prompt: 'Enter name for duplicated host',
      value: newName,
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return MESSAGES.hostNameRequired;
        }
        return undefined;
      }
    });

    if (!confirmedName) {
      return;
    }

    try {
      // Create new host with same configuration (except name and id)
      const newHost = await this.hostManager.addHost({
        name: confirmedName.trim(),
        host: sourceConfig.host,
        port: sourceConfig.port,
        username: sourceConfig.username,
        defaultRemotePath: sourceConfig.defaultRemotePath,
        group: sourceConfig.group,
        color: sourceConfig.color,
        starred: sourceConfig.starred,
        // Note: bookmarks and recentPaths are not copied
      });

      // Check if source host has authentication configured
      const sourceAuth = await this.authManager.getAuth(sourceConfig.id);

      if (sourceAuth) {
        // Copy authentication configuration
        await this.authManager.saveAuth({
          hostId: newHost.id,
          authType: sourceAuth.authType,
          password: sourceAuth.password,
          privateKeyPath: sourceAuth.privateKeyPath,
          passphrase: sourceAuth.passphrase
        });
      }

      this.treeProvider.refresh();
      logger.info(`Host duplicated: ${sourceConfig.name} → ${confirmedName}`);

      // Show success message with option to edit
      const edit = 'Edit';
      const choice = await vscode.window.showInformationMessage(
        `Host "${confirmedName}" created successfully`,
        edit
      );

      if (choice === edit) {
        // Find the new host item and open edit dialog
        const hosts = await this.hostManager.getHosts();
        const duplicatedHost = hosts.find(h => h.id === newHost.id);
        if (duplicatedHost) {
          // Check authentication for the new host
          const newHostAuth = await this.authManager.hasAuth(duplicatedHost.id);
          const hostItem = new HostTreeItem(
            duplicatedHost.name,
            'host',
            duplicatedHost,
            vscode.TreeItemCollapsibleState.None,
            newHostAuth
          );
          await this.editHost(hostItem);
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to duplicate host: ${error}`);
      logger.error(`Failed to duplicate host ${sourceConfig.name}`, error as Error);
    }
  }

private async deleteHost(item: HostTreeItem, items?: HostTreeItem[]): Promise<void> {
    // When canSelectMany is enabled, items contains all selected tree items
    // If items is provided and has more than one item, use it; otherwise use the single item
    const itemsToDelete = items && items.length > 0 ? items : [item];

    if (itemsToDelete.length === 0) {
      return;
    }

    // Separate hosts and groups
    const hostsToDelete = itemsToDelete.filter(i => i.type === 'host');
    const groupsToDelete = itemsToDelete.filter(i => i.type === 'group');

    // Check if any groups contain hosts
    const allHosts = await this.hostManager.getHosts();
    const groupsWithHosts = groupsToDelete.filter(group => {
      const groupConfig = group.data as GroupConfig;
      return allHosts.some(h => h.group === groupConfig.id);
    });

    // Determine confirmation dialog type
    let deleteOnlyGroups = false;
    if (groupsWithHosts.length > 0) {
      // Modal confirmation for groups with hosts (important operation)
      const totalHostsInGroups = groupsWithHosts.reduce((count, group) => {
        const groupConfig = group.data as GroupConfig;
        return count + allHosts.filter(h => h.group === groupConfig.id).length;
      }, 0);

      const choice = await vscode.window.showWarningMessage(
        groupsWithHosts.length === 1
          ? `The group "${groupsWithHosts[0].label}" contains ${totalHostsInGroups} host(s). What would you like to do?`
          : `${groupsWithHosts.length} group(s) contain a total of ${totalHostsInGroups} host(s). What would you like to do?`,
        { modal: true },
        'Delete Group Only',
        'Delete All'
      );

      if (!choice) {
        return; // User cancelled
      }

      deleteOnlyGroups = choice === 'Delete Group Only';

      // If user chose "Delete All", we need to delete hosts in those groups too
      if (!deleteOnlyGroups) {
        // Add hosts from groups to the deletion list
        for (const groupItem of groupsWithHosts) {
          const groupConfig = groupItem.data as GroupConfig;
          const hostsInGroup = allHosts.filter(h => h.group === groupConfig.id);
          for (const host of hostsInGroup) {
            // Avoid duplicates - don't add if already explicitly selected
            const hostConfig = host as HostConfig;
            const matchedHost = hostsToDelete.find(h => (h.data as HostConfig).id === hostConfig.id);
            if (!matchedHost) {
              await this.hostManager.deleteHost(hostConfig.id);
              logger.info(`Deleted host in group: ${hostConfig.name}`);
            }
          }
        }
      }
    } else {
      // Modal confirmation for empty groups or hosts only
      const confirm = await vscode.window.showWarningMessage(
        itemsToDelete.length === 1
          ? `Delete "${itemsToDelete[0].label}"?`
          : `Delete ${itemsToDelete.length} item(s)?`,
        { modal: true },
        MESSAGES.delete
      );

      if (!confirm) {
        return;
      }
    }

    try {
      // Delete all selected hosts
      for (const hostItem of hostsToDelete) {
        const hostConfig = hostItem.data as HostConfig;
        await this.hostManager.deleteHost(hostConfig.id);
        logger.info(`Deleted host: ${hostItem.label}`);
      }

      // Delete all selected groups
      // If deleteOnlyGroups is true, hosts in the group will be moved to "ungrouped"
      for (const groupItem of groupsToDelete) {
        const groupConfig = groupItem.data as GroupConfig;
        await this.hostManager.deleteGroup(groupConfig.id);
        logger.info(`Deleted group: ${groupItem.label}`);
      }

      this.treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Delete failed: ${error}`);
      logger.error('Delete operation failed', error as Error);
    }
  }

  private async addGroup(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'Enter group name',
      placeHolder: 'e.g., Production',
      validateInput: async (value) => {
        if (!value || !value.trim()) {
          return 'Group name is required';
        }
        const groups = await this.hostManager.getGroups();
        if (groups.some(g => g.name === value.trim())) {
          return 'A group with this name already exists';
        }
        return undefined;
      },
    });

    if (!name) {return;}

    try {
      await this.hostManager.addGroup(name.trim());
      this.treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create group: ${error}`);
    }
  }

  /**
   * Move host(s) to a different group
   */
  private async moveHostToGroup(item: HostTreeItem, items?: HostTreeItem[]): Promise<void> {
    // Get all selected hosts (filter out groups)
    const selectedItems = items && items.length > 0 ? items : [item];
    const hostsToMove = selectedItems.filter(i => i.type === 'host');

    if (hostsToMove.length === 0) {
      vscode.window.showWarningMessage('Please select one or more hosts to move');
      return;
    }

    const groups = await this.hostManager.getGroups();

    const groupChoice = await vscode.window.showQuickPick(
      [
        { label: 'No Group', value: undefined },
        ...groups.map(g => ({
          label: g.name,
          value: g.id,
        })),
      ],
      {
        placeHolder: hostsToMove.length === 1
          ? `Move "${hostsToMove[0].label}" to group`
          : `Move ${hostsToMove.length} host(s) to group`
      }
    );

    if (groupChoice === undefined) {
      return; // User cancelled
    }

    try {
      // Move all selected hosts
      for (const hostItem of hostsToMove) {
        const config = hostItem.data as HostConfig;

        // Skip if already in target group
        if (groupChoice.value === config.group) {
          continue;
        }

        await this.hostManager.updateHost(config.id, {
          group: groupChoice.value,
        });

        logger.info(`Moved host ${config.name} to ${groupChoice.value ? groupChoice.label : 'ungrouped'}`);
      }

      this.treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to move host(s): ${error}`);
      logger.error('Failed to move host(s)', error as Error);
    }
  }

  /**
   * Toggle star/unstar for a host
   */
  private async toggleStar(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {
      return;
    }

    const config = item.data as HostConfig;

    try {
      const newStarred = !config.starred;
      await this.hostManager.updateHost(config.id, {
        starred: newStarred,
      });

      this.treeProvider.refresh();

      const action = newStarred ? 'added to' : 'removed from';
      logger.info(`Host ${config.name} ${action} starred`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to toggle star: ${error}`);
      logger.error('Failed to toggle star', error as Error);
    }
  }

  private async editGroup(item: HostTreeItem): Promise<void> {
    if (item.type !== 'group') {
      return;
    }

    const groupConfig = item.data as import('./types').GroupConfig;

    const newName = await vscode.window.showInputBox({
      prompt: 'Enter new group name',
      value: groupConfig.name,
      validateInput: async (value) => {
        if (!value || !value.trim()) {
          return 'Group name is required';
        }
        // Check for duplicate names (excluding current group)
        const groups = await this.hostManager.getGroups();
        if (groups.some(g => g.id !== groupConfig.id && g.name === value.trim())) {
          return 'A group with this name already exists';
        }
        return undefined;
      },
    });

    if (!newName || newName.trim() === groupConfig.name) {
      return; // User cancelled or name unchanged
    }

    try {
      await this.hostManager.updateGroup(groupConfig.id, newName.trim());
      this.treeProvider.refresh();
      logger.info(`Group ${groupConfig.name} renamed to ${newName}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to rename group: ${error}`);
      logger.error(`Failed to rename group ${groupConfig.name}`, error as Error);
    }
  }

  private async importFromSshConfig(): Promise<void> {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Parsing SSH config...',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Reading SSH config file' });

          const existingHosts = await this.hostManager.getHosts();
          const sshConfigHosts = await this.hostManager.parseSshConfigFile();

          if (sshConfigHosts.length === 0) {
            vscode.window.showInformationMessage('No hosts found in SSH config file');
            return;
          }

          progress.report({ message: 'Filtering hosts' });

          // Filter out hosts that already exist
          const newHosts = sshConfigHosts.filter(
            sshHost =>
              !existingHosts.some(
                h =>
                  h.host === sshHost.host &&
                  h.username === sshHost.username &&
                  h.port === sshHost.port
              )
          );

          if (newHosts.length === 0) {
            vscode.window.showInformationMessage('All hosts from SSH config are already imported');
            return;
          }

          progress.report({ message: `Found ${newHosts.length} new hosts` });
        }
      );

      // After progress completes, show the QuickPick
      const existingHosts = await this.hostManager.getHosts();
      const sshConfigHosts = await this.hostManager.parseSshConfigFile();

      const newHosts = sshConfigHosts.filter(
        sshHost =>
          !existingHosts.some(
            h =>
              h.host === sshHost.host &&
              h.username === sshHost.username &&
              h.port === sshHost.port
          )
      );

      if (newHosts.length === 0) {
        return; // Already shown message in progress
      }

      // Create QuickPick items for multi-selection
      const items = newHosts.map(host => ({
        label: host.name,
        description: `${host.username}@${host.host}:${host.port}`,
        detail: 'No authentication configured (configure after import)',
        picked: true, // Default to selected
        host,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select hosts to import (all selected by default)',
        canPickMany: true,
      });

      if (!selected || selected.length === 0) {
        return;
      }

      // Ask user to select group (optional)
      const groups = await this.hostManager.getGroups();
      const groupChoice = await vscode.window.showQuickPick(
        [
          { label: 'No Group', description: 'Import without grouping', value: undefined },
          ...groups.map(g => ({
            label: g.name,
            description: `Import to ${g.name} group`,
            value: g.id,
          })),
        ],
        { placeHolder: 'Select group for imported hosts (optional)' }
      );

      if (groupChoice === undefined) {
        return; // User cancelled
      }

      // Import selected hosts (without authentication)
      let imported = 0;
      const importedHostIds: string[] = [];
      for (const item of selected) {
        const hostToAdd = groupChoice.value
          ? { ...item.host, group: groupChoice.value }
          : item.host;
        const newHost = await this.hostManager.addHost(hostToAdd);
        importedHostIds.push(newHost.id);
        imported++;
      }

      this.treeProvider.refresh();

      // Prompt to configure authentication
      const configureNow = 'Configure Now';
      const later = 'Later';
      const choice = await vscode.window.showInformationMessage(
        `Successfully imported ${imported} host(s)${groupChoice.value ? ` to ${groupChoice.label}` : ''}. Configure authentication now?`,
        configureNow,
        later
      );

      if (choice === configureNow) {
        // Get the full host configs to show labels
        const allHosts = await this.hostManager.getHosts();
        const importedHosts = allHosts.filter(h => importedHostIds.includes(h.id));

        // Show list of imported hosts to configure
        const hostToConfig = await vscode.window.showQuickPick(
          importedHosts.map(h => ({
            label: h.name,
            description: `${h.username}@${h.host}:${h.port}`,
            hostId: h.id,
          })),
          { placeHolder: 'Select host to configure authentication' }
        );

        if (hostToConfig) {
          await this.configureAuthForHost(hostToConfig.hostId);
          this.treeProvider.refresh();
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Import failed: ${error}`);
    }
  }

  private async uploadFile(uri: vscode.Uri): Promise<void> {
    const localPath = uri.fsPath;
    const stat = fs.statSync(localPath);

    const hosts = await this.hostManager.getHosts();
    if (hosts.length === 0) {
      vscode.window.showWarningMessage('Please add host configuration first');
      return;
    }

    const groups = await this.hostManager.getGroups();
    const recentUsedIds = await this.hostManager.getRecentUsed();

    // Build group map for quick lookup
    const groupMap = new Map(groups.map(g => [g.id, g.name]));

    // Check authentication status for each host
    const allHostItems = await Promise.all(
      hosts.map(async h => {
        const hasAuth = await this.authManager.hasAuth(h.id);
        const groupName = h.group ? groupMap.get(h.group) : undefined;
        const isRecent = recentUsedIds.includes(h.id);

        return {
          label: `$(${hasAuth ? 'server' : 'warning'}) ${h.name}`,
          description: `${h.username}@${h.host}:${h.port}`,
          detail: groupName ? `Group: ${groupName}` : undefined,
          host: h,
          hasAuth,
          isRecent,
        };
      })
    );

    // Split into recent and other hosts
    const recentItems = allHostItems
      .filter(item => item.isRecent)
      .sort((a, b) => {
        const aIndex = recentUsedIds.indexOf(a.host.id);
        const bIndex = recentUsedIds.indexOf(b.host.id);
        return aIndex - bIndex;
      });

    const otherItems = allHostItems
      .filter(item => !item.isRecent)
      .sort((a, b) => {
        // Sort by auth status first, then by name
        if (a.hasAuth && !b.hasAuth) { return -1; }
        if (!a.hasAuth && b.hasAuth) { return 1; }
        return a.host.name.localeCompare(b.host.name);
      });

    // Build QuickPick items with separator
    const quickPickItems: any[] = [];

    if (recentItems.length > 0) {
      quickPickItems.push(
        {
          label: 'Recently Used',
          kind: vscode.QuickPickItemKind.Separator
        } as vscode.QuickPickItem,
        ...recentItems
      );
    }

    if (otherItems.length > 0) {
      if (recentItems.length > 0) {
        quickPickItems.push({
          label: 'All Hosts',
          kind: vscode.QuickPickItemKind.Separator
        } as vscode.QuickPickItem);
      }
      quickPickItems.push(...otherItems);
    }

    const selectedHost = await vscode.window.showQuickPick(
      quickPickItems,
      { placeHolder: 'Select target host' }
    );

    if (!selectedHost || selectedHost.kind === vscode.QuickPickItemKind.Separator) {
      return;
    }

    const config = selectedHost.host;
    // Check authentication
    const authConfig = await this.authManager.getAuth(config.id);
    if (!authConfig) {
      const choice = await vscode.window.showWarningMessage(
        MESSAGES.noAuthConfigured(config.name),
        { modal: true },
        MESSAGES.configure,
        MESSAGES.cancel
      );

      if (choice === MESSAGES.configure) {
        const success = await this.configureAuthForHost(config.id);
        if (!success) {
          return;
        }
        // Recursively call uploadFile after configuring auth
        return this.uploadFile(uri);
      }
      return;
    }

    const remotePath = await this.remoteBrowserService.selectRemotePath(config, authConfig);
    if (!remotePath) {return;}

    const fileName = path.basename(localPath);
    const finalRemotePath = `${remotePath}/${fileName}`.replace(/\\/g, '/');

    logger.info(
      `Starting upload: ${localPath} → ${config.username}@${config.host}:${finalRemotePath}`
    );

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: stat.isDirectory() ? 'Uploading folder' : 'Uploading file',
        cancellable: false,
      },
      async progress => {
        try {
          if (stat.isDirectory()) {
            logger.info(`Uploading directory: ${localPath}`);
            await SshConnectionManager.uploadDirectory(
              config,
              authConfig,
              localPath,
              finalRemotePath,
              (currentFile, percentage) => {
                logger.debug(`Uploading ${currentFile} (${percentage}%)`);
                progress.report({
                  message: `${currentFile} (${percentage}%)`,
                  increment: 1,
                });
              }
            );
          } else {
            logger.info(`Uploading file: ${localPath}`);
            await SshConnectionManager.uploadFile(
              config,
              authConfig,
              localPath,
              finalRemotePath,
              (transferred, total) => {
                const percentage = Math.round((transferred / total) * 100);
                progress.report({
                  message: `${percentage}%`,
                  increment: percentage,
                });
              }
            );
          }

          logger.info(`✓ Upload successful: ${finalRemotePath}`);
          vscode.window.showInformationMessage(`Upload successful: ${finalRemotePath}`);

          // Record this host as recently used
          await this.hostManager.recordRecentUsed(config.id);
          // Record the remote path as recently used
          await this.hostManager.recordRecentPath(config.id, remotePath);
        } catch (error) {
          logger.error(`✗ Upload failed: ${localPath}`, error as Error);

          const openLogs = 'View Logs';
          const choice = await vscode.window.showErrorMessage(
            `Upload failed: ${error}`,
            openLogs
          );

          if (choice === openLogs) {
            logger.show();
          }
        }
      }
    );
  }

  private async setupPasswordlessLogin(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {return;}

    const config = item.data as HostConfig;

    logger.info(`Checking passwordless login for ${config.name}`);

    // Check if we already have private key authentication configured
    const authConfig = await this.authManager.getAuth(config.id);
    if (authConfig && authConfig.authType === 'privateKey') {
      // Test if the key works
      const hasPasswordless = await SshConnectionManager.checkPasswordlessLogin(config, authConfig);
      if (hasPasswordless) {
        logger.info(`Passwordless login already configured for ${config.name}`);
        vscode.window.showInformationMessage('Passwordless login is already configured for this host');
        return;
      }
    }

    const sshDir = path.join(os.homedir(), '.ssh');
    const possibleKeys = ['id_rsa.pub', 'id_ed25519.pub', 'id_ecdsa.pub'];
    let publicKeyPath: string | undefined;

    for (const key of possibleKeys) {
      const keyPath = path.join(sshDir, key);
      if (fs.existsSync(keyPath)) {
        publicKeyPath = keyPath;
        logger.info(`Found public key: ${keyPath}`);
        break;
      }
    }

    if (!publicKeyPath) {
      const message = 'No public key found. Please generate SSH key pair first';
      logger.error(message);
      vscode.window.showErrorMessage(message);
      return;
    }

    // Need password authentication to setup passwordless login
    let tempAuthConfig = authConfig;
    if (!tempAuthConfig || tempAuthConfig.authType !== 'password') {
      const password = await vscode.window.showInputBox({
        prompt: 'Enter password to configure passwordless login',
        password: true,
      });

      if (!password) {return;}

      tempAuthConfig = {
        hostId: config.id,
        authType: 'password',
        password,
      };
    }

    logger.info(`Setting up passwordless login for ${config.name} using key ${publicKeyPath}`);

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Configuring passwordless login...',
        },
        async () => {
          await SshConnectionManager.setupPasswordlessLogin(config, tempAuthConfig!, publicKeyPath!);
        }
      );

      // Update authentication to use private key
      const privateKeyPath = publicKeyPath.replace('.pub', '');
      await this.authManager.saveAuth({
        hostId: config.id,
        authType: 'privateKey',
        privateKeyPath,
      });

      this.treeProvider.refresh();
      logger.info(`✓ Passwordless login configured successfully for ${config.name}`);
      vscode.window.showInformationMessage('Passwordless login configured successfully');
    } catch (error) {
      logger.error(`✗ Failed to configure passwordless login for ${config.name}`, error as Error);

      const openLogs = 'View Logs';
      const choice = await vscode.window.showErrorMessage(
        `Configuration failed: ${error}`,
        openLogs
      );

      if (choice === openLogs) {
        logger.show();
      }
    }
  }

  private async testConnection(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {return;}

    const config = item.data as HostConfig;

    // Check if authentication is configured
    const authConfig = await this.authManager.getAuth(config.id);

    if (!authConfig) {
      logger.warn(`No authentication configured for ${config.name}`);
      const choice = await vscode.window.showWarningMessage(
        MESSAGES.noAuthConfigured(config.name),
        { modal: true },
        MESSAGES.configure,
        MESSAGES.cancel
      );

      if (choice === MESSAGES.configure) {
        const success = await this.configureAuthForHost(config.id);
        if (!success) {
          return;
        }
        // Recursively call testConnection after configuring auth
        return this.testConnection(item);
      }
      return;
    }

    logger.info(`Testing connection to ${config.name} (${config.username}@${config.host}:${config.port})`);
    logger.info(`Authentication type: ${authConfig.authType}`);

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Testing connection to ${config.name}...`,
        },
        async () => {
          await SshConnectionManager.testConnection(config, authConfig);
        }
      );

      logger.info(`✓ Successfully connected to ${config.name}`);
      vscode.window.showInformationMessage(`Connected to ${config.name} successfully`);
    } catch (error) {
      logger.error(`✗ Connection to ${config.name} failed`, error as Error);

      const errorMsg = (error as Error).message;
      let message = `Connection to ${config.name} failed: ${errorMsg}`;

      // Special handling for SSH Agent failures
      if (authConfig.authType === 'agent' && errorMsg.includes('agent')) {
        message = `SSH Agent connection failed. This might be because:\n1. OpenSSH Authentication Agent service is not running\n2. No keys are loaded in the agent\n\nYou can:\n- Start the agent service, or\n- Reconfigure to use private key authentication`;
      }

      const openLogs = 'View Logs';
      const retryAuth = 'Reconfigure Auth';
      const choice = await vscode.window.showErrorMessage(
        message,
        retryAuth,
        openLogs
      );

      if (choice === openLogs) {
        logger.show();
      } else if (choice === retryAuth) {
        // Allow user to reconfigure authentication
        const success = await this.configureAuthForHost(config.id);
        if (success) {
          // Retry connection
          return this.testConnection(item);
        }
      }
    }
  }

  private async copySshCommand(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {return;}

    const config = item.data as HostConfig;
    const sshCommand = `ssh ${config.username}@${config.host} -p ${config.port}`;

    await vscode.env.clipboard.writeText(sshCommand);
    vscode.window.showInformationMessage(`Copied: ${sshCommand}`);
    logger.info(`Copied SSH command: ${sshCommand}`);
  }

  /**
   * Browse files - allows both uploading and downloading files
   */
  private async browseFiles(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {return;}

    const config = item.data as HostConfig;

    // Check authentication
    const authConfig = await this.authManager.getAuth(config.id);
    if (!authConfig) {
      const choice = await vscode.window.showWarningMessage(
        MESSAGES.noAuthConfigured(config.name),
        { modal: true },
        MESSAGES.configure,
        MESSAGES.cancel
      );

      if (choice === MESSAGES.configure) {
        const success = await this.configureAuthForHost(config.id);
        if (!success) {
          return;
        }
        return this.browseFiles(item);
      }
      return;
    }

    // Open file browser with upload and download buttons on each item
    await this.remoteBrowserService.browseRemoteFilesGeneric(
      config,
      authConfig,
      'sync',
      `Browse Files: ${config.name}`
    );
  }

  /**
   * Handle upload files to a specific remote path
   */
  private async handleUploadToRemotePath(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string,
    isDirectory: boolean
  ): Promise<void> {
    // If the remote path is a file, use its parent directory
    const remoteDir = isDirectory ? remotePath : path.dirname(remotePath);

    // Open file/folder picker
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: true,
      openLabel: 'Select Files or Folders to Upload',
      defaultUri: workspaceFolder
    });

    if (!uris || uris.length === 0) {
      return;
    }

    // Upload each selected file/folder
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Uploading to ${config.name}`,
        cancellable: false
      },
      async (progress) => {
        for (let i = 0; i < uris.length; i++) {
          const uri = uris[i];
          const localPath = uri.fsPath;
          const fileName = path.basename(localPath);
          const remoteTargetPath = remoteDir + '/' + fileName;

          progress.report({
            message: `${fileName} (${i + 1}/${uris.length})`,
            increment: (100 / uris.length)
          });

          try {
            const stat = fs.statSync(localPath);
            if (stat.isDirectory()) {
              await SshConnectionManager.uploadDirectory(
                config,
                authConfig,
                localPath,
                remoteTargetPath,
                () => {}
              );
            } else {
              await SshConnectionManager.uploadFile(
                config,
                authConfig,
                localPath,
                remoteTargetPath,
                () => {}
              );
            }
            logger.info(`Uploaded ${localPath} to ${config.host}:${remoteTargetPath}`);
          } catch (error) {
            logger.error(`Failed to upload ${localPath}:`, error as Error);
            vscode.window.showErrorMessage(`Failed to upload ${fileName}: ${error}`);
          }
        }
      }
    );

    await this.hostManager.recordRecentUsed(config.id);
    await this.hostManager.recordRecentPath(config.id, remoteDir);
    vscode.window.showInformationMessage(`Successfully uploaded ${uris.length} item(s) to ${remoteDir}`);
  }

  /**
   * Handle download file/folder from a specific remote path
   */
  private async handleDownloadFromRemotePath(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string,
    isDirectory: boolean
  ): Promise<void> {
    // Select local save path
    const remoteFileName = path.basename(remotePath);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const defaultPath = workspaceFolder
      ? path.join(workspaceFolder, remoteFileName)
      : remoteFileName;
    const defaultUri = vscode.Uri.file(defaultPath);

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri,
      title: 'Select download location',
      saveLabel: 'Download Here'
    });

    if (!saveUri) {return;}

    const localPath = saveUri.fsPath;

    logger.info(
      `Starting download: ${config.username}@${config.host}:${remotePath} → ${localPath}`
    );

    try {
      if (isDirectory) {
        logger.info(`Downloading directory: ${remotePath}`);

        // Show status bar for directory download
        this.downloadStatusBar.text = `$(sync~spin) Downloading folder...`;
        this.downloadStatusBar.tooltip = `Downloading: ${remoteFileName}`;
        this.downloadStatusBar.show();

        await SshConnectionManager.downloadDirectory(
          config,
          authConfig,
          remotePath,
          localPath,
          (currentFile, percentage) => {
            logger.debug(`Downloading ${currentFile} (${percentage}%)`);
            this.downloadStatusBar.text = `$(sync~spin) Downloading folder: ${percentage}%`;
            this.downloadStatusBar.tooltip = `Downloading: ${currentFile}\nProgress: ${percentage}%`;
          }
        );
      } else {
        logger.info(`Downloading file: ${remotePath}`);

        // Track download speed
        let lastTransferred = 0;
        let lastTime = 0; // Initialize to 0 to force first update

        // Show initial status bar
        this.downloadStatusBar.text = `$(sync~spin) Downloading...`;
        this.downloadStatusBar.tooltip = `Downloading: ${remoteFileName}`;
        this.downloadStatusBar.show();

        await SshConnectionManager.downloadFile(
          config,
          authConfig,
          remotePath,
          localPath,
          (transferred, total) => {
            const percentage = Math.round((transferred / total) * 100);
            const currentTime = Date.now();
            const elapsed = (currentTime - lastTime) / 1000; // seconds

            // Calculate and update speed every 5 seconds to reduce flickering
            if (elapsed > 5 || lastTime === 0) {
              const bytesTransferred = transferred - lastTransferred;
              const speed = bytesTransferred / elapsed;

              // Always update text to show percentage
              this.downloadStatusBar.text = `$(sync~spin) ${percentage}%`;

              if (speed > 0 && Number.isFinite(speed)) {
                const formattedSpeed = formatSpeed(speed);

                // Calculate remaining time
                const remaining = total - transferred;
                const remainingTime = remaining / speed;
                const formattedTime = formatRemainingTime(remainingTime);

                // Update status bar
                this.downloadStatusBar.text = `$(sync~spin) ${percentage}% - ${formattedSpeed}`;
                this.downloadStatusBar.tooltip = `Downloading: ${remoteFileName}\nFile Size: ${formatFileSize(total)}\nProgress: ${percentage}% (${formatFileSize(transferred)} / ${formatFileSize(total)})\nSpeed: ${formattedSpeed}\nETA: ${formattedTime}`;
              } else {
                // No speed info available, just show basic tooltip
                this.downloadStatusBar.tooltip = `Downloading: ${remoteFileName}\nFile Size: ${formatFileSize(total)}\nProgress: ${percentage}% (${formatFileSize(transferred)} / ${formatFileSize(total)})`;
              }

              lastTransferred = transferred;
              lastTime = currentTime;
            }
          }
        );
      }

      logger.info(`✓ Download successful: ${localPath}`);
      vscode.window.showInformationMessage(`Successfully downloaded to ${localPath}`);

      // Record this host as recently used
      await this.hostManager.recordRecentUsed(config.id);
      // Record the remote directory path as recently used
      const remoteDir = isDirectory ? remotePath : path.dirname(remotePath);
      await this.hostManager.recordRecentPath(config.id, remoteDir);

      // Hide status bar after successful download
      this.downloadStatusBar.hide();
    } catch (error) {
      logger.error(`✗ Download failed: ${remotePath}`, error as Error);

      // Hide status bar on error
      this.downloadStatusBar.hide();

      const openLogs = 'View Logs';
      const choice = await vscode.window.showErrorMessage(
        `Download failed: ${error}`,
        openLogs
      );

      if (choice === openLogs) {
        logger.show();
      }
    }
  }

  /**
   * Sync with host - upload or download files (deprecated version)
   * @deprecated Use browseFiles with sync mode instead
   */
  private async syncWithHostOld(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {return;}

    const config = item.data as HostConfig;

    // Check authentication
    const authConfig = await this.authManager.getAuth(config.id);
    if (!authConfig) {
      const choice = await vscode.window.showWarningMessage(
        MESSAGES.noAuthConfigured(config.name),
        MESSAGES.configure,
        MESSAGES.cancel
      );

      if (choice === MESSAGES.configure) {
        const success = await this.configureAuthForHost(config.id);
        if (!success) {
          return;
        }
        // Recursively call browseFiles after configuring auth
        return this.browseFiles(item);
      }
      return;
    }

    // Ask user whether to upload or download
    const action = await vscode.window.showQuickPick(
      [
        {
          label: '$(cloud-upload) Upload to Remote Host',
          description: 'Upload files or folders from local to remote',
          action: 'upload'
        },
        {
          label: '$(cloud-download) Download from Remote Host',
          description: 'Download files or folders from remote to local',
          action: 'download'
        }
      ],
      {
        placeHolder: 'Choose sync direction'
      }
    );

    if (!action) {
      return;
    }

    if (action.action === 'upload') {
      await this.handleUploadToHost(config, authConfig);
    } else {
      await this.handleDownloadFromHost(config, authConfig);
    }
  }

  /**
   * Handle upload files/folders to remote host
   */
  private async handleUploadToHost(config: HostConfig, authConfig: HostAuthConfig): Promise<void> {
    // Open file/folder picker
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: true,
      openLabel: 'Select Files or Folders to Upload',
      defaultUri: workspaceFolder
    });

    if (!uris || uris.length === 0) {
      return;
    }

    // Select remote directory
    const remotePath = await this.remoteBrowserService.selectRemoteFileOrDirectory(config, authConfig);
    if (!remotePath) {
      return;
    }

    const remoteDir = remotePath.isDirectory ? remotePath.path : path.dirname(remotePath.path);

    // Upload each selected file/folder
    const progress = vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Uploading to ${config.name}`,
        cancellable: false
      },
      async (progress) => {
        for (let i = 0; i < uris.length; i++) {
          const uri = uris[i];
          const localPath = uri.fsPath;
          const fileName = path.basename(localPath);
          const remoteTargetPath = remoteDir + '/' + fileName;

          progress.report({
            message: `${fileName} (${i + 1}/${uris.length})`,
            increment: (100 / uris.length)
          });

          try {
            const stat = fs.statSync(localPath);
            if (stat.isDirectory()) {
              await SshConnectionManager.uploadDirectory(
                config,
                authConfig,
                localPath,
                remoteTargetPath,
                () => {}
              );
            } else {
              await SshConnectionManager.uploadFile(
                config,
                authConfig,
                localPath,
                remoteTargetPath,
                () => {}
              );
            }
            logger.info(`Uploaded ${localPath} to ${config.host}:${remoteTargetPath}`);
          } catch (error) {
            logger.error(`Failed to upload ${localPath}:`, error as Error);
            vscode.window.showErrorMessage(`Failed to upload ${fileName}: ${error}`);
          }
        }
      }
    );

    await progress;
    await this.hostManager.recordRecentUsed(config.id);
    await this.hostManager.recordRecentPath(config.id, remoteDir);
    vscode.window.showInformationMessage(`Successfully uploaded ${uris.length} item(s) to ${config.name}`);
  }

  /**
   * Handle download files/folders from remote host
   */
  private async handleDownloadFromHost(config: HostConfig, authConfig: HostAuthConfig): Promise<void> {
    // Select remote file or directory to download
    const remotePath = await this.remoteBrowserService.selectRemoteFileOrDirectory(config, authConfig);
    if (!remotePath) {return;}

    // Select local save path
    const remoteFileName = path.basename(remotePath.path);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const defaultPath = workspaceFolder
      ? path.join(workspaceFolder, remoteFileName)
      : remoteFileName;
    const defaultUri = vscode.Uri.file(defaultPath);

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri,
      title: 'Select download location',
      saveLabel: 'Download Here'
    });

    if (!saveUri) {return;}

    const localPath = saveUri.fsPath;

    logger.info(
      `Starting download: ${config.username}@${config.host}:${remotePath.path} → ${localPath}`
    );

    // Show status bar and prepare for download
    this.downloadStatusBar.text = `$(sync~spin) Downloading...`;
    this.downloadStatusBar.show();

    try {
      if (remotePath.isDirectory) {
        logger.info(`Downloading directory: ${remotePath.path}`);
        await SshConnectionManager.downloadDirectory(
          config,
          authConfig,
          remotePath.path,
          localPath,
          (currentFile, percentage) => {
            logger.debug(`Downloading ${currentFile} (${percentage}%)`);
            this.downloadStatusBar.text = `$(cloud-download) ${percentage}% - ${currentFile}`;
            this.downloadStatusBar.tooltip = `Downloading: ${currentFile}`;
          }
        );
      } else {
        logger.info(`Downloading file: ${remotePath.path}`);

        // Track download speed
        let lastTransferred = 0;
        let lastTime = 0; // Initialize to 0 to force first update

        await SshConnectionManager.downloadFile(
          config,
          authConfig,
          remotePath.path,
          localPath,
          (transferred, total) => {
            const percentage = Math.round((transferred / total) * 100);
            const currentTime = Date.now();
            const elapsed = (currentTime - lastTime) / 1000; // seconds

            // Calculate and update speed every 5 seconds to reduce flickering
            if (elapsed > 5 || lastTime === 0) {
              const bytesTransferred = transferred - lastTransferred;
              const speed = bytesTransferred / elapsed;

              // Always update text to show percentage
              this.downloadStatusBar.text = `$(cloud-download) ${percentage}%`;

              if (speed > 0 && Number.isFinite(speed)) {
                const formattedSpeed = formatSpeed(speed);

                // Calculate remaining time
                const remaining = total - transferred;
                const remainingTime = remaining / speed;
                const formattedTime = formatRemainingTime(remainingTime);

                // Update status bar with speed
                this.downloadStatusBar.text = `$(cloud-download) ${percentage}% - ${formattedSpeed}`;
                // Detailed info in tooltip with file size (only update every 5 seconds to avoid flickering)
                this.downloadStatusBar.tooltip = `Downloading: ${path.basename(remotePath.path)}\nFile Size: ${formatFileSize(total)}\nProgress: ${percentage}% (${formatFileSize(transferred)} / ${formatFileSize(total)})\nSpeed: ${formattedSpeed}\nRemaining: ${formattedTime}`;
              } else {
                // No speed info available, just show basic tooltip
                this.downloadStatusBar.tooltip = `Downloading: ${path.basename(remotePath.path)}\nFile Size: ${formatFileSize(total)}\nProgress: ${percentage}% (${formatFileSize(transferred)} / ${formatFileSize(total)})`;
              }

              lastTransferred = transferred;
              lastTime = currentTime;
            }
          }
        );
      }

      logger.info(`✓ Download successful: ${localPath}`);
      logger.info(`✓ Download successful: ${localPath}`);
      vscode.window.showInformationMessage(`Download successful: ${localPath}`);

      // Record this host as recently used
      await this.hostManager.recordRecentUsed(config.id);
      // Record the remote directory path as recently used
      const remoteDir = remotePath.isDirectory ? remotePath.path : path.dirname(remotePath.path);
      await this.hostManager.recordRecentPath(config.id, remoteDir);

      // Hide status bar after successful download
      this.downloadStatusBar.hide();
    } catch (error) {
      logger.error(`✗ Download failed: ${remotePath.path}`, error as Error);

      // Hide status bar on error
      this.downloadStatusBar.hide();

      const openLogs = 'View Logs';
      const choice = await vscode.window.showErrorMessage(
        `Download failed: ${error}`,
        openLogs
      );

      if (choice === openLogs) {
        logger.show();
      }
    }
  }

  /**
   * Download file or folder from remote host to a local path selected in explorer
   */
  private async downloadToLocal(uri: vscode.Uri): Promise<void> {
    const localBasePath = uri.fsPath;
    const stat = fs.statSync(localBasePath);

    // Determine the target directory
    const targetDir = stat.isDirectory() ? localBasePath : path.dirname(localBasePath);

    const hosts = await this.hostManager.getHosts();
    if (hosts.length === 0) {
      vscode.window.showWarningMessage('Please add host configuration first');
      return;
    }

    const groups = await this.hostManager.getGroups();
    const recentUsedIds = await this.hostManager.getRecentUsed();

    // Build group map for quick lookup
    const groupMap = new Map(groups.map(g => [g.id, g.name]));

    // Check authentication status for each host
    const allHostItems = await Promise.all(
      hosts.map(async h => {
        const hasAuth = await this.authManager.hasAuth(h.id);
        const groupName = h.group ? groupMap.get(h.group) : undefined;
        const isRecent = recentUsedIds.includes(h.id);

        return {
          label: `$(${hasAuth ? 'server' : 'warning'}) ${h.name}`,
          description: `${h.username}@${h.host}:${h.port}`,
          detail: groupName ? `Group: ${groupName}` : undefined,
          host: h,
          hasAuth,
          isRecent,
        };
      })
    );

    // Split into recent and other hosts
    const recentItems = allHostItems
      .filter(item => item.isRecent)
      .sort((a, b) => {
        const aIndex = recentUsedIds.indexOf(a.host.id);
        const bIndex = recentUsedIds.indexOf(b.host.id);
        return aIndex - bIndex;
      });

    const otherItems = allHostItems
      .filter(item => !item.isRecent)
      .sort((a, b) => {
        // Sort by auth status first, then by name
        if (a.hasAuth && !b.hasAuth) {return -1;}
        if (!a.hasAuth && b.hasAuth) {return 1;}
        return a.host.name.localeCompare(b.host.name);
      });

    // Build QuickPick items with separator
    const quickPickItems: any[] = [];

    if (recentItems.length > 0) {
      quickPickItems.push(
        {
          label: 'Recently Used',
          kind: vscode.QuickPickItemKind.Separator
        } as vscode.QuickPickItem,
        ...recentItems
      );
    }

    if (otherItems.length > 0) {
      if (recentItems.length > 0) {
        quickPickItems.push({
          label: 'All Hosts',
          kind: vscode.QuickPickItemKind.Separator
        } as vscode.QuickPickItem);
      }
      quickPickItems.push(...otherItems);
    }

    const selectedHost = await vscode.window.showQuickPick(
      quickPickItems,
      { placeHolder: 'Select source host' }
    );

    if (!selectedHost || selectedHost.kind === vscode.QuickPickItemKind.Separator) {
      return;
    }

    const config = selectedHost.host;

    // Check authentication
    const authConfig = await this.authManager.getAuth(config.id);
    if (!authConfig) {
      const choice = await vscode.window.showWarningMessage(
        MESSAGES.noAuthConfigured(config.name),
        { modal: true },
        MESSAGES.configure,
        MESSAGES.cancel
      );

      if (choice === MESSAGES.configure) {
        const success = await this.configureAuthForHost(config.id);
        if (!success) {
          return;
        }
        // Recursively call downloadToLocal after configuring auth
        return this.downloadToLocal(uri);
      }
      return;
    }

    // Select remote file or directory to download
    const remotePath = await this.remoteBrowserService.selectRemoteFileOrDirectory(config, authConfig);
    if (!remotePath) {return;}

    const remoteFileName = path.basename(remotePath.path);
    const localPath = path.join(targetDir, remoteFileName);

    logger.info(
      `Starting download: ${config.username}@${config.host}:${remotePath.path} → ${localPath}`
    );

    try {
      if (remotePath.isDirectory) {
        logger.info(`Downloading directory: ${remotePath.path}`);

        // Show status bar for directory download
        this.downloadStatusBar.text = `$(sync~spin) Downloading folder...`;
        this.downloadStatusBar.tooltip = `Downloading: ${remoteFileName}`;
        this.downloadStatusBar.show();

        await SshConnectionManager.downloadDirectory(
          config,
          authConfig,
          remotePath.path,
          localPath,
          (currentFile, percentage) => {
            logger.debug(`Downloading ${currentFile} (${percentage}%)`);
            this.downloadStatusBar.text = `$(sync~spin) Downloading folder: ${percentage}%`;
            this.downloadStatusBar.tooltip = `Downloading: ${currentFile}\nProgress: ${percentage}%`;
          }
        );
      } else {
        logger.info(`Downloading file: ${remotePath.path}`);

        // Track download speed
        let lastTransferred = 0;
        let lastTime = 0; // Initialize to 0 to force first update

        // Show initial status bar
        this.downloadStatusBar.text = `$(sync~spin) Downloading...`;
        this.downloadStatusBar.tooltip = `Downloading: ${remoteFileName}`;
        this.downloadStatusBar.show();

        await SshConnectionManager.downloadFile(
          config,
          authConfig,
          remotePath.path,
          localPath,
          (transferred, total) => {
            const percentage = Math.round((transferred / total) * 100);
            const currentTime = Date.now();
            const elapsed = (currentTime - lastTime) / 1000; // seconds

            // Calculate and update speed every 5 seconds to reduce flickering
            if (elapsed > 5 || lastTime === 0) {
              const bytesTransferred = transferred - lastTransferred;
              const speed = bytesTransferred / elapsed;

              // Always update text to show percentage
              this.downloadStatusBar.text = `$(sync~spin) ${percentage}%`;

              if (speed > 0 && Number.isFinite(speed)) {
                const formattedSpeed = formatSpeed(speed);

                // Calculate remaining time
                const remaining = total - transferred;
                const remainingTime = remaining / speed;
                const formattedTime = formatRemainingTime(remainingTime);

                // Update status bar
                this.downloadStatusBar.text = `$(sync~spin) ${percentage}% - ${formattedSpeed}`;
                this.downloadStatusBar.tooltip = `Downloading: ${remoteFileName}\nFile Size: ${formatFileSize(total)}\nProgress: ${percentage}% (${formatFileSize(transferred)} / ${formatFileSize(total)})\nSpeed: ${formattedSpeed}\nETA: ${formattedTime}`;
              } else {
                // No speed info available, just show basic tooltip
                this.downloadStatusBar.tooltip = `Downloading: ${remoteFileName}\nFile Size: ${formatFileSize(total)}\nProgress: ${percentage}% (${formatFileSize(transferred)} / ${formatFileSize(total)})`;
              }

              lastTransferred = transferred;
              lastTime = currentTime;
            }
          }
        );
      }

      logger.info(`✓ Download successful: ${localPath}`);
      vscode.window.showInformationMessage(`Download successful: ${localPath}`);

      // Record this host as recently used
      await this.hostManager.recordRecentUsed(config.id);
      // Record the remote directory path as recently used
      const remoteDir = remotePath.isDirectory ? remotePath.path : path.dirname(remotePath.path);
      await this.hostManager.recordRecentPath(config.id, remoteDir);

      // Hide status bar after successful download
      this.downloadStatusBar.hide();
    } catch (error) {
      logger.error(`✗ Download failed: ${remotePath.path}`, error as Error);

      // Hide status bar on error
      this.downloadStatusBar.hide();

      const openLogs = 'View Logs';
      const choice = await vscode.window.showErrorMessage(
        `Download failed: ${error}`,
        openLogs
      );

      if (choice === openLogs) {
        logger.show();
      }
    }
  }

  private refresh(): void {
    this.treeProvider.refresh();
  }

  private showLogs(): void {
    logger.show();
  }

  /**
   * Show connection pool status
   */
  private showConnectionPoolStatus(): void {
    const pool = SshConnectionPool.getInstance();
    const status = pool.getPoolStatus();

    const message = `SSH Connection Pool Status:

Total Connections: ${status.totalConnections}
Active (In Use): ${status.activeConnections}
Idle (Available): ${status.idleConnections}

Connection pool helps improve performance by reusing SSH connections.
Idle connections will be automatically closed after 5 minutes of inactivity.`;

    vscode.window.showInformationMessage(message, { modal: true });
    logger.info(`Connection Pool Status - Total: ${status.totalConnections}, Active: ${status.activeConnections}, Idle: ${status.idleConnections}`);
  }
}
