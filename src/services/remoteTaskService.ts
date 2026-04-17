import * as vscode from 'vscode';
import { AuthManager } from '../authManager';
import { HostManager } from '../hostManager';
import { logger } from '../logger';
import { SshConnectionManager } from '../sshConnectionManager';
import { DeployProfile, HostAuthConfig, HostConfig, SavedRemoteTask } from '../types';
import { DeployProfileService } from './deployProfileService';

type TaskScope =
  | { type: 'host'; host: HostConfig; defaultWorkingDirectory?: string; title: string }
  | { type: 'profile'; profile: DeployProfile; host: HostConfig; title: string };

export class RemoteTaskService {
  constructor(
    private readonly hostManager: HostManager,
    private readonly authManager: AuthManager,
    private readonly deployProfileService: DeployProfileService
  ) {}

  async manageTasks(arg?: any): Promise<void> {
    const scope = await this.resolveScope(arg);
    if (!scope) {
      return;
    }

    const tasks = this.getTasks(scope);
    const choice = await vscode.window.showQuickPick(
      [
        { label: 'Run Task', value: 'run' },
        { label: 'Add Task', value: 'add' },
        { label: 'Edit Task', value: 'edit' },
        { label: 'Delete Task', value: 'delete' },
      ],
      { title: `Remote Tasks: ${scope.title}` }
    );

    if (!choice) {
      return;
    }

    switch (choice.value) {
      case 'run':
        await this.runTask(arg);
        return;
      case 'add':
        await this.addTask(scope);
        return;
      case 'edit':
        await this.editTask(scope, tasks);
        return;
      case 'delete':
        await this.deleteTask(scope, tasks);
        return;
      default:
        return;
    }
  }

  async runTask(arg?: any): Promise<void> {
    const scope = await this.resolveScope(arg);
    if (!scope) {
      return;
    }

    const tasks = this.getCandidateTasks(scope);
    if (tasks.length === 0) {
      const action = await vscode.window.showInformationMessage(
        `No saved remote tasks for ${scope.title}.`,
        'Add Task'
      );
      if (action === 'Add Task') {
        await this.addTask(scope);
      }
      return;
    }

    const picked = await vscode.window.showQuickPick(
      tasks.map(task => ({
        label: task.label,
        description: task.workingDirectory,
        detail: task.command,
        task
      })),
      {
        title: `Run Remote Task: ${scope.title}`,
        matchOnDescription: true,
        matchOnDetail: true
      }
    );

    if (!picked) {
      return;
    }

    await this.executeTask(scope.host, picked.task);
  }

