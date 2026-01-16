import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CompressionManager, createCompressedConnectConfig } from './compressionTransfer';

describe('CompressionManager', () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compression-test-'));
    testFile = path.join(tempDir, 'test.log');
  });

  afterEach(() => {
    // Clean up temp files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('shouldCompressFile', () => {
    it('should return false for small files', () => {
      const result = CompressionManager.shouldCompressFile('test.log', 10 * 1024 * 1024); // 10MB
      expect(result).toBe(false);
    });

    it('should return false for large binary files', () => {
      const result = CompressionManager.shouldCompressFile('test.mp4', 100 * 1024 * 1024); // 100MB
      expect(result).toBe(false);
    });

    it('should return true for large text files', () => {
      const result = CompressionManager.shouldCompressFile('test.log', 60 * 1024 * 1024); // 60MB
      expect(result).toBe(true);
    });

    it('should recognize various compressible extensions', () => {
      const compressibleExts = ['.txt', '.log', '.json', '.js', '.ts', '.html', '.css'];
      const fileSize = 60 * 1024 * 1024;

      compressibleExts.forEach(ext => {
        const result = CompressionManager.shouldCompressFile(`test${ext}`, fileSize);
        expect(result).toBe(true);
      });
    });

    it('should be case-insensitive for extensions', () => {
      const fileSize = 60 * 1024 * 1024;
      expect(CompressionManager.shouldCompressFile('test.LOG', fileSize)).toBe(true);
      expect(CompressionManager.shouldCompressFile('test.TXT', fileSize)).toBe(true);
    });
  });

  describe('compressFile', () => {
    it('should compress a text file and return .gz path', async () => {
      // Create a test file with repetitive content (highly compressible)
      const content = 'test data '.repeat(1000000); // ~10MB of repetitive text
      fs.writeFileSync(testFile, content);

      const compressedPath = await CompressionManager.compressFile(testFile);

      expect(compressedPath).toBe(`${testFile}.gz`);
      expect(fs.existsSync(compressedPath)).toBe(true);

      // Check compression ratio
      const originalSize = fs.statSync(testFile).size;
      const compressedSize = fs.statSync(compressedPath).size;
      expect(compressedSize).toBeLessThan(originalSize * 0.5); // Should be less than 50% of original

      // Cleanup
      fs.unlinkSync(compressedPath);
    });

    it('should handle small files', async () => {
      fs.writeFileSync(testFile, 'small content');

      const compressedPath = await CompressionManager.compressFile(testFile);

      expect(fs.existsSync(compressedPath)).toBe(true);

      // Cleanup
      fs.unlinkSync(compressedPath);
    });

    it('should overwrite existing .gz file', async () => {
      fs.writeFileSync(testFile, 'content');
      const gzPath = `${testFile}.gz`;

      // Create existing .gz file
      fs.writeFileSync(gzPath, 'old compressed data');

      await CompressionManager.compressFile(testFile);

      expect(fs.existsSync(gzPath)).toBe(true);
      const content = fs.readFileSync(gzPath);
      expect(content.toString()).not.toBe('old compressed data');

      // Cleanup
      fs.unlinkSync(gzPath);
    });
  });

  describe('decompressRemoteFile', () => {
    it('should construct correct gunzip command', async () => {
      const mockClient = {
        exec: vi.fn((cmd, callback) => {
          expect(cmd).toBe('gunzip -f "/remote/test.log.gz"');

          // Simulate success
          const mockStream = {
            on: vi.fn((event, handler) => {
              if (event === 'close') {
                setTimeout(() => handler(0), 10); // Exit code 0
              }
              return mockStream;
            }),
            stderr: {
              on: vi.fn(() => mockStream)
            }
          };
          callback(null, mockStream);
        })
      } as any;

      await CompressionManager.decompressRemoteFile(mockClient, '/remote/test.log');
      expect(mockClient.exec).toHaveBeenCalled();
    });

    it('should reject on exec error', async () => {
      const mockClient = {
        exec: vi.fn((cmd, callback) => {
          callback(new Error('SSH exec failed'), null);
        })
      } as any;

      await expect(
        CompressionManager.decompressRemoteFile(mockClient, '/remote/test.log')
      ).rejects.toThrow('Failed to decompress remote file');
    });

    it('should reject on non-zero exit code', async () => {
      const mockClient = {
        exec: vi.fn((cmd, callback) => {
          const mockStream = {
            on: vi.fn((event, handler) => {
              if (event === 'close') {
                setTimeout(() => handler(1), 10); // Exit code 1 (error)
              }
              return mockStream;
            }),
            stderr: {
              on: vi.fn((event, handler) => {
                if (event === 'data') {
                  setTimeout(() => handler(Buffer.from('gunzip: file not found')), 5);
                }
                return mockStream;
              })
            }
          };
          callback(null, mockStream);
        })
      } as any;

      await expect(
        CompressionManager.decompressRemoteFile(mockClient, '/remote/test.log')
      ).rejects.toThrow('Remote decompression failed');
    });
  });

  describe('checkRemoteGunzip', () => {
    it('should return true if gunzip exists', async () => {
      const mockClient = {
        exec: vi.fn((cmd, callback) => {
          expect(cmd).toBe('which gunzip');

          const mockStream = {
            on: vi.fn((event, handler) => {
              if (event === 'data') {
                setTimeout(() => handler(Buffer.from('/usr/bin/gunzip\n')), 5);
              } else if (event === 'close') {
                setTimeout(() => handler(0), 10);
              }
              return mockStream;
            })
          };
          callback(null, mockStream);
        })
      } as any;

      const result = await CompressionManager.checkRemoteGunzip(mockClient);
      expect(result).toBe(true);
    });

    it('should return false if gunzip not found', async () => {
      const mockClient = {
        exec: vi.fn((cmd, callback) => {
          const mockStream = {
            on: vi.fn((event, handler) => {
              if (event === 'close') {
                setTimeout(() => handler(1), 10); // Exit code 1 (not found)
              }
              return mockStream;
            })
          };
          callback(null, mockStream);
        })
      } as any;

      const result = await CompressionManager.checkRemoteGunzip(mockClient);
      expect(result).toBe(false);
    });

    it('should handle exec errors gracefully', async () => {
      const mockClient = {
        exec: vi.fn((cmd, callback) => {
          callback(new Error('Connection failed'), null);
        })
      } as any;

      const result = await CompressionManager.checkRemoteGunzip(mockClient);
      expect(result).toBe(false);
    });
  });
});

