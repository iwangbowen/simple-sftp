import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { AttributePreservingTransfer } from './attributePreservingTransfer';

// Mock vscode module
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, defaultValue: any) => {
        if (key === 'preservePermissions') {return true;}
        if (key === 'preserveTimestamps') {return true;}
        if (key === 'followSymlinks') {return false;}
        return defaultValue;
      })
    }))
  }
}));

// Mock logger
vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('AttributePreservingTransfer', () => {
  describe('getOptionsFromConfig', () => {
    it('should return default configuration options', () => {
      const options = AttributePreservingTransfer.getOptionsFromConfig();

      expect(options).toEqual({
        preservePermissions: true,
        preserveTimestamps: true,
        followSymlinks: false
      });
    });
  });

  describe('isSymbolicLink', () => {
    it('should detect symbolic links', () => {
      const lstatSyncSpy = vi.spyOn(fs, 'lstatSync').mockReturnValue({
        isSymbolicLink: () => true
      } as fs.Stats);

      const result = AttributePreservingTransfer.isSymbolicLink('/path/to/symlink');

      expect(result).toBe(true);
      expect(lstatSyncSpy).toHaveBeenCalledWith('/path/to/symlink');

      lstatSyncSpy.mockRestore();
    });

    it('should return false for regular files', () => {
      const lstatSyncSpy = vi.spyOn(fs, 'lstatSync').mockReturnValue({
        isSymbolicLink: () => false
      } as fs.Stats);

      const result = AttributePreservingTransfer.isSymbolicLink('/path/to/file.txt');

      expect(result).toBe(false);
      lstatSyncSpy.mockRestore();
    });

    it('should return false if file does not exist', () => {
      const lstatSyncSpy = vi.spyOn(fs, 'lstatSync').mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const result = AttributePreservingTransfer.isSymbolicLink('/nonexistent/path');

      expect(result).toBe(false);
      lstatSyncSpy.mockRestore();
    });
  });

  describe('isRemoteSymbolicLink', () => {
    it('should detect remote symbolic links', async () => {
      const mockSftp = {
        stat: vi.fn().mockResolvedValue({
          isSymbolicLink: true
        })
      };

      const result = await AttributePreservingTransfer.isRemoteSymbolicLink(
        mockSftp as any,
        '/remote/path/symlink'
      );

      expect(result).toBe(true);
      expect(mockSftp.stat).toHaveBeenCalledWith('/remote/path/symlink');
    });

    it('should return false for regular remote files', async () => {
      const mockSftp = {
        stat: vi.fn().mockResolvedValue({
          isSymbolicLink: false
        })
      };

      const result = await AttributePreservingTransfer.isRemoteSymbolicLink(
        mockSftp as any,
        '/remote/path/file.txt'
      );

      expect(result).toBe(false);
    });

    it('should return false if remote file does not exist', async () => {
      const mockSftp = {
        stat: vi.fn().mockRejectedValue(new Error('No such file'))
      };

      const result = await AttributePreservingTransfer.isRemoteSymbolicLink(
        mockSftp as any,
        '/nonexistent/remote/path'
      );

      expect(result).toBe(false);
    });
  });

  describe('uploadWithAttributes', () => {
    it('should upload regular file and preserve attributes', async () => {
      const mockSftp = {
        fastPut: vi.fn().mockResolvedValue(undefined),
        chmod: vi.fn().mockResolvedValue(undefined),
        sftp: {
          setstat: vi.fn((path, attrs, callback) => callback(null))
        }
      };

      const lstatSyncSpy = vi.spyOn(fs, 'lstatSync').mockReturnValue({
        isSymbolicLink: () => false,
        isFile: () => true,
        isDirectory: () => false,
        mode: 0o644,
        atimeMs: 1700000000000,
        mtimeMs: 1700000000000
      } as fs.Stats);

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/file.txt',
        '/remote/file.txt',
        {
          preservePermissions: true,
          preserveTimestamps: true,
          followSymlinks: false
        }
      );

      expect(mockSftp.fastPut).toHaveBeenCalledWith('/local/file.txt', '/remote/file.txt');
      expect(mockSftp.chmod).toHaveBeenCalledWith('/remote/file.txt', 0o644);

      lstatSyncSpy.mockRestore();
    });

    it('should skip attribute preservation when disabled', async () => {
      const mockSftp = {
        fastPut: vi.fn().mockResolvedValue(undefined),
        chmod: vi.fn(),
        sftp: { setstat: vi.fn() }
      };

      const lstatSyncSpy = vi.spyOn(fs, 'lstatSync').mockReturnValue({
        isSymbolicLink: () => false,
        isFile: () => true,
        isDirectory: () => false,
        mode: 0o644
      } as fs.Stats);

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/file.txt',
        '/remote/file.txt',
        {
          preservePermissions: false,
          preserveTimestamps: false,
          followSymlinks: false
        }
      );

      expect(mockSftp.fastPut).toHaveBeenCalled();
      expect(mockSftp.chmod).not.toHaveBeenCalled();
      expect(mockSftp.sftp.setstat).not.toHaveBeenCalled();

      lstatSyncSpy.mockRestore();
    });

    it('should create symlink when followSymlinks is false', async () => {
      const mockSftp = {
        symlink: vi.fn().mockResolvedValue(undefined)
      };

      const lstatSyncSpy = vi.spyOn(fs, 'lstatSync').mockReturnValue({
        isSymbolicLink: () => true,
        isFile: () => false,
        isDirectory: () => false
      } as fs.Stats);

      const readlinkSyncSpy = vi.spyOn(fs, 'readlinkSync').mockReturnValue('/target/file.txt');

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/symlink',
        '/remote/symlink',
        {
          preservePermissions: true,
          preserveTimestamps: true,
          followSymlinks: false
        }
      );

      expect(mockSftp.symlink).toHaveBeenCalledWith('/target/file.txt', '/remote/symlink');

      lstatSyncSpy.mockRestore();
      readlinkSyncSpy.mockRestore();
    });
  });

  describe('downloadWithAttributes', () => {
    it('should download regular file and apply attributes', async () => {
      const mockSftp = {
        stat: vi.fn().mockResolvedValue({
          isSymbolicLink: false,
          isFile: true,
          isDirectory: false,
          mode: 0o755,
          atime: 1700000000,
          mtime: 1700000000,
          size: 1024
        }),
        fastGet: vi.fn().mockResolvedValue(undefined)
      };

      const chmodSyncSpy = vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});
      const utimesSyncSpy = vi.spyOn(fs, 'utimesSync').mockImplementation(() => {});

      await AttributePreservingTransfer.downloadWithAttributes(
        mockSftp as any,
        '/remote/file.txt',
        '/local/file.txt',
        {
          preservePermissions: true,
          preserveTimestamps: true,
          followSymlinks: false
        }
      );

      expect(mockSftp.fastGet).toHaveBeenCalledWith('/remote/file.txt', '/local/file.txt');
      expect(chmodSyncSpy).toHaveBeenCalledWith('/local/file.txt', 0o755);
      expect(utimesSyncSpy).toHaveBeenCalled();

      chmodSyncSpy.mockRestore();
      utimesSyncSpy.mockRestore();
    });

    it('should skip attribute application when disabled', async () => {
      const mockSftp = {
        stat: vi.fn().mockResolvedValue({
          isSymbolicLink: false,
          isFile: true,
          isDirectory: false,
          mode: 0o755
        }),
        fastGet: vi.fn().mockResolvedValue(undefined)
      };

      const chmodSyncSpy = vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});
      const utimesSyncSpy = vi.spyOn(fs, 'utimesSync').mockImplementation(() => {});

      await AttributePreservingTransfer.downloadWithAttributes(
        mockSftp as any,
        '/remote/file.txt',
        '/local/file.txt',
        {
          preservePermissions: false,
          preserveTimestamps: false,
          followSymlinks: false
        }
      );

      expect(mockSftp.fastGet).toHaveBeenCalled();
      expect(chmodSyncSpy).not.toHaveBeenCalled();
      expect(utimesSyncSpy).not.toHaveBeenCalled();

      chmodSyncSpy.mockRestore();
      utimesSyncSpy.mockRestore();
    });

    it('should create local symlink when followSymlinks is false', async () => {
      const mockSftp = {
        stat: vi.fn().mockResolvedValue({
          isSymbolicLink: true,
          isFile: false,
          isDirectory: false
        }),
        readlink: vi.fn().mockResolvedValue('/remote/target/file.txt')
      };

      const symlinkSyncSpy = vi.spyOn(fs, 'symlinkSync').mockImplementation(() => {});

      await AttributePreservingTransfer.downloadWithAttributes(
        mockSftp as any,
        '/remote/symlink',
        '/local/symlink',
        {
          preservePermissions: true,
          preserveTimestamps: true,
          followSymlinks: false
        }
      );

      expect(mockSftp.readlink).toHaveBeenCalledWith('/remote/symlink');
      expect(symlinkSyncSpy).toHaveBeenCalledWith('/remote/target/file.txt', '/local/symlink');

      symlinkSyncSpy.mockRestore();
    });
  });
});
