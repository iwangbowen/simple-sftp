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
      vscode.commands.registerCommand('simpleScp.editHost', (item: HostTreeItem) =>
        this.editHost(item)
      ),
      vscode.commands.registerCommand('simpleScp.deleteHost', (item: HostTreeItem) =>
        this.deleteHost(item)
      ),
      vscode.commands.registerCommand('simpleScp.addGroup', () => this.addGroup()),
      vscode.commands.registerCommand('simpleScp.importFromSshConfig', () =>
        this.importFromSshConfig()
      ),
      vscode.commands.registerCommand('simpleScp.uploadFile', (uri: vscode.Uri) =>
        this.uploadFile(uri)
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
      vscode.commands.registerCommand('simpleScp.refresh', () => this.refresh())
    );
  }

  private async addHost(): Promise<void> {
    // Step 1/7: Host name
    const name = await vscode.window.showInputBox({
      prompt: 'Step 1/7: Enter host name',
      placeHolder: 'e.g., My Server',
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return 'Host name is required';
        }
        return undefined;
      },
    });
    if (name === undefined) {return;}

    // Step 2/7: Host address
    const host = await vscode.window.showInputBox({
      prompt: 'Step 2/7: Enter host address',
      placeHolder: 'e.g., 192.168.1.100 or example.com',
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return 'Host address is required';
        }
        return undefined;
      },
    });
    if (host === undefined) {return;}

    // Step 3/7: Port number
    const portStr = await vscode.window.showInputBox({
      prompt: 'Step 3/7: Enter port number (optional, default: 22)',
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

    // Step 4/7: Username
    const username = await vscode.window.showInputBox({
      prompt: 'Step 4/7: Enter username',
      value: 'root',
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return 'Username is required';
        }
        return undefined;
      },
    });
    if (username === undefined) {return;}

    // Step 5/7: Select group
    const groups = await this.hostManager.getGroups();
    let group: string | undefined;

    if (groups.length > 0) {
      const groupChoice = await vscode.window.showQuickPick(
        [
          { label: 'No Group', value: undefined },
          ...groups.map(g => ({ label: g.name, value: g.id })),
        ],
        { placeHolder: 'Step 5/7: Select group (optional)' }
      );
      if (groupChoice === undefined) {return;}
      group = groupChoice.value;
    }

    // Step 6/7: Save basic host info first
    let newHost: HostConfig;
    try {
      newHost = await this.hostManager.addHost({
        name: name.trim(),
        host: host.trim(),
        port,
        username: username.trim(),
        group,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to add host: ${error}`);
      return;
    }

    // Step 7/7: Configure authentication
    const configureNow = await vscode.window.showQuickPick(
      [
        { label: 'Yes', value: true },
        { label: 'No, configure later', value: false },
      ],
      { placeHolder: 'Step 7/7: Configure authentication now?' }
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

      const needPassphrase = await vscode.window.showQuickPick(
        [{ label: 'Yes', value: true }, { label: 'No', value: false }],
        { placeHolder: 'Does the private key have a passphrase?' }
      );

      if (needPassphrase === undefined) {
        return false;
      }

      if (needPassphrase.value) {
        passphrase = await vscode.window.showInputBox({
          prompt: 'Enter passphrase',
          password: true,
        });
      }
    }

    // Save authentication config
    try {
      await this.authManager.saveAuth({
        hostId,
        authType: authType.value as any,
        password,
        privateKeyPath,
        passphrase,
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
            { label: 'Orange', value: 'orange', description: '🟠' },
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

  private async deleteHost(item: HostTreeItem): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete "${item.label}"?`,
      'Confirm',
      'Cancel'
    );

    if (confirm !== 'Confirm') {return;}

    try {
      if (item.type === 'host') {
        await this.hostManager.deleteHost(item.data.id);
      } else {
        await this.hostManager.deleteGroup(item.data.id);
      }

      this.treeProvider.refresh();
      vscode.window.showInformationMessage('Deleted successfully');
    } catch (error) {
      vscode.window.showErrorMessage(`Delete failed: ${error}`);
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

    // Check authentication status for each host
    const hostItems = await Promise.all(
      hosts.map(async h => {
        const hasAuth = await this.authManager.hasAuth(h.id);
        return {
          label: `$(${hasAuth ? 'server' : 'warning'}) ${h.name}`,
          description: `${h.username}@${h.host}:${h.port}`,
          detail: hasAuth ? undefined : 'Authentication not configured',
          host: h,
          hasAuth, // For sorting
        };
      })
    );

    // Sort: hosts with auth first
    hostItems.sort((a, b) => {
      if (a.hasAuth && !b.hasAuth) {return -1;}
      if (!a.hasAuth && b.hasAuth) {return 1;}
      return 0;
    });

    const selectedHost = await vscode.window.showQuickPick(
      hostItems,
      { placeHolder: 'Select target host' }
    );

    if (!selectedHost) {return;}

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

  private async selectRemotePath(config: HostConfig, authConfig: HostAuthConfig): Promise<string | undefined> {
    let currentPath = config.defaultRemotePath || '/root';
    logger.info(`Browsing remote path on ${config.name}, starting at: ${currentPath}`);

    return new Promise(async (resolve) => {
      const quickPick = vscode.window.createQuickPick();
      quickPick.placeholder = `Current path: ${currentPath} (Type to filter or enter path)`;
      quickPick.canSelectMany = false;

      // Function to load and display directories
      const loadDirectory = async (pathToLoad: string) => {
        currentPath = pathToLoad;
        quickPick.value = currentPath; // Update input box to show current path
        quickPick.placeholder = `Navigate or press Enter to use: ${currentPath}`;
        quickPick.busy = true;

        try {
          logger.debug(`Listing directory: ${currentPath}`);
          const directories = await SshConnectionManager.listRemoteDirectory(config, authConfig, currentPath);

          const items: vscode.QuickPickItem[] = [
            { label: '$(check) Use this path', description: currentPath, alwaysShow: true },
            { label: '$(arrow-up) Parent directory', description: path.dirname(currentPath), alwaysShow: true },
            ...directories.map(dir => ({
              label: `$(folder) ${dir}`,
              description: path.join(currentPath, dir).replace(/\\/g, '/'),
            })),
          ];

          quickPick.items = items;
          quickPick.busy = false;
        } catch (error) {
          quickPick.busy = false;
          logger.error(`Failed to list directory: ${currentPath}`, error as Error);

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

      // Handle selection
      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];

        // If user presses Enter with custom path in input box
        if (!selected && quickPick.value && quickPick.value.startsWith('/')) {
          logger.info(`Selected remote path (custom input): ${quickPick.value}`);
          quickPick.hide();
          resolve(quickPick.value);
          return;
        }

        if (!selected) {
          return;
        }

        if (selected.label.includes('Use this path')) {
          logger.info(`Selected remote path: ${currentPath}`);
          quickPick.hide();
          resolve(currentPath);
        } else if (selected.label.includes('Parent directory')) {
          loadDirectory(selected.description!);
        } else if (selected.label.includes('Go to:')) {
          // User selected custom path option
          loadDirectory(selected.description!);
        } else {
          // Navigate into subdirectory
          loadDirectory(selected.description!);
        }
      });

      // Handle manual path input
      quickPick.onDidChangeValue((value) => {
        // Only show "Go to" option if user types a different path than current
        if (value && value.startsWith('/') && value !== currentPath) {
          // User is typing an absolute path
          const customPathItem: vscode.QuickPickItem = {
            label: `$(arrow-right) Go to: ${value}`,
            description: value,
            alwaysShow: true,
          };

          // Insert custom path option at the beginning
          const existingItems = quickPick.items.filter(item =>
            !item.label.includes('Go to:')
          );
          quickPick.items = [customPathItem, ...existingItems];
        } else if (value === currentPath) {
          // User cleared the custom input, restore original items
          quickPick.items = quickPick.items.filter(item =>
            !item.label.includes('Go to:')
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

  private refresh(): void {
    this.treeProvider.refresh();
  }
}
