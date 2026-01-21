import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Client, ConnectConfig } from 'ssh2';
// @ts-ignore
import SftpClient from 'ssh2-sftp-client';
import { HostConfig, HostAuthConfig } from './types';
import {ChunkProgressCallback, ParallelChunkTransferManager} from './parallelChunkTransfer';
import { SshConnectionPool } from './sshConnectionPool';
import { logger } from './logger';
import { PARALLEL_TRANSFER, DELTA_SYNC, getParallelTransferConfig } from './constants';
import { FileIntegrityChecker } from './services/fileIntegrityChecker';
import { DeltaSyncManager } from './services/deltaSyncManager';
import { AttributePreservingTransfer } from './attributePreservingTransfer';

/**
 * Download file options
 */
export interface DownloadFileOptions {
  onProgress?: (transferred: number, total: number) => void;
  signal?: AbortSignal;
  startOffset?: number;
  onChunkProgress?: ChunkProgressCallback;
}

/**
 * Upload file options
 */
export interface UploadFileOptions {
  onProgress?: (transferred: number, total: number) => void;
  signal?: AbortSignal;
  startOffset?: number;
  onChunkProgress?: ChunkProgressCallback;
}

/**
 * SSH 连接管理器
 */
export class SshConnectionManager {
  private static readonly connectionPool = SshConnectionPool.getInstance();
  private static readonly parallelTransferManager = new ParallelChunkTransferManager();

  /**
   * 使用连接池执行操作
   */
  private static async withConnection<T>(
    config: HostConfig,
    authConfig: HostAuthConfig,
    operation: (sftpClient: SftpClient) => Promise<T>
  ): Promise<T> {
    const connectConfig = this.buildConnectConfig(config, authConfig);
    const { sftpClient } = await this.connectionPool.getConnection(
      config,
      authConfig,
      connectConfig
    );

    try {
      const result = await operation(sftpClient);
      return result;
    } finally {
      // 释放连接回池中
      this.connectionPool.releaseConnection(config);
    }
  }

  /**
   * 测试连接
   */
  static async testConnection(config: HostConfig, authConfig: HostAuthConfig): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const connectConfig = this.buildConnectConfig(config, authConfig);

      conn
        .on('ready', () => {
          conn.end();
          resolve(true);
        })
        .on('error', err => {
          reject(err);
        })
        .connect(connectConfig);

