import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HostConfig, GroupConfig, StorageData, SshConfigEntry } from './types';
import { logger } from './logger';

/**
 * Host configuration manager
 * Uses globalState with setKeysForSync for cross-device sync
 */
export class HostManager {
  private static readonly STORAGE_KEY = 'hostConfigs';
  private context: vscode.ExtensionContext;
  private cachedData: StorageData | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Initialize storage and enable sync
   */
  async initialize(): Promise<void> {
    // Register the storage key for Settings Sync
    this.context.globalState.setKeysForSync([HostManager.STORAGE_KEY]);

    // Log sync configuration
    const data = await this.loadData();
    logger.info('=== Simple SCP Sync Configuration ===');
    logger.info(`Sync Key: ${HostManager.STORAGE_KEY}`);
    logger.info(`Hosts: ${data.hosts.length}, Groups: ${data.groups.length}`);
    if (data.hosts.length > 0) {
      logger.info('Host List:');
      data.hosts.forEach(h => {
        const group = h.group ? ` [${h.group}]` : '';
        logger.info(`  ${h.name} - ${h.username}@${h.host}:${h.port}${group}`);
      });
    }
  }

  /**
   * Get all host configurations
   */
  async getHosts(): Promise<HostConfig[]> {
    const data = await this.loadData();
    return data.hosts;
  }

  /**
   * Get all groups
   */
  async getGroups(): Promise<GroupConfig[]> {
    const data = await this.loadData();
    return data.groups;
  }

  /**
   * Add host
   */
  async addHost(host: Omit<HostConfig, 'id'>): Promise<HostConfig> {
    const data = await this.loadData();
    const newHost: HostConfig = {
      ...host,
      id: this.generateId(),
    };
    data.hosts.push(newHost);
    await this.saveData(data);
    return newHost;
  }

  /**
   * Update host
   */
  async updateHost(id: string, updates: Partial<HostConfig>): Promise<void> {
    const data = await this.loadData();
    const index = data.hosts.findIndex(h => h.id === id);
    if (index === -1) {
      throw new Error('Host not found');
    }
    data.hosts[index] = { ...data.hosts[index], ...updates };
    await this.saveData(data);
  }

  /**
   * Delete host
   */
  async deleteHost(id: string): Promise<void> {
    const data = await this.loadData();
    data.hosts = data.hosts.filter(h => h.id !== id);
    await this.saveData(data);
  }

  /**
   * Add group
   */
  async addGroup(name: string): Promise<GroupConfig> {
    const data = await this.loadData();
    const newGroup: GroupConfig = {
      id: this.generateId(),
      name,
    };
    data.groups.push(newGroup);
    await this.saveData(data);
    return newGroup;
  }

  /**
   * Update group
   */
  async updateGroup(id: string, name: string): Promise<void> {
    const data = await this.loadData();
    const index = data.groups.findIndex(g => g.id === id);
    if (index === -1) {
      throw new Error('Group not found');
    }
    data.groups[index].name = name;
    await this.saveData(data);
  }

  /**
   * Delete group
   */
  async deleteGroup(id: string): Promise<void> {
    const data = await this.loadData();
    data.groups = data.groups.filter(g => g.id !== id);
    data.hosts.forEach(host => {
      if (host.group === id) {
        delete host.group;
      }
    });
    await this.saveData(data);
  }

  /**
   * Move host to a different group (or remove from group)
   */
  async moveHostToGroup(hostId: string, targetGroupId?: string): Promise<void> {
    const data = await this.loadData();
    const host = data.hosts.find(h => h.id === hostId);

    if (!host) {
      throw new Error('Host not found');
    }

    // If targetGroupId is provided, verify the group exists
    if (targetGroupId) {
      const groupExists = data.groups.some(g => g.id === targetGroupId);
      if (!groupExists) {
        throw new Error('Target group not found');
      }
      host.group = targetGroupId;
    } else {
      // Remove from group (move to root)
      delete host.group;
    }

    await this.saveData(data);
    logger.info(`Moved host ${host.name} to ${targetGroupId ? 'group ' + targetGroupId : 'root'}`);
  }

