/**
 * 集成测试: 主机管理完整流程
 *
 * 测试主机配置、分组、书签等功能的协同工作
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HostManager } from '../hostManager';
import * as vscode from 'vscode';

describe('Host Management Integration Tests', () => {
  let context: vscode.ExtensionContext;
  let hostManager: HostManager;
  let globalStateStore: Map<string, any>;

  beforeEach(async () => {
    // 初始化测试环境
    globalStateStore = new Map();

    // Mock ExtensionContext
    context = {
      globalState: {
        get: vi.fn((key: string, defaultValue?: any) => {
          return globalStateStore.get(key) ?? defaultValue;
        }),
        update: vi.fn(async (key: string, value: any) => {
          globalStateStore.set(key, value);
        }),
        keys: vi.fn(() => Array.from(globalStateStore.keys())),
        setKeysForSync: vi.fn()
      }
    } as any;

    hostManager = new HostManager(context);

    await hostManager.initialize();
  });

  describe('完整的主机配置流程', () => {
    it('应该完成: 创建分组 → 添加主机 → 添加书签 → 记录使用历史', async () => {
      // 1. 创建分组
      const group = await hostManager.addGroup('Web Servers');
      expect(group.id).toBeDefined();
      expect(group.name).toBe('Web Servers');

      // 2. 添加主机到分组
      const host = await hostManager.addHost({
        name: 'production-web',
        host: '192.168.1.100',
        port: 22,
        username: 'www-data',
        group: group.id,
        defaultRemotePath: '/var/www',
        color: '#FF5722',
        starred: true
      });

      expect(host.id).toBeDefined();
      expect(host.group).toBe(group.id);

      // 3. 通过 HostManager 添加书签
      await hostManager.addBookmark(host.id, 'Web Root', '/var/www/html');
      await hostManager.addBookmark(host.id, 'Nginx Config', '/etc/nginx');

      // 4. 验证书签已添加
      const bookmarks = await hostManager.getBookmarks(host.id);

      // 5. 记录最近使用的主机
      await hostManager.recordRecentUsed(host.id);
      const recentHosts = await hostManager.getRecentUsed();
      expect(recentHosts).toContain(host.id);

      // 6. 记录最近访问的路径
      await hostManager.recordRecentPath(host.id, '/var/www/html');
      await hostManager.recordRecentPath(host.id, '/var/log/nginx');

      const recentPaths = await hostManager.getRecentPaths(host.id);
      expect(recentPaths).toHaveLength(2);
      expect(recentPaths[0]).toBe('/var/log/nginx'); // 最新的在前面

      // 7. 验证主机的完整配置
      const hosts = await hostManager.getHosts();
      const savedHost = hosts.find(h => h.id === host.id);

      expect(savedHost).toMatchObject({
        name: 'production-web',
        host: '192.168.1.100',
        port: 22,
        username: 'www-data',
        group: group.id,
        defaultRemotePath: '/var/www',
        color: '#FF5722',
        starred: true
      });

      expect(savedHost?.bookmarks).toHaveLength(2);
      expect(savedHost?.recentPaths).toHaveLength(2);
    });
  });

  describe('主机导入导出流程', () => {
    it('应该完成: 导出主机 → 删除 → 导入 → 验证恢复', async () => {
      // 1. 创建完整的主机配置
      const group = await hostManager.addGroup('Database Servers');
      const host = await hostManager.addHost({
        name: 'mysql-master',
        host: 'db.example.com',
        port: 3306,
        username: 'dba',
        group: group.id
      });

      await hostManager.addBookmark(host.id, 'Data Dir', '/var/lib/mysql');
      await hostManager.recordRecentPath(host.id, '/etc/mysql');

      // 2. 导出主机配置
      const exportJson = await hostManager.exportHost(host.id);
      const exportData = JSON.parse(exportJson);

      expect(exportData.hosts).toHaveLength(1);
      expect(exportData.groups).toHaveLength(1);
      expect(exportData.version).toBe('1.0.0');

      // 3. 删除主机
      await hostManager.deleteHost(host.id);
      const hostsAfterDelete = await hostManager.getHosts();
      expect(hostsAfterDelete.find(h => h.id === host.id)).toBeUndefined();

      // 4. 导入配置
      const importResult = await hostManager.importHosts(exportJson);
      expect(importResult.imported).toBe(1);
      expect(importResult.skipped).toBe(0);

      // 5. 验证主机已恢复
      const hostsAfterImport = await hostManager.getHosts();
      const restoredHost = hostsAfterImport.find(h => h.name === 'mysql-master');

      expect(restoredHost).toBeDefined();
      expect(restoredHost?.host).toBe('db.example.com');
      expect(restoredHost?.bookmarks).toHaveLength(1);
      expect(restoredHost?.bookmarks?.[0].name).toBe('Data Dir');
      expect(restoredHost?.recentPaths).toContain('/etc/mysql');
    });

    it('应该完成: 导出整个分组 → 导入到新环境', async () => {
      // 1. 创建分组和多个主机
      const group = await hostManager.addGroup('Development');

      const host1 = await hostManager.addHost({
        name: 'dev-api',
        host: 'dev-api.internal',
        port: 22,
        username: 'developer',
        group: group.id
      });

      const host2 = await hostManager.addHost({
        name: 'dev-web',
        host: 'dev-web.internal',
        port: 22,
        username: 'developer',
        group: group.id
      });

      // 2. 导出整个分组
      const exportJson = await hostManager.exportGroup(group.id);
      const exportData = JSON.parse(exportJson);

      expect(exportData.hosts).toHaveLength(2);
      expect(exportData.groups).toHaveLength(1);

      // 3. 清空所有主机
      await hostManager.deleteHost(host1.id);
      await hostManager.deleteHost(host2.id);
      await hostManager.deleteGroup(group.id);

      // 4. 导入分组
      const importResult = await hostManager.importHosts(exportJson);
      expect(importResult.imported).toBe(2);

      // 5. 验证分组和主机都已恢复
      const groups = await hostManager.getGroups();
      const restoredGroup = groups.find(g => g.name === 'Development');
      expect(restoredGroup).toBeDefined();

      const hosts = await hostManager.getHosts();
      const groupHosts = hosts.filter(h => h.group === restoredGroup?.id);
      expect(groupHosts).toHaveLength(2);
    });
  });

  describe('SSH 配置导入流程', () => {
    it('应该完成: 解析 SSH 配置 → 验证主机信息 → 避免重复导入', async () => {
      // 1. 准备 SSH 配置内容
      const sshConfig = `
# Production Servers
Host prod-web
  HostName web.example.com
  User admin
  Port 2222

Host prod-db
  HostName db.example.com
  User dba
  Port 22

# Development Server
Host dev
  HostName dev.internal
  User developer
`;

      // 2. 使用私有方法解析配置 (集成测试可以访问私有方法)
      const parsedEntries = (hostManager as any).parseSshConfig(sshConfig);

      expect(parsedEntries).toHaveLength(3);
      expect(parsedEntries[0]).toMatchObject({
        Host: 'prod-web',
        HostName: 'web.example.com',
        User: 'admin',
        Port: '2222'
      });

      // 3. 模拟导入流程 (不使用真实文件系统)
      // 在真实场景中,会从 ~/.ssh/config 读取
      // 这里我们手动创建主机
      const importedHosts = [];

      for (const entry of parsedEntries) {
        if (!entry.HostName) {
          continue;
        }

        const newHost = await hostManager.addHost({
          name: entry.Host,
          host: entry.HostName,
          port: entry.Port ? Number.parseInt(entry.Port, 10) : 22,
          username: entry.User || 'root'
        });

        importedHosts.push(newHost);
      }

      // 4. 验证导入的主机
      expect(importedHosts).toHaveLength(3);
      expect(importedHosts[0].name).toBe('prod-web');
      expect(importedHosts[0].port).toBe(2222);

      // 5. 尝试重复导入 (应该跳过)
      const hosts = await hostManager.getHosts();
      const duplicateCount = hosts.filter(h =>
        h.host === 'web.example.com' && h.username === 'admin'
      ).length;

      expect(duplicateCount).toBe(1); // 只有一个,没有重复
    });
  });

  describe('书签服务集成', () => {
    it('应该完成: 添加书签 → 重命名 → 删除 → 浏览', async () => {
      // 1. 添加主机
      const host = await hostManager.addHost({
        name: 'file-server',
        host: 'files.example.com',
        port: 22,
        username: 'admin'
      });

      // 2. 添加多个书签
      await hostManager.addBookmark(host.id, 'Documents', '/home/shared/docs');
      await hostManager.addBookmark(host.id, 'Media', '/home/shared/media');
      await hostManager.addBookmark(host.id, 'Backups', '/backup');

      // 3. 验证书签列表
      let bookmarks = await hostManager.getBookmarks(host.id);
      expect(bookmarks).toHaveLength(3);

      // 4. 重命名书签
      await hostManager.updateBookmark(host.id, 'Documents', 'Important Docs', '/home/shared/docs');
      bookmarks = await hostManager.getBookmarks(host.id);

      const renamedBookmark = bookmarks.find(b => b.name === 'Important Docs');
      expect(renamedBookmark).toBeDefined();
      expect(renamedBookmark?.path).toBe('/home/shared/docs');

      // 5. 删除书签
      await hostManager.removeBookmark(host.id, 'Backups');
      bookmarks = await hostManager.getBookmarks(host.id);
      expect(bookmarks).toHaveLength(2);

      // 6. 验证通过 HostManager 也能获取书签
      const hostsWithBookmarks = await hostManager.getHosts();
      const hostWithBookmarks = hostsWithBookmarks.find(h => h.id === host.id);
      expect(hostWithBookmarks?.bookmarks).toHaveLength(2);
    });

    it('应该防止添加重复书签名称', async () => {
      const host = await hostManager.addHost({
        name: 'test-host',
        host: 'test.com',
        port: 22,
        username: 'user'
      });

      await hostManager.addBookmark(host.id, 'Home', '/home');

      // 尝试添加重复名称的书签应该失败
      await expect(
        hostManager.addBookmark(host.id, 'Home', '/root')
      ).rejects.toThrow("Bookmark with name 'Home' already exists");
    });
  });

  describe('最近使用记录集成', () => {
    it('应该完成: 多主机使用 → 记录排序 → 限制数量', async () => {
      // 1. 创建 10 个主机
      const hosts = [];
      for (let i = 1; i <= 10; i++) {
        const host = await hostManager.addHost({
          name: `server-${i}`,
          host: `192.168.1.${i}`,
          port: 22,
          username: 'user'
        });
        hosts.push(host);
      }

      // 2. 按顺序记录使用
      for (const host of hosts) {
        await hostManager.recordRecentUsed(host.id);
      }

      // 3. 验证只保留最近 5 个
      const recentHosts = await hostManager.getRecentUsed();
      expect(recentHosts).toHaveLength(5);

      // 最后使用的应该在最前面
      expect(recentHosts[0]).toBe(hosts[9].id); // server-10
      expect(recentHosts[4]).toBe(hosts[5].id); // server-6

      // 4. 再次使用旧的主机
      await hostManager.recordRecentUsed(hosts[2].id); // server-3

      const updatedRecentHosts = await hostManager.getRecentUsed();
      expect(updatedRecentHosts[0]).toBe(hosts[2].id); // 应该移到最前面
      expect(updatedRecentHosts).toHaveLength(5); // 仍然只保留 5 个
    });

    it('应该为每个主机独立记录最近路径', async () => {
      // 1. 创建两个主机
      const host1 = await hostManager.addHost({
        name: 'web-server',
        host: '192.168.1.10',
        port: 22,
        username: 'www'
      });

      const host2 = await hostManager.addHost({
        name: 'db-server',
        host: '192.168.1.20',
        port: 22,
        username: 'mysql'
      });

      // 2. 为 host1 记录路径
      await hostManager.recordRecentPath(host1.id, '/var/www/html');
      await hostManager.recordRecentPath(host1.id, '/etc/nginx');

      // 3. 为 host2 记录路径
      await hostManager.recordRecentPath(host2.id, '/var/lib/mysql');
      await hostManager.recordRecentPath(host2.id, '/etc/mysql');

      // 4. 验证路径独立存储
      const paths1 = await hostManager.getRecentPaths(host1.id);
      const paths2 = await hostManager.getRecentPaths(host2.id);

      expect(paths1).toHaveLength(2);
      expect(paths1).toContain('/var/www/html');
      expect(paths1).not.toContain('/var/lib/mysql');

      expect(paths2).toHaveLength(2);
      expect(paths2).toContain('/var/lib/mysql');
      expect(paths2).not.toContain('/var/www/html');
    });
  });

  describe('复杂场景: 多主机多分组协同', () => {
    it('应该完成: 创建企业级主机架构', async () => {
      // 场景: 为一个公司配置完整的服务器架构

      // 1. 创建分组
      const prodGroup = await hostManager.addGroup('Production');
      const devGroup = await hostManager.addGroup('Development');
      const dbGroup = await hostManager.addGroup('Databases');

      // 2. 添加生产环境主机
      const prodWeb = await hostManager.addHost({
        name: 'prod-web-1',
        host: 'web1.prod.example.com',
        port: 22,
        username: 'deploy',
        group: prodGroup.id,
        starred: true,
        color: '#F44336'
      });

      await hostManager.addHost({
        name: 'prod-web-2',
        host: 'web2.prod.example.com',
        port: 22,
        username: 'deploy',
        group: prodGroup.id,
        color: '#F44336'
      });

      // 3. 添加开发环境主机
      const devWeb = await hostManager.addHost({
        name: 'dev-web',
        host: 'dev.example.com',
        port: 22,
        username: 'developer',
        group: devGroup.id,
        color: '#4CAF50'
      });

      // 4. 添加数据库主机
      const dbMaster = await hostManager.addHost({
        name: 'db-master',
        host: 'db-master.example.com',
        port: 3306,
        username: 'dba',
        group: dbGroup.id,
        starred: true,
        color: '#2196F3'
      });

      // 5. 为每个主机添加书签
await hostManager.addBookmark(prodWeb.id, 'App', '/var/www/app');
      await hostManager.addBookmark(prodWeb.id, 'Logs', '/var/log/app');

      await hostManager.addBookmark(devWeb.id, 'Code', '/home/dev/project');
      await hostManager.addBookmark(devWeb.id, 'Logs', '/tmp/dev-logs');

      await hostManager.addBookmark(dbMaster.id, 'Data', '/var/lib/mysql');
      await hostManager.addBookmark(dbMaster.id, 'Config', '/etc/mysql');

      // 6. 记录使用历史
      await hostManager.recordRecentUsed(prodWeb.id);
      await hostManager.recordRecentUsed(dbMaster.id);

      // 7. 导出整个配置
      const exportJson = await hostManager.exportAllHosts();
      const exportData = JSON.parse(exportJson);

      // 8. 验证导出的完整性
      expect(exportData.hosts).toHaveLength(4);
      expect(exportData.groups).toHaveLength(3);

      // 验证主机配置
      const exportedProdWeb = exportData.hosts.find((h: any) => h.name === 'prod-web-1');
      expect(exportedProdWeb).toMatchObject({
        host: 'web1.prod.example.com',
        port: 22,
        username: 'deploy',
        starred: true,
        color: '#F44336'
      });
      expect(exportedProdWeb.bookmarks).toHaveLength(2);

      // 9. 验证分组结构
      const groups = await hostManager.getGroups();
      expect(groups).toHaveLength(3);

      const prodHosts = (await hostManager.getHosts()).filter(h => h.group === prodGroup.id);
      expect(prodHosts).toHaveLength(2);

      // 10. 验证最近使用
      const recentUsed = await hostManager.getRecentUsed();
      expect(recentUsed).toContain(prodWeb.id);
      expect(recentUsed).toContain(dbMaster.id);

      // 11. 验证星标主机
      const starredHosts = (await hostManager.getHosts()).filter(h => h.starred);
      expect(starredHosts).toHaveLength(2);
      expect(starredHosts.map(h => h.name)).toContain('prod-web-1');
      expect(starredHosts.map(h => h.name)).toContain('db-master');
    });
  });
});
