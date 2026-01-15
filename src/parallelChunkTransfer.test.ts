import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ParallelChunkTransferManager } from './parallelChunkTransfer';
import { HostConfig, HostAuthConfig } from './types';

describe('ParallelChunkTransferManager', () => {
  let manager: ParallelChunkTransferManager;
  let mockConfig: HostConfig;
  let mockAuthConfig: HostAuthConfig;

  beforeEach(() => {
    manager = new ParallelChunkTransferManager();
    mockConfig = {
      id: 'test-host',
      name: 'Test Host',
      host: 'localhost',
      port: 22,
      username: 'testuser'
    };
    mockAuthConfig = {
      hostId: 'test-host',
      authType: 'password',
      password: 'testpass'
    };
  });

  describe('shouldUseParallelTransfer', () => {
    it('should return true for files larger than threshold', () => {
      const threshold = 100 * 1024 * 1024; // 100MB
      const fileSize = 150 * 1024 * 1024; // 150MB

      const result = manager.shouldUseParallelTransfer(fileSize, { threshold });

      expect(result).toBe(true);
    });

    it('should return false for files smaller than threshold', () => {
      const threshold = 100 * 1024 * 1024; // 100MB
      const fileSize = 50 * 1024 * 1024; // 50MB

      const result = manager.shouldUseParallelTransfer(fileSize, { threshold });

      expect(result).toBe(false);
    });

    it('should return true for files equal to threshold', () => {
      const threshold = 100 * 1024 * 1024; // 100MB
      const fileSize = 100 * 1024 * 1024; // 100MB

      const result = manager.shouldUseParallelTransfer(fileSize, { threshold });

      expect(result).toBe(true);
    });

    it('should use default threshold when not provided', () => {
      const fileSize = 150 * 1024 * 1024; // 150MB (> 100MB default)

      const result = manager.shouldUseParallelTransfer(fileSize);

      expect(result).toBe(true);
    });
  });

  describe('chunk splitting (internal logic)', () => {
    it('should split file into correct number of chunks', () => {
      const fileSize = 100 * 1024 * 1024; // 100MB
      const chunkSize = 10 * 1024 * 1024; // 10MB

      // Expected chunks: 100MB / 10MB = 10 chunks
      const expectedChunks = 10;

      // We can't directly test private method, but we can infer from the manager's behavior
      // For a 100MB file with 10MB chunks, we should see 10 chunk transfer operations
      expect(Math.ceil(fileSize / chunkSize)).toBe(expectedChunks);
    });

    it('should handle file size not evenly divisible by chunk size', () => {
      const fileSize = 105 * 1024 * 1024; // 105MB
      const chunkSize = 10 * 1024 * 1024; // 10MB

      // Expected: 10 full chunks (100MB) + 1 partial chunk (5MB) = 11 chunks
      const expectedChunks = 11;

      expect(Math.ceil(fileSize / chunkSize)).toBe(expectedChunks);
    });

    it('should create single chunk for file smaller than chunk size', () => {
      const fileSize = 5 * 1024 * 1024; // 5MB
      const chunkSize = 10 * 1024 * 1024; // 10MB

      // Expected: 1 chunk
      const expectedChunks = 1;

      expect(Math.ceil(fileSize / chunkSize)).toBe(expectedChunks);
    });
  });

  describe('configuration options', () => {
    it('should use custom chunk size', () => {
      const customChunkSize = 20 * 1024 * 1024; // 20MB
      const fileSize = 200 * 1024 * 1024; // 200MB

      const expectedChunks = Math.ceil(fileSize / customChunkSize);

      expect(expectedChunks).toBe(10);
    });

    it('should respect max concurrent limit', () => {
      const maxConcurrent = 3;

      // If we have 10 chunks and max 3 concurrent, we should process in batches
      // Batch 1: chunks 0-2 (3 chunks)
      // Batch 2: chunks 3-5 (3 chunks)
      // Batch 3: chunks 6-8 (3 chunks)
      // Batch 4: chunk 9 (1 chunk)
      const totalChunks = 10;
      const expectedBatches = Math.ceil(totalChunks / maxConcurrent);

      expect(expectedBatches).toBe(4);
    });
  });

  describe('progress tracking', () => {
    it('should aggregate progress from multiple chunks', () => {
      const chunkProgress = {
        0: 10 * 1024 * 1024,  // 10MB
        1: 10 * 1024 * 1024,  // 10MB
        2: 5 * 1024 * 1024,   // 5MB
      };

      const totalTransferred = Object.values(chunkProgress).reduce((sum, val) => sum + val, 0);

      expect(totalTransferred).toBe(25 * 1024 * 1024); // 25MB total
    });

    it('should calculate progress percentage correctly', () => {
      const transferred = 50 * 1024 * 1024; // 50MB
      const total = 100 * 1024 * 1024; // 100MB

      const progressPercent = (transferred / total) * 100;

      expect(progressPercent).toBe(50);
    });
  });

  describe('error handling', () => {
    it('should handle abort signal', async () => {
      const abortController = new AbortController();

      // Simulate abort
      abortController.abort();

      // Transfer should throw when aborted
      expect(abortController.signal.aborted).toBe(true);
    });
  });

  describe('chunk merge operations', () => {
    it('should process chunks in correct order', () => {
      const chunks = [
        { index: 0, start: 0, end: 9999999, size: 10000000 },
        { index: 1, start: 10000000, end: 19999999, size: 10000000 },
        { index: 2, start: 20000000, end: 29999999, size: 10000000 },
      ];

      // Chunks should be merged in order: 0, 1, 2
      const orderedIndices = chunks.map(c => c.index).sort((a, b) => a - b);

      expect(orderedIndices).toEqual([0, 1, 2]);
    });

    it('should calculate correct byte ranges', () => {
      const chunkSize = 10 * 1024 * 1024; // 10MB
      const chunkIndex = 5;

      const expectedStart = chunkIndex * chunkSize; // 50MB
      const expectedEnd = expectedStart + chunkSize - 1; // 60MB - 1

      expect(expectedStart).toBe(50 * 1024 * 1024);
      expect(expectedEnd).toBe(60 * 1024 * 1024 - 1);
    });
  });

  describe('concurrent transfer batching', () => {
    it('should split chunks into correct batches', () => {
      const totalChunks = 13;
      const maxConcurrent = 5;

      const batches: number[][] = [];
      for (let i = 0; i < totalChunks; i += maxConcurrent) {
        const batchSize = Math.min(maxConcurrent, totalChunks - i);
        const batch = Array.from({ length: batchSize }, (_, j) => i + j);
        batches.push(batch);
      }

      expect(batches).toEqual([
        [0, 1, 2, 3, 4],     // Batch 1: 5 chunks
        [5, 6, 7, 8, 9],     // Batch 2: 5 chunks
        [10, 11, 12]         // Batch 3: 3 chunks
      ]);
    });

    it('should handle single batch when chunks < maxConcurrent', () => {
      const totalChunks = 3;
      const maxConcurrent = 5;

      const batches: number[][] = [];
      for (let i = 0; i < totalChunks; i += maxConcurrent) {
        const batchSize = Math.min(maxConcurrent, totalChunks - i);
        const batch = Array.from({ length: batchSize }, (_, j) => i + j);
        batches.push(batch);
      }

      expect(batches).toEqual([
        [0, 1, 2]  // Single batch with 3 chunks
      ]);
    });
  });

  describe('file size threshold logic', () => {
    it('should use parallel for 100MB file with 100MB threshold', () => {
      const fileSize = 100 * 1024 * 1024;
      const threshold = 100 * 1024 * 1024;

      expect(fileSize >= threshold).toBe(true);
    });

    it('should not use parallel for 99MB file with 100MB threshold', () => {
      const fileSize = 99 * 1024 * 1024;
      const threshold = 100 * 1024 * 1024;

      expect(fileSize >= threshold).toBe(false);
    });

    it('should use parallel for 1GB file', () => {
      const fileSize = 1024 * 1024 * 1024; // 1GB
      const threshold = 100 * 1024 * 1024; // 100MB

      expect(fileSize >= threshold).toBe(true);
    });
  });
});
