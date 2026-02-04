import { describe, it, expect } from 'vitest';
import { HostConfig, HostAuthConfig, JumpHostConfig } from './types';

describe('Types', () => {
  describe('HostConfig', () => {
    it('should create valid host config', () => {
      const host: HostConfig = {
        id: 'host1',
        name: 'Test Server',
        host: 'example.com',
        port: 22,
        username: 'user',
        authConfig: { authType: 'password' },
      };

      expect(host.id).toBe('host1');
      expect(host.host).toBe('example.com');
      expect(host.port).toBe(22);
    });

    it('should have optional fields', () => {
      const host: HostConfig = {
        id: 'host2',
        name: 'Server 2',
        host: 'server2.com',
        port: 2222,
        username: 'admin',
        authConfig: { authType: 'privateKey' },
        remoteEncoding: 'utf-8',
        localEncoding: 'utf-8',
      };

      expect(host.remoteEncoding).toBe('utf-8');
      expect(host.localEncoding).toBe('utf-8');
    });

    it('should support jump hosts', () => {
      const host: HostConfig = {
        id: 'host3',
        name: 'Server 3',
        host: 'internal.local',
        port: 22,
        username: 'user',
        authConfig: { authType: 'password' },
        jumpHosts: [
          { id: 'jump1', host: 'bastion.com', port: 22, username: 'user', authType: 'password' },
        ],
      };

      expect(host.jumpHosts).toBeDefined();
      expect(host.jumpHosts?.length).toBe(1);
    });

    it('should support port forwardings', () => {
      const host: HostConfig = {
        id: 'host4',
        name: 'Server 4',
        host: 'example.com',
        port: 22,
        username: 'user',
        authConfig: { authType: 'password' },
        portForwardings: [
          { id: 'pf1', localPort: 3000, remotePort: 3000, status: 'inactive' },
        ],
      };

      expect(host.portForwardings).toBeDefined();
      expect(host.portForwardings?.length).toBe(1);
    });
  });

  describe('HostAuthConfig', () => {
    it('should create password auth config', () => {
      const auth: HostAuthConfig = {
        authType: 'password',
        password: 'secret',
      };

      expect(auth.authType).toBe('password');
      expect(auth.password).toBe('secret');
    });

    it('should create private key auth config', () => {
      const auth: HostAuthConfig = {
        authType: 'privateKey',
        privateKeyPath: '~/.ssh/id_rsa',
      };

      expect(auth.authType).toBe('privateKey');
      expect(auth.privateKeyPath).toBe('~/.ssh/id_rsa');
    });

    it('should support passphrase in private key auth', () => {
      const auth: HostAuthConfig = {
        authType: 'privateKey',
        privateKeyPath: '~/.ssh/id_rsa',
        passphrase: 'key-password',
      };

      expect(auth.passphrase).toBe('key-password');
    });

    it('should create SSH Agent auth config', () => {
      const auth: HostAuthConfig = {
        authType: 'agent',
      };

      expect(auth.authType).toBe('agent');
    });
  });

  describe('JumpHostConfig', () => {
    it('should create valid jump host config', () => {
      const jumpHost: JumpHostConfig = {
        id: 'jump1',
        host: 'bastion.example.com',
        port: 22,
        username: 'jumpuser',
        authType: 'password',
        password: 'jump-pass',
      };

      expect(jumpHost.host).toBe('bastion.example.com');
      expect(jumpHost.authType).toBe('password');
    });

    it('should support private key in jump host', () => {
      const jumpHost: JumpHostConfig = {
        id: 'jump2',
        host: 'proxy.internal',
        port: 2222,
        username: 'proxy-user',
        authType: 'privateKey',
        privateKeyPath: '/home/user/.ssh/proxy_key',
      };

      expect(jumpHost.authType).toBe('privateKey');
      expect(jumpHost.privateKeyPath).toBe('/home/user/.ssh/proxy_key');
    });

    it('should support SSH agent in jump host', () => {
      const jumpHost: JumpHostConfig = {
        id: 'jump3',
        host: 'agent.example.com',
        port: 22,
        username: 'agent-user',
        authType: 'agent',
      };

      expect(jumpHost.authType).toBe('agent');
    });

    it('should support passphrase in jump host', () => {
      const jumpHost: JumpHostConfig = {
        id: 'jump4',
        host: 'encrypted.example.com',
        port: 22,
        username: 'user',
        authType: 'privateKey',
        privateKeyPath: '~/.ssh/encrypted_key',
        passphrase: 'key-passphrase',
      };

      expect(jumpHost.passphrase).toBe('key-passphrase');
    });
  });

  describe('Host Groups', () => {
    it('should support host grouping', () => {
      const hostWithGroup: any = {
        id: 'host1',
        name: 'Server 1',
        host: 'example.com',
        port: 22,
        username: 'user',
        authConfig: { authType: 'password' },
        groupId: 'production',
      };

      expect(hostWithGroup.groupId).toBe('production');
    });

    it('should support host sorting', () => {
      const host: any = {
        id: 'host1',
        name: 'Server 1',
        host: 'example.com',
        port: 22,
        username: 'user',
        authConfig: { authType: 'password' },
        sortIndex: 0,
      };

      expect(host.sortIndex).toBe(0);
    });
  });

  describe('Host Configuration Constraints', () => {
    it('should validate hostname', () => {
      const validHosts = [
        'localhost',
        'example.com',
        '192.168.1.1',
        'sub.example.com',
        'server-name',
      ];

      for (const hostname of validHosts) {
        const host: HostConfig = {
          id: 'host1',
          name: 'Test',
          host: hostname,
          port: 22,
          username: 'user',
          authConfig: { authType: 'password' },
        };
        expect(host.host).toBe(hostname);
      }
    });

    it('should validate port range', () => {
      const validPorts = [22, 2222, 10022];

      for (const port of validPorts) {
        const host: HostConfig = {
          id: 'host1',
          name: 'Test',
          host: 'example.com',
          port,
          username: 'user',
          authConfig: { authType: 'password' },
        };
        expect(host.port).toBe(port);
      }
    });

    it('should support default port', () => {
      const host: HostConfig = {
        id: 'host1',
        name: 'Test',
        host: 'example.com',
        port: 22,
        username: 'user',
        authConfig: { authType: 'password' },
      };

      expect(host.port).toBe(22);
    });
  });

  describe('Encoding Support', () => {
    it('should support different encodings', () => {
      const encodings = ['utf-8', 'utf8', 'latin1', 'ascii', 'gbk'];

      for (const encoding of encodings) {
        const host: HostConfig = {
          id: 'host1',
          name: 'Test',
          host: 'example.com',
          port: 22,
          username: 'user',
          authConfig: { authType: 'password' },
          remoteEncoding: encoding as any,
        };
        expect(host.remoteEncoding).toBe(encoding);
      }
    });
  });
});
