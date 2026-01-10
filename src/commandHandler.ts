import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { HostManager } from './hostManager';
import { AuthManager } from './authManager';
import { HostTreeProvider, HostTreeItem } from './hostTreeProvider';
import { SshConnectionManager } from './sshConnectionManager';
import { HostConfig, HostAuthConfig, FullHostConfig } from './types';
import { logger } from './logger';

export class CommandHandler {
  constructor(
    private hostManager: HostManager,
    private authManager: AuthManager,
    private treeProvider: HostTreeProvider
  ) {}

  registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('simpleScp.addHost', () => this.addHost()),
      vscode.commands.registerCommand('simpleScp.addHostToGroup', (item: HostTreeItem) =>
        this.addHostToGroup(item)
      ),
      vscode.commands.registerCommand('simpleScp.editHost', (item: HostTreeItem) =>
        this.editHost(item)
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
      vscode.commands.registerCommand('simpleScp.downloadFile', (item: HostTreeItem) =>
        this.downloadFile(item)
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
      vscode.commands.registerCommand('simpleScp.refresh', () => this.refresh()),
      vscode.commands.registerCommand('simpleScp.showLogs', () => this.showLogs())
    );
  }

  private async addHost(groupId?: string): Promise<void> {
    // Step 1/6: Host name
    const name = await vscode.window.showInputBox({
      prompt: 'Step 1/6: Enter host name',
      placeHolder: 'e.g., My Server',
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return 'Host name is required';
        }
        return undefined;
      },
    });
    if (name === undefined) {return;}

    // Step 2/6: Host address
    const host = await vscode.window.showInputBox({
      prompt: 'Step 2/6: Enter host address',
      placeHolder: 'e.g., 192.168.1.100 or example.com',
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return 'Host address is required';
        }
        return undefined;
      },
    });
    if (host === undefined) {return;}

    // Step 3/6: Port number
    const portStr = await vscode.window.showInputBox({
      prompt: 'Step 3/6: Enter port number (optional, default: 22)',
      value: '22',
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return undefined; // Empty is allowed, will use default
        }
        const port = parseInt(value);
        if (isNaN(port) || port < 1 || port > 65535) {
          return 'Port must be a number between 1 and 65535';
        }
        return undefined;
      },
    });
    if (portStr === undefined) {return;}
    const port = portStr.trim() ? parseInt(portStr) : 22;

    // Step 4/6: Username
    const username = await vscode.window.showInputBox({
      prompt: 'Step 4/6: Enter username',
      value: 'root',
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return 'Username is required';
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
      vscode.window.showErrorMessage(`Failed to add host: ${error}`);
      return;
    }

    // Step 6/6: Configure authentication
    const configureNow = await vscode.window.showQuickPick(
      [
        { label: 'Yes', value: true },
        { label: 'No, configure later', value: false },
      ],
      { placeHolder: 'Step 6/6: Configure authentication now?' }
    );

    if (configureNow === undefined) {
      // User cancelled, but host is already created
      this.treeProvider.refresh();
      vscode.window.showWarningMessage(`Host "${name}" added without authentication. Configure it later.`);
      return;
    }

    if (configureNow.value) {
      // Configure authentication immediately
      const authConfigured = await this.configureAuthForHost(newHost.id);

      if (authConfigured) {
        this.treeProvider.refresh();
        vscode.window.showInformationMessage(`Host "${name}" added successfully with authentication`);
      } else {
        this.treeProvider.refresh();
        vscode.window.showWarningMessage(`Host "${name}" added without authentication`);
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
      vscode.window.showInformationMessage(`Authentication configured for ${config.name}`);
    }
  }

  private async editHost(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {return;}

    const config = item.data as HostConfig;

    const options = [
      { label: 'Edit Name', value: 'name' },
      { label: 'Edit Host Address', value: 'host' },
      { label: 'Edit Port', value: 'port' },
      { label: 'Edit Default Remote Path', value: 'remotePath' },
      { label: 'Change Group', value: 'group' },
      { label: 'Edit Color', value: 'color' },
      { label: 'Configure Authentication', value: 'auth' },
    ];

    const choice = await vscode.window.showQuickPick(options, {
      placeHolder: `Edit ${config.name}`,
    });

    if (!choice) {return;}

    try {
      if (choice.value === 'name') {
        const name = await vscode.window.showInputBox({
          prompt: 'Modify host name',
          value: config.name,
          validateInput: (value) => {
            if (!value || !value.trim()) {
              return 'Host name is required';
            }
            return undefined;
          },
        });
        if (name === undefined) {return;}

        await this.hostManager.updateHost(config.id, { name: name.trim() });
      } else if (choice.value === 'host') {
        const host = await vscode.window.showInputBox({
          prompt: 'Enter host address (IP or domain)',
          value: config.host,
          placeHolder: 'e.g., 192.168.1.100 or example.com',
          validateInput: (value) => {
            if (!value || !value.trim()) {
              return 'Host address is required';
            }
            return undefined;
          },
        });
        if (host === undefined) {return;}

        await this.hostManager.updateHost(config.id, { host: host.trim() });
      } else if (choice.value === 'port') {
        const portStr = await vscode.window.showInputBox({
          prompt: 'Enter SSH port',
          value: config.port.toString(),
          placeHolder: 'Default: 22',
          validateInput: (value) => {
            if (!value || !value.trim()) {
              return 'Port is required';
            }
            const port = parseInt(value);
            if (isNaN(port) || port < 1 || port > 65535) {
              return 'Port must be between 1 and 65535';
            }
            return undefined;
          },
        });
        if (portStr === undefined) {return;}

        await this.hostManager.updateHost(config.id, { port: parseInt(portStr) });
      } else if (choice.value === 'remotePath') {
        const defaultRemotePath = await vscode.window.showInputBox({
          prompt: 'Set default remote path (optional)',
          value: config.defaultRemotePath || '/root',
        });
        if (defaultRemotePath === undefined) {return;}

        await this.hostManager.updateHost(config.id, {
          defaultRemotePath: defaultRemotePath.trim() || undefined,
        });
      } else if (choice.value === 'group') {
        const groups = await this.hostManager.getGroups();

        const groupChoice = await vscode.window.showQuickPick(
          [
            { label: 'No Group', value: undefined },
            ...groups.map(g => ({
              label: g.name,
              value: g.id,
              description: config.group === g.id ? '(Current)' : undefined,
            })),
          ],
          { placeHolder: 'Select group' }
        );
        if (groupChoice === undefined) {return;}

        await this.hostManager.updateHost(config.id, {
          group: groupChoice.value,
        });
      } else if (choice.value === 'color') {
        const colorChoice = await vscode.window.showQuickPick(
          [
            { label: 'No Color', value: undefined, description: 'Use default color' },
            { label: 'Red', value: 'red', description: '🔴' },
            { label: 'Green', value: 'green', description: '🟢' },
            { label: 'Blue', value: 'blue', description: '🔵' },
            { label: 'Yellow', value: 'yellow', description: '🟡' },
            { label: 'Purple', value: 'purple', description: '🟣' },
          ],
          { placeHolder: 'Select color' }
        );
        if (colorChoice === undefined) {return;}

        await this.hostManager.updateHost(config.id, {
          color: colorChoice.value,
        });
      } else if (choice.value === 'auth') {
        // Configure authentication
        const success = await this.configureAuthForHost(config.id);
        if (success) {
          vscode.window.showInformationMessage('Authentication updated successfully');
        }
        this.treeProvider.refresh();
        return; // Early return after auth config
      }

      this.treeProvider.refresh();
      vscode.window.showInformationMessage('Host updated successfully');
    } catch (error) {
      vscode.window.showErrorMessage(`Update failed: ${error}`);
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
    const groupsWithHosts = groupsToDelete.filter(group =>
      allHosts.some(h => h.group === group.data.id)
    );

    // Determine confirmation dialog type
    let deleteOnlyGroups = false;
    if (groupsWithHosts.length > 0) {
      // Modal confirmation for groups with hosts (important operation)
      const totalHostsInGroups = groupsWithHosts.reduce((count, group) => {
        return count + allHosts.filter(h => h.group === group.data.id).length;
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
          const hostsInGroup = allHosts.filter(h => h.group === groupItem.data.id);
          for (const host of hostsInGroup) {
            // Avoid duplicates - don't add if already explicitly selected
            if (!hostsToDelete.some(h => h.data.id === host.id)) {
              await this.hostManager.deleteHost(host.id);
              logger.info(`Deleted host in group: ${host.name}`);
            }
          }
        }
      }
    } else {
      // Non-modal confirmation for empty groups or hosts only
      const confirm = await vscode.window.showWarningMessage(
        itemsToDelete.length === 1
          ? `Delete "${itemsToDelete[0].label}"?`
          : `Delete ${itemsToDelete.length} item(s)?`,
        'Delete'
      );

      if (!confirm) {
        return;
      }
    }

    try {
      // Delete all selected hosts
      for (const hostItem of hostsToDelete) {
        await this.hostManager.deleteHost(hostItem.data.id);
        logger.info(`Deleted host: ${hostItem.label}`);
      }

      // Delete all selected groups
      // If deleteOnlyGroups is true, hosts in the group will be moved to "ungrouped"
      for (const groupItem of groupsToDelete) {
        await this.hostManager.deleteGroup(groupItem.data.id);
        logger.info(`Deleted group: ${groupItem.label}`);
      }

      this.treeProvider.refresh();

      if (itemsToDelete.length === 1) {
        vscode.window.showInformationMessage('Deleted successfully');
      } else {
        const message = `Successfully deleted ${itemsToDelete.length} item(s)`;
        vscode.window.showInformationMessage(message);
        logger.info(message);
      }
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
      vscode.window.showInformationMessage(`Group "${name}" created successfully`);
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

      const targetGroup = groupChoice.value ? groupChoice.label : 'ungrouped';
      if (hostsToMove.length === 1) {
        vscode.window.showInformationMessage(`Moved "${hostsToMove[0].label}" to ${targetGroup}`);
      } else {
        vscode.window.showInformationMessage(`Moved ${hostsToMove.length} host(s) to ${targetGroup}`);
      }
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
      vscode.window.showInformationMessage(`Group renamed to "${newName}"`);
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
    const recentUploadIds = await this.hostManager.getRecentUploads();

    // Build group map for quick lookup
    const groupMap = new Map(groups.map(g => [g.id, g.name]));

    // Check authentication status for each host
    const allHostItems = await Promise.all(
      hosts.map(async h => {
        const hasAuth = await this.authManager.hasAuth(h.id);
        const groupName = h.group ? groupMap.get(h.group) : undefined;
        const isRecent = recentUploadIds.includes(h.id);

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
        const aIndex = recentUploadIds.indexOf(a.host.id);
        const bIndex = recentUploadIds.indexOf(b.host.id);
        return aIndex - bIndex;
      });

    const otherItems = allHostItems
      .filter(item => !item.isRecent)
      .sort((a, b) => {
        // Sort by auth status first, then by name
        if (a.hasAuth && !b.hasAuth) return -1;
        if (!a.hasAuth && b.hasAuth) return 1;
        return a.host.name.localeCompare(b.host.name);
      });

    // Build QuickPick items with separator
    const quickPickItems: any[] = [];

    if (recentItems.length > 0) {
      quickPickItems.push(
        {
          label: 'Recently Uploaded',
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
      const configure = 'Configure Authentication';
      const cancel = 'Cancel';
      const choice = await vscode.window.showWarningMessage(
        `No authentication configured for ${config.name}. Configure now?`,
        configure,
        cancel
      );

      if (choice === configure) {
        const success = await this.configureAuthForHost(config.id);
        if (!success) {
          return;
        }
        // Recursively call uploadFile after configuring auth
        return this.uploadFile(uri);
      }
      return;
    }

    const remotePath = await this.selectRemotePath(config, authConfig);
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

          // Record this host as recently uploaded to
          await this.hostManager.recordRecentUpload(config.id);
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

  /**
   * Generic remote file browser with path input navigation
   * @param config Host configuration
   * @param authConfig Authentication configuration
   * @param mode 'selectPath' for selecting a directory, 'browseFiles' for downloading files
   * @param title Title for the QuickPick
   * @returns Promise resolving to selected path string or object with path and isDirectory
   */
  private async browseRemoteFilesGeneric(
    config: HostConfig,
    authConfig: HostAuthConfig,
    mode: 'selectPath' | 'browseFiles',
    title: string
  ): Promise<string | { path: string; isDirectory: boolean } | undefined> {
    let currentPath = config.defaultRemotePath || '/root';
    // Read showDotFiles setting from configuration
    let showDotFiles = vscode.workspace.getConfiguration('simpleScp').get<boolean>('showDotFiles', true);
    logger.info(`Browsing remote on ${config.name}, starting at: ${currentPath}`);

    return new Promise(async (resolve) => {
      const quickPick = vscode.window.createQuickPick();
      quickPick.placeholder = 'Type a path or select from the list';
      quickPick.canSelectMany = false;
      quickPick.busy = true;
      quickPick.title = title;

      // Add prompt for persistent instructional text
      quickPick.prompt = mode === 'selectPath'
        ? 'Navigate using arrows or type a path ending with /'
        : 'Select a file or folder to download';

      // Add buttons based on mode
      const updateButtons = () => {
        if (mode === 'browseFiles') {
          quickPick.buttons = [
            {
              iconPath: new vscode.ThemeIcon(showDotFiles ? 'eye' : 'eye-closed'),
              tooltip: showDotFiles ? 'Hide dot files' : 'Show dot files'
            }
          ];
        } else if (mode === 'selectPath') {
          quickPick.buttons = [
            {
              iconPath: new vscode.ThemeIcon('cloud-upload'),
              tooltip: 'Upload to current folder'
            }
          ];
        }
      };
      updateButtons();

      let isLoadingPath = false;

      // Function to load and display files/directories
      const loadDirectory = async (pathToLoad: string, updateValue: boolean = true) => {
        currentPath = pathToLoad;
        quickPick.busy = true;
        isLoadingPath = true;

        try {
          logger.debug(`Listing: ${currentPath}`);

          let quickPickItems: vscode.QuickPickItem[];

          if (mode === 'selectPath') {
            // For path selection, only show directories
            const directories = await SshConnectionManager.listRemoteDirectory(config, authConfig, currentPath);
            logger.debug(`Found ${directories.length} directories in ${currentPath}`);

            // Filter dot files if needed
            const filteredDirs = showDotFiles
              ? directories
              : directories.filter(dir => !dir.startsWith('.'));

            // Sort directories alphabetically
            const sortedDirs = [...filteredDirs].sort((a, b) => a.localeCompare(b));

            quickPickItems = [
              {
                label: '..',
                alwaysShow: true
              },
              ...sortedDirs.map(dir => {
                const fullPath = `${currentPath}/${dir}`.replace(/\/\//g, '/');

                return {
                  label: dir,
                  description: '',
                  resourceUri: vscode.Uri.parse(`scp-remote://${config.host}${fullPath}`),  // 新版本使用，旧版本自动忽略
                  iconPath: vscode.ThemeIcon.Folder,  // 新版本触发主题图标，旧版本显示标准图标
                  alwaysShow: true,
                  buttons: [
                    {
                      iconPath: new vscode.ThemeIcon('cloud-upload'),
                      tooltip: 'Upload to this directory'
                    }
                  ],
                  dirName: dir
                } as any;
              }),
            ];
          } else {
            // For file browsing, show files and directories
            const items = await SshConnectionManager.listRemoteFiles(config, authConfig, currentPath);
            logger.debug(`Found ${items.length} items in ${currentPath}`);

            // Filter dot files if needed
            const filteredItems = showDotFiles
              ? items
              : items.filter(item => !item.name.startsWith('.'));

            // Sort: directories first (alphabetically), then files (alphabetically)
            const directories = filteredItems
              .filter(item => item.type === 'directory')
              .sort((a, b) => a.name.localeCompare(b.name));
            const files = filteredItems
              .filter(item => item.type === 'file')
              .sort((a, b) => a.name.localeCompare(b.name));
            const sortedItems = [...directories, ...files];

            quickPickItems = [
              {
                label: '..',
                alwaysShow: true
              },
              ...sortedItems.map(item => {
                const fullPath = `${currentPath}/${item.name}`.replace(/\/\//g, '/');
                const isDirectory = item.type === 'directory';
                const fileSize = item.type === 'file' ? `${(item.size / 1024).toFixed(2)} KB` : '';

                return {
                  label: item.name,
                  description: fileSize,  // 显示文件大小
                  resourceUri: vscode.Uri.parse(`scp-remote://${config.host}${fullPath}`),  // 新版本使用，旧版本自动忽略
                  iconPath: isDirectory ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File,  // 新版本触发主题图标，旧版本显示标准图标
                  alwaysShow: true,
                  buttons: [
                    {
                      iconPath: new vscode.ThemeIcon('cloud-download'),
                      tooltip: 'Download'
                    }
                  ],
                  item: item
                } as any;
              }),
            ];
          }

          quickPick.items = quickPickItems;
          quickPick.busy = false;
          updateButtons();

          // Update value with trailing slash after loading
          if (updateValue) {
            quickPick.value = currentPath + '/';
          }
          isLoadingPath = false;
        } catch (error) {
          quickPick.busy = false;
          isLoadingPath = false;
          logger.error(`Failed to list: ${currentPath}`, error as Error);

          const openLogs = 'View Logs';
          const choice = await vscode.window.showErrorMessage(
            `Failed to read directory: ${error}`,
            openLogs
          );

          if (choice === openLogs) {
            logger.show();
          }
          quickPick.hide();
          resolve(undefined);
        }
      };

      // Handle input value change - dynamic path navigation
      let inputTimeout: NodeJS.Timeout | undefined;
      quickPick.onDidChangeValue(async (value) => {
        if (inputTimeout) {
          clearTimeout(inputTimeout);
        }

        if (isLoadingPath) {
          return;
        }

        inputTimeout = setTimeout(async () => {
          if (!value) {
            return;
          }

          if (value.endsWith('/')) {
            const targetPath = value.slice(0, -1) || '/';
            if (targetPath !== currentPath) {
              await loadDirectory(targetPath);
            }
          } else {
            const lastSlashIndex = value.lastIndexOf('/');
            if (lastSlashIndex >= 0) {
              const parentPath = value.substring(0, lastSlashIndex) || '/';
              if (parentPath !== currentPath) {
                await loadDirectory(parentPath, false);
              }
            }
          }
        }, 300);
      });

      // Handle QuickPick button click
      quickPick.onDidTriggerButton(async () => {
        if (mode === 'browseFiles') {
          // Toggle dot files
          showDotFiles = !showDotFiles;
          updateButtons();
          loadDirectory(currentPath, false);
        } else if (mode === 'selectPath') {
          // Upload to current folder
          logger.info(`Selected current folder for upload: ${currentPath}`);
          quickPick.hide();
          resolve(currentPath);
        }
      });

      // Handle item button click
      quickPick.onDidTriggerItemButton(async (event) => {
        const selected = event.item as any;
        if (!selected || selected.label === '..' || selected.isDotFilesToggle) {
          return;
        }

        if (mode === 'browseFiles') {
          // Download button
          const item = selected.item;
          const itemPath = `${currentPath}/${item.name}`.replace(/\/\//g, '/');
          logger.info(`Selected for download via button: ${itemPath} (${item.type})`);
          quickPick.hide();
          resolve({
            path: itemPath,
            isDirectory: item.type === 'directory'
          });
        } else if (mode === 'selectPath') {
          // Upload button
          if (selected.dirName) {
            const targetPath = `${currentPath}/${selected.dirName}`.replace(/\/\//g, '/');
            logger.info(`Selected for upload via button: ${targetPath}`);
            quickPick.hide();
            resolve(targetPath);
          }
        }
      });

      // Handle selection
      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0] as any;

        if (!selected) {
          return;
        }

        if (selected.label === '..') {
          const parentPath = path.dirname(currentPath);
          loadDirectory(parentPath);
        } else if (mode === 'browseFiles' && selected.item) {
          if (selected.item.type === 'directory') {
            const targetPath = `${currentPath}/${selected.item.name}`.replace(/\/\//g, '/');
            loadDirectory(targetPath);
          } else {
            const filePath = `${currentPath}/${selected.item.name}`.replace(/\/\//g, '/');
            logger.info(`Selected file for download: ${filePath}`);
            quickPick.hide();
            resolve({
              path: filePath,
              isDirectory: false
            });
          }
        } else if (mode === 'selectPath' && selected.dirName) {
          const targetPath = `${currentPath}/${selected.dirName}`.replace(/\/\//g, '/');
          loadDirectory(targetPath);
        }
      });

      quickPick.onDidHide(() => {
        if (inputTimeout) {
          clearTimeout(inputTimeout);
        }
        quickPick.dispose();
        resolve(undefined);
      });

      quickPick.show();
      await loadDirectory(currentPath);
    });
  }

  private async selectRemotePath(config: HostConfig, authConfig: HostAuthConfig): Promise<string | undefined> {
    const result = await this.browseRemoteFilesGeneric(
      config,
      authConfig,
      'selectPath',
      'Select remote directory'
    );
    return typeof result === 'string' ? result : undefined;
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
      const configure = 'Configure Authentication';
      const cancel = 'Cancel';
      const choice = await vscode.window.showWarningMessage(
        `No authentication configured for ${config.name}. Configure now?`,
        configure,
        cancel
      );

      if (choice === configure) {
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

  private async downloadFile(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {return;}

    const config = item.data as HostConfig;

    // Check authentication
    const authConfig = await this.authManager.getAuth(config.id);
    if (!authConfig) {
      const configure = 'Configure Authentication';
      const cancel = 'Cancel';
      const choice = await vscode.window.showWarningMessage(
        `No authentication configured for ${config.name}. Configure now?`,
        configure,
        cancel
      );

      if (choice === configure) {
        const success = await this.configureAuthForHost(config.id);
        if (!success) {
          return;
        }
        // Recursively call downloadFile after configuring auth
        return this.downloadFile(item);
      }
      return;
    }

    // Select remote file or directory to download
    const remotePath = await this.selectRemoteFileOrDirectory(config, authConfig);
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

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: remotePath.isDirectory ? 'Downloading folder' : 'Downloading file',
        cancellable: false,
      },
      async progress => {
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
                progress.report({
                  message: `${currentFile} (${percentage}%)`,
                  increment: 1,
                });
              }
            );
          } else {
            logger.info(`Downloading file: ${remotePath.path}`);
            await SshConnectionManager.downloadFile(
              config,
              authConfig,
              remotePath.path,
              localPath,
              (transferred, total) => {
                const percentage = Math.round((transferred / total) * 100);
                progress.report({
                  message: `${percentage}%`,
                  increment: percentage,
                });
              }
            );
          }

          logger.info(`✓ Download successful: ${localPath}`);
          vscode.window.showInformationMessage(`Download successful: ${localPath}`);
        } catch (error) {
          logger.error(`✗ Download failed: ${remotePath.path}`, error as Error);

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
    );
  }

  private async selectRemoteFileOrDirectory(config: HostConfig, authConfig: HostAuthConfig): Promise<{path: string, isDirectory: boolean} | undefined> {
    const result = await this.browseRemoteFilesGeneric(
      config,
      authConfig,
      'browseFiles',
      'Browse Remote Files'
    );
    return typeof result === 'object' ? result : undefined;
  }

  private refresh(): void {
    this.treeProvider.refresh();
  }

  private showLogs(): void {
    logger.show();
  }
}
