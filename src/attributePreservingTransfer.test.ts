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

  describe('Edge Cases - File Permissions', () => {
    it('should handle read-only file permissions (0o444)', async () => {
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
        mode: 0o444,
        atimeMs: 1700000000000,
        mtimeMs: 1700000000000
      } as fs.Stats);

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/readonly.txt',
        '/remote/readonly.txt',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      expect(mockSftp.chmod).toHaveBeenCalledWith('/remote/readonly.txt', 0o444);
    });

    it('should handle executable file permissions (0o755)', async () => {
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
        mode: 0o755,
        atimeMs: 1700000000000,
        mtimeMs: 1700000000000
      } as fs.Stats);

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/script.sh',
        '/remote/script.sh',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      expect(mockSftp.chmod).toHaveBeenCalledWith('/remote/script.sh', 0o755);
    });

    it('should handle restrictive permissions (0o600)', async () => {
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
        mode: 0o600,
        atimeMs: 1700000000000,
        mtimeMs: 1700000000000
      } as fs.Stats);

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/private.key',
        '/remote/private.key',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      expect(mockSftp.chmod).toHaveBeenCalledWith('/remote/private.key', 0o600);
    });

    it('should handle full permissions (0o777)', async () => {
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
        mode: 0o777,
        atimeMs: 1700000000000,
        mtimeMs: 1700000000000
      } as fs.Stats);

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/public.txt',
        '/remote/public.txt',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      expect(mockSftp.chmod).toHaveBeenCalledWith('/remote/public.txt', 0o777);
    });
  });

  describe('Edge Cases - Timestamps', () => {
    it('should skip timestamp preservation for zero timestamps', async () => {
      const mockSftp = {
        stat: vi.fn().mockResolvedValue({
          isSymbolicLink: false,
          isFile: true,
          mode: 0o644,
          atime: 0, // Zero timestamps are falsy
          mtime: 0
        }),
        fastGet: vi.fn().mockResolvedValue(undefined)
      };

      await AttributePreservingTransfer.downloadWithAttributes(
        mockSftp as any,
        '/remote/old.txt',
        '/local/old.txt',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      // utimesSync should not be called for zero timestamps
      expect(fs.utimesSync).not.toHaveBeenCalled();
    });

    it('should handle future timestamps', async () => {
      const futureTime = Math.floor(Date.now() / 1000) + 86400 * 365; // 1 year in future
      const mockSftp = {
        stat: vi.fn().mockResolvedValue({
          isSymbolicLink: false,
          isFile: true,
          mode: 0o644,
          atime: futureTime,
          mtime: futureTime
        }),
        fastGet: vi.fn().mockResolvedValue(undefined)
      };

      await AttributePreservingTransfer.downloadWithAttributes(
        mockSftp as any,
        '/remote/future.txt',
        '/local/future.txt',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      // Should convert to Date objects
      expect(fs.utimesSync).toHaveBeenCalledWith(
        '/local/future.txt',
        new Date(futureTime * 1000),
        new Date(futureTime * 1000)
      );
    });

    it('should handle timestamps with millisecond precision', async () => {
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
        mode: 0o644,
        atimeMs: 1700000000123.456,
        mtimeMs: 1700000000789.012
      } as fs.Stats);

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/precise.txt',
        '/remote/precise.txt',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      expect(mockSftp.sftp.setstat).toHaveBeenCalled();
    });
  });

  describe('Edge Cases - Symlinks', () => {
    it('should handle broken symlinks (target does not exist)', async () => {
      const mockSftp = {
        symlink: vi.fn().mockResolvedValue(undefined)
      };

      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
        isFile: () => false,
        isDirectory: () => false
      } as fs.Stats);

      vi.mocked(fs.readlinkSync).mockReturnValue('/nonexistent/target');

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/broken-link',
        '/remote/broken-link',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      expect(mockSftp.symlink).toHaveBeenCalledWith('/nonexistent/target', '/remote/broken-link');
    });

    it('should handle relative symlink paths', async () => {
      const mockSftp = {
        symlink: vi.fn().mockResolvedValue(undefined)
      };

      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
        isFile: () => false
      } as fs.Stats);

      vi.mocked(fs.readlinkSync).mockReturnValue('../relative/target.txt');

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/rel-link',
        '/remote/rel-link',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      expect(mockSftp.symlink).toHaveBeenCalledWith('../relative/target.txt', '/remote/rel-link');
    });

    it('should handle absolute symlink paths', async () => {
      const mockSftp = {
        symlink: vi.fn().mockResolvedValue(undefined)
      };

      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
        isFile: () => false
      } as fs.Stats);

      vi.mocked(fs.readlinkSync).mockReturnValue('/absolute/path/to/target');

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/abs-link',
        '/remote/abs-link',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      expect(mockSftp.symlink).toHaveBeenCalledWith('/absolute/path/to/target', '/remote/abs-link');
    });

    it('should create local symlink with relative path', async () => {
      const mockSftp = {
        stat: vi.fn().mockResolvedValue({
          isSymbolicLink: true,
          isFile: false
        }),
        readlink: vi.fn().mockResolvedValue('../../../target.txt')
      };

      vi.mocked(fs.symlinkSync).mockImplementation(() => {});

      await AttributePreservingTransfer.downloadWithAttributes(
        mockSftp as any,
        '/remote/rel-symlink',
        '/local/rel-symlink',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      expect(fs.symlinkSync).toHaveBeenCalledWith('../../../target.txt', '/local/rel-symlink');
    });
  });

  describe('Edge Cases - Error Handling', () => {
    it('should handle chmod failure gracefully', async () => {
      const mockSftp = {
        fastPut: vi.fn().mockResolvedValue(undefined),
        chmod: vi.fn().mockRejectedValue(new Error('Permission denied')),
        sftp: {
          setstat: vi.fn((path, attrs, callback) => callback(null))
        }
      };

      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => false,
        isFile: () => true,
        mode: 0o644,
        atimeMs: 1700000000000,
        mtimeMs: 1700000000000
      } as fs.Stats);

      // Should not throw even if chmod fails
      await expect(
        AttributePreservingTransfer.uploadWithAttributes(
          mockSftp as any,
          '/local/file.txt',
          '/remote/file.txt',
          { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
        )
      ).resolves.not.toThrow();
    });

    it('should handle timestamp setting failure gracefully', async () => {
      const mockSftp = {
        fastPut: vi.fn().mockResolvedValue(undefined),
        chmod: vi.fn().mockResolvedValue(undefined),
        sftp: {
          setstat: vi.fn((path, attrs, callback) => callback(new Error('Failed to set timestamps')))
        }
      };

      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => false,
        isFile: () => true,
        mode: 0o644,
        atimeMs: 1700000000000,
        mtimeMs: 1700000000000
      } as fs.Stats);

      // Should not throw even if setstat fails
      await expect(
        AttributePreservingTransfer.uploadWithAttributes(
          mockSftp as any,
          '/local/file.txt',
          '/remote/file.txt',
          { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
        )
      ).resolves.not.toThrow();
    });

    it('should handle local chmod failure when downloading', async () => {
      const mockSftp = {
        stat: vi.fn().mockResolvedValue({
          isSymbolicLink: false,
          isFile: true,
          mode: 0o644,
          atime: 1700000000,
          mtime: 1700000000
        }),
        fastGet: vi.fn().mockResolvedValue(undefined)
      };

      vi.mocked(fs.chmodSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Should not throw even if chmod fails
      await expect(
        AttributePreservingTransfer.downloadWithAttributes(
          mockSftp as any,
          '/remote/file.txt',
          '/local/file.txt',
          { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
        )
      ).resolves.not.toThrow();
    });

    it('should handle local utimes failure when downloading', async () => {
      const mockSftp = {
        stat: vi.fn().mockResolvedValue({
          isSymbolicLink: false,
          isFile: true,
          mode: 0o644,
          atime: 1700000000,
          mtime: 1700000000
        }),
        fastGet: vi.fn().mockResolvedValue(undefined)
      };

      vi.mocked(fs.chmodSync).mockImplementation(() => {});
      vi.mocked(fs.utimesSync).mockImplementation(() => {
        throw new Error('Failed to set timestamps');
      });

      // Should not throw even if utimesSync fails
      await expect(
        AttributePreservingTransfer.downloadWithAttributes(
          mockSftp as any,
          '/remote/file.txt',
          '/local/file.txt',
          { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
        )
      ).resolves.not.toThrow();
    });

    it('should throw on symlink creation failure', async () => {
      const mockSftp = {
        stat: vi.fn().mockResolvedValue({
          isSymbolicLink: true,
          isFile: false
        }),
        readlink: vi.fn().mockResolvedValue('/target')
      };

      vi.mocked(fs.symlinkSync).mockImplementation(() => {
        throw new Error('Symlink creation failed');
      });

      // Should throw when symlink creation fails
      await expect(
        AttributePreservingTransfer.downloadWithAttributes(
          mockSftp as any,
          '/remote/link',
          '/local/link',
          { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
        )
      ).rejects.toThrow('Symlink creation failed');
    });
  });

  describe('Edge Cases - Path Handling', () => {
    it('should handle paths with spaces', async () => {
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
        mode: 0o644,
        atimeMs: 1700000000000,
        mtimeMs: 1700000000000
      } as fs.Stats);

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/path with spaces/file.txt',
        '/remote/path with spaces/file.txt',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      expect(mockSftp.fastPut).toHaveBeenCalledWith(
        '/local/path with spaces/file.txt',
        '/remote/path with spaces/file.txt'
      );
    });

    it('should handle paths with special characters', async () => {
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
        mode: 0o644,
        atimeMs: 1700000000000,
        mtimeMs: 1700000000000
      } as fs.Stats);

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/file@#$%.txt',
        '/remote/file@#$%.txt',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      expect(mockSftp.fastPut).toHaveBeenCalled();
    });

    it('should handle very long paths', async () => {
      const longPath = '/very/long/' + 'path/'.repeat(50) + 'file.txt';
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
        mode: 0o644,
        atimeMs: 1700000000000,
        mtimeMs: 1700000000000
      } as fs.Stats);

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        longPath,
        longPath,
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      expect(mockSftp.fastPut).toHaveBeenCalled();
    });

    it('should handle Unicode in paths', async () => {
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
        mode: 0o644,
        atimeMs: 1700000000000,
        mtimeMs: 1700000000000
      } as fs.Stats);

      await AttributePreservingTransfer.uploadWithAttributes(
        mockSftp as any,
        '/local/文件/测试.txt',
        '/remote/文件/测试.txt',
        { preservePermissions: true, preserveTimestamps: true, followSymlinks: false }
      );

      expect(mockSftp.fastPut).toHaveBeenCalled();
    });
  });
});
