import * as vscode from 'vscode';

/**
 * Formatting utilities for file sizes, transfer speeds, and time
 */

/**
 * Format file size in human-readable format (auto-select unit)
 * @param bytes - Number of bytes
 * @returns Formatted string like "1.50 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) {return '0 B';}

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const unitIndex = Math.min(i, units.length - 1);

  return `${(bytes / Math.pow(k, unitIndex)).toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Format transfer speed based on configuration
 * Reads 'simpleScp.speedUnit' setting to determine unit (auto/KB/MB)
 * @param bytesPerSecond - Transfer speed in bytes per second
 * @returns Formatted string like "5.20 MB/s" or "120.50 KB/s"
 */
export function formatSpeed(bytesPerSecond: number): string {
  const config = vscode.workspace.getConfiguration('simpleScp');
  const speedUnit = config.get<string>('speedUnit', 'auto');

  if (speedUnit === 'KB') {
    return `${(bytesPerSecond / 1024).toFixed(2)} KB/s`;
  } else if (speedUnit === 'MB') {
    return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
  } else {
    // auto mode
    if (bytesPerSecond >= 1024 * 1024) {
      return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
    } else {
      return `${(bytesPerSecond / 1024).toFixed(2)} KB/s`;
    }
  }
}

/**
 * Format remaining time in human-readable format
 * @param seconds - Number of seconds
 * @returns Formatted string like "5m 30s", "2h 15m", or "45s"
 */
export function formatRemainingTime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${minutes}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}
