import { Client, ConnectConfig } from 'ssh2';
// @ts-ignore
import SftpClient from 'ssh2-sftp-client';
import { HostConfig, HostAuthConfig, JumpHostConfig } from './types';
import { logger } from './logger';
import { establishMultiHopConnection } from './utils/jumpHostHelper';
import type { AuthManager } from './authManager';

/**
 * 操作历史记录类型
 */
interface OperationHistory {
  /** 操作类型 */
  operation: 'acquire' | 'release' | 'create' | 'reuse';
  /** 操作时间戳 */
  timestamp: number;
  /** 操作描述 */
  description?: string;
}

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
  /** 创建时间 */
  createdAt: number;
  /** 最后使用时间 */
  lastUsed: number;
  /** 是否正在使用 */
  inUse: boolean;
  /** 连接状态 */
  isReady: boolean;
  /** 跳板机连接 (如果使用跳板机,支持多跳) */
  jumpConns?: Client[];
  /** 操作历史记录 */
  operationHistory: OperationHistory[];
  /** 使用次数 */
  usageCount: number;
}

/**
 * SSH 连接池管理器
 * 复用 SSH 连接以提升性能
 */
export class SshConnectionPool {
  private static instance: SshConnectionPool;
  private pool: Map<string, PooledConnection[]> = new Map();
  private authManager?: AuthManager;

  /** 每个主机的最大连接数 (略大于并发数,预留2个作为buffer) */
  private readonly MAX_CONNECTIONS_PER_HOST = 7;

  /** 连接空闲超时时间(毫秒)默认 5 分钟 */
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
   * Set the AuthManager instance for loading jump host credentials
   */
  setAuthManager(authManager: AuthManager): void {
    this.authManager = authManager;
  }

  /**
   * Load jump host authentication from AuthManager
   */
  private async loadJumpHostAuth(hostId: string, jumpHosts: JumpHostConfig[]): Promise<JumpHostConfig[]> {
    if (!this.authManager || !jumpHosts || jumpHosts.length === 0) {
      return jumpHosts;
    }

    const jumpHostsWithAuth: JumpHostConfig[] = [];
    for (let i = 0; i < jumpHosts.length; i++) {
      const jh = jumpHosts[i];
      const jumpAuthConfig = await this.authManager.getAuth(`${hostId}_jump_${i}`);

      jumpHostsWithAuth.push({
        ...jh,
        authType: jumpAuthConfig?.authType || jh.authType || 'password',
        password: jumpAuthConfig?.password,
        privateKeyPath: jumpAuthConfig?.privateKeyPath,
        passphrase: jumpAuthConfig?.passphrase
      });
    }
    return jumpHostsWithAuth;
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
      const readyCount = connections.filter(c => c.isReady).length;
      const inUseCount = connections.filter(c => c.isReady && c.inUse).length;
      logger.info(`[ConnectionPool] Reusing connection for ${config.name} (${inUseCount + 1}/${readyCount} in use)`);
      available.inUse = true;
      available.lastUsed = Date.now();
      available.usageCount++;
      available.operationHistory.push({
        operation: 'reuse',
        timestamp: Date.now(),
        description: 'Connection reused'
      });

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

    // 创建占位符,防止竞态条件
    const now = Date.now();
    const placeholder: PooledConnection = {
      client: null as any,
      sftpClient: null,
      hostId: config.id,
      config: {} as ConnectConfig,
      createdAt: now,
      lastUsed: now,
      inUse: true,
      isReady: false,  // 标记为未就绪
      operationHistory: [{
        operation: 'create',
        timestamp: now,
        description: 'Connection initiated'
      }],
      usageCount: 1
    };
    connections.push(placeholder);
    this.pool.set(key, connections);

    const connIndex = connections.length;
    logger.info(`[ConnectionPool] Creating new connection for ${config.name} (${connIndex}/${this.MAX_CONNECTIONS_PER_HOST})`);

    try {
      // If jump hosts are configured, establish multi-hop connection first
      let jumpConns: Client[] | undefined;
      if (config.jumpHosts && config.jumpHosts.length > 0) {
        // Load jump host authentication credentials
        const jumpHostsWithAuth = await this.loadJumpHostAuth(config.id, config.jumpHosts);

        logger.info(`[ConnectionPool] Establishing connection through ${jumpHostsWithAuth.length} jump host(s) for ${config.name}...`);
        const jumpResult = await establishMultiHopConnection(
          jumpHostsWithAuth,
          config.host,
          config.port
        );
        jumpConns = jumpResult.jumpConns;
        connectConfig.sock = jumpResult.stream;
        logger.info('[ConnectionPool] Jump host connection chain established, forwarding to target server');
      }

      // 创建新连接
      const { client, sftpClient } = await this.createNewConnection(
        config,
        authConfig,
        connectConfig
      );

      // 更新占位符为真实连接
      placeholder.client = client;
      placeholder.sftpClient = sftpClient;
      placeholder.isReady = true;
      placeholder.jumpConns = jumpConns;  // Store jump connections for cleanup
      placeholder.operationHistory.push({
        operation: 'acquire',
        timestamp: Date.now(),
        description: 'Connection established'
      });
      logger.info(`[ConnectionPool] Connection ${connIndex} ready for ${config.name}. Total: ${connections.length}`);

      return {
        client,
        sftpClient,
        connectionId: this.getConnectionId(placeholder)
      };
    } catch (error) {
      // 创建失败,移除占位符
      const idx = connections.indexOf(placeholder);
      if (idx > -1) {
        connections.splice(idx, 1);
      }
      throw error;
    }
  }

