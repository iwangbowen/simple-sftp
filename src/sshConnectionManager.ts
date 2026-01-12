import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Client, ConnectConfig } from 'ssh2';
// @ts-ignore
import SftpClient from 'ssh2-sftp-client';
import { HostConfig, HostAuthConfig } from './types';
import { SshConnectionPool } from './sshConnectionPool';

/**
 * SSH 连接管理器
 */
export class SshConnectionManager {
  private static connectionPool = SshConnectionPool.getInstance();

  /**
   * 使用连接池执行操作
   */
  private static async withConnection<T>(
    config: HostConfig,
    authConfig: HostAuthConfig,
    operation: (sftpClient: SftpClient) => Promise<T>
  ): Promise<T> {
    const connectConfig = this.buildConnectConfig(config, authConfig);
    const { client, sftpClient } = await this.connectionPool.getConnection(
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
    } catch (error) {
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
  static async listRemoteFiles(config: HostConfig, authConfig: HostAuthConfig, remotePath: string): Promise<Array<{name: string, type: 'file' | 'directory', size: number}>> {
    return this.withConnection(config, authConfig, async (sftp) => {
      const list = await sftp.list(remotePath);
      const items = list
        .filter((item: any) => item.name !== '.' && item.name !== '..')
        .map((item: any) => ({
          name: item.name,
          type: item.type === 'd' ? 'directory' as const : 'file' as const,
          size: item.size || 0
        }));

      return items;
    });
  }

  /**
   * 上传文件
   */
  static async uploadFile(
    config: HostConfig,
    authConfig: HostAuthConfig,
    localPath: string,
    remotePath: string,
    onProgress?: (transferred: number, total: number) => void
  ): Promise<void> {
    return this.withConnection(config, authConfig, async (sftp) => {
      // 确保远程目录存在
      const remoteDir = path.dirname(remotePath).replace(/\\/g, '/');
      await sftp.mkdir(remoteDir, true);

      // 上传文件
      await sftp.fastPut(localPath, remotePath, {
        step: (transferred: number, _chunk: any, total: number) => {
          if (onProgress) {
            onProgress(transferred, total);
          }
        },
      });
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
    onProgress?: (currentFile: string, progress: number) => void
  ): Promise<void> {
    return this.withConnection(config, authConfig, async (sftp) => {
      // 获取所有文件
      const files = this.getAllFiles(localPath);
      const totalFiles = files.length;
      let uploadedFiles = 0;

      for (const file of files) {
        const relativePath = path.relative(localPath, file);
        const remoteFilePath = path.join(remotePath, relativePath).replace(/\\/g, '/');
        const remoteDir = path.dirname(remoteFilePath).replace(/\\/g, '/');

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
    onProgress?: (transferred: number, total: number) => void
  ): Promise<void> {
    return this.withConnection(config, authConfig, async (sftp) => {
      // 确保本地目录存在
      const localDir = path.dirname(localPath);
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }

      // 下载文件
      await sftp.fastGet(remotePath, localPath, {
        step: (transferred: number, _chunk: any, total: number) => {
          if (onProgress) {
            onProgress(transferred, total);
          }
        },
      });
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
    onProgress?: (currentFile: string, progress: number) => void
  ): Promise<void> {
    return this.withConnection(config, authConfig, async (sftp) => {
      // 获取所有远程文件
      const files = await this.getAllRemoteFiles(sftp, remotePath);
      const totalFiles = files.length;
      let downloadedFiles = 0;

      for (const file of files) {
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
          // 执行命令添加公钥到 authorized_keys
          const command = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${publicKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;

          conn.exec(command, (err, stream) => {
            if (err) {
              conn.end();
              reject(err);
              return;
            }

            stream
              .on('close', () => {
                conn.end();
                resolve();
              })
              .on('data', (data: Buffer) => {
                console.log('STDOUT:', data.toString());
              })
              .stderr.on('data', (data: Buffer) => {
                console.error('STDERR:', data.toString());
              });
          });
        })
        .on('error', err => {
          reject(err);
        })
        .connect(this.buildConnectConfig(config, authConfig));
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
    };

    if (authConfig.authType === 'password' && authConfig.password) {
      connectConfig.password = authConfig.password;
    } else if (authConfig.authType === 'privateKey' && authConfig.privateKeyPath) {
      const privateKeyPath = authConfig.privateKeyPath.replace('~', require('os').homedir());
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

      const fullPath = `${remotePath}/${item.name}`.replace(/\/\//g, '/');

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
