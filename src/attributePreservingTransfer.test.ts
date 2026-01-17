import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { AttributePreservingTransfer } from './attributePreservingTransfer';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    lstatSync: vi.fn(),
    readlinkSync: vi.fn(),
    realpathSync: vi.fn(),
    statSync: vi.fn(),
    chmodSync: vi.fn(),
    utimesSync: vi.fn(),
    symlinkSync: vi.fn(),
  };
});

// Mock logger
vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('AttributePreservingTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOptionsFromConfig', () => {
    it('should return default configuration options', () => {
      const options = AttributePreservingTransfer.getOptionsFromConfig();

      // Since vscode is not available in tests, should return defaults
      expect(options).toEqual({
        preservePermissions: true,
        preserveTimestamps: true,
        followSymlinks: false
      });
    });
  });

  describe('isSymbolicLink', () => {
    it('should detect symbolic links', () => {
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true
      } as fs.Stats);

      const result = AttributePreservingTransfer.isSymbolicLink('/path/to/symlink');

      expect(result).toBe(true);
      expect(fs.lstatSync).toHaveBeenCalledWith('/path/to/symlink');
    });

    it('should return false for regular files', () => {
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => false
      } as fs.Stats);

      const result = AttributePreservingTransfer.isSymbolicLink('/path/to/file.txt');

      expect(result).toBe(false);
    });

    it('should return false if file does not exist', () => {
      vi.mocked(fs.lstatSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const result = AttributePreservingTransfer.isSymbolicLink('/nonexistent/path');

      expect(result).toBe(false);
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

      vi.mocked(fs.lstatSync).mockReturnValue({
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
    });

    it('should skip attribute preservation when disabled', async () => {
      const mockSftp = {
        fastPut: vi.fn().mockResolvedValue(undefined),
        chmod: vi.fn(),
        sftp: { setstat: vi.fn() }
      };

      vi.mocked(fs.lstatSync).mockReturnValue({
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
    });

    it('should create symlink when followSymlinks is false', async () => {
      const mockSftp = {
        symlink: vi.fn().mockResolvedValue(undefined)
      };

      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
        isFile: () => false,
        isDirectory: () => false
      } as fs.Stats);

      vi.mocked(fs.readlinkSync).mockReturnValue('/target/file.txt');

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

      vi.mocked(fs.chmodSync).mockImplementation(() => {});
      vi.mocked(fs.utimesSync).mockImplementation(() => {});

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
      expect(fs.chmodSync).toHaveBeenCalledWith('/local/file.txt', 0o755);
      expect(fs.utimesSync).toHaveBeenCalled();
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

      vi.mocked(fs.chmodSync).mockImplementation(() => {});
      vi.mocked(fs.utimesSync).mockImplementation(() => {});

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
      expect(fs.chmodSync).not.toHaveBeenCalled();
      expect(fs.utimesSync).not.toHaveBeenCalled();
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

      vi.mocked(fs.symlinkSync).mockImplementation(() => {});

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
      expect(fs.symlinkSync).toHaveBeenCalledWith('/remote/target/file.txt', '/local/symlink');
    });
  });
});
