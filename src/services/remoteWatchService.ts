import * as path from 'node:path';
import * as vscode from 'vscode';
import { AuthManager } from '../authManager';
import { REMOTE_WATCH } from '../constants';
import { HostManager } from '../hostManager';
import { logger } from '../logger';
import { SshConnectionManager } from '../sshConnectionManager';
import { HostAuthConfig, HostConfig } from '../types';

interface RemoteSnapshot {
  size: number;
  mtime: number;
}

export class RemoteWatchService implements vscode.Disposable {
  private snapshots = new Map<string, RemoteSnapshot>();
  private pendingPrompts = new Set<string>();
  private intervalHandle?: NodeJS.Timeout;

  constructor(
    private readonly hostManager: HostManager,
    private readonly authManager: AuthManager
  ) {
    this.startPolling();
  }

  dispose(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    this.snapshots.clear();
    this.pendingPrompts.clear();
  }

  private startPolling(): void {
    const pollInterval = this.getPollInterval();
    this.intervalHandle = setInterval(() => {
      void this.pollDocuments();
    }, pollInterval);
  }

  private async pollDocuments(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const documents = vscode.workspace.textDocuments.filter(document => document.uri.scheme === 'sftp');
    const seenKeys = new Set<string>();

    for (const document of documents) {
      const key = document.uri.toString();
      seenKeys.add(key);

      try {
        const resolved = await this.resolveRemoteDocument(document.uri);
        if (!resolved) {
          continue;
        }

        const remoteStat = await SshConnectionManager.getRemoteFileStat(
          resolved.host,
          resolved.authConfig,
          resolved.remotePath
        );

        const snapshot = this.snapshots.get(key);
        if (!snapshot) {
          this.snapshots.set(key, remoteStat);
          continue;
        }

        if (snapshot.mtime === remoteStat.mtime && snapshot.size === remoteStat.size) {
          continue;
        }

        this.snapshots.set(key, remoteStat);
        if (!this.pendingPrompts.has(key)) {
          this.pendingPrompts.add(key);
          void this.handleRemoteChange(document, resolved.host, resolved.authConfig, resolved.remotePath, remoteStat)
            .finally(() => this.pendingPrompts.delete(key));
        }
      } catch (error) {
        logger.debug(`Remote watch skipped ${document.uri.toString()}: ${error}`);
      }
    }

    for (const key of [...this.snapshots.keys()]) {
      if (!seenKeys.has(key)) {
        this.snapshots.delete(key);
        this.pendingPrompts.delete(key);
      }
    }
  }

  private async handleRemoteChange(
    document: vscode.TextDocument,
    host: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string,
    remoteStat: RemoteSnapshot
  ): Promise<void> {
    const fileName = path.posix.basename(remotePath);
    const options = document.isDirty
      ? ['Compare', 'Reload Remote', 'Force Save']
      : ['Reload Remote', 'Compare'];

    const choice = await vscode.window.showWarningMessage(
      document.isDirty
        ? `Remote file changed while ${fileName} has local edits.`
        : `Remote file changed: ${fileName}.`,
      ...options
    );

    if (choice === 'Compare') {
      const remoteContent = await SshConnectionManager.readRemoteFile(host, authConfig, remotePath);
      const remoteDocument = await vscode.workspace.openTextDocument({
        language: document.languageId,
        content: remoteContent.toString('utf8')
      });

      await vscode.commands.executeCommand(
        'vscode.diff',
        remoteDocument.uri,
        document.uri,
        `Remote update: ${fileName}`
      );
      return;
    }

    if (choice === 'Reload Remote') {
      const editor = vscode.window.visibleTextEditors.find(item => item.document === document);
      if (editor) {
        await vscode.window.showTextDocument(editor.document, editor.viewColumn);
      } else {
        await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
      }

      await vscode.commands.executeCommand('workbench.action.files.revert');
      this.snapshots.set(document.uri.toString(), remoteStat);
      return;
    }

    if (choice === 'Force Save') {
      await document.save();
    }
  }

  private async resolveRemoteDocument(uri: vscode.Uri): Promise<{ host: HostConfig; authConfig: HostAuthConfig; remotePath: string } | undefined> {
    const hostId = uri.authority;
    if (!hostId) {
      return undefined;
    }

    const hosts = await this.hostManager.getHosts();
    const host = hosts.find(item => item.id === hostId);
    if (!host) {
      return undefined;
    }

    const authConfig = await this.authManager.getAuth(hostId);
    if (!authConfig) {
      return undefined;
    }

    return {
      host,
      authConfig,
      remotePath: uri.path
    };
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('simpleSftp.remoteWatch')
      .get<boolean>('enabled', REMOTE_WATCH.ENABLED);
  }

  private getPollInterval(): number {
    const configured = vscode.workspace
      .getConfiguration('simpleSftp.remoteWatch')
      .get<number>('pollInterval', REMOTE_WATCH.POLL_INTERVAL);
    return Math.max(2000, configured || REMOTE_WATCH.POLL_INTERVAL);
  }
}
