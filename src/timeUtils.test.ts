import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimeUtils } from './timeUtils';

describe('TimeUtils', () => {
  describe('getCurrentISOTime', () => {
    it('should return current time in correct format', () => {
      const result = TimeUtils.getCurrentISOTime();

      // Should match format: YYYY-MM-DD HH:mm:ss.SSS
      const regex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;
      expect(result).toMatch(regex);
    });

    it('should return different values on successive calls', async () => {
      const time1 = TimeUtils.getCurrentISOTime();

      // Wait a small amount of time
      await new Promise(resolve => setTimeout(resolve, 10));

      const time2 = TimeUtils.getCurrentISOTime();

      // Times should be different (at least milliseconds)
      expect(time1).not.toBe(time2);
    });

    it('should format single-digit months and days with leading zeros', () => {
      // Mock date with single-digit month and day
      const mockDate = new Date(2024, 0, 5, 8, 5, 3, 7); // Jan 5, 2024, 08:05:03.007
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const result = TimeUtils.getCurrentISOTime();

      expect(result).toBe('2024-01-05 08:05:03.007');

      vi.useRealTimers();
    });

    it('should format double-digit values correctly', () => {
      // Mock date with double-digit values
      const mockDate = new Date(2024, 11, 31, 23, 59, 59, 999); // Dec 31, 2024, 23:59:59.999
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const result = TimeUtils.getCurrentISOTime();

      expect(result).toBe('2024-12-31 23:59:59.999');

      vi.useRealTimers();
    });
  });

  describe('formatISOTime', () => {
    it('should format timestamp correctly', () => {
      const timestamp = new Date(2024, 0, 15, 14, 30, 45, 123).getTime();
      const result = TimeUtils.formatISOTime(timestamp);

      expect(result).toBe('2024-01-15 14:30:45.123');
    });

    it('should handle timestamp at epoch', () => {
      const result = TimeUtils.formatISOTime(0);

      // The exact result depends on timezone, but should match the format
      const regex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;
      expect(result).toMatch(regex);
    });

    it('should handle very large timestamps', () => {
      // Date far in the future
      const futureTimestamp = new Date(2099, 11, 31, 23, 59, 59, 999).getTime();
      const result = TimeUtils.formatISOTime(futureTimestamp);

      expect(result).toBe('2099-12-31 23:59:59.999');
    });

    it('should format single-digit values with leading zeros', () => {
      const timestamp = new Date(2024, 0, 1, 1, 1, 1, 1).getTime();
      const result = TimeUtils.formatISOTime(timestamp);

      expect(result).toBe('2024-01-01 01:01:01.001');
    });

    it('should handle midnight correctly', () => {
      const timestamp = new Date(2024, 5, 15, 0, 0, 0, 0).getTime();
      const result = TimeUtils.formatISOTime(timestamp);

      expect(result).toBe('2024-06-15 00:00:00.000');
    });

    it('should handle different millisecond values', () => {
      const timestamp1 = new Date(2024, 5, 15, 12, 0, 0, 1).getTime();
      const timestamp2 = new Date(2024, 5, 15, 12, 0, 0, 10).getTime();
      const timestamp3 = new Date(2024, 5, 15, 12, 0, 0, 100).getTime();

      expect(TimeUtils.formatISOTime(timestamp1)).toBe('2024-06-15 12:00:00.001');
      expect(TimeUtils.formatISOTime(timestamp2)).toBe('2024-06-15 12:00:00.010');
      expect(TimeUtils.formatISOTime(timestamp3)).toBe('2024-06-15 12:00:00.100');
    });

    it('should match getCurrentISOTime for same instant', () => {
      vi.useFakeTimers();
      const mockDate = new Date(2024, 5, 15, 12, 30, 45, 678);
      vi.setSystemTime(mockDate);

      const currentTime = TimeUtils.getCurrentISOTime();
      const formattedTime = TimeUtils.formatISOTime(mockDate.getTime());

      expect(currentTime).toBe(formattedTime);

      vi.useRealTimers();
    });
  });

  describe('formatTime', () => {
    it('should format timestamp without milliseconds', () => {
      const timestamp = new Date(2024, 0, 15, 14, 30, 45, 123).getTime();
      const result = TimeUtils.formatTime(timestamp);

      expect(result).toBe('2024-01-15 14:30:45');
    });

    it('should handle timestamp at epoch', () => {
      const result = TimeUtils.formatTime(0);

      // The exact result depends on timezone, but should match the format
      const regex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
      expect(result).toMatch(regex);
    });

    it('should format single-digit values with leading zeros', () => {
      const timestamp = new Date(2024, 0, 1, 1, 1, 1, 999).getTime();
      const result = TimeUtils.formatTime(timestamp);

      expect(result).toBe('2024-01-01 01:01:01');
    });

    it('should handle midnight correctly', () => {
      const timestamp = new Date(2024, 5, 15, 0, 0, 0, 0).getTime();
      const result = TimeUtils.formatTime(timestamp);

      expect(result).toBe('2024-06-15 00:00:00');
    });

    it('should handle end of day correctly', () => {
      const timestamp = new Date(2024, 11, 31, 23, 59, 59, 999).getTime();
      const result = TimeUtils.formatTime(timestamp);

      expect(result).toBe('2024-12-31 23:59:59');
    });

    it('should ignore milliseconds', () => {
      const timestamp1 = new Date(2024, 5, 15, 12, 0, 0, 0).getTime();
      const timestamp2 = new Date(2024, 5, 15, 12, 0, 0, 999).getTime();

      expect(TimeUtils.formatTime(timestamp1)).toBe('2024-06-15 12:00:00');
      expect(TimeUtils.formatTime(timestamp2)).toBe('2024-06-15 12:00:00');
    });

    it('should format far future dates correctly', () => {
      const futureTimestamp = new Date(2099, 11, 31, 23, 59, 59, 999).getTime();
      const result = TimeUtils.formatTime(futureTimestamp);

      expect(result).toBe('2099-12-31 23:59:59');
    });

    it('should differ from formatISOTime only by milliseconds', () => {
      const timestamp = new Date(2024, 5, 15, 12, 30, 45, 678).getTime();

      const timeWithMs = TimeUtils.formatISOTime(timestamp);
      const timeWithoutMs = TimeUtils.formatTime(timestamp);

      expect(timeWithMs).toBe('2024-06-15 12:30:45.678');
      expect(timeWithoutMs).toBe('2024-06-15 12:30:45');
      expect(timeWithMs.substring(0, 19)).toBe(timeWithoutMs);
    });
  });
});
