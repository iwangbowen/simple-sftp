import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('syncFile', () => {
    it('uploads file when remote does not exist', async () => {
      mockSftpClient.exists.mockResolvedValue(false);
      mockSftpClient.fastPut.mockResolvedValue(undefined);

      const result = await DeltaSyncManager.syncFile(
        mockSftpClient as any,
        '/local/new.txt',
        '/remote/new.txt'
      );

      expect(mockSftpClient.fastPut).toHaveBeenCalledWith('/local/new.txt', '/remote/new.txt');
      expect(result).toEqual({ skipped: false, reason: 'new' });
    });

    it('skips file when unchanged by mtime', async () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-sync-file-'));
      const localFile = path.join(base, 'same.txt');
      fs.writeFileSync(localFile, Buffer.alloc(100));
      const mtime = new Date('2026-01-01T00:00:10.000Z');
      fs.utimesSync(localFile, mtime, mtime);

      mockSftpClient.exists.mockResolvedValue(true);
      mockSftpClient.stat.mockResolvedValue({ size: 100, modifyTime: mtime.getTime() / 1000 });

      try {
        const result = await DeltaSyncManager.syncFile(
          mockSftpClient as any,
          localFile,
          '/remote/same.txt'
        );

        expect(result).toEqual({ skipped: true, reason: 'unchanged' });
        expect(mockSftpClient.fastPut).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });

    it('uploads modified file and preserves timestamps when enabled', async () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-sync-file-'));
      const localFile = path.join(base, 'modified.txt');
      fs.writeFileSync(localFile, Buffer.alloc(120));

      mockSftpClient.exists.mockResolvedValue(true);
      mockSftpClient.stat.mockResolvedValue({ size: 100, modifyTime: 10 });

      const preserveSpy = vi.spyOn(DeltaSyncManager as any, 'preserveTimestamps').mockResolvedValue(undefined);

      try {
        const result = await DeltaSyncManager.syncFile(
          mockSftpClient as any,
          localFile,
          '/remote/modified.txt',
          { preserveTimestamps: true }
        );

        expect(mockSftpClient.fastPut).toHaveBeenCalledWith(localFile, '/remote/modified.txt');
        expect(preserveSpy).toHaveBeenCalled();
        expect(result).toEqual({ skipped: false, reason: 'modified' });
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });

    it('throws when syncFile internal operations fail', async () => {
      mockSftpClient.exists.mockRejectedValue(new Error('exists failed'));

      await expect(
        DeltaSyncManager.syncFile(mockSftpClient as any, '/local/a.txt', '/remote/a.txt')
      ).rejects.toThrow('exists failed');
    });
  });

  describe('file tree builders', () => {
    it('getLocalFileTree recursively collects files', async () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-local-'));
      const nested = path.join(base, 'nested');
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(base, 'a.txt'), 'A');
      fs.writeFileSync(path.join(nested, 'b.txt'), 'B');

      try {
        const files = await (DeltaSyncManager as any).getLocalFileTree(base);
        expect(files.has('a.txt')).toBe(true);
        expect(files.has(path.join('nested', 'b.txt'))).toBe(true);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });

    it('getRemoteFileTree recursively collects remote files', async () => {
      mockSftpClient.list.mockImplementation(async (dir: string) => {
        if (dir === '/remote') {
          return [
            { name: 'sub', type: 'd' },
            { name: 'root.txt', type: '-', size: 1, modifyTime: 1 },
          ];
        }
        if (dir === '/remote/sub') {
          return [
            { name: 'child.txt', type: '-', size: 2, modifyTime: 2 },
          ];
        }
        return [];
      });

      const files = await (DeltaSyncManager as any).getRemoteFileTree(mockSftpClient as any, '/remote');
      expect(files.has('root.txt')).toBe(true);
      expect(files.has('sub/child.txt')).toBe(true);
    });

    it('getRemoteFileTree tolerates list errors and returns partial results', async () => {
      mockSftpClient.list.mockImplementation(async (dir: string) => {
        if (dir === '/remote') {
          return [
            { name: 'ok.txt', type: '-', size: 10, modifyTime: 10 },
            { name: 'bad', type: 'd' },
          ];
        }
        if (dir === '/remote/bad') {
          throw new Error('permission denied');
        }
        return [];
      });

      const files = await (DeltaSyncManager as any).getRemoteFileTree(mockSftpClient as any, '/remote');
      expect(files.has('ok.txt')).toBe(true);
      expect(files.has('bad')).toBe(false);
    });
  });

  describe('executeSyncPlan', () => {
    it('uploads, deletes and reports progress', async () => {
      const preserveSpy = vi.spyOn(DeltaSyncManager as any, 'preserveTimestamps').mockResolvedValue(undefined);
      const localBase = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-sync-plan-'));
      fs.writeFileSync(path.join(localBase, 'a.txt'), 'A');

      const progress: Array<{ current: number; total: number; file: string }> = [];
      const diff = {
        toUpload: [{ path: 'a.txt', reason: 'new' as const }],
        toDelete: [{ path: 'b.txt', reason: 'deleted_locally' as const }],
        unchanged: ['c.txt'],
      };

      mockSftpClient.mkdir.mockResolvedValue(undefined);
      mockSftpClient.fastPut.mockResolvedValue(undefined);
      mockSftpClient.delete.mockResolvedValue(undefined);

      try {
        const stats = await (DeltaSyncManager as any).executeSyncPlan(
          mockSftpClient,
          localBase,
          '/remote',
          diff,
          {
            deleteRemote: true,
            preserveTimestamps: true,
            onProgress: (current: number, total: number, currentFile: string) => {
              progress.push({ current, total, file: currentFile });
            },
          }
        );

        expect(stats).toMatchObject({ uploaded: 1, deleted: 1, skipped: 1, failed: 0, total: 3 });
        expect(progress).toHaveLength(2);
        expect(preserveSpy).toHaveBeenCalled();
      } finally {
        fs.rmSync(localBase, { recursive: true, force: true });
      }
    });

    it('counts upload failures and continues', async () => {
      const diff = {
        toUpload: [
          { path: 'ok.txt', reason: 'new' as const },
          { path: 'bad.txt', reason: 'new' as const },
        ],
        toDelete: [],
        unchanged: [],
      };

      mockSftpClient.mkdir.mockResolvedValue(undefined);
      mockSftpClient.fastPut
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('upload failed'));

      const stats = await (DeltaSyncManager as any).executeSyncPlan(
        mockSftpClient,
        '/local',
        '/remote',
        diff,
        {}
      );

      expect(stats.uploaded).toBe(1);
      expect(stats.failed).toBe(1);
    });

    it('counts delete failures and continues', async () => {
      const diff = {
        toUpload: [],
        toDelete: [
          { path: 'x.txt', reason: 'deleted_locally' as const },
          { path: 'y.txt', reason: 'deleted_locally' as const },
        ],
        unchanged: [],
      };

      mockSftpClient.delete
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('delete failed'));

      const stats = await (DeltaSyncManager as any).executeSyncPlan(
        mockSftpClient,
        '/local',
        '/remote',
        diff,
        { deleteRemote: true }
      );

      expect(stats.deleted).toBe(1);
      expect(stats.failed).toBe(1);
    });
  });

  describe('syncDirectory orchestration', () => {
    it('wires file trees, diff and execution plan together', async () => {
      const localFiles = new Map<string, FileInfo>([
        ['a.txt', { path: '/local/a.txt', size: 1, mtime: 1, isDirectory: false }],
      ]);
      const remoteFiles = new Map<string, FileInfo>();
      const diff = {
        toUpload: [{ path: 'a.txt', reason: 'new' as const }],
        toDelete: [],
        unchanged: [],
      };
      const stats = { uploaded: 1, deleted: 0, skipped: 0, failed: 0, total: 1 };

      vi.spyOn(DeltaSyncManager as any, 'getLocalFileTree').mockResolvedValue(localFiles);
      vi.spyOn(DeltaSyncManager as any, 'getRemoteFileTree').mockResolvedValue(remoteFiles);
      vi.spyOn(DeltaSyncManager as any, 'calculateDiff').mockReturnValue(diff);
      vi.spyOn(DeltaSyncManager as any, 'executeSyncPlan').mockResolvedValue(stats);

      const result = await DeltaSyncManager.syncDirectory(
        mockSftpClient as any,
        '/local',
        '/remote',
        { compareMethod: 'mtime' }
      );

      expect(result).toEqual(stats);
      expect((DeltaSyncManager as any).getLocalFileTree).toHaveBeenCalledWith('/local');
      expect((DeltaSyncManager as any).getRemoteFileTree).toHaveBeenCalledWith(mockSftpClient, '/remote');
    });
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

      // Size differs (0 vs 100), should be marked for upload
      expect(diff.toUpload).toHaveLength(1);
      expect(diff.toUpload[0].reason).toBe('size_mismatch');
    });
  });
});
