import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeployProfileService } from './deployProfileService';
import { DEPLOY_PROFILE } from '../constants';
import { DeployProfile } from '../types';

function createMockContext() {
  const store = new Map<string, unknown>();
  return {
    workspaceState: {
      get: vi.fn((key: string, defaultValue?: unknown) => store.get(key) ?? defaultValue),
      update: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
      keys: vi.fn(() => [...store.keys()]),
    },
    subscriptions: [],
    // other fields not needed
  } as any;
}

describe('DeployProfileService', () => {
  let service: DeployProfileService;
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
    service = new DeployProfileService(ctx);
  });

  // --------------------------------------------------------------------------
  // buildDefaults
  // --------------------------------------------------------------------------
  describe('buildDefaults', () => {
    it('should return a profile with correct defaults', () => {
      const d = DeployProfileService.buildDefaults('test', 'h1', '/local', '/remote');
      expect(d.name).toBe('test');
      expect(d.hostId).toBe('h1');
      expect(d.localRoot).toBe('/local');
      expect(d.remoteRoot).toBe('/remote');
      expect(d.uploadOnSave).toBe(true);
      expect(d.enabled).toBe(true);
      expect(d.scopeToWorkspace).toBe(true);
      expect(d.excludePatterns).toEqual(expect.arrayContaining(['node_modules/**']));
    });
  });

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------
  describe('create', () => {
    it('should create a profile and persist it', async () => {
      const defaults = DeployProfileService.buildDefaults('prod', 'h1', '/src', '/var/www');
      const profile = await service.create(defaults);

      expect(profile.id).toBeDefined();
      expect(profile.name).toBe('prod');
      expect(service.getAll()).toHaveLength(1);
      expect(ctx.workspaceState.update).toHaveBeenCalledWith(
        DEPLOY_PROFILE.STORAGE_KEY,
        expect.arrayContaining([expect.objectContaining({ name: 'prod' })]),
      );
    });
  });

  describe('getById', () => {
    it('should return undefined for nonexistent id', () => {
      expect(service.getById('nope')).toBeUndefined();
    });

    it('should return the correct profile', async () => {
      const p = await service.create(
        DeployProfileService.buildDefaults('a', 'h1', '/l', '/r'),
      );
      expect(service.getById(p.id)).toEqual(p);
    });
  });

  describe('update', () => {
    it('should update an existing profile', async () => {
      const p = await service.create(
        DeployProfileService.buildDefaults('b', 'h1', '/l', '/r'),
      );
      const updated = await service.update(p.id, { name: 'renamed' });
      expect(updated.name).toBe('renamed');
      expect(service.getById(p.id)!.name).toBe('renamed');
    });

    it('should throw on nonexistent id', async () => {
      await expect(service.update('bad', { name: 'x' })).rejects.toThrow('not found');
    });
  });

  describe('delete', () => {
    it('should remove the profile', async () => {
      const p = await service.create(
        DeployProfileService.buildDefaults('c', 'h1', '/l', '/r'),
      );
      await service.delete(p.id);
      expect(service.getAll()).toHaveLength(0);
    });
  });

  describe('toggle', () => {
    it('should flip enabled flag', async () => {
      const p = await service.create(
        DeployProfileService.buildDefaults('d', 'h1', '/l', '/r'),
      );
      expect(p.enabled).toBe(true);
      const toggled = await service.toggle(p.id);
      expect(toggled.enabled).toBe(false);
    });

    it('should throw on missing id', async () => {
      await expect(service.toggle('none')).rejects.toThrow();
    });
  });

  describe('toggleUploadOnSave', () => {
    it('should flip uploadOnSave flag', async () => {
      const p = await service.create(
        DeployProfileService.buildDefaults('e', 'h1', '/l', '/r'),
      );
      expect(p.uploadOnSave).toBe(true);
      const toggled = await service.toggleUploadOnSave(p.id);
      expect(toggled.uploadOnSave).toBe(false);
    });
  });

  describe('getActiveUploadOnSaveProfiles', () => {
    it('should return only enabled + uploadOnSave profiles', async () => {
      await service.create(
        DeployProfileService.buildDefaults('active', 'h1', '/l', '/r'),
      );
      const p2 = await service.create(
        DeployProfileService.buildDefaults('disabled', 'h1', '/l', '/r'),
      );
      await service.update(p2.id, { enabled: false });

      const active = service.getActiveUploadOnSaveProfiles();
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('active');
    });
  });

  // --------------------------------------------------------------------------
  // Events
  // --------------------------------------------------------------------------
  describe('onDidChangeProfiles', () => {
    it('should fire when profiles change', async () => {
      const listener = vi.fn();
      service.onDidChangeProfiles(listener);

      await service.create(
        DeployProfileService.buildDefaults('f', 'h1', '/l', '/r'),
      );

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
