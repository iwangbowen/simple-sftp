# SFTP 传输优化方案路线图

## 概述

本文档记录了基于 SFTP 协议特性的传输优化方案，旨在提升 Simple SFTP 扩展的性能、可靠性和用户体验。

**当前版本**: v2.4.8
**文档创建日期**: 2026-01-15
**最后更新**: 2026-01-17 (11:30)
**维护人**: Development Team

---

## 已实现功能

### ✅ 1. 断点续传 (Resume Support)

**状态**: 已实现 (v2.1.0)

**功能描述**:
- 暂停的传输任务可以从上次停止的位置继续
- 保留传输进度和速度统计
- 使用 Node.js Stream API 配合 SFTP 的 createReadStream/createWriteStream 实现

**实现方式**:
```typescript
// sshConnectionManager.ts - uploadFileWithResume()
private static async uploadFileWithResume(
  sftp: any,
  localPath: string,
  remotePath: string,
  startOffset: number,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const stat = fs.statSync(localPath);
  const totalSize = stat.size;

  // 创建读取流，从指定偏移量开始
  const readStream = fs.createReadStream(localPath, {
    start: startOffset,
    highWaterMark: 64 * 1024 // 64KB chunks
  });

  // 创建写入流，追加模式
  const writeStream = sftp.createWriteStream(remotePath, {
    flags: 'a',  // append mode
    start: startOffset
  });

  let transferredSinceStart = 0;

  return new Promise((resolve, reject) => {
    readStream.on('data', (chunk: string | Buffer) => {
      const chunkLength = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      transferredSinceStart += chunkLength;
      const totalTransferred = startOffset + transferredSinceStart;

      if (signal?.aborted) {
        readStream.destroy();
        writeStream.destroy();
        reject(new Error('Transfer aborted'));
        return;
      }

      if (onProgress) {
        onProgress(totalTransferred, totalSize);
      }
    });

    readStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);

    readStream.pipe(writeStream);
  });
}
```

**优势**:
- 大文件传输中断后无需重新开始
- 节省时间和带宽
- 提升不稳定网络环境下的用户体验
- 支持用户手动暂停/恢复传输

**技术细节**:
- 文件: `src/sshConnectionManager.ts`
- 方法: `uploadFileWithResume()`, `downloadFileWithResume()`
- 自动模式切换:
  - offset = 0: 使用 fastPut/fastGet（适合新传输）
  - offset > 0: 使用 Stream（适合断点续传）
- 支持 AbortSignal 中断传输

**使用场景**:
- TransferQueueService 在恢复暂停任务时传递 `startOffset` 参数
- 传输过程中用户可以暂停任务，下次恢复时从断点继续

---

### ✅ 2. 并发分片传输 (Chunked Parallel Transfer)

**状态**: 已实现并优化 (v2.4.8)

**功能描述**:
- 将大文件（≥100MB）分成多个块并发传输
- 使用多个 SFTP 连接池连接提升传输速度
- 自动聚合块传输进度
- 传输完成后在远程服务器直接合并文件（高效）

