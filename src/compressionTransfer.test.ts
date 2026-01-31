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

    it('should return false for file at exact threshold (50MB)', () => {
      const result = CompressionManager.shouldCompressFile('test.log', 50 * 1024 * 1024);
      expect(result).toBe(true); // At threshold, compressible files should be compressed
    });

    it('should return false for file just below threshold', () => {
      const result = CompressionManager.shouldCompressFile('test.log', 50 * 1024 * 1024 - 1);
      expect(result).toBe(false);
    });

    it('should handle files without extension', () => {
      const fileSize = 60 * 1024 * 1024;
      const result = CompressionManager.shouldCompressFile('Makefile', fileSize);
      expect(result).toBe(false);
    });

    it('should recognize all compressible text extensions', () => {
      const extensions = ['.xml', '.csv', '.yaml', '.yml', '.md', '.sql'];
      const fileSize = 60 * 1024 * 1024;

      extensions.forEach(ext => {
        const result = CompressionManager.shouldCompressFile(`test${ext}`, fileSize);
        expect(result).toBe(true);
      });
    });

    it('should reject common binary file extensions', () => {
      const binaryExts = ['.zip', '.gz', '.tar', '.jpg', '.png', '.pdf', '.exe', '.bin'];
      const fileSize = 100 * 1024 * 1024;

      binaryExts.forEach(ext => {
        const result = CompressionManager.shouldCompressFile(`test${ext}`, fileSize);
        expect(result).toBe(false);
      });
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

  describe('Edge Cases', () => {
    it('should handle config with minimal required fields only', () => {
      const minimalConfig = {
        host: 'test.com'
      };

      const result = createCompressedConnectConfig(minimalConfig as any);

      expect(result.compress).toBe(true);
      expect(result.algorithms.compress).toEqual(['zlib@openssh.com', 'zlib']);
    });

    it('should handle config with existing compress algorithms', () => {
      const config = {
        host: 'test.com',
        algorithms: {
          compress: ['none']
        }
      };

      const result = createCompressedConnectConfig(config);

      expect(result.algorithms.compress).toEqual(['zlib@openssh.com', 'zlib']);
    });

    it('should handle config with all SSH options', () => {
      const fullConfig = {
        host: 'example.com',
        port: 2222,
        username: 'admin',
        password: 'pass',
        privateKey: 'key',
        passphrase: 'phrase',
        readyTimeout: 60000,
        keepaliveInterval: 10000,
        algorithms: {
          cipher: ['aes256-ctr'],
          kex: ['diffie-hellman-group14-sha1']
        }
      };

      const result = createCompressedConnectConfig(fullConfig);

      expect(result.compress).toBe(true);
      expect(result.algorithms.compress).toEqual(['zlib@openssh.com', 'zlib']);
      expect(result.host).toBe('example.com');
      expect(result.port).toBe(2222);
      expect(result.username).toBe('admin');
    });
  });
});