      // 30秒超时
      setTimeout(() => {
        conn.end();
        reject(new Error('连接超时'));
      }, 30000);
    });
  }

  /**
   * 检查是否配置了免密登录
   */
  static async checkPasswordlessLogin(config: HostConfig, authConfig: HostAuthConfig): Promise<boolean> {
    // 如果使用密码认证，肯定不是免密登录
    if (authConfig.authType === 'password') {
      return false;
    }

    try {
        // 尝试使用私钥连接
        await this.testConnection(config, authConfig);
        return true;
      } catch {
        return false;
      }
  }

  /**
   * 列出远程目录（仅目录）
   */
  static async listRemoteDirectory(config: HostConfig, authConfig: HostAuthConfig, remotePath: string): Promise<string[]> {
    return this.withConnection(config, authConfig, async (sftp) => {
      const list = await sftp.list(remotePath);
      const directories = list
        .filter((item: any) => item.type === 'd' && item.name !== '.' && item.name !== '..')
        .map((item: any) => item.name);

      return directories;
    });
  }

  /**
   * 列出远程目录（包含文件和文件夹）
   */
  static async listRemoteFiles(config: HostConfig, authConfig: HostAuthConfig, remotePath: string): Promise<Array<{name: string, type: 'file' | 'directory', size: number, mode?: number, permissions?: string, owner?: number, group?: number}>> {
    return this.withConnection(config, authConfig, async (sftp) => {
      const list = await sftp.list(remotePath);

      // Get detailed stats for each item
      const itemsWithStats = await Promise.all(
        list
          .filter((item: any) => item.name !== '.' && item.name !== '..')
          .map(async (item: any) => {
            const itemPath = `${remotePath}/${item.name}`.replaceAll('//', '/');
            try {
              const stats = await sftp.stat(itemPath);
              logger.debug(`File: ${item.name}, stats mode: ${stats.mode}, type: ${stats.type}`);
              return {
                name: item.name,
                type: (stats.type === 'd' || item.type === 'd') ? 'directory' as const : 'file' as const,
                size: stats.size || item.size || 0,
                mode: stats.mode,
                permissions: stats.mode ? this.formatPermissions(stats.mode) : undefined,
                owner: stats.uid,
                group: stats.gid
              };
            } catch (error) {
              // Fallback to basic info if stat fails
              logger.warn(`Failed to get stats for ${item.name}: ${error}`);
              return {
                name: item.name,
                type: item.type === 'd' ? 'directory' as const : 'file' as const,
                size: item.size || 0,
                mode: undefined,
                permissions: undefined,
                owner: undefined,
                group: undefined
              };
            }
          })
      );

      return itemsWithStats;
    });
  }

  /**
   * Format Unix file mode to rwx string
   * @param mode Unix file mode (e.g., 0o100644)
   * @returns Permission string (e.g., "rw-r--r--")
   */
  private static formatPermissions(mode: number): string {
    return [
      // User permissions
      (mode & 0o400) ? 'r' : '-',
      (mode & 0o200) ? 'w' : '-',
      (mode & 0o100) ? 'x' : '-',
      // Group permissions
      (mode & 0o040) ? 'r' : '-',
      (mode & 0o020) ? 'w' : '-',
      (mode & 0o010) ? 'x' : '-',
      // Other permissions
      (mode & 0o004) ? 'r' : '-',
      (mode & 0o002) ? 'w' : '-',
      (mode & 0o001) ? 'x' : '-'
    ].join('');
  }

  /**
   * 上传文件
   */
  static async uploadFile(
    config: HostConfig,
    authConfig: HostAuthConfig,
    localPath: string,
    remotePath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal,
    startOffset: number = 0
  ): Promise<void> {
    // Check if we should use parallel transfer
    logger.info(`Upload check - File: ${path.basename(localPath)}, Offset: ${startOffset}`);

    if (PARALLEL_TRANSFER.ENABLED && startOffset === 0) {
      const stat = fs.statSync(localPath);
      // Get parallel transfer configuration
      const parallelConfig = getParallelTransferConfig();

      const fileSizeMB = (stat.size / 1024 / 1024).toFixed(2);
      const thresholdMB = (parallelConfig.threshold / 1024 / 1024).toFixed(2);

      logger.info(`Parallel transfer check - File size: ${fileSizeMB}MB, Threshold: ${thresholdMB}MB, Enabled: ${parallelConfig.enabled}`);

      if (parallelConfig.enabled && this.parallelTransferManager.shouldUseParallelTransfer(stat.size, {
        threshold: parallelConfig.threshold
      })) {
        logger.info(`🚀 Using parallel transfer for large file: ${path.basename(localPath)} (${fileSizeMB}MB)`);
        logger.info(`Configuration - Chunk size: ${parallelConfig.chunkSize / 1024 / 1024}MB, Max concurrent: ${parallelConfig.maxConcurrent}`);

        await this.parallelTransferManager.uploadFileParallel(
          config,
          authConfig,
          localPath,
          remotePath,
          {
            chunkSize: parallelConfig.chunkSize,
            maxConcurrent: parallelConfig.maxConcurrent,
            threshold: parallelConfig.threshold,
            onProgress,
            signal
            // onChunkProgress will be added later when connecting to TransferTask
          }
        );

        // Verify file integrity if enabled
        const checksumOptions = FileIntegrityChecker.getOptionsFromConfig();
        if (checksumOptions.enabled) {
          const connectConfig = this.buildConnectConfig(config, authConfig);
          const verified = await FileIntegrityChecker.verifyUpload(
            config,
            authConfig,
            localPath,
            remotePath,
            connectConfig,
            checksumOptions
          );

          if (!verified) {
            throw new Error(
              `File integrity verification failed after parallel upload. ` +
              `The uploaded file may be corrupted. Please try uploading again.`
            );
          }
        }

        // Preserve file attributes if enabled (after parallel upload)
        const attributeOptions = AttributePreservingTransfer.getOptionsFromConfig();
        if (attributeOptions.preservePermissions || attributeOptions.preserveTimestamps) {
          await this.withConnection(config, authConfig, async (sftp) => {
            try {
              await AttributePreservingTransfer.uploadWithAttributes(
                sftp,
                localPath,
                remotePath,
                attributeOptions
              );
            } catch (error) {
              logger.warn(`Failed to preserve attributes for ${remotePath}: ${error}`);
              // Don't fail the upload if attribute preservation fails
            }
          });
        }

        return;
      } else {
        logger.info(`Using standard transfer - File size ${fileSizeMB}MB is below threshold ${thresholdMB}MB`);
      }
    } else {
      if (!PARALLEL_TRANSFER.ENABLED) {
        logger.info(`Parallel transfer disabled in configuration`);
      }
      if (startOffset > 0) {
        logger.info(`Using resume transfer - Starting from offset ${startOffset} bytes`);
      }
    }

    // Use standard transfer for small files or resume
    logger.info(`Using standard upload method for ${path.basename(localPath)}`);
    await this.withConnection(config, authConfig, async (sftp) => {
      // Check if already aborted
      if (signal?.aborted) {
        throw new Error('Transfer aborted');
      }

      // 确保远程目录存在
      const remoteDir = path.dirname(remotePath).replaceAll('\\', '/');
      await sftp.mkdir(remoteDir, true);

      // 如果支持断点续传且有起始偏移量
      if (startOffset > 0) {
        await this.uploadFileWithResume(sftp, localPath, remotePath, startOffset, onProgress, signal);
      } else {
        // 上传文件
        await sftp.fastPut(localPath, remotePath, {
          step: (transferred: number, _chunk: any, total: number) => {
            // Check for abort signal
            if (signal?.aborted) {
              throw new Error('Transfer aborted');
            }

            if (onProgress) {
              onProgress(transferred, total);
            }
          },
        });
      }
    });

    // Verify file integrity if enabled
    const checksumOptions = FileIntegrityChecker.getOptionsFromConfig();
    if (checksumOptions.enabled) {
      const connectConfig = this.buildConnectConfig(config, authConfig);
      const verified = await FileIntegrityChecker.verifyUpload(
        config,
        authConfig,
        localPath,
        remotePath,
        connectConfig,
        checksumOptions
      );

      if (!verified) {
        throw new Error(
          `File integrity verification failed after upload. ` +
          `The uploaded file may be corrupted. Please try uploading again.`
        );
      }
    }

    // Preserve file attributes if enabled
    const attributeOptions = AttributePreservingTransfer.getOptionsFromConfig();
    if (attributeOptions.preservePermissions || attributeOptions.preserveTimestamps) {
      await this.withConnection(config, authConfig, async (sftp) => {
        try {
          await AttributePreservingTransfer.uploadWithAttributes(
            sftp,
            localPath,
            remotePath,
            attributeOptions
          );
        } catch (error) {
          logger.warn(`Failed to preserve attributes for ${remotePath}: ${error}`);
          // Don't fail the upload if attribute preservation fails
        }
      });
    }
  }

  /**
   * 断点续传上传文件
   */
  private static async uploadFileWithResume(
    sftp: any,
    localPath: string,
    remotePath: string,
    startOffset: number,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const stat = fs.statSync(localPath);
    const totalSize = stat.size;

    // 创建读取流，从指定位置开始
    const readStream = fs.createReadStream(localPath, {
      start: startOffset,
      highWaterMark: 64 * 1024 // 64KB chunks
    });

    // 创建写入流，追加模式
    const writeStream = sftp.createWriteStream(remotePath, {
      flags: 'a', // append mode
      start: startOffset
    });

    let transferredSinceStart = 0;

    return new Promise((resolve, reject) => {
      readStream.on('data', (chunk: string | Buffer) => {
        const chunkLength = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
        transferredSinceStart += chunkLength;
        const totalTransferred = startOffset + transferredSinceStart;

        if (signal?.aborted) {
          readStream.destroy();
          writeStream.destroy();
          reject(new Error('Transfer aborted'));
          return;
        }

        if (onProgress) {
          onProgress(totalTransferred, totalSize);
        }
      });

      readStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);

      readStream.pipe(writeStream);
    });
  }

  /**
   * 上传文件夹
   */
  static async uploadDirectory(
    config: HostConfig,
    authConfig: HostAuthConfig,
    localPath: string,
    remotePath: string,
    onProgress?: (currentFile: string, progress: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return this.withConnection(config, authConfig, async (sftp) => {
      // Check if delta sync is enabled
      if (DELTA_SYNC.ENABLED) {
        logger.info(`Using delta sync for directory upload: ${localPath} → ${remotePath}`);

        const stats = await DeltaSyncManager.syncDirectory(
          sftp,
          localPath,
          remotePath,
          {
            compareMethod: DELTA_SYNC.COMPARE_METHOD,
            deleteRemote: DELTA_SYNC.DELETE_REMOTE,
            preserveTimestamps: DELTA_SYNC.PRESERVE_TIMESTAMPS,
            excludePatterns: [...DELTA_SYNC.EXCLUDE_PATTERNS],
            onProgress: (current, total, currentFile) => {
              if (signal?.aborted) {
                throw new Error('Transfer aborted');
              }

              if (onProgress) {
                const progress = Math.round((current / total) * 100);
                onProgress(currentFile, progress);
              }
            }
          }
        );

        logger.info(
          `Delta sync completed - Uploaded: ${stats.uploaded}, Deleted: ${stats.deleted}, ` +
          `Skipped: ${stats.skipped}, Failed: ${stats.failed}, Total: ${stats.total}`
        );

        return;
      }

      // Fallback to traditional full upload
      logger.info(`Using traditional full upload for directory: ${localPath} → ${remotePath}`);

      // 获取所有文件
      const files = this.getAllFiles(localPath);
      const totalFiles = files.length;
      let uploadedFiles = 0;

      for (const file of files) {
        // Check for abort signal
        if (signal?.aborted) {
          throw new Error('Transfer aborted');
        }

        const relativePath = path.relative(localPath, file);
        const remoteFilePath = path.join(remotePath, relativePath).replaceAll('\\', '/');
        const remoteDir = path.dirname(remoteFilePath).replaceAll('\\', '/');

        // 确保远程目录存在
        await sftp.mkdir(remoteDir, true);

        // 上传文件
        await sftp.fastPut(file, remoteFilePath);
        uploadedFiles++;

        if (onProgress) {
          const progress = Math.round((uploadedFiles / totalFiles) * 100);
          onProgress(relativePath, progress);
        }
      }
    });
  }

  /**
   * 下载文件
   */
  static async downloadFile(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string,
    localPath: string,
    options?: DownloadFileOptions
  ): Promise<void> {
    const {
      onProgress,
      signal,
      startOffset = 0,
      onChunkProgress
    } = options || {};
    // Check if we should use parallel transfer
    logger.info(`Download check - File: ${path.basename(remotePath)}, Offset: ${startOffset}`);

    // Get parallel transfer configuration
    const parallelConfig = getParallelTransferConfig();

    if (parallelConfig.enabled && startOffset === 0) {
      // Get remote file size first
      const stat = await this.withConnection(config, authConfig, async (sftp) => {
        return sftp.stat(remotePath);
      });

      const fileSizeMB = (stat.size / 1024 / 1024).toFixed(2);
      const thresholdMB = (parallelConfig.threshold / 1024 / 1024).toFixed(2);

      logger.info(`Parallel transfer check - File size: ${fileSizeMB}MB, Threshold: ${thresholdMB}MB, Enabled: ${parallelConfig.enabled}`);

      if (this.parallelTransferManager.shouldUseParallelTransfer(stat.size, {
        threshold: parallelConfig.threshold
      })) {
        logger.info(`🚀 Using parallel transfer for large file: ${path.basename(remotePath)} (${fileSizeMB}MB)`);
        logger.info(`Configuration - Chunk size: ${parallelConfig.chunkSize / 1024 / 1024}MB, Max concurrent: ${parallelConfig.maxConcurrent}`);

        await this.parallelTransferManager.downloadFileParallel(
          config,
          authConfig,
          remotePath,
          localPath,
          {
            chunkSize: parallelConfig.chunkSize,
            maxConcurrent: parallelConfig.maxConcurrent,
            threshold: parallelConfig.threshold,
            onProgress,
            signal,
            onChunkProgress
          }
        );

        // Verify file integrity if enabled
        const checksumOptions = FileIntegrityChecker.getOptionsFromConfig();
        if (checksumOptions.enabled) {
          const connectConfig = this.buildConnectConfig(config, authConfig);
          const verified = await FileIntegrityChecker.verifyDownload(
            config,
            authConfig,
            remotePath,
            localPath,
            connectConfig,
            checksumOptions
          );

          if (!verified) {
            throw new Error(
              `File integrity verification failed after parallel download. ` +
              `The downloaded file may be corrupted. Please try downloading again.`
            );
          }
        }

        // Preserve file attributes if enabled (after parallel download)
        logger.info(`✅ Parallel download completed successfully for: ${remotePath}`);
        const attributeOptions = AttributePreservingTransfer.getOptionsFromConfig();
        logger.info(`Attribute preservation options: ${JSON.stringify(attributeOptions)}`);
        if (attributeOptions.preservePermissions || attributeOptions.preserveTimestamps) {
          logger.info(`Starting attribute preservation for ${localPath}...`);
          await this.withConnection(config, authConfig, async (sftp) => {
            try {
              await AttributePreservingTransfer.downloadWithAttributes(
                sftp,
                remotePath,
                localPath,
                attributeOptions
              );
              logger.info(`✅ Attributes preserved successfully for ${localPath}`);
            } catch (error) {
              logger.warn(`Failed to preserve attributes for ${localPath}: ${error}`);
              // Don't fail the download if attribute preservation fails
            }
          });
        }

        logger.info(`🎯 About to return from downloadFile after parallel download: ${remotePath}`);
        return;
      } else {
        logger.info(`Using standard transfer - File size ${fileSizeMB}MB is below threshold ${thresholdMB}MB`);
      }
    } else {
      if (!PARALLEL_TRANSFER.ENABLED) {
        logger.info(`Parallel transfer disabled in configuration`);
      }
      if (startOffset > 0) {
        logger.info(`Using resume transfer - Starting from offset ${startOffset} bytes`);
      }
    }

    // Use standard transfer for small files or resume
    logger.info(`Using standard download method for ${path.basename(remotePath)}`);
    await this.withConnection(config, authConfig, async (sftp) => {
      // Check if already aborted
      if (signal?.aborted) {
        throw new Error('Transfer aborted');
      }

      // 确保本地目录存在
      const localDir = path.dirname(localPath);
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }

      // 如果支持断点续传且有起始偏移量
      if (startOffset > 0) {
        await this.downloadFileWithResume(sftp, remotePath, localPath, startOffset, onProgress, signal);
      } else {
        // 下载文件
        await sftp.fastGet(remotePath, localPath, {
          step: (transferred: number, _chunk: any, total: number) => {
            // Check for abort signal
            if (signal?.aborted) {
              throw new Error('Transfer aborted');
            }

            if (onProgress) {
              onProgress(transferred, total);
            }
          },
        });
      }
    });

    // Verify file integrity if enabled
    const checksumOptions = FileIntegrityChecker.getOptionsFromConfig();
    if (checksumOptions.enabled) {
      const connectConfig = this.buildConnectConfig(config, authConfig);
      const verified = await FileIntegrityChecker.verifyDownload(
        config,
        authConfig,
        remotePath,
        localPath,
        connectConfig,
        checksumOptions
      );

      if (!verified) {
        throw new Error(
          `File integrity verification failed after download. ` +
          `The downloaded file may be corrupted. Please try downloading again.`
        );
      }
    }

    // Preserve file attributes if enabled
    const attributeOptions = AttributePreservingTransfer.getOptionsFromConfig();
    if (attributeOptions.preservePermissions || attributeOptions.preserveTimestamps) {
      await this.withConnection(config, authConfig, async (sftp) => {
        try {
          await AttributePreservingTransfer.downloadWithAttributes(
            sftp,
            remotePath,
            localPath,
            attributeOptions
          );
        } catch (error) {
          logger.warn(`Failed to preserve attributes for ${localPath}: ${error}`);
          // Don't fail the download if attribute preservation fails
        }
      });
    }
  }

  /**
   * 断点续传下载文件
   */
  private static async downloadFileWithResume(
    sftp: any,
    remotePath: string,
    localPath: string,
    startOffset: number,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const stat = await sftp.stat(remotePath);
    const totalSize = stat.size;

    // 创建读取流，从指定位置开始
    const readStream = sftp.createReadStream(remotePath, {
      start: startOffset,
      highWaterMark: 64 * 1024 // 64KB chunks
    });

    // 创建写入流，追加模式
    const writeStream = fs.createWriteStream(localPath, {
      flags: 'a', // append mode
      start: startOffset
    });

    let transferredSinceStart = 0;

    return new Promise((resolve, reject) => {
      readStream.on('data', (chunk: string | Buffer) => {
        const chunkLength = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
        transferredSinceStart += chunkLength;
        const totalTransferred = startOffset + transferredSinceStart;

        if (signal?.aborted) {
          readStream.destroy();
          writeStream.destroy();
          reject(new Error('Transfer aborted'));
          return;
        }

        if (onProgress) {
          onProgress(totalTransferred, totalSize);
        }
      });

      readStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);

      readStream.pipe(writeStream);
    });
  }

  /**
   * 下载文件夹
   */
  static async downloadDirectory(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string,
    localPath: string,
    onProgress?: (currentFile: string, progress: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return this.withConnection(config, authConfig, async (sftp) => {
      // 获取所有远程文件
      const files = await this.getAllRemoteFiles(sftp, remotePath);
      const totalFiles = files.length;
      let downloadedFiles = 0;

      for (const file of files) {
        // Check for abort signal
        if (signal?.aborted) {
          throw new Error('Transfer aborted');
        }

        const relativePath = file.replace(remotePath, '').replace(/^\//, '');
        const localFilePath = path.join(localPath, relativePath);
        const localFileDir = path.dirname(localFilePath);

        // 确保本地目录存在
        if (!fs.existsSync(localFileDir)) {
          fs.mkdirSync(localFileDir, { recursive: true });
        }

        // 下载文件
        await sftp.fastGet(file, localFilePath);
        downloadedFiles++;

        if (onProgress) {
          const progress = Math.round((downloadedFiles / totalFiles) * 100);
          onProgress(relativePath, progress);
        }
      }
    });
  }

  /**
   * Create a remote folder
   */
  static async createRemoteFolder(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string
  ): Promise<void> {
    return this.withConnection(config, authConfig, async (sftp) => {
      await sftp.mkdir(remotePath, true);
      logger.info(`Created remote folder: ${remotePath}`);
    });
  }

  /**
   * Rename a remote file or folder
   */
  static async renameRemoteFile(
    config: HostConfig,
    authConfig: HostAuthConfig,
    oldPath: string,
    newPath: string
  ): Promise<void> {
    return this.withConnection(config, authConfig, async (sftp) => {
      await sftp.rename(oldPath, newPath);
      logger.info(`Renamed remote file: ${oldPath} → ${newPath}`);
    });
  }

  /**
   * Delete a remote file or directory
   */
  static async deleteRemoteFile(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string
  ): Promise<void> {
    return this.withConnection(config, authConfig, async (sftp) => {
      try {
        // Check if path exists
        const stats = await sftp.stat(remotePath);
        logger.info(`Deleting remote path: ${remotePath}, mode: ${stats.mode}, isDirectory: ${stats.isDirectory}`);

        // Check if it's a directory
        const isDirectory = stats.isDirectory;

        logger.info(`Determined isDirectory: ${isDirectory} for ${remotePath}`);

        if (isDirectory) {
          // Delete directory recursively
          logger.info(`Path is directory, using recursive delete: ${remotePath}`);
          await this.deleteRemoteDirectory(sftp, remotePath);
        } else {
          // Delete single file
          logger.info(`Path is file, using delete: ${remotePath}`);
          await sftp.delete(remotePath);
          logger.info(`Deleted remote file: ${remotePath}`);
        }
      } catch (error: any) {
        logger.error(`Error in deleteRemoteFile for ${remotePath}:`, error);

        // Check if file doesn't exist (different SFTP servers may use different error codes/messages)
        const errorMessage = String(error.message || error);
        if (errorMessage.includes('No such file') ||
            errorMessage.includes('ENOENT') ||
            error.code === 2 ||
            error.code === 'ENOENT') {
          logger.warn(`File/directory does not exist: ${remotePath}, treating as success`);
          return; // File doesn't exist, that's ok
        }

        // Re-throw other errors with more context
        throw new Error(`Failed to delete ${remotePath}: ${errorMessage}`);
      }
    });
  }

  /**
   * Delete a remote directory recursively
   */
  private static async deleteRemoteDirectory(sftp: any, remotePath: string): Promise<void> {
    logger.info(`Starting to delete remote directory: ${remotePath}`);

    try {
      const files = await this.getAllRemoteFiles(sftp, remotePath);
      logger.info(`Found ${files.length} files to delete in ${remotePath}`);

      // Delete all files first
      for (const file of files) {
        try {
          logger.debug(`Deleting file: ${file}`);
          await sftp.delete(file);
          logger.debug(`Deleted file successfully: ${file}`);
        } catch (error: any) {
          logger.error(`Failed to delete file ${file}: ${error.message}`);
          throw new Error(`Failed to delete file ${file}: ${error.message}`);
        }
      }

      // Get all directories
      const dirs: string[] = [];
      logger.debug(`Reading directory structure: ${remotePath}`);
      const items = await sftp.list(remotePath);  // Use list() not readdir()
      logger.debug(`Found ${items.length} items in ${remotePath}`);

      for (const item of items) {
        const fullPath = `${remotePath}/${item.name}`.replaceAll('//', '/');
        logger.debug(`Checking item: ${fullPath}`);
        const stats = await sftp.stat(fullPath);

        // Check if it's a directory
        const isDirectory = (stats.type === 'd');
        logger.debug(`Item ${fullPath} is ${isDirectory ? 'directory' : 'file'}`);

        if (isDirectory) {
          dirs.push(fullPath);
        }
      }

      logger.info(`Found ${dirs.length} subdirectories to delete`);

      // Sort directories by depth (deepest first)
      dirs.sort((a, b) => b.split('/').length - a.split('/').length);

      // Delete directories from deepest to shallowest
      for (const dir of dirs) {
        try {
          logger.debug(`Deleting directory: ${dir}`);
          await sftp.rmdir(dir);
          logger.debug(`Deleted directory successfully: ${dir}`);
        } catch (error: any) {
          logger.error(`Failed to delete directory ${dir}: ${error.message}`);
          throw new Error(`Failed to delete directory ${dir}: ${error.message}`);
        }
      }

      // Finally delete the root directory
      try {
        logger.debug(`Deleting root directory: ${remotePath}`);
        await sftp.rmdir(remotePath);
        logger.info(`Deleted remote directory successfully: ${remotePath}`);
      } catch (error: any) {
        logger.error(`Failed to delete root directory ${remotePath}: ${error.message}`);
        throw new Error(`Failed to delete root directory: ${error.message}`);
      }
    } catch (error: any) {
      logger.error(`Error in deleteRemoteDirectory for ${remotePath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get file stats (including permissions)
   */
  static async getFileStats(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string
  ): Promise<any> {
    return this.withConnection(config, authConfig, async (sftp) => {
      return await sftp.stat(remotePath);
    });
  }

  /**
   * Change file permissions (chmod)
   */
  static async changeFilePermissions(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string,
    mode: number
  ): Promise<void> {
    return this.withConnection(config, authConfig, async (sftp) => {
      await sftp.chmod(remotePath, mode);
      logger.info(`Changed permissions for ${remotePath} to ${mode.toString(8)}`);
    });
  }

  /**
   * 配置免密登录（类似 ssh-copy-id）
   */
  static async setupPasswordlessLogin(
    config: HostConfig,
    authConfig: HostAuthConfig,
    publicKeyPath: string
  ): Promise<void> {
    if (!fs.existsSync(publicKeyPath)) {
      throw new Error('公钥文件不存在');
    }

    const publicKey = fs.readFileSync(publicKeyPath, 'utf-8').trim();

    // 需要使用密码连接来上传公钥
    if (authConfig.authType !== 'password' || !authConfig.password) {
      throw new Error('需要密码才能配置免密登录');
    }

    const conn = new Client();
    return new Promise((resolve, reject) => {
      conn
        .on('ready', () => {
          this.executeAddPublicKeyCommand(conn, publicKey, resolve, reject);
        })
        .on('error', err => {
          reject(err);
        })
        .connect(this.buildConnectConfig(config, authConfig));
    });
  }

  /**
   * 执行添加公钥的命令
   */
  private static executeAddPublicKeyCommand(
    conn: Client,
    publicKey: string,
    resolve: () => void,
    reject: (error: any) => void
  ): void {
    // 执行命令添加公钥到 authorized_keys
    const command = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${publicKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;

    conn.exec(command, (err, stream) => {
      if (err) {
        conn.end();
        reject(err);
        return;
      }

      this.handleStreamOutput(stream, conn, resolve, reject);
    });
  }

  /**
   * 处理流输出
   */
  private static handleStreamOutput(
    stream: any,
    conn: Client,
    resolve: () => void,
    reject: (error: any) => void
  ): void {
    stream
      .on('close', () => {
        conn.end();
        resolve();
      })
      .on('data', (data: Buffer) => {
        logger.debug(`STDOUT: ${data.toString()}`);
      })
      .stderr.on('data', (data: Buffer) => {
        logger.error(`STDERR: ${data.toString()}`);
      });
  }

  /**
   * 构建连接配置
   */
  private static buildConnectConfig(config: HostConfig, authConfig: HostAuthConfig): ConnectConfig {
    const connectConfig: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: 30000,        // 30 seconds timeout for initial connection
      keepaliveInterval: 10000,   // Send keepalive every 10 seconds
      keepaliveCountMax: 3,       // Disconnect after 3 failed keepalive attempts
    };

    if (authConfig.authType === 'password' && authConfig.password) {
      connectConfig.password = authConfig.password;
    } else if (authConfig.authType === 'privateKey' && authConfig.privateKeyPath) {
      const privateKeyPath = authConfig.privateKeyPath.replace('~', os.homedir());
      if (fs.existsSync(privateKeyPath)) {
        connectConfig.privateKey = fs.readFileSync(privateKeyPath);
        if (authConfig.passphrase) {
          connectConfig.passphrase = authConfig.passphrase;
        }
      }
    } else if (authConfig.authType === 'agent') {
      // SSH Agent support
      // On Windows, try named pipe first, then environment variable
      // On Unix, use SSH_AUTH_SOCK environment variable
      if (process.platform === 'win32') {
        // Windows: Try named pipe for SSH Agent
        const agentPath = String.raw`\\.\pipe\openssh-ssh-agent`;
        connectConfig.agent = agentPath;
      } else {
        // Unix/WSL: Use SSH_AUTH_SOCK
        if (!process.env.SSH_AUTH_SOCK) {
          throw new Error(
            'SSH Agent not running. Please start SSH Agent:\n\n' +
            '  eval "$(ssh-agent -s)"\n' +
            '  ssh-add ~/.ssh/id_rsa\n\n' +
            'Or use "Private Key" authentication instead.'
          );
        }
        connectConfig.agent = process.env.SSH_AUTH_SOCK;
      }
    }

    return connectConfig;
  }

  /**
   * 递归获取目录下所有文件
   */
  private static getAllFiles(dirPath: string): string[] {
    const files: string[] = [];
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...this.getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * 递归获取远程目录下所有文件
   */
  private static async getAllRemoteFiles(sftp: any, remotePath: string): Promise<string[]> {
    const files: string[] = [];
    const list = await sftp.list(remotePath);

    for (const item of list) {
      if (item.name === '.' || item.name === '..') {
        continue;
      }

      const fullPath = `${remotePath}/${item.name}`.replaceAll('//', '/');

      if (item.type === 'd') {
        // 递归获取子目录文件
        const subFiles = await this.getAllRemoteFiles(sftp, fullPath);
        files.push(...subFiles);
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }
}
