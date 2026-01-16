import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import * as vscode from 'vscode';
import { TransferQueueCommands } from './transferQueueCommands';
import { TransferTaskModel } from '../models/transferTask';

describe('TransferQueueCommands', () => {
  let mockOutputChannel: any;
  let commands: TransferQueueCommands;

  beforeAll(() => {
    // Set up vscode mocks
    mockOutputChannel = {
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn()
    };

    vi.spyOn(vscode.window, 'createOutputChannel').mockReturnValue(mockOutputChannel);
  });

  beforeEach(() => {
    commands = new TransferQueueCommands();
  });

  describe('markdownToHtml', () => {
    it('should convert markdown bold to HTML strong tags', () => {
      const task = {
        fileName: 'test.txt',
        status: 'completed'
      } as unknown as TransferTaskModel;

      const markdown = '**File:** test.txt';
      const html = (commands as any).markdownToHtml(markdown, task);

      expect(html).toContain('<strong>File:</strong>');
    });

    it('should convert newlines to br tags', () => {
      const task = {
        fileName: 'test.txt',
        status: 'completed'
      } as TransferTaskModel;

      const markdown = 'Line 1\n\nLine 2\nLine 3';
      const html = (commands as any).markdownToHtml(markdown, task);

      expect(html).toContain('<br>');
    });

    it('should include VS Code theme variables', () => {
      const task = {
        fileName: 'test.txt',
        status: 'running'
      } as TransferTaskModel;

      const markdown = '**Test**';
      const html = (commands as any).markdownToHtml(markdown, task);

      expect(html).toContain('var(--vscode-font-family)');
      expect(html).toContain('var(--vscode-foreground)');
      expect(html).toContain('var(--vscode-editor-background)');
    });
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
