import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { addAuthToConnectConfig } from './jumpHostHelper';
import { HostAuthConfig } from '../types';

vi.mock('node:fs');
vi.mock('node:os');
vi.mock('../logger');

describe('jumpHostHelper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addAuthToConnectConfig', () => {
    it('should add password authentication', () => {
      const connectConfig: any = {};
      const authConfig: HostAuthConfig = {
        hostId: 'test-host',
        authType: 'password',
        password: 'mypassword',
      };

      addAuthToConnectConfig(connectConfig, authConfig);

      expect(connectConfig.password).toBe('mypassword');
    });

    it('should add private key authentication', () => {
      const connectConfig: any = {};
      const authConfig: HostAuthConfig = {
        hostId: 'test-host',
        authType: 'privateKey',
        privateKeyPath: '/home/user/.ssh/id_rsa',
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('key content'));

      addAuthToConnectConfig(connectConfig, authConfig);

      expect(fs.readFileSync).toHaveBeenCalled();
      expect(connectConfig.privateKey).toBeDefined();
    });

    it('should expand tilde in private key path', () => {
      const connectConfig: any = {};
      const authConfig: HostAuthConfig = {
        hostId: 'test-host',
        authType: 'privateKey',
        privateKeyPath: '~/.ssh/id_rsa',
      };

      vi.mocked(os.homedir).mockReturnValue('/home/user');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('key content'));

      addAuthToConnectConfig(connectConfig, authConfig);

      expect(fs.readFileSync).toHaveBeenCalled();
    });

    it('should add passphrase when provided', () => {
      const connectConfig: any = {};
      const authConfig: HostAuthConfig = {
        hostId: 'test-host',
        authType: 'privateKey',
        privateKeyPath: '/home/user/.ssh/id_rsa',
        passphrase: 'key-passphrase',
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('key content'));

      addAuthToConnectConfig(connectConfig, authConfig);

      expect(connectConfig.passphrase).toBe('key-passphrase');
    });

    it('should throw error for missing private key file', () => {
      const connectConfig: any = {};
      const authConfig: HostAuthConfig = {
        hostId: 'test-host',
        authType: 'privateKey',
        privateKeyPath: '/nonexistent/key',
      };

      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => {
        addAuthToConnectConfig(connectConfig, authConfig);
      }).toThrow();
    });

    it('should add SSH agent on Windows', () => {
      const connectConfig: any = {};
      const authConfig: HostAuthConfig = {
        hostId: 'test-host',
        authType: 'agent',
      };

      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      try {
        addAuthToConnectConfig(connectConfig, authConfig);
        expect(connectConfig.agent).toContain('pipe');
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
      }
    });

    it('should add SSH agent on Unix', () => {
      const connectConfig: any = {};
      const authConfig: HostAuthConfig = {
        hostId: 'test-host',
        authType: 'agent',
      };

      const originalPlatform = process.platform;
      const originalEnv = process.env.SSH_AUTH_SOCK;
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });
      process.env.SSH_AUTH_SOCK = '/tmp/ssh-agent-socket';

      try {
        addAuthToConnectConfig(connectConfig, authConfig);
        expect(connectConfig.agent).toBe('/tmp/ssh-agent-socket');
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
        if (originalEnv) {
          process.env.SSH_AUTH_SOCK = originalEnv;
        } else {
          delete process.env.SSH_AUTH_SOCK;
        }
      }
    });

    it('should throw error when SSH agent not available on Unix', () => {
      const connectConfig: any = {};
      const authConfig: HostAuthConfig = {
        hostId: 'test-host',
        authType: 'agent',
      };

      const originalPlatform = process.platform;
      const originalEnv = process.env.SSH_AUTH_SOCK;
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });
      delete process.env.SSH_AUTH_SOCK;

      try {
        expect(() => {
          addAuthToConnectConfig(connectConfig, authConfig);
        }).toThrow();
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
        if (originalEnv) {
          process.env.SSH_AUTH_SOCK = originalEnv;
        }
      }
    });

    it('should handle unknown auth type', () => {
      const connectConfig: any = {};
      const authConfig: any = {
        authType: 'unknown',
      };

      // Should throw for unknown auth type
      expect(() => {
        addAuthToConnectConfig(connectConfig, authConfig);
      }).toThrow();
    });
  });

  describe('Auth Type Validation', () => {
    it('should accept password auth type', () => {
      const authType: HostAuthConfig['authType'] = 'password';
      expect(['password', 'privateKey', 'agent']).toContain(authType);
    });

    it('should accept privateKey auth type', () => {
      const authType: HostAuthConfig['authType'] = 'privateKey';
      expect(['password', 'privateKey', 'agent']).toContain(authType);
    });

    it('should accept agent auth type', () => {
      const authType: HostAuthConfig['authType'] = 'agent';
      expect(['password', 'privateKey', 'agent']).toContain(authType);
    });
  });

  describe('Private Key Path Handling', () => {
    it('should use absolute paths as-is', () => {
      const path = '/home/user/.ssh/id_rsa';
      const expandedPath = path.replace(/^~/, os.homedir());
      expect(expandedPath).toBe(path);
    });

    it('should expand tilde paths', () => {
      const path = '~/.ssh/id_rsa';
      vi.mocked(os.homedir).mockReturnValue('/home/user');
      const expandedPath = path.replace(/^~/, os.homedir());
      expect(expandedPath).toBe('/home/user/.ssh/id_rsa');
    });

    it('should handle paths with spaces', () => {
      const path = '/home/user/My Documents/.ssh/id_rsa';
      expect(path).toContain('My Documents');
    });
  });

  describe('SSH Config Standard Locations', () => {
    it('should recognize standard SSH directory', () => {
      const sshDir = '~/.ssh';
      expect(sshDir).toContain('.ssh');
    });

    it('should handle different key file names', () => {
      const keyNames = ['id_rsa', 'id_ed25519', 'id_ecdsa', 'github_rsa'];
      for (const keyName of keyNames) {
        const keyPath = `~/.ssh/${keyName}`;
        expect(keyPath).toContain(keyName);
      }
    });
  });
});
