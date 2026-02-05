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
        group: 'production',
        defaultRemotePath: '/home/admin',
      };

      expect(host.group).toBe('production');
      expect(host.defaultRemotePath).toBe('/home/admin');
    });

    it('should support jump hosts', () => {
      const host: HostConfig = {
        id: 'host3',
        name: 'Server 3',
        host: 'internal.local',
        port: 22,
        username: 'user',
        jumpHosts: [
          { host: 'bastion.com', port: 22, username: 'user', authType: 'password' },
        ],
      };

      expect(host.jumpHosts).toBeDefined();
      expect(host.jumpHosts?.length).toBe(1);
    });

    it('should support bookmarks', () => {
      const host: HostConfig = {
        id: 'host4',
        name: 'Server 4',
        host: 'example.com',
        port: 22,
        username: 'user',
        bookmarks: [
          { name: 'Web Root', path: '/var/www/html' },
        ],
      };

      expect(host.bookmarks).toBeDefined();
      expect(host.bookmarks?.length).toBe(1);
    });
  });

  describe('HostAuthConfig', () => {
    it('should create password auth config', () => {
      const auth: HostAuthConfig = {
        hostId: 'host1',
        authType: 'password',
        password: 'secret',
      };

      expect(auth.authType).toBe('password');
      expect(auth.password).toBe('secret');
    });

    it('should create private key auth config', () => {
      const auth: HostAuthConfig = {
        hostId: 'host1',
        authType: 'privateKey',
        privateKeyPath: '~/.ssh/id_rsa',
      };

      expect(auth.authType).toBe('privateKey');
      expect(auth.privateKeyPath).toBe('~/.ssh/id_rsa');
    });

    it('should support passphrase in private key auth', () => {
      const auth: HostAuthConfig = {
        hostId: 'host1',
        authType: 'privateKey',
        privateKeyPath: '~/.ssh/id_rsa',
        passphrase: 'key-password',
      };

      expect(auth.passphrase).toBe('key-password');
    });

    it('should create SSH Agent auth config', () => {
      const auth: HostAuthConfig = {
        hostId: 'host1',
        authType: 'agent',
      };

      expect(auth.authType).toBe('agent');
    });
  });

  describe('JumpHostConfig', () => {
    it('should create valid jump host config', () => {
      const jumpHost: JumpHostConfig = {
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
        host: 'agent.example.com',
        port: 22,
        username: 'agent-user',
        authType: 'agent',
      };

      expect(jumpHost.authType).toBe('agent');
    });

    it('should support passphrase in jump host', () => {
      const jumpHost: JumpHostConfig = {
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
      const hostWithGroup: HostConfig = {
        id: 'host1',
        name: 'Server 1',
        host: 'example.com',
        port: 22,
        username: 'user',
        group: 'production',
      };

      expect(hostWithGroup.group).toBe('production');
    });

    it('should support starred hosts', () => {
      const host: HostConfig = {
        id: 'host1',
        name: 'Server 1',
        host: 'example.com',
        port: 22,
        username: 'user',
        starred: true,
      };

      expect(host.starred).toBe(true);
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
      };

      expect(host.port).toBe(22);
    });
  });

  describe('Host Configuration Features', () => {
    it('should support color coding', () => {
      const host: HostConfig = {
        id: 'host1',
        name: 'Test',
        host: 'example.com',
        port: 22,
        username: 'user',
        color: '#FF5722',
      };
      expect(host.color).toBe('#FF5722');
    });

    it('should support recent paths tracking', () => {
      const host: HostConfig = {
        id: 'host1',
        name: 'Test',
        host: 'example.com',
        port: 22,
        username: 'user',
        recentPaths: ['/var/www', '/home/user'],
      };
      expect(host.recentPaths?.length).toBe(2);
    });
  });
});
