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

      // Call private method through showTaskDetails
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

    it('should include task filename in title', () => {
      const task = {
        fileName: 'important-file.zip',
        status: 'completed'
      } as TransferTaskModel;

      const markdown = '**File:** important-file.zip';
      const html = (commands as any).markdownToHtml(markdown, task);

      expect(html).toContain('important-file.zip');
    });
  });

  describe('getStatusColor', () => {
    it('should return green for completed status', () => {
      const color = (commands as any).getStatusColor('completed');
      expect(color).toBe('#4ec9b0');
    });

    it('should return red for failed status', () => {
      const color = (commands as any).getStatusColor('failed');
      expect(color).toBe('#f48771');
    });

    it('should return blue for running status', () => {
      const color = (commands as any).getStatusColor('running');
      expect(color).toBe('#569cd6');
    });

    it('should return yellow for paused status', () => {
      const color = (commands as any).getStatusColor('paused');
      expect(color).toBe('#dcdcaa');
    });

    it('should return gray for cancelled status', () => {
      const color = (commands as any).getStatusColor('cancelled');
      expect(color).toBe('#858585');
    });

    it('should return default color for unknown status', () => {
      const color = (commands as any).getStatusColor('unknown');
      expect(color).toBe('#d4d4d4');
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

  describe('Markdown to HTML edge cases', () => {
    const task = { fileName: 'test.txt', status: 'running' } as unknown as TransferTaskModel;

    it('should handle empty markdown', () => {
      const html = (commands as any).markdownToHtml('', task);
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
    });

    it('should handle markdown without bold text', () => {
      const markdown = 'Plain text without formatting';
      const html = (commands as any).markdownToHtml(markdown, task);
      expect(html).toContain('Plain text without formatting');
      expect(html).not.toContain('**');
    });

    it('should handle multiple consecutive newlines', () => {
      const markdown = 'Line 1\n\n\n\nLine 2';
      const html = (commands as any).markdownToHtml(markdown, task);
      expect(html).toContain('<br>');
    });

    it('should handle special characters in text', () => {
      const markdown = 'File: **test-file.txt**';
      const html = (commands as any).markdownToHtml(markdown, task);
      expect(html).toContain('test-file.txt');
    });

    it('should apply status-specific class', () => {
      const runningTask = { fileName: 'test.txt', status: 'running' } as unknown as TransferTaskModel;
      const html = (commands as any).markdownToHtml('Test', runningTask);
      expect(html).toContain('status-running');
    });
  });
});
