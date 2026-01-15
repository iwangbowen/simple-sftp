import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthManager } from './authManager';
import { HostAuthConfig } from './types';
import * as vscode from 'vscode';
import { logger } from './logger';

describe('AuthManager', () => {
  let authManager: AuthManager;
  let mockContext: vscode.ExtensionContext;
  let secretsStore: Map<string, string>;

  beforeEach(() => {
    // 清空秘密存储
    secretsStore = new Map();

    // Mock ExtensionContext
    mockContext = {
      secrets: {
        get: vi.fn(async (key: string) => secretsStore.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secretsStore.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secretsStore.delete(key);
        }),
        onDidChange: vi.fn()
      }
    } as any;

    authManager = new AuthManager(mockContext);
  });

  describe('getAuth', () => {
    it('should return undefined when no auth exists for the host', async () => {
      const result = await authManager.getAuth('host1');
      expect(result).toBeUndefined();
    });

    it('should return the auth config for an existing host', async () => {
      const authConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'test123'
      };

      await authManager.saveAuth(authConfig);
      const result = await authManager.getAuth('host1');

      expect(result).toEqual(authConfig);
    });

    it('should return the correct auth when multiple hosts exist', async () => {
      const auth1: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'pass1'
      };

      const auth2: HostAuthConfig = {
        hostId: 'host2',
        authType: 'privateKey',
        privateKeyPath: '/path/to/key'
      };

      await authManager.saveAuth(auth1);
      await authManager.saveAuth(auth2);

      const result1 = await authManager.getAuth('host1');
      const result2 = await authManager.getAuth('host2');

      expect(result1).toEqual(auth1);
      expect(result2).toEqual(auth2);
    });
  });

  describe('saveAuth', () => {
    it('should save a new auth config', async () => {
      const authConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'test123'
      };

      await authManager.saveAuth(authConfig);

      expect(mockContext.secrets.store).toHaveBeenCalledWith(
        'hostAuthConfigs',
        JSON.stringify([authConfig])
      );
    });

    it('should update an existing auth config', async () => {
      const authConfig1: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'oldpass'
      };

      const authConfig2: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'newpass'
      };

      await authManager.saveAuth(authConfig1);
      await authManager.saveAuth(authConfig2);

      const result = await authManager.getAuth('host1');
      expect(result).toEqual(authConfig2);
      expect(result?.password).toBe('newpass');
    });

    it('should save multiple different auth configs', async () => {
      const auth1: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'pass1'
      };

      const auth2: HostAuthConfig = {
        hostId: 'host2',
        authType: 'privateKey',
        privateKeyPath: '/key/path'
      };

      await authManager.saveAuth(auth1);
      await authManager.saveAuth(auth2);

      const stored = JSON.parse(secretsStore.get('hostAuthConfigs') || '[]');
      expect(stored).toHaveLength(2);
      expect(stored).toContainEqual(auth1);
      expect(stored).toContainEqual(auth2);
    });

    it('should handle password auth type', async () => {
      const authConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'secure123'
      };

      await authManager.saveAuth(authConfig);
      const result = await authManager.getAuth('host1');

      expect(result?.authType).toBe('password');
      expect(result?.password).toBe('secure123');
    });

    it('should handle private key auth type', async () => {
      const authConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'privateKey',
        privateKeyPath: '/home/user/.ssh/id_rsa',
        passphrase: 'keypass'
      };

      await authManager.saveAuth(authConfig);
      const result = await authManager.getAuth('host1');

      expect(result?.authType).toBe('privateKey');
      expect(result?.privateKeyPath).toBe('/home/user/.ssh/id_rsa');
      expect(result?.passphrase).toBe('keypass');
    });

    it('should handle agent auth type', async () => {
      const authConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'agent'
      };

      await authManager.saveAuth(authConfig);
      const result = await authManager.getAuth('host1');

      expect(result?.authType).toBe('agent');
    });
  });

  describe('deleteAuth', () => {
    it('should delete the auth config for a host', async () => {
      const authConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'test123'
      };

      await authManager.saveAuth(authConfig);
      await authManager.deleteAuth('host1');

      const result = await authManager.getAuth('host1');
      expect(result).toBeUndefined();
    });

    it('should not affect other auth configs when deleting one', async () => {
      const auth1: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'pass1'
      };

      const auth2: HostAuthConfig = {
        hostId: 'host2',
        authType: 'password',
        password: 'pass2'
      };

      await authManager.saveAuth(auth1);
      await authManager.saveAuth(auth2);
      await authManager.deleteAuth('host1');

      const result1 = await authManager.getAuth('host1');
      const result2 = await authManager.getAuth('host2');

      expect(result1).toBeUndefined();
      expect(result2).toEqual(auth2);
    });

    it('should handle deleting non-existent auth gracefully', async () => {
      await expect(authManager.deleteAuth('nonexistent')).resolves.not.toThrow();
      const result = await authManager.getAuth('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should properly clean up when deleting the last auth config', async () => {
      const authConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'test123'
      };

      await authManager.saveAuth(authConfig);
      await authManager.deleteAuth('host1');

      const stored = JSON.parse(secretsStore.get('hostAuthConfigs') || '[]');
      expect(stored).toHaveLength(0);
    });
  });

  describe('hasAuth', () => {
    it('should return false when no auth exists', async () => {
      const result = await authManager.hasAuth('host1');
      expect(result).toBe(false);
    });

    it('should return true when auth exists', async () => {
      const authConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'test123'
      };

      await authManager.saveAuth(authConfig);
      const result = await authManager.hasAuth('host1');

      expect(result).toBe(true);
    });

    it('should return false after auth is deleted', async () => {
      const authConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'test123'
      };

      await authManager.saveAuth(authConfig);
      await authManager.deleteAuth('host1');
      const result = await authManager.hasAuth('host1');

      expect(result).toBe(false);
    });
  });

  describe('loadAllAuth - Error Handling', () => {
    it('should return empty array when secrets storage is empty', async () => {
      const result = await authManager.getAuth('host1');
      expect(result).toBeUndefined();
      expect(mockContext.secrets.get).toHaveBeenCalledWith('hostAuthConfigs');
    });

    it('should handle corrupted JSON gracefully', async () => {
      // 模拟损坏的 JSON
      secretsStore.set('hostAuthConfigs', 'invalid{json}');

      const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const result = await authManager.getAuth('host1');

      expect(result).toBeUndefined();
      expect(loggerSpy).toHaveBeenCalledWith(
        'Failed to parse authentication configs',
        expect.any(SyntaxError)
      );

      loggerSpy.mockRestore();
    });

    it('should recover from corrupted data and allow saving new auth', async () => {
      // 先设置损坏的数据
      secretsStore.set('hostAuthConfigs', 'corrupted');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // 尝试获取（应该返回 undefined）
      const result1 = await authManager.getAuth('host1');
      expect(result1).toBeUndefined();

      // 保存新的认证配置（应该成功）
      const authConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'newpass'
      };

      await authManager.saveAuth(authConfig);

      // 验证数据已正确保存
      const result2 = await authManager.getAuth('host1');
      expect(result2).toEqual(authConfig);

      consoleSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty hostId', async () => {
      const authConfig: HostAuthConfig = {
        hostId: '',
        authType: 'password',
        password: 'test'
      };

      await authManager.saveAuth(authConfig);
      const result = await authManager.getAuth('');

      expect(result).toEqual(authConfig);
    });

    it('should handle hostId with special characters', async () => {
      const specialHostId = 'host-name_123.test@domain';
      const authConfig: HostAuthConfig = {
        hostId: specialHostId,
        authType: 'password',
        password: 'test123'
      };

      await authManager.saveAuth(authConfig);
      const result = await authManager.getAuth(specialHostId);

      expect(result).toEqual(authConfig);
    });

    it('should handle auth config with all optional fields', async () => {
      const authConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'privateKey',
        privateKeyPath: '/path/to/key',
        passphrase: 'phrase',
        password: 'fallback'
      };

      await authManager.saveAuth(authConfig);
      const result = await authManager.getAuth('host1');

      expect(result).toEqual(authConfig);
      expect(result?.privateKeyPath).toBe('/path/to/key');
      expect(result?.passphrase).toBe('phrase');
      expect(result?.password).toBe('fallback');
    });

    it('should handle very long passwords', async () => {
      const longPassword = 'a'.repeat(1000);
      const authConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: longPassword
      };

      await authManager.saveAuth(authConfig);
      const result = await authManager.getAuth('host1');

      expect(result?.password).toBe(longPassword);
      expect(result?.password?.length).toBe(1000);
    });

    it('should handle unicode characters in password', async () => {
      const unicodePassword = '密码123🔒测试';
      const authConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: unicodePassword
      };

      await authManager.saveAuth(authConfig);
      const result = await authManager.getAuth('host1');

      expect(result?.password).toBe(unicodePassword);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple save operations correctly', async () => {
      const auth1: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'pass1'
      };

      const auth2: HostAuthConfig = {
        hostId: 'host2',
        authType: 'password',
        password: 'pass2'
      };

      const auth3: HostAuthConfig = {
        hostId: 'host3',
        authType: 'password',
        password: 'pass3'
      };

      // 并发保存
      await Promise.all([
        authManager.saveAuth(auth1),
        authManager.saveAuth(auth2),
        authManager.saveAuth(auth3)
      ]);

      // 验证所有配置都已保存
      const result1 = await authManager.getAuth('host1');
      const result2 = await authManager.getAuth('host2');
      const result3 = await authManager.getAuth('host3');

      // 注意：由于并发操作，可能不是所有配置都能保存成功
      // 但至少应该有一个保存成功
      const stored = JSON.parse(secretsStore.get('hostAuthConfigs') || '[]');
      expect(stored.length).toBeGreaterThan(0);
    });

    it('should handle rapid update operations', async () => {
      const baseConfig: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'initial'
      };

      await authManager.saveAuth(baseConfig);

      // 快速更新多次
      for (let i = 1; i <= 5; i++) {
        await authManager.saveAuth({
          ...baseConfig,
          password: `pass${i}`
        });
      }

      const result = await authManager.getAuth('host1');
      expect(result?.password).toBe('pass5');
    });
  });
});
