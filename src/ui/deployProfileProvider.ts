import * as vscode from 'vscode';
import { DeployProfile } from '../types';
import { DeployProfileService } from '../services/deployProfileService';
import { HostManager } from '../hostManager';

// --------------------------------------------------------------------------
// Tree Item
// --------------------------------------------------------------------------

export class DeployProfileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly profile: DeployProfile,
    private readonly hostName: string
  ) {
    super(profile.name, vscode.TreeItemCollapsibleState.None);

    this.description = `${hostName}:${profile.remoteRoot}`;
    this.tooltip = DeployProfileTreeItem.buildTooltip(profile, hostName);
    let iconId: string;
    if (!profile.enabled) {
      iconId = 'circle-slash';
    } else if (profile.uploadOnSave) {
      iconId = 'cloud-upload';
    } else {
      iconId = 'remote';
    }
    this.iconPath = new vscode.ThemeIcon(iconId);

    let contextValue: string;
    if (!profile.enabled) {
      contextValue = 'deployProfile.disabled';
    } else if (profile.uploadOnSave) {
      contextValue = 'deployProfile.enabled.uploadOnSave';
    } else {
      contextValue = 'deployProfile.enabled';
    }
    this.contextValue = contextValue;

    this.command = {
      command: 'simpleSftp.editDeployProfile',
      title: 'Edit Deploy Profile',
      arguments: [profile.id],
    };
  }

  private static buildTooltip(profile: DeployProfile, hostName: string): string {
    const lines = [
      `Name: ${profile.name}`,
      `Host: ${hostName}`,
      `Local: ${profile.localRoot}`,
      `Remote: ${profile.remoteRoot}`,
      `Upload on Save: ${profile.uploadOnSave ? 'ON' : 'OFF'}`,
      `Enabled: ${profile.enabled ? 'Yes' : 'No'}`,
      `Conflict: ${profile.conflictStrategy}`,
      `Confirm: ${profile.confirmBeforeUpload}`,
    ];
    if (profile.excludePatterns.length > 0) {
      lines.push(`Exclude: ${profile.excludePatterns.slice(0, 3).join(', ')}${profile.excludePatterns.length > 3 ? ', …' : ''}`);
    }
    return lines.join('\n');
  }
}

// --------------------------------------------------------------------------
// Tree Data Provider
// --------------------------------------------------------------------------

export class DeployProfileProvider implements vscode.TreeDataProvider<DeployProfileTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<DeployProfileTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly deployProfileService: DeployProfileService,
    private readonly hostManager: HostManager
  ) {
    deployProfileService.onDidChangeProfiles(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: DeployProfileTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<DeployProfileTreeItem[]> {
    const profiles = this.deployProfileService.getAll();
    if (profiles.length === 0) {
      return [];
    }
    const hosts = await this.hostManager.getHosts();
    const hostMap = new Map(hosts.map(h => [h.id, h.name]));

    return profiles.map(profile => {
      const hostName = hostMap.get(profile.hostId) ?? profile.hostId;
      return new DeployProfileTreeItem(profile, hostName);
    });
  }
}
