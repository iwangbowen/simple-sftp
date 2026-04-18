import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { UploadOnSaveService } from './uploadOnSaveService';
import { DeployProfile } from '../types';

// Mock SshConnectionManager statically
vi.mock('../sshConnectionManager', () => ({
  SshConnectionManager: {
    getRemoteFileStat: vi.fn(),
  },
}));

// Mock node:fs — only stub existsSync
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

function buildProfile(overrides: Partial<DeployProfile> = {}): DeployProfile {
  return {
    id: 'dp-1',
    name: 'Test',
    hostId: 'h1',
    localRoot: '/workspace/project',
    remoteRoot: '/var/www',
    uploadOnSave: true,
    excludePatterns: ['node_modules/**', '.git/**'],
    confirmBeforeUpload: 'never',
    conflictStrategy: 'overwrite',
    scopeToWorkspace: true,
    enabled: true,
    syncMode: 'uploadChanged',
    compareMethod: 'mtime',
    deleteRemote: false,
    preserveTimestamps: false,
    ...overrides,
  };
}

describe('UploadOnSaveService', () => {
  let service: UploadOnSaveService;
  let mockDeployProfileService: any;
  let mockTransferQueueService: any;
  let mockHostManager: any;
  let mockAuthManager: any;

  beforeEach(() => {
    mockDeployProfileService = {
      getById: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
      getActiveUploadOnSaveProfiles: vi.fn().mockReturnValue([]),
      onDidChangeProfiles: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    };

    mockTransferQueueService = {
      addTask: vi.fn(),
    };

    mockHostManager = {
      getHosts: vi.fn().mockResolvedValue([
        { id: 'h1', name: 'TestHost', host: '192.168.1.1', port: 22, defaultRemotePath: '/var/www' },
      ]),
    };

    mockAuthManager = {
      getAuth: vi.fn().mockResolvedValue({ type: 'password', credential: 'mock-value' }),
    };

    service = new UploadOnSaveService(
      mockDeployProfileService,
      mockTransferQueueService,
      mockHostManager,
      mockAuthManager
    );
  });

  afterEach(() => {
    service.dispose();
  });

  // --------------------------------------------------------------------------
  // Glob matching (public for testability)
  // --------------------------------------------------------------------------
  describe('isExcluded', () => {
    const patterns = ['node_modules/**', '.git/**', '**/*.log', '**/dist/**', '**/.DS_Store'];

    it('should exclude node_modules paths', () => {
      expect(service.isExcluded('node_modules/package/index.js', patterns)).toBe(true);
    });

    it('should exclude .git paths', () => {
      expect(service.isExcluded('.git/config', patterns)).toBe(true);
    });

    it('should exclude *.log files anywhere', () => {
      expect(service.isExcluded('logs/app.log', patterns)).toBe(true);
      expect(service.isExcluded('app.log', patterns)).toBe(true);
    });

    it('should exclude dist directory', () => {
      expect(service.isExcluded('dist/bundle.js', patterns)).toBe(true);
      expect(service.isExcluded('src/dist/out.js', patterns)).toBe(true);
    });

    it('should exclude .DS_Store', () => {
      expect(service.isExcluded('.DS_Store', patterns)).toBe(true);
      expect(service.isExcluded('subdir/.DS_Store', patterns)).toBe(true);
    });

    it('should not exclude normal source files', () => {
      expect(service.isExcluded('src/index.ts', patterns)).toBe(false);
      expect(service.isExcluded('package.json', patterns)).toBe(false);
      expect(service.isExcluded('README.md', patterns)).toBe(false);
    });
  });

  describe('matchGlob', () => {
    it('should match ** globstar', () => {
      expect(service.matchGlob('a/b/c.js', '**/*.js')).toBe(true);
    });

    it('should match single *', () => {
      expect(service.matchGlob('index.ts', '*.ts')).toBe(true);
      // * does NOT cross /, so src/index.ts doesn't match *.ts at root
      expect(service.matchGlob('src/index.ts', '*.ts')).toBe(false);
    });

    it('should match ? wildcard', () => {
      expect(service.matchGlob('a.ts', '?.ts')).toBe(true);
      expect(service.matchGlob('ab.ts', '?.ts')).toBe(false);
    });

    it('should match exact filename patterns', () => {
      expect(service.matchGlob('.DS_Store', '.DS_Store')).toBe(true);
    });

    it('should handle invalid patterns gracefully', () => {
      expect(service.matchGlob('test', '[')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // uploadAll
  // --------------------------------------------------------------------------
  describe('uploadAll', () => {
    it('should show error if profile not found', async () => {
      mockDeployProfileService.getById.mockReturnValue(undefined);
      await service.uploadAll('nope');
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('not found'),
      );
    });

    it('should queue a directory upload for valid profile', async () => {
      const profile = buildProfile();
      mockDeployProfileService.getById.mockReturnValue(profile);

      await service.uploadAll('dp-1');

      expect(mockTransferQueueService.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'upload',
          hostId: 'h1',
          isDirectory: true,
          localPath: '/workspace/project',
          remotePath: '/var/www',
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // dispose
  // --------------------------------------------------------------------------
  describe('dispose', () => {
    it('should not throw when called', () => {
      expect(() => service.dispose()).not.toThrow();
    });
  });
});
