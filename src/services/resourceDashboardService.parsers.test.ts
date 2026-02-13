import { describe, it, expect, vi, afterEach } from 'vitest';
import { ResourceDashboardService } from './resourceDashboardService';

describe('ResourceDashboardService - parsers and private helpers', () => {
  const service = ResourceDashboardService as any;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseIostatOutput', () => {
    it('parses only the second sample section', () => {
      const output = [
        'Linux 6.5.0 host 01/01/2026 _x86_64_',
        '',
        'Device            r/s     w/s   rkB/s   wkB/s rrqm/s wrqm/s r_await w_await aqu-sz rareq-sz wareq-sz svctm  %util',
        'sda              1.00    2.00   10.00   20.00   0.00   0.00    1.00    2.00   0.10    10.00    10.00  0.10   5.00',
        '',
        'Device            r/s     w/s   rkB/s   wkB/s rrqm/s wrqm/s r_await w_await aqu-sz rareq-sz wareq-sz svctm  %util',
        'sda             10.00   20.00  100.00  200.00   0.00   0.00    1.00    2.00   0.10    10.00    10.00  0.10  25.50',
        'nvme0n1          3.00    4.00   30.00   40.00   0.00   0.00    1.00    2.00   0.10    10.00    10.00  0.10   7.70',
      ].join('\n');

      const result = service.parseIostatOutput(output);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        device: 'sda',
        reads: 10,
        writes: 20,
        readKBps: 100,
        writeKBps: 200,
        utilization: 25.5,
      });
    });

    it('returns empty array when second sample does not exist', () => {
      const output = [
        'Device r/s w/s rkB/s wkB/s %util',
        'sda 1 2 3 4 5',
      ].join('\n');

      const result = service.parseIostatOutput(output);
      expect(result).toEqual([]);
    });

    it('skips malformed lines in second sample', () => {
      const output = [
        'Device r/s w/s rkB/s wkB/s %util',
        'sda 1 2 3 4 5',
        'Device r/s w/s rkB/s wkB/s rrqm/s wrqm/s r_await w_await aqu-sz rareq-sz wareq-sz svctm %util',
        'bad line',
        'sda 5 6 7 8 0 0 1 1 0.1 1 1 0.1 11',
      ].join('\n');

      const result = service.parseIostatOutput(output);
      expect(result).toHaveLength(1);
      expect(result[0].device).toBe('sda');
    });

    it('handles NaN numbers as 0', () => {
      const output = [
        'Device r/s w/s rkB/s wkB/s %util',
        'sda 1 2 3 4 5',
        'Device r/s w/s rkB/s wkB/s rrqm/s wrqm/s r_await w_await aqu-sz rareq-sz wareq-sz svctm %util',
        'sda NaN xx yy zz 0 0 1 1 0.1 1 1 0.1 ??',
      ].join('\n');

      const result = service.parseIostatOutput(output);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        reads: 0,
        writes: 0,
        readKBps: 0,
        writeKBps: 0,
        utilization: 0,
      });
    });
  });

  describe('parseDiskstatsOutput - device filtering matrix', () => {
    const acceptedCases = [
      'sda', 'sdb', 'sdc', 'sdd', 'sde', 'sdf', 'sdg', 'sdh',
      'vda', 'vdb', 'vdc', 'vdd',
      'hda', 'hdb',
      'nvme0n1', 'nvme1n1', 'nvme2n3',
    ];

    const rejectedCases = [
      'loop0', 'ram0', 'sr0', 'md0',
      'sda1', 'sdb2', 'vda1', 'hda2',
      'nvme0n1p1', 'nvme1n1p2',
      'dm-0', 'zram0', 'mmcblk0', 'mmcblk0p1',
      'xvda', 'fd0', 'nbd0', 'sd', 'nvme0', 'nvme0n',
      'sdaa', 'sda10', 'abc', 'eth0',
    ];

    const makeLine = (device: string) => `8 0 ${device} 10 0 20 0 30 0 40 0 0 0 0 0`;

    it.each(acceptedCases)('accepts supported device: %s', (device) => {
      const result = service.parseDiskstatsOutput(makeLine(device));
      expect(result).toHaveLength(1);
      expect(result[0].device).toBe(device);
      expect(result[0].reads).toBe(10);
      expect(result[0].writes).toBe(30);
      expect(result[0].readKBps).toBe(10); // 20 sectors * 512 / 1024
      expect(result[0].writeKBps).toBe(20); // 40 sectors * 512 / 1024
      expect(result[0].utilization).toBe(0);
    });

    it.each(rejectedCases)('rejects unsupported device: %s', (device) => {
      const result = service.parseDiskstatsOutput(makeLine(device));
      expect(result).toEqual([]);
    });

    it('skips lines with insufficient columns', () => {
      const output = [
        '8 0 sda 1 2 3',
        '8 0 sdb 1 2',
      ].join('\n');
      expect(service.parseDiskstatsOutput(output)).toEqual([]);
    });

    it('handles multiple lines and keeps only valid ones', () => {
      const output = [
        makeLine('sda'),
        makeLine('loop0'),
        makeLine('nvme0n1'),
        makeLine('sda1'),
      ].join('\n');

      const result = service.parseDiskstatsOutput(output);
      expect(result.map((d: any) => d.device)).toEqual(['sda', 'nvme0n1']);
    });
  });

  describe('private data helpers via executeCommand mocking', () => {
    it('getCpuInfo rounds and caps usage at 100', async () => {
      const spy = vi.spyOn(service, 'executeCommand')
        .mockResolvedValueOnce('2') // nproc
        .mockResolvedValueOnce('3.999 2.0 1.0 1/100 1000'); // loadavg

      const info = await service.getCpuInfo({} as any);
      expect(info).toEqual({
        usage: 100,
        cores: 2,
        loadAvg1: 4,
        loadAvg5: 2,
        loadAvg15: 1,
      });
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('getMemoryInfo prefers available column', async () => {
      vi.spyOn(service, 'executeCommand').mockResolvedValue([
        '              total        used        free      shared  buff/cache   available',
        'Mem:           8000        2000        1000         100        5000        6000',
      ].join('\n'));

      const info = await service.getMemoryInfo({} as any);
      expect(info).toMatchObject({
        total: 8000,
        used: 2000,
        available: 6000,
        usage: 25,
      });
    });

    it('getMemoryInfo falls back to free when available missing', async () => {
      vi.spyOn(service, 'executeCommand').mockResolvedValue([
        '              total        used        free',
        'Mem:           4000        1000        500',
      ].join('\n'));

      const info = await service.getMemoryInfo({} as any);
      expect(info.available).toBe(500);
      expect(info.usage).toBe(25);
    });

    it('getDiskInfo parses df lines and ignores invalid line', async () => {
      vi.spyOn(service, 'executeCommand').mockResolvedValue([
        '/dev/sda1 100G 50G 50G 50% /',
        'invalid line',
        '/dev/nvme0n1p1 200G 40G 160G 20% /data',
      ].join('\n'));

      const info = await service.getDiskInfo({} as any);
      expect(info).toHaveLength(2);
      expect(info[1]).toMatchObject({ filesystem: '/dev/nvme0n1p1', usage: 20, mountpoint: '/data' });
    });

    it('getSystemInfo falls back to Unknown on command errors', async () => {
      const spy = vi.spyOn(service, 'executeCommand')
        .mockRejectedValueOnce(new Error('os failed'))
        .mockRejectedValueOnce(new Error('kernel failed'))
        .mockRejectedValueOnce(new Error('uptime failed'))
        .mockRejectedValueOnce(new Error('hostname failed'));

      const info = await service.getSystemInfo({} as any);
      expect(info).toEqual({
        os: 'Unknown',
        kernel: 'Unknown',
        uptime: 'Unknown',
        hostname: 'Unknown',
      });
      expect(spy).toHaveBeenCalledTimes(4);
    });
  });
});