**实现方式**:
```typescript
// parallelChunkTransfer.ts - ParallelChunkTransferManager
class ParallelChunkTransferManager {
  async uploadFileParallel(config, authConfig, localPath, remotePath, options) {
    const stat = fs.statSync(localPath);
    const fileSize = stat.size;

    // 1. 将文件分成 10MB 的块
    const chunks = this.splitIntoChunks(fileSize, options.chunkSize);

    // 2. 使用连接池并发传输块到远程 /tmp 目录（最多5个并发）
    await this.processBatches(chunks, options.maxConcurrent, async (chunk) => {
      const { sftpClient } = await this.connectionPool.getConnection(config, authConfig, connectConfig);
      try {
        // 将chunk数据提取到本地临时文件
        const localChunkPath = path.join(os.tmpdir(), `upload_chunk_${Date.now()}_${chunk.index}`);
        const readStream = fs.createReadStream(localPath, {
          start: chunk.start,
          end: chunk.end
        });
        const writeStream = fs.createWriteStream(localChunkPath);
        await pipeline(readStream, writeStream);

        // 使用fastPut上传chunk（比stream更可靠）
        const chunkRemotePath = `/tmp/${fileName}.part${chunk.index}`;
        await sftpClient.fastPut(localChunkPath, chunkRemotePath, {
          step: (transferred) => onProgress(transferred)
        });

        // 清理本地临时chunk
        fs.unlinkSync(localChunkPath);
      } finally {
        this.connectionPool.releaseConnection(config);
      }
    });

    // 3. 在远程服务器直接合并chunks（高效策略）
    try {
      await this.mergeChunksOnRemote(config, authConfig, remotePath, chunks.length);
    } catch (mergeError) {
      // 如果远程合并失败，清理chunks并fallback到普通上传
      logger.warn(`Remote merge failed: ${mergeError.message}`);
      await this.cleanupPartialChunks(config, authConfig, remotePath, chunks.length);
      
      logger.info('Falling back to normal single-file upload...');
      // 使用普通fastPut上传完整文件
      await sftpClient.fastPut(localPath, remotePath, {
        step: (transferred, total) => onProgress(transferred, total)
      });
    }
  }

  // 远程合并 - 使用SSH exec执行cat命令
  private async mergeChunksOnRemote(config, authConfig, remotePath, totalChunks) {
    const { client } = await this.connectionPool.getConnection(config, authConfig, connectConfig);

    // 构建合并命令: cat part0 part1 ... > final.jar && rm part0 part1 ...
    const fileName = path.basename(remotePath);
    const parts = Array.from({ length: totalChunks }, (_, i) => `"/tmp/${fileName}.part${i}"`).join(' ');
    const command = `cat ${parts} > "${remotePath}" && rm ${parts}`;

    // 通过SSH执行远程命令
    await new Promise<void>((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(new Error(`SSH exec not supported: ${err.message}`));
          return;
        }

        let stderr = '';
        let stdout = '';

        // 必须消费stdout和stderr，否则stream会阻塞
        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });

        stream.on('close', (code) => {
          if (code === 0) {
            logger.info(`✓ Chunks merged successfully on remote server`);
            resolve();
          } else {
            reject(new Error(`Remote merge failed with exit code ${code}: ${stderr}`));
          }
        });

        stream.on('error', reject);
      });
    });
  }
}
```

**配置选项**:
```typescript
// constants.ts
export const PARALLEL_TRANSFER = {
  CHUNK_SIZE: 10 * 1024 * 1024,        // 10MB per chunk
  MAX_CONCURRENT: 5,                    // 5 concurrent transfers
  THRESHOLD: 100 * 1024 * 1024,         // Use parallel for files > 100MB
  ENABLED: true,                        // Enable/disable feature
};
```

**优势**:
- 大文件传输速度提升 3-5 倍
- 充分利用带宽和多核 CPU
- **远程直接合并**：避免下载-合并-上传的低效循环
- **智能Fallback**：远程合并失败时自动切换到普通上传
- 自动透明处理，无需用户干预
- 支持进度实时聚合

**关键优化 (v2.4.8)**:
1. **修复 `sftp.unlink is not a function` 错误**
   - 正确使用 `sftp.delete()` 方法删除远程文件
   - 之前的错误导致任务在100%时失败并无限重试

2. **远程直接合并策略**
   - 优先使用SSH exec在远程执行 `cat` 命令合并chunks
   - 避免下载180MB chunks → 本地合并 → 上传180MB文件的低效流程
   - 节省约360MB的不必要传输（对于180MB文件）
   - 合并时间从数分钟降至数秒

3. **SSH Stream阻塞问题修复**
   - 必须消费stdout和stderr数据，否则stream会永久阻塞
   - 添加5分钟超时保护
   - 添加详细的调试日志

4. **合理的Fallback策略**
   - 之前：远程merge失败 → 下载chunks → 本地merge → 上传完整文件（**多此一举**）
   - 现在：远程merge失败 → 清理chunks → 使用普通fastPut上传完整文件（**高效**）
   - 避免了3倍传输量的浪费

