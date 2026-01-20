import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import { logger } from './logger';

/**
 * Configuration options for attribute preservation
 */
export interface AttributePreservationOptions {
  preservePermissions: boolean;
  preserveTimestamps: boolean;
  followSymlinks: boolean;
}

/**
 * File statistics and attributes
 */
export interface FileAttributes {
  mode: number;
  atime: number; // Access time in seconds since epoch
  mtime: number; // Modification time in seconds since epoch
}

/**
 * Manager class for preserving file attributes during transfers
 */
export class AttributePreservingTransfer {
  /**
   * Upload a file with attributes preserved
   */
  static async uploadWithAttributes(
    sftp: SftpClient,
    localPath: string,
    remotePath: string,
    options: AttributePreservationOptions
  ): Promise<void> {
    // Use lstat to detect symbolic links
    const stat = fs.lstatSync(localPath);

    if (stat.isSymbolicLink()) {
      await this.handleSymbolicLink(sftp, localPath, remotePath, options);
    } else if (stat.isFile()) {
      await this.handleRegularFile(sftp, localPath, remotePath, stat, options);
    } else if (stat.isDirectory()) {
      await sftp.mkdir(remotePath, true);

      if (options.preservePermissions || options.preserveTimestamps) {
        await this.preserveAttributes(sftp, remotePath, stat, options);
      }
    } else {
      logger.warn(`Unsupported file type: ${localPath}`);
    }
  }

  /**
   * Download a file with attributes preserved
   */
  static async downloadWithAttributes(
    sftp: SftpClient,
    remotePath: string,
    localPath: string,
    options: AttributePreservationOptions
  ): Promise<void> {
    // Get remote file stats
    const remoteStat = await sftp.stat(remotePath);

    if (remoteStat.isSymbolicLink) {
      await this.handleRemoteSymbolicLink(sftp, remotePath, localPath, options);
    } else if (remoteStat.isFile) {
      // Check if file already exists (from parallel download)
      if (!fs.existsSync(localPath)) {
        // Download the file only if it doesn't exist
        await sftp.fastGet(remotePath, localPath);
      }

      if (options.preservePermissions || options.preserveTimestamps) {
        await this.applyAttributesToLocal(localPath, remoteStat, options);
      }
    } else if (remoteStat.isDirectory) {
      fs.mkdirSync(localPath, { recursive: true });

      if (options.preservePermissions || options.preserveTimestamps) {
        await this.applyAttributesToLocal(localPath, remoteStat, options);
      }
    }
  }

  /**
   * Handle symbolic link upload
   */
  private static async handleSymbolicLink(
    sftp: SftpClient,
    localPath: string,
    remotePath: string,
    options: AttributePreservationOptions
  ): Promise<void> {
    if (options.followSymlinks) {
      // Follow the symlink and upload the target
      const targetPath = fs.realpathSync(localPath);
      const targetStat = fs.statSync(targetPath);

      if (targetStat.isFile()) {
        await this.handleRegularFile(sftp, targetPath, remotePath, targetStat, options);
      } else if (targetStat.isDirectory()) {
        logger.warn(`Symlink target is a directory (not yet supported): ${localPath} -> ${targetPath}`);
      }
    } else {
      // Create symlink on remote
      const target = fs.readlinkSync(localPath);
      try {
        // @ts-expect-error - symlink method exists in underlying ssh2 SFTP wrapper
        await sftp.symlink(target, remotePath);
        logger.info(`Symbolic link created: ${remotePath} -> ${target}`);
      } catch (error) {
        logger.error(`Failed to create symlink ${remotePath}: ${error}`);
        throw error;
      }
    }
  }

  /**
   * Handle regular file upload
   */
  private static async handleRegularFile(
    sftp: SftpClient,
    localPath: string,
    remotePath: string,
    stat: fs.Stats,
    options: AttributePreservationOptions
  ): Promise<void> {
    // Upload the file
    await sftp.fastPut(localPath, remotePath);

    // Preserve attributes if configured
    if (options.preservePermissions || options.preserveTimestamps) {
      await this.preserveAttributes(sftp, remotePath, stat, options);
    }
  }

