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
  /** 主机颜色，用于视觉识别 */
  color?: string;
  /** 是否星标 */
  starred?: boolean;
  /** 最近使用的远程路径列表 (最多保留10条) */
  recentPaths?: string[];
}

/**
 * 主机认证配置 (本地存储,不同步)
 */
export interface HostAuthConfig {
  /** 主机 ID */
  hostId: string;
  /** 认证方式 */
  authType: 'password' | 'privateKey' | 'agent';
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
  authType?: 'password' | 'privateKey' | 'agent';
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