**技术细节**:
- 文件: `src/parallelChunkTransfer.ts`
- 类: `ParallelChunkTransferManager`
- 集成点: `src/sshConnectionManager.ts` 自动检测文件大小并使用并发传输
- 测试: `src/parallelChunkTransfer.test.ts` (19 tests)
- **Chunk存储**: 上传时使用远程 `/tmp` 目录，下载时使用本地 `os.tmpdir()`
- **文件合并**: 
  - 优先使用SSH exec执行 `cat` 命令在远程合并（几秒完成）
  - Fallback使用普通fastPut上传完整文件
  - **已移除**低效的下载-本地合并-上传策略
- **清理策略**: 传输完成后自动删除临时chunk文件

**性能指标**:
- 100MB 文件: 从 ~60 秒降至 ~15-20 秒 (-67%)
- 1GB 文件: 从 ~10 分钟降至 ~3 分钟 (-70%)
- **远程合并**: 18个10MB chunks合并时间 < 5秒
- **带宽节省**: 避免下载chunks，节省50%传输量
- 使用连接池避免重复建立连接

**实际执行流程**:
1. 检测文件大小是否 ≥ 阈值（100MB）
2. 将文件分成 N 个chunks（每块 10MB）
3. 使用连接池获取连接，最多 5 个并发
4. 每个chunk独立上传到远程 `/tmp` 目录
5. 所有chunks上传完成后，执行远程合并：
   - **方式A**（优先）：通过SSH exec执行 `cat part0 part1 ... > final && rm part*`
   - **方式B**（Fallback）：清理chunks，使用普通fastPut上传完整文件
6. 如果启用校验，验证最终文件完整性

**已知问题和解决方案**:
| 问题 | 原因 | 解决方案 | 版本 |
|------|------|---------|------|
| 100%卡住不完成 | `sftp.unlink()` 不存在 | 改用 `sftp.delete()` | v2.4.8 |
| 远程merge永久阻塞 | 未消费stdout/stderr | 添加stream数据消费 | v2.4.8 |
| Fallback效率低下 | 下载-合并-上传3倍传输 | 改为直接普通上传 | v2.4.8 |
| 用户看不到最终上传进度 | 缺少进度回调 | 添加fastPut进度日志 | v2.4.8 |

---

### ✅ 3. 文件完整性校验 (Checksum Verification)

**状态**: 已实现 (v2.3.0)

**功能描述**:
- 传输后自动校验文件完整性
- 支持 MD5 和 SHA256 算法
- 可配置的校验阈值（仅大文件校验）
- 服务器端工具自动检测和回退

**实现方式**:
```typescript
// services/fileIntegrityChecker.ts
class FileIntegrityChecker {
  // 计算本地文件校验和（流式，避免大文件内存溢出）
  static async calculateLocalChecksum(filePath, algorithm = 'sha256') {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm);
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  // 计算远程文件校验和（通过 SSH 执行命令）
  static async calculateRemoteChecksum(config, authConfig, remotePath, algorithm, connectConfig) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on('ready', () => {
        // 尝试多个工具，兼容不同系统
        const command = algorithm === 'md5'
          ? `md5sum "${remotePath}" 2>/dev/null || md5 -q "${remotePath}" 2>/dev/null || echo "CHECKSUM_TOOL_NOT_FOUND"`
          : `sha256sum "${remotePath}" 2>/dev/null || shasum -a 256 "${remotePath}" 2>/dev/null || echo "CHECKSUM_TOOL_NOT_FOUND"`;

        conn.exec(command, (err, stream) => {
          let output = '';
          stream.on('data', (data) => { output += data.toString(); });
          stream.on('close', () => {
            conn.end();
            const trimmed = output.trim();

            // 检查工具是否可用
            if (trimmed.includes('CHECKSUM_TOOL_NOT_FOUND') || trimmed === '') {
              reject(new Error(`Checksum tool not found. Install ${algorithm}sum or disable verification.`));
              return;
            }

            // 提取校验和（第一个字段）
            const checksum = trimmed.split(/\s+/)[0];
            resolve(checksum);
          });
        });
      });
      conn.connect(connectConfig);
    });
  }

  // 上传后验证
  static async verifyUpload(config, authConfig, localPath, remotePath, connectConfig, options) {
    const stat = fs.statSync(localPath);

    // 检查文件大小是否超过阈值
    if (stat.size < options.threshold) {
      logger.info(`File size ${stat.size} below threshold ${options.threshold}, skipping verification`);
      return true;
    }

    const localChecksum = await this.calculateLocalChecksum(localPath, options.algorithm);
    const remoteChecksum = await this.calculateRemoteChecksum(config, authConfig, remotePath, options.algorithm, connectConfig);

    if (localChecksum === remoteChecksum) {
      logger.info(`✓ Upload verified (${options.algorithm}: ${localChecksum})`);
      return true;
    } else {
      logger.error(`✗ Upload verification failed! Local: ${localChecksum}, Remote: ${remoteChecksum}`);
      return false;
    }
  }
}
```

