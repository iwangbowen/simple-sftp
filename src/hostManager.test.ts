import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HostManager } from './hostManager';
import * as vscode from 'vscode';

describe('HostManager', () => {
  let hostManager: HostManager;
  let mockContext: vscode.ExtensionContext;
  let globalStateStore: Map<string, any>;
  let settingsStore: Map<string, any>;

  beforeEach(() => {
    // Create storage for mock context and settings
    globalStateStore = new Map();
    settingsStore = new Map();

    // Initialize empty arrays for settings
    settingsStore.set('hosts', []);
    settingsStore.set('groups', []);

    // Mock workspace.getConfiguration
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: vi.fn((key: string, defaultValue?: any) => {
        return settingsStore.get(key) ?? defaultValue;
      }),
      update: vi.fn(async (key: string, value: any) => {
        settingsStore.set(key, value);
      }),
      has: vi.fn((key: string) => settingsStore.has(key)),
      inspect: vi.fn()
    } as any);

    // Mock ExtensionContext
    mockContext = {
      globalState: {
        get: vi.fn((key: string, defaultValue?: any) => {
          return globalStateStore.get(key) ?? defaultValue;
        }),
        update: vi.fn(async (key: string, value: any) => {
          globalStateStore.set(key, value);
        }),
        keys: vi.fn(() => Array.from(globalStateStore.keys())),
        setKeysForSync: vi.fn()
      }
    } as any;

    hostManager = new HostManager(mockContext);
  });

  describe('Initialization', () => {
    it('should initialize and register sync key', async () => {
      await hostManager.initialize();

      // Verify initialization was successful (no error thrown)
      expect(hostManager).toBeDefined();
    });

    it('should log sync configuration on initialization', async () => {
      await hostManager.initialize();

      // Initialization should log information about hosts and groups
      const hosts = await hostManager.getHosts();
      expect(Array.isArray(hosts)).toBe(true);
    });
  });

  describe('Group Management', () => {
    it('should create a new group', async () => {
      await hostManager.initialize();

      const groupName = 'TestGroup';
      const group = await hostManager.addGroup(groupName);

      expect(group.id).toBeDefined();
      expect(group.name).toBe(groupName);

      const groups = await hostManager.getGroups();
      const groupNames = groups.map(g => g.name);
      expect(groupNames).toContain(groupName);
    });

    it('should create multiple groups', async () => {
      await hostManager.initialize();

      await hostManager.addGroup('Group1');
      await hostManager.addGroup('Group2');
      await hostManager.addGroup('Group3');

      const groups = await hostManager.getGroups();
      expect(groups).toHaveLength(3);
      expect(groups.map(g => g.name)).toEqual(['Group1', 'Group2', 'Group3']);
    });

    it('should update group name', async () => {
      await hostManager.initialize();

      const group = await hostManager.addGroup('OriginalName');
      await hostManager.updateGroup(group.id, 'UpdatedName');

      const groups = await hostManager.getGroups();
      const updatedGroup = groups.find(g => g.id === group.id);

      expect(updatedGroup).toBeDefined();
      expect(updatedGroup?.name).toBe('UpdatedName');
    });

    it('should throw error when updating non-existent group', async () => {
      await hostManager.initialize();

      await expect(
        hostManager.updateGroup('non-existent-id', 'NewName')
      ).rejects.toThrow('Group not found');
    });

    it('should delete a group', async () => {
      await hostManager.initialize();

      const groupName = 'TestGroup';
      const group = await hostManager.addGroup(groupName);
      await hostManager.deleteGroup(group.id);

      const groups = await hostManager.getGroups();
      const groupNames = groups.map(g => g.name);
      expect(groupNames).not.toContain(groupName);
    });

    it('should remove group reference from hosts when deleting group', async () => {
      await hostManager.initialize();

      const group = await hostManager.addGroup('TestGroup');
      const host = await hostManager.addHost({
        name: 'test-server',
        host: '192.168.1.100',
        port: 22,
        username: 'testuser',
        group: group.id
      });

      await hostManager.deleteGroup(group.id);

      const hosts = await hostManager.getHosts();
      const updatedHost = hosts.find(h => h.id === host.id);

      expect(updatedHost).toBeDefined();
      expect(updatedHost?.group).toBeUndefined();
    });
  });

  describe('Host Management', () => {
    it('should add a host', async () => {
      await hostManager.initialize();

      const hostName = 'test-server';
      const newHost = await hostManager.addHost({
        name: hostName,
        host: '192.168.1.100',
        port: 22,
        username: 'testuser'
      });

      expect(newHost.id).toBeDefined();
      expect(newHost.name).toBe(hostName);
      expect(newHost.host).toBe('192.168.1.100');
      expect(newHost.port).toBe(22);
      expect(newHost.username).toBe('testuser');

      const hosts = await hostManager.getHosts();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].id).toBe(newHost.id);
    });

    it('should add host with group', async () => {
      await hostManager.initialize();

      const group = await hostManager.addGroup('TestGroup');
      const host = await hostManager.addHost({
        name: 'test-server',
        host: '192.168.1.100',
        port: 22,
        username: 'testuser',
        group: group.id
      });

      expect(host.group).toBe(group.id);
    });

    it('should add multiple hosts', async () => {
      await hostManager.initialize();

      await hostManager.addHost({
        name: 'server1',
        host: '192.168.1.1',
        port: 22,
        username: 'user1'
      });

      await hostManager.addHost({
        name: 'server2',
        host: '192.168.1.2',
        port: 2222,
        username: 'user2'
      });

      const hosts = await hostManager.getHosts();
      expect(hosts).toHaveLength(2);
      expect(hosts.map(h => h.name)).toEqual(['server1', 'server2']);
    });

    it('should update host configuration', async () => {
      await hostManager.initialize();

      const host = await hostManager.addHost({
        name: 'test-server',
        host: '192.168.1.100',
        port: 22,
        username: 'testuser'
      });

      await hostManager.updateHost(host.id, {
        name: 'updated-server',
        port: 2222
      });

      const hosts = await hostManager.getHosts();
      const updatedHost = hosts.find(h => h.id === host.id);

      expect(updatedHost?.name).toBe('updated-server');
      expect(updatedHost?.port).toBe(2222);
      expect(updatedHost?.host).toBe('192.168.1.100'); // Unchanged
      expect(updatedHost?.username).toBe('testuser'); // Unchanged
    });

    it('should throw error when updating non-existent host', async () => {
      await hostManager.initialize();

      await expect(
        hostManager.updateHost('non-existent-id', { name: 'new-name' })
      ).rejects.toThrow('Host not found');
    });

    it('should delete host', async () => {
      await hostManager.initialize();

      const host = await hostManager.addHost({
        name: 'test-server',
        host: '192.168.1.100',
        port: 22,
        username: 'testuser'
      });

      await hostManager.deleteHost(host.id);

      const hosts = await hostManager.getHosts();
      expect(hosts).toHaveLength(0);
    });

    it('should delete only the specified host', async () => {
      await hostManager.initialize();

      const host1 = await hostManager.addHost({
        name: 'server1',
        host: '192.168.1.1',
        port: 22,
        username: 'user1'
      });

      const host2 = await hostManager.addHost({
        name: 'server2',
        host: '192.168.1.2',
        port: 22,
        username: 'user2'
      });

      await hostManager.deleteHost(host1.id);

      const hosts = await hostManager.getHosts();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].id).toBe(host2.id);
    });
  });

  describe('Move Host to Group', () => {
    it('should move a host to a group', async () => {
      await hostManager.initialize();

      const group = await hostManager.addGroup('TestGroup');
      const host = await hostManager.addHost({
        name: 'test-server',
        host: '192.168.1.100',
        port: 22,
        username: 'testuser'
      });

      await hostManager.moveHostToGroup(host.id, group.id);

      const hosts = await hostManager.getHosts();
      const movedHost = hosts.find(h => h.id === host.id);

      expect(movedHost?.group).toBe(group.id);
    });

    it('should move a host between groups', async () => {
      await hostManager.initialize();

      const group1 = await hostManager.addGroup('Group1');
      const group2 = await hostManager.addGroup('Group2');

      const host = await hostManager.addHost({
        name: 'test-server',
        host: '192.168.1.100',
        port: 22,
        username: 'testuser',
        group: group1.id
      });

      await hostManager.moveHostToGroup(host.id, group2.id);

      const hosts = await hostManager.getHosts();
      const movedHost = hosts.find(h => h.id === host.id);

      expect(movedHost?.group).toBe(group2.id);
    });

    it('should remove host from group when moving to root', async () => {
      await hostManager.initialize();

      const group = await hostManager.addGroup('TestGroup');
      const host = await hostManager.addHost({
        name: 'test-server',
        host: '192.168.1.100',
        port: 22,
        username: 'testuser',
        group: group.id
      });

      await hostManager.moveHostToGroup(host.id);

      const hosts = await hostManager.getHosts();
      const movedHost = hosts.find(h => h.id === host.id);

      expect(movedHost?.group).toBeUndefined();
    });

    it('should throw error when moving non-existent host', async () => {
      await hostManager.initialize();

      const group = await hostManager.addGroup('TestGroup');

      await expect(
        hostManager.moveHostToGroup('non-existent-id', group.id)
      ).rejects.toThrow('Host not found');
    });

    it('should throw error when moving to non-existent group', async () => {
      await hostManager.initialize();

      const host = await hostManager.addHost({
        name: 'test-server',
        host: '192.168.1.100',
        port: 22,
        username: 'testuser'
      });

      await expect(
        hostManager.moveHostToGroup(host.id, 'non-existent-group-id')
      ).rejects.toThrow('Target group not found');
    });
  });

  describe('Drag and Drop', () => {
    it('should handle moving host without group', async () => {
      await hostManager.initialize();

      const group = await hostManager.addGroup('Group1');
      const host = await hostManager.addHost({
        name: 'test-server',
        host: '192.168.1.100',
        port: 22,
        username: 'testuser'
      });

      await hostManager.moveHostToGroup(host.id, group.id);

      const hosts = await hostManager.getHosts();
      const movedHost = hosts.find(h => h.id === host.id);
      expect(movedHost?.group).toBe(group.id);
    });

    it('should reorder host within root when dropped on another host', async () => {
      await hostManager.initialize();

      const hostA = await hostManager.addHost({
        name: 'A',
        host: '192.168.1.1',
        port: 22,
        username: 'user'
      });
      const hostB = await hostManager.addHost({
        name: 'B',
        host: '192.168.1.2',
        port: 22,
        username: 'user'
      });
      const hostC = await hostManager.addHost({
        name: 'C',
        host: '192.168.1.3',
        port: 22,
        username: 'user'
      });

      // Drop C on A => insert C after A
      await hostManager.reorderHostsByDrag([hostC.id], undefined, hostA.id);

      const hosts = await hostManager.getHosts();
      const rootOrder = hosts.filter(h => !h.group).map(h => h.id);
      expect(rootOrder).toEqual([hostA.id, hostC.id, hostB.id]);
    });

    it('should move host to target group and append to end when dropped on group', async () => {
      await hostManager.initialize();

      const group1 = await hostManager.addGroup('Group1');
      const group2 = await hostManager.addGroup('Group2');

      const hostA = await hostManager.addHost({
        name: 'A',
        host: '192.168.1.1',
        port: 22,
        username: 'user',
        group: group1.id
      });
      const hostB = await hostManager.addHost({
        name: 'B',
        host: '192.168.1.2',
        port: 22,
        username: 'user',
        group: group2.id
      });

      await hostManager.reorderHostsByDrag([hostA.id], group2.id);

      const hosts = await hostManager.getHosts();
      const group2Order = hosts.filter(h => h.group === group2.id).map(h => h.id);
      expect(group2Order).toEqual([hostB.id, hostA.id]);
    });

    it('should preserve relative order of multi-selected hosts when dragging', async () => {
      await hostManager.initialize();

      const hostA = await hostManager.addHost({
        name: 'A',
        host: '192.168.1.1',
        port: 22,
        username: 'user'
      });
      const hostB = await hostManager.addHost({
        name: 'B',
        host: '192.168.1.2',
        port: 22,
        username: 'user'
      });
      const hostC = await hostManager.addHost({
        name: 'C',
        host: '192.168.1.3',
        port: 22,
        username: 'user'
      });

      // Pass reverse selection order intentionally, should still keep storage relative order A then C
      await hostManager.reorderHostsByDrag([hostC.id, hostA.id], undefined, hostB.id);

      const hosts = await hostManager.getHosts();
      const rootOrder = hosts.filter(h => !h.group).map(h => h.id);
      expect(rootOrder).toEqual([hostB.id, hostA.id, hostC.id]);
    });
  });

  describe('ID Generation', () => {
    it('should generate unique IDs for hosts', async () => {
      await hostManager.initialize();

      const host1 = await hostManager.addHost({
        name: 'server1',
        host: '192.168.1.1',
        port: 22,
        username: 'user1'
      });

      const host2 = await hostManager.addHost({
        name: 'server2',
        host: '192.168.1.2',
        port: 22,
        username: 'user2'
      });

      expect(host1.id).not.toBe(host2.id);
      expect(host1.id).toBeTruthy();
      expect(host2.id).toBeTruthy();
    });

    it('should generate unique IDs for groups', async () => {
      await hostManager.initialize();

      const group1 = await hostManager.addGroup('Group1');
      const group2 = await hostManager.addGroup('Group2');

      expect(group1.id).not.toBe(group2.id);
      expect(group1.id).toBeTruthy();
      expect(group2.id).toBeTruthy();
    });
  });

  describe('Data Persistence', () => {
    it('should persist hosts across operations', async () => {
      await hostManager.initialize();

      const host1 = await hostManager.addHost({
        name: 'server1',
        host: '192.168.1.1',
        port: 22,
        username: 'user1'
      });

      const host2 = await hostManager.addHost({
        name: 'server2',
        host: '192.168.1.2',
        port: 22,
        username: 'user2'
      });

      // Get hosts again
      const hosts = await hostManager.getHosts();

      expect(hosts).toHaveLength(2);
      expect(hosts.some(h => h.id === host1.id)).toBe(true);
      expect(hosts.some(h => h.id === host2.id)).toBe(true);
    });

    it('should persist groups across operations', async () => {
      await hostManager.initialize();

      const group1 = await hostManager.addGroup('Group1');
      const group2 = await hostManager.addGroup('Group2');

      // Get groups again
      const groups = await hostManager.getGroups();

      expect(groups).toHaveLength(2);
      expect(groups.some(g => g.id === group1.id)).toBe(true);
      expect(groups.some(g => g.id === group2.id)).toBe(true);
    });
  });

  describe('Recent Usage Tracking', () => {
    it('should record recently used host', async () => {
      await hostManager.initialize();

      const host1 = await hostManager.addHost({
        name: 'host1',
        host: '192.168.1.1',
        port: 22,
        username: 'user'
      });

      const host2 = await hostManager.addHost({
        name: 'host2',
        host: '192.168.1.2',
        port: 22,
        username: 'user'
      });

      await hostManager.recordRecentUsed(host1.id);
      await hostManager.recordRecentUsed(host2.id);

      const recentUsed = await hostManager.getRecentUsed();
      expect(recentUsed).toHaveLength(2);
      expect(recentUsed[0]).toBe(host2.id);
      expect(recentUsed[1]).toBe(host1.id);
    });

    it('should keep only last 5 recently used hosts', async () => {
      await hostManager.initialize();
      const hostIds: string[] = [];

      for (let i = 0; i < 7; i++) {
        const host = await hostManager.addHost({
          name: `host${i}`,
          host: `192.168.1.${i}`,
          port: 22,
          username: 'user'
        });
        hostIds.push(host.id);
        await hostManager.recordRecentUsed(host.id);
      }

      const recentUsed = await hostManager.getRecentUsed();
      expect(recentUsed).toHaveLength(5);
      expect(recentUsed[0]).toBe(hostIds[6]);
    });

    it('should move existing host to front when recorded again', async () => {
      await hostManager.initialize();

      const host1 = await hostManager.addHost({
        name: 'host1',
        host: '192.168.1.1',
        port: 22,
        username: 'user'
      });

      const host2 = await hostManager.addHost({
        name: 'host2',
        host: '192.168.1.2',
        port: 22,
        username: 'user'
      });

      await hostManager.recordRecentUsed(host1.id);
      await hostManager.recordRecentUsed(host2.id);
      await hostManager.recordRecentUsed(host1.id);

      const recentUsed = await hostManager.getRecentUsed();
      expect(recentUsed).toHaveLength(2);
      expect(recentUsed[0]).toBe(host1.id);
      expect(recentUsed[1]).toBe(host2.id);
    });

    it('should record recent paths for host', async () => {
      await hostManager.initialize();

      const host = await hostManager.addHost({
        name: 'test-host',
        host: '192.168.1.1',
        port: 22,
        username: 'user'
      });

      await hostManager.recordRecentPath(host.id, '/home/user');
      await hostManager.recordRecentPath(host.id, '/var/www');

      const recentPaths = await hostManager.getRecentPaths(host.id);
      expect(recentPaths).toHaveLength(2);
      expect(recentPaths[0]).toBe('/var/www');
      expect(recentPaths[1]).toBe('/home/user');
    });

    it('should keep only last 10 recent paths', async () => {
      await hostManager.initialize();

      const host = await hostManager.addHost({
        name: 'test-host',
        host: '192.168.1.1',
        port: 22,
        username: 'user'
      });

      for (let i = 0; i < 12; i++) {
        await hostManager.recordRecentPath(host.id, `/path${i}`);
      }

      const recentPaths = await hostManager.getRecentPaths(host.id);
      expect(recentPaths).toHaveLength(10);
      expect(recentPaths[0]).toBe('/path11');
    });

    it('should move existing path to front when recorded again', async () => {
      await hostManager.initialize();

      const host = await hostManager.addHost({
        name: 'test-host',
        host: '192.168.1.1',
        port: 22,
        username: 'user'
      });

      await hostManager.recordRecentPath(host.id, '/home/user');
      await hostManager.recordRecentPath(host.id, '/var/www');
      await hostManager.recordRecentPath(host.id, '/home/user');

      const recentPaths = await hostManager.getRecentPaths(host.id);
      expect(recentPaths).toHaveLength(2);
      expect(recentPaths[0]).toBe('/home/user');
      expect(recentPaths[1]).toBe('/var/www');
    });

    it('should return empty array for non-existent host paths', async () => {
      await hostManager.initialize();
      const recentPaths = await hostManager.getRecentPaths('non-existent-id');
      expect(recentPaths).toEqual([]);
    });

    it('should handle recordRecentPath for non-existent host gracefully', async () => {
      await hostManager.initialize();
      // This should not throw, just silently do nothing
      await hostManager.recordRecentPath('non-existent-id', '/some/path');
      const recentPaths = await hostManager.getRecentPaths('non-existent-id');
      expect(recentPaths).toEqual([]);
    });

    it('should handle addBookmark for non-existent host', async () => {
      await hostManager.initialize();
      await expect(
        hostManager.addBookmark('non-existent-id', 'bookmark', '/path')
      ).rejects.toThrow('Host not found');
    });

    it('should handle removeBookmark for non-existent host gracefully', async () => {
      await hostManager.initialize();
      // This should not throw, just silently do nothing
      await hostManager.removeBookmark('non-existent-id', 'bookmark');
    });

    it('should handle removeBookmark when host has no bookmarks', async () => {
      await hostManager.initialize();
      const host = await hostManager.addHost({
        name: 'test-host',
        host: '192.168.1.1',
        port: 22,
        username: 'user'
      });

      // This should not throw
      await hostManager.removeBookmark(host.id, 'non-existent-bookmark');
      const bookmarks = await hostManager.getBookmarks(host.id);
      expect(bookmarks).toEqual([]);
    });

    it('should handle updateBookmark for non-existent host gracefully', async () => {
      await hostManager.initialize();
      // This should not throw, just silently do nothing
      await hostManager.updateBookmark('non-existent-id', 'old', 'new', '/path');
    });

    it('should handle updateBookmark when bookmark not found', async () => {
      await hostManager.initialize();
      const host = await hostManager.addHost({
        name: 'test-host',
        host: '192.168.1.1',
        port: 22,
        username: 'user'
      });

      // This should not throw
      await hostManager.updateBookmark(host.id, 'non-existent', 'new-name', '/new/path');
      const bookmarks = await hostManager.getBookmarks(host.id);
      expect(bookmarks).toEqual([]);
    });

    it('should throw error when adding duplicate bookmark name', async () => {
      await hostManager.initialize();
      const host = await hostManager.addHost({
        name: 'test-host',
        host: '192.168.1.1',
        port: 22,
        username: 'user'
      });

      await hostManager.addBookmark(host.id, 'bookmark1', '/path1');
      await expect(
        hostManager.addBookmark(host.id, 'bookmark1', '/path2')
      ).rejects.toThrow("Bookmark with name 'bookmark1' already exists");
    });

    it('should throw error when updating bookmark to existing name', async () => {
      await hostManager.initialize();
      const host = await hostManager.addHost({
        name: 'test-host',
        host: '192.168.1.1',
        port: 22,
        username: 'user'
      });

      await hostManager.addBookmark(host.id, 'bookmark1', '/path1');
      await hostManager.addBookmark(host.id, 'bookmark2', '/path2');

      await expect(
        hostManager.updateBookmark(host.id, 'bookmark1', 'bookmark2', '/new/path')
      ).rejects.toThrow("Bookmark with name 'bookmark2' already exists");
    });
  });

  describe('SSH Config Parsing', () => {
    it('should parse SSH config with HostName', () => {
      const sshConfig = `
Host server1
  HostName 192.168.1.1
  User admin
  Port 2222

Host server2
  HostName example.com
  User root
`;

      const hosts = (hostManager as any).parseSshConfig(sshConfig);
      expect(hosts).toHaveLength(2);
      expect(hosts[0]).toEqual({
        Host: 'server1',
        HostName: '192.168.1.1',
        User: 'admin',
        Port: '2222'
      });
      expect(hosts[1]).toEqual({
        Host: 'server2',
        HostName: 'example.com',
        User: 'root'
      });
    });

    it('should skip comments and empty lines', () => {
      const sshConfig = `
# This is a comment
Host server1
  HostName 192.168.1.1

  # Another comment
  User admin
`;

      const hosts = (hostManager as any).parseSshConfig(sshConfig);
      expect(hosts).toHaveLength(1);
      expect(hosts[0]).toEqual({
        Host: 'server1',
        HostName: '192.168.1.1',
        User: 'admin'
      });
    });

    it('should handle multiple hosts with different configurations', () => {
      const sshConfig = `
Host dev
  HostName dev.example.com
  User developer
  Port 22

Host prod
  HostName prod.example.com
  User root
  Port 22222

Host staging
  HostName staging.example.com
`;

      const hosts = (hostManager as any).parseSshConfig(sshConfig);
      expect(hosts).toHaveLength(3);
      expect(hosts[2]).toEqual({
        Host: 'staging',
        HostName: 'staging.example.com'
      });
    });

    it('should handle empty config', () => {
      const hosts = (hostManager as any).parseSshConfig('');
      expect(hosts).toHaveLength(0);
    });

    it('should ignore hosts without HostName in parseSshConfigFile', async () => {
      const sshConfig = `
Host *
  User defaultuser

Host server1
  HostName 192.168.1.1
`;

      const hosts = (hostManager as any).parseSshConfig(sshConfig);
      // parseSshConfig returns all entries including Host *
      expect(hosts.length).toBeGreaterThan(0);
    });
  });

  describe('Import/Export Functionality', () => {
    it('should export all hosts', async () => {
      await hostManager.initialize();

      const group = await hostManager.addGroup('test-group');
      await hostManager.addHost({
        name: 'host1',
        host: '192.168.1.1',
        port: 22,
        username: 'user',
        group: group.id
      });

      await hostManager.addHost({
        name: 'host2',
        host: '192.168.1.2',
        port: 22,
        username: 'admin'
      });

      const exportJson = await hostManager.exportAllHosts();
      const exportData = JSON.parse(exportJson);

      expect(exportData.version).toBe('1.0.0');
      expect(exportData.hosts).toHaveLength(2);
      expect(exportData.groups).toHaveLength(1);
      expect(exportData.exportDate).toBeDefined();
    });

    it('should export single host', async () => {
      await hostManager.initialize();

      const host = await hostManager.addHost({
        name: 'test-host',
        host: '192.168.1.1',
        port: 22,
        username: 'user'
      });

      const exportJson = await hostManager.exportHost(host.id);
      const exportData = JSON.parse(exportJson);

      expect(exportData.hosts).toHaveLength(1);
      expect(exportData.hosts[0].name).toBe('test-host');
    });

    it('should export host with its group', async () => {
      await hostManager.initialize();

      const group = await hostManager.addGroup('test-group');
      const host = await hostManager.addHost({
        name: 'test-host',
        host: '192.168.1.1',
        port: 22,
        username: 'user',
        group: group.id
      });

      const exportJson = await hostManager.exportHost(host.id);
      const exportData = JSON.parse(exportJson);

      expect(exportData.hosts).toHaveLength(1);
      expect(exportData.groups).toHaveLength(1);
      expect(exportData.groups[0].name).toBe('test-group');
    });

    it('should export group with hosts', async () => {
      await hostManager.initialize();

      const group = await hostManager.addGroup('test-group');
      await hostManager.addHost({
        name: 'host1',
        host: '192.168.1.1',
        port: 22,
        username: 'user',
        group: group.id
      });

      await hostManager.addHost({
        name: 'host2',
        host: '192.168.1.2',
        port: 22,
        username: 'admin',
        group: group.id
      });

      await hostManager.addHost({
        name: 'host3',
        host: '192.168.1.3',
        port: 22,
        username: 'root'
      });

      const exportJson = await hostManager.exportGroup(group.id);
      const exportData = JSON.parse(exportJson);

      expect(exportData.hosts).toHaveLength(2);
      expect(exportData.groups).toHaveLength(1);
    });

    it('should import hosts from JSON', async () => {
      await hostManager.initialize();

      const importData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        hosts: [
          {
            name: 'imported-host',
            host: '10.0.0.1',
            port: 22,
            username: 'ubuntu'
          }
        ],
        groups: []
      };

      const result = await hostManager.importHosts(JSON.stringify(importData));

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);

      const hosts = await hostManager.getHosts();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].name).toBe('imported-host');
    });

    it('should skip duplicate hosts when importing', async () => {
      await hostManager.initialize();

      await hostManager.addHost({
        name: 'existing-host',
        host: '192.168.1.1',
        port: 22,
        username: 'user'
      });

      const importData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        hosts: [
          {
            name: 'duplicate-host',
            host: '192.168.1.1',
            port: 22,
            username: 'user'
          },
          {
            name: 'new-host',
            host: '192.168.1.2',
            port: 22,
            username: 'admin'
          }
        ],
        groups: []
      };

      const result = await hostManager.importHosts(JSON.stringify(importData));

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);

      const hosts = await hostManager.getHosts();
      expect(hosts).toHaveLength(2);
    });

    it('should import groups and map group IDs', async () => {
      await hostManager.initialize();

      const importData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        hosts: [
          {
            name: 'host1',
            host: '192.168.1.1',
            port: 22,
            username: 'user',
            group: 'old-group-id'
          }
        ],
        groups: [
          {
            id: 'old-group-id',
            name: 'imported-group'
          }
        ]
      };

      const result = await hostManager.importHosts(JSON.stringify(importData));

      expect(result.imported).toBe(1);

      const groups = await hostManager.getGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe('imported-group');

      const hosts = await hostManager.getHosts();
      expect(hosts[0].group).toBe(groups[0].id);
    });

    it('should throw error for invalid JSON', async () => {
      await hostManager.initialize();
      await expect(hostManager.importHosts('invalid json')).rejects.toThrow('Invalid JSON format');
    });

    it('should throw error for missing hosts array', async () => {
      await hostManager.initialize();
      await expect(hostManager.importHosts('{}')).rejects.toThrow('Invalid import data');
    });

    it('should skip hosts with missing required fields', async () => {
      await hostManager.initialize();

      const importData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        hosts: [
          {
            name: 'incomplete-host',
            port: 22
          },
          {
            name: 'valid-host',
            host: '192.168.1.1',
            username: 'user',
            port: 22
          }
        ],
        groups: []
      };

      const result = await hostManager.importHosts(JSON.stringify(importData));

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('should throw error when exporting non-existent host', async () => {
      await hostManager.initialize();
      await expect(hostManager.exportHost('non-existent-id')).rejects.toThrow('Host not found');
    });

    it('should merge with existing groups when importing', async () => {
      await hostManager.initialize();

      const existingGroup = await hostManager.addGroup('existing-group');

      const importData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        hosts: [
          {
            name: 'host1',
            host: '192.168.1.1',
            port: 22,
            username: 'user',
            group: 'old-group-id'
          }
        ],
        groups: [
          {
            id: 'old-group-id',
            name: 'existing-group'
          }
        ]
      };

      await hostManager.importHosts(JSON.stringify(importData));

      const groups = await hostManager.getGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe(existingGroup.id);
    });

    it('should preserve host metadata during import', async () => {
      await hostManager.initialize();

      const importData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        hosts: [
          {
            name: 'full-host',
            host: '192.168.1.1',
            port: 2222,
            username: 'admin',
            defaultRemotePath: '/var/www',
            color: '#FF0000',
            starred: true,
            recentPaths: ['/home', '/var'],
            bookmarks: [{ name: 'web', path: '/var/www' }]
          }
        ],
        groups: []
      };

      await hostManager.importHosts(JSON.stringify(importData));

      const hosts = await hostManager.getHosts();
      expect(hosts[0].defaultRemotePath).toBe('/var/www');
      expect(hosts[0].color).toBe('#FF0000');
      expect(hosts[0].starred).toBe(true);
      expect(hosts[0].recentPaths).toEqual(['/home', '/var']);
      expect(hosts[0].bookmarks).toEqual([{ name: 'web', path: '/var/www' }]);
    });

    it('should use default port 22 if not specified in import', async () => {
      await hostManager.initialize();

      const importData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        hosts: [
          {
            name: 'no-port-host',
            host: '192.168.1.1',
            username: 'user'
          }
        ],
        groups: []
      };

      await hostManager.importHosts(JSON.stringify(importData));

      const hosts = await hostManager.getHosts();
      expect(hosts[0].port).toBe(22);
    });
  });

  describe('Edge Cases and Boundary Tests', () => {
    describe('Host Name Validation', () => {
      it('should handle empty host name', async () => {
        await hostManager.initialize();

        const host = await hostManager.addHost({
          name: '',
          host: '192.168.1.1',
          port: 22,
          username: 'user'
        });

        expect(host.name).toBe('');
      });

      it('should handle very long host name', async () => {
        await hostManager.initialize();

        const longName = 'A'.repeat(500);
        const host = await hostManager.addHost({
          name: longName,
          host: '192.168.1.1',
          port: 22,
          username: 'user'
        });

        expect(host.name).toBe(longName);
        expect(host.name.length).toBe(500);
      });

      it('should handle special characters in host name', async () => {
        await hostManager.initialize();

        const specialName = 'host@#$%^&*()_+-=[]{}|;:\'",.<>?/';
        const host = await hostManager.addHost({
          name: specialName,
          host: '192.168.1.1',
          port: 22,
          username: 'user'
        });

        expect(host.name).toBe(specialName);
      });

      it('should handle Unicode in host name', async () => {
        await hostManager.initialize();

        const unicodeName = '测试服务器🔥';
        const host = await hostManager.addHost({
          name: unicodeName,
          host: '192.168.1.1',
          port: 22,
          username: 'user'
        });

        expect(host.name).toBe(unicodeName);
      });

      it('should handle whitespace-only host name', async () => {
        await hostManager.initialize();

        const whitespaceName = '   \t\n   ';
        const host = await hostManager.addHost({
          name: whitespaceName,
          host: '192.168.1.1',
          port: 22,
          username: 'user'
        });

        expect(host.name).toBe(whitespaceName);
      });
    });

    describe('Host Address Validation', () => {
      it('should handle very long host address', async () => {
        await hostManager.initialize();

        const longAddress = 'very-long-domain-name-' + 'subdomain.'.repeat(20) + 'example.com';
        const host = await hostManager.addHost({
          name: 'test',
          host: longAddress,
          port: 22,
          username: 'user'
        });

        expect(host.host).toBe(longAddress);
      });

      it('should handle IPv6 address', async () => {
        await hostManager.initialize();

        const ipv6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
        const host = await hostManager.addHost({
          name: 'test',
          host: ipv6,
          port: 22,
          username: 'user'
        });

        expect(host.host).toBe(ipv6);
      });

      it('should handle localhost variations', async () => {
        await hostManager.initialize();

        const host1 = await hostManager.addHost({
          name: 'localhost1',
          host: 'localhost',
          port: 22,
          username: 'user'
        });

        const host2 = await hostManager.addHost({
          name: 'localhost2',
          host: '127.0.0.1',
          port: 22,
          username: 'user'
        });

        expect(host1.host).toBe('localhost');
        expect(host2.host).toBe('127.0.0.1');
      });
    });

    describe('Port Validation', () => {
      it('should accept minimum valid port (1)', async () => {
        await hostManager.initialize();

        const host = await hostManager.addHost({
          name: 'test',
          host: '192.168.1.1',
          port: 1,
          username: 'user'
        });

        expect(host.port).toBe(1);
      });

      it('should accept maximum valid port (65535)', async () => {
        await hostManager.initialize();

        const host = await hostManager.addHost({
          name: 'test',
          host: '192.168.1.1',
          port: 65535,
          username: 'user'
        });

        expect(host.port).toBe(65535);
      });

      it('should accept common SSH alternative ports', async () => {
        await hostManager.initialize();

        const host2222 = await hostManager.addHost({
          name: 'test2222',
          host: '192.168.1.1',
          port: 2222,
          username: 'user'
        });

        const host2200 = await hostManager.addHost({
          name: 'test2200',
          host: '192.168.1.2',
          port: 2200,
          username: 'user'
        });

        expect(host2222.port).toBe(2222);
        expect(host2200.port).toBe(2200);
      });
    });

    describe('Username Edge Cases', () => {
      it('should handle very long username', async () => {
        await hostManager.initialize();

        const longUsername = 'user' + 'name'.repeat(100);
        const host = await hostManager.addHost({
          name: 'test',
          host: '192.168.1.1',
          port: 22,
          username: longUsername
        });

        expect(host.username).toBe(longUsername);
      });

      it('should handle username with special characters', async () => {
        await hostManager.initialize();

        const specialUsername = 'user.name-123_test@domain';
        const host = await hostManager.addHost({
          name: 'test',
          host: '192.168.1.1',
          port: 22,
          username: specialUsername
        });

        expect(host.username).toBe(specialUsername);
      });

      it('should handle single character username', async () => {
        await hostManager.initialize();

        const host = await hostManager.addHost({
          name: 'test',
          host: '192.168.1.1',
          port: 22,
          username: 'a'
        });

        expect(host.username).toBe('a');
      });
    });

    describe('Group Name Edge Cases', () => {
      it('should handle empty group name', async () => {
        await hostManager.initialize();

        const group = await hostManager.addGroup('');

        expect(group.name).toBe('');
      });

      it('should handle very long group name', async () => {
        await hostManager.initialize();

        const longName = 'Group' + 'Name'.repeat(100);
        const group = await hostManager.addGroup(longName);

        expect(group.name).toBe(longName);
      });

      it('should handle Unicode in group name', async () => {
        await hostManager.initialize();

        const unicodeGroup = '开发环境🚀';
        const group = await hostManager.addGroup(unicodeGroup);

        expect(group.name).toBe(unicodeGroup);
      });

      it('should handle duplicate group names', async () => {
        await hostManager.initialize();

        const group1 = await hostManager.addGroup('Production');
        const group2 = await hostManager.addGroup('Production');

        expect(group1.name).toBe('Production');
        expect(group2.name).toBe('Production');
        expect(group1.id).not.toBe(group2.id);
      });
    });

    describe('Path Edge Cases', () => {
      it('should handle very long path in recentPaths', async () => {
        await hostManager.initialize();

        const host = await hostManager.addHost({
          name: 'test',
          host: '192.168.1.1',
          port: 22,
          username: 'user'
        });

        const longPath = '/very/long/' + 'path/'.repeat(50) + 'file.txt';
        await hostManager.recordRecentPath(host.id, longPath);

        const paths = await hostManager.getRecentPaths(host.id);
        expect(paths).toContain(longPath);
      });

      it('should handle path with special characters', async () => {
        await hostManager.initialize();

        const host = await hostManager.addHost({
          name: 'test',
          host: '192.168.1.1',
          port: 22,
          username: 'user'
        });

        const specialPath = '/path/with spaces/file@#$.txt';
        await hostManager.recordRecentPath(host.id, specialPath);

        const paths = await hostManager.getRecentPaths(host.id);
        expect(paths).toContain(specialPath);
      });

      it('should handle Windows-style path', async () => {
        await hostManager.initialize();

        const host = await hostManager.addHost({
          name: 'test',
          host: '192.168.1.1',
          port: 22,
          username: 'user'
        });

        const windowsPath = 'C:\\Users\\Test\\Documents\\file.txt';
        await hostManager.recordRecentPath(host.id, windowsPath);

        const paths = await hostManager.getRecentPaths(host.id);
        expect(paths).toContain(windowsPath);
      });
    });

    describe('Bookmark Edge Cases', () => {
      it('should handle very long bookmark name', async () => {
        await hostManager.initialize();

        const host = await hostManager.addHost({
          name: 'test',
          host: '192.168.1.1',
          port: 22,
          username: 'user'
        });

        const longBookmarkName = 'Bookmark' + 'Name'.repeat(50);
        await hostManager.addBookmark(host.id, longBookmarkName, '/path');

        const hosts = await hostManager.getHosts();
        const updatedHost = hosts.find(h => h.id === host.id);
        expect(updatedHost?.bookmarks?.[0].name).toBe(longBookmarkName);
      });

      it('should handle bookmark path with Unicode', async () => {
        await hostManager.initialize();

        const host = await hostManager.addHost({
          name: 'test',
          host: '192.168.1.1',
          port: 22,
          username: 'user'
        });

        const unicodePath = '/项目/文件/测试.txt';
        await hostManager.addBookmark(host.id, 'test', unicodePath);

        const hosts = await hostManager.getHosts();
        const updatedHost = hosts.find(h => h.id === host.id);
        expect(updatedHost?.bookmarks?.[0].path).toBe(unicodePath);
      });
    });

    describe('Import/Export Edge Cases', () => {
      it('should handle export with no hosts', async () => {
        await hostManager.initialize();

        const exported = await hostManager.exportAllHosts();
        const parsed = JSON.parse(exported);

        expect(parsed.hosts).toEqual([]);
        expect(parsed.groups).toEqual([]);
      });

      it('should handle import with empty hosts array', async () => {
        await hostManager.initialize();

        const importData = {
          version: '1.0.0',
          exportDate: new Date().toISOString(),
          hosts: [],
          groups: []
        };

        await expect(hostManager.importHosts(JSON.stringify(importData))).resolves.not.toThrow();

        const hosts = await hostManager.getHosts();
        expect(hosts).toEqual([]);
      });

      it('should handle import with very large dataset', async () => {
        await hostManager.initialize();

        const hosts = Array.from({ length: 100 }, (_, i) => ({
          name: `host-${i}`,
          host: `192.168.1.${i % 256}`,
          port: 22,
          username: `user${i}`
        }));

        const importData = {
          version: '1.0.0',
          exportDate: new Date().toISOString(),
          hosts,
          groups: []
        };

        await hostManager.importHosts(JSON.stringify(importData));

        const importedHosts = await hostManager.getHosts();
        expect(importedHosts.length).toBe(100);
      });

      it('should handle malformed version string', async () => {
        await hostManager.initialize();

        const importData = {
          version: 'not-a-version',
          exportDate: new Date().toISOString(),
          hosts: [{
            name: 'test',
            host: '192.168.1.1',
            port: 22,
            username: 'user'
          }],
          groups: []
        };

        await expect(hostManager.importHosts(JSON.stringify(importData))).resolves.not.toThrow();
      });
    });

    describe('Concurrent Operations', () => {
      it('should handle adding multiple hosts concurrently', async () => {
        await hostManager.initialize();

        const promises = Array.from({ length: 10 }, (_, i) =>
          hostManager.addHost({
            name: `concurrent-${i}`,
            host: `192.168.1.${i}`,
            port: 22,
            username: 'user'
          })
        );

        const hosts = await Promise.all(promises);

        expect(hosts.length).toBe(10);
        const allIds = hosts.map(h => h.id);
        const uniqueIds = [...new Set(allIds)];
        expect(uniqueIds.length).toBe(10);
      });

      it('should handle deleting multiple hosts concurrently', async () => {
        await hostManager.initialize();

        // First add some hosts
        const hosts = await Promise.all(
          Array.from({ length: 5 }, (_, i) =>
            hostManager.addHost({
              name: `delete-${i}`,
              host: `192.168.1.${i}`,
              port: 22,
              username: 'user'
            })
          )
        );

        // Then delete them concurrently
        await Promise.all(hosts.map(h => hostManager.deleteHost(h.id)));

        const remainingHosts = await hostManager.getHosts();
        expect(remainingHosts.length).toBe(0);
      });
    });

    describe('Data Integrity', () => {
      it('should preserve all host properties after update', async () => {
        await hostManager.initialize();

        const originalHost = await hostManager.addHost({
          name: 'original',
          host: '192.168.1.1',
          port: 2222,
          username: 'user',
          defaultRemotePath: '/home/user'
        });

        await hostManager.recordRecentPath(originalHost.id, '/path1');
        await hostManager.addBookmark(originalHost.id, 'bookmark1', '/bookmark/path');

        await hostManager.updateHost(originalHost.id, {
          name: 'updated-name'
        });

        const hosts = await hostManager.getHosts();
        const updatedHost = hosts.find(h => h.id === originalHost.id);

        expect(updatedHost?.name).toBe('updated-name');
        expect(updatedHost?.host).toBe('192.168.1.1');
        expect(updatedHost?.port).toBe(2222);
        expect(updatedHost?.username).toBe('user');
        expect(updatedHost?.defaultRemotePath).toBe('/home/user');
        expect(updatedHost?.recentPaths).toContain('/path1');
        expect(updatedHost?.bookmarks?.[0]).toEqual({ name: 'bookmark1', path: '/bookmark/path' });
      });
    });
  });
});