  /**
   * Parse SSH config file and return host configurations (without adding to storage)
   */
  async parseSshConfigFile(): Promise<Omit<HostConfig, 'id'>[]> {
    const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');

    if (!fs.existsSync(sshConfigPath)) {
      throw new Error(`SSH config file not found at: ${sshConfigPath}\n\nCreate one to use the import feature, or add hosts manually.`);
    }

    const configContent = fs.readFileSync(sshConfigPath, 'utf-8');
    const entries = this.parseSshConfig(configContent);

    const hosts: Omit<HostConfig, 'id'>[] = [];

    for (const entry of entries) {
      if (!entry.HostName) {
        continue;
      }

      // Import only basic info, no authentication
      // User needs to configure authentication separately
      hosts.push({
        name: entry.Host,
        host: entry.HostName,
        port: entry.Port ? parseInt(entry.Port) : 22,
        username: entry.User || 'root',
      });
    }

    return hosts;
  }

  /**
   * Import hosts from SSH config file
   */
  async importFromSshConfig(): Promise<HostConfig[]> {
    const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');

    if (!fs.existsSync(sshConfigPath)) {
      throw new Error(`SSH config file not found at: ${sshConfigPath}\n\nCreate one to use the import feature, or add hosts manually.`);
    }

    const configContent = fs.readFileSync(sshConfigPath, 'utf-8');
    const entries = this.parseSshConfig(configContent);

    const importedHosts: HostConfig[] = [];
    const data = await this.loadData();

    for (const entry of entries) {
      if (!entry.HostName) {
        continue;
      }

      const exists = data.hosts.some(
        h => h.host === entry.HostName && h.username === (entry.User || 'root')
      );

      if (!exists) {
        // Only import basic host information, authentication will be configured separately
        const newHost: HostConfig = {
          id: this.generateId(),
          name: entry.Host,
          host: entry.HostName,
          port: entry.Port ? parseInt(entry.Port) : 22,
          username: entry.User || 'root',
        };
        data.hosts.push(newHost);
        importedHosts.push(newHost);
      }
    }

    if (importedHosts.length > 0) {
      await this.saveData(data);
    }

    return importedHosts;
  }

  /**
   * Parse SSH config file
   */
  private parseSshConfig(content: string): SshConfigEntry[] {
    const entries: SshConfigEntry[] = [];
    let currentEntry: SshConfigEntry | null = null;

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const hostMatch = trimmed.match(/^Host\s+(.+)$/i);
      if (hostMatch) {
        if (currentEntry) {
          entries.push(currentEntry);
        }
        currentEntry = { Host: hostMatch[1].trim() };
        continue;
      }

      const keyValueMatch = trimmed.match(/^(\w+)\s+(.+)$/);
      if (keyValueMatch && currentEntry) {
        const [, key, value] = keyValueMatch;
        currentEntry[key] = value.trim();
      }
    }

    if (currentEntry) {
      entries.push(currentEntry);
    }