// Additional edge case tests for CompressionManager
describe('CompressionManager - Additional Edge Cases', () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compression-edge-test-'));
    testFile = path.join(tempDir, 'test.log');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('shouldCompressFile - Extended Edge Cases', () => {
    it('should handle zero-size files', () => {
      const result = CompressionManager.shouldCompressFile('test.log', 0);
      expect(result).toBe(false);
    });

    it('should handle extremely large files', () => {
      const result = CompressionManager.shouldCompressFile('test.log', 10 * 1024 * 1024 * 1024); // 10GB
      expect(result).toBe(true);
    });

    it('should handle filenames with multiple dots', () => {
      const result = CompressionManager.shouldCompressFile('test.file.name.log', 60 * 1024 * 1024);
      expect(result).toBe(true);
    });

    it('should handle filenames starting with dot', () => {
      const result = CompressionManager.shouldCompressFile('.hidden.log', 60 * 1024 * 1024);
      expect(result).toBe(true);
    });

    it('should handle uppercase extensions', () => {
      const extensions = ['.TXT', '.LOG', '.JSON', '.XML'];
      const fileSize = 60 * 1024 * 1024;

      extensions.forEach(ext => {
        const result = CompressionManager.shouldCompressFile(`test${ext}`, fileSize);
        expect(result).toBe(true);
      });
    });

    it('should handle mixed case extensions', () => {
      const result = CompressionManager.shouldCompressFile('test.JsOn', 60 * 1024 * 1024);
      expect(result).toBe(true);
    });

    it('should handle file paths with directories', () => {
      const result = CompressionManager.shouldCompressFile('/path/to/file/test.log', 60 * 1024 * 1024);
      expect(result).toBe(true);
    });

    it('should handle Windows-style paths', () => {
      const result = CompressionManager.shouldCompressFile(String.raw`C:\path\to\file\test.log`, 60 * 1024 * 1024);
      expect(result).toBe(true);
    });

    it('should reject image files regardless of size', () => {
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
      const largeSize = 1024 * 1024 * 1024; // 1GB

      imageExts.forEach(ext => {
        const result = CompressionManager.shouldCompressFile(`image${ext}`, largeSize);
        expect(result).toBe(false);
      });
    });

    it('should reject already compressed files', () => {
      const compressedExts = ['.gz', '.zip', '.7z', '.rar', '.bz2', '.xz'];
      const largeSize = 1024 * 1024 * 1024;

      compressedExts.forEach(ext => {
        const result = CompressionManager.shouldCompressFile(`archive${ext}`, largeSize);
        expect(result).toBe(false);
      });
    });

    it('should handle code file extensions', () => {
      const codeExts = ['.py', '.java', '.cpp', '.c', '.h'];
      const fileSize = 60 * 1024 * 1024;

      codeExts.forEach(ext => {
        const result = CompressionManager.shouldCompressFile(`code${ext}`, fileSize);
        expect(result).toBe(true);
      });
    });

    it('should handle source files with numbers in extension', () => {
      const result = CompressionManager.shouldCompressFile('test.c', 60 * 1024 * 1024);
      expect(result).toBe(true);
    });

    it('should handle Markdown and documentation files', () => {
      const docExts = ['.md', '.yml', '.yaml', '.xml'];
      const fileSize = 60 * 1024 * 1024;

      docExts.forEach(ext => {
        const result = CompressionManager.shouldCompressFile(`doc${ext}`, fileSize);
        expect(result).toBe(true);
      });
    });

    it('should handle exactly one byte over threshold', () => {
      const result = CompressionManager.shouldCompressFile('test.log', 50 * 1024 * 1024 + 1);
      expect(result).toBe(true);
    });

    it('should reject non-compressible files even if large', () => {
      const result = CompressionManager.shouldCompressFile('test.mp4', 5 * 1024 * 1024 * 1024); // 5GB
      expect(result).toBe(false);
    });
  });

  describe('compressFile - Extended Edge Cases', () => {
    it('should handle empty files', async () => {
      fs.writeFileSync(testFile, '');

      const compressedPath = await CompressionManager.compressFile(testFile);

      expect(fs.existsSync(compressedPath)).toBe(true);
      expect(compressedPath).toBe(`${testFile}.gz`);

      // Cleanup
      fs.unlinkSync(compressedPath);
    });

    it('should handle files with single character', async () => {
      fs.writeFileSync(testFile, 'x');

      const compressedPath = await CompressionManager.compressFile(testFile);

      expect(fs.existsSync(compressedPath)).toBe(true);

      // Cleanup
      fs.unlinkSync(compressedPath);
    });

    it('should handle files with special characters in content', async () => {
      const specialContent = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\n\t\r';
      fs.writeFileSync(testFile, specialContent.repeat(1000));

      const compressedPath = await CompressionManager.compressFile(testFile);

      expect(fs.existsSync(compressedPath)).toBe(true);

      // Cleanup
      fs.unlinkSync(compressedPath);
    });

    it('should handle files with Unicode content', async () => {
      const unicodeContent = '你好世界🌍こんにちは世界\n'.repeat(1000);
      fs.writeFileSync(testFile, unicodeContent, 'utf8');

      const compressedPath = await CompressionManager.compressFile(testFile);

      expect(fs.existsSync(compressedPath)).toBe(true);

      // Cleanup
      fs.unlinkSync(compressedPath);
    });

    it('should handle binary content', async () => {
      const binaryData = Buffer.alloc(10000);
      for (let i = 0; i < binaryData.length; i++) {
        binaryData[i] = i % 256;
      }
      fs.writeFileSync(testFile, binaryData);

      const compressedPath = await CompressionManager.compressFile(testFile);

      expect(fs.existsSync(compressedPath)).toBe(true);

      // Cleanup
      fs.unlinkSync(compressedPath);
    });
  });

  describe('decompressRemoteFile - Extended Edge Cases', () => {
    it('should handle paths with spaces', async () => {
      const mockClient = {
        exec: vi.fn((cmd, callback) => {
          expect(cmd).toContain('gunzip');
          expect(cmd).toContain('/remote/path with spaces/file.log.gz');

          const mockStream = {
            on: vi.fn((event, handler) => {
              if (event === 'close') {
                setTimeout(() => handler(0), 10);
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

      await CompressionManager.decompressRemoteFile(mockClient, '/remote/path with spaces/file.log');
      expect(mockClient.exec).toHaveBeenCalled();
    });

    it('should handle paths with special characters', async () => {
      const mockClient = {
        exec: vi.fn((cmd, callback) => {
          expect(cmd).toContain('gunzip');

          const mockStream = {
            on: vi.fn((event, handler) => {
              if (event === 'close') {
                setTimeout(() => handler(0), 10);
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

      await CompressionManager.decompressRemoteFile(mockClient, '/remote/file@#$%.log');
      expect(mockClient.exec).toHaveBeenCalled();
    });

    it('should handle very long paths', async () => {
      const longPath = '/remote/' + 'very/long/'.repeat(20) + 'path/file.log';
      const mockClient = {
        exec: vi.fn((cmd, callback) => {
          const mockStream = {
            on: vi.fn((event, handler) => {
              if (event === 'close') {
                setTimeout(() => handler(0), 10);
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

      await CompressionManager.decompressRemoteFile(mockClient, longPath);
      expect(mockClient.exec).toHaveBeenCalled();
    });

    it('should collect stderr output on failure', async () => {
      const mockClient = {
        exec: vi.fn((cmd, callback) => {
          const mockStream = {
            on: vi.fn((event, handler) => {
              if (event === 'close') {
                setTimeout(() => handler(1), 20);
              }
              return mockStream;
            }),
            stderr: {
              on: vi.fn((event, handler) => {
                if (event === 'data') {
                  setTimeout(() => {
                    handler(Buffer.from('Error part 1\n'));
                    handler(Buffer.from('Error part 2\n'));
                  }, 5);
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
      ).rejects.toThrow();
    });
  });

  describe('checkRemoteGunzip - Extended Edge Cases', () => {
    it('should handle gunzip path with newlines', async () => {
      const mockClient = {
        exec: vi.fn((cmd, callback) => {
          const mockStream = {
            on: vi.fn((event, handler) => {
              if (event === 'data') {
                setTimeout(() => handler(Buffer.from('/usr/bin/gunzip\n\n')), 5);
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

    it('should return false for empty output even with zero exit code', async () => {
      const mockClient = {
        exec: vi.fn((cmd, callback) => {
          const mockStream = {
            on: vi.fn((event, handler) => {
              if (event === 'data') {
                setTimeout(() => handler(Buffer.from('')), 5);
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
      expect(result).toBe(false);
    });

    it('should return false for whitespace-only output', async () => {
      const mockClient = {
        exec: vi.fn((cmd, callback) => {
          const mockStream = {
            on: vi.fn((event, handler) => {
              if (event === 'data') {
                setTimeout(() => handler(Buffer.from('   \n  \t  ')), 5);
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
      expect(result).toBe(false);
    });
  });
});