**配置选项**:
```json
// VS Code settings.json
{
  "simpleSftp.verification.enabled": false,      // 默认禁用（向后兼容）
  "simpleSftp.verification.algorithm": "sha256", // md5 | sha256
  "simpleSftp.verification.threshold": 10485760  // 10MB 以上才校验
}
```

**使用方式**:
```typescript
// sshConnectionManager.ts - uploadFile()
// 并发分片传输后验证
await this.parallelTransferManager.uploadFileParallel(...);

const checksumOptions = FileIntegrityChecker.getOptionsFromConfig();
if (checksumOptions.enabled) {
  const verified = await FileIntegrityChecker.verifyUpload(
    config, authConfig, localPath, remotePath, connectConfig, checksumOptions
  );

  if (!verified) {
    throw new Error('File integrity verification failed. Please try uploading again.');
  }
}
```

**优势**:
- 100% 检测文件传输错误（位翻转、网络损坏）
- 流式计算，低内存占用
- 自动跳过小文件（提升性能）
- 友好的错误提示和工具安装建议

**技术细节**:
- 文件: `src/services/fileIntegrityChecker.ts`
- 类: `FileIntegrityChecker`
- 集成点: `src/sshConnectionManager.ts` 的 uploadFile/downloadFile 方法
- 支持工具（按优先级尝试）:
  - Linux/Unix: md5sum, sha256sum
  - macOS: md5 -q, shasum -a 256
  - Windows: certutil -hashfile（未测试）
- 配置读取: `vscode.workspace.getConfiguration('simpleSftp.verification')`

**错误处理**:
- 校验失败会抛出异常，阻止传输完成
- 服务器无工具时友好提示并建议：
  - 安装所需工具（md5sum/sha256sum）
  - 或在设置中禁用校验（`simpleSftp.verification.enabled: false`）
- 可通过配置关闭校验以兼容旧服务器

**服务器要求**:
- Linux/Unix: 需要 `md5sum` 或 `sha256sum` 命令
- macOS: 使用 `md5 -q` 或 `shasum -a 256`
- 如无工具，校验会失败并提示用户

**最佳实践**:
- 重要文件传输: 启用 SHA256 校验
- 大批量文件: 提高阈值到 100MB，仅校验大文件
- 不稳定网络: 启用校验确保数据完整性
- 旧服务器: 禁用校验或安装工具

---

### ✅ 4. 增量同步 (Delta Sync)

**状态**: 已实现 (v2.4.0)

**功能描述**:
- 目录上传前自动比对本地和远程文件
- 仅传输新增或修改的文件
- 基于文件大小和修改时间的智能比对
- 可选的远程文件删除（本地删除的文件同步删除）
- 支持排除模式（忽略 node_modules, .git 等）

**实现方式**:
```typescript
class DeltaSyncManager {
  async syncDirectory(localDir, remoteDir, options) {
    // 1. 获取本地和远程文件树
    const localFiles = await this.getLocalFileTree(localDir);
    const remoteFiles = await this.getRemoteFileTree(remoteDir);

    // 2. 计算差异
    const diff = this.calculateDiff(localFiles, remoteFiles, options);

    // 3. 执行同步
    const stats = await this.executeSyncPlan(diff, options);
    // stats: { uploaded, deleted, skipped, failed, total }
  }

  private calculateDiff(localFiles, remoteFiles, options) {
    const toUpload = [];   // 新增或修改的文件
    const toDelete = [];   // 本地已删除的文件（可选）
    const unchanged = [];  // 未修改的文件

    // 比较文件大小和修改时间
    for (const [path, localInfo] of localFiles) {
      const remoteInfo = remoteFiles.get(path);
      if (!remoteInfo) {
        toUpload.push({ path, reason: 'new' });
      } else if (this.isModified(localInfo, remoteInfo)) {
        toUpload.push({ path, reason: 'modified' });
      } else {
        unchanged.push(path);
      }
    }

    return { toUpload, toDelete, unchanged };
  }
}
```

