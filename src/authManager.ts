import * as vscode from 'vscode';
import { HostAuthConfig } from './types';

/**
 * Authentication manager using SecretStorage
 * Stores authentication credentials locally (not synced)
 */
export class AuthManager {
  private static readonly AUTH_STORAGE_KEY = 'hostAuthConfigs';
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Get authentication config for a host
   */
  async getAuth(hostId: string): Promise<HostAuthConfig | undefined> {
    const allAuth = await this.loadAllAuth();
    return allAuth.find(auth => auth.hostId === hostId);
  }

  /**
   * Save or update authentication config for a host
   */
  async saveAuth(auth: HostAuthConfig): Promise<void> {
    const allAuth = await this.loadAllAuth();
    const index = allAuth.findIndex(a => a.hostId === auth.hostId);

    if (index >= 0) {
      allAuth[index] = auth;
    } else {
      allAuth.push(auth);
    }

    await this.saveAllAuth(allAuth);
  }

  /**
   * Delete authentication config for a host
   */
  async deleteAuth(hostId: string): Promise<void> {
    const allAuth = await this.loadAllAuth();
    const filtered = allAuth.filter(a => a.hostId !== hostId);
    await this.saveAllAuth(filtered);
  }

  /**
   * Check if a host has authentication configured
   */
  async hasAuth(hostId: string): Promise<boolean> {
    const auth = await this.getAuth(hostId);
    return auth !== undefined;
  }

  /**
   * Load all authentication configs from SecretStorage
   */
  private async loadAllAuth(): Promise<HostAuthConfig[]> {
    const json = await this.context.secrets.get(AuthManager.AUTH_STORAGE_KEY);
    if (!json) {
      return [];
    }

    try {
      return JSON.parse(json);
    } catch (error) {
      console.error('Failed to parse authentication configs:', error);
      return [];
    }
  }

  /**
   * Save all authentication configs to SecretStorage
   */
  private async saveAllAuth(configs: HostAuthConfig[]): Promise<void> {
    await this.context.secrets.store(
      AuthManager.AUTH_STORAGE_KEY,
      JSON.stringify(configs)
    );
  }
}
