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
  /** 接收速率 (KB/s) - 需要两次采样计算 */
  rxRate?: number;
  /** 发送速率 (KB/s) - 需要两次采样计算 */
  txRate?: number;
  /** IP地址 */
  ipAddress?: string;
  /** 状态 */
  state: string;
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
}

/**
 * 资源仪表盘服务
 */
export class ResourceDashboardService {
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

      return {
        cpu: cpuInfo,
        memory: memoryInfo,
        disk: diskInfo,
        system: systemInfo,
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
      // 获取网络统计信息
      const netDevOutput = await this.executeCommand(conn, 'cat /proc/net/dev');
      const ipAddrOutput = await this.executeCommand(conn, 'ip -br addr').catch(() => '');

      const interfaces: NetworkInterfaceInfo[] = [];
      const lines = netDevOutput.trim().split('\n');

      // 解析 IP 地址信息
      const ipMap = new Map<string, string>();
      if (ipAddrOutput) {
        const ipLines = ipAddrOutput.trim().split('\n');
        for (const line of ipLines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            const name = parts[0];
            const state = parts[1];
            const ip = parts[2]?.split('/')[0]; // 提取 IP 地址部分
            if (ip && ip !== '-') {
              ipMap.set(name, ip);
            }
          }
        }
      }

      // 跳过前两行标题
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {continue;}

        // 解析 /proc/net/dev 输出
        // eth0: 1234567 12345 0 0 0 0 0 0 9876543 98765 0 0 0 0 0 0
        const [namePart, ...dataParts] = line.split(/:\s+/);
        if (!namePart || dataParts.length === 0) {continue;}

        const name = namePart.trim();
        const stats = dataParts[0].split(/\s+/);

        if (stats.length < 16) {continue;}

        interfaces.push({
          name,
          rxBytes: Number.parseInt(stats[0]) || 0,
          rxPackets: Number.parseInt(stats[1]) || 0,
          txBytes: Number.parseInt(stats[8]) || 0,
          txPackets: Number.parseInt(stats[9]) || 0,
          ipAddress: ipMap.get(name),
          state: ipMap.has(name) ? 'UP' : 'DOWN',
        });
      }

      return interfaces;
    });
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
      if (!/^(sd[a-z]|nvme\d+n\d+|vd[a-z]|hd[a-z])$/.test(device)) {
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
    const output = await this.executeCommand(conn, 'free -m');
    const lines = output.trim().split('\n');

    // 解析内存行 (第二行)
    // Mem:       15869       8234       1285        524       6349       6831
    const memLine = lines[1];
    const memParts = memLine.split(/\s+/);

    const total = Number.parseInt(memParts[1]) || 0;
    const used = Number.parseInt(memParts[2]) || 0;
    const available = Number.parseInt(memParts[6]) || Number.parseInt(memParts[3]) || 0; // 优先使用 available,否则用 free

    const usage = total > 0 ? (used / total) * 100 : 0;

    return {
      total,
      used,
      available,
      usage: Math.round(usage * 10) / 10,
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
