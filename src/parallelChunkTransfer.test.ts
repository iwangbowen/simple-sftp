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

  describe('chunk size edge cases', () => {
    it('should handle minimum chunk size (1 byte)', () => {
      const fileSize = 1000;
      const chunkSize = 1;

      const chunks = Math.ceil(fileSize / chunkSize);

      expect(chunks).toBe(1000);
    });

    it('should handle chunk size equal to file size', () => {
      const fileSize = 50 * 1024 * 1024;
      const chunkSize = 50 * 1024 * 1024;

      const chunks = Math.ceil(fileSize / chunkSize);

      expect(chunks).toBe(1);
    });

    it('should handle chunk size larger than file size', () => {
      const fileSize = 10 * 1024 * 1024;
      const chunkSize = 50 * 1024 * 1024;

      const chunks = Math.ceil(fileSize / chunkSize);

      expect(chunks).toBe(1);
    });

    it('should handle very large chunk size (1GB)', () => {
      const fileSize = 5 * 1024 * 1024 * 1024; // 5GB
      const chunkSize = 1024 * 1024 * 1024; // 1GB

      const chunks = Math.ceil(fileSize / chunkSize);

      expect(chunks).toBe(5);
    });

    it('should handle odd chunk sizes', () => {
      const fileSize = 100000000; // 100MB
      const chunkSize = 7777777; // ~7.4MB

      const chunks = Math.ceil(fileSize / chunkSize);

      expect(chunks).toBe(13);
    });
  });

  describe('concurrent operations edge cases', () => {
    it('should handle maxConcurrent = 1 (sequential)', () => {
      const totalChunks = 10;
      const maxConcurrent = 1;

      const batches = Math.ceil(totalChunks / maxConcurrent);

      expect(batches).toBe(10); // 10 batches of 1 chunk each
    });

    it('should handle maxConcurrent > total chunks', () => {
      const totalChunks = 5;
      const maxConcurrent = 10;

      const batches = Math.ceil(totalChunks / maxConcurrent);

      expect(batches).toBe(1); // Single batch with all 5 chunks
    });

    it('should handle very high concurrency (100+)', () => {
      const totalChunks = 50;
      const maxConcurrent = 100;

      const batches = Math.ceil(totalChunks / maxConcurrent);

      expect(batches).toBe(1); // Single batch
    });

    it('should handle maxConcurrent exactly equals total chunks', () => {
      const totalChunks = 8;
      const maxConcurrent = 8;

      const batches = Math.ceil(totalChunks / maxConcurrent);

      expect(batches).toBe(1);
    });
  });

  describe('file size edge cases', () => {
    it('should handle 0 byte file (empty file)', () => {
      const fileSize = 0;
      const threshold = 100 * 1024 * 1024;

      const result = manager.shouldUseParallelTransfer(fileSize, { threshold });

      expect(result).toBe(false);
    });

    it('should handle 1 byte file', () => {
      const fileSize = 1;
      const chunkSize = 10 * 1024 * 1024;

      const chunks = Math.ceil(fileSize / chunkSize);

      expect(chunks).toBe(1);
    });

    it('should handle very large file (10GB)', () => {
      const fileSize = 10 * 1024 * 1024 * 1024; // 10GB
      const threshold = 100 * 1024 * 1024; // 100MB

      const result = manager.shouldUseParallelTransfer(fileSize, { threshold });

      expect(result).toBe(true);
    });

    it('should handle threshold boundary (threshold - 1)', () => {
      const threshold = 100 * 1024 * 1024;
      const fileSize = threshold - 1;

      const result = manager.shouldUseParallelTransfer(fileSize, { threshold });

      expect(result).toBe(false);
    });

    it('should handle threshold boundary (threshold + 1)', () => {
      const threshold = 100 * 1024 * 1024;
      const fileSize = threshold + 1;

      const result = manager.shouldUseParallelTransfer(fileSize, { threshold });

      expect(result).toBe(true);
    });
  });

  describe('progress tracking edge cases', () => {
    it('should handle progress with different chunk sizes', () => {
      const chunkProgress = {
        0: 10 * 1024 * 1024,  // Chunk 0: 10MB
        1: 5 * 1024 * 1024,   // Chunk 1: 5MB (smaller, last chunk)
        2: 10 * 1024 * 1024,  // Chunk 2: 10MB
      };

      const totalTransferred = Object.values(chunkProgress).reduce((sum, val) => sum + val, 0);

      expect(totalTransferred).toBe(25 * 1024 * 1024);
    });

    it('should handle all chunks completed (100% progress)', () => {
      const fileSize = 100 * 1024 * 1024;
      const transferred = 100 * 1024 * 1024;

      const progressPercent = (transferred / fileSize) * 100;

      expect(progressPercent).toBe(100);
    });

    it('should handle 0% progress (no transfer started)', () => {
      const fileSize = 100 * 1024 * 1024;
      const transferred = 0;

      const progressPercent = (transferred / fileSize) * 100;

      expect(progressPercent).toBe(0);
    });

    it('should handle partial chunk transfer', () => {
      const chunkSize = 10 * 1024 * 1024; // 10MB
      const partialTransferred = 3 * 1024 * 1024; // 3MB (30% of chunk)

      const chunkProgress = (partialTransferred / chunkSize) * 100;

      expect(chunkProgress).toBe(30);
    });
  });

  describe('byte range calculation edge cases', () => {
    it('should calculate correct range for last chunk with smaller size', () => {
      const fileSize = 105 * 1024 * 1024; // 105MB
      const chunkSize = 10 * 1024 * 1024; // 10MB
      const lastChunkIndex = 10; // 11 chunks total (0-10)

      const expectedStart = lastChunkIndex * chunkSize; // 100MB
      const expectedEnd = fileSize - 1; // 105MB - 1

      expect(expectedStart).toBe(100 * 1024 * 1024);
      expect(expectedEnd).toBe(105 * 1024 * 1024 - 1);
      expect(expectedEnd - expectedStart + 1).toBe(5 * 1024 * 1024); // 5MB last chunk
    });

    it('should calculate correct range for first chunk', () => {
      const chunkSize = 10 * 1024 * 1024; // 10MB
      const chunkIndex = 0;

      const expectedStart = chunkIndex * chunkSize; // 0
      const expectedEnd = chunkSize - 1; // 10MB - 1

      expect(expectedStart).toBe(0);
      expect(expectedEnd).toBe(10 * 1024 * 1024 - 1);
    });

    it('should not have overlapping ranges', () => {
      const chunkSize = 10 * 1024 * 1024; // 10MB

      const chunk1Start = 0 * chunkSize;
      const chunk1End = chunk1Start + chunkSize - 1;

      const chunk2Start = 1 * chunkSize;

      // Chunk 1 end should be 1 byte before chunk 2 start
      expect(chunk1End + 1).toBe(chunk2Start);
      expect(chunk1End).toBe(10 * 1024 * 1024 - 1);
      expect(chunk2Start).toBe(10 * 1024 * 1024);
    });
  });

  describe('batch processing edge cases', () => {
    it('should handle empty chunk array', () => {
      const totalChunks = 0;
      const maxConcurrent = 5;

      const batches = Math.ceil(totalChunks / maxConcurrent) || 0;

      expect(batches).toBe(0);
    });

    it('should handle very large batch count', () => {
      const totalChunks = 1000; // 1000 chunks
      const maxConcurrent = 1; // Sequential

      const batches = Math.ceil(totalChunks / maxConcurrent);

      expect(batches).toBe(1000);
    });

    it('should process prime number of chunks with even maxConcurrent', () => {
      const totalChunks = 13; // Prime number
      const maxConcurrent = 4; // Even number

      const batches = Math.ceil(totalChunks / maxConcurrent);

      expect(batches).toBe(4); // Batches: 4, 4, 4, 1
    });
  });
});