    return entries;
  }

  /**
   * Load data
   */
  private async loadData(): Promise<StorageData> {
    const data = this.context.globalState.get<StorageData>(HostManager.STORAGE_KEY);
    this.cachedData = data || { hosts: [], groups: [], recentUsed: [] };
    return this.cachedData;
  }

  /**
   * Get hosts synchronously (from cache)
   */
  getHostsSync(): HostConfig[] {
    return this.cachedData?.hosts || [];
  }

  /**
   * Get groups synchronously (from cache)
   */
  getGroupsSync(): GroupConfig[] {
    return this.cachedData?.groups || [];
  }

  /**
   * Save data
   */
  private async saveData(data: StorageData): Promise<void> {
    this.cachedData = data;
    await this.context.globalState.update(HostManager.STORAGE_KEY, data);
    logger.info(`Data saved and synced: ${data.hosts.length} hosts, ${data.groups.length} groups`);
  }

  /**
   * Record a host as recently used (for upload or download)
   */
  async recordRecentUsed(hostId: string): Promise<void> {
    const data = await this.loadData();
    data.recentUsed ??= [];

    // Remove if already exists
    data.recentUsed = data.recentUsed.filter(id => id !== hostId);

    // Add to front
    data.recentUsed.unshift(hostId);

    // Keep only last 5
    if (data.recentUsed.length > 5) {
      data.recentUsed = data.recentUsed.slice(0, 5);
    }

    await this.saveData(data);
  }

  /**
   * Get recently used host IDs (for upload or download)
   */
  async getRecentUsed(): Promise<string[]> {
    const data = await this.loadData();
    return data.recentUsed || [];
  }

  /**
   * Record a recently used path for a specific host
   */
  async recordRecentPath(hostId: string, remotePath: string): Promise<void> {
    const data = await this.loadData();
    const host = data.hosts.find(h => h.id === hostId);

    if (!host) {
      return;
    }

    host.recentPaths ??= [];

    // Remove if already exists
    host.recentPaths = host.recentPaths.filter(p => p !== remotePath);

    // Add to front
    host.recentPaths.unshift(remotePath);

    // Keep only last 10 paths
    if (host.recentPaths.length > 10) {
      host.recentPaths = host.recentPaths.slice(0, 10);
    }

    await this.saveData(data);
  }

  /**
   * Get recent paths for a specific host
   */
  async getRecentPaths(hostId: string): Promise<string[]> {
    const data = await this.loadData();
    const host = data.hosts.find(h => h.id === hostId);
    return host?.recentPaths || [];
  }

  /**
   * Add a path bookmark for a specific host
   */
  async addBookmark(hostId: string, name: string, path: string, description?: string): Promise<void> {
    const data = await this.loadData();
    const host = data.hosts.find(h => h.id === hostId);

    if (!host) {
      throw new Error(`Host not found: ${hostId}`);
    }

    host.bookmarks ??= [];

    // Check if bookmark with same name already exists
    if (host.bookmarks.some(b => b.name === name)) {
      throw new Error(`Bookmark with name '${name}' already exists`);
    }

    host.bookmarks.push({ name, path, description });
    await this.saveData(data);
  }

  /**
   * Remove a path bookmark for a specific host
   */
  async removeBookmark(hostId: string, name: string): Promise<void> {
    const data = await this.loadData();
    const host = data.hosts.find(h => h.id === hostId);

    if (!host) {
      return;
    }

    if (!host.bookmarks) {
      return;
    }

    host.bookmarks = host.bookmarks.filter(b => b.name !== name);
    await this.saveData(data);
  }

  /**
   * Get all bookmarks for a specific host
   */
  async getBookmarks(hostId: string): Promise<Array<{ name: string; path: string }>> {
    const data = await this.loadData();
    const host = data.hosts.find(h => h.id === hostId);
    return host?.bookmarks || [];
  }

  /**
   * Update a bookmark (rename or change path)
   */
  async updateBookmark(hostId: string, oldName: string, newName: string, newPath: string, newDescription?: string): Promise<void> {
    const data = await this.loadData();
    const host = data.hosts.find(h => h.id === hostId);

    if (!host || !host.bookmarks) {
      return;
    }

    const bookmark = host.bookmarks.find(b => b.name === oldName);
    if (!bookmark) {
      return;
    }

    // Check if new name conflicts with existing bookmark (excluding the one being updated)
    if (newName !== oldName && host.bookmarks.some(b => b.name === newName)) {
      throw new Error(`Bookmark with name '${newName}' already exists`);
    }

    bookmark.name = newName;
    bookmark.path = newPath;
    bookmark.description = newDescription;
    await this.saveData(data);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Export configuration format
   */
  private createExportData(hosts: HostConfig[], groups: GroupConfig[]) {
    return {
      version: '1.0.0',
      exportDate: new Date().toISOString(),
      hosts: hosts.map(h => ({
        name: h.name,
        host: h.host,
        port: h.port,
        username: h.username,
        group: h.group,
        defaultRemotePath: h.defaultRemotePath,
        color: h.color,
        starred: h.starred,
        recentPaths: h.recentPaths,
        bookmarks: h.bookmarks
      })),
      groups: groups.map(g => ({
        id: g.id,
        name: g.name
      }))
    };
  }

  /**
   * Export all hosts to JSON format
   */
  async exportAllHosts(): Promise<string> {
    const data = await this.loadData();
    const exportData = this.createExportData(data.hosts, data.groups);
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Export hosts in a specific group
   */
  async exportGroup(groupId: string): Promise<string> {
    const data = await this.loadData();
    const hostsInGroup = data.hosts.filter(h => h.group === groupId);
    const group = data.groups.find(g => g.id === groupId);
    const groups = group ? [group] : [];

    const exportData = this.createExportData(hostsInGroup, groups);
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Export a single host
   */
  async exportHost(hostId: string): Promise<string> {
    const data = await this.loadData();
    const host = data.hosts.find(h => h.id === hostId);

    if (!host) {
      throw new Error('Host not found');
    }

    // Include the group if the host belongs to one
    const groups: GroupConfig[] = [];
    if (host.group) {
      const group = data.groups.find(g => g.id === host.group);
      if (group) {
        groups.push(group);
      }
    }

    const exportData = this.createExportData([host], groups);
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import hosts from JSON data
   * Returns: { imported: number, skipped: number, message: string }
   */
  async importHosts(jsonData: string): Promise<{ imported: number; skipped: number; message: string }> {
    let importData: any;

    try {
      importData = JSON.parse(jsonData);
    } catch (error: any) {
      throw new Error(`Invalid JSON format: ${error.message || 'Unknown error'}`);
    }

    // Validate format
    if (!importData.hosts || !Array.isArray(importData.hosts)) {
      throw new Error('Invalid import data: missing or invalid hosts array');
    }

    const data = await this.loadData();
    let imported = 0;
    let skipped = 0;
    const skippedHosts: string[] = [];

    // Import groups first (merge if exists)
    const groupIdMapping: Map<string, string> = new Map();
    if (importData.groups && Array.isArray(importData.groups)) {
      for (const importGroup of importData.groups) {
        const existingGroup = data.groups.find(g => g.name === importGroup.name);
        if (existingGroup) {
          // Group exists, use existing ID
          groupIdMapping.set(importGroup.id, existingGroup.id);
        } else {
          // Create new group
          const newGroupId = this.generateId();
          data.groups.push({
            id: newGroupId,
            name: importGroup.name
          });
          groupIdMapping.set(importGroup.id, newGroupId);
        }
      }
    }

    // Import hosts
    for (const importHost of importData.hosts) {
      // Validate required fields
      if (!importHost.host || !importHost.username) {
        skipped++;
        continue;
      }

      // Check if host already exists (by username@host:port)
      const port = importHost.port || 22;
      const exists = data.hosts.some(
        h => h.host === importHost.host &&
             h.username === importHost.username &&
             h.port === port
      );

      if (exists) {
        skipped++;
        skippedHosts.push(`${importHost.name} (${importHost.username}@${importHost.host}:${port})`);
        continue;
      }

      // Map group ID if needed
      let groupId = importHost.group;
      if (groupId && groupIdMapping.has(groupId)) {
        groupId = groupIdMapping.get(groupId);
      }

      // Add new host
      const newHost: HostConfig = {
        id: this.generateId(),
        name: importHost.name || `${importHost.username}@${importHost.host}`,
        host: importHost.host,
        port: port,
        username: importHost.username,
        group: groupId,
        defaultRemotePath: importHost.defaultRemotePath,
        color: importHost.color,
        starred: importHost.starred || false,
        recentPaths: importHost.recentPaths || [],
        bookmarks: importHost.bookmarks || []
      };

      data.hosts.push(newHost);
      imported++;
    }

    // Save changes
    await this.saveData(data);

    // Generate result message
    let message = `Successfully imported ${imported} host(s)`;
    if (skipped > 0) {
      message += `, skipped ${skipped} duplicate host(s)`;
      if (skippedHosts.length > 0 && skippedHosts.length <= 5) {
        message += `:\n${skippedHosts.join('\n')}`;
      }
    }

    return { imported, skipped, message };
  }
}