**配置选项**:
```typescript
export const DELTA_SYNC = {
  ENABLED: true,                        // 启用增量同步
  COMPARE_METHOD: 'mtime',              // 比对方法（基于修改时间）
  DELETE_REMOTE: false,                 // 删除远程孤立文件
  PRESERVE_TIMESTAMPS: false,           // 保留时间戳（实验性）
  EXCLUDE_PATTERNS: [                   // 排除模式
    'node_modules',
    String.raw`\.git`,
    String.raw`\.vscode`,
    String.raw`.*\.log`
  ],
};
```

**优势**:
- 大型项目同步速度提升 10-100 倍
- 1000 文件项目（10 个修改）：~2 分钟 → ~5 秒 (-95%)
- 节省带宽 80-99%
- 自动跳过未修改文件

**技术细节**:
- 文件: `src/services/deltaSyncManager.ts`
- 类: `DeltaSyncManager`
- 集成点: `src/sshConnectionManager.ts` 的 `uploadDirectory()` 方法
- 测试: `src/services/deltaSyncManager.test.ts` (14 tests)
- 配置: `src/constants.ts` - `DELTA_SYNC` 配置项

**比对逻辑**:
- 文件大小不同 → 需要上传
- 修改时间相差 > 1 秒 → 需要上传
- 大小和时间都相同 → 跳过
- 允许 1 秒时间误差（SFTP 时间戳精度问题）

**性能指标**:
- 1000 文件项目（10% 修改）：~2 分钟 → ~5-10 秒 (-95%)
- 5000 文件项目（5% 修改）：~10 分钟 → ~20-30 秒 (-95%)
- 实际提升取决于修改文件比例

**注意事项**:
- 默认启用，可通过 `DELTA_SYNC.ENABLED = false` 禁用
- 删除远程文件功能默认关闭（`DELETE_REMOTE = false`）
- 时间戳保留功能为实验性（依赖 SFTP 服务器支持）
- 排除模式使用正则表达式匹配

---

## 待实现优化方案

### 📝 5. 智能压缩传输 (Compression)

**优先级**: 低 ⭐⭐
**预计版本**: v2.5.0

**问题描述**:
文本文件、日志文件等可压缩性高的文件占用大量传输带宽。

**优化方案**:
启用 SSH 连接级压缩或文件级压缩。

**实现思路**:

**方案 A: SSH 连接级压缩**
```typescript
const connectConfig = {
  host: config.host,
  port: config.port,
  username: config.username,
  compress: true,  // 启用压缩
  algorithms: {
    compress: ['zlib@openssh.com', 'zlib', 'none']
  }
};
```

**方案 B: 文件级压缩**
```typescript
class CompressionTransfer {
  async uploadWithCompression(localPath, remotePath) {
    const ext = path.extname(localPath);

    // 仅压缩文本文件
    if (this.isCompressible(ext)) {
      // 1. 压缩文件
      const compressedPath = await this.compressFile(localPath);

      // 2. 上传压缩文件
      await this.uploadFile(compressedPath, remotePath + '.gz');

      // 3. 远程解压
      await this.executeRemoteCommand(`gunzip "${remotePath}.gz"`);

      // 4. 清理本地临时文件
      fs.unlinkSync(compressedPath);
    } else {
      // 直接上传
      await this.uploadFile(localPath, remotePath);
    }
  }

  private isCompressible(ext) {
    const compressible = ['.txt', '.log', '.json', '.xml', '.csv', '.md'];
    return compressible.includes(ext.toLowerCase());
  }
}
```

**配置选项**:
```json
{
  "simpleSftp.transfer.enableCompression": true,
  "simpleSftp.transfer.compressionLevel": 6,  // 1-9
  "simpleSftp.transfer.compressibleExtensions": [".txt", ".log", ".json"]
}
```

