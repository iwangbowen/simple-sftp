/**
 * 路径书签接口
 */
export interface PathBookmark {
  /** 书签名称 */
  name: string;
  /** 远程路径 */
  path: string;
  /** 书签说明/备注 */
  description?: string;
  /** 书签颜色,用于视觉识别 */
  color?: string;
}

/**
 * 可复用远程任务
 */
export interface SavedRemoteTask {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  label: string;
  /** 要执行的远程命令 */
  command: string;
  /** 远程工作目录 */
  workingDirectory: string;
  /** 是否通过 SSH Terminal 执行 */
  runInTerminal: boolean;
  /** 执行后要打开的浏览器地址，可选 */
  openInBrowserAfter?: string;
}

/**
 * 认证方式类型
 */
export type AuthType = 'password' | 'privateKey' | 'agent';

/**
 * 跳板机(Jump Host/Proxy)配置接口
 */
export interface JumpHostConfig {
  /** 跳板机主机地址 */
  host: string;
  /** 跳板机端口 */
  port: number;
  /** 跳板机用户名 */
  username: string;
  /** 跳板机认证方式 */
  authType: AuthType;
  /** 跳板机密码 */
  password?: string;
  /** 跳板机私钥路径 */
  privateKeyPath?: string;
  /** 跳板机私钥密码 */
  passphrase?: string;
}

/**
 * 主机配置接口 (同步信息)
 */
export interface HostConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  /** 所属分组 */
  group?: string;
  /** 默认远程路径 */
  defaultRemotePath?: string;
  /** 主机颜色,用于视觉识别 */
  color?: string;
  /** 是否星标 */
  starred?: boolean;
  /** 最近使用的远程路径列表 (最多保留10条) */
  recentPaths?: string[];
  /** 路径书签列表 */
  bookmarks?: PathBookmark[];
  /** 跳板机配置列表 (支持多跳) */
  jumpHosts?: JumpHostConfig[];
  /** 自定义备注 */
  notes?: string;
  /** 主机级复用远程任务 */
  remoteTasks?: SavedRemoteTask[];
}

/**
 * 主机认证配置 (本地存储,不同步)
 */
export interface HostAuthConfig {
  /** 主机 ID */
  hostId: string;
  /** 认证方式 */
  authType: AuthType;
  /** 密码（仅当 authType 为 password 时使用） */
  password?: string;
  /** 私钥路径（仅当 authType 为 privateKey 时使用） */
  privateKeyPath?: string;
  /** 私钥密码 */
  passphrase?: string;
}

/**
 * 完整的主机配置 (包含同步和本地信息)
 */
export interface FullHostConfig extends HostConfig {
  authType?: AuthType;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

/**
 * 分组配置接口
 */
export interface GroupConfig {
  id: string;
  name: string;
}

/**
 * 存储的数据结构
 */
export interface StorageData {
  hosts: HostConfig[];
  groups: GroupConfig[];
  /** 最近使用的主机ID列表 (上传或下载,最多保留5个) */
  recentUsed?: string[];
}

/**
 * SSH 配置项
 */
export interface SshConfigEntry {
  Host: string;
  HostName?: string;
  Port?: string;
  User?: string;
  IdentityFile?: string;
  [key: string]: string | undefined;
}

/**
 * 上传进度信息
 */
export interface UploadProgress {
  totalFiles: number;
  uploadedFiles: number;
  currentFile: string;
  percentage: number;
}

// ---------------------------------------------------------------------------
// Deploy Profile — 保存即上传 / 项目级部署规则
// 存储于 workspaceState（本地，不跨设备同步），因本地根路径与机器绑定。
// ---------------------------------------------------------------------------

/** 上传前确认策略 */
export type ConfirmBeforeUpload = 'never' | 'always' | 'onConflict';

/** 文件冲突策略 */
export type ConflictStrategy = 'overwrite' | 'skip' | 'promptIfNewer';

/** Deploy Profile 同步模式 */
export type DeploySyncMode = 'uploadChanged' | 'mirrorLocal';

/** Deploy Profile 同步比对方式 */
export type DeploySyncCompareMethod = 'mtime' | 'checksum';

/**
 * 项目级部署规则：本地目录 ↔ 远程目录映射 + 自动上传策略
 */
export interface DeployProfile {
  /** 唯一标识符 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 关联的主机 ID */
  hostId: string;
  /**
   * 本地根路径（绝对路径 或 ${workspaceFolder}）。
   * 只有保存文件在此路径下时才会触发上传。
   */
  localRoot: string;
  /** 远程根路径，e.g. /var/www/app */
  remoteRoot: string;
  /** 是否在保存时自动上传 */
  uploadOnSave: boolean;
  /**
   * 排除规则（glob 模式）。
   * 匹配的文件/目录不会被上传，e.g. ["node_modules/**", "*.log"]
   */
  excludePatterns: string[];
  /** 上传前确认策略 */
  confirmBeforeUpload: ConfirmBeforeUpload;
  /** 文件冲突策略 */
  conflictStrategy: ConflictStrategy;
  /**
   * 是否仅在当前 workspace 中生效。
   * 当 localRoot 使用 ${workspaceFolder} 时建议开启。
   */
  scopeToWorkspace: boolean;
  /** 是否启用此规则 */
  enabled: boolean;
  /** 手动同步模式 */
  syncMode: DeploySyncMode;
  /** 同步时的文件变更比对方式 */
  compareMethod: DeploySyncCompareMethod;
  /** 同步时是否删除远端多余文件 */
  deleteRemote: boolean;
  /** 同步时是否保留时间戳 */
  preserveTimestamps: boolean;
  /** Deploy Profile 级复用远程任务 */
  remoteTasks?: SavedRemoteTask[];
}
