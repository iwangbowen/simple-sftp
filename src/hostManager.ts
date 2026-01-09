import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HostConfig, GroupConfig, StorageData, SshConfigEntry } from './types';

/**
 * Host configuration manager
 * Uses globalState with setKeysForSync for cross-device sync
 */
export class HostManager {
  private static readonly STORAGE_KEY = 'hostConfigs';
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Initialize storage and enable sync
   */
  async initialize(): Promise<void> {
    // Register the storage key for Settings Sync
    this.context.globalState.setKeysForSync([HostManager.STORAGE_KEY]);
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
    return data || { hosts: [], groups: [] };
  }

  /**
   * Save data
   */
  private async saveData(data: StorageData): Promise<void> {
    await this.context.globalState.update(HostManager.STORAGE_KEY, data);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
