import { describe, it, expect, beforeEach } from 'vitest';
import { TransferQueueCommands } from './transferQueueCommands';

describe('TransferQueueCommands', () => {
  let commands: TransferQueueCommands;

  beforeEach(() => {
    commands = new TransferQueueCommands();
  });

  describe('getStatusColor', () => {
    it('should return correct color for each status', () => {
      expect((commands as any).getStatusColor('completed')).toBe('#4ec9b0');
      expect((commands as any).getStatusColor('failed')).toBe('#f48771');
      expect((commands as any).getStatusColor('running')).toBe('#569cd6');
      expect((commands as any).getStatusColor('paused')).toBe('#dcdcaa');
      expect((commands as any).getStatusColor('cancelled')).toBe('#858585');
    });

    it('should return default color for unknown status', () => {
      expect((commands as any).getStatusColor('unknown')).toBe('#d4d4d4');
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect((commands as any).formatBytes(0)).toBe('0 B');
      expect((commands as any).formatBytes(1024)).toBe('1.00 KB');
      expect((commands as any).formatBytes(1048576)).toBe('1.00 MB');
      expect((commands as any).formatBytes(1073741824)).toBe('1.00 GB');
      expect((commands as any).formatBytes(500)).toBe('500.00 B'); // Implementation uses .toFixed(2)
      expect((commands as any).formatBytes(1536)).toBe('1.50 KB');
    });
  });

  describe('formatSpeed', () => {
    it('should format speed correctly', () => {
      expect((commands as any).formatSpeed(0)).toBe('0 B/s');
      expect((commands as any).formatSpeed(1024)).toBe('1.00 KB/s');
      expect((commands as any).formatSpeed(1048576)).toBe('1.00 MB/s');
      expect((commands as any).formatSpeed(2048)).toBe('2.00 KB/s');
    });
  });

  describe('formatDuration', () => {
    it('should format duration correctly', () => {
      expect((commands as any).formatDuration(1000)).toBe('1s');
      expect((commands as any).formatDuration(60000)).toBe('1m 0s');
      expect((commands as any).formatDuration(3661000)).toBe('1h 1m'); // Hours+minutes format doesn't show seconds
      expect((commands as any).formatDuration(90000)).toBe('1m 30s');
      expect((commands as any).formatDuration(500)).toBe('0s');
    });
  });
});