  /**
   * Preserve file attributes (permissions and timestamps)
   */
  private static async preserveAttributes(
    sftp: SftpClient,
    remotePath: string,
    stat: fs.Stats,
    options: AttributePreservationOptions
  ): Promise<void> {
    try {
      // Preserve permissions
      if (options.preservePermissions) {
        const mode = stat.mode & 0o777; // Extract permission bits
        await sftp.chmod(remotePath, mode);
        logger.info(`Permissions preserved for ${remotePath}: ${mode.toString(8)}`);
      }

      // Preserve timestamps
      if (options.preserveTimestamps) {
        const atime = Math.floor(stat.atimeMs / 1000);
        const mtime = Math.floor(stat.mtimeMs / 1000);

        // Note: ssh2-sftp-client doesn't have utime method, use raw SFTP setstat
        const sftpStream = (sftp as any).sftp;
        if (sftpStream && sftpStream.setstat) {
          await new Promise<void>((resolve, reject) => {
            sftpStream.setstat(remotePath, { atime, mtime }, (err: Error) => {
              if (err) {
                logger.warn(`Failed to preserve timestamps for ${remotePath}: ${err.message}`);
                resolve(); // Don't fail the transfer
              } else {
                logger.info(`Timestamps preserved for ${remotePath}`);
                resolve();
              }
            });
          });
        } else {
          logger.warn('Timestamp preservation not supported by SFTP server');
        }
      }
    } catch (error) {
      logger.warn(`Failed to preserve attributes for ${remotePath}: ${error}`);
      // Don't throw - attribute preservation is best-effort
    }
  }

  /**
   * Handle remote symbolic link download
   */
  private static async handleRemoteSymbolicLink(
    sftp: SftpClient,
    remotePath: string,
    localPath: string,
    options: AttributePreservationOptions
  ): Promise<void> {
    if (options.followSymlinks) {
      // Follow the symlink and download the target
      const targetPath = await sftp.realPath(remotePath);
      const targetStat = await sftp.stat(targetPath);

      if (targetStat.isFile) {
        await sftp.fastGet(targetPath, localPath);

        if (options.preservePermissions || options.preserveTimestamps) {
          await this.applyAttributesToLocal(localPath, targetStat, options);
        }
      } else {
        logger.warn(`Symlink target is a directory (not yet supported): ${remotePath} -> ${targetPath}`);
      }
    } else {
      // Read the symlink target
      // @ts-expect-error - readlink method exists in underlying ssh2 SFTP wrapper
      const target = await sftp.readlink(remotePath);
      try {
        fs.symlinkSync(target, localPath);
        logger.info(`Symbolic link created: ${localPath} -> ${target}`);
      } catch (error) {
        logger.error(`Failed to create symlink ${localPath}: ${error}`);
        throw error;
      }
    }
  }

  /**
   * Apply attributes to local file
   */
  private static async applyAttributesToLocal(
    localPath: string,
    remoteStat: any,
    options: AttributePreservationOptions
  ): Promise<void> {
    try {
      // Preserve permissions
      if (options.preservePermissions && remoteStat.mode) {
        const mode = remoteStat.mode & 0o777;
        fs.chmodSync(localPath, mode);
        logger.info(`Permissions applied to ${localPath}: ${mode.toString(8)}`);
      }

      // Preserve timestamps
      if (options.preserveTimestamps && remoteStat.atime && remoteStat.mtime) {
        const atime = new Date(remoteStat.atime * 1000);
        const mtime = new Date(remoteStat.mtime * 1000);
        fs.utimesSync(localPath, atime, mtime);
        logger.info(`Timestamps applied to ${localPath}`);
      }
    } catch (error) {
      logger.warn(`Failed to apply attributes to ${localPath}: ${error}`);
      // Don't throw - attribute preservation is best-effort
    }
  }

  /**
   * Get attribute preservation options from VS Code configuration
   */
  static getOptionsFromConfig(): AttributePreservationOptions {
    // Use dynamic import to allow testing
    let config: any;
    try {
      const vscode = require('vscode');
      config = vscode.workspace.getConfiguration('simpleSftp.transfer');
    } catch {
      // Return defaults if vscode is not available (e.g., in tests)
      return {
        preservePermissions: true,
        preserveTimestamps: true,
        followSymlinks: false,
      };
    }

    return {
      preservePermissions: config.get('preservePermissions', true),
      preserveTimestamps: config.get('preserveTimestamps', true),
      followSymlinks: config.get('followSymlinks', false),
    };
  }

  /**
   * Check if a local path is a symbolic link
   */
  static isSymbolicLink(localPath: string): boolean {
    try {
      const stat = fs.lstatSync(localPath);
      return stat.isSymbolicLink();
    } catch {
      return false;
    }
  }

  /**
   * Check if a remote path is a symbolic link
   */
  static async isRemoteSymbolicLink(sftp: SftpClient, remotePath: string): Promise<boolean> {
    try {
      const stat = await sftp.stat(remotePath);
      return stat.isSymbolicLink;
    } catch {
      return false;
    }
  }
}
