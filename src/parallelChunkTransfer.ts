import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
// @ts-ignore
import SftpClient from 'ssh2-sftp-client';
import { HostConfig, HostAuthConfig } from './types';
import { SshConnectionPool } from './sshConnectionPool';
import { logger } from './logger';

/**
 * Parallel chunk transfer configuration
 */
interface ChunkTransferOptions {
  chunkSize: number;        // Size of each chunk in bytes
  maxConcurrent: number;    // Maximum concurrent chunk transfers
  threshold: number;        // Minimum file size to use parallel transfer
}

interface Chunk {
  index: number;
  start: number;
  end: number;
  size: number;
}

/**
 * Progress tracking for parallel transfer
 */
interface ChunkProgress {
  [chunkIndex: number]: number; // bytes transferred for each chunk
}

/**
 * Parallel chunk transfer manager
 * Splits large files into chunks and transfers them concurrently
 */
export class ParallelChunkTransferManager {
  private static readonly DEFAULT_OPTIONS: ChunkTransferOptions = {
    chunkSize: 10 * 1024 * 1024,      // 10MB per chunk
    maxConcurrent: 5,                  // 5 concurrent transfers
    threshold: 100 * 1024 * 1024       // Use parallel for files > 100MB
  };

  private connectionPool = SshConnectionPool.getInstance();

  /**
   * Check if file should use parallel transfer
   */
  shouldUseParallelTransfer(fileSize: number, options?: Partial<ChunkTransferOptions>): boolean {
    const threshold = options?.threshold ?? ParallelChunkTransferManager.DEFAULT_OPTIONS.threshold;
    return fileSize >= threshold;
  }

  /**
   * Split file into chunks
   */
  private splitIntoChunks(fileSize: number, chunkSize: number): Chunk[] {
    const chunks: Chunk[] = [];
    let offset = 0;
    let index = 0;

    while (offset < fileSize) {
      const end = Math.min(offset + chunkSize, fileSize);
      chunks.push({
        index,
        start: offset,
        end: end - 1, // inclusive end
        size: end - offset
      });
      offset = end;
      index++;
    }

    return chunks;
  }

  /**
   * Upload file in parallel chunks
   */
  async uploadFileParallel(
    config: HostConfig,
    authConfig: HostAuthConfig,
    localPath: string,
    remotePath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal,
    options?: Partial<ChunkTransferOptions>
  ): Promise<void> {
    const opts = { ...ParallelChunkTransferManager.DEFAULT_OPTIONS, ...options };
    const stat = fs.statSync(localPath);
    const fileSize = stat.size;

    // Split into chunks
    const chunks = this.splitIntoChunks(fileSize, opts.chunkSize);
    const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
    const chunkSizeMB = (opts.chunkSize / 1024 / 1024).toFixed(2);

    logger.info(`📦 Parallel Upload Started`);
    logger.info(`  File: ${path.basename(localPath)} (${fileSizeMB}MB)`);
    logger.info(`  Total chunks: ${chunks.length} (${chunkSizeMB}MB each)`);
    logger.info(`  Max concurrent: ${opts.maxConcurrent} connections`);
    logger.info(`  Remote path: ${remotePath}`);

    // Progress tracking
    const chunkProgress: ChunkProgress = {};
    chunks.forEach(chunk => chunkProgress[chunk.index] = 0);

    const updateProgress = () => {
      const totalTransferred = Object.values(chunkProgress).reduce((sum, val) => sum + val, 0);
      if (onProgress) {
        onProgress(totalTransferred, fileSize);
      }
    };

    try {
      // Upload chunks in batches
      logger.info(`Starting batch upload of ${chunks.length} chunks...`);
      let completedChunks = 0;

      await this.processBatches(
        chunks,
        opts.maxConcurrent,
        async (chunk) => {
          logger.debug(`Uploading chunk ${chunk.index + 1}/${chunks.length} (${(chunk.size / 1024 / 1024).toFixed(2)}MB)`);
          await this.uploadChunk(
            config,
            authConfig,
            localPath,
            remotePath,
            chunk,
            (chunkTransferred) => {
              chunkProgress[chunk.index] = chunkTransferred;
              updateProgress();
            },
            signal
          );
          completedChunks++;
          logger.info(`✓ Chunk ${chunk.index + 1}/${chunks.length} uploaded (${completedChunks}/${chunks.length} complete)`);
        }
      );

      logger.info(`All chunks uploaded successfully. Starting merge...`);
      // Merge chunks on remote server
      await this.mergeChunksOnRemote(config, authConfig, remotePath, chunks.length);

      logger.info(`✓ Successfully uploaded ${path.basename(localPath)} using parallel transfer`);
    } catch (error: any) {
      // Clean up partial chunks
      await this.cleanupPartialChunks(config, authConfig, remotePath, chunks.length);
      throw error;
    }
  }

