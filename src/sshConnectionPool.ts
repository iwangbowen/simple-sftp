import { Client, ConnectConfig } from 'ssh2';
// @ts-ignore
import SftpClient from 'ssh2-sftp-client';
import { HostConfig, HostAuthConfig } from './types';
import { logger } from './logger';

/**
 * SSH 连接池条目
 */
interface PooledConnection {
  /** SSH2 Client 实例 */
  client: Client;
  /** SFTP Client 实例 */
  sftpClient: SftpClient | null;
  /** 主机标识符 (hostId) */
  hostId: string;
  /** 连接配置 */
  config: ConnectConfig;
  /** 最后使用时间 */
  lastUsed: number;
  /** 是否正在使用 */
  inUse: boolean;
  /** 连接状态 */
  isReady: boolean;
}

/**
 * SSH 连接池管理器
 * 复用 SSH 连接以提升性能
 */
export class SshConnectionPool {
  private static instance: SshConnectionPool;
  private pool: Map<string, PooledConnection[]> = new Map();

  /** 每个主机的最大连接数 */
  private readonly MAX_CONNECTIONS_PER_HOST = 10;

  /** 连接空闲超时时间（毫秒）默认 5 分钟 */
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000;

  /** 清理定时器 */
  private cleanupTimer?: NodeJS.Timeout;