describe('createCompressedConnectConfig', () => {
  it('should enable compression in SSH config', () => {
    const baseConfig = {
      host: 'example.com',
      port: 22,
      username: 'user'
    };

    const compressedConfig = createCompressedConnectConfig(baseConfig);

    expect(compressedConfig.compress).toBe(true);
    expect(compressedConfig.algorithms).toBeDefined();
    expect(compressedConfig.algorithms.compress).toEqual(['zlib@openssh.com', 'zlib']);
  });

  it('should preserve original config properties', () => {
    const baseConfig = {
      host: 'example.com',
      port: 22,
      username: 'user',
      readyTimeout: 30000
    };

    const compressedConfig = createCompressedConnectConfig(baseConfig);

    expect(compressedConfig.host).toBe('example.com');
    expect(compressedConfig.port).toBe(22);
    expect(compressedConfig.username).toBe('user');
    expect(compressedConfig.readyTimeout).toBe(30000);
  });

  it('should merge with existing algorithms', () => {
    const baseConfig = {
      host: 'example.com',
      algorithms: {
        cipher: ['aes128-ctr']
      }
    };

    const compressedConfig = createCompressedConnectConfig(baseConfig);

    expect(compressedConfig.algorithms.cipher).toEqual(['aes128-ctr']);
    expect(compressedConfig.algorithms.compress).toEqual(['zlib@openssh.com', 'zlib']);
  });
});