  /**
   * Download file in parallel chunks
   */
  async downloadFileParallel(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string,
    localPath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal,
    options?: Partial<ChunkTransferOptions>
  ): Promise<void> {
    const opts = { ...ParallelChunkTransferManager.DEFAULT_OPTIONS, ...options };

    // Get remote file size
    const connectConfig = this.buildConnectConfig(config, authConfig);
    const { sftpClient } = await this.connectionPool.getConnection(config, authConfig, connectConfig);
    const stat = await sftpClient.stat(remotePath);
    this.connectionPool.releaseConnection(config);

    const fileSize = stat.size;
    const chunks = this.splitIntoChunks(fileSize, opts.chunkSize);
    logger.info(`Downloading ${path.basename(remotePath)} in ${chunks.length} chunks with ${opts.maxConcurrent} concurrent transfers`);

    // Progress tracking
    const chunkProgress: ChunkProgress = {};
    chunks.forEach(chunk => chunkProgress[chunk.index] = 0);

    const updateProgress = () => {
      const totalTransferred = Object.values(chunkProgress).reduce((sum, val) => sum + val, 0);
      if (onProgress) {
        onProgress(totalTransferred, fileSize);
      }
    };

    try {
      // Download chunks in batches
      logger.info(`Starting batch download of ${chunks.length} chunks...`);
      let completedChunks = 0;

      await this.processBatches(
        chunks,
        opts.maxConcurrent,
        async (chunk) => {
          logger.debug(`Downloading chunk ${chunk.index + 1}/${chunks.length} (${(chunk.size / 1024 / 1024).toFixed(2)}MB)`);
          await this.downloadChunk(
            config,
            authConfig,
            remotePath,
            localPath,
            chunk,
            (chunkTransferred) => {
              chunkProgress[chunk.index] = chunkTransferred;
              updateProgress();
            },
            signal
          );
          completedChunks++;
          logger.info(`✓ Chunk ${chunk.index + 1}/${chunks.length} downloaded (${completedChunks}/${chunks.length} complete)`);
        }
      );

      logger.info(`All chunks downloaded successfully. Starting merge...`);
      // Merge chunks locally
      await this.mergeChunksLocally(localPath, chunks.length);

      logger.info(`✓ Successfully downloaded ${path.basename(remotePath)} using parallel transfer`);
    } catch (error: any) {
      // Clean up partial chunks
      await this.cleanupLocalChunks(localPath, chunks.length);
      throw error;
    }
  }

  /**
   * Process chunks in batches with concurrency control
   */
  private async processBatches<T>(
    items: T[],
    maxConcurrent: number,
    processor: (item: T) => Promise<void>
  ): Promise<void> {
    const results: Promise<void>[] = [];

    for (let i = 0; i < items.length; i += maxConcurrent) {
      const batch = items.slice(i, Math.min(i + maxConcurrent, items.length));
      await Promise.all(batch.map(item => processor(item)));
    }
  }

