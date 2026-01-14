import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  formatFileSize,
  formatSpeed,
  formatRemainingTime,
  formatBytes,
  formatDuration
} from './formatUtils';

describe('formatUtils', () => {
  describe('formatFileSize', () => {
    it('should format 0 bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('should format bytes (< 1 KB)', () => {
      expect(formatFileSize(500)).toBe('500.00 B');
      expect(formatFileSize(1023)).toBe('1023.00 B');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1.00 KB');
      expect(formatFileSize(1536)).toBe('1.50 KB');
      expect(formatFileSize(10240)).toBe('10.00 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.00 MB');
      expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.50 MB');
      expect(formatFileSize(100 * 1024 * 1024)).toBe('100.00 MB');
    });

    it('should format gigabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
      expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
    });

    it('should format terabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toBe('1.00 TB');
      expect(formatFileSize(5.5 * 1024 * 1024 * 1024 * 1024)).toBe('5.50 TB');
    });

    it('should handle very large numbers', () => {
      const veryLarge = 1024 * 1024 * 1024 * 1024 * 1024; // Petabytes
      const result = formatFileSize(veryLarge);
      expect(result).toContain('TB'); // Should cap at TB
    });

    it('should round to 2 decimal places', () => {
      expect(formatFileSize(1234)).toBe('1.21 KB');
      expect(formatFileSize(1536789)).toBe('1.47 MB');
    });
  });

  describe('formatBytes', () => {
    it('should be alias for formatFileSize', () => {
      const testValue = 1536 * 1024;
      expect(formatBytes(testValue)).toBe(formatFileSize(testValue));
    });
  });

  describe('formatSpeed', () => {
    let mockConfig: any;

    beforeEach(() => {
      mockConfig = {
        speedUnit: 'auto'
      };

      // Mock vscode.workspace.getConfiguration
      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: vi.fn((key: string, defaultValue?: any) => {
          if (key === 'speedUnit') {
            return mockConfig.speedUnit;
          }
          return defaultValue;
        })
      } as any);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('auto mode', () => {
      it('should format slow speeds in KB/s', () => {
        mockConfig.speedUnit = 'auto';
        expect(formatSpeed(512)).toBe('0.50 KB/s');
        expect(formatSpeed(1024)).toBe('1.00 KB/s');
        expect(formatSpeed(512 * 1024)).toBe('512.00 KB/s');
      });

      it('should format fast speeds in MB/s', () => {
        mockConfig.speedUnit = 'auto';
        expect(formatSpeed(1024 * 1024)).toBe('1.00 MB/s');
        expect(formatSpeed(5.5 * 1024 * 1024)).toBe('5.50 MB/s');
        expect(formatSpeed(100 * 1024 * 1024)).toBe('100.00 MB/s');
      });

      it('should switch from KB/s to MB/s at 1 MB/s threshold', () => {
        mockConfig.speedUnit = 'auto';
        const justUnder = 1024 * 1024 - 1;
        const justOver = 1024 * 1024;

        expect(formatSpeed(justUnder)).toContain('KB/s');
        expect(formatSpeed(justOver)).toContain('MB/s');
      });
    });

    describe('KB mode', () => {
      it('should always format in KB/s', () => {
        mockConfig.speedUnit = 'KB';
        expect(formatSpeed(512)).toBe('0.50 KB/s');
        expect(formatSpeed(1024)).toBe('1.00 KB/s');
        expect(formatSpeed(1024 * 1024)).toBe('1024.00 KB/s');
        expect(formatSpeed(10 * 1024 * 1024)).toBe('10240.00 KB/s');
      });
    });

    describe('MB mode', () => {
      it('should always format in MB/s', () => {
        mockConfig.speedUnit = 'MB';
        expect(formatSpeed(512)).toBe('0.00 MB/s');
        expect(formatSpeed(512 * 1024)).toBe('0.50 MB/s');
        expect(formatSpeed(1024 * 1024)).toBe('1.00 MB/s');
        expect(formatSpeed(10 * 1024 * 1024)).toBe('10.00 MB/s');
      });
    });

    it('should handle 0 speed', () => {
      mockConfig.speedUnit = 'auto';
      expect(formatSpeed(0)).toBe('0.00 KB/s');
    });
  });

  describe('formatRemainingTime', () => {
    it('should format seconds (< 60s)', () => {
      expect(formatRemainingTime(0)).toBe('0s');
      expect(formatRemainingTime(1)).toBe('1s');
      expect(formatRemainingTime(30)).toBe('30s');
      expect(formatRemainingTime(59)).toBe('59s');
    });

    it('should format minutes and seconds', () => {
      expect(formatRemainingTime(60)).toBe('1m 0s');
      expect(formatRemainingTime(90)).toBe('1m 30s');
      expect(formatRemainingTime(150)).toBe('2m 30s');
      expect(formatRemainingTime(3599)).toBe('59m 59s');
    });

    it('should format hours and minutes', () => {
      expect(formatRemainingTime(3600)).toBe('1h 0m');
      expect(formatRemainingTime(5400)).toBe('1h 30m');
      expect(formatRemainingTime(7200)).toBe('2h 0m');
      expect(formatRemainingTime(10800)).toBe('3h 0m');
    });

    it('should round seconds appropriately', () => {
      expect(formatRemainingTime(30.4)).toBe('30s');
      expect(formatRemainingTime(30.6)).toBe('31s');
      expect(formatRemainingTime(89.7)).toBe('1m 30s');
    });

    it('should handle very large durations', () => {
      expect(formatRemainingTime(86400)).toBe('24h 0m'); // 1 day
      expect(formatRemainingTime(172800)).toBe('48h 0m'); // 2 days
    });

    it('should format fractional seconds correctly', () => {
      expect(formatRemainingTime(0.5)).toBe('1s');
      expect(formatRemainingTime(1.5)).toBe('2s');
    });
  });

  describe('formatDuration', () => {
    it('should convert milliseconds to seconds and format', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(30000)).toBe('30s');
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(3600000)).toBe('1h 0m');
    });

    it('should handle 0 milliseconds', () => {
      expect(formatDuration(0)).toBe('0s');
    });

    it('should handle fractional milliseconds', () => {
      expect(formatDuration(500)).toBe('1s'); // 0.5 seconds, rounded to 1s
      expect(formatDuration(1500)).toBe('2s'); // 1.5 seconds, rounded to 2s
    });

    it('should handle very small durations', () => {
      expect(formatDuration(100)).toBe('0s');
      expect(formatDuration(999)).toBe('1s');
    });

    it('should handle large durations', () => {
      expect(formatDuration(86400000)).toBe('24h 0m'); // 1 day
      expect(formatDuration(3723000)).toBe('1h 2m'); // 1h 2m 3s
    });
  });

  describe('integration tests', () => {
    it('should consistently format related values', () => {
      const bytes = 1536 * 1024; // 1.5 MB
      const bytesPerSecond = bytes / 10; // Transfer in 10 seconds

      expect(formatFileSize(bytes)).toBe('1.50 MB');
      expect(formatSpeed(bytesPerSecond)).toContain('153.60 KB/s');
      expect(formatDuration(10000)).toBe('10s');
    });

    it('should handle typical file transfer scenario', () => {
      const fileSize = 100 * 1024 * 1024; // 100 MB
      const speed = 10 * 1024 * 1024; // 10 MB/s
      const remainingTime = fileSize / speed; // 10 seconds

      expect(formatFileSize(fileSize)).toBe('100.00 MB');
      expect(formatSpeed(speed)).toContain('MB/s');
      expect(formatRemainingTime(remainingTime)).toBe('10s');
    });
  });
});