  private async addTask(scope: TaskScope): Promise<void> {
    const label = await vscode.window.showInputBox({
      title: `New Remote Task: ${scope.title}`,
      prompt: 'Task label',
      validateInput: value => value.trim() ? undefined : 'Task label is required'
    });
    if (!label) {
      return;
    }

    const command = await vscode.window.showInputBox({
      title: `New Remote Task: ${scope.title}`,
      prompt: 'Remote command to execute',
      validateInput: value => value.trim() ? undefined : 'Remote command is required'
    });
    if (!command) {
      return;
    }

    const defaultWorkingDirectory = scope.type === 'host'
      ? scope.defaultWorkingDirectory || scope.host.defaultRemotePath || '/'
      : scope.profile.remoteRoot;
    const workingDirectory = await vscode.window.showInputBox({
      title: `New Remote Task: ${scope.title}`,
      prompt: 'Remote working directory',
      value: defaultWorkingDirectory,
      validateInput: value => value.trim() ? undefined : 'Working directory is required'
    });
    if (!workingDirectory) {
      return;
    }

    const runInTerminalChoice = await vscode.window.showQuickPick(
      [
        { label: 'Run in SSH Terminal', value: true, description: 'Interactive command execution' },
        { label: 'Run in Background', value: false, description: 'Capture stdout and show result' },
      ],
      { title: `New Remote Task: ${scope.title}` }
    );
    if (!runInTerminalChoice) {
      return;
    }

    const openInBrowserAfter = await vscode.window.showInputBox({
      title: `New Remote Task: ${scope.title}`,
      prompt: 'Open this URL after execution (optional)',
      value: '',
      placeHolder: 'https://example.com or /relative/path'
    });
    if (openInBrowserAfter === undefined) {
      return;
    }

    const task: SavedRemoteTask = {
      id: `rt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      label: label.trim(),
      command: command.trim(),
      workingDirectory: workingDirectory.trim(),
      runInTerminal: runInTerminalChoice.value,
      openInBrowserAfter: openInBrowserAfter.trim() || undefined
    };

    await this.saveTasks(scope, [...this.getTasks(scope), task]);
    vscode.window.showInformationMessage(`Saved remote task "${task.label}".`);
  }

  private async editTask(scope: TaskScope, tasks: SavedRemoteTask[]): Promise<void> {
    if (tasks.length === 0) {
      vscode.window.showInformationMessage('No saved remote tasks to edit.');
      return;
    }

    const picked = await this.pickTask(tasks, `Edit Remote Task: ${scope.title}`);
    if (!picked) {
      return;
    }

    const label = await vscode.window.showInputBox({
      title: `Edit Remote Task: ${scope.title}`,
      prompt: 'Task label',
      value: picked.label,
      validateInput: value => value.trim() ? undefined : 'Task label is required'
    });
    if (!label) {
      return;
    }

    const command = await vscode.window.showInputBox({
      title: `Edit Remote Task: ${scope.title}`,
      prompt: 'Remote command to execute',
      value: picked.command,
      validateInput: value => value.trim() ? undefined : 'Remote command is required'
    });
    if (!command) {
      return;
    }

    const workingDirectory = await vscode.window.showInputBox({
      title: `Edit Remote Task: ${scope.title}`,
      prompt: 'Remote working directory',
      value: picked.workingDirectory,
      validateInput: value => value.trim() ? undefined : 'Working directory is required'
    });
    if (!workingDirectory) {
      return;
    }

    const runInTerminalChoice = await vscode.window.showQuickPick(
      [
        { label: 'Run in SSH Terminal', value: true },
        { label: 'Run in Background', value: false },
      ],
      { title: `Edit Remote Task: ${scope.title}` }
    );
    if (!runInTerminalChoice) {
      return;
    }

    const openInBrowserAfter = await vscode.window.showInputBox({
      title: `Edit Remote Task: ${scope.title}`,
      prompt: 'Open this URL after execution (optional)',
      value: picked.openInBrowserAfter || ''
    });
    if (openInBrowserAfter === undefined) {
      return;
    }

    await this.saveTasks(
      scope,
      tasks.map(task => task.id === picked.id
        ? {
          ...task,
          label: label.trim(),
          command: command.trim(),
          workingDirectory: workingDirectory.trim(),
          runInTerminal: runInTerminalChoice.value,
          openInBrowserAfter: openInBrowserAfter.trim() || undefined
        }
        : task)
    );

    vscode.window.showInformationMessage(`Updated remote task "${label.trim()}".`);
  }

  private async deleteTask(scope: TaskScope, tasks: SavedRemoteTask[]): Promise<void> {
    if (tasks.length === 0) {
      vscode.window.showInformationMessage('No saved remote tasks to delete.');
      return;
    }

    const picked = await this.pickTask(tasks, `Delete Remote Task: ${scope.title}`);
    if (!picked) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Delete remote task "${picked.label}"?`,
      { modal: true },
      'Delete'
    );

    if (confirm !== 'Delete') {
      return;
    }

    await this.saveTasks(scope, tasks.filter(task => task.id !== picked.id));
  }

