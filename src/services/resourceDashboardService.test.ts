import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResourceDashboardService, SystemResourceInfo } from './resourceDashboardService';

describe('ResourceDashboardService', () => {
  describe('formatResourceInfo', () => {
    it('should format resource info correctly', () => {
      const mockInfo: SystemResourceInfo = {
        cpu: {
          usage: 45.2,
          cores: 8,
          loadAvg1: 1.5,
          loadAvg5: 2.0,
          loadAvg15: 1.8,
        },
        memory: {
          total: 16384,
          used: 8192,
          available: 8192,
          usage: 50.0,
        },
        disk: [
          {
            filesystem: '/dev/sda1',
            total: 500,
            used: 250,
            available: 250,
            usage: 50,
            mountpoint: '/',
          },
        ],
        system: {
          os: 'Ubuntu 22.04 LTS',
          kernel: '5.15.0-generic',
          uptime: '10 days, 5 hours',
          hostname: 'test-server',
        },
      };

      const formatted = ResourceDashboardService.formatResourceInfo(mockInfo);

      // 验证包含关键信息
      expect(formatted).toContain('test-server');
      expect(formatted).toContain('Ubuntu 22.04 LTS');
      expect(formatted).toContain('8');
      expect(formatted).toContain('45.2%');
      expect(formatted).toContain('16384 MB');
      expect(formatted).toContain('50.0%');
      expect(formatted).toContain('/dev/sda1');
      expect(formatted).toContain('500 GB');
    });

    it('should handle multiple disks', () => {
      const mockInfo: SystemResourceInfo = {
        cpu: {
          usage: 10.0,
          cores: 4,
          loadAvg1: 0.5,
          loadAvg5: 0.5,
          loadAvg15: 0.5,
        },
        memory: {
          total: 8192,
          used: 2048,
          available: 6144,
          usage: 25.0,
        },
        disk: [
          {
            filesystem: '/dev/sda1',
            total: 100,
            used: 50,
            available: 50,
            usage: 50,
            mountpoint: '/',
          },
          {
            filesystem: '/dev/sdb1',
            total: 200,
            used: 100,
            available: 100,
            usage: 50,
            mountpoint: '/data',
          },
        ],
        system: {
          os: 'CentOS 7',
          kernel: '3.10.0-generic',
          uptime: '1 day, 2 hours',
          hostname: 'data-server',
        },
      };

      const formatted = ResourceDashboardService.formatResourceInfo(mockInfo);

      // 验证包含所有磁盘信息
      expect(formatted).toContain('/dev/sda1');
      expect(formatted).toContain('/dev/sdb1');
      expect(formatted).toContain('/');
      expect(formatted).toContain('/data');
    });

    it('should format numbers with proper decimal places', () => {
      const mockInfo: SystemResourceInfo = {
        cpu: {
          usage: 12.345,
          cores: 16,
          loadAvg1: 1.234,
          loadAvg5: 2.345,
          loadAvg15: 3.456,
        },
        memory: {
          total: 32768,
          used: 16384,
          available: 16384,
          usage: 50.123,
        },
        disk: [
          {
            filesystem: '/dev/nvme0n1p1',
            total: 1000,
            used: 500,
            available: 500,
            usage: 50,
            mountpoint: '/',
          },
        ],
        system: {
          os: 'Debian 11',
          kernel: '5.10.0-generic',
          uptime: '30 days',
          hostname: 'prod-server',
        },
      };

      const formatted = ResourceDashboardService.formatResourceInfo(mockInfo);

      // CPU usage 应该显示一位小数
      expect(formatted).toContain('12.3%');
      // 内存使用率应该显示一位小数
      expect(formatted).toContain('50.1%');
    });
  });

  describe('edge cases', () => {
    it('should handle zero values gracefully', () => {
      const mockInfo: SystemResourceInfo = {
        cpu: {
          usage: 0,
          cores: 1,
          loadAvg1: 0,
          loadAvg5: 0,
          loadAvg15: 0,
        },
        memory: {
          total: 1024,
          used: 0,
          available: 1024,
          usage: 0,
        },
        disk: [
          {
            filesystem: '/dev/sda1',
            total: 100,
            used: 0,
            available: 100,
            usage: 0,
            mountpoint: '/',
          },
        ],
        system: {
          os: 'Alpine Linux',
          kernel: '5.15.0',
          uptime: '1 hour',
          hostname: 'minimal-server',
        },
      };

      const formatted = ResourceDashboardService.formatResourceInfo(mockInfo);

      expect(formatted).toContain('0.0%');
      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('should handle empty disk array', () => {
      const mockInfo: SystemResourceInfo = {
        cpu: {
          usage: 50,
          cores: 2,
          loadAvg1: 1.0,
          loadAvg5: 1.0,
          loadAvg15: 1.0,
        },
        memory: {
          total: 4096,
          used: 2048,
          available: 2048,
          usage: 50.0,
        },
        disk: [],
        system: {
          os: 'Unknown',
          kernel: 'Unknown',
          uptime: 'Unknown',
          hostname: 'unknown',
        },
      };

      const formatted = ResourceDashboardService.formatResourceInfo(mockInfo);

      expect(formatted).toBeDefined();
      expect(formatted).toContain('unknown');
    });
  });
});