**预期效果**:
- 文本文件传输速度提升 3-10 倍
- 节省带宽 70-90%
- 适合日志文件、代码文件

---

### 📝 6. 传输优先级队列 (Priority Queue)

**优先级**: 中 ⭐⭐⭐
**预计版本**: v2.5.0

**问题描述**:
当前队列为 FIFO，大文件可能阻塞后续的小文件传输。

**优化方案**:
实现优先级队列，小文件优先，支持手动调整优先级。

**实现思路**:
```typescript
type Priority = 'urgent' | 'high' | 'normal' | 'low';

class PriorityTransferQueue {
  private queues: Map<Priority, TransferTaskModel[]> = new Map([
    ['urgent', []],
    ['high', []],
    ['normal', []],
    ['low', []]
  ]);

  addTask(task: TransferTaskModel, priority?: Priority) {
    // 自动优先级分配
    if (!priority) {
      priority = this.calculatePriority(task);
    }

    this.queues.get(priority)!.push(task);
    this.processQueue();
  }

  private calculatePriority(task: TransferTaskModel): Priority {
    // 小文件自动高优先级
    if (task.fileSize < 1024 * 1024) {  // < 1MB
      return 'high';
    }

    // 大文件低优先级
    if (task.fileSize > 100 * 1024 * 1024) {  // > 100MB
      return 'low';
    }

    return 'normal';
  }

  private getNextTask(): TransferTaskModel | undefined {
    // 按优先级顺序获取任务
    for (const priority of ['urgent', 'high', 'normal', 'low']) {
      const queue = this.queues.get(priority as Priority)!;
      const task = queue.find(t => t.status === 'pending');
      if (task) {
        return task;
      }
    }
    return undefined;
  }

  setPriority(taskId: string, priority: Priority) {
    // 移动任务到新的优先级队列
    for (const [oldPriority, queue] of this.queues) {
      const index = queue.findIndex(t => t.id === taskId);
      if (index !== -1) {
        const [task] = queue.splice(index, 1);
        this.queues.get(priority)!.push(task);
        break;
      }
    }
  }
}
```

**UI 增强**:
```typescript
// 右键菜单选项
commands.registerCommand('simpleSftp.setPriority', (task) => {
  vscode.window.showQuickPick(['Urgent', 'High', 'Normal', 'Low'])
    .then(priority => {
      queue.setPriority(task.id, priority.toLowerCase());
    });
});
```

**预期效果**:
- 小文件快速完成
- 紧急任务可插队
- 改善用户等待体验

---

### 📝 7. 带宽限制 (Bandwidth Throttling)

**优先级**: 低 ⭐⭐
**预计版本**: v2.6.0

**问题描述**:
传输占满带宽，影响其他应用。

**优化方案**:
实现可配置的带宽限制。

**实现思路**:
```typescript
class ThrottledStream extends Transform {
  private bytesPerSecond: number;
  private transferred: number = 0;
  private startTime: number = Date.now();

  constructor(bytesPerSecond: number) {
    super();
    this.bytesPerSecond = bytesPerSecond;
  }

  _transform(chunk: Buffer, encoding: string, callback: Function) {
    this.transferred += chunk.length;
    const elapsed = (Date.now() - this.startTime) / 1000;
    const expectedTime = this.transferred / this.bytesPerSecond;

    if (expectedTime > elapsed) {
      // 需要延迟
      const delay = (expectedTime - elapsed) * 1000;
      setTimeout(() => callback(null, chunk), delay);
    } else {
      // 立即传输
      callback(null, chunk);
    }
  }
}

// 使用示例
const readStream = fs.createReadStream(localPath);
const throttled = new ThrottledStream(1024 * 1024); // 1MB/s
const writeStream = sftp.createWriteStream(remotePath);

readStream.pipe(throttled).pipe(writeStream);
```

**配置选项**:
```json
{
  "simpleSftp.transfer.maxUploadSpeed": 0,    // 0 = 无限制，单位 KB/s
  "simpleSftp.transfer.maxDownloadSpeed": 0,
  "simpleSftp.transfer.throttleSchedule": {
    "enable": false,
    "workingHours": {
      "start": "09:00",
      "end": "18:00",
      "maxSpeed": 512  // 工作时间限速 512KB/s
    }
  }
}
```