  private async executeTask(host: HostConfig, task: SavedRemoteTask): Promise<void> {
    const authConfig = await this.authManager.getAuth(host.id);
    if (!authConfig) {
      vscode.window.showErrorMessage(`Authentication not configured for "${host.name}".`);
      return;
    }

    const remoteCommand = this.buildRemoteCommand(task);

    try {
      if (task.runInTerminal) {
        this.runTaskInTerminal(host, authConfig, task, remoteCommand);
      } else {
        const output = await SshConnectionManager.executeRemoteCommand(host, authConfig, remoteCommand);
        if (output.trim()) {
          const document = await vscode.workspace.openTextDocument({
            language: 'shellscript',
            content: output
          });
          await vscode.window.showTextDocument(document, { preview: false });
        }
        vscode.window.showInformationMessage(`Remote task "${task.label}" finished.`);
      }

      if (task.openInBrowserAfter) {
        await vscode.env.openExternal(vscode.Uri.parse(this.resolveBrowserUrl(host, task.openInBrowserAfter)));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Remote task "${task.label}" failed: ${message}`);
      logger.error(`[RemoteTask] Failed task "${task.label}" on ${host.name}: ${message}`);
    }
  }

  private runTaskInTerminal(
    host: HostConfig,
    authConfig: HostAuthConfig,
    task: SavedRemoteTask,
    remoteCommand: string
  ): void {
    const args: string[] = ['-t'];
    if (host.port && host.port !== 22) {
      args.push('-p', host.port.toString());
    }
    if (authConfig.authType === 'privateKey' && authConfig.privateKeyPath) {
      args.push('-i', authConfig.privateKeyPath);
    }

    args.push(`${host.username}@${host.host}`);
    args.push(remoteCommand);

    const terminal = vscode.window.createTerminal({
      name: `Remote Task: ${host.name} · ${task.label}`,
      shellPath: 'ssh',
      shellArgs: args,
      iconPath: new vscode.ThemeIcon('terminal')
    });
    terminal.show();
  }

  private buildRemoteCommand(task: SavedRemoteTask): string {
    const escapedPath = task.workingDirectory.replace(/'/g, "'\\''");
    return `cd '${escapedPath}' && ${task.command}`;
  }

  private resolveBrowserUrl(host: HostConfig, value: string): string {
    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    if (value.startsWith('/')) {
      return `http://${host.host}${value}`;
    }

    return `http://${host.host}/${value}`;
  }

  private async saveTasks(scope: TaskScope, tasks: SavedRemoteTask[]): Promise<void> {
    if (scope.type === 'host') {
      await this.hostManager.updateHost(scope.host.id, { remoteTasks: tasks });
      return;
    }

    await this.deployProfileService.update(scope.profile.id, { remoteTasks: tasks });
  }

  private getTasks(scope: TaskScope): SavedRemoteTask[] {
    return scope.type === 'host'
      ? [...(scope.host.remoteTasks || [])]
      : [...(scope.profile.remoteTasks || [])];
  }

  private getCandidateTasks(scope: TaskScope): SavedRemoteTask[] {
    const tasks = this.getTasks(scope);
    if (scope.type !== 'host' || !scope.defaultWorkingDirectory) {
      return tasks;
    }

    const normalized = scope.defaultWorkingDirectory.replace(/\/+$/, '') || '/';
    const exactMatches = tasks.filter(task => (task.workingDirectory.replace(/\/+$/, '') || '/') === normalized);
    return exactMatches.length > 0 ? exactMatches : tasks;
  }

  private async pickTask(tasks: SavedRemoteTask[], title: string): Promise<SavedRemoteTask | undefined> {
    const picked = await vscode.window.showQuickPick(
      tasks.map(task => ({
        label: task.label,
        description: task.workingDirectory,
        detail: task.command,
        task
      })),
      {
        title,
        matchOnDescription: true,
        matchOnDetail: true
      }
    );

    return picked?.task;
  }

  private async resolveScope(arg?: any): Promise<TaskScope | undefined> {
    if (arg?.profile?.id) {
      const profile = this.deployProfileService.getById(arg.profile.id);
      if (!profile) {
        vscode.window.showWarningMessage('Deploy profile not found.');
        return undefined;
      }
      const host = await this.getHost(profile.hostId);
      if (!host) {
        return undefined;
      }
      return {
        type: 'profile',
        profile,
        host,
        title: `${profile.name} @ ${host.name}`
      };
    }

    if (arg?.type === 'bookmark' && arg.hostId) {
      const host = await this.getHost(arg.hostId);
      if (!host) {
        return undefined;
      }
      return {
        type: 'host',
        host,
        defaultWorkingDirectory: arg.data?.path,
        title: `${host.name} @ ${arg.data?.name || arg.data?.path || 'bookmark'}`
      };
    }

    if (arg?.type === 'host' && arg.data?.id) {
      const host = await this.getHost(arg.data.id);
      if (!host) {
        return undefined;
      }
      return {
        type: 'host',
        host,
        title: host.name
      };
    }

    const profiles = this.deployProfileService.getAll();
    const hosts = await this.hostManager.getHosts();
    const items = [
      ...hosts.map(host => ({
        label: host.name,
        description: `${host.username}@${host.host}:${host.port}`,
        scope: {
          type: 'host' as const,
          host,
          title: host.name
        }
      })),
      ...profiles.map(profile => {
        const host = hosts.find(item => item.id === profile.hostId);
        return host ? {
          label: profile.name,
          description: `${host.name}:${profile.remoteRoot}`,
          scope: {
            type: 'profile' as const,
            profile,
            host,
            title: `${profile.name} @ ${host.name}`
          }
        } : undefined;
      }).filter(Boolean) as Array<{ label: string; description: string; scope: TaskScope }>
    ];

    if (items.length === 0) {
      vscode.window.showInformationMessage('No hosts or deploy profiles available for remote tasks.');
      return undefined;
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Select Remote Task Scope',
      matchOnDescription: true
    });

    return picked?.scope;
  }

  private async getHost(hostId: string): Promise<HostConfig | undefined> {
    const hosts = await this.hostManager.getHosts();
    const host = hosts.find(item => item.id === hostId);
    if (!host) {
      vscode.window.showWarningMessage('Host not found.');
    }
    return host;
  }
}
