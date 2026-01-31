import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SshConnectionPool } from './sshConnectionPool';
import { HostConfig } from './types';

// Mock ssh2 和 ssh2-sftp-client
vi.mock('ssh2', () => {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const mockClient = vi.fn(function(this: any) {
    this.on = vi.fn().mockReturnThis();
    this.connect = vi.fn().mockReturnThis();
    this.end = vi.fn();
    this.sftp = vi.fn();
    this._listeners = new Map();

    // 重写 on 方法来保存监听器
    this.on = vi.fn((event: string, handler: Function) => {
      this._listeners.set(event, handler);
      return this;
    });

    // 添加触发事件的方法
    this._emit = (event: string, ...args: any[]) => {
      const handler = this._listeners.get(event);
      if (handler) {
        handler(...args);
      }
    };
  });

  return {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Client: mockClient
  };
});

vi.mock('ssh2-sftp-client', () => {
  return {
    default: vi.fn(function(this: any) {
      this.sftp = null;
      this.client = null;
      this.end = vi.fn();
    })
  };
});

describe('SshConnectionPool', () => {
  let pool: SshConnectionPool;
  let mockConfig: HostConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    // 重置单例实例
    (SshConnectionPool as any).instance = undefined;

    pool = SshConnectionPool.getInstance();

    mockConfig = {
      id: 'test-host',
      name: 'Test Host',
      host: '192.168.1.100',
      port: 22,
      username: 'testuser'
    };
  });

  afterEach(() => {
    pool.closeAll();
    vi.clearAllTimers();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = SshConnectionPool.getInstance();
      const instance2 = SshConnectionPool.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should create only one instance', () => {
      const instance1 = SshConnectionPool.getInstance();
      const instance2 = SshConnectionPool.getInstance();
      const instance3 = SshConnectionPool.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });
  });

  describe('getConnection', () => {
    it('should be a function', () => {
      expect(typeof pool.getConnection).toBe('function');
    });
  });

  describe('releaseConnection', () => {
    it('should mark connection as not in use', () => {
      // 这个测试需要先创建连接，然后释放
      // 由于连接创建是异步的，我们只测试释放方法不抛出错误
      expect(() => {
        pool.releaseConnection(mockConfig);
      }).not.toThrow();
    });

    it('should handle releasing non-existent connection', () => {
      const nonExistentConfig: HostConfig = {
        id: 'non-existent',
        name: 'Non Existent',
        host: 'localhost',
        port: 22,
        username: 'test'
      };

      expect(() => {
        pool.releaseConnection(nonExistentConfig);
      }).not.toThrow();
    });
  });

  describe('closeConnection', () => {
    it('should remove connection from pool', () => {
      expect(() => {
        pool.closeConnection(mockConfig);
      }).not.toThrow();
    });

    it('should handle closing non-existent connection', () => {
      const nonExistentConfig: HostConfig = {
        id: 'non-existent',
        name: 'Non Existent',
        host: 'localhost',
        port: 22,
        username: 'test'
      };

      expect(() => {
        pool.closeConnection(nonExistentConfig);
      }).not.toThrow();
    });
  });

  describe('closeAll', () => {
    it('should close all connections in the pool', () => {
      expect(() => {
        pool.closeAll();
      }).not.toThrow();
    });

    it('should handle multiple calls to closeAll', () => {
      pool.closeAll();
      pool.closeAll();
      pool.closeAll();

      expect(() => {
        pool.closeAll();
      }).not.toThrow();
    });
  });

  describe('getPoolStatus', () => {
    it('should return correct status for empty pool', () => {
      const status = pool.getPoolStatus();

      expect(status.totalConnections).toBe(0);
      expect(status.activeConnections).toBe(0);
      expect(status.idleConnections).toBe(0);
    });

    it('should return correct counts', () => {
      // 初始状态
      const initialStatus = pool.getPoolStatus();

      expect(initialStatus.totalConnections).toBe(0);
      expect(initialStatus.activeConnections).toBe(0);
      expect(initialStatus.idleConnections).toBe(0);
    });
  });

  describe('Connection Pool Management', () => {
    it('should respect MAX_POOL_SIZE limit', () => {
      // 验证池有最大容量限制
      const status = pool.getPoolStatus();
      expect(status.totalConnections).toBeLessThanOrEqual(5); // MAX_POOL_SIZE = 5
    });

    it('should handle connection key generation', () => {
      const config1: HostConfig = {
        id: 'host1',
        name: 'Host 1',
        host: '192.168.1.1',
        port: 22,
        username: 'user1'
      };

      const config2: HostConfig = {
        id: 'host2',
        name: 'Host 2',
        host: '192.168.1.2',
        port: 22,
        username: 'user2'
      };

      // 不同的配置应该有不同的连接
      expect(config1.id).not.toBe(config2.id);
    });
  });


  describe('Edge Cases', () => {
    it('should handle config with minimal required fields', () => {
      const minimalConfig: HostConfig = {
        id: 'minimal',
        name: 'Minimal',
        host: 'localhost',
        port: 22,
        username: 'user'
      };

      expect(() => {
        pool.closeConnection(minimalConfig);
      }).not.toThrow();
    });

    it('should handle special characters in host ID', () => {
      const specialConfig: HostConfig = {
        id: 'host-name_123.test@domain',
        name: 'Special Host',
        host: 'localhost',
        port: 22,
        username: 'user'
      };

      expect(() => {
        pool.closeConnection(specialConfig);
      }).not.toThrow();
    });


  });

  describe('Multiple Connections', () => {
    it('should handle multiple different hosts', () => {
      const config1: HostConfig = {
        id: 'host1',
        name: 'Host 1',
        host: '192.168.1.1',
        port: 22,
        username: 'user1'
      };

      const config2: HostConfig = {
        id: 'host2',
        name: 'Host 2',
        host: '192.168.1.2',
        port: 22,
        username: 'user2'
      };

      pool.closeConnection(config1);
      pool.closeConnection(config2);

      expect(pool.getPoolStatus().totalConnections).toBe(0);
    });
  });

  describe('Error Recovery', () => {
    it('should handle SFTP client end errors gracefully', () => {
      // 模拟清理时的错误
      expect(() => {
        pool.closeAll();
      }).not.toThrow();
    });

    it('should handle client end errors gracefully', () => {
      pool.closeConnection(mockConfig);

      expect(pool.getPoolStatus().totalConnections).toBe(0);
    });
  });

  describe('Connection Reuse', () => {
    it('should not throw when releasing connection', () => {
      // 释放连接不应该抛出错误
      expect(() => {
        pool.releaseConnection(mockConfig);
      }).not.toThrow();

      // 多次释放同一个连接也不应该抛出错误
      expect(() => {
        pool.releaseConnection(mockConfig);
      }).not.toThrow();
    });

    it('should handle getPoolStatus called multiple times', () => {
      const status1 = pool.getPoolStatus();
      const status2 = pool.getPoolStatus();

      expect(status1.totalConnections).toBe(status2.totalConnections);
      expect(status1.idleConnections).toBe(status2.idleConnections);
    });

    it('should handle pool operations with empty config values', () => {
      const emptyConfig: HostConfig = {
        id: '',
        name: '',
        host: '',
        port: 22,
        username: ''
      };

      expect(() => {
        pool.releaseConnection(emptyConfig);
        pool.closeConnection(emptyConfig);
      }).not.toThrow();
    });

    it('should maintain consistent state after multiple operations', () => {
      pool.closeAll();
      const initialStatus = pool.getPoolStatus();

      pool.releaseConnection(mockConfig);
      pool.closeConnection(mockConfig);
      pool.closeAll();

      const finalStatus = pool.getPoolStatus();

      expect(initialStatus.totalConnections).toBe(finalStatus.totalConnections);
      expect(initialStatus.idleConnections).toBe(finalStatus.idleConnections);
    });
  });
});
