import * as path from 'node:path';
import * as vscode from 'vscode';
import { AuthManager } from '../authManager';
import { HostManager } from '../hostManager';
import { logger } from '../logger';
import { TransferTaskModel } from '../models/transferTask';
import { SshConnectionManager } from '../sshConnectionManager';
import { DeployProfile, HostAuthConfig, HostConfig } from '../types';
import { SyncFailure, SyncPreview, SyncStats } from './deltaSyncManager';
import { DeployProfileService } from './deployProfileService';
import { TransferHistoryService } from './transferHistoryService';

interface StoredSyncResult {
  id: string;
  kind: 'preview' | 'result';
  profileId: string;
  profileName: string;
  hostId: string;
  hostName: string;
  localRoot: string;
  remoteRoot: string;
  createdAt: string;
  markdown: string;
  uploaded: number;
  deleted: number;
  skipped: number;
  failed: number;
  failures: SyncFailure[];
}

interface ResolvedProfileContext {
  profile: DeployProfile;
  host: HostConfig;
  authConfig: HostAuthConfig;
  localRoot: string;
}

export class DeploySyncService {
  private static readonly STORAGE_KEY = 'simpleSftp.syncResults';
  private static readonly MAX_STORED_RESULTS = 40;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly deployProfileService: DeployProfileService,
    private readonly hostManager: HostManager,
    private readonly authManager: AuthManager,
    private readonly historyService: TransferHistoryService
  ) {}

  async previewProfile(profileId: string, openDocument: boolean = true): Promise<StoredSyncResult | undefined> {
    const resolved = await this.resolveProfileContext(profileId);
    if (!resolved) {
      return undefined;
    }

    const preview = await SshConnectionManager.previewDirectorySync(
      resolved.host,
      resolved.authConfig,
      resolved.localRoot,
      resolved.profile.remoteRoot,
      {
        compareMethod: resolved.profile.compareMethod,
        deleteRemote: resolved.profile.syncMode === 'mirrorLocal' && resolved.profile.deleteRemote,
        preserveTimestamps: resolved.profile.preserveTimestamps,
        excludePatterns: resolved.profile.excludePatterns,
      }
    );

    const stored = await this.storeResult({
      kind: 'preview',
      profileId: resolved.profile.id,
      profileName: resolved.profile.name,
      hostId: resolved.host.id,
      hostName: resolved.host.name,
      localRoot: resolved.localRoot,
      remoteRoot: resolved.profile.remoteRoot,
      uploaded: preview.diff.toUpload.length,
      deleted: preview.diff.toDelete.length,
      skipped: preview.diff.unchanged.length,
      failed: 0,
      failures: [],
      markdown: this.renderPreviewMarkdown(resolved, preview)
    });

    if (openDocument) {
      await this.openStoredResult(stored.id);
    }

    return stored;
  }

  async syncProfileNow(profileId: string): Promise<StoredSyncResult | undefined> {
    const resolved = await this.resolveProfileContext(profileId);
    if (!resolved) {
      return undefined;
    }

    const previewStored = await this.previewProfile(profileId, false);
    if (!previewStored) {
      return undefined;
    }

    if (previewStored.uploaded === 0 && previewStored.deleted === 0) {
      const choice = await vscode.window.showInformationMessage(
        `No sync changes detected for "${resolved.profile.name}".`,
        'Open Sync Diff'
      );
      if (choice === 'Open Sync Diff') {
        await this.openStoredResult(previewStored.id);
      }
      return previewStored;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Sync "${resolved.profile.name}" to ${resolved.host.name}? Upload ${previewStored.uploaded}, delete ${previewStored.deleted}, skip ${previewStored.skipped}.`,
      { modal: true },
      'Sync Now',
      'Open Sync Diff'
    );

    if (confirm === 'Open Sync Diff') {
      await this.openStoredResult(previewStored.id);
      return previewStored;
    }

    if (confirm !== 'Sync Now') {
      return undefined;
    }

    let progressCount = 0;
    const startedAt = new Date();
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Syncing ${resolved.profile.name}`,
        cancellable: false,
      },
      async progress => {
        const syncResult = await SshConnectionManager.runDirectorySync(
          resolved.host,
          resolved.authConfig,
          resolved.localRoot,
          resolved.profile.remoteRoot,
          {
            compareMethod: resolved.profile.compareMethod,
            deleteRemote: resolved.profile.syncMode === 'mirrorLocal' && resolved.profile.deleteRemote,
            preserveTimestamps: resolved.profile.preserveTimestamps,
            excludePatterns: resolved.profile.excludePatterns,
            onProgress: (current, total, currentFile) => {
              if (total > 0) {
                const increment = ((current - progressCount) / total) * 100;
                progress.report({
                  increment,
                  message: `${currentFile} (${current}/${total})`
                });
                progressCount = current;
              }
            }
          }
        );
        return syncResult;
      }
    );
    const completedAt = new Date();

    const stored = await this.storeResult({
      kind: 'result',
      profileId: resolved.profile.id,
      profileName: resolved.profile.name,
      hostId: resolved.host.id,
      hostName: resolved.host.name,
      localRoot: resolved.localRoot,
      remoteRoot: resolved.profile.remoteRoot,
      uploaded: result.uploaded,
      deleted: result.deleted,
      skipped: result.skipped,
      failed: result.failed,
      failures: result.failures || [],
      markdown: this.renderResultMarkdown(resolved, result, startedAt, completedAt)
    });

    await this.addHistoryEntry(resolved, stored, startedAt, completedAt);

    const actions = result.failed > 0 ? ['Open Result', 'Retry Failed Only'] : ['Open Result'];
    const choice = await vscode.window.showInformationMessage(
      result.failed > 0
        ? `Sync finished with ${result.failed} failed item(s).`
        : `Sync finished for "${resolved.profile.name}".`,
      ...actions
    );

    if (choice === 'Open Result') {
      await this.openStoredResult(stored.id);
    } else if (choice === 'Retry Failed Only') {
      await this.retryFailedSync(stored.id);
    }

    return stored;
  }

  async openLastPreview(profileId: string): Promise<void> {
    const latest = this.getStoredResults().find(result => result.profileId === profileId && result.kind === 'preview');
    if (!latest) {
      await this.previewProfile(profileId, true);
      return;
    }

    await this.openStoredResult(latest.id);
  }

  async openStoredResult(resultId: string): Promise<void> {
    const stored = this.getStoredResults().find(result => result.id === resultId);
    if (!stored) {
      vscode.window.showWarningMessage('Sync result not found.');
      return;
    }

    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: stored.markdown
    });
    await vscode.window.showTextDocument(document, { preview: false });
  }

  async retryFailedSync(resultId: string): Promise<StoredSyncResult | undefined> {
    const stored = this.getStoredResults().find(result => result.id === resultId);
    if (!stored) {
      vscode.window.showWarningMessage('Sync result not found.');
      return undefined;
    }

    if (stored.failures.length === 0) {
      vscode.window.showInformationMessage('There are no failed sync items to retry.');
      return stored;
    }

    const resolved = await this.resolveProfileContext(stored.profileId);
    if (!resolved) {
      return undefined;
    }

    const startedAt = new Date();
    const failures: SyncFailure[] = [];
    let uploaded = 0;
    let deleted = 0;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Retrying failed sync items for ${resolved.profile.name}`,
        cancellable: false,
      },
      async progress => {
        for (let index = 0; index < stored.failures.length; index++) {
          const failure = stored.failures[index];
          progress.report({
            increment: 100 / stored.failures.length,
            message: `${failure.path} (${index + 1}/${stored.failures.length})`
          });

          try {
            if (failure.operation === 'upload') {
              const localPath = path.join(resolved.localRoot, failure.path);
              const remotePath = path.posix.join(resolved.profile.remoteRoot, failure.path).replaceAll('\\', '/');
              await SshConnectionManager.uploadFile(resolved.host, resolved.authConfig, localPath, remotePath);
              uploaded++;
            } else {
              const remotePath = path.posix.join(resolved.profile.remoteRoot, failure.path).replaceAll('\\', '/');
              await SshConnectionManager.deleteRemoteFile(resolved.host, resolved.authConfig, remotePath);
              deleted++;
            }
          } catch (error) {
            failures.push({
              path: failure.path,
              operation: failure.operation,
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    );

    const completedAt = new Date();
    const retryResult: SyncStats = {
      uploaded,
      deleted,
      skipped: 0,
      failed: failures.length,
      total: stored.failures.length,
      failures
    };

    const nextStored = await this.storeResult({
      kind: 'result',
      profileId: resolved.profile.id,
      profileName: `${resolved.profile.name} (retry failed)`,
      hostId: resolved.host.id,
      hostName: resolved.host.name,
      localRoot: resolved.localRoot,
      remoteRoot: resolved.profile.remoteRoot,
      uploaded,
      deleted,
      skipped: 0,
      failed: failures.length,
      failures,
      markdown: this.renderResultMarkdown(resolved, retryResult, startedAt, completedAt)
    });

    await this.addHistoryEntry(resolved, nextStored, startedAt, completedAt);
    await this.openStoredResult(nextStored.id);
    return nextStored;
  }

  private async resolveProfileContext(profileId: string): Promise<ResolvedProfileContext | undefined> {
    const profile = this.deployProfileService.getById(profileId);
    if (!profile) {
      vscode.window.showErrorMessage('Deploy profile not found.');
      return undefined;
    }

    const hosts = await this.hostManager.getHosts();
    const host = hosts.find(item => item.id === profile.hostId);
    if (!host) {
      vscode.window.showErrorMessage(`Host not found for deploy profile "${profile.name}".`);
      return undefined;
    }

    const authConfig = await this.authManager.getAuth(host.id);
    if (!authConfig) {
      vscode.window.showErrorMessage(`Authentication not configured for "${host.name}".`);
      return undefined;
    }

    const localRoot = this.resolveLocalRoot(profile);
    return { profile, host, authConfig, localRoot };
  }

  private resolveLocalRoot(profile: DeployProfile): string {
    if (!profile.localRoot.includes('${workspaceFolder}')) {
      return profile.localRoot;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return profile.localRoot;
    }

    return profile.localRoot.replace('${workspaceFolder}', folders[0].uri.fsPath);
  }

  private renderPreviewMarkdown(resolved: ResolvedProfileContext, preview: SyncPreview): string {
    const lines = [
      `# Sync Preview: ${resolved.profile.name}`,
      '',
      `- Host: ${resolved.host.name}`,
      `- Local root: \`${resolved.localRoot}\``,
      `- Remote root: \`${resolved.profile.remoteRoot}\``,
      `- Compare method: \`${resolved.profile.compareMethod}\``,
      `- Sync mode: \`${resolved.profile.syncMode}\``,
      `- Delete remote extras: ${resolved.profile.syncMode === 'mirrorLocal' && resolved.profile.deleteRemote ? 'Yes' : 'No'}`,
      '',
      '## Summary',
      '',
      `- Upload: ${preview.diff.toUpload.length}`,
      `- Delete: ${preview.diff.toDelete.length}`,
      `- Skip: ${preview.diff.unchanged.length}`,
      '',
      '## Upload',
      '',
      ...this.renderActionList(preview.diff.toUpload.map(item => `- \`${item.path}\` (${item.reason})`), '- None'),
      '',
      '## Delete',
      '',
      ...this.renderActionList(preview.diff.toDelete.map(item => `- \`${item.path}\` (${item.reason})`), '- None'),
      '',
      '## Unchanged',
      '',
      ...this.renderActionList(preview.diff.unchanged.map(item => `- \`${item}\``), '- None'),
      ''
    ];

    return lines.join('\n');
  }

  private renderResultMarkdown(
    resolved: ResolvedProfileContext,
    result: SyncStats,
    startedAt: Date,
    completedAt: Date
  ): string {
    const lines = [
      `# Sync Result: ${resolved.profile.name}`,
      '',
      `- Host: ${resolved.host.name}`,
      `- Local root: \`${resolved.localRoot}\``,
      `- Remote root: \`${resolved.profile.remoteRoot}\``,
      `- Started: ${startedAt.toLocaleString()}`,
      `- Completed: ${completedAt.toLocaleString()}`,
      `- Duration: ${completedAt.getTime() - startedAt.getTime()} ms`,
      '',
      '## Summary',
      '',
      `- Uploaded: ${result.uploaded}`,
      `- Deleted: ${result.deleted}`,
      `- Skipped: ${result.skipped}`,
      `- Failed: ${result.failed}`,
      '',
      '## Failed Items',
      '',
      ...this.renderActionList(
        (result.failures || []).map(item => `- \`${item.path}\` [${item.operation}] ${item.message}`),
        '- None'
      ),
      ''
    ];

    return lines.join('\n');
  }

  private renderActionList(items: string[], fallback: string): string[] {
    return items.length > 0 ? items : [fallback];
  }

  private async addHistoryEntry(
    resolved: ResolvedProfileContext,
    stored: StoredSyncResult,
    startedAt: Date,
    completedAt: Date
  ): Promise<void> {
    const task = new TransferTaskModel({
      type: 'upload',
      operationKind: 'sync',
      hostId: resolved.host.id,
      hostName: resolved.host.name,
      localPath: resolved.localRoot,
      remotePath: resolved.profile.remoteRoot,
      fileName: `Sync ${stored.profileName}`,
      fileSize: 0,
      isDirectory: true,
      syncSummary: {
        resultId: stored.id,
        profileId: resolved.profile.id,
        profileName: resolved.profile.name,
        uploaded: stored.uploaded,
        deleted: stored.deleted,
        skipped: stored.skipped,
        failed: stored.failed
      }
    });

    task.createdAt = startedAt;
    task.start();
    task.startedAt = startedAt;

    if (stored.failed > 0) {
      task.fail(`${stored.failed} sync item(s) failed`);
    } else {
      task.complete();
    }

    task.completedAt = completedAt;
    await this.historyService.addToHistory(task);
  }

  private getStoredResults(): StoredSyncResult[] {
    return this.context.globalState.get<StoredSyncResult[]>(DeploySyncService.STORAGE_KEY, []);
  }

  private async storeResult(result: Omit<StoredSyncResult, 'id' | 'createdAt'>): Promise<StoredSyncResult> {
    const storedResults = this.getStoredResults().filter(item => !(item.profileId === result.profileId && item.kind === result.kind));
    const stored: StoredSyncResult = {
      ...result,
      id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
    };

    storedResults.unshift(stored);
    await this.context.globalState.update(
      DeploySyncService.STORAGE_KEY,
      storedResults.slice(0, DeploySyncService.MAX_STORED_RESULTS)
    );

    logger.info(`[DeploySync] Stored ${stored.kind} result for profile ${stored.profileName}`);
    return stored;
  }
}