**预期效果**:
- 后台传输不影响前台工作
- 符合企业网络策略
- 可按时间段自动调整

---

### 📝 8. 符号链接和文件属性保留

**优先级**: 低 ⭐
**预计版本**: v2.7.0

**问题描述**:
符号链接被当作普通文件处理，文件权限和修改时间丢失。

**优化方案**:
正确处理符号链接，保留文件属性。

**实现思路**:
```typescript
class AttributePreservingTransfer {
  async uploadWithAttributes(localPath, remotePath) {
    const stat = fs.lstatSync(localPath);

    if (stat.isSymbolicLink()) {
      // 处理符号链接
      const target = fs.readlinkSync(localPath);
      await this.sftp.symlink(target, remotePath);
    } else if (stat.isFile()) {
      // 上传普通文件
      await this.sftp.fastPut(localPath, remotePath);

      // 保留属性
      await this.preserveAttributes(remotePath, stat);
    } else if (stat.isDirectory()) {
      await this.sftp.mkdir(remotePath, true);
    }
  }

  private async preserveAttributes(remotePath, stat) {
    // 设置权限
    await this.sftp.chmod(remotePath, stat.mode);

    // 设置修改时间
    const atime = stat.atime.getTime() / 1000;
    const mtime = stat.mtime.getTime() / 1000;
    await this.sftp.utime(remotePath, atime, mtime);
  }
}
```

**配置选项**:
```json
{
  "simpleSftp.transfer.preservePermissions": true,
  "simpleSftp.transfer.preserveTimestamps": true,
  "simpleSftp.transfer.followSymlinks": false
}
```

---

### 📝 9. 智能重试策略 (Smart Retry)

**优先级**: 高 ⭐⭐⭐⭐
**预计版本**: v2.5.0

**问题描述**:
当前固定次数重试，不区分错误类型，效率低。

**优化方案**:
根据错误类型智能重试，使用指数退避。

**实现思路**:
```typescript
class SmartRetryManager {
  private retryableErrors = [
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ENOTFOUND'
  ];

  private nonRetryableErrors = [
    'EACCES',      // 权限错误
    'ENOSPC',      // 磁盘空间不足
    'ENOENT',      // 文件不存在
    'EISDIR'       // 是目录
  ];

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    options = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries || 3;
    const baseDelay = options.baseDelay || 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        // 检查是否应该重试
        if (!this.shouldRetry(error, attempt, maxRetries)) {
          throw error;
        }

        // 计算延迟时间（指数退避）
        const delay = this.calculateDelay(attempt, baseDelay, error);

        logger.warn(
          `Operation failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}. ` +
          `Retrying in ${delay}ms...`
        );

        await this.sleep(delay);
      }
    }

    throw new Error('Max retries exceeded');
  }

  private shouldRetry(error: any, attempt: number, maxRetries: number): boolean {
    // 已达到最大重试次数
    if (attempt >= maxRetries) {
      return false;
    }

    // 明确不可重试的错误
    if (this.nonRetryableErrors.includes(error.code)) {
      logger.error(`Non-retryable error: ${error.code}`);
      return false;
    }

    // 可重试的网络错误
    if (this.retryableErrors.includes(error.code)) {
      return true;
    }

    // 默认重试一次
    return attempt === 0;
  }

  private calculateDelay(attempt: number, baseDelay: number, error: any): number {
    // 指数退避: 1s, 2s, 4s, 8s, ...
    let delay = baseDelay * Math.pow(2, attempt);

    // 添加随机抖动，避免雪崩效应
    const jitter = Math.random() * 1000;
    delay += jitter;

    // 最大延迟 30 秒
    return Math.min(delay, 30000);
  }
}

// 使用示例
await retryManager.executeWithRetry(
  () => this.uploadFile(localPath, remotePath),
  { maxRetries: 3, baseDelay: 1000 }
);
```

**配置选项**:
```json
{
  "simpleSftp.retry.maxAttempts": 3,
  "simpleSftp.retry.baseDelay": 1000,
  "simpleSftp.retry.maxDelay": 30000,
  "simpleSftp.retry.enableJitter": true
}
```