  /**
   * 等待连接可用
   */
  private async waitForConnection(
    config: HostConfig,
    authConfig: HostAuthConfig,
    connectConfig: ConnectConfig
  ): Promise<{ client: Client; sftpClient: SftpClient; connectionId: string }> {
    logger.info(`[ConnectionPool] Waiting for available connection for ${config.name}...`);

    // 简单的重试逻辑,每 100ms 检查一次
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));

      const key = this.getConnectionKey(config.id);
      const connections = this.pool.get(key);

      if (connections) {
        const available = connections.find(conn => conn.isReady && !conn.inUse);
        if (available) {
          const readyCount = connections.filter(c => c.isReady).length;
          const inUseCount = connections.filter(c => c.isReady && c.inUse).length;
          logger.info(`[ConnectionPool] Connection became available for ${config.name} (${inUseCount + 1}/${readyCount} in use)`);
          available.inUse = true;
          available.lastUsed = Date.now();
          available.usageCount++;
          available.operationHistory.push({
            operation: 'reuse',
            timestamp: Date.now(),
            description: 'Connection reused after wait'
          });

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

    const now = Date.now();
    const pooledConn: PooledConnection = {
      client,
      sftpClient,
      hostId: config.id,
      config: {} as ConnectConfig, // 不存储敏感配置
      createdAt: now,
      lastUsed: now,
      inUse: true,
      isReady: true,
      operationHistory: [{ operation: 'create', timestamp: now }],
      usageCount: 1
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
          // Clean up jump host connections if exist
          if (conn.jumpConns) {
            logger.info(`[ConnectionPool] Closing ${conn.jumpConns.length} jump host connection(s)`);
            conn.jumpConns.forEach(jc => jc.end());
          }
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
          // Clean up jump host connections if exist
          if (conn.jumpConns) {
            logger.info(`[ConnectionPool] Closing ${conn.jumpConns.length} jump host connection(s)`);
            conn.jumpConns.forEach(jc => jc.end());
          }
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
      conn.operationHistory.push({
        operation: 'release',
        timestamp: Date.now(),
        description: 'Connection released'
      });
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

  /**
   * Get detailed connection pool status including individual connection info
   */
  getDetailedPoolStatus(): {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    connections: Array<{
      hostId: string;
      status: 'active' | 'idle';
      createdAt: string;
      lastUsed: string;
      idleTime: number;
      usageCount: number;
      operationHistory: Array<{
        operation: string;
        timestamp: string;
        description?: string;
      }>;
    }>;
  } {
    const connections: Array<{
      hostId: string;
      status: 'active' | 'idle';
      createdAt: string;
      lastUsed: string;
      idleTime: number;
      usageCount: number;
      operationHistory: Array<{
        operation: string;
        timestamp: string;
        description?: string;
      }>;
    }> = [];

    let totalActive = 0;
    let totalIdle = 0;
    const now = Date.now();

    for (const [hostId, conns] of this.pool.entries()) {
      for (const conn of conns) {
        const idleTime = now - conn.lastUsed;
        const status = conn.inUse ? 'active' : 'idle';

        if (conn.inUse) {
          totalActive++;
        } else {
          totalIdle++;
        }

        connections.push({
          hostId,
          status,
          createdAt: new Date(conn.createdAt || conn.lastUsed).toISOString(),
          lastUsed: new Date(conn.lastUsed).toISOString(),
          idleTime,
          usageCount: conn.usageCount || 0,
          operationHistory: (conn.operationHistory || []).slice(-10).map(op => ({
            operation: op.operation,
            timestamp: new Date(op.timestamp).toISOString(),
            description: op.description
          }))
        });
      }
    }

    return {
      totalConnections: connections.length,
      activeConnections: totalActive,
      idleConnections: totalIdle,
      connections
    };
  }
}
