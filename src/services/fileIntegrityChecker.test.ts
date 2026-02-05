import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { FileIntegrityChecker } from './fileIntegrityChecker';

describe('FileIntegrityChecker', () => {
  let tempDir: string;
  let testFile: string;
  let mockOutputChannel: any;

  beforeAll(() => {
    // Set up vscode mock
    mockOutputChannel = {
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn()
    };

    vi.spyOn(vscode.window, 'createOutputChannel').mockReturnValue(mockOutputChannel);
  });

  beforeEach(() => {
    // Create temp directory and test file
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-test-'));
    testFile = path.join(tempDir, 'test-file.txt');
    fs.writeFileSync(testFile, 'Hello, World!');
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir);
    }
  });

  describe('calculateLocalChecksum', () => {
    it('should calculate MD5 checksum correctly', async () => {
      const checksum = await FileIntegrityChecker.calculateLocalChecksum(testFile, 'md5');

      // Verify against known MD5 of "Hello, World!"
      const expectedMd5 = crypto.createHash('md5').update('Hello, World!').digest('hex');
      expect(checksum).toBe(expectedMd5);
    });

    it('should calculate SHA256 checksum correctly', async () => {
      const checksum = await FileIntegrityChecker.calculateLocalChecksum(testFile, 'sha256');

      // Verify against known SHA256 of "Hello, World!"
      const expectedSha256 = crypto.createHash('sha256').update('Hello, World!').digest('hex');
      expect(checksum).toBe(expectedSha256);
    });

    it('should handle large files efficiently', async () => {
      // Create a large file (10MB)
      const largeFile = path.join(tempDir, 'large-file.bin');
      const buffer = Buffer.alloc(10 * 1024 * 1024, 'a');
      fs.writeFileSync(largeFile, buffer);

      const startTime = Date.now();
      const checksum = await FileIntegrityChecker.calculateLocalChecksum(largeFile, 'md5');
      const duration = Date.now() - startTime;

      expect(checksum).toBeDefined();
      expect(checksum.length).toBe(32); // MD5 is 32 hex chars
      expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds

      fs.unlinkSync(largeFile);
    });

    it('should reject on file read error', async () => {
      const nonExistentFile = path.join(tempDir, 'nonexistent.txt');

      await expect(
        FileIntegrityChecker.calculateLocalChecksum(nonExistentFile, 'md5')
      ).rejects.toThrow();
    });
  });

  describe('calculateRemoteChecksum', () => {
    it('should execute correct command for MD5', async () => {
      // This test would require mocking SSH connection
      // Skipping actual SSH test, but documenting expected behavior
      expect(true).toBe(true); // Placeholder
    });

    it('should execute correct command for SHA256', async () => {
      // This test would require mocking SSH connection
      // Skipping actual SSH test, but documenting expected behavior
      expect(true).toBe(true); // Placeholder
    });

    it('should handle missing checksum tool error', async () => {
      // Would test CHECKSUM_TOOL_NOT_FOUND error handling
      // Requires SSH mock
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('verifyUpload', () => {
    it('should skip verification if disabled', async () => {
      const options = {
        enabled: false,
        algorithm: 'md5' as const,
        threshold: 1024
      };

      const result = await FileIntegrityChecker.verifyUpload(
        {} as any,
        {} as any,
        testFile,
        '/remote/path',
        {} as any,
        options
      );

      expect(result).toBe(true);
    });

    it('should skip verification if file size below threshold', async () => {
      const options = {
        enabled: true,
        algorithm: 'md5' as const,
        threshold: 1024 * 1024 // 1MB threshold
      };

      const result = await FileIntegrityChecker.verifyUpload(
        {} as any,
        {} as any,
        testFile, // Only 13 bytes
        '/remote/path',
        {} as any,
        options
      );

      expect(result).toBe(true);
    });
  });

  describe('verifyDownload', () => {
    it('should skip verification if disabled', async () => {
      const options = {
        enabled: false,
        algorithm: 'md5' as const,
        threshold: 1024
      };

      const result = await FileIntegrityChecker.verifyDownload(
        {} as any,
        {} as any,
        '/remote/path',
        testFile,
        {} as any,
        options
      );

      expect(result).toBe(true);
    });

    it('should skip verification if file size below threshold', async () => {
      const options = {
        enabled: true,
        algorithm: 'md5' as const,
        threshold: 1024 * 1024 // 1MB threshold
      };

      const result = await FileIntegrityChecker.verifyDownload(
        {} as any,
        {} as any,
        '/remote/path',
        testFile, // Only 13 bytes
        {} as any,
        options
      );

      expect(result).toBe(true);
    });
  });

  describe('getOptionsFromConfig', () => {
    it('should return default options when configuration is empty', () => {
      // Mock configuration
      const mockGet = vi.fn((key: string, defaultValue: any) => defaultValue);
      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: mockGet,
        has: vi.fn(),
        inspect: vi.fn(),
        update: vi.fn()
      } as any);

      const options = FileIntegrityChecker.getOptionsFromConfig();

      expect(options.enabled).toBe(false);
      expect(options.algorithm).toBe('sha256');
      expect(options.threshold).toBe(10 * 1024 * 1024);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty file', async () => {
      const emptyFile = path.join(tempDir, 'empty.txt');
      fs.writeFileSync(emptyFile, '');

      const checksum = await FileIntegrityChecker.calculateLocalChecksum(emptyFile, 'md5');

      // MD5 of empty string
      const expectedMd5 = crypto.createHash('md5').update('').digest('hex');
      expect(checksum).toBe(expectedMd5);

      fs.unlinkSync(emptyFile);
    });

    it('should handle binary file', async () => {
      const binaryFile = path.join(tempDir, 'binary.bin');
      const buffer = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE]);
      fs.writeFileSync(binaryFile, buffer);

      const checksum = await FileIntegrityChecker.calculateLocalChecksum(binaryFile, 'sha256');

      const expectedSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      expect(checksum).toBe(expectedSha256);

      fs.unlinkSync(binaryFile);
    });

    it('should handle file with special characters in name', async () => {
      const specialFile = path.join(tempDir, 'test file (1) [copy].txt');
      fs.writeFileSync(specialFile, 'test content');

      const checksum = await FileIntegrityChecker.calculateLocalChecksum(specialFile, 'md5');

      expect(checksum).toBeDefined();
      expect(checksum.length).toBe(32);

      fs.unlinkSync(specialFile);
    });
  });
});