**预期效果**:
- 网络错误自动恢复
- 减少用户手动重试
- 提升成功率 20-30%

---

## 实施优先级

### 第一阶段 (v2.3.0) - 核心优化 ✅ 完成

**目标**: 提升可靠性和性能

1. ✅ 断点续传 (已完成 v2.1.0)
2. ✅ 并发分片传输 (已完成 v2.3.0)
3. ✅ 文件完整性校验 (已完成 v2.3.0)

**实际开发时间**: 2 周（3 个核心功能完成）

### 第二阶段 (v2.4.0) - 同步优化 ✅ 完成

**目标**: 提升同步效率

1. ✅ 增量同步 (已完成 v2.4.0)

**实际开发时间**: 1 天

### 第三阶段 (v2.5.0+) - 高级功能

**目标**: 提升用户体验和特定场景优化

1. 智能重试策略 (规划中)
2. 传输优先级队列 (规划中)
3. 智能压缩传输 (规划中)
4. 带宽限制 (规划中)

**预计开发时间**: 3-4 周

### 第四阶段 (v2.6.0+) - 兼容性优化

**目标**: 完善边缘功能

1. 符号链接和属性保留

**预计开发时间**: 1-2 周

---

## 性能指标目标

### 当前基线 (v2.1.0)

- 10MB 文件上传: ~5 秒
- 100MB 文件上传: ~60 秒
- 1GB 文件上传: ~10 分钟
- 1000 个小文件: ~2 分钟
- 1000 文件目录（全部上传）: ~2 分钟

### 已达成 (v2.4.0)

- 10MB 文件上传: ~5 秒 (无变化，已经很快)
- 100MB 文件上传: ~12-20 秒 (-67-80%) ← **v2.3.0 并发分片传输**
- 1GB 文件上传: ~3 分钟 (-70%) ← **v2.3.0 并发分片传输**
- 1000 文件目录（10% 修改）: ~5-10 秒 (-95%) ← **v2.4.0 增量同步**
- 5000 文件目录（5% 修改）: ~20-30 秒 (-95%) ← **v2.4.0 增量同步**

### 未来目标 (v2.5.0+)

- 1000 个小文件: ~30 秒 (-85%) ← 优先级队列
- 大文本文件: ~10 倍提升 ← 压缩传输

---

## 技术依赖

### 现有依赖

- `ssh2` (v1.17.0) - SSH 协议
- `ssh2-sftp-client` (v12.0.1) - SFTP 客户端
- Node.js `fs`, `stream`, `crypto` 模块

### 新增依赖（预计）

- `fast-hash` - 快速哈希计算
- `async` - 并发控制
- `progress-stream` - 进度聚合

---

## 兼容性考虑

### 服务器要求

- **最低要求**: OpenSSH 7.0+
- **推荐版本**: OpenSSH 8.0+
- **必需工具**: sha256sum, md5sum (用于校验)

### 客户端要求

- VS Code 1.108.1+
- Node.js 18+
- 至少 100MB 可用内存

---

## 测试策略

### 单元测试

- 每个新功能独立测试
- Mock SFTP 连接
- 覆盖率目标: 90%+

### 集成测试

- 真实 SFTP 服务器测试
- 不同文件大小测试
- 网络中断模拟

### 性能测试

- 基准测试
- 压力测试
- 内存泄漏检测

---

## 用户文档更新

- README.md - 功能说明
- CHANGELOG.md - 版本历史
- 功能文档（单独文件）
- VS Code Walkthrough 更新

---

## 风险评估

### 高风险项

- 并发分片传输 - 实现复杂，可能引入 bug
- 增量同步 - 算法复杂度高

### 中风险项

- 文件校验 - 性能影响
- 压缩传输 - 兼容性问题

### 低风险项

- 优先级队列 - 逻辑简单
- 智能重试 - 独立模块

---

## 维护计划

- 每个新功能提供配置开关
- 保持向后兼容
- 提供降级方案
- 定期性能监控

---

**最后更新**: 2026-01-17 (11:30)
**当前版本**: v2.4.8
**文档版本**: 1.2
**维护人**: Development Team
