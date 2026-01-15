import * as vscode from 'vscode';
import { TimeUtils } from './timeUtils';

/**
 * Logger singleton for consistent output across the extension
 */
class Logger {
    private static instance: Logger;
    private readonly outputChannel: vscode.OutputChannel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Simple SFTP');
    }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    private formatMessage(level: string, message: string): string {
        const timestamp = TimeUtils.getCurrentISOTime();
        return `[${timestamp}] [${level}] ${message}`;
    }

    info(message: string): void {
        this.outputChannel.appendLine(this.formatMessage('INFO', message));
    }

    warn(message: string): void {
        this.outputChannel.appendLine(this.formatMessage('WARN', message));
    }

    error(message: string, error?: Error): void {
        const errorMessage = error ? `${message}: ${error.message}` : message;
        this.outputChannel.appendLine(this.formatMessage('ERROR', errorMessage));
        if (error?.stack) {
            this.outputChannel.appendLine(error.stack);
        }
    }

    debug(message: string): void {
        this.outputChannel.appendLine(this.formatMessage('DEBUG', message));
    }

    show(): void {
        this.outputChannel.show();
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

export const logger = Logger.getInstance();
