import { Client } from 'ssh2';
import { HostConfig, HostAuthConfig } from '../types';
import { logger } from '../logger';
import { establishMultiHopConnection, addAuthToConnectConfig } from '../utils/jumpHostHelper';

// ─────────────────────────────────────────────────────────────────────────────
// Ports Tab
// ─────────────────────────────────────────────────────────────────────────────

/** 单个监听端口信息 */
export interface PortInfo {
  /** 协议 */
  proto: 'tcp' | 'tcp6' | 'udp' | 'udp6';
  /** 本地地址 */
  localAddress: string;
  /** 本地端口 */
  localPort: number;
  /** 进程 PID（可能为空） */
  pid?: number;
  /** 进程名称（可能为空） */
  processName?: string;
  /** 完整命令（可能为空） */
  command?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Users Tab
// ─────────────────────────────────────────────────────────────────────────────

/** 当前登录用户会话 */
export interface UserSession {
  /** 用户名 */
  user: string;
  /** 终端 */
  tty: string;
  /** 来源 IP 或主机名 */
  from: string;
  /** 登录时间 */
  loginTime: string;
  /** 空闲时间 */
  idle: string;
  /** CPU 用量（JCPU）*/
  what: string;
}

/** 登录历史记录 */
export interface LoginHistoryEntry {
  /** 用户名 */
  user: string;
  /** 终端 */
  tty: string;
  /** 来源 IP 或主机名 */
  from: string;
  /** 登录时间 */
  loginTime: string;
  /** 退出时间 / 状态 */
  logoutTime: string;
  /** 持续时间 */
  duration: string;
}

/** Users Tab 完整数据 */
export interface UsersInfo {
  sessions: UserSession[];
  history: LoginHistoryEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Services Tab
// ─────────────────────────────────────────────────────────────────────────────

/** 单个 systemd 服务信息 */
export interface ServiceInfo {
  /** 单元名称 */
  unit: string;
  /** 加载状态 */
  load: string;
  /** 激活状态 */
  active: string;
  /** 子状态 */
  sub: string;
  /** 描述 */
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Docker Tab
// ─────────────────────────────────────────────────────────────────────────────

/** 单个 Docker 容器信息 */
export interface ContainerInfo {
  /** 容器 ID（短） */
  id: string;
  /** 容器名称 */
  name: string;
  /** 镜像名称 */
  image: string;
  /** 运行状态 */
  status: string;
  /** 状态详情 */
  state: string;
  /** CPU 使用率 (%) */
  cpuPercent?: number;
  /** 内存使用量（字节） */
  memUsage?: number;
  /** 内存限制（字节） */
  memLimit?: number;
  /** 内存使用率 (%) */
  memPercent?: number;
  /** 网络 I/O 接收（字节） */
  netIn?: number;
  /** 网络 I/O 发送（字节） */
  netOut?: number;
  /** 创建时间 */
  createdAt?: string;
  /** 端口映射 */
  ports?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Crontab Tab
// ─────────────────────────────────────────────────────────────────────────────

/** 单条 cron 任务信息 */
export interface CrontabEntry {
  /** 数据来源：'user' | '/etc/crontab' | '/etc/cron.d/<filename>' */
  source: string;
  /** 分钟字段 */
  minute: string;
  /** 小时字段 */
  hour: string;
  /** 日字段 */
  dayOfMonth: string;
  /** 月字段 */
  month: string;
  /** 星期字段 */
  dayOfWeek: string;
  /** 执行用户（仅系统 crontab 有） */
  user?: string;
  /** 执行命令 */
  command: string;
  /** 是否为环境变量设置行（如 MAILTO=） */
  isEnvVar?: boolean;
}

/**
 * 进程信息接口
 */
export interface ProcessInfo {
  /** 进程ID */
  pid: number;
  /** 进程名称（可执行文件的 basename） */
  name: string;
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
  /** 控制终端 */
  tty: string;
  /** 进程启动时间 */
  start: string;
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

