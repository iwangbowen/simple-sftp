import { Client } from 'ssh2';
import { HostConfig, HostAuthConfig } from '../types';
import { logger } from '../logger';
import { establishMultiHopConnection, addAuthToConnectConfig } from '../utils/jumpHostHelper';

/**
 * 进程信息接口
 */
export interface ProcessInfo {
  /** 进程ID */
  pid: number;
  /** 用户 */
  user: string;
  /** CPU使用率百分比 */
  cpu: number;
  /** 内存使用率百分比 */
  mem: number;
  /** 虚拟内存大小 (KB) */
  vsz: number;
  /** 物理内存大小 (KB) */
  rss: number;
  /** 进程状态 */
  stat: string;
  /** 运行时间 */
  time: string;
  /** 命令 */
  command: string;
}

/**
 * 网络接口信息
 */
export interface NetworkInterfaceInfo {
  /** 接口名称 */
  name: string;
  /** 接收字节数 */
  rxBytes: number;
  /** 发送字节数 */
  txBytes: number;
  /** 接收包数 */
  rxPackets: number;
  /** 发送包数 */
  txPackets: number;
  /** 接收错误数 */
  rxErrors?: number;
  /** 发送错误数 */
  txErrors?: number;
  /** 接收丢包数 */
  rxDropped?: number;
  /** 发送丢包数 */
  txDropped?: number;
  /** 接收速率 (Bytes/s) - 需要两次采样计算 */
  rxRate?: number;
  /** 发送速率 (Bytes/s) - 需要两次采样计算 */
  txRate?: number;
  /** IP地址 */
  ipAddress?: string;
  /** 状态 */
  state: string;
}

/**
 * 仪表盘健康告警
 */
export interface DashboardHealthAlert {
  /** 资源类型 */
  resource: 'cpu' | 'memory' | 'disk';
  /** 严重级别 */
  severity: 'warning' | 'critical';
  /** 展示标签 */
  label: string;
  /** 当前值 */
  value: number;
  /** 告警消息 */
  message: string;
}

/**
 * 仪表盘健康摘要
 */
export interface DashboardHealthSummary {
  /** 总体健康状态 */
  status: 'healthy' | 'warning' | 'critical';
  /** 摘要信息 */
  summary: string;
  /** 当前告警列表 */
  alerts: DashboardHealthAlert[];
  /** 生成时间 */
  updatedAt: string;
}

/**
 * 磁盘 I/O 信息
 */
export interface DiskIOInfo {
  /** 设备名称 */
  device: string;
  /** 读取速率 (KB/s) */
  readKBps: number;
  /** 写入速率 (KB/s) */
  writeKBps: number;
  /** 读取次数 */
  reads: number;
  /** 写入次数 */
  writes: number;
  /** I/O使用率百分比 */
  utilization: number;
}

/**
 * 系统资源信息接口
 */
export interface SystemResourceInfo {
  /** CPU 使用率 */
  cpu: {
    /** 整体使用率百分比 */
    usage: number;
    /** 核心数 */
    cores: number;
    /** 1分钟平均负载 */
    loadAvg1: number;
    /** 5分钟平均负载 */
    loadAvg5: number;
    /** 15分钟平均负载 */
    loadAvg15: number;
  };
  /** 内存使用情况 */
  memory: {
    /** 总内存 (MB) */
    total: number;
    /** 已使用内存 (MB) */
    used: number;
    /** 可用内存 (MB) */
    available: number;
    /** 使用率百分比 */
    usage: number;
    /** 缓冲区大小 (MB) */
    buffers?: number;
    /** 缓存大小 (MB) */
    cached?: number;
    /** Swap 总量 (MB) */
    swapTotal?: number;
    /** Swap 已使用 (MB) */
    swapUsed?: number;
    /** Swap 可用 (MB) */
    swapFree?: number;
    /** Swap 使用率百分比 */
    swapUsage?: number;
  };
  /** 磁盘使用情况 */
  disk: {
    /** 文件系统 */
    filesystem: string;
    /** 总容量 (GB) */
    total: number;
    /** 已使用 (GB) */
    used: number;
    /** 可用 (GB) */
    available: number;
    /** 使用率百分比 */
    usage: number;
    /** 挂载点 */
    mountpoint: string;
  }[];
  /** 系统信息 */
  system: {
    /** 操作系统 */
    os: string;
    /** 内核版本 */
    kernel: string;
    /** 系统运行时间 */
    uptime: string;
    /** 主机名 */
    hostname: string;
  };
  /** 健康状态摘要 */
  health?: DashboardHealthSummary;
}

