import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeltaSyncManager, FileInfo, SyncOptions } from './deltaSyncManager';

// Mock SFTP Client
const createMockSftpClient = () => ({
  exists: vi.fn(),
  stat: vi.fn(),
  fastPut: vi.fn(),
  list: vi.fn(),
  mkdir: vi.fn(),
  delete: vi.fn(),
});

describe('DeltaSyncManager', () => {
  let mockSftpClient: ReturnType<typeof createMockSftpClient>;

  beforeEach(() => {
    mockSftpClient = createMockSftpClient();
  });

  describe('calculateDiff', () => {
    it('should detect new files', () => {
      const localFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/local/file1.txt', size: 100, mtime: Date.now(), isDirectory: false }],
        ['file2.txt', { path: '/local/file2.txt', size: 200, mtime: Date.now(), isDirectory: false }]
      ]);

      const remoteFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/remote/file1.txt', size: 100, mtime: Date.now(), isDirectory: false }]
      ]);

      const diff = (DeltaSyncManager as any).calculateDiff(localFiles, remoteFiles);

      expect(diff.toUpload).toHaveLength(1);
      expect(diff.toUpload[0].path).toBe('file2.txt');
      expect(diff.toUpload[0].reason).toBe('new');
      expect(diff.unchanged).toHaveLength(1);
    });

    it('should detect modified files', () => {
      const now = Date.now();
      const localFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/local/file1.txt', size: 100, mtime: now, isDirectory: false }]
      ]);

      const remoteFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/remote/file1.txt', size: 200, mtime: now - 5000, isDirectory: false }]
      ]);

      const diff = (DeltaSyncManager as any).calculateDiff(localFiles, remoteFiles);

      expect(diff.toUpload).toHaveLength(1);
      expect(diff.toUpload[0].path).toBe('file1.txt');
      expect(diff.toUpload[0].reason).toBe('size_mismatch');
    });

    it('should detect deleted files when deleteRemote is enabled', () => {
      const localFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/local/file1.txt', size: 100, mtime: Date.now(), isDirectory: false }]
      ]);

      const remoteFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/remote/file1.txt', size: 100, mtime: Date.now(), isDirectory: false }],
        ['file2.txt', { path: '/remote/file2.txt', size: 200, mtime: Date.now(), isDirectory: false }]
      ]);

      const options: SyncOptions = { deleteRemote: true };
      const diff = (DeltaSyncManager as any).calculateDiff(localFiles, remoteFiles, options);

      expect(diff.toDelete).toHaveLength(1);
      expect(diff.toDelete[0].path).toBe('file2.txt');
      expect(diff.toDelete[0].reason).toBe('deleted_locally');
    });

    it('should not detect deleted files when deleteRemote is disabled', () => {
      const localFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/local/file1.txt', size: 100, mtime: Date.now(), isDirectory: false }]
      ]);

      const remoteFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/remote/file1.txt', size: 100, mtime: Date.now(), isDirectory: false }],
        ['file2.txt', { path: '/remote/file2.txt', size: 200, mtime: Date.now(), isDirectory: false }]
      ]);

      const options: SyncOptions = { deleteRemote: false };
      const diff = (DeltaSyncManager as any).calculateDiff(localFiles, remoteFiles, options);

      expect(diff.toDelete).toHaveLength(0);
    });

    it('should exclude files based on patterns', () => {
      const localFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/local/file1.txt', size: 100, mtime: Date.now(), isDirectory: false }],
        ['node_modules/pkg/index.js', { path: '/local/node_modules/pkg/index.js', size: 200, mtime: Date.now(), isDirectory: false }],
        ['.git/config', { path: '/local/.git/config', size: 50, mtime: Date.now(), isDirectory: false }]
      ]);

      const remoteFiles = new Map<string, FileInfo>();

      const options: SyncOptions = { excludePatterns: ['node_modules', String.raw`\.git`] };
      const diff = (DeltaSyncManager as any).calculateDiff(localFiles, remoteFiles, options);

      expect(diff.toUpload).toHaveLength(1);
      expect(diff.toUpload[0].path).toBe('file1.txt');
    });
  });

  describe('isFileModified', () => {
    it('should detect size difference', () => {
      const local: FileInfo = { path: '/local/file.txt', size: 100, mtime: Date.now(), isDirectory: false };
      const remote: FileInfo = { path: '/remote/file.txt', size: 200, mtime: Date.now(), isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(true);
    });

    it('should detect mtime difference', () => {
      const now = Date.now();
      const local: FileInfo = { path: '/local/file.txt', size: 100, mtime: now, isDirectory: false };
      const remote: FileInfo = { path: '/remote/file.txt', size: 100, mtime: now - 5000, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(true);
    });

    it('should allow 1 second mtime tolerance', () => {
      const now = Date.now();
      const local: FileInfo = { path: '/local/file.txt', size: 100, mtime: now, isDirectory: false };
      const remote: FileInfo = { path: '/remote/file.txt', size: 100, mtime: now - 500, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(false); // Within 1 second tolerance
    });

    it('should consider files unchanged when size and mtime match', () => {
      const now = Date.now();
      const local: FileInfo = { path: '/local/file.txt', size: 100, mtime: now, isDirectory: false };
      const remote: FileInfo = { path: '/remote/file.txt', size: 100, mtime: now, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(false);
    });
  });

  describe('shouldExclude', () => {
    it('should exclude files matching pattern', () => {
      expect((DeltaSyncManager as any).shouldExclude('node_modules/pkg/index.js', ['node_modules'])).toBe(true);
      expect((DeltaSyncManager as any).shouldExclude('.git/config', [String.raw`\.git`])).toBe(true);
      expect((DeltaSyncManager as any).shouldExclude('test.log', [String.raw`.*\.log`])).toBe(true);
    });

    it('should not exclude files not matching pattern', () => {
      expect((DeltaSyncManager as any).shouldExclude('src/index.ts', ['node_modules'])).toBe(false);
      expect((DeltaSyncManager as any).shouldExclude('README.md', [String.raw`\.git`])).toBe(false);
    });

    it('should support multiple patterns', () => {
      const patterns = ['node_modules', String.raw`\.git`, String.raw`.*\.log`];
      expect((DeltaSyncManager as any).shouldExclude('node_modules/pkg/index.js', patterns)).toBe(true);
      expect((DeltaSyncManager as any).shouldExclude('.git/config', patterns)).toBe(true);
      expect((DeltaSyncManager as any).shouldExclude('debug.log', patterns)).toBe(true);
      expect((DeltaSyncManager as any).shouldExclude('src/app.ts', patterns)).toBe(false);
    });

    it('should handle empty pattern array', () => {
      expect((DeltaSyncManager as any).shouldExclude('any/path/file.txt', [])).toBe(false);
    });

    it('should handle very long path names', () => {
      const longPath = 'a/'.repeat(100) + 'file.txt'; // Very deep path
      expect((DeltaSyncManager as any).shouldExclude(longPath, ['node_modules'])).toBe(false);
    });

    it('should handle unicode and emoji in paths', () => {
      expect((DeltaSyncManager as any).shouldExclude('文件夹/测试.txt', ['node_modules'])).toBe(false);
      expect((DeltaSyncManager as any).shouldExclude('📁/😀.txt', [String.raw`📁`])).toBe(true);
    });

    it('should handle special regex characters in patterns', () => {
      const patterns = [String.raw`\[test\]`, String.raw`\(cache\)`, String.raw`file\+backup`];
      expect((DeltaSyncManager as any).shouldExclude('[test]/file.txt', patterns)).toBe(true);
      expect((DeltaSyncManager as any).shouldExclude('(cache)/data.json', patterns)).toBe(true);
      expect((DeltaSyncManager as any).shouldExclude('file+backup.txt', patterns)).toBe(true);
    });
  });

  describe('timestamp edge cases', () => {
    it('should handle equal timestamps (exact match)', () => {
      const exactTime = 1704067200000; // 2024-01-01 00:00:00 UTC
      const local: FileInfo = { path: '/local/file.txt', size: 100, mtime: exactTime, isDirectory: false };
      const remote: FileInfo = { path: '/remote/file.txt', size: 100, mtime: exactTime, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(false);
    });

    it('should handle timestamps differing by exactly 1000ms (boundary)', () => {
      const now = Date.now();
      const local: FileInfo = { path: '/local/file.txt', size: 100, mtime: now, isDirectory: false };
      const remote: FileInfo = { path: '/remote/file.txt', size: 100, mtime: now - 1000, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(false); // Exactly at tolerance boundary
    });

    it('should handle timestamps differing by 999ms (within tolerance)', () => {
      const now = Date.now();
      const local: FileInfo = { path: '/local/file.txt', size: 100, mtime: now, isDirectory: false };
      const remote: FileInfo = { path: '/remote/file.txt', size: 100, mtime: now - 999, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(false);
    });

    it('should handle timestamps differing by 1001ms (outside tolerance)', () => {
      const now = Date.now();
      const local: FileInfo = { path: '/local/file.txt', size: 100, mtime: now, isDirectory: false };
      const remote: FileInfo = { path: '/remote/file.txt', size: 100, mtime: now - 1001, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(true);
    });

    it('should handle future timestamps (local newer than remote)', () => {
      const now = Date.now();
      const futureTime = now + 86400000; // 1 day in future
      const local: FileInfo = { path: '/local/file.txt', size: 100, mtime: futureTime, isDirectory: false };
      const remote: FileInfo = { path: '/remote/file.txt', size: 100, mtime: now, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(true);
    });

    it('should handle future timestamps (remote newer than local)', () => {
      const now = Date.now();
      const futureTime = now + 86400000; // 1 day in future
      const local: FileInfo = { path: '/local/file.txt', size: 100, mtime: now, isDirectory: false };
      const remote: FileInfo = { path: '/remote/file.txt', size: 100, mtime: futureTime, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(true);
    });

    it('should handle epoch 0 timestamps', () => {
      const local: FileInfo = { path: '/local/file.txt', size: 100, mtime: 0, isDirectory: false };
      const remote: FileInfo = { path: '/remote/file.txt', size: 100, mtime: 0, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(false);
    });

    it('should handle very large timestamp differences (years apart)', () => {
      const oldTime = 946684800000; // 2000-01-01
      const newTime = 1704067200000; // 2024-01-01
      const local: FileInfo = { path: '/local/file.txt', size: 100, mtime: newTime, isDirectory: false };
      const remote: FileInfo = { path: '/remote/file.txt', size: 100, mtime: oldTime, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(true);
    });
  });

  describe('file size edge cases', () => {
    it('should detect 0 byte files as unchanged when sizes match', () => {
      const now = Date.now();
      const local: FileInfo = { path: '/local/empty.txt', size: 0, mtime: now, isDirectory: false };
      const remote: FileInfo = { path: '/remote/empty.txt', size: 0, mtime: now, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(false);
    });

    it('should detect 1 byte difference as modified', () => {
      const now = Date.now();
      const local: FileInfo = { path: '/local/file.txt', size: 100, mtime: now, isDirectory: false };
      const remote: FileInfo = { path: '/remote/file.txt', size: 101, mtime: now, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(true);
    });

    it('should handle very large files (GB+)', () => {
      const now = Date.now();
      const largeSize = 5 * 1024 * 1024 * 1024; // 5GB
      const local: FileInfo = { path: '/local/large.file', size: largeSize, mtime: now, isDirectory: false };
      const remote: FileInfo = { path: '/remote/large.file', size: largeSize, mtime: now, isDirectory: false };

      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(false);
    });
  });

  describe('diff calculation edge cases', () => {
    it('should handle both maps empty', () => {
      const localFiles = new Map<string, FileInfo>();
      const remoteFiles = new Map<string, FileInfo>();

      const diff = (DeltaSyncManager as any).calculateDiff(localFiles, remoteFiles);

      expect(diff.toUpload).toHaveLength(0);
      expect(diff.toDelete).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(0);
    });

    it('should handle local map empty with deleteRemote enabled', () => {
      const localFiles = new Map<string, FileInfo>();
      const remoteFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/remote/file1.txt', size: 100, mtime: Date.now(), isDirectory: false }],
        ['file2.txt', { path: '/remote/file2.txt', size: 200, mtime: Date.now(), isDirectory: false }]
      ]);

      const options: SyncOptions = { deleteRemote: true };
      const diff = (DeltaSyncManager as any).calculateDiff(localFiles, remoteFiles, options);

      expect(diff.toUpload).toHaveLength(0);
      expect(diff.toDelete).toHaveLength(2);
      expect(diff.unchanged).toHaveLength(0);
    });

    it('should handle remote map empty (all local files are new)', () => {
      const localFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/local/file1.txt', size: 100, mtime: Date.now(), isDirectory: false }],
        ['file2.txt', { path: '/local/file2.txt', size: 200, mtime: Date.now(), isDirectory: false }]
      ]);
      const remoteFiles = new Map<string, FileInfo>();

      const diff = (DeltaSyncManager as any).calculateDiff(localFiles, remoteFiles);

      expect(diff.toUpload).toHaveLength(2);
      expect(diff.toUpload.every((f: any) => f.reason === 'new')).toBe(true);
      expect(diff.toDelete).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(0);
    });

    it('should handle all files identical (no changes)', () => {
      const now = Date.now();
      const localFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/local/file1.txt', size: 100, mtime: now, isDirectory: false }],
        ['file2.txt', { path: '/local/file2.txt', size: 200, mtime: now, isDirectory: false }]
      ]);
      const remoteFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/remote/file1.txt', size: 100, mtime: now, isDirectory: false }],
        ['file2.txt', { path: '/remote/file2.txt', size: 200, mtime: now, isDirectory: false }]
      ]);

      const diff = (DeltaSyncManager as any).calculateDiff(localFiles, remoteFiles);

      expect(diff.toUpload).toHaveLength(0);
      expect(diff.toDelete).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(2);
    });

    it('should handle all files modified', () => {
      const now = Date.now();
      const localFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/local/file1.txt', size: 150, mtime: now, isDirectory: false }],
        ['file2.txt', { path: '/local/file2.txt', size: 250, mtime: now, isDirectory: false }]
      ]);
      const remoteFiles = new Map<string, FileInfo>([
        ['file1.txt', { path: '/remote/file1.txt', size: 100, mtime: now - 5000, isDirectory: false }],
        ['file2.txt', { path: '/remote/file2.txt', size: 200, mtime: now - 5000, isDirectory: false }]
      ]);

      const diff = (DeltaSyncManager as any).calculateDiff(localFiles, remoteFiles);

      expect(diff.toUpload).toHaveLength(2);
      expect(diff.toUpload.every((f: any) => f.reason === 'size_mismatch' || f.reason === 'mtime_newer')).toBe(true);
      expect(diff.unchanged).toHaveLength(0);
    });
  });

  describe('directory handling edge cases', () => {
    it('should handle directories with isDirectory=true', () => {
      const now = Date.now();
      const local: FileInfo = { path: '/local/dir', size: 0, mtime: now, isDirectory: true };
      const remote: FileInfo = { path: '/remote/dir', size: 0, mtime: now, isDirectory: true };

      // Directories with same size and mtime should be unchanged
      const modified = (DeltaSyncManager as any).isFileModified(local, remote, 'mtime');

      expect(modified).toBe(false);
    });

    it('should differentiate directory vs file with same name', () => {
      const now = Date.now();
      const localFiles = new Map<string, FileInfo>([
        ['data', { path: '/local/data', size: 0, mtime: now, isDirectory: true }]
      ]);
      const remoteFiles = new Map<string, FileInfo>([
        ['data', { path: '/remote/data', size: 100, mtime: now, isDirectory: false }]
      ]);

      const diff = (DeltaSyncManager as any).calculateDiff(localFiles, remoteFiles);

      // Size differs (0 vs 100)  expect(diff.toUpload).toHaveLength(1);
    });
  });
});
