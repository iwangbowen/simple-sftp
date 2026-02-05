import * as vscode from 'vscode';
import * as path from 'node:path';
import { SshConnectionManager } from './sshConnectionManager';
import { HostManager } from './hostManager';
import { AuthManager } from './authManager';
import { HostConfig } from './types';
import { logger } from './logger';

/**
 * SFTP File System Provider
 * Implements VS Code's FileSystemProvider to allow remote files to be edited like local files
 */
export class SftpFileSystemProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private _bufferedEvents: vscode.FileChangeEvent[] = [];
    private _fireSoonHandle?: NodeJS.Timeout;

    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    constructor(
        private readonly hostManager: HostManager,
        private readonly authManager: AuthManager
    ) {}

    // ===== Helper Methods =====

    private async parseUri(uri: vscode.Uri): Promise<{
        host: HostConfig;
        authConfig: any;
        remotePath: string;
    }> {
        // URI format: sftp://hostId/remote/path
        const hostId = uri.authority;
        const remotePath = uri.path;

        if (!hostId) {
            throw new Error('Invalid SFTP URI: missing host ID');
        }

        const hosts = await this.hostManager.getHosts();
        const host = hosts.find(h => h.id === hostId);

        if (!host) {
            throw new Error(`Host not found: ${hostId}`);
        }

        const authConfig = await this.authManager.getAuth(hostId);
        if (!authConfig) {
            throw new Error(`Authentication not configured for host: ${host.name}`);
        }

        return { host, authConfig, remotePath };
    }

    private fireSoon(...events: vscode.FileChangeEvent[]): void {
        this._bufferedEvents.push(...events);

        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle);
        }

        this._fireSoonHandle = setTimeout(() => {
            this._emitter.fire(this._bufferedEvents);
            this._bufferedEvents = [];
        }, 5);
    }

    // ===== Core FileSystemProvider Methods =====

    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        // For now, we don't support file watching
        // TODO: Implement file watching using SFTP events
        return new vscode.Disposable(() => {});
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        logger.debug(`stat: ${uri.toString()}`);
        const { host, authConfig, remotePath } = await this.parseUri(uri);

        try {
            const stats: any = await SshConnectionManager.getFileStats(host, authConfig, remotePath);
            const isDirectory = typeof stats.isDirectory === 'function'
                ? stats.isDirectory()
                : Boolean(stats.isDirectory);
            return {
                type: isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
                ctime: stats.atime || Date.now(),
                mtime: stats.mtime || Date.now(),
                size: stats.size || 0
            };
        } catch (error) {
            logger.error(`stat failed for ${remotePath}: ${error}`);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        logger.debug(`readDirectory: ${uri.toString()}`);
        const { host, authConfig, remotePath } = await this.parseUri(uri);

        try {
            const files = await SshConnectionManager.listRemoteFiles(host, authConfig, remotePath);

            return files.map(file => {
                const fileType = file.type === 'directory'
                    ? vscode.FileType.Directory
                    : vscode.FileType.File;
                return [file.name, fileType] as [string, vscode.FileType];
            });
        } catch (error) {
            logger.error(`readDirectory failed for ${remotePath}: ${error}`);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        logger.debug(`createDirectory: ${uri.toString()}`);
        const { host, authConfig, remotePath } = await this.parseUri(uri);

        try {
            await SshConnectionManager.createRemoteFolder(host, authConfig, remotePath);
            this.fireSoon({ type: vscode.FileChangeType.Created, uri });
        } catch (error) {
            logger.error(`createDirectory failed for ${remotePath}: ${error}`);
            throw vscode.FileSystemError.Unavailable(uri);
        }
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        logger.debug(`readFile: ${uri.toString()}`);
        const { host, authConfig, remotePath } = await this.parseUri(uri);

        try {
            logger.info(`开始读取远程文件: ${remotePath}`);
            const buffer = await SshConnectionManager.readRemoteFile(host, authConfig, remotePath);
            logger.info(`远程文件读取完成: ${remotePath}, 大小: ${buffer.length} bytes`);

            return new Uint8Array(buffer);
        } catch (error) {
            logger.error(`readFile failed for ${remotePath}: ${error}`);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        options: { create: boolean; overwrite: boolean }
    ): Promise<void> {
        logger.debug(`writeFile: ${uri.toString()}, create: ${options.create}, overwrite: ${options.overwrite}`);
        const { host, authConfig, remotePath } = await this.parseUri(uri);

        try {
            // Check if file exists
            let exists = true;
            try {
                await SshConnectionManager.getFileStats(host, authConfig, remotePath);
            } catch {
                exists = false;
            }

            // Handle create/overwrite options
            if (exists && !options.overwrite) {
                throw vscode.FileSystemError.FileExists(uri);
            }
            if (!exists && !options.create) {
                throw vscode.FileSystemError.FileNotFound(uri);
            }

            // Write content to a temporary local file
            const os = await import('node:os');
            const tempFileName = `sftp-temp-${Date.now()}-${path.basename(remotePath)}`;
            const tempPath = path.join(os.tmpdir(), tempFileName);

            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(tempPath),
                content
            );

            try {
                // Upload the file
                await SshConnectionManager.uploadFile(
                    host,
                    authConfig,
                    tempPath,
                    remotePath
                );

                // Fire change event
                const changeType = exists
                    ? vscode.FileChangeType.Changed
                    : vscode.FileChangeType.Created;
                this.fireSoon({ type: changeType, uri });
            } finally {
                // Clean up temp file
                try {
                    await vscode.workspace.fs.delete(vscode.Uri.file(tempPath));
                } catch (error) {
                    logger.warn(`Failed to delete temp file ${tempPath}: ${error}`);
                }
            }
        } catch (error: any) {
            logger.error(`writeFile failed for ${remotePath}: ${error}`);
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            throw vscode.FileSystemError.Unavailable(uri);
        }
    }

    async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
        logger.debug(`delete: ${uri.toString()}, recursive: ${options.recursive}`);
        const { host, authConfig, remotePath } = await this.parseUri(uri);

        try {
            await SshConnectionManager.deleteRemoteFile(host, authConfig, remotePath);
            this.fireSoon({ type: vscode.FileChangeType.Deleted, uri });
        } catch (error) {
            logger.error(`delete failed for ${remotePath}: ${error}`);
            throw vscode.FileSystemError.Unavailable(uri);
        }
    }

    async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
        logger.debug(`rename: ${oldUri.toString()} -> ${newUri.toString()}`);
        const { host, authConfig, remotePath: oldPath } = await this.parseUri(oldUri);
        const { remotePath: newPath } = await this.parseUri(newUri);

        try {
            // Check if target exists
            if (!options.overwrite) {
                try {
                    await SshConnectionManager.getFileStats(host, authConfig, newPath);
                    throw vscode.FileSystemError.FileExists(newUri);
                } catch (error: any) {
                    // File doesn't exist, which is what we want
                    if (error instanceof vscode.FileSystemError) {
                        throw error;
                    }
                }
            }

            await SshConnectionManager.renameRemoteFile(host, authConfig, oldPath, newPath);

            this.fireSoon(
                { type: vscode.FileChangeType.Deleted, uri: oldUri },
                { type: vscode.FileChangeType.Created, uri: newUri }
            );
        } catch (error: any) {
            logger.error(`rename failed: ${error}`);
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            throw vscode.FileSystemError.Unavailable(oldUri);
        }
    }

    /**
     * Dispose the file system provider
     */
    dispose(): void {
        this._emitter.dispose();
        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle);
        }
    }
}
