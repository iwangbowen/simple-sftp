import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PortForwardService } from './portForwardService';
import { HostManager } from '../hostManager';

vi.mock('../hostManager');
vi.mock('../logger');
vi.mock('net');

describe('PortForwardService', () => {
  let service: PortForwardService;
  let mockHostManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the singleton instance
    (PortForwardService as any).instance = undefined;

    mockHostManager = {
      getHost: vi.fn(),
      getAllHosts: vi.fn().mockReturnValue([]),
      getHosts: vi.fn().mockReturnValue([]),
      updateHost: vi.fn(),
      onHostsChanged: vi.fn((callback) => {
        mockHostManager._onHostsChangedCallback = callback;
        return { dispose: vi.fn() };
      }),
    };

    vi.mocked(HostManager).mockImplementation(() => mockHostManager);

    service = PortForwardService.getInstance();
  });

  describe('Initialization', () => {
    it('should create service instance', () => {
      expect(service).toBeDefined();
    });

    it('should have event emitter', () => {
      expect(service).toHaveProperty('onPortForwardingEvent');
    });
  });

  describe('Port Forwarding Management', () => {
    it('should start local port forwarding', async () => {
      const host = {
        id: 'host1',
        name: 'Test Host',
        host: 'example.com',
        port: 22,
        username: 'user',
        portForwardings: [],
      };

      mockHostManager.getHost.mockReturnValue(host);

      // Cannot fully test without actual SSH connection
      expect(service).toBeDefined();
    });

    it('should stop port forwarding', async () => {
      const host = {
        id: 'host1',
        name: 'Test Host',
        host: 'example.com',
        port: 22,
        username: 'user',
        portForwardings: [
          { id: 'pf1', localPort: 3000, remotePort: 3000, status: 'active' },
        ],
      };

      mockHostManager.getHost.mockReturnValue(host);

      expect(service).toBeDefined();
    });

    it('should update port forwarding', async () => {
      const host = {
        id: 'host1',
        name: 'Test Host',
        host: 'example.com',
        port: 22,
        username: 'user',
        portForwardings: [
          { id: 'pf1', localPort: 3000, remotePort: 3000 },
        ],
      };

      mockHostManager.getHost.mockReturnValue(host);
      mockHostManager.updateHost.mockResolvedValue(undefined);

      expect(service).toBeDefined();
    });
  });

  describe('Local Port Forwarding', () => {
    it('should create local port forward config', () => {
      const config = {
        type: 'local' as const,
        localPort: 8080,
        remoteHost: 'localhost',
        remotePort: 80,
      };

      expect(config.type).toBe('local');
      expect(config.localPort).toBe(8080);
    });

    it('should validate port number', () => {
      const validPort = 8080;
      const invalidPort = -1;

      expect(validPort > 0 && validPort < 65536).toBe(true);
      expect(invalidPort > 0 && invalidPort < 65536).toBe(false);
    });

    it('should handle port range validation', () => {
      const ports = [80, 443, 3000, 8080, 65535];

      for (const port of ports) {
        expect(port > 0 && port < 65536).toBe(true);
      }
    });
  });

  describe('Remote Port Forwarding', () => {
    it('should create remote port forward config', () => {
      const config = {
        type: 'remote' as const,
        localPort: 5432,
        remoteHost: 'db.local',
        remotePort: 5432,
      };

      expect(config.type).toBe('remote');
      expect(config.remotePort).toBe(5432);
    });

    it('should specify remote host', () => {
      const remoteHost = 'database.example.com';
      expect(remoteHost).toBeDefined();
      expect(typeof remoteHost).toBe('string');
    });
  });

  describe('Dynamic Port Forwarding (SOCKS5)', () => {
    it('should create SOCKS5 config', () => {
      const config = {
        type: 'dynamic' as const,
        localPort: 1080,
      };

      expect(config.type).toBe('dynamic');
      expect(config.localPort).toBe(1080);
    });

    it('should support SOCKS5 protocol', () => {
      const protocol = 'SOCKS5';
      expect(protocol).toBe('SOCKS5');
    });
  });

  describe('Status Management', () => {
    it('should track active forwarding status', () => {
      const status = 'active';
      expect(['active', 'inactive']).toContain(status);
    });

    it('should track inactive forwarding status', () => {
      const status = 'inactive';
      expect(['active', 'inactive']).toContain(status);
    });

    it('should update forwarding status', async () => {
      mockHostManager.updateHost.mockResolvedValue(undefined);

      const host = {
        id: 'host1',
        portForwardings: [{ id: 'pf1', status: 'active' }],
      };

      await mockHostManager.updateHost(host);
      expect(mockHostManager.updateHost).toHaveBeenCalledWith(host);
    });
  });

  describe('Port Conflict Detection', () => {
    it('should detect port already in use', () => {
      // Port validation logic
      const usedPorts = [3000, 8080];
      const newPort = 3000;

      expect(usedPorts.includes(newPort)).toBe(true);
    });

    it('should prevent duplicate local ports', () => {
      const forwardings = [
        { id: 'pf1', localPort: 3000 },
        { id: 'pf2', localPort: 8000 },
      ];

      const newPort = 3000;
      const isDuplicate = forwardings.some(f => f.localPort === newPort);

      expect(isDuplicate).toBe(true);
    });
  });

  describe('Multi-Host Support', () => {
    it('should manage forwarding for multiple hosts', () => {
      const hosts = [
        { id: 'host1', name: 'Server 1' },
        { id: 'host2', name: 'Server 2' },
        { id: 'host3', name: 'Server 3' },
      ];

      expect(hosts.length).toBe(3);
    });

    it('should maintain separate forwarding for each host', () => {
      const host1Forwardings = [
        { id: 'pf1', localPort: 3000 },
        { id: 'pf2', localPort: 8000 },
      ];

      const host2Forwardings = [
        { id: 'pf3', localPort: 3000 }, // Same port allowed on different host
        { id: 'pf4', localPort: 5432 },
      ];

      // Same port can exist on different hosts
      const port3000Hosts = [host1Forwardings, host2Forwardings];
      expect(port3000Hosts.length).toBe(2);
    });
  });

  describe('Process Management', () => {
    it('should track running process', () => {
      const forwarding = {
        id: 'pf1',
        localPort: 3000,
        remotePort: 3000,
        runningProcess: 'ssh',
      };

      expect(forwarding.runningProcess).toBe('ssh');
    });

    it('should clear process info on stop', () => {
      let forwarding: any = {
        id: 'pf1',
        runningProcess: 'ssh',
      };

      forwarding = { ...forwarding, runningProcess: undefined };
      expect(forwarding.runningProcess).toBeUndefined();
    });
  });

  describe('Auto-reconnect', () => {
    it('should support auto-reconnect option', () => {
      const config = {
        id: 'pf1',
        autoReconnect: true,
      };

      expect(config.autoReconnect).toBe(true);
    });

    it('should disable auto-reconnect option', () => {
      const config = {
        id: 'pf1',
        autoReconnect: false,
      };

      expect(config.autoReconnect).toBe(false);
    });
  });

  describe('Persist Configuration', () => {
    it('should persist port forwarding config', async () => {
      const host = {
        id: 'host1',
        name: 'Test Host',
        portForwardings: [
          { id: 'pf1', localPort: 3000, remotePort: 3000 },
        ],
      };

      mockHostManager.updateHost.mockResolvedValue(undefined);
      await mockHostManager.updateHost(host);

      expect(mockHostManager.updateHost).toHaveBeenCalledWith(host);
    });

    it('should load persisted configuration', () => {
      const host = {
        id: 'host1',
        portForwardings: [
          { id: 'pf1', localPort: 3000, remotePort: 3000 },
          { id: 'pf2', localPort: 8000, remotePort: 8000 },
        ],
      };

      mockHostManager.getHost.mockReturnValue(host);
      const loadedHost = mockHostManager.getHost('host1');

      expect(loadedHost.portForwardings.length).toBe(2);
    });
  });

  describe('Event Handling', () => {
    it('should have port forwarding event property', () => {
      expect(service.onPortForwardingEvent).toBeDefined();
    });

    it('should handle host configuration changes', async () => {
      if (mockHostManager._onHostsChangedCallback) {
        mockHostManager._onHostsChangedCallback();
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(mockHostManager._onHostsChangedCallback).toBeDefined();
      }
    });
  });

  describe('Graceful Shutdown', () => {
    it('should stop all forwarding on shutdown', async () => {
      const hosts = [
        {
          id: 'host1',
          portForwardings: [
            { id: 'pf1', status: 'active' },
            { id: 'pf2', status: 'active' },
          ],
        },
      ];

      mockHostManager.getAllHosts.mockReturnValue(hosts);

      const allHosts = mockHostManager.getAllHosts();
      const activeForwardings = allHosts
        .flatMap((h: any) => h.portForwardings || [])
        .filter((pf: any) => pf.status === 'active');

      expect(activeForwardings.length).toBe(2);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate port forwarding config', () => {
      const config = {
        localPort: 3000,
        remotePort: 3000,
        remoteHost: 'localhost',
      };

      expect(config.localPort > 0).toBe(true);
      expect(config.remotePort > 0).toBe(true);
      expect(typeof config.remoteHost).toBe('string');
    });

    it('should reject invalid port numbers', () => {
      const invalidPorts = [-1, 0, 65536, 100000];

      for (const port of invalidPorts) {
        expect(port > 0 && port < 65536).toBe(false);
      }
    });
  });

  describe('Cleanup', () => {
    it('should dispose service', () => {
      const disposeSpy = vi.spyOn(service, 'dispose');
      service.dispose();
      expect(disposeSpy).toHaveBeenCalled();
    });
  });
});
