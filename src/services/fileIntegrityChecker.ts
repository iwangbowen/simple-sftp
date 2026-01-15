import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { Client } from 'ssh2';
import { HostConfig, HostAuthConfig } from '../types';
import { logger } from '../logger';

/**
 * Checksum verification options
 */
export interface ChecksumOptions {
  algorithm: 'md5' | 'sha256';
  threshold: number;  // Minimum file size to verify
  enabled: boolean;
}

/**
 * File integrity checker using checksums
 * Verifies files after transfer to ensure data integrity
 */
export class FileIntegrityChecker {
  /**
   * Calculate checksum of a local file
   */
  static async calculateLocalChecksum(
    filePath: string,
    algorithm: 'md5' | 'sha256' = 'md5'
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm);
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data: Buffer | string) => {
        hash.update(data);
      });

      stream.on('end', () => {
        const checksum = hash.digest('hex');
        resolve(checksum);
      });

      stream.on('error', reject);
    });
  }

  /**
   * Calculate checksum of a remote file via SSH exec
   */
  static async calculateRemoteChecksum(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string,
    algorithm: 'md5' | 'sha256' = 'md5',
    connectConfig: any
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        // Build checksum command based on algorithm
        const command = algorithm === 'md5'
          ? `md5sum "${remotePath}" 2>/dev/null || md5 -q "${remotePath}" 2>/dev/null || echo "CHECKSUM_TOOL_NOT_FOUND"`
          : `sha256sum "${remotePath}" 2>/dev/null || shasum -a 256 "${remotePath}" 2>/dev/null || echo "CHECKSUM_TOOL_NOT_FOUND"`;

        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }

          let output = '';
          let errorOutput = '';

          stream.on('data', (data: Buffer) => {
            output += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            errorOutput += data.toString();
          });

          stream.on('close', () => {
            conn.end();

            const trimmedOutput = output.trim();

            // Check if checksum tool is not available
            if (trimmedOutput.includes('CHECKSUM_TOOL_NOT_FOUND') || trimmedOutput === '') {
              reject(new Error(
                `Checksum tool not found on remote server. ` +
                `Please install ${algorithm === 'md5' ? 'md5sum or md5' : 'sha256sum or shasum'} ` +
                `or disable checksum verification in settings.`
              ));
              return;
            }

            // Extract checksum (first field in output)
            const checksum = trimmedOutput.split(/\s+/)[0];

            if (!checksum || checksum.length === 0) {
              reject(new Error(`Failed to calculate remote checksum: ${errorOutput || 'Unknown error'}`));
              return;
            }

            resolve(checksum);
          });
        });
      });

      conn.on('error', reject);

      conn.connect(connectConfig);
    });
  }

  /**
   * Verify upload integrity
   */
  static async verifyUpload(
    config: HostConfig,
    authConfig: HostAuthConfig,
    localPath: string,
    remotePath: string,
    connectConfig: any,
    options: ChecksumOptions
  ): Promise<boolean> {
    if (!options.enabled) {
      logger.debug('Checksum verification disabled, skipping');
      return true;
    }

    // Check file size threshold
    const stat = fs.statSync(localPath);
    if (stat.size < options.threshold) {
      logger.debug(`File size ${stat.size} below threshold ${options.threshold}, skipping verification`);
      return true;
    }

    try {
      logger.info(`Verifying upload integrity using ${options.algorithm.toUpperCase()}...`);

      // Calculate local checksum
      const localChecksum = await this.calculateLocalChecksum(localPath, options.algorithm);
      logger.debug(`Local ${options.algorithm}: ${localChecksum}`);

      // Calculate remote checksum
      const remoteChecksum = await this.calculateRemoteChecksum(
        config,
        authConfig,
        remotePath,
        options.algorithm,
        connectConfig
      );
      logger.debug(`Remote ${options.algorithm}: ${remoteChecksum}`);

      // Compare checksums
      if (localChecksum === remoteChecksum) {
        logger.info(`✓ Upload verified successfully (${options.algorithm}: ${localChecksum})`);
        return true;
      } else {
        logger.error(`✗ Upload verification failed!`);
        logger.error(`  Local:  ${localChecksum}`);
        logger.error(`  Remote: ${remoteChecksum}`);
        return false;
      }
    } catch (error: any) {
      logger.error(`Checksum verification error: ${error.message}`);

      // If checksum tool not found, show helpful message
      if (error.message.includes('not found')) {
        vscode.window.showWarningMessage(
          `Checksum verification failed: ${error.message}`,
          'Disable Verification',
          'Learn More'
        ).then(selection => {
          if (selection === 'Disable Verification') {
            vscode.workspace.getConfiguration('simpleSftp.verification').update(
              'enabled',
              false,
              vscode.ConfigurationTarget.Global
            );
          } else if (selection === 'Learn More') {
            vscode.env.openExternal(vscode.Uri.parse(
              'https://github.com/iwangbowen/simple-sftp#checksum-verification'
            ));
          }
        });
      }

      throw error;
    }
  }

  /**
   * Verify download integrity
   */
  static async verifyDownload(
    config: HostConfig,
    authConfig: HostAuthConfig,
    remotePath: string,
    localPath: string,
    connectConfig: any,
    options: ChecksumOptions
  ): Promise<boolean> {
    if (!options.enabled) {
      logger.debug('Checksum verification disabled, skipping');
      return true;
    }

    // Check file size threshold
    const stat = fs.statSync(localPath);
    if (stat.size < options.threshold) {
      logger.debug(`File size ${stat.size} below threshold ${options.threshold}, skipping verification`);
      return true;
    }

    try {
      logger.info(`Verifying download integrity using ${options.algorithm.toUpperCase()}...`);

      // Calculate remote checksum
      const remoteChecksum = await this.calculateRemoteChecksum(
        config,
        authConfig,
        remotePath,
        options.algorithm,
        connectConfig
      );
      logger.debug(`Remote ${options.algorithm}: ${remoteChecksum}`);

      // Calculate local checksum
      const localChecksum = await this.calculateLocalChecksum(localPath, options.algorithm);
      logger.debug(`Local ${options.algorithm}: ${localChecksum}`);

      // Compare checksums
      if (localChecksum === remoteChecksum) {
        logger.info(`✓ Download verified successfully (${options.algorithm}: ${localChecksum})`);
        return true;
      } else {
        logger.error(`✗ Download verification failed!`);
        logger.error(`  Remote: ${remoteChecksum}`);
        logger.error(`  Local:  ${localChecksum}`);
        return false;
      }
    } catch (error: any) {
      logger.error(`Checksum verification error: ${error.message}`);

      // If checksum tool not found, show helpful message
      if (error.message.includes('not found')) {
        vscode.window.showWarningMessage(
          `Checksum verification failed: ${error.message}`,
          'Disable Verification',
          'Learn More'
        ).then(selection => {
          if (selection === 'Disable Verification') {
            vscode.workspace.getConfiguration('simpleSftp.verification').update(
              'enabled',
              false,
              vscode.ConfigurationTarget.Global
            );
          } else if (selection === 'Learn More') {
            vscode.env.openExternal(vscode.Uri.parse(
              'https://github.com/iwangbowen/simple-sftp#checksum-verification'
            ));
          }
        });
      }

      throw error;
    }
  }

  /**
   * Get checksum options from VS Code configuration
   */
  static getOptionsFromConfig(): ChecksumOptions {
    const config = vscode.workspace.getConfiguration('simpleSftp.verification');
    return {
      enabled: config.get<boolean>('enabled', false),
      algorithm: config.get<'md5' | 'sha256'>('algorithm', 'sha256'),
      threshold: config.get<number>('threshold', 10 * 1024 * 1024)
    };
  }
}
