import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostConfig } from '../types';
import { DualPanelBase } from './dualPanelBase';
import { DualPanelEditorManager, buildDualPanelEditorTarget } from './dualPanelEditorProvider';

describe('DualPanelEditorManager', () => {
  const host: HostConfig = {
    id: 'host-1',
    name: 'Prod',
    host: 'prod.example.com',
    port: 22,
    username: 'deploy'
  };

  const transferQueueService = {
    onQueueChanged: vi.fn(),
    onTaskUpdated: vi.fn(),
    getActiveTaskCount: vi.fn(() => 0)
  } as any;

  const authManager = {
    getAuth: vi.fn(async () => ({ authType: 'password', password: 'secret' }))
  } as any;

  const hostManager = {
    getHosts: vi.fn(async () => [host])
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(DualPanelBase.prototype, 'openForHost').mockResolvedValue(undefined);
    vi.spyOn(DualPanelBase.prototype as any, 'getHtmlForWebview').mockReturnValue('<html></html>');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a distinct editor target for bookmark contexts', () => {
    const rootTarget = buildDualPanelEditorTarget(host);
    const bookmarkTarget = buildDualPanelEditorTarget(host, '/srv/app/logs', {
      tabLabel: 'Logs',
      contextKey: 'bookmark:Logs'
    });

    expect(rootTarget.panelKey).toBe('host-1::root');
    expect(rootTarget.title).toBe('Prod');
    expect(bookmarkTarget.panelKey).toBe('host-1::bookmark:Logs');
    expect(bookmarkTarget.title).toBe('Prod · Logs');
  });

  it('opens separate tabs for different bookmark contexts on the same host', async () => {
    const manager = new DualPanelEditorManager(
      vscode.Uri.file('/extension'),
      transferQueueService,
      authManager,
      hostManager
    );

    await manager.openForHost(host, '/srv/app', {
      tabLabel: 'App',
      contextKey: 'bookmark:App'
    });
    await manager.openForHost(host, '/srv/logs', {
      tabLabel: 'Logs',
      contextKey: 'bookmark:Logs'
    });

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(manager.getPanelCount()).toBe(2);
  });

  it('reuses the same tab when the bookmark context matches', async () => {
    const manager = new DualPanelEditorManager(
      vscode.Uri.file('/extension'),
      transferQueueService,
      authManager,
      hostManager
    );

    await manager.openForHost(host, '/srv/app', {
      tabLabel: 'App',
      contextKey: 'bookmark:App'
    });
    await manager.openForHost(host, '/srv/app', {
      tabLabel: 'App',
      contextKey: 'bookmark:App'
    });

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(manager.getPanelCount()).toBe(1);

    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]?.value as any;
    expect(panel.reveal).toHaveBeenCalledTimes(1);
    expect(DualPanelBase.prototype.openForHost).toHaveBeenCalledTimes(2);
  });
});
