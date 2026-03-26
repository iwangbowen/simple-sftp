import * as vscode from 'vscode';
import { DeployProfile, ConfirmBeforeUpload, ConflictStrategy } from '../types';
import { DEPLOY_PROFILE } from '../constants';
import { logger } from '../logger';

/**
 * 管理项目级部署规则（DeployProfile）的 CRUD 操作。
 * 数据存储于 globalState（不加入 sync，因 localRoot 为本机路径），所有工作区可见。
 */
export class DeployProfileService {
  private context: vscode.ExtensionContext;

  private readonly _onDidChangeProfiles = new vscode.EventEmitter<void>();
  /** 当 Profile 列表发生变化时触发 */
  readonly onDidChangeProfiles = this._onDidChangeProfiles.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  // --------------------------------------------------------------------------
  // 读取
  // --------------------------------------------------------------------------

  /** 获取所有 Deploy Profile（全局，不限工作区） */
  getAll(): DeployProfile[] {
    return this.context.globalState.get<DeployProfile[]>(
      DEPLOY_PROFILE.STORAGE_KEY,
      []
    );
  }

  /** 根据 ID 获取单个 Profile，不存在则返回 undefined */
  getById(id: string): DeployProfile | undefined {
    return this.getAll().find(p => p.id === id);
  }

  /** 获取所有已启用且开启了 uploadOnSave 的 Profile */
  getActiveUploadOnSaveProfiles(): DeployProfile[] {
    return this.getAll().filter(p => p.enabled && p.uploadOnSave);
  }

  // --------------------------------------------------------------------------
  // 写入
  // --------------------------------------------------------------------------

  /** 创建新的 Deploy Profile，返回已保存的 Profile */
  async create(params: Omit<DeployProfile, 'id'>): Promise<DeployProfile> {
    const profile: DeployProfile = {
      ...params,
      id: this.generateId(),
    };
    const profiles = this.getAll();
    profiles.push(profile);
    await this.save(profiles);
    logger.info(`[DeployProfile] Created profile: "${profile.name}" (${profile.id})`);
    return profile;
  }

  /** 更新已有 Profile，返回更新后的 Profile；不存在则抛出错误 */
  async update(id: string, updates: Partial<Omit<DeployProfile, 'id'>>): Promise<DeployProfile> {
    const profiles = this.getAll();
    const index = profiles.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error(`DeployProfile not found: ${id}`);
    }
    profiles[index] = { ...profiles[index], ...updates };
    await this.save(profiles);
    logger.info(`[DeployProfile] Updated profile: "${profiles[index].name}" (${id})`);
    return profiles[index];
  }

  /** 删除 Profile；不存在时静默忽略 */
  async delete(id: string): Promise<void> {
    const profiles = this.getAll().filter(p => p.id !== id);
    await this.save(profiles);
    logger.info(`[DeployProfile] Deleted profile: ${id}`);
  }

  /** 切换 Profile 的 enabled 状态 */
  async toggle(id: string): Promise<DeployProfile> {
    const profile = this.getById(id);
    if (!profile) {
      throw new Error(`DeployProfile not found: ${id}`);
    }
    return this.update(id, { enabled: !profile.enabled });
  }

  /** 切换 Profile 的 uploadOnSave 开关 */
  async toggleUploadOnSave(id: string): Promise<DeployProfile> {
    const profile = this.getById(id);
    if (!profile) {
      throw new Error(`DeployProfile not found: ${id}`);
    }
    return this.update(id, { uploadOnSave: !profile.uploadOnSave });
  }

  // --------------------------------------------------------------------------
  // 默认值辅助
  // --------------------------------------------------------------------------

  /** 构造带默认值的空 Profile（仅必填字段需显式提供） */
  static buildDefaults(
    name: string,
    hostId: string,
    localRoot: string,
    remoteRoot: string
  ): Omit<DeployProfile, 'id'> {
    return {
      name,
      hostId,
      localRoot,
      remoteRoot,
      uploadOnSave: true,
      excludePatterns: [...DEPLOY_PROFILE.DEFAULT_EXCLUDE_PATTERNS],
      confirmBeforeUpload: DEPLOY_PROFILE.DEFAULT_CONFIRM as ConfirmBeforeUpload,
      conflictStrategy: DEPLOY_PROFILE.DEFAULT_CONFLICT as ConflictStrategy,
      scopeToWorkspace: true,
      enabled: true,
    };
  }

  // --------------------------------------------------------------------------
  // 私有辅助
  // --------------------------------------------------------------------------

  private async save(profiles: DeployProfile[]): Promise<void> {
    await this.context.globalState.update(DEPLOY_PROFILE.STORAGE_KEY, profiles);
    this._onDidChangeProfiles.fire();
  }

  private generateId(): string {
    return `dp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