  /**
   * Upload a single chunk
   */
  private async uploadChunk(
    config: HostConfig,
    authConfig: HostAuthConfig,
    localPath: string,
    remotePath: string,
    chunk: Chunk,
    onProgress: (transferred: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    // Use remote /tmp directory for chunk files
    const fileName = path.basename(remotePath);
    const chunkPath = `/tmp/${fileName}.part${chunk.index}`;

    // Get connection from pool
    const connectConfig = this.buildConnectConfig(config, authConfig);
    const { sftpClient } = await this.connectionPool.getConnection(config, authConfig, connectConfig);

    try {
      // Check for abort
      if (signal?.aborted) {
        throw new Error('Transfer aborted');
      }

      // Create read stream for this chunk
      const readStream = fs.createReadStream(localPath, {
        start: chunk.start,
        end: chunk.end,
        highWaterMark: 64 * 1024
      });

      // Create write stream for chunk
      const writeStream = sftpClient.createWriteStream(chunkPath);

      let transferred = 0;

      return new Promise((resolve, reject) => {
        readStream.on('data', (data: string | Buffer) => {
          const dataLength = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
          transferred += dataLength;
          onProgress(transferred);

          if (signal?.aborted) {
            readStream.destroy();
            writeStream.destroy();
            reject(new Error('Transfer aborted'));
          }
        });

        readStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);

        readStream.pipe(writeStream);
      });
    } finally {
      this.connectionPool.releaseConnection(config);
    }
  }

  /**
   * Download a single chunk
   */
  private async downloadChunk(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string,
    localPath: string,
    chunk: Chunk,
    onProgress: (transferred: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    // Use system temp directory for chunk files to avoid cluttering user's directory
    const tempDir = os.tmpdir();
    const fileName = path.basename(localPath);
    const chunkPath = path.join(tempDir, `${fileName}.part${chunk.index}`);

    // Get connection from pool
    const connectConfig = this.buildConnectConfig(config, authConfig);
    const { sftpClient } = await this.connectionPool.getConnection(config, authConfig, connectConfig);

    try {
      // Check for abort
      if (signal?.aborted) {
        throw new Error('Transfer aborted');
      }

      // Temp directory should always exist, but ensure it
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Create read stream for remote chunk
      const readStream = sftpClient.createReadStream(remotePath, {
        start: chunk.start,
        end: chunk.end + 1, // SFTP end is exclusive
        highWaterMark: 64 * 1024
      });

      // Create write stream for local chunk
      const writeStream = fs.createWriteStream(chunkPath);

      let transferred = 0;

      return new Promise((resolve, reject) => {
        readStream.on('data', (data: string | Buffer) => {
          const dataLength = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
          transferred += dataLength;
          onProgress(transferred);

          if (signal?.aborted) {
            readStream.destroy();
            writeStream.destroy();
            reject(new Error('Transfer aborted'));
          }
        });

        readStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);

        readStream.pipe(writeStream);
      });
    } finally {
      this.connectionPool.releaseConnection(config);
    }
  }

  /**
   * Merge chunks on remote server using SSH exec
   */
  private async mergeChunksOnRemote(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string,
    totalChunks: number
  ): Promise<void> {
    logger.info(`Merging ${totalChunks} chunks on remote server from /tmp directory...`);
    const connectConfig = this.buildConnectConfig(config, authConfig);
    const { sftpClient } = await this.connectionPool.getConnection(config, authConfig, connectConfig);

    try {
      // Build merge command
      const fileName = path.basename(remotePath);
      const parts = Array.from({ length: totalChunks }, (_, i) => `"/tmp/${fileName}.part${i}"`).join(' ');
      const command = `cat ${parts} > "${remotePath}" && rm ${parts}`;

      logger.debug(`Merging chunks on remote: ${command}`);

      // Execute merge command using the underlying SSH connection
      // Note: We need to add exec support to the connection
      // For now, we'll use sequential merge via SFTP
      await this.sequentialMergeRemote(sftpClient, remotePath, totalChunks);

      logger.info(`✓ Chunks merged successfully on remote server from /tmp directory`);
    } finally {
      this.connectionPool.releaseConnection(config);
    }
  }

