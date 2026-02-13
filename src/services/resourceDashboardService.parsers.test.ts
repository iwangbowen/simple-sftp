import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
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

    const matrixCases = Array.from({ length: 120 }, (_, i) => {
      const reads = (i % 17) + 1;
      const writes = (i % 13) + 2;
      const readKBps = (i + 1) * 3.5;
      const writeKBps = (i + 1) * 2.25;
      const util = ((i % 100) + 0.5).toFixed(2);
      return {
        device: `sd${String.fromCodePoint(97 + (i % 8))}`,
        reads,
        writes,
        readKBps,
        writeKBps,
        util,
      };
    });

    it.each(matrixCases)('matrix parse #%# device=%s', ({ device, reads, writes, readKBps, writeKBps, util }) => {
      const output = [
        'Device r/s w/s rkB/s wkB/s %util',
        'sda 1 2 3 4 5',
        'Device r/s w/s rkB/s wkB/s rrqm/s wrqm/s r_await w_await aqu-sz rareq-sz wareq-sz svctm %util',
        `${device} ${reads} ${writes} ${readKBps} ${writeKBps} 0 0 1 1 0.1 1 1 0.1 ${util}`,
      ].join('\n');

      const result = service.parseIostatOutput(output);
      expect(result).toHaveLength(1);
      expect(result[0].device).toBe(device);
      expect(result[0].reads).toBe(reads);
      expect(result[0].writes).toBe(writes);
      expect(result[0].readKBps).toBe(readKBps);
      expect(result[0].writeKBps).toBe(writeKBps);
      expect(result[0].utilization).toBe(Number.parseFloat(util));
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

  describe('public parsing methods without real connection', () => {
    it('getProcessList parses ps output and skips malformed rows', async () => {
      vi.spyOn(service, 'executeWithConnection').mockImplementation(async (_cfg: any, _auth: any, op: any) => op({}));
      vi.spyOn(service, 'executeCommand').mockResolvedValue([
        'USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND',
        'root 101 9.5 1.2 1000 200 ? Ssl 10:00 00:01 /usr/bin/node server.js',
        'bad line',
        'app 202 0.4 0.3 2048 256 ? S 10:01 00:00 /usr/bin/python worker.py',
      ].join('\n'));

      const result = await ResourceDashboardService.getProcessList({} as any, {} as any, 5);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ user: 'root', pid: 101, cpu: 9.5, mem: 1.2 });
      expect(result[1].command).toContain('worker.py');
    });

    it('getNetworkStats parses /proc/net/dev and ip output', async () => {
      vi.spyOn(service, 'executeWithConnection').mockImplementation(async (_cfg: any, _auth: any, op: any) => op({}));
      const cmdSpy = vi.spyOn(service, 'executeCommand')
        .mockResolvedValueOnce([
          'Inter-|   Receive                                                |  Transmit',
          ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
          '  lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0',
          'eth0: 2000 20 0 0 0 0 0 0 3000 30 0 0 0 0 0 0',
        ].join('\n'))
        .mockResolvedValueOnce('lo UNKNOWN 127.0.0.1/8\neth0 UP 192.168.1.2/24');

      const result = await ResourceDashboardService.getNetworkStats({} as any, {} as any);
      expect(result).toHaveLength(2);
      expect(result.find((i: any) => i.name === 'eth0')).toMatchObject({
        rxBytes: 2000,
        txBytes: 3000,
        ipAddress: '192.168.1.2',
        state: 'UP',
      });
      expect(cmdSpy).toHaveBeenCalledTimes(2);
    });

    it('getNetworkStats handles missing ip command gracefully', async () => {
      vi.spyOn(service, 'executeWithConnection').mockImplementation(async (_cfg: any, _auth: any, op: any) => op({}));
      vi.spyOn(service, 'executeCommand')
        .mockResolvedValueOnce([
          'Inter-|   Receive | Transmit',
          ' face |bytes packets|bytes packets',
          'eth0: 100 1 0 0 0 0 0 0 200 2 0 0 0 0 0 0',
        ].join('\n'))
        .mockRejectedValueOnce(new Error('ip not found'));

      const result = await ResourceDashboardService.getNetworkStats({} as any, {} as any);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'eth0', state: 'DOWN' });
    });

    it('getDiskIOStats uses iostat when available', async () => {
      vi.spyOn(service, 'executeWithConnection').mockImplementation(async (_cfg: any, _auth: any, op: any) => op({}));
      vi.spyOn(service, 'executeCommand').mockResolvedValue([
        'Device r/s w/s rkB/s wkB/s %util',
        'sda 1 1 1 1 1',
        'Device r/s w/s rkB/s wkB/s rrqm/s wrqm/s r_await w_await aqu-sz rareq-sz wareq-sz svctm %util',
        'sda 2 3 4 5 0 0 1 1 0.1 1 1 0.1 9.9',
      ].join('\n'));

      const result = await ResourceDashboardService.getDiskIOStats({} as any, {} as any);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ device: 'sda', reads: 2, writes: 3, utilization: 9.9 });
    });

    it('getDiskIOStats falls back to diskstats when iostat fails', async () => {
      vi.spyOn(service, 'executeWithConnection').mockImplementation(async (_cfg: any, _auth: any, op: any) => op({}));
      vi.spyOn(service, 'executeCommand')
        .mockRejectedValueOnce(new Error('iostat unavailable'))
        .mockResolvedValueOnce('8 0 sda 10 0 20 0 30 0 40 0 0 0 0 0');

      const result = await ResourceDashboardService.getDiskIOStats({} as any, {} as any);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ device: 'sda', readKBps: 10, writeKBps: 20 });
    });
  });

  describe('executeCommand stream handling', () => {
    class MockStream extends EventEmitter {
      stderr = new EventEmitter();
    }

    it('resolves stdout when command exits with code 0', async () => {
      const conn = {
        exec: (_cmd: string, cb: (err: Error | null, stream: any) => void) => {
          const stream = new MockStream();
          cb(null, stream as any);
          stream.emit('data', Buffer.from('hello '));
          stream.emit('data', Buffer.from('world'));
          stream.emit('close', 0);
        },
      };

      const result = await service.executeCommand(conn as any, 'echo test');
      expect(result).toBe('hello world');
    });

    it('rejects when command exits with non-zero code', async () => {
      const conn = {
        exec: (_cmd: string, cb: (err: Error | null, stream: any) => void) => {
          const stream = new MockStream();
          cb(null, stream as any);
          stream.stderr.emit('data', Buffer.from('permission denied'));
          stream.emit('close', 1);
        },
      };

      await expect(service.executeCommand(conn as any, 'cat /root/secret')).rejects.toThrow('Command failed with code 1');
    });

    it('rejects when exec itself returns error', async () => {
      const conn = {
        exec: (_cmd: string, cb: (err: Error | null, stream: any) => void) => {
          cb(new Error('exec failed'), undefined as any);
        },
      };

      await expect(service.executeCommand(conn as any, 'bad')).rejects.toThrow('exec failed');
    });
  });
});
