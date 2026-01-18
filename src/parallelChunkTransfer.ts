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

    // Send initial progress to set the total file size in the task
    if (onProgress) {
      onProgress(0, fileSize);
    }

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
      try {
        await this.mergeChunksOnRemote(config, authConfig, remotePath, chunks.length);

        logger.info(`Merge completed. Sending final progress update...`);
        // Send final 100% progress after merge completes
        if (onProgress) {
          onProgress(fileSize, fileSize);
          logger.info(`Final progress sent: ${fileSize}/${fileSize} bytes (100%)`);
        }
      } catch (mergeError: any) {
        // Remote merge failed, cleanup chunks and use normal upload as fallback
        logger.warn(`Remote merge failed: ${mergeError.message}`);
        logger.info('Cleaning up remote chunks...');
        await this.cleanupPartialChunks(config, authConfig, remotePath, chunks.length);

        logger.info('Falling back to normal single-file upload...');
        // Use normal upload (fastPut) as fallback
        const connectConfig = this.buildConnectConfig(config, authConfig);
        const { sftpClient } = await this.connectionPool.getConnection(config, authConfig, connectConfig);

        try {
          let lastProgressTime = 0;
          await sftpClient.fastPut(localPath, remotePath, {
            step: (transferred: number, _chunk: any, total: number) => {
              const now = Date.now();
              if (now - lastProgressTime >= 100) {
                if (onProgress) {
                  onProgress(transferred, total);
                }
                lastProgressTime = now;
              }
            }
          });

          // Final progress
          if (onProgress) {
            onProgress(fileSize, fileSize);
            logger.info(`Final progress sent: ${fileSize}/${fileSize} bytes (100%)`);
          }

          logger.info('✓ Fallback upload completed successfully');
        } finally {
          this.connectionPool.releaseConnection(config);
        }
      }

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
    const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
    logger.info(`Downloading ${path.basename(remotePath)} in ${chunks.length} chunks with ${opts.maxConcurrent} concurrent transfers`);
    logger.info(`File size: ${fileSize} bytes (${fileSizeMB}MB)`);

    // Send initial progress to set the total file size in the task
    if (onProgress) {
      logger.info(`Sending initial progress: 0/${fileSize} bytes`);
      onProgress(0, fileSize);
    }

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

      // Send final 100% progress after merge completes
      if (onProgress) {
        onProgress(fileSize, fileSize);
      }

      logger.info(`✓ Successfully downloaded ${path.basename(remotePath)} using parallel transfer`);
    } catch (error: any) {
      // Clean up partial chunks
      await this.cleanupLocalChunks(localPath, chunks.length);
      throw error;
    }
  }

  /**
   * Process chunks in batches with concurrency control
   * Uses a sliding window approach to maintain maxConcurrent tasks running at all times
   */
  private async processBatches<T>(
    items: T[],
    maxConcurrent: number,
    processor: (item: T) => Promise<void>
  ): Promise<void> {
    let index = 0;
    const executing: Promise<void>[] = [];

    while (index < items.length) {
      // Start new tasks up to maxConcurrent
      while (executing.length < maxConcurrent && index < items.length) {
        const item = items[index++];
        const promise = processor(item).then(() => {
          // Remove from executing array when done
          const idx = executing.indexOf(promise);
          if (idx > -1) {
            executing.splice(idx, 1);
          }
        });
        executing.push(promise);
      }

      // Wait for at least one task to complete before starting new ones
      if (executing.length > 0) {
        await Promise.race(executing);
      }
    }

    // Wait for all remaining tasks to complete
    await Promise.all(executing);
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

    // Create a temporary file for this chunk locally
    const localChunkPath = path.join(os.tmpdir(), `upload_chunk_${Date.now()}_${chunk.index}`);

    // Get connection from pool
    const connectConfig = this.buildConnectConfig(config, authConfig);
    const { sftpClient } = await this.connectionPool.getConnection(config, authConfig, connectConfig);

    try {
      // Check for abort
      if (signal?.aborted) {
        throw new Error('Transfer aborted');
      }

      // Extract chunk data to temporary file
      const readStream = fs.createReadStream(localPath, {
        start: chunk.start,
        end: chunk.end
      });
      const writeStream = fs.createWriteStream(localChunkPath);

      await new Promise((resolve, reject) => {
        readStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
        readStream.pipe(writeStream);
      });

      // Upload chunk file using fastPut (more reliable than streams)
      let lastProgressTime = 0;
      await sftpClient.fastPut(localChunkPath, chunkPath, {
        step: (transferred: number, _chunk: any, _total: number) => {
          const now = Date.now();
          // Throttle progress updates
          if (now - lastProgressTime >= 100) {
            onProgress(transferred);
            lastProgressTime = now;
          }

          if (signal?.aborted) {
            throw new Error('Transfer aborted');
          }
        }
      });

      // Final progress update
      onProgress(chunk.size);

      // Cleanup local temp chunk
      fs.unlinkSync(localChunkPath);
    } catch (error) {
      // Cleanup on error
      if (fs.existsSync(localChunkPath)) {
        fs.unlinkSync(localChunkPath);
      }
      throw error;
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
    const { client } = await this.connectionPool.getConnection(config, authConfig, connectConfig);

    try {
      // Build merge command
      const fileName = path.basename(remotePath);
      const parts = Array.from({ length: totalChunks }, (_, i) => `"/tmp/${fileName}.part${i}"`).join(' ');
      const command = `cat ${parts} > "${remotePath}" && rm ${parts}`;

      logger.debug(`Merging chunks on remote: ${command}`);

      // Execute merge command using SSH exec with timeout
      const execPromise = new Promise<void>((resolve, reject) => {
        client.exec(command, (err, stream) => {
          if (err) {
            logger.error(`SSH exec failed: ${err.message}`);
            reject(new Error(`SSH exec not supported: ${err.message}`));
            return;
          }

          let stderr = '';
          let stdout = '';

          // Must consume stdout and stderr to prevent blocking
          stream.on('data', (data: Buffer) => {
            stdout += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          stream.on('close', (code: number) => {
            logger.debug(`Remote command exited with code ${code}`);
            if (stdout) {
              logger.debug(`stdout: ${stdout}`);
            }
            if (stderr) {
              logger.debug(`stderr: ${stderr}`);
            }

            if (code === 0) {
              logger.info(`✓ Chunks merged successfully on remote server`);
              resolve();
            } else {
              const errorMsg = `Remote merge failed with exit code ${code}: ${stderr || 'unknown error'}`;
              logger.error(errorMsg);
              reject(new Error(errorMsg));
            }
          });

          stream.on('error', (streamErr: Error) => {
            logger.error(`Stream error during merge: ${streamErr.message}`);
            reject(streamErr);
          });
        });
      });

      // Add timeout for remote merge (5 minutes should be enough for cat + rm)
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Remote merge timeout after 5 minutes'));
        }, 5 * 60 * 1000);
      });

      await Promise.race([execPromise, timeoutPromise]);
    } finally {
      this.connectionPool.releaseConnection(config);
    }
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

    try {
      for (let i = 0; i < totalChunks; i++) {
        // Read from temp directory
        const chunkPath = path.join(tempDir, `${fileName}.part${i}`);

        // Use a promise that resolves when the chunk is fully written
        await new Promise<void>((resolve, reject) => {
          const readStream = fs.createReadStream(chunkPath);

          readStream.on('error', reject);
          writeStream.on('error', reject);

          // For last chunk, let pipe close the writeStream
          // For other chunks, keep writeStream open
          readStream.pipe(writeStream, { end: i === totalChunks - 1 });

          // Wait for readStream to finish reading
          readStream.on('end', () => {
            // Give pipe a moment to flush
            setImmediate(() => resolve());
          });
        });

        // Delete chunk from temp directory after merging
        try {
          fs.unlinkSync(chunkPath);
          logger.debug(`Merged and deleted chunk ${i + 1}/${totalChunks} from temp directory`);
        } catch (unlinkError) {
          logger.warn(`Failed to delete chunk ${i}: ${unlinkError}`);
        }
      }

      // Wait for writeStream to finish
      if (!writeStream.closed) {
        await new Promise<void>((resolve, reject) => {
          writeStream.on('finish', () => {
            logger.debug('WriteStream finished event received');
            resolve();
          });
          writeStream.on('close', () => {
            logger.debug('WriteStream close event received');
            resolve();
          });
          writeStream.on('error', reject);

          // If writeStream is not already ending, end it now
          if (!writeStream.writableEnded) {
            logger.debug('Explicitly ending writeStream');
            writeStream.end();
          }
        });
      }

      logger.info(`✓ Chunks merged successfully locally from temp directory`);
    } catch (error) {
      // Clean up write stream on error
      if (!writeStream.destroyed) {
        writeStream.destroy();
      }
      throw error;
    }
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
          await sftpClient.delete(chunkPath);
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
