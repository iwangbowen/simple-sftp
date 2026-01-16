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
  });
});
