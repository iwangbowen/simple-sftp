import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import { pipeline } from 'stream/promises';
import type { Client } from 'ssh2';
import { logger } from './logger';

/**
 * Manages intelligent file compression for SFTP transfers.
 *
 * Strategy:
 * 1. SSH connection-level compression for all files (handled in SSH2 config)
 * 2. File-level gzip compression for large compressible files (>50MB text files)
 *
 * Benefits:
 * - 3-10x speedup for text files
 * - 70-90% bandwidth savings
 * - Automatic detection of compressible files
 */
export class CompressionManager {
  private static readonly COMPRESSIBLE_EXTENSIONS = [
    '.txt', '.log', '.json', '.xml', '.csv', '.md', '.yaml', '.yml',
    '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.sass', '.less',
    '.html', '.htm', '.sql', '.sh', '.bash', '.py', '.java', '.c', '.cpp', '.h'
  ];

  private static readonly FILE_COMPRESSION_THRESHOLD = 50 * 1024 * 1024; // 50MB
  private static readonly COMPRESSION_LEVEL = 6; // 1-9, 6 is balanced

  /**
   * Check if a file should use file-level compression.
   * Files must be:
   * 1. Above size threshold (50MB)
   * 2. Have compressible extension (text files)
   */
  static shouldCompressFile(localPath: string, fileSize: number): boolean {
    if (fileSize < this.FILE_COMPRESSION_THRESHOLD) {
      return false;
    }

    const ext = path.extname(localPath).toLowerCase();
    return this.COMPRESSIBLE_EXTENSIONS.includes(ext);
  }

  /**
   * Compress a file using gzip.
   * @returns Path to compressed file (.gz)
   */
  static async compressFile(localPath: string): Promise<string> {
    const compressedPath = `${localPath}.gz`;

    logger.info(`[Compression] Compressing ${localPath} → ${compressedPath}`);
    const startTime = Date.now();

    const readStream = fs.createReadStream(localPath);
    const writeStream = fs.createWriteStream(compressedPath);
    const gzip = zlib.createGzip({ level: this.COMPRESSION_LEVEL });

    await pipeline(readStream, gzip, writeStream);

    const originalSize = fs.statSync(localPath).size;
    const compressedSize = fs.statSync(compressedPath).size;
    const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info(
      `[Compression] Complete in ${duration}s: ${this.formatSize(originalSize)} → ` +
      `${this.formatSize(compressedSize)} (${ratio}% saved)`
    );

    return compressedPath;
  }

  /**
   * Decompress a remote .gz file using SSH exec.
   * @param client SSH2 Client instance
   * @param remotePath Remote path without .gz extension
   */
  static async decompressRemoteFile(
    client: Client,
    remotePath: string
  ): Promise<void> {
    const remoteGzPath = `${remotePath}.gz`;

    logger.info(`[Compression] Decompressing remote file: ${remoteGzPath}`);

    return new Promise<void>((resolve, reject) => {
      // Use gunzip to decompress, then remove .gz file
      const command = `gunzip -f "${remoteGzPath}"`;

      client.exec(command, (err, stream) => {
        if (err) {
          reject(new Error(`Failed to decompress remote file: ${err.message}`));
          return;
        }

        let stdout = '';
        let stderr = '';

        // Consume streams to prevent blocking
        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on('close', (code: number) => {
          if (code !== 0) {
            reject(new Error(`Remote decompression failed (exit ${code}): ${stderr}`));
          } else {
            logger.info(`[Compression] Remote file decompressed successfully: ${remotePath}`);
            resolve();
          }
        });

        // 5 minute timeout
        setTimeout(() => {
          stream.close();
          reject(new Error('Remote decompression timeout after 5 minutes'));
        }, 5 * 60 * 1000);
      });
    });
  }

  /**
   * Check if remote server has gunzip command.
   * @param client SSH2 Client instance
   */
  static async checkRemoteGunzip(client: Client): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      client.exec('which gunzip', (err, stream) => {
        if (err) {
          resolve(false);
          return;
        }

        let output = '';
        stream.on('data', (data: Buffer) => {
          output += data.toString();
        });

        stream.on('close', (code: number) => {
          // Exit code 0 means gunzip exists
          resolve(code === 0 && output.trim().length > 0);
        });
      });
    });
  }

  /**
   * Format file size for human-readable output.
   */
  private static formatSize(bytes: number): string {
    if (bytes < 1024) {return `${bytes} B`;}
    if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`;}
    if (bytes < 1024 * 1024 * 1024) {return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;}
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

/**
 * Enhanced SSH2 connection config with compression enabled.
 */
export function createCompressedConnectConfig(baseConfig: any): any {
  return {
    ...baseConfig,
    compress: true, // Enable SSH-level compression
    algorithms: {
      ...baseConfig.algorithms,
      compress: ['zlib@openssh.com', 'zlib'] // Prefer zlib algorithms
    }
  };
}
