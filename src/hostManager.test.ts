import { describe, it, expect, beforeEach } from 'vitest';
import { HostManager } from './hostManager';
import * as vscode from 'vscode';

describe('HostManager', () => {
  let hostManager: HostManager;
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    mockContext = new vscode.ExtensionContext();
    hostManager = new HostManager(mockContext);
  });

  describe('Group Management', () => {
    it('should create a new group', async () => {
      await hostManager.initialize();

      const groupName = 'TestGroup';
      await hostManager.addGroup(groupName);

      const groups = await hostManager.getGroups();
      const groupNames = groups.map(g => g.name);
      expect(groupNames).toContain(groupName);
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

      const hosts = await hostManager.getHosts();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].name).toBe(hostName);
      expect(hosts[0].id).toBe(newHost.id);
    });

    it('should move a host to another group', async () => {
      await hostManager.initialize();

      // Create two groups
      const group1 = await hostManager.addGroup('Group1');
      const group2 = await hostManager.addGroup('Group2');

      // Add a host to group1
      const host = await hostManager.addHost({
        name: 'test-server',
        host: '192.168.1.100',
        port: 22,
        username: 'testuser',
        group: group1.id
      });

      // Move host to group2
      await hostManager.moveHostToGroup(host.id, group2.id);

      // Verify host is in group2
      const hosts = await hostManager.getHosts();
      const movedHost = hosts.find(h => h.id === host.id);

      expect(movedHost).toBeDefined();
      expect(movedHost?.group).toBe(group2.id);
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
  });
});
