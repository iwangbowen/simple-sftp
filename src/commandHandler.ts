import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { HostManager } from './hostManager';
import { HostTreeProvider, HostTreeItem } from './hostTreeProvider';
import { SshConnectionManager } from './sshConnectionManager';
import { HostConfig } from './types';

export class CommandHandler {
  constructor(
    private hostManager: HostManager,
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
      vscode.commands.registerCommand('simpleScp.refresh', () => this.refresh())
    );
  }

  private async addHost(): Promise<void> {
    // Step 1/8: Host name
    const name = await vscode.window.showInputBox({
      prompt: 'Step 1/8: Enter host name',
      placeHolder: 'e.g., My Server',
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return 'Host name is required';
        }
        return undefined;
      },
    });
    if (name === undefined) {return;}

    // Step 2/8: Host address
    const host = await vscode.window.showInputBox({
      prompt: 'Step 2/8: Enter host address',
      placeHolder: 'e.g., 192.168.1.100 or example.com',
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return 'Host address is required';
        }
        return undefined;
      },
    });
    if (host === undefined) {return;}

    // Step 3/8: Port number
    const portStr = await vscode.window.showInputBox({
      prompt: 'Step 3/8: Enter port number (optional, default: 22)',
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

    // Step 4/8: Username
    const username = await vscode.window.showInputBox({
      prompt: 'Step 4/8: Enter username',
      value: 'root',
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return 'Username is required';
        }
        return undefined;
      },
    });
    if (username === undefined) {return;}

    // Step 5/8: Authentication method
    const authType = await vscode.window.showQuickPick(
      [
        { label: 'Password', value: 'password' },
        { label: 'Private Key', value: 'privateKey' },
        { label: 'SSH Agent', value: 'agent' },
      ],
      { placeHolder: 'Step 5/8: Select authentication method' }
    );
    if (!authType) {return;}

    let password: string | undefined;
    let privateKeyPath: string | undefined;
    let passphrase: string | undefined;

    if (authType.value === 'password') {
      password = await vscode.window.showInputBox({
        prompt: 'Step 6/8: Enter password',
        password: true,
        validateInput: (value) => {
          if (!value || !value.trim()) {
            return 'Password is required';
          }
          return undefined;
        },
      });
      if (password === undefined) {return;}
    } else if (authType.value === 'privateKey') {
      privateKeyPath = await vscode.window.showInputBox({
        prompt: 'Step 6/8: Enter private key path',
        value: '~/.ssh/id_rsa',
        validateInput: (value) => {
          if (!value || !value.trim()) {
            return 'Private key path is required';
          }
          return undefined;
        },
      });
      if (privateKeyPath === undefined) {return;}

      const needPassphrase = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Does the private key have a passphrase?',
      });

      if (needPassphrase === 'Yes') {
        passphrase = await vscode.window.showInputBox({
          prompt: 'Enter passphrase',
          password: true,
          validateInput: (value) => {
            if (!value || !value.trim()) {
              return 'Passphrase is required';
            }
            return undefined;
          },
        });
        if (passphrase === undefined) {return;}
      }
    }

    // Step 7/8: Select group
    const groups = await this.hostManager.getGroups();
    let group: string | undefined;

    if (groups.length > 0) {
      const groupChoice = await vscode.window.showQuickPick(
        [
          { label: 'No Group', value: undefined },
          ...groups.map(g => ({ label: g.name, value: g.id })),
        ],
        {
          placeHolder:
            authType.value === 'agent'
              ? 'Step 6/8: Select group (optional)'
              : 'Step 7/8: Select group (optional)',
        }
      );
      if (groupChoice === undefined) {return;}
      group = groupChoice.value;
    }

    // Step 8/8: Select color
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
      {
        placeHolder:
          authType.value === 'agent'
            ? groups.length > 0
              ? 'Step 7/8: Select color (optional)'
              : 'Step 6/8: Select color (optional)'
            : 'Step 8/8: Select color (optional)',
      }
    );
    if (colorChoice === undefined) {return;}

    try {
      await this.hostManager.addHost({
        name: name.trim(),
        host: host.trim(),
        port,
        username: username.trim(),
        authType: authType.value as any,
        password,
        privateKeyPath,
        passphrase,
        group,
        color: colorChoice.value,
      });

      this.treeProvider.refresh();
      vscode.window.showInformationMessage(`Host "${name}" added successfully`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to add host: ${error}`);
    }
  }

  private async editHost(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {return;}

    const config = item.data as HostConfig;

    const options = [
      { label: 'Edit Name', value: 'name' },
      { label: 'Edit Default Remote Path', value: 'remotePath' },
      { label: 'Edit Color', value: 'color' },
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
      } else if (choice.value === 'remotePath') {
        const defaultRemotePath = await vscode.window.showInputBox({
          prompt: 'Set default remote path (optional)',
          value: config.defaultRemotePath || '/root',
        });
        if (defaultRemotePath === undefined) {return;}

        await this.hostManager.updateHost(config.id, {
          defaultRemotePath: defaultRemotePath.trim() || undefined,
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
      const imported = await this.hostManager.importFromSshConfig();
      this.treeProvider.refresh();

      if (imported.length > 0) {
        vscode.window.showInformationMessage(
          `Successfully imported ${imported.length} host(s)`
        );
      } else {
        vscode.window.showInformationMessage('No new hosts found');
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

    const selectedHost = await vscode.window.showQuickPick(
      hosts.map(h => ({
        label: h.name,
        description: `${h.username}@${h.host}:${h.port}`,
        host: h,
      })),
      { placeHolder: 'Select target host' }
    );

    if (!selectedHost) {return;}

    const config = selectedHost.host;
    const remotePath = await this.selectRemotePath(config);
    if (!remotePath) {return;}

    const fileName = path.basename(localPath);
    const finalRemotePath = `${remotePath}/${fileName}`.replace(/\\/g, '/');

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: stat.isDirectory() ? 'Uploading folder' : 'Uploading file',
        cancellable: false,
      },
      async progress => {
        try {
          if (stat.isDirectory()) {
            await SshConnectionManager.uploadDirectory(
              config,
              localPath,
              finalRemotePath,
              (currentFile, percentage) => {
                progress.report({
                  message: `${currentFile} (${percentage}%)`,
                  increment: 1,
                });
              }
            );
          } else {
            await SshConnectionManager.uploadFile(
              config,
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

          vscode.window.showInformationMessage(
            `Upload successful: ${finalRemotePath}`
          );
        } catch (error) {
          vscode.window.showErrorMessage(`Upload failed: ${error}`);
        }
      }
    );
  }

  private async selectRemotePath(config: HostConfig): Promise<string | undefined> {
    let currentPath = config.defaultRemotePath || '/root';

    while (true) {
      try {
        const directories = await SshConnectionManager.listRemoteDirectory(config, currentPath);

        const items = [
          { label: '$(check) Use current path', path: currentPath },
          { label: '$(arrow-up) Parent directory', path: path.dirname(currentPath) },
          ...directories.map(dir => ({
            label: `$(folder) ${dir}`,
            path: path.join(currentPath, dir).replace(/\\/g, '/'),
          })),
        ];

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: `Current path: ${currentPath}`,
        });

        if (!selected) {
          return undefined;
        }

        if (selected.label.includes('Use current path')) {
          return currentPath;
        }

        currentPath = selected.path;
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to read directory: ${error}`);
        return undefined;
      }
    }
  }

  private async setupPasswordlessLogin(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {return;}

    const config = item.data as HostConfig;
    const hasPasswordless = await SshConnectionManager.checkPasswordlessLogin(config);
    if (hasPasswordless) {
      vscode.window.showInformationMessage('Passwordless login is already configured for this host');
      return;
    }

    const sshDir = path.join(os.homedir(), '.ssh');
    const possibleKeys = ['id_rsa.pub', 'id_ed25519.pub', 'id_ecdsa.pub'];
    let publicKeyPath: string | undefined;

    for (const key of possibleKeys) {
      const keyPath = path.join(sshDir, key);
      if (fs.existsSync(keyPath)) {
        publicKeyPath = keyPath;
        break;
      }
    }

    if (!publicKeyPath) {
      vscode.window.showErrorMessage('No public key found. Please generate SSH key pair first');
      return;
    }

    if (config.authType !== 'password' || !config.password) {
      const password = await vscode.window.showInputBox({
        prompt: 'Enter password to configure passwordless login',
        password: true,
      });

      if (!password) {return;}

      config.password = password;
      config.authType = 'password';
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Configuring passwordless login...',
        },
        async () => {
          await SshConnectionManager.setupPasswordlessLogin(config, publicKeyPath!);
        }
      );

      const privateKeyPath = publicKeyPath.replace('.pub', '');
      await this.hostManager.updateHost(config.id, {
        authType: 'privateKey',
        privateKeyPath,
        password: undefined,
      });

      this.treeProvider.refresh();
      vscode.window.showInformationMessage('Passwordless login configured successfully');
    } catch (error) {
      vscode.window.showErrorMessage(`Configuration failed: ${error}`);
    }
  }

  private async testConnection(item: HostTreeItem): Promise<void> {
    if (item.type !== 'host') {return;}

    const config = item.data as HostConfig;

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Testing connection to ${config.name}...`,
        },
        async () => {
          await SshConnectionManager.testConnection(config);
        }
      );

      vscode.window.showInformationMessage(`Connected to ${config.name} successfully`);
    } catch (error) {
      vscode.window.showErrorMessage(`Connection failed: ${error}`);
    }
  }

  private refresh(): void {
    this.treeProvider.refresh();
  }
}
