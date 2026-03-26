import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { DeployProfile, HostConfig } from '../types';
import { DEPLOY_PROFILE } from '../constants';
import { logger } from '../logger';
import { DeployProfileService } from './deployProfileService';
import { TransferQueueService } from './transferQueueService';
import { HostManager } from '../hostManager';
import { AuthManager } from '../authManager';
import { SshConnectionManager } from '../sshConnectionManager';

/**
 * 监听文件保存事件，按 DeployProfile 规则自动上传到远端。
 *
 * 生命周期：在 extension.activate() 中创建，放入 context.subscriptions 后自动销毁。
 */
export class UploadOnSaveService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly deployProfileService: DeployProfileService,
    private readonly transferQueueService: TransferQueueService,
    private readonly hostManager: HostManager,
    private readonly authManager: AuthManager
  ) {
    // 状态栏：显示当前激活的 upload-on-save Profile 数量
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      DEPLOY_PROFILE.STATUS_BAR_PRIORITY
    );
    this.statusBarItem.command = 'simpleSftp.manageDeployProfiles';
    this.disposables.push(
      this.statusBarItem,
      // 监听文件保存事件
      vscode.workspace.onDidSaveTextDocument(doc => this.onFileSaved(doc.uri)),
      // 监听 Profile 变更，更新状态栏
      this.deployProfileService.onDidChangeProfiles(() => this.updateStatusBar())
    );

    this.updateStatusBar();
  }

  // --------------------------------------------------------------------------
  // 公有方法
  // --------------------------------------------------------------------------

  /** 手动触发指定 Profile 对整个 localRoot 目录的完整上传（入队） */
  async uploadAll(profileId: string): Promise<void> {
    const profile = this.deployProfileService.getById(profileId);
    if (!profile) {
      vscode.window.showErrorMessage(`Deploy Profile not found: ${profileId}`);
      return;
    }
    const localRoot = this.resolveLocalRoot(profile);
    if (!fs.existsSync(localRoot)) {
      vscode.window.showErrorMessage(`Local path does not exist: ${localRoot}`);
      return;
    }
    const host = (await this.hostManager.getHosts()).find(h => h.id === profile.hostId);
    if (!host) {
      vscode.window.showErrorMessage(`Host not found for profile "${profile.name}"`);
      return;
    }
    this.transferQueueService.addTask({
      type: 'upload',
      hostId: profile.hostId,
      hostName: host.name,
      localPath: localRoot,
      remotePath: profile.remoteRoot,
      isDirectory: true,
    });
    logger.info(`[UploadOnSave] Queued full upload: "${localRoot}" → "${profile.remoteRoot}" on ${host.name}`);
    vscode.window.showInformationMessage(`Upload queued: "${profile.name}" → ${host.name}:${profile.remoteRoot}`);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  // --------------------------------------------------------------------------
  // 核心：文件保存处理
  // --------------------------------------------------------------------------

  private async onFileSaved(fileUri: vscode.Uri): Promise<void> {
    // 只处理本地文件（排除 sftp:// 等虚拟文件系统）
    if (fileUri.scheme !== 'file') {
      return;
    }

    const localFilePath = fileUri.fsPath;
    const activeProfiles = this.deployProfileService.getActiveUploadOnSaveProfiles();

    for (const profile of activeProfiles) {
      await this.handleProfileForFile(profile, localFilePath);
    }
  }

  private async handleProfileForFile(profile: DeployProfile, localFilePath: string): Promise<void> {
    const localRoot = this.resolveLocalRoot(profile);

    // 检查文件是否在 localRoot 下
    const relativePath = this.getRelativePath(localRoot, localFilePath);
    if (relativePath === null) {
      return; // 不在此 Profile 的根路径下
    }

    // 检查排除规则
    if (this.isExcluded(relativePath, profile.excludePatterns)) {
      logger.debug(`[UploadOnSave] Excluded by pattern: "${relativePath}" in profile "${profile.name}"`);
      return;
    }

    // 获取主机信息
    const hosts = await this.hostManager.getHosts();
    const host = hosts.find(h => h.id === profile.hostId);
    if (!host) {
      logger.warn(`[UploadOnSave] Host not found (${profile.hostId}) for profile "${profile.name}"`);
      return;
    }

    const remotePath = path.posix.join(profile.remoteRoot, relativePath.replaceAll('\\', '/'));

    // 上传前确认
    const shouldUpload = await this.checkConfirmation(profile, localFilePath, remotePath, host.name);
    if (!shouldUpload) {
      return;
    }

    // 冲突检查
    const proceed = await this.handleConflict(profile, localFilePath, remotePath, host);
    if (!proceed) {
      return;
    }

    // 加入传输队列
    this.transferQueueService.addTask({
      type: 'upload',
      hostId: profile.hostId,
      hostName: host.name,
      localPath: localFilePath,
      remotePath,
      isDirectory: false,
    });

    logger.info(`[UploadOnSave] Queued: "${path.basename(localFilePath)}" → ${host.name}:${remotePath}`);
  }

  // --------------------------------------------------------------------------
  // 确认与冲突处理
  // --------------------------------------------------------------------------

  private async checkConfirmation(
    profile: DeployProfile,
    localFilePath: string,
    remotePath: string,
    hostName: string
  ): Promise<boolean> {
    if (profile.confirmBeforeUpload === 'never') {
      return true;
    }
    if (profile.confirmBeforeUpload === 'always') {
      const answer = await vscode.window.showInformationMessage(
        `Upload "${path.basename(localFilePath)}" to ${hostName}:${remotePath}?`,
        { modal: false },
        'Upload',
        'Skip'
      );
      return answer === 'Upload';
    }
    // 'onConflict' — 冲突时询问，这里先允许，冲突检查在 handleConflict 中进行
    return true;
  }

  private async handleConflict(
    profile: DeployProfile,
    localFilePath: string,
    remotePath: string,
    host: HostConfig
  ): Promise<boolean> {
    if (profile.conflictStrategy === 'overwrite') {
      return true;
    }

    // 尝试获取远端文件信息
    let remoteStat: { size: number; mtime: number } | null = null;
    try {
      const authConfig = await this.authManager.getAuth(host.id);
      if (authConfig) {
        remoteStat = await SshConnectionManager.getRemoteFileStat(host, authConfig, remotePath);
      }
    } catch {
      // 远端文件不存在（stat 失败）→ 无冲突，直接上传
      return true;
    }

    if (!remoteStat) {
      return true;
    }

    if (profile.conflictStrategy === 'skip') {
      logger.info(`[UploadOnSave] Skipped (remote exists): "${remotePath}"`);
      return false;
    }

    // 'promptIfNewer' — 仅当远端较新时询问
    const localStat = fs.statSync(localFilePath);
    const localMtime = localStat.mtimeMs;
    const remoteMtime = remoteStat.mtime * 1000; // 转为毫秒

    if (remoteMtime > localMtime) {
      const shouldConfirm =
        profile.confirmBeforeUpload === 'always' || profile.confirmBeforeUpload === 'onConflict';

      if (shouldConfirm) {
        const answer = await vscode.window.showWarningMessage(
          `Remote "${path.basename(remotePath)}" is newer than local. Overwrite?`,
          { modal: false },
          'Overwrite',
          'Skip'
        );
        return answer === 'Overwrite';
      }
      // confirmBeforeUpload === 'never' → 直接跳过（远端较新则保守处理）
      logger.info(`[UploadOnSave] Skipped (remote is newer): "${remotePath}"`);
      return false;
    }

    return true;
  }

  // --------------------------------------------------------------------------
  // 路径处理
  // --------------------------------------------------------------------------

  /**
   * 解析 ${workspaceFolder} 占位符，返回本机绝对路径
   */
  private resolveLocalRoot(profile: DeployProfile): string {
    if (!profile.localRoot.includes('${workspaceFolder}')) {
      return profile.localRoot;
    }

    // scopeToWorkspace: 使用第一个 workspace folder（单根）或全部文件夹匹配最长前缀
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return profile.localRoot;
    }
    // 对于多 workspace，取第一个作为默认替换（用户可为每个 workspace 创建独立 Profile）
    return profile.localRoot.replace(
      '${workspaceFolder}',
      folders[0].uri.fsPath
    );
  }

  /**
   * 计算 filePath 相对于 root 的路径；若不在 root 下则返回 null
   */
  private getRelativePath(root: string, filePath: string): string | null {
    const normalizedRoot = path.normalize(root);
    const normalizedFile = path.normalize(filePath);

    if (
      normalizedFile.startsWith(normalizedRoot + path.sep) ||
      normalizedFile === normalizedRoot
    ) {
      return path.relative(normalizedRoot, normalizedFile);
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Glob 匹配
  // --------------------------------------------------------------------------

  /**
   * 判断相对路径是否匹配任意排除规则（简单 glob 实现，支持 ** / * / ?）
   */
  isExcluded(relativePath: string, patterns: string[]): boolean {
    const normalized = relativePath.replaceAll('\\', '/');
    return patterns.some(pattern => this.matchGlob(normalized, pattern));
  }

  /**
   * 将 glob 模式转换为正则并匹配。
   * 支持：`**`（任意路径段）、`*`（单段内任意字符）、`?`（单字符）
   */
  matchGlob(filePath: string, pattern: string): boolean {
    const normalized = pattern.replaceAll('\\', '/');
    // 逐字符处理，构建正则字符串，避免控制字符临时标记
    let regexStr = '';
    let i = 0;
    while (i < normalized.length) {
      const ch = normalized[i];
      if (ch === '*' && normalized[i + 1] === '*') {
        regexStr += '.*';
        i += 2;
        if (normalized[i] === '/') { i++; }
      } else if (ch === '*') {
        regexStr += '[^/]*';
        i++;
      } else if (ch === '?') {
        regexStr += '[^/]';
        i++;
      } else if ('.+^${}()|[]'.includes(ch)) {
        regexStr += `\\${ch}`;
        i++;
      } else {
        regexStr += ch;
        i++;
      }
    }
    // 若 pattern 不以 * 开头，允许在任意子目录下匹配
    const fullPattern = normalized.startsWith('*') ? `^${regexStr}$` : `^(.*/)?${regexStr}$`;
    try {
      return new RegExp(fullPattern).test(filePath);
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // 状态栏
  // --------------------------------------------------------------------------

  private updateStatusBar(): void {
    const active = this.deployProfileService.getActiveUploadOnSaveProfiles();
    if (active.length > 0) {
      this.statusBarItem.text = `$(cloud-upload) Deploy: ${active.length} active`;
      this.statusBarItem.tooltip = `Upload-on-save active for ${active.length} profile(s). Click to manage.`;
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }
}