  private constructor() {
    // 启动定期清理任务（每 2 分钟检查一次）
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleConnections();
    }, 2 * 60 * 1000);
  }

  /**
   * 获取连接池单例
   */
  static getInstance(): SshConnectionPool {
    if (!SshConnectionPool.instance) {
      SshConnectionPool.instance = new SshConnectionPool();
    }
    return SshConnectionPool.instance;
  }

  /**
   * 生成连接键
   */
  private getConnectionKey(hostId: string): string {
    return hostId;
  }

  /**
   * 获取或创建连接
   */
  async getConnection(
    config: HostConfig,
    authConfig: HostAuthConfig,
    connectConfig: ConnectConfig
  ): Promise<{ client: Client; sftpClient: SftpClient; connectionId: string }> {
    const key = this.getConnectionKey(config.id);

    // 获取或初始化该主机的连接数组
    let connections = this.pool.get(key);
    if (!connections) {
      connections = [];
      this.pool.set(key, connections);
    }

    // 查找可用连接
    const available = connections.find(conn => conn.isReady && !conn.inUse);

    if (available) {
      // 复用现有连接
      logger.info(`[ConnectionPool] Reusing connection for ${config.name} (${connections.filter(c => c.inUse).length}/${connections.length} in use)`);
      available.inUse = true;
      available.lastUsed = Date.now();

      // 如果没有 SFTP 客户端,创建一个
      if (!available.sftpClient) {
        available.sftpClient = await this.createSftpClient(available.client);
      }

      return {
        client: available.client,
        sftpClient: available.sftpClient,
        connectionId: this.getConnectionId(available)
      };
    }

    // 检查是否达到上限
    if (connections.length >= this.MAX_CONNECTIONS_PER_HOST) {
      // 等待有连接释放
      logger.info(`[ConnectionPool] Max connections reached for ${config.name}, waiting for available connection...`);
      return this.waitForConnection(config, authConfig, connectConfig);
    }

    // 创建新连接
    logger.info(`[ConnectionPool] Creating new connection for ${config.name} (${connections.length + 1}/${this.MAX_CONNECTIONS_PER_HOST})`);
    const { client, sftpClient } = await this.createNewConnection(
      config,
      authConfig,
      connectConfig
    );

    // 添加到连接池
    const pooledConn = this.addToPool(key, client, sftpClient, config);

    return {
      client,
      sftpClient,
      connectionId: this.getConnectionId(pooledConn)
    };
  }

  /**
   * 等待连接可用
   */
  private async waitForConnection(
    config: HostConfig,
    authConfig: HostAuthConfig,
    connectConfig: ConnectConfig
  ): Promise<{ client: Client; sftpClient: SftpClient; connectionId: string }> {
    // 简单的重试逻辑,每 100ms 检查一次
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));

      const key = this.getConnectionKey(config.id);
      const connections = this.pool.get(key);

      if (connections) {
        const available = connections.find(conn => conn.isReady && !conn.inUse);
        if (available) {
          logger.info(`[ConnectionPool] Connection became available for ${config.name}`);
          available.inUse = true;
          available.lastUsed = Date.now();

          if (!available.sftpClient) {
            available.sftpClient = await this.createSftpClient(available.client);
          }

          return {
            client: available.client,
            sftpClient: available.sftpClient,
            connectionId: this.getConnectionId(available)
          };
        }
      }
    }

    throw new Error(`获取 ${config.name} 连接超时`);
  }

  /**
   * 生成连接唯一标识
   */
  private getConnectionId(conn: PooledConnection): string {
    return `${conn.hostId}-${conn.lastUsed}`;
  }

  /**
   * 创建新连接
   */
  private async createNewConnection(
    config: HostConfig,
    authConfig: HostAuthConfig,
    connectConfig: ConnectConfig
  ): Promise<{ client: Client; sftpClient: SftpClient }> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let resolved = false;

      client
        .on('ready', async () => {
          try {
            const sftpClient = await this.createSftpClient(client);
            resolved = true;
            resolve({ client, sftpClient });
          } catch (error) {
            client.end();
            reject(error);
          }
        })
        .on('error', (err) => {
          if (!resolved) {
            reject(err);
          }
        })
        .on('end', () => {
          // 连接关闭时从池中移除该特定连接
          const key = this.getConnectionKey(config.id);
          this.removeFromPool(key, client);
        })
        .connect(connectConfig);

      // 30 秒超时
      setTimeout(() => {
        if (!resolved) {
          client.end();
          reject(new Error('连接超时'));
        }
      }, 30000);
    });
  }

  /**
   * 创建 SFTP 客户端
   */
  private async createSftpClient(client: Client): Promise<SftpClient> {
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }

        // 创建 ssh2-sftp-client 包装器
        const sftpClient = new SftpClient();

        // 使用已有的 SFTP 会话
        (sftpClient as any).sftp = sftp;
        (sftpClient as any).client = client;

        resolve(sftpClient);
      });
    });
  }

  /**
   * 添加连接到池中
   */
  private addToPool(
    key: string,
    client: Client,
    sftpClient: SftpClient,
    config: HostConfig
  ): PooledConnection {
    const connections = this.pool.get(key) || [];

    const pooledConn: PooledConnection = {
      client,
      sftpClient,
      hostId: config.id,
      config: {} as ConnectConfig, // 不存储敏感配置
      lastUsed: Date.now(),
      inUse: true,
      isReady: true
    };

    connections.push(pooledConn);
    this.pool.set(key, connections);

    logger.info(`[ConnectionPool] Added connection to pool for ${config.name}. Total: ${connections.length}`);

    return pooledConn;
  }

  /**
   * 从池中移除连接
   */
  private removeFromPool(key: string, client?: Client): void {
    const connections = this.pool.get(key);
    if (!connections) {
      return;
    }

    if (client) {
      // 移除特定连接
      const index = connections.findIndex(conn => conn.client === client);
      if (index !== -1) {
        const conn = connections[index];
        try {
          if (conn.sftpClient) {
            (conn.sftpClient as any).end?.();
          }
          conn.client.end();
        } catch (error) {
          logger.error('[ConnectionPool] Error closing connection', error as Error);
        }
        connections.splice(index, 1);
        logger.info(`[ConnectionPool] Removed connection from pool. Remaining: ${connections.length}`);

        if (connections.length === 0) {
          this.pool.delete(key);
        }
      }
    } else {
      // 移除所有连接
      connections.forEach(conn => {
        try {
          if (conn.sftpClient) {
            (conn.sftpClient as any).end?.();
          }
          conn.client.end();
        } catch (error) {
          logger.error('[ConnectionPool] Error closing connection', error as Error);
        }
      });
      this.pool.delete(key);
      logger.info(`[ConnectionPool] Removed all connections for ${key}`);
    }
  }

  /**
   * 释放连接（标记为可复用）
   */
  releaseConnection(config: HostConfig, connectionId?: string): void {
    const key = this.getConnectionKey(config.id);
    const connections = this.pool.get(key);

    if (!connections) {
      logger.warn(`[ConnectionPool] No connections found for ${config.name}`);
      return;
    }

    // 如果提供了 connectionId,则释放特定连接
    // 否则释放第一个正在使用的连接
    const conn = connectionId
      ? connections.find(c => this.getConnectionId(c) === connectionId)
      : connections.find(c => c.inUse);

    if (conn) {
      conn.inUse = false;
      conn.lastUsed = Date.now();
      const inUseCount = connections.filter(c => c.inUse).length;
      logger.info(`[ConnectionPool] Released connection for ${config.name} (${inUseCount}/${connections.length} in use)`);
    } else {
      logger.warn(`[ConnectionPool] Connection not found for release: ${config.name}`);
    }
  }

  /**
   * 强制关闭连接
   */
  closeConnection(config: HostConfig): void {
    const key = this.getConnectionKey(config.id);
    this.removeFromPool(key);
  }

  /**
   * 清理空闲超时的连接
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();
    const toRemove: Array<{ key: string; client: Client }> = [];

    for (const [key, connections] of this.pool.entries()) {
      connections.forEach(conn => {
        const idleTime = now - conn.lastUsed;
        if (!conn.inUse && idleTime > this.IDLE_TIMEOUT) {
          toRemove.push({ key, client: conn.client });
        }
      });
    }

    toRemove.forEach(({ key, client }) => {
      logger.info(`[ConnectionPool] Cleaning up idle connection: ${key}`);
      this.removeFromPool(key, client);
    });

    if (toRemove.length > 0) {
      logger.info(`[ConnectionPool] Cleaned up ${toRemove.length} idle connection(s)`);
    }
  }

  /**
   * 关闭所有连接
   */
  closeAll(): void {
    logger.info('Closing all pooled connections');

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    for (const key of Array.from(this.pool.keys())) {
      this.removeFromPool(key);
    }
  }

  /**
   * 获取连接池状态
   */
  getPoolStatus(): {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    byHost: Record<string, { total: number; active: number; idle: number }>;
  } {
    let totalActive = 0;
    let totalIdle = 0;
    const byHost: Record<string, { total: number; active: number; idle: number }> = {};

    for (const [key, connections] of this.pool.entries()) {
      const active = connections.filter(c => c.inUse).length;
      const idle = connections.length - active;

      totalActive += active;
      totalIdle += idle;

      byHost[key] = {
        total: connections.length,
        active,
        idle
      };
    }

    let totalConnections = 0;
    for (const connections of this.pool.values()) {
      totalConnections += connections.length;
    }

    return {
      totalConnections,
      activeConnections: totalActive,
      idleConnections: totalIdle,
      byHost
    };
  }
}