  /**
   * Sequential merge using SFTP (fallback when SSH exec not available)
   */
  private async sequentialMergeRemote(
    sftp: any,
    remotePath: string,
    totalChunks: number
  ): Promise<void> {
    const fileName = path.basename(remotePath);
    // Create temporary merged file
    const tempPath = `${remotePath}.merging`;
    const writeStream = sftp.createWriteStream(tempPath);

    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = `/tmp/${fileName}.part${i}`;
      const readStream = sftp.createReadStream(chunkPath);

      await new Promise((resolve, reject) => {
        readStream.on('end', resolve);
        readStream.on('error', reject);
        readStream.pipe(writeStream, { end: i === totalChunks - 1 });
      });

      // Delete chunk from /tmp after merging
      await sftp.unlink(chunkPath);
    }

    // Rename merged file to final name
    await sftp.rename(tempPath, remotePath);
  }

  /**
   * Merge chunks locally
   */
  private async mergeChunksLocally(localPath: string, totalChunks: number): Promise<void> {
    logger.info(`Merging ${totalChunks} chunks locally...`);

    // Ensure target directory exists
    const localDir = path.dirname(localPath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    const writeStream = fs.createWriteStream(localPath);
    const tempDir = os.tmpdir();
    const fileName = path.basename(localPath);

    for (let i = 0; i < totalChunks; i++) {
      // Read from temp directory
      const chunkPath = path.join(tempDir, `${fileName}.part${i}`);
      const readStream = fs.createReadStream(chunkPath);

      await new Promise((resolve, reject) => {
        readStream.on('end', () => resolve(undefined));
        readStream.on('error', reject);
        readStream.pipe(writeStream, { end: i === totalChunks - 1 });
      });

      // Delete chunk from temp directory after merging
      fs.unlinkSync(chunkPath);
      logger.debug(`Merged and deleted chunk ${i + 1}/${totalChunks} from temp directory`);
    }

    logger.info(`✓ Chunks merged successfully locally from temp directory`);
  }

  /**
   * Clean up partial chunks on remote
   */
  private async cleanupPartialChunks(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string,
    totalChunks: number
  ): Promise<void> {
    try {
      const connectConfig = this.buildConnectConfig(config, authConfig);
      const { sftpClient } = await this.connectionPool.getConnection(config, authConfig, connectConfig);
      const fileName = path.basename(remotePath);

      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = `/tmp/${fileName}.part${i}`;
        try {
          await sftpClient.unlink(chunkPath);
        } catch {
          // Ignore if chunk doesn't exist
        }
      }

      this.connectionPool.releaseConnection(config);
    } catch (error: any) {
      logger.error(`Failed to cleanup remote chunks from /tmp: ${error.message}`);
    }
  }

  /**
   * Clean up partial chunks locally
   */
  private async cleanupLocalChunks(localPath: string, totalChunks: number): Promise<void> {
    const tempDir = os.tmpdir();
    const fileName = path.basename(localPath);

    for (let i = 0; i < totalChunks; i++) {
      // Clean from temp directory
      const chunkPath = path.join(tempDir, `${fileName}.part${i}`);
      try {
        if (fs.existsSync(chunkPath)) {
          fs.unlinkSync(chunkPath);
          logger.debug(`Cleaned up chunk ${i} from temp directory`);
        }
      } catch (error: any) {
        logger.error(`Failed to cleanup local chunk ${i}: ${error.message}`);
      }
    }
  }

  /**
   * Build connection config (copied from SshConnectionManager)
   */
  private buildConnectConfig(config: HostConfig, authConfig: HostAuthConfig): any {
    const connectConfig: any = {
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
    }

    return connectConfig;
  }
}
