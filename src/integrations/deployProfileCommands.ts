/**
 * Deploy Profile 命令处理器
 *
 * 负责添加/编辑/删除/切换 Deploy Profile 的所有 QuickInput 交互逻辑。
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { DeployProfileService } from '../services/deployProfileService';
import { DeploySyncService } from '../services/deploySyncService';
import { UploadOnSaveService } from '../services/uploadOnSaveService';
import { HostManager } from '../hostManager';
import { DeployProfile, ConfirmBeforeUpload, ConflictStrategy, DeploySyncCompareMethod, DeploySyncMode } from '../types';
import { DEPLOY_PROFILE } from '../constants';
import { logger } from '../logger';
import { DeployProfileTreeItem } from '../ui/deployProfileProvider';

export class DeployProfileCommands {
  constructor(
    private readonly deployProfileService: DeployProfileService,
    private readonly deploySyncService: DeploySyncService,
    private readonly uploadOnSaveService: UploadOnSaveService,
    private readonly hostManager: HostManager
  ) {}

  /**
   * 从命令参数中提取 profile ID。
   * 右键菜单传入 DeployProfileTreeItem，命令面板传入 string | undefined。
   */
  private resolveId(arg?: string | DeployProfileTreeItem): string | undefined {
    if (!arg) {
      return undefined;
    }
    if (typeof arg === 'string') {
      return arg;
    }
    if (arg instanceof DeployProfileTreeItem) {
      return arg.profile.id;
    }
    // 兜底：可能是普通对象（序列化后）
    if ((arg as any).profile?.id) {
      return (arg as any).profile.id;
    }
    return undefined;
  }

  // --------------------------------------------------------------------------
  // 注册所有命令
  // --------------------------------------------------------------------------

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('simpleSftp.addDeployProfile', () => this.addDeployProfile()),
      vscode.commands.registerCommand('simpleSftp.editDeployProfile', (arg?: string | DeployProfileTreeItem) => this.editDeployProfile(this.resolveId(arg))),
      vscode.commands.registerCommand('simpleSftp.deleteDeployProfile', (arg?: string | DeployProfileTreeItem) => this.deleteDeployProfile(this.resolveId(arg))),
      vscode.commands.registerCommand('simpleSftp.toggleDeployProfile', (arg?: string | DeployProfileTreeItem) => this.toggleDeployProfile(this.resolveId(arg))),
      vscode.commands.registerCommand('simpleSftp.toggleUploadOnSave', (arg?: string | DeployProfileTreeItem) => this.toggleUploadOnSave(this.resolveId(arg))),
      vscode.commands.registerCommand('simpleSftp.uploadAllNow', (arg?: string | DeployProfileTreeItem) => this.uploadAllNow(this.resolveId(arg))),
      vscode.commands.registerCommand('simpleSftp.previewSyncProfile', (arg?: string | DeployProfileTreeItem) => this.previewSyncProfile(this.resolveId(arg))),
      vscode.commands.registerCommand('simpleSftp.syncProfileNow', (arg?: string | DeployProfileTreeItem) => this.syncProfileNow(this.resolveId(arg))),
      vscode.commands.registerCommand('simpleSftp.openSyncDiff', (arg?: string | DeployProfileTreeItem) => this.openSyncDiff(this.resolveId(arg))),
      vscode.commands.registerCommand('simpleSftp.manageDeployProfiles', () => this.manageDeployProfiles())
    );
  }

  // --------------------------------------------------------------------------
  // 添加 Profile
  // --------------------------------------------------------------------------

  async addDeployProfile(): Promise<void> {
    const hosts = await this.hostManager.getHosts();
    if (hosts.length === 0) {
      vscode.window.showErrorMessage('Please add a host first before creating a deploy profile.');
      return;
    }

    // Step 1: 名称
    const name = await vscode.window.showInputBox({
      title: 'New Deploy Profile (1/5): Name',
      prompt: 'Enter a name for this deploy profile',
      placeHolder: 'e.g., Production Deploy',
      validateInput: v => (v.trim() ? null : 'Name cannot be empty'),
    });
    if (!name) { return; }

    // Step 2: 选择主机
    const hostItems = hosts.map(h => ({ label: h.name, description: `${h.host}:${h.port}`, id: h.id }));
    const selectedHost = await vscode.window.showQuickPick(hostItems, {
      title: 'New Deploy Profile (2/5): Select Host',
      placeHolder: 'Select the remote host',
    });
    if (!selectedHost) { return; }

    // Step 3: 本地根路径（默认为当前 workspace 目录）
    const defaultLocal = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const localRoot = await vscode.window.showInputBox({
      title: 'New Deploy Profile (3/5): Local Root',
      prompt: 'Local root directory to watch. Use ${workspaceFolder} for the current workspace.',
      value: defaultLocal || '${workspaceFolder}',
      validateInput: v => (v.trim() ? null : 'Local root cannot be empty'),
    });
    if (!localRoot) { return; }

    // Step 4: 远程根路径
    const host = hosts.find(h => h.id === selectedHost.id)!;
    const remoteRoot = await vscode.window.showInputBox({
      title: 'New Deploy Profile (4/5): Remote Root',
      prompt: 'Remote directory to upload files into',
      value: host.defaultRemotePath ?? '/var/www',
      validateInput: v => (v.trim() ? null : 'Remote root cannot be empty'),
    });
    if (!remoteRoot) { return; }

    // Step 5: uploadOnSave 开关
    const uploadOnSaveChoice = await vscode.window.showQuickPick(
      [
        { label: '$(cloud-upload) Yes — Upload on Save', description: 'Automatically upload on every file save', value: true },
        { label: '$(remote) No — Manual only', description: 'Use "Upload All Now" or manual upload', value: false },
      ],
      { title: 'New Deploy Profile (5/5): Upload on Save?' }
    );
    if (!uploadOnSaveChoice) { return; }

    const defaults = DeployProfileService.buildDefaults(name.trim(), selectedHost.id, localRoot.trim(), remoteRoot.trim());
    const profile = await this.deployProfileService.create({
      ...defaults,
      uploadOnSave: uploadOnSaveChoice.value,
    });

    logger.info(`[DeployProfileCommands] Created profile: ${profile.name}`);
    vscode.window.showInformationMessage(
      `Deploy Profile "${profile.name}" created.`,
      'Edit Settings'
    ).then(action => {
      if (action === 'Edit Settings') {
        vscode.commands.executeCommand('simpleSftp.editDeployProfile', profile.id);
      }
    });
  }

  // --------------------------------------------------------------------------
  // 编辑 Profile
  // --------------------------------------------------------------------------

  async editDeployProfile(id?: string): Promise<void> {
    const profileId = id ?? await this.pickProfile('Select profile to edit');
    if (!profileId) { return; }

    const profile = this.deployProfileService.getById(profileId);
    if (!profile) {
      vscode.window.showErrorMessage('Deploy profile not found.');
      return;
    }

    const EDIT_ITEMS = [
      { label: '$(edit) Name', description: profile.name, field: 'name' },
      { label: '$(remote-explorer) Remote Root', description: profile.remoteRoot, field: 'remoteRoot' },
      { label: '$(folder-opened) Local Root', description: profile.localRoot, field: 'localRoot' },
      { label: '$(cloud-upload) Upload on Save', description: profile.uploadOnSave ? 'ON' : 'OFF', field: 'uploadOnSave' },
      { label: '$(sync) Sync Mode', description: profile.syncMode, field: 'syncMode' },
      { label: '$(search) Compare Method', description: profile.compareMethod, field: 'compareMethod' },
      { label: '$(trash) Delete Remote Extras', description: profile.deleteRemote ? 'ON' : 'OFF', field: 'deleteRemote' },
      { label: '$(history) Preserve Timestamps', description: profile.preserveTimestamps ? 'ON' : 'OFF', field: 'preserveTimestamps' },
      { label: '$(list-filter) Exclude Patterns', description: profile.excludePatterns.join(', ') || '(none)', field: 'excludePatterns' },
      { label: '$(question) Confirm Before Upload', description: profile.confirmBeforeUpload, field: 'confirmBeforeUpload' },
      { label: '$(warning) Conflict Strategy', description: profile.conflictStrategy, field: 'conflictStrategy' },
      { label: '$(workspace-trusted) Scope to Workspace', description: profile.scopeToWorkspace ? 'ON' : 'OFF', field: 'scopeToWorkspace' },
    ];

    const field = await vscode.window.showQuickPick(EDIT_ITEMS, {
      title: `Edit Deploy Profile: ${profile.name}`,
      placeHolder: 'Select a setting to change',
    });
    if (!field) { return; }

    await this.editField(profile, field.field);
  }

  private async editField(profile: DeployProfile, field: string): Promise<void> {
    let updates: Partial<Omit<DeployProfile, 'id'>> = {};

    switch (field) {
      case 'name': {
        const v = await vscode.window.showInputBox({ value: profile.name, prompt: 'Profile name', validateInput: s => s.trim() ? null : 'Required' });
        if (!v) { return; }
        updates = { name: v.trim() };
        break;
      }
      case 'remoteRoot': {
        const v = await vscode.window.showInputBox({ value: profile.remoteRoot, prompt: 'Remote root path', validateInput: s => s.trim() ? null : 'Required' });
        if (!v) { return; }
        updates = { remoteRoot: v.trim() };
        break;
      }
      case 'localRoot': {
        const v = await vscode.window.showInputBox({ value: profile.localRoot, prompt: 'Local root path (use ${workspaceFolder} for workspace)', validateInput: s => s.trim() ? null : 'Required' });
        if (!v) { return; }
        updates = { localRoot: v.trim() };
        break;
      }
      case 'uploadOnSave': {
        const v = await vscode.window.showQuickPick([{ label: 'ON', value: true }, { label: 'OFF', value: false }], { title: 'Upload on Save' });
        if (!v) { return; }
        updates = { uploadOnSave: v.value };
        break;
      }
      case 'syncMode': {
        const options: Array<{ label: string; value: DeploySyncMode; description: string }> = [
          { label: 'uploadChanged', value: 'uploadChanged', description: 'Upload changed files only' },
          { label: 'mirrorLocal', value: 'mirrorLocal', description: 'Upload changes and optionally delete remote extras' },
        ];
        const v = await vscode.window.showQuickPick(options, { title: 'Sync Mode' });
        if (!v) { return; }
        updates = { syncMode: v.value };
        break;
      }
      case 'compareMethod': {
        const options: Array<{ label: string; value: DeploySyncCompareMethod; description: string }> = [
          { label: 'mtime', value: 'mtime', description: 'Fast timestamp comparison' },
          { label: 'checksum', value: 'checksum', description: 'Slower but verifies file content' },
        ];
        const v = await vscode.window.showQuickPick(options, { title: 'Compare Method' });
        if (!v) { return; }
        updates = { compareMethod: v.value };
        break;
      }
      case 'deleteRemote': {
        const v = await vscode.window.showQuickPick([{ label: 'ON', value: true }, { label: 'OFF', value: false }], { title: 'Delete Remote Extras' });
        if (!v) { return; }
        updates = { deleteRemote: v.value };
        break;
      }
      case 'preserveTimestamps': {
        const v = await vscode.window.showQuickPick([{ label: 'ON', value: true }, { label: 'OFF', value: false }], { title: 'Preserve Timestamps' });
        if (!v) { return; }
        updates = { preserveTimestamps: v.value };
        break;
      }
      case 'excludePatterns': {
        const v = await vscode.window.showInputBox({
          value: profile.excludePatterns.join(', '),
          prompt: 'Comma-separated glob patterns to exclude (e.g. node_modules/**, *.log)',
        });
        if (v === undefined) { return; }
        updates = { excludePatterns: v.split(',').map(s => s.trim()).filter(Boolean) };
        break;
      }
      case 'confirmBeforeUpload': {
        const options: Array<{ label: string; value: ConfirmBeforeUpload }> = [
          { label: 'never — Upload silently', value: 'never' },
          { label: 'always — Always confirm', value: 'always' },
          { label: 'onConflict — Confirm only on conflict', value: 'onConflict' },
        ];
        const v = await vscode.window.showQuickPick(options, { title: 'Confirm Before Upload' });
        if (!v) { return; }
        updates = { confirmBeforeUpload: v.value };
        break;
      }
      case 'conflictStrategy': {
        const options: Array<{ label: string; value: ConflictStrategy }> = [
          { label: 'overwrite — Always overwrite remote', value: 'overwrite' },
          { label: 'skip — Skip if remote exists', value: 'skip' },
          { label: 'promptIfNewer — Ask when remote is newer', value: 'promptIfNewer' },
        ];
        const v = await vscode.window.showQuickPick(options, { title: 'Conflict Strategy' });
        if (!v) { return; }
        updates = { conflictStrategy: v.value };
        break;
      }
      case 'scopeToWorkspace': {
        const v = await vscode.window.showQuickPick([{ label: 'ON', value: true }, { label: 'OFF', value: false }], { title: 'Scope to Workspace' });
        if (!v) { return; }
        updates = { scopeToWorkspace: v.value };
        break;
      }
      default:
        return;
    }

    await this.deployProfileService.update(profile.id, updates);
    vscode.window.showInformationMessage(`Updated "${profile.name}"`);
  }

  // --------------------------------------------------------------------------
  // 删除 Profile
  // --------------------------------------------------------------------------

  async deleteDeployProfile(id?: string): Promise<void> {
    const profileId = id ?? await this.pickProfile('Select profile to delete');
    if (!profileId) { return; }

    const profile = this.deployProfileService.getById(profileId);
    if (!profile) { return; }

    const confirm = await vscode.window.showWarningMessage(
      `Delete deploy profile "${profile.name}"?`,
      { modal: true },
      'Delete'
    );
    if (confirm !== 'Delete') { return; }

    await this.deployProfileService.delete(profileId);
    vscode.window.showInformationMessage(`Deleted "${profile.name}"`);
  }

  async previewSyncProfile(id?: string): Promise<void> {
    const profileId = id ?? await this.pickProfile('Select profile to preview sync');
    if (!profileId) { return; }
    await this.deploySyncService.previewProfile(profileId, true);
  }

  async syncProfileNow(id?: string): Promise<void> {
    const profileId = id ?? await this.pickProfile('Select profile to sync');
    if (!profileId) { return; }
    await this.deploySyncService.syncProfileNow(profileId);
  }

  async openSyncDiff(id?: string): Promise<void> {
    const profileId = id ?? await this.pickProfile('Select profile to open sync diff');
    if (!profileId) { return; }
    await this.deploySyncService.openLastPreview(profileId);
  }

  // --------------------------------------------------------------------------
  // 切换启用状态
  // --------------------------------------------------------------------------

  async toggleDeployProfile(id?: string): Promise<void> {
    const profileId = id ?? await this.pickProfile('Select profile to enable/disable');
    if (!profileId) { return; }

    const updated = await this.deployProfileService.toggle(profileId);
    vscode.window.showInformationMessage(
      `Deploy Profile "${updated.name}" is now ${updated.enabled ? 'enabled' : 'disabled'}.`
    );
  }

  async toggleUploadOnSave(id?: string): Promise<void> {
    const profileId = id ?? await this.pickProfile('Select profile to toggle upload-on-save');
    if (!profileId) { return; }

    const updated = await this.deployProfileService.toggleUploadOnSave(profileId);
    vscode.window.showInformationMessage(
      `Upload on Save for "${updated.name}" is now ${updated.uploadOnSave ? 'ON' : 'OFF'}.`
    );
  }

  // --------------------------------------------------------------------------
  // 立即上传全部
  // --------------------------------------------------------------------------

  async uploadAllNow(id?: string): Promise<void> {
    const profileId = id ?? await this.pickProfile('Select profile to upload now');
    if (!profileId) { return; }

    await this.uploadOnSaveService.uploadAll(profileId);
  }

  // --------------------------------------------------------------------------
  // 管理面板（Quick Pick 列表）
  // --------------------------------------------------------------------------

  async manageDeployProfiles(): Promise<void> {
    const profiles = this.deployProfileService.getAll();

    const items = [
      {
        label: '$(add) Add Deploy Profile',
        description: '',
        action: 'add',
        profileId: undefined as string | undefined,
      },
      ...profiles.map(p => ({
        label: `${p.enabled ? (p.uploadOnSave ? '$(cloud-upload)' : '$(remote)') : '$(circle-slash)'} ${p.name}`,
        description: `${p.uploadOnSave ? 'Upload on Save' : 'Manual'} · ${p.remoteRoot}`,
        action: 'manage',
        profileId: p.id,
      })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Manage Deploy Profiles',
      placeHolder: 'Select a profile to manage, or add a new one',
    });
    if (!picked) { return; }

    if (picked.action === 'add') {
      await this.addDeployProfile();
    } else if (picked.profileId) {
      await this.editDeployProfile(picked.profileId);
    }
  }

  // --------------------------------------------------------------------------
  // 辅助：选择 Profile
  // --------------------------------------------------------------------------

  private async pickProfile(placeHolder: string): Promise<string | undefined> {
    const profiles = this.deployProfileService.getAll();
    if (profiles.length === 0) {
      vscode.window.showInformationMessage('No deploy profiles configured. Add one first.');
      return undefined;
    }
    const items = profiles.map(p => ({
      label: p.name,
      description: p.remoteRoot,
      id: p.id,
    }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder });
    return picked?.id;
  }
}
