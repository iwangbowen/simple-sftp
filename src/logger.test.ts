import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';

describe('Logger', () => {
  let mockOutputChannel: any;
  let appendLineSpy: any;

  beforeAll(() => {
    // Set up the mock before importing logger
    appendLineSpy = vi.fn();

    mockOutputChannel = {
      appendLine: appendLineSpy,
      show: vi.fn(),
      dispose: vi.fn()
    };

    // Mock vscode.window.createOutputChannel
    vi.spyOn(vscode.window, 'createOutputChannel').mockReturnValue(mockOutputChannel as any);
  });

  afterEach(() => {
    // Clear mock history between tests
    appendLineSpy.mockClear();
    mockOutputChannel.show.mockClear();
    mockOutputChannel.dispose.mockClear();
  });

  describe('info', () => {
    it('should log info messages with timestamp and level', async () => {
      // Import logger after mocks are set up
      const { logger } = await import('./logger');

      logger.info('Test info message');

      expect(appendLineSpy).toHaveBeenCalled();
      const loggedMessage = appendLineSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('[INFO]');
      expect(loggedMessage).toContain('Test info message');
      expect(loggedMessage).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]/);
    });
  });

  describe('warn', () => {
    it('should log warning messages with timestamp and level', async () => {
      const { logger } = await import('./logger');

      logger.warn('Test warning message');

      expect(appendLineSpy).toHaveBeenCalled();
      const loggedMessage = appendLineSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('[WARN]');
      expect(loggedMessage).toContain('Test warning message');
      expect(loggedMessage).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]/);
    });
  });

  describe('error', () => {
    it('should log error messages with timestamp and level', async () => {
      const { logger } = await import('./logger');

      logger.error('Test error message');

      expect(appendLineSpy).toHaveBeenCalled();
      const loggedMessage = appendLineSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('[ERROR]');
      expect(loggedMessage).toContain('Test error message');
      expect(loggedMessage).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]/);
    });

    it('should log error with Error object', async () => {
      const { logger } = await import('./logger');

      const error = new Error('Test error object');
      logger.error('Operation failed', error);

      expect(appendLineSpy).toHaveBeenCalled();
      const loggedMessage = appendLineSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('[ERROR]');
      expect(loggedMessage).toContain('Operation failed');
      expect(loggedMessage).toContain('Test error object');
    });

    it('should log error stack trace if available', async () => {
      const { logger } = await import('./logger');

      const error = new Error('Test error with stack');
      error.stack = 'Error: Test error with stack\n    at TestFile.test.ts:10:20';

      logger.error('Stack trace test', error);

      expect(appendLineSpy).toHaveBeenCalledTimes(2);
      const stackTrace = appendLineSpy.mock.calls[1][0];
      expect(stackTrace).toContain('Error: Test error with stack');
    });

    it('should handle error without stack trace', async () => {
      const { logger } = await import('./logger');

      const error = new Error('Test error');
      delete error.stack;

      logger.error('No stack test', error);

      // Should only be called once (no stack trace to append)
      expect(appendLineSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('debug', () => {
    it('should log debug messages with timestamp and level', async () => {
      const { logger } = await import('./logger');

      logger.debug('Test debug message');

      expect(appendLineSpy).toHaveBeenCalled();
      const loggedMessage = appendLineSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('[DEBUG]');
      expect(loggedMessage).toContain('Test debug message');
      expect(loggedMessage).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]/);
    });
  });

  describe('show', () => {
    it('should show the output channel', async () => {
      const { logger } = await import('./logger');

      logger.show();

      expect(mockOutputChannel.show).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should dispose the output channel', async () => {
      const { logger } = await import('./logger');

      logger.dispose();

      expect(mockOutputChannel.dispose).toHaveBeenCalled();
    });
  });

  describe('message formatting', () => {
    it('should format messages consistently across log levels', async () => {
      const { logger } = await import('./logger');

      logger.info('Test 1');
      logger.warn('Test 2');
      logger.error('Test 3');
      logger.debug('Test 4');

      expect(appendLineSpy).toHaveBeenCalledTimes(4);

      const calls = appendLineSpy.mock.calls;
      calls.forEach((call: any[]) => {
        const message = call[0];
        // Each message should have timestamp format
        expect(message).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]/);
        // Each message should have a log level
        expect(message).toMatch(/\[(INFO|WARN|ERROR|DEBUG)\]/);
      });
    });
  });

  describe('singleton pattern', () => {
    it('should return the same instance', async () => {
      const { logger } = await import('./logger');

      // The logger is already exported as a singleton
      // We can verify it logs to the same output channel
      logger.info('First call');
      logger.info('Second call');

      expect(appendLineSpy).toHaveBeenCalledTimes(2);
    });
  });
});