/**
 * 资源仪表盘服务
 */
export class ResourceDashboardService {
  private static readonly NETWORK_RATE_SAMPLE_INTERVAL_MS = 1000;

  /**
   * 获取远程服务器的系统资源信息
   */
  static async getSystemResources(
    config: HostConfig,
    authConfig: HostAuthConfig
  ): Promise<SystemResourceInfo> {
    let jumpConns: Client[] | null = null;
    const conn = new Client();

    try {
      const connectConfig: any = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 30000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      };

      // Add authentication
      addAuthToConnectConfig(connectConfig, authConfig);

      // Handle jump hosts if configured
      if (config.jumpHosts && config.jumpHosts.length > 0) {
        logger.info(`Connecting through ${config.jumpHosts.length} jump host(s)`);
        const jumpResult = await establishMultiHopConnection(
          config.jumpHosts,
          config.host,
          config.port
        );
        jumpConns = jumpResult.jumpConns;
        connectConfig.sock = jumpResult.stream;
      }

      // Connect to the target host
      await new Promise<void>((resolve, reject) => {
        conn
          .on('ready', () => resolve())
          .on('error', (err) => reject(err))
          .connect(connectConfig);
      });

      // 并行获取各种资源信息
      const [cpuInfo, memoryInfo, diskInfo, systemInfo] = await Promise.all([
        this.getCpuInfo(conn),
        this.getMemoryInfo(conn),
        this.getDiskInfo(conn),
        this.getSystemInfo(conn),
      ]);

      const health = this.buildHealthSummary({
        cpu: cpuInfo,
        memory: memoryInfo,
        disk: diskInfo,
      });

      return {
        cpu: cpuInfo,
        memory: memoryInfo,
        disk: diskInfo,
        system: systemInfo,
        health,
      };
    } finally {
      conn.end();
      if (jumpConns) {
        jumpConns.forEach((jc) => jc.end());
      }
    }
  }

  /**
   * 获取进程列表(类似 top 命令)
   */
  static async getProcessList(
    config: HostConfig,
    authConfig: HostAuthConfig,
    limit: number = 20
  ): Promise<ProcessInfo[]> {
    return this.executeWithConnection(config, authConfig, async (conn) => {
      // 使用 ps 命令获取进程信息,按 CPU 使用率排序
      // ps aux --sort=-%cpu | head -n 21 (包括标题行)
      const command = `ps aux --sort=-%cpu | head -n ${limit + 1}`;
      const output = await this.executeCommand(conn, command);
      const lines = output.trim().split('\n');

      const processes: ProcessInfo[] = [];

      // 跳过标题行
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {continue;}

        // 解析 ps aux 输出
        // USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
        const parts = line.split(/\s+/);
        if (parts.length < 11) {continue;}

        processes.push({
          user: parts[0],
          pid: Number.parseInt(parts[1]) || 0,
          cpu: Number.parseFloat(parts[2]) || 0,
          mem: Number.parseFloat(parts[3]) || 0,
          vsz: Number.parseInt(parts[4]) || 0,
          rss: Number.parseInt(parts[5]) || 0,
          stat: parts[7],
          time: parts[9],
          command: parts.slice(10).join(' '),
        });
      }

      return processes;
    });
  }

  /**
   * 获取网络接口信息
   */
  static async getNetworkStats(
    config: HostConfig,
    authConfig: HostAuthConfig
  ): Promise<NetworkInterfaceInfo[]> {
    return this.executeWithConnection(config, authConfig, async (conn) => {
      // 获取网络统计信息并进行两次采样以计算吞吐速率
      const firstNetDevOutput = await this.executeCommand(conn, 'cat /proc/net/dev');
      const ipAddrOutput = await this.executeCommand(conn, 'ip -br addr').catch(() => '');
      const initialStats = this.parseNetworkStatsOutput(firstNetDevOutput, ipAddrOutput);

      const sampleStartedAt = Date.now();
      await this.delay(this.NETWORK_RATE_SAMPLE_INTERVAL_MS);

      const secondNetDevOutput = await this.executeCommand(conn, 'cat /proc/net/dev').catch(() => firstNetDevOutput);
      const latestStats = this.parseNetworkStatsOutput(secondNetDevOutput, ipAddrOutput);
      const elapsedSeconds = Math.max((Date.now() - sampleStartedAt) / 1000, 1);

      return this.mergeNetworkSamples(initialStats, latestStats, elapsedSeconds);
    });
  }

  /**
   * 合并两次网络采样结果，计算吞吐速率
   */
  private static mergeNetworkSamples(
    firstSample: NetworkInterfaceInfo[],
    secondSample: NetworkInterfaceInfo[],
    elapsedSeconds: number
  ): NetworkInterfaceInfo[] {
    const firstSampleMap = new Map(firstSample.map((item) => [item.name, item]));

    return secondSample.map((currentInterface) => {
      const previousInterface = firstSampleMap.get(currentInterface.name);

      if (!previousInterface || elapsedSeconds <= 0) {
        return currentInterface;
      }

      const rxDelta = Math.max(currentInterface.rxBytes - previousInterface.rxBytes, 0);
      const txDelta = Math.max(currentInterface.txBytes - previousInterface.txBytes, 0);

      return {
        ...currentInterface,
        rxRate: Math.round((rxDelta / elapsedSeconds) * 100) / 100,
        txRate: Math.round((txDelta / elapsedSeconds) * 100) / 100,
      };
    });
  }

  /**
   * 解析网络统计输出
   */
  private static parseNetworkStatsOutput(
    netDevOutput: string,
    ipAddrOutput: string
  ): NetworkInterfaceInfo[] {
    const interfaces: NetworkInterfaceInfo[] = [];
    const lines = netDevOutput.trim().split('\n');

    // 解析 IP 地址及状态信息
    const ipMap = new Map<string, { ipAddress?: string; state: string }>();
    if (ipAddrOutput) {
      const ipLines = ipAddrOutput.trim().split('\n');
      for (const line of ipLines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const name = parts[0];
          const state = parts[1] || 'UNKNOWN';
          const ip = parts.slice(2).find((part) => part.includes('/'))?.split('/')[0];

          ipMap.set(name, {
            ipAddress: ip && ip !== '-' ? ip : undefined,
            state,
          });
        }
      }
    }

    // 跳过前两行标题
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {continue;}

      // 解析 /proc/net/dev 输出
      // eth0: bytes packets errs drop fifo frame compressed multicast bytes packets errs drop fifo colls carrier compressed
      const [namePart, ...dataParts] = line.split(/:\s+/);
      if (!namePart || dataParts.length === 0) {continue;}

      const name = namePart.trim();
      const stats = dataParts[0].split(/\s+/);

      if (stats.length < 16) {continue;}

      const interfaceMeta = ipMap.get(name);

      interfaces.push({
        name,
        rxBytes: Number.parseInt(stats[0]) || 0,
        rxPackets: Number.parseInt(stats[1]) || 0,
        rxErrors: Number.parseInt(stats[2]) || 0,
        rxDropped: Number.parseInt(stats[3]) || 0,
        txBytes: Number.parseInt(stats[8]) || 0,
        txPackets: Number.parseInt(stats[9]) || 0,
        txErrors: Number.parseInt(stats[10]) || 0,
        txDropped: Number.parseInt(stats[11]) || 0,
        ipAddress: interfaceMeta?.ipAddress,
        state: interfaceMeta?.state || 'UNKNOWN',
      });
    }

    return interfaces;
  }

  /**
   * 获取磁盘 I/O 统计信息
   */
  static async getDiskIOStats(
    config: HostConfig,
    authConfig: HostAuthConfig
  ): Promise<DiskIOInfo[]> {
    return this.executeWithConnection(config, authConfig, async (conn) => {
      // 使用 iostat 命令(如果可用),否则使用 /proc/diskstats
      // 先尝试 iostat
      try {
        const output = await this.executeCommand(conn, 'iostat -dx 1 2');
        return this.parseIostatOutput(output);
      } catch {
        // 如果 iostat 不可用,使用 /proc/diskstats
        const output = await this.executeCommand(conn, 'cat /proc/diskstats');
        return this.parseDiskstatsOutput(output);
      }
    });
  }

  /**
   * 辅助方法:使用连接执行操作
   */
  private static async executeWithConnection<T>(
    config: HostConfig,
    authConfig: HostAuthConfig,
    operation: (conn: Client) => Promise<T>
  ): Promise<T> {
    let jumpConns: Client[] | null = null;
    const conn = new Client();

    try {
      const connectConfig: any = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 30000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      };

      // Add authentication
      addAuthToConnectConfig(connectConfig, authConfig);

      // Handle jump hosts if configured
      if (config.jumpHosts && config.jumpHosts.length > 0) {
        const jumpResult = await establishMultiHopConnection(
          config.jumpHosts,
          config.host,
          config.port
        );
        jumpConns = jumpResult.jumpConns;
        connectConfig.sock = jumpResult.stream;
      }

      // Connect to the target host
      await new Promise<void>((resolve, reject) => {
        conn
          .on('ready', () => resolve())
          .on('error', (err) => reject(err))
          .connect(connectConfig);
      });

      // 执行操作
      return await operation(conn);
    } finally {
      conn.end();
      if (jumpConns) {
        jumpConns.forEach((jc) => jc.end());
      }
    }
  }

  /**
   * 解析 iostat 输出
   */
  private static parseIostatOutput(output: string): DiskIOInfo[] {
    const disks: DiskIOInfo[] = [];
    const lines = output.trim().split('\n');

    // iostat 输出有两个采样,我们取第二个(更准确)
    let inSecondSample = false;
    let foundHeader = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // 检测是否进入第二次采样
      if (trimmed.startsWith('Device')) {
        if (foundHeader) {
          inSecondSample = true;
        }
        foundHeader = true;
        continue;
      }

      // 只处理第二次采样的数据
      if (!inSecondSample || !trimmed) {continue;}

      const parts = trimmed.split(/\s+/);
      if (parts.length < 6) {continue;}

      // Device r/s w/s rkB/s wkB/s ... %util
      disks.push({
        device: parts[0],
        reads: Number.parseFloat(parts[1]) || 0,
        writes: Number.parseFloat(parts[2]) || 0,
        readKBps: Number.parseFloat(parts[3]) || 0,
        writeKBps: Number.parseFloat(parts[4]) || 0,
        utilization: Number.parseFloat(parts[parts.length - 1]) || 0,
      });
    }

    return disks;
  }

  /**
   * 解析 /proc/diskstats 输出
   */
  private static parseDiskstatsOutput(output: string): DiskIOInfo[] {
    const disks: DiskIOInfo[] = [];
    const lines = output.trim().split('\n');

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 14) {continue;}

      const device = parts[2];

      // 只显示主要设备 (sda, nvme0n1 等)
      if (!/^(sd[a-z]|xvd[a-z]|nvme\d+n\d+|vd[a-z]|hd[a-z]|dm-\d+|mmcblk\d+)$/.test(device)) {
        continue;
      }

      // /proc/diskstats 格式:
      // major minor name reads ... sectors_read ... writes ... sectors_written
      const reads = Number.parseInt(parts[3]) || 0;
      const sectorsRead = Number.parseInt(parts[5]) || 0;
      const writes = Number.parseInt(parts[7]) || 0;
      const sectorsWritten = Number.parseInt(parts[9]) || 0;

      // 扇区大小通常是 512 字节
      const readKB = (sectorsRead * 512) / 1024;
      const writeKB = (sectorsWritten * 512) / 1024;

      disks.push({
        device,
        reads,
        writes,
        readKBps: readKB,
        writeKBps: writeKB,
        utilization: 0, // /proc/diskstats 不提供使用率
      });
    }

    return disks;
  }

  /**
   * 获取 CPU 信息
   */
  private static async getCpuInfo(conn: Client): Promise<SystemResourceInfo['cpu']> {
    // 获取 CPU 核心数
    const coresOutput = await this.executeCommand(conn, 'nproc');
    const cores = Number.parseInt(coresOutput.trim()) || 1;

    // 获取负载平均值
    const loadAvgOutput = await this.executeCommand(conn, 'cat /proc/loadavg');
    const loadAvgParts = loadAvgOutput.trim().split(/\s+/);
    const loadAvg1 = Number.parseFloat(loadAvgParts[0]) || 0;
    const loadAvg5 = Number.parseFloat(loadAvgParts[1]) || 0;
    const loadAvg15 = Number.parseFloat(loadAvgParts[2]) || 0;

    // 计算 CPU 使用率 (使用 1 分钟负载除以核心数的百分比)
    const usage = Math.min((loadAvg1 / cores) * 100, 100);

    return {
      usage: Math.round(usage * 10) / 10,
      cores,
      loadAvg1: Math.round(loadAvg1 * 100) / 100,
      loadAvg5: Math.round(loadAvg5 * 100) / 100,
      loadAvg15: Math.round(loadAvg15 * 100) / 100,
    };
  }

  /**
   * 获取内存信息
   */
  private static async getMemoryInfo(conn: Client): Promise<SystemResourceInfo['memory']> {
    const [output, meminfoOutput] = await Promise.all([
      this.executeCommand(conn, 'free -m'),
      this.executeCommand(conn, 'cat /proc/meminfo').catch(() => ''),
    ]);

    const lines = output.trim().split('\n');
    const memLine = lines.find((line) => line.trim().startsWith('Mem:'));
    const swapLine = lines.find((line) => line.trim().startsWith('Swap:'));

    if (!memLine) {
      return {
        total: 0,
        used: 0,
        available: 0,
        usage: 0,
        buffers: 0,
        cached: 0,
        swapTotal: 0,
        swapUsed: 0,
        swapFree: 0,
        swapUsage: 0,
      };
    }

    // 解析内存行 (第二行)
    // Mem:       15869       8234       1285        524       6349       6831
    const memParts = memLine.trim().split(/\s+/);
    const swapParts = swapLine?.trim().split(/\s+/) || [];
    const meminfo = this.parseMeminfoOutput(meminfoOutput);

    const total = Number.parseInt(memParts[1], 10) || 0;
    const used = Number.parseInt(memParts[2], 10) || 0;
    const parsedFree = Number.parseInt(memParts[3], 10);
    const parsedAvailable = Number.parseInt(memParts[6], 10);
    const hasAvailableColumn = memParts.length > 6 && !Number.isNaN(parsedAvailable);
    const available = hasAvailableColumn
      ? parsedAvailable
      : (Number.isNaN(parsedFree) ? 0 : parsedFree); // 优先使用 available,否则用 free
    const buffers = meminfo.buffers;
    const cached = meminfo.cached;
    const parsedSwapTotal = Number.parseInt(swapParts[1], 10);
    const parsedSwapUsed = Number.parseInt(swapParts[2], 10);
    const parsedSwapFree = Number.parseInt(swapParts[3], 10);
    const swapTotal = Number.isNaN(parsedSwapTotal) ? meminfo.swapTotal : parsedSwapTotal;
    const swapUsed = Number.isNaN(parsedSwapUsed)
      ? Math.max(swapTotal - meminfo.swapFree, 0)
      : parsedSwapUsed;
    const swapFree = Number.isNaN(parsedSwapFree)
      ? Math.max(swapTotal - swapUsed, meminfo.swapFree)
      : parsedSwapFree;

    const usageBase = hasAvailableColumn ? total - available : used;
    const usage = total > 0 ? (usageBase / total) * 100 : 0;
    const swapUsage = swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0;

    return {
      total,
      used,
      available,
      usage: Math.round(usage * 10) / 10,
      buffers,
      cached,
      swapTotal,
      swapUsed,
      swapFree,
      swapUsage: Math.round(swapUsage * 10) / 10,
    };
  }

  /**
   * 解析 /proc/meminfo 输出
   */
  private static parseMeminfoOutput(output: string): {
    buffers: number;
    cached: number;
    swapTotal: number;
    swapFree: number;
  } {
    const values = {
      buffers: 0,
      cached: 0,
      swapTotal: 0,
      swapFree: 0,
    };

    if (!output.trim()) {
      return values;
    }

    const lines = output.trim().split('\n');
    const meminfoMap = new Map<string, number>();

    for (const line of lines) {
      const match = line.match(/^(\w+):\s+(\d+)/);
      if (!match) {continue;}

      const [, key, rawValue] = match;
      meminfoMap.set(key, Math.round((Number.parseInt(rawValue, 10) || 0) / 1024));
    }

    return {
      buffers: meminfoMap.get('Buffers') || 0,
      cached: meminfoMap.get('Cached') || 0,
      swapTotal: meminfoMap.get('SwapTotal') || 0,
      swapFree: meminfoMap.get('SwapFree') || 0,
    };
  }

  /**
   * 获取磁盘信息
   */
  private static async getDiskInfo(conn: Client): Promise<SystemResourceInfo['disk']> {
    const output = await this.executeCommand(conn, 'df -BG | grep -E "^/dev/"');
    const lines = output.trim().split('\n');

    const disks: SystemResourceInfo['disk'] = [];

    for (const line of lines) {
      if (!line.trim()) {continue;}

      // 解析 df 输出
      // /dev/sda1       100G    50G    50G  50% /
      const parts = line.split(/\s+/);
      if (parts.length < 6) {continue;}

      const filesystem = parts[0];
      const total = Number.parseInt(parts[1].replace('G', '')) || 0;
      const used = Number.parseInt(parts[2].replace('G', '')) || 0;
      const available = Number.parseInt(parts[3].replace('G', '')) || 0;
      const usageStr = parts[4].replace('%', '');
      const usage = Number.parseInt(usageStr) || 0;
      const mountpoint = parts[5];

      disks.push({
        filesystem,
        total,
        used,
        available,
        usage,
        mountpoint,
      });
    }

    return disks;
  }

  /**
   * 获取系统信息
   */
  private static async getSystemInfo(conn: Client): Promise<SystemResourceInfo['system']> {
    // 并行获取各种系统信息
    const [osRelease, kernel, uptime, hostname] = await Promise.all([
      this.executeCommand(conn, 'cat /etc/os-release | grep "^PRETTY_NAME=" | cut -d= -f2 | tr -d \'"\'').catch(() => 'Unknown'),
      this.executeCommand(conn, 'uname -r').catch(() => 'Unknown'),
      this.executeCommand(conn, 'uptime -p').catch(() => 'Unknown'),
      this.executeCommand(conn, 'hostname').catch(() => 'Unknown'),
    ]);

    return {
      os: osRelease.trim() || 'Unknown',
      kernel: kernel.trim() || 'Unknown',
      uptime: uptime.trim().replace('up ', '') || 'Unknown',
      hostname: hostname.trim() || 'Unknown',
    };
  }

  /**
   * 获取远端 /var/log 下可读的日志文件列表
   */
  static async getAvailableLogs(
    config: HostConfig,
    authConfig: HostAuthConfig
  ): Promise<string[]> {
    return this.executeWithConnection(config, authConfig, async (conn) => {
      // List non-empty, readable plain text log files under /var/log (depth 2)
      const raw = await this.executeCommand(
        conn,
        'find /var/log -maxdepth 2 -type f -readable -size +0c 2>/dev/null | sort'
      ).catch(() => '');
      return raw
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.endsWith('.gz') && !l.endsWith('.xz') && !l.endsWith('.bz2'));
    });
  }

  /**
   * 读取远端日志文件的最后 N 行
   */
  static async readLogFile(
    config: HostConfig,
    authConfig: HostAuthConfig,
    filePath: string,
    lines: number = 200
  ): Promise<string> {
    // Validate filePath: must start with /var/log/ and contain no shell metacharacters
    if (!/^\/var\/log\/[a-zA-Z0-9_./@-]+$/.test(filePath)) {
      throw new Error(`Invalid log file path: ${filePath}`);
    }
    const safeLines = Math.max(1, Math.min(lines, 10000));
    return this.executeWithConnection(config, authConfig, async (conn) => {
      return this.executeCommand(conn, `tail -n ${safeLines} -- '${filePath}'`).catch(err => {
        throw new Error(`Cannot read ${filePath}: ${(err as Error).message}`);
      });
    });
  }

  /**
   * 向远程进程发送信号 (kill)
   */
  static async killProcess(
    config: HostConfig,
    authConfig: HostAuthConfig,
    pid: number,
    signal: 'SIGTERM' | 'SIGKILL' | 'SIGHUP' | 'SIGINT'
  ): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`Invalid PID: ${pid}`);
    }
    // Only allow valid signals
    const allowedSignals = ['SIGTERM', 'SIGKILL', 'SIGHUP', 'SIGINT'] as const;
    if (!allowedSignals.includes(signal)) {
      throw new Error(`Invalid signal: ${signal}`);
    }
    return this.executeWithConnection(config, authConfig, async (conn) => {
      // Use numeric signal to avoid shell injection via signal name
      const signalMap: Record<string, number> = {
        SIGHUP: 1, SIGINT: 2, SIGTERM: 15, SIGKILL: 9,
      };
      const sigNum = signalMap[signal];
      await this.executeCommand(conn, `kill -${sigNum} ${pid}`);
    });
  }

  /**
   * 执行远程命令
   */
  private static async executeCommand(conn: Client, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      conn.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream
          .on('close', (code: number) => {
            if (code !== 0) {
              reject(new Error(`Command failed with code ${code}: ${stderr}`));
            } else {
              resolve(stdout);
            }
          })
          .on('data', (data: Buffer) => {
            stdout += data.toString();
          })
          .stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });
      });
    });
  }

  /**
   * 异步等待指定毫秒数
   */
  private static async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 生成健康状态摘要
   */
  private static buildHealthSummary(resources: Pick<SystemResourceInfo, 'cpu' | 'memory' | 'disk'>): DashboardHealthSummary {
    const alerts: DashboardHealthAlert[] = [];

    if (resources.cpu.usage >= 90) {
      alerts.push({
        resource: 'cpu',
        severity: 'critical',
        label: 'CPU',
        value: resources.cpu.usage,
        message: `CPU load is above 90% of available cores (${resources.cpu.usage.toFixed(1)}%).`,
      });
    } else if (resources.cpu.usage >= 80) {
      alerts.push({
        resource: 'cpu',
        severity: 'warning',
        label: 'CPU',
        value: resources.cpu.usage,
        message: `CPU load is above 80% of available cores (${resources.cpu.usage.toFixed(1)}%).`,
      });
    }

    if (resources.memory.usage >= 90) {
      alerts.push({
        resource: 'memory',
        severity: 'critical',
        label: 'Memory',
        value: resources.memory.usage,
        message: `Memory usage is above 90% (${resources.memory.usage.toFixed(1)}%).`,
      });
    } else if (resources.memory.usage >= 80) {
      alerts.push({
        resource: 'memory',
        severity: 'warning',
        label: 'Memory',
        value: resources.memory.usage,
        message: `Memory usage is above 80% (${resources.memory.usage.toFixed(1)}%).`,
      });
    }

    for (const disk of resources.disk) {
      if (disk.usage >= 95) {
        alerts.push({
          resource: 'disk',
          severity: 'critical',
          label: 'Disk',
          value: disk.usage,
          message: `Disk usage on ${disk.mountpoint} is above 95% (${disk.usage}%).`,
        });
      } else if (disk.usage >= 85) {
        alerts.push({
          resource: 'disk',
          severity: 'warning',
          label: 'Disk',
          value: disk.usage,
          message: `Disk usage on ${disk.mountpoint} is above 85% (${disk.usage}%).`,
        });
      }
    }

    const hasCriticalAlert = alerts.some((alert) => alert.severity === 'critical');
    const hasWarningAlert = alerts.some((alert) => alert.severity === 'warning');
    const status: DashboardHealthSummary['status'] = hasCriticalAlert
      ? 'critical'
      : hasWarningAlert
        ? 'warning'
        : 'healthy';

    const summary = alerts.length === 0
      ? 'All monitored resources are within normal ranges.'
      : `${alerts.length} health ${alerts.length === 1 ? 'issue' : 'issues'} detected.`;

    return {
      status,
      summary,
      alerts,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 格式化资源信息为可读的字符串
   */
  static formatResourceInfo(info: SystemResourceInfo): string {
    const lines: string[] = [];

    // 系统信息
    lines.push('═══════════════════════════════════════');
    lines.push('           系统信息');
    lines.push('═══════════════════════════════════════');
    lines.push(`主机名:   ${info.system.hostname}`);
    lines.push(`操作系统: ${info.system.os}`);
    lines.push(`内核版本: ${info.system.kernel}`);
    lines.push(`运行时间: ${info.system.uptime}`);
    lines.push('');

    // CPU 信息
    lines.push('═══════════════════════════════════════');
    lines.push('           CPU 资源');
    lines.push('═══════════════════════════════════════');
    lines.push(`核心数:   ${info.cpu.cores}`);
    lines.push(`使用率:   ${info.cpu.usage.toFixed(1)}%`);
    lines.push(`负载均值: ${info.cpu.loadAvg1} (1分钟) / ${info.cpu.loadAvg5} (5分钟) / ${info.cpu.loadAvg15} (15分钟)`);
    lines.push('');

    // 内存信息
    lines.push('═══════════════════════════════════════');
    lines.push('           内存资源');
    lines.push('═══════════════════════════════════════');
    lines.push(`总内存:   ${info.memory.total} MB`);
    lines.push(`已使用:   ${info.memory.used} MB`);
    lines.push(`可用:     ${info.memory.available} MB`);
    lines.push(`使用率:   ${info.memory.usage.toFixed(1)}%`);
    if (info.memory.buffers !== undefined) {
      lines.push(`Buffers:  ${info.memory.buffers} MB`);
    }
    if (info.memory.cached !== undefined) {
      lines.push(`Cache:    ${info.memory.cached} MB`);
    }
    if (info.memory.swapTotal !== undefined) {
      lines.push(`Swap:     ${info.memory.swapUsed || 0} / ${info.memory.swapTotal} MB (${(info.memory.swapUsage || 0).toFixed(1)}%)`);
    }
    lines.push('');

    // 磁盘信息
    lines.push('═══════════════════════════════════════');
    lines.push('           磁盘资源');
    lines.push('═══════════════════════════════════════');
    for (const disk of info.disk) {
      lines.push(`${disk.mountpoint} (${disk.filesystem})`);
      lines.push(`  总容量: ${disk.total} GB`);
      lines.push(`  已使用: ${disk.used} GB (${disk.usage}%)`);
      lines.push(`  可用:   ${disk.available} GB`);
      if (disk !== info.disk[info.disk.length - 1]) {
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}