        const cmd = parts.slice(10).join(' ');
        const firstArg = cmd.split(' ')[0];
        const procName = firstArg.startsWith('[')
          ? firstArg
          : (firstArg.split('/').pop() || firstArg);
        processes.push({
          user: parts[0],
          pid: Number.parseInt(parts[1]) || 0,
          name: procName,
          cpu: Number.parseFloat(parts[2]) || 0,
          mem: Number.parseFloat(parts[3]) || 0,
          vsz: Number.parseInt(parts[4]) || 0,
          rss: Number.parseInt(parts[5]) || 0,
          tty: parts[6],
          stat: parts[7],
          start: parts[8],
          time: parts[9],
          command: cmd,
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
   * 执行远程命令，通过 stdin 输入内容（用于 crontab - 等需要 pipe 输入的场景）
   */
  private static executeCommandWithStdin(conn: Client, command: string, stdin: string): Promise<void> {
    return new Promise((resolve, reject) => {
      conn.exec(command, (err, stream) => {
        if (err) { reject(err); return; }
        let stderr = '';
        stream.on('close', (code: number) => {
          if (code !== 0) {
            reject(new Error(`Command failed (code ${code}): ${stderr.trim()}`));
          } else {
            resolve();
          }
        });
        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        stream.write(stdin, 'utf8');
        stream.end();
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

  // ───────────────────────────────────────────────────────────────────────────
  // Ports
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 获取远端监听端口列表（TCP/UDP）
   */
  static async getPortList(
    config: HostConfig,
    authConfig: HostAuthConfig
  ): Promise<PortInfo[]> {
    return this.executeWithConnection(config, authConfig, async (conn) => {
      // ss -tlnup 列出 TCP+UDP 监听端口，带进程信息
      // 部分系统需要 root 才能看到进程，非 root 时 process 列为空
      const raw = await this.executeCommand(
        conn,
        'ss -tlnup 2>/dev/null || netstat -tlnup 2>/dev/null || echo ""'
      ).catch(() => '');
      return this.parsePortListOutput(raw);
    });
  }

  private static parsePortListOutput(raw: string): PortInfo[] {
    const portMap = new Map<string, PortInfo>();

    for (const line of raw.split('\n')) {
      if (!line.trim() || line.startsWith('State') || line.startsWith('Active')
          || line.startsWith('Proto') || line.startsWith('Netid')) {
        continue;
      }

      // ss output: tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1234,fd=3))
      // Regex: match "LISTEN" state, capture localAddr:port and optional process info
      const ssRegex = /^(tcp6?|udp6?)\s+LISTEN\s+\S+\s+\S+\s+([\da-f:.*]+):(\d+)(?:.*?users:\(\("([^"]+)",pid=(\d+))?/i;
      const ssMatch = ssRegex.exec(line);
      if (ssMatch) {
        const [, protoRaw, addr, portStr, procName, pidStr] = ssMatch;
        const proto = protoRaw.toLowerCase() as PortInfo['proto'];
        const localPort = Number.parseInt(portStr, 10);
        const key = `${proto}:${addr}:${localPort}`;
        if (!portMap.has(key)) {
          portMap.set(key, {
            proto,
            localAddress: addr,
            localPort,
            pid: pidStr ? Number.parseInt(pidStr, 10) : undefined,
            processName: procName,
            command: procName,
          });
        }
        continue;
      }

      // netstat output: tcp 0 0 0.0.0.0:22 0.0.0.0:* LISTEN 1234/sshd
      const netstatRegex = /^(tcp6?|udp6?)\s+\S+\s+\S+\s+([\da-f:.*]+):(\d+)\s+\S+\s+LISTEN\s+(\d+)\/(\S*)/i;
      const netstatMatch = netstatRegex.exec(line);
      if (netstatMatch) {
        const [, protoRaw, addr, portStr, pidStr, procName] = netstatMatch;
        const proto = protoRaw.toLowerCase() as PortInfo['proto'];
        const localPort = Number.parseInt(portStr, 10);
        const key = `${proto}:${addr}:${localPort}`;
        if (!portMap.has(key)) {
          portMap.set(key, {
            proto,
            localAddress: addr,
            localPort,
            pid: Number.parseInt(pidStr, 10),
            processName: procName.replace(/^-$/, '') || undefined,
            command: procName.replace(/^-$/, '') || undefined,
          });
        }
      }
    }

    return Array.from(portMap.values()).sort((a, b) => a.localPort - b.localPort);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Users
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 获取当前登录用户会话和最近登录历史
   */
  static async getUsersInfo(
    config: HostConfig,
    authConfig: HostAuthConfig
  ): Promise<UsersInfo> {
    return this.executeWithConnection(config, authConfig, async (conn) => {
      const [whoRaw, lastRaw] = await Promise.all([
        this.executeCommand(conn, 'w -h 2>/dev/null || who 2>/dev/null || echo ""').catch(() => ''),
        this.executeCommand(conn, 'last -n 30 2>/dev/null || echo ""').catch(() => ''),
      ]);
      return {
        sessions: this.parseWOutput(whoRaw),
        history: this.parseLastOutput(lastRaw),
      };
    });
  }

  private static parseWOutput(raw: string): UserSession[] {
    const sessions: UserSession[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { continue; }
      // w -h: USER TTY FROM LOGIN@ IDLE JCPU PCPU WHAT
      // who:  USER LINE TIME [FROM]
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) { continue; }
      sessions.push({
        user: parts[0] || '',
        tty: parts[1] || '',
        from: parts[2] || '',
        loginTime: parts[3] || '',
        idle: parts[4] || '',
        what: parts.slice(7).join(' ') || '',
      });
    }
    return sessions;
  }

  private static parseLastOutput(raw: string): LoginHistoryEntry[] {
    const history: LoginHistoryEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('wtmp') || trimmed.startsWith('btmp')) { continue; }
      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) { continue; }
      const user = parts[0];
      const tty = parts[1];
      const from = parts[2] && parts[2].startsWith(':') ? '' : parts[2];
      // The rest is date/time and duration
      const rest = parts.slice(3).join(' ');
      // Typical: Mon Jan  1 00:00   still logged in
      //          Mon Jan  1 00:00 - 01:00  (01:00)
      const durationMatch = rest.match(/\(([^)]+)\)/);
      const duration = durationMatch ? durationMatch[1] : '';
      // Extract logout time or status
      const dashIdx = rest.indexOf(' - ');
      const logoutTime = dashIdx >= 0 ? rest.slice(dashIdx + 3).replace(durationMatch?.[0] || '', '').trim() : 'still logged in';
      const loginTime = dashIdx >= 0 ? rest.slice(0, dashIdx).trim() : rest.replace(durationMatch?.[0] || '', '').trim();
      history.push({ user, tty, from, loginTime, logoutTime, duration });
    }
    return history.slice(0, 30);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Services
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 获取 systemd 服务列表
   */
  static async getServiceList(
    config: HostConfig,
    authConfig: HostAuthConfig
  ): Promise<ServiceInfo[]> {
    return this.executeWithConnection(config, authConfig, async (conn) => {
      const raw = await this.executeCommand(
        conn,
        'systemctl list-units --type=service --no-pager --no-legend 2>/dev/null || echo ""'
      ).catch(() => '');
      return this.parseServiceListOutput(raw);
    });
  }

  private static parseServiceListOutput(raw: string): ServiceInfo[] {
    const services: ServiceInfo[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { continue; }
      // Format: UNIT  LOAD  ACTIVE  SUB  DESCRIPTION
      // Leading '●' (UTF-8 bullet) may indicate failed
      const cleaned = trimmed.replace(/^[●✓✗\s]+/, '');
      const parts = cleaned.split(/\s+/);
      if (parts.length < 4) { continue; }
      const unit = parts[0];
      if (!unit.endsWith('.service')) { continue; }
      services.push({
        unit,
        load: parts[1],
        active: parts[2],
        sub: parts[3],
        description: parts.slice(4).join(' '),
      });
    }
    // Sort: failed first, then running, then others
    services.sort((a, b) => {
      const order = (s: ServiceInfo) => {
        if (s.sub === 'failed') { return 0; }
        if (s.sub === 'running') { return 1; }
        return 2;
      };
      return order(a) - order(b);
    });
    return services;
  }

  /**
   * 控制 systemd 服务 (start/stop/restart)
   */
  static async controlService(
    config: HostConfig,
    authConfig: HostAuthConfig,
    unit: string,
    action: 'start' | 'stop' | 'restart'
  ): Promise<void> {
    // Validate unit name: only allow alphanumeric, dash, underscore, dot, @
    if (!/^[a-zA-Z0-9\-_.@]+\.service$/.test(unit)) {
      throw new Error(`Invalid service unit name: ${unit}`);
    }
    const allowedActions = ['start', 'stop', 'restart'] as const;
    if (!allowedActions.includes(action)) {
      throw new Error(`Invalid action: ${action}`);
    }
    return this.executeWithConnection(config, authConfig, async (conn) => {
      await this.executeCommand(conn, `systemctl ${action} '${unit}'`).catch(err => {
        throw new Error(`systemctl ${action} ${unit} failed: ${(err as Error).message}`);
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Crontab
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 获取远端 cron 任务列表（user crontab + /etc/crontab + /etc/cron.d/*）
   */
  static async getCrontabList(
    config: HostConfig,
    authConfig: HostAuthConfig
  ): Promise<CrontabEntry[]> {
    return this.executeWithConnection(config, authConfig, async (conn) => {
      const entries: CrontabEntry[] = [];

      // 当前用户 crontab
      const userRaw = await this.executeCommand(
        conn, 'crontab -l 2>/dev/null || echo ""'
      ).catch(() => '');
      entries.push(...this.parseCrontabOutput(userRaw, 'user', false));

      // 系统 /etc/crontab
      const sysRaw = await this.executeCommand(
        conn, 'cat /etc/crontab 2>/dev/null || echo ""'
      ).catch(() => '');
      entries.push(...this.parseCrontabOutput(sysRaw, '/etc/crontab', true));

      // /etc/cron.d/* — 用分隔符区分文件
      const cronDRaw = await this.executeCommand(
        conn,
        'for f in /etc/cron.d/*; do [ -f "$f" ] && printf "===FILE:%s===\\n" "$f" && cat "$f"; done 2>/dev/null || echo ""'
      ).catch(() => '');
      const cronDSections = cronDRaw.split(/\n?===FILE:([^=\n]+)===\n?/);
      // cronDSections: ['', '/etc/cron.d/file1', content1, '/etc/cron.d/file2', content2, ...]
      for (let i = 1; i < cronDSections.length; i += 2) {
        const filePath = cronDSections[i].trim();
        const content = cronDSections[i + 1] || '';
        if (filePath) {
          entries.push(...this.parseCrontabOutput(content, filePath, true));
        }
      }

      return entries;
    });
  }

  private static parseCrontabOutput(
    raw: string,
    source: string,
    hasUser: boolean
  ): CrontabEntry[] {
    const entries: CrontabEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) { continue; }
      // 环境变量行（如 MAILTO="root"）
      if (/^[A-Z_][A-Z0-9_]*\s*=/.test(trimmed)) {
        entries.push({
          source,
          minute: '', hour: '', dayOfMonth: '', month: '', dayOfWeek: '',
          command: trimmed,
          isEnvVar: true,
        });
        continue;
      }
      // @special 语法 (如 @reboot, @hourly, @daily)
      if (trimmed.startsWith('@')) {
        const parts = trimmed.split(/\s+/);
        if (hasUser && parts.length >= 3) {
          entries.push({
            source, minute: parts[0], hour: '', dayOfMonth: '', month: '', dayOfWeek: '',
            user: parts[1], command: parts.slice(2).join(' '),
          });
        } else if (!hasUser && parts.length >= 2) {
          entries.push({
            source, minute: parts[0], hour: '', dayOfMonth: '', month: '', dayOfWeek: '',
            command: parts.slice(1).join(' '),
          });
        }
        continue;
      }
      const parts = trimmed.split(/\s+/);
      const minFieldCount = hasUser ? 7 : 6;
      if (parts.length < minFieldCount) { continue; }
      const [minute, hour, dayOfMonth, month, dayOfWeek, ...rest] = parts;
      let user: string | undefined;
      let command: string;
      if (hasUser) {
        user = rest[0];
        command = rest.slice(1).join(' ');
      } else {
        command = rest.join(' ');
      }
      if (!command.trim()) { continue; }
      entries.push({ source, minute, hour, dayOfMonth, month, dayOfWeek, user, command });
    }
    return entries;
  }

  /**
   * 将用户 crontab 条目写回远端（仅允许修改 source==='user' 的条目）
   * 传入的 entries 不包含 system crontab，直接覆盖用户 crontab
   */
  static async writeUserCrontab(
    config: HostConfig,
    authConfig: HostAuthConfig,
    entries: Array<Pick<CrontabEntry, 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek' | 'command' | 'isEnvVar'>>
  ): Promise<void> {
    // Validate all entries server-side before writing
    const cronFieldPattern = /^[\d*/,\-]+$/;
    for (const entry of entries) {
      if (entry.isEnvVar) {
        if (!/^[A-Z_][A-Z0-9_]*\s*=/.test(entry.command)) {
          throw new Error(`Invalid environment variable entry: ${entry.command}`);
        }
        continue;
      }
      const isSpecial = entry.minute.startsWith('@');
      if (isSpecial) {
        if (!/^@(reboot|hourly|daily|weekly|monthly|yearly|annually|midnight)$/.test(entry.minute)) {
          throw new Error(`Invalid special schedule: ${entry.minute}`);
        }
      } else {
        if (!cronFieldPattern.test(entry.minute)) { throw new Error(`Invalid minute field: ${entry.minute}`); }
        if (!cronFieldPattern.test(entry.hour)) { throw new Error(`Invalid hour field: ${entry.hour}`); }
        if (!cronFieldPattern.test(entry.dayOfMonth)) { throw new Error(`Invalid day field: ${entry.dayOfMonth}`); }
        if (!cronFieldPattern.test(entry.month)) { throw new Error(`Invalid month field: ${entry.month}`); }
        if (!cronFieldPattern.test(entry.dayOfWeek)) { throw new Error(`Invalid weekday field: ${entry.dayOfWeek}`); }
      }
      if (!entry.command.trim()) { throw new Error('Command cannot be empty'); }
    }

    const lines = entries.map(e => {
      if (e.isEnvVar) { return e.command; }
      if (e.minute.startsWith('@')) { return `${e.minute} ${e.command}`; }
      return `${e.minute} ${e.hour} ${e.dayOfMonth} ${e.month} ${e.dayOfWeek} ${e.command}`;
    });
    const content = lines.join('\n') + (lines.length > 0 ? '\n' : '');

    return this.executeWithConnection(config, authConfig, async (conn) => {
      await this.executeCommandWithStdin(conn, 'crontab -', content);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Docker
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 获取 Docker 容器列表（含资源统计）
   * 如果 Docker 未安装/未运行，返回空数组
   */
  static async getContainerList(
    config: HostConfig,
    authConfig: HostAuthConfig
  ): Promise<ContainerInfo[]> {
    return this.executeWithConnection(config, authConfig, async (conn) => {
      // Check if docker is available
      const dockerCheck = await this.executeCommand(conn, 'command -v docker 2>/dev/null || echo ""').catch(() => '');
      if (!dockerCheck.trim()) {
        return [];
      }

      // Get container list
      const psRaw = await this.executeCommand(
        conn,
        // format: ID|Name|Image|Status|State|CreatedAt|Ports
        'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.CreatedAt}}|{{.Ports}}" 2>/dev/null || echo ""'
      ).catch(() => '');

      const containers = this.parseDockerPsOutput(psRaw);
      if (containers.length === 0) { return []; }

      // Get stats for running containers only
      const runningIds = containers.filter(c => c.state === 'running').map(c => c.id);
      let statsMap = new Map<string, { cpuPercent: number; memUsage: number; memLimit: number; memPercent: number; netIn: number; netOut: number }>();

      if (runningIds.length > 0) {
        const statsRaw = await this.executeCommand(
          conn,
          // format: ID|CPUPerc|MemUsage/MemLimit|MemPerc|NetIO
          'docker stats --no-stream --format "{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}" 2>/dev/null || echo ""'
        ).catch(() => '');
        statsMap = this.parseDockerStatsOutput(statsRaw);
      }

      return containers.map(c => {
        const stats = statsMap.get(c.id);
        return stats ? { ...c, ...stats } : c;
      });
    });
  }

  private static parseDockerPsOutput(raw: string): ContainerInfo[] {
    const containers: ContainerInfo[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { continue; }
      const parts = trimmed.split('|');
      if (parts.length < 5) { continue; }
      containers.push({
        id: parts[0] || '',
        name: parts[1] || '',
        image: parts[2] || '',
        status: parts[3] || '',
        state: parts[4] || '',
        createdAt: parts[5] || '',
        ports: parts[6] || '',
      });
    }
    return containers;
  }

  private static parseDockerStatsOutput(raw: string): Map<string, { cpuPercent: number; memUsage: number; memLimit: number; memPercent: number; netIn: number; netOut: number }> {
    const map = new Map<string, { cpuPercent: number; memUsage: number; memLimit: number; memPercent: number; netIn: number; netOut: number }>();
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { continue; }
      const parts = trimmed.split('|');
      if (parts.length < 5) { continue; }
      const id = parts[0];
      const cpuPercent = Number.parseFloat(parts[1]) || 0;
      // MemUsage: "123MiB / 2GiB"
      const memParts = (parts[2] || '').split('/').map(s => s.trim());
      const memUsage = this.parseDockerBytes(memParts[0] || '');
      const memLimit = this.parseDockerBytes(memParts[1] || '');
      const memPercent = Number.parseFloat(parts[3]) || 0;
      // NetIO: "1.2kB / 3.4MB"
      const netParts = (parts[4] || '').split('/').map(s => s.trim());
      const netIn = this.parseDockerBytes(netParts[0] || '');
      const netOut = this.parseDockerBytes(netParts[1] || '');
      map.set(id, { cpuPercent, memUsage, memLimit, memPercent, netIn, netOut });
    }
    return map;
  }

  /** 解析 Docker 显示的字节量（如 "1.2MiB", "512kB"）→ 字节数 */
  private static parseDockerBytes(str: string): number {
    const m = str.match(/^([\d.]+)\s*([KMGT]?i?B?)$/i);
    if (!m) { return 0; }
    const val = Number.parseFloat(m[1]) || 0;
    const unit = m[2].toLowerCase();
    if (unit.startsWith('t')) { return val * 1024 ** 4; }
    if (unit.startsWith('g')) { return val * 1024 ** 3; }
    if (unit.startsWith('m')) { return val * 1024 ** 2; }
    if (unit.startsWith('k')) { return val * 1024; }
    return val;
  }

  /**
   * 流式读取 Docker 容器日志（等价于 `docker logs --tail N -f`）。
   *
   * @param config      目标主机配置
   * @param authConfig  认证配置
   * @param containerId 容器 ID（12–64 位十六进制）
   * @param tailLines   初始显示的历史行数，默认 200
   * @param onChunk     每次收到新日志块时的回调
   * @param onEnd       流结束或发生错误时的回调
   * @returns           `{ stop }` 控制句柄，调用 stop() 可主动终止流
   */
  static async streamContainerLogs(
    config: HostConfig,
    authConfig: HostAuthConfig,
    containerId: string,
    onChunk: (chunk: string) => void,
    onEnd: (error?: Error) => void,
    tailLines = 200
  ): Promise<{ stop: () => void }> {
    // 严格校验 containerId，防止命令注入
    if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
      throw new Error(`Invalid container ID: ${containerId}`);
    }

    let jumpConns: Client[] | null = null;
    const conn = new Client();
    let stopped = false;
    let activeStream: any = null;

    const stop = () => {
      if (stopped) { return; }
      stopped = true;
      try { activeStream?.close(); } catch { /* ignore */ }
      try { conn.end(); } catch { /* ignore */ }
      if (jumpConns) {
        jumpConns.forEach(jc => { try { jc.end(); } catch { /* ignore */ } });
      }
    };

    try {
      const connectConfig: any = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 30000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      };
      addAuthToConnectConfig(connectConfig, authConfig);

      if (config.jumpHosts && config.jumpHosts.length > 0) {
        const jumpResult = await establishMultiHopConnection(
          config.jumpHosts,
          config.host,
          config.port
        );
        jumpConns = jumpResult.jumpConns;
        connectConfig.sock = jumpResult.stream;
      }

      await new Promise<void>((resolve, reject) => {
        conn
          .on('ready', () => resolve())
          .on('error', (err) => reject(err))
          .connect(connectConfig);
      });

      const command = `docker logs --tail ${tailLines} -f --timestamps ${containerId} 2>&1`;

      await new Promise<void>((resolve, reject) => {
        conn.exec(command, (err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          activeStream = stream;

          stream.on('data', (data: Buffer) => {
            if (!stopped) { onChunk(data.toString()); }
          });
          stream.stderr.on('data', (data: Buffer) => {
            if (!stopped) { onChunk(data.toString()); }
          });
          stream.on('close', () => {
            if (!stopped) {
              stopped = true;
              try { conn.end(); } catch { /* ignore */ }
              onEnd();
            }
            resolve();
          });
          stream.on('error', (err: Error) => {
            if (!stopped) {
              stopped = true;
              try { conn.end(); } catch { /* ignore */ }
              onEnd(err);
            }
            reject(err);
          });
        });
      });
    } catch (err) {
      stop();
      throw err;
    }

    return { stop };
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
