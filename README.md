# Simple SFTP

> [English](#simple-sftp---english) | [中文说明](#simple-sftp---中文说明)

A lightweight VS Code extension for uploading and downloading files to/from remote hosts via SFTP with cross-device host configuration synchronization.

---

## Simple SFTP - English

> [English](#simple-sftp---english) | [中文说明](#simple-sftp---中文说明)

A lightweight VS Code extension for uploading and downloading files to/from remote hosts via SFTP with cross-device host configuration synchronization.

### Support This Project

If you find this extension helpful, consider buying me a coffee!

<img src="resources/wechat-pay.jpg" alt="WeChat Pay" width="200"/>

### Features

#### File Management
- **Dual-Panel File Browser**: Visual interface with side-by-side local and remote file views
  - **Breadcrumb Navigation**: Clickable path segments for quick directory navigation
    - Click any path segment to jump to that directory
    - Intelligent overflow handling - shows trailing paths first
    - Supports Windows (C:\) and Unix (/) path formats
  - **File Permissions**: Display and edit Unix-style permissions for remote files
    - Permission column shows rwx format (e.g., `rwxr-xr-x`)
    - Right-click context menu to change permissions
    - Supports octal (755) and symbolic (rwxr-xr-x) input formats
  - **Keyboard Shortcuts**:
    - Ctrl+A (Cmd+A on Mac): Select all visible items in current panel
  - Real-time search/filter files
  - Quick upload/download with click buttons
  - Panel or Editor area display modes
  - Support multiple browser instances (Editor mode)
- **Quick Upload/Download**: Upload or download files directly from Explorer or Editor
- **Path Bookmarks**: Save and quickly access frequently used remote directories
  - Click remote path area to toggle bookmark dropdown
  - Add bookmarks from context menu (files, folders, or empty area)
  - Quick navigation to saved remote directories

#### Host Management
- **TreeView Interface**: Organize hosts with groups and color coding
- **SSH Config Import**: Import existing configurations from ~/.ssh/config
- **Import/Export**: Backup or share host configurations via JSON files
- **Cross-Device Sync**: Host configurations automatically sync via VS Code Settings Sync

#### Authentication
- **Multiple Methods**: Password, Private Key, or SSH Agent
- **Secure Storage**: Credentials stored locally (never synced)
- **Passwordless Setup**: Auto-configure SSH key-based authentication
- **Windows SSH Agent**: Native support via named pipes

#### Transfer Management
- **Transfer Queue**: Visual task management with real-time progress
  - Pause, resume, or cancel transfers
  - Auto-retry failed transfers
  - Transfer history with statistics
  - Priority-based queue (small files first)
- **Advanced Features**:
  - **File Comparison**: Compare any two files via context menu
  - Parallel chunk transfer for large files (100MB+)
  - File integrity verification (MD5/SHA256)
  - Preserve file permissions and timestamps
  - Smart host selection (recently used first)

#### Performance
- **SSH Connection Pool**: 5-10x faster with automatic connection reuse
- **Parallel Transfers**: Up to 5 concurrent file transfers
- **Large File Optimization**: Automatic chunked transfer for files over 100MB

### Getting Started

#### Add a New Host

1. Open the Simple SFTP panel in the Activity Bar
2. Click the "+" icon in the toolbar
3. Follow the prompts to enter:
   - Host name (display name)
   - Hostname or IP address
   - Port (default: 22)
   - Username
   - Default remote path
   - Optional: Group and color

#### Import from SSH Config

1. Click the cloud download icon in the toolbar
2. Select hosts to import from your ~/.ssh/config
3. Choose a group or create a new one
4. Imported hosts will appear in the TreeView

#### Import and Export Hosts

##### Export Hosts

Export your host configurations to a JSON file for backup or sharing:

- **Export All Hosts**: Click the export icon in the toolbar or use Command Palette → "Simple SFTP: Export All Hosts"
- **Export Group**: Right-click a group → "Export Group"
- **Export Single Host**: Right-click a host → "Export Host"

The exported JSON file contains:
- Host configurations (name, address, port, username, paths, colors, etc.)
- Group information
- Bookmarks and recent paths
- **Note**: Authentication credentials (passwords, private keys) are **not** exported for security reasons

##### Import Hosts

Import host configurations from a JSON file:

1. Click "Import Hosts" in the toolbar or use Command Palette → "Simple SFTP: Import Hosts"
2. Select the JSON file to import
3. Review the import preview showing new and duplicate hosts
4. Confirm to import

**Import Behavior**:
- **New hosts**: Automatically imported
- **Duplicate hosts** (same `username@host:port`): Automatically skipped
- **Groups**: Existing groups are merged; new groups are created
- **Authentication**: Must be configured separately after import

#### Configure Authentication

##### Option 1: Configure Manually

1. Right-click a host in the TreeView
2. Select "Configure Authentication"
3. Choose authentication method:
   - Password
   - Private Key (with optional passphrase)
   - SSH Agent

##### Option 2: Setup Passwordless Login

1. Right-click a host
2. Select "Setup Passwordless Login"
3. Enter your password when prompted
4. The extension will automatically copy your SSH public key to the remote host

#### Upload Files

##### From Explorer or Editor

1. Right-click any file or folder in Explorer or right-click in the editor
2. Select "Upload to Remote Host"
3. Choose the destination host (recently used hosts appear first)
4. Browse and select the remote directory
5. Use upload buttons on directory items for quick upload

##### Smart Host Selection
- Hosts you've recently uploaded to or downloaded from appear at the top
- Easy to reuse the same hosts for common workflows
- Authentication status clearly indicated for each host

#### Download Files

##### Method 1: Download from Sidebar (Custom Location)

1. Right-click a host in the TreeView
2. Select "Download from Remote Host"
3. Browse remote directories with smart path navigation
4. Click download buttons on files/directories for quick download
5. Toggle dot files visibility as needed
6. Choose where to save the downloaded files

##### Method 2: Download to Current Folder (Quick Download)

1. Right-click any file or folder in Explorer
2. Select "Download from Remote Host to Here"
3. Choose the source host (recently used hosts appear first)
4. Browse and select remote files/folders
5. Files download directly to the selected local folder

Both methods support:

- Downloading individual files or entire directories
- Smart path navigation with input box
- Recently used hosts for quick access
- Real-time progress tracking

#### Edit Host Configuration

1. Right-click a host in the TreeView
2. Select "Edit Host"
3. Update hostname, port, or other settings

#### Test Connection

1. Right-click a host
2. Select "Test Connection"
3. View the result in a notification

### Requirements

- VS Code 1.108.0 or higher
- SSH access to remote hosts
- For passwordless setup: SSH key pair (~/.ssh/id_rsa or similar)

### Command Palette

The following commands are available in the Command Palette (Ctrl/Cmd+Shift+P):

- **Simple SFTP: Add Host** - Add a new remote host
- **Simple SFTP: Add Group** - Create a host group
- **Simple SFTP: Import from SSH Config** - Import from ~/.ssh/config
- **Simple SFTP: Show Output Logs** - Open the log viewer

Additional commands are available via context menus in the TreeView and file explorers.

### Settings

Configure Simple SFTP in VS Code Settings (Ctrl/Cmd+,):

#### File Browser

- **simpleSftp.showDotFiles** (boolean, default: `true`)
  Show hidden files and directories (dot files) in remote file browser

- **simpleSftp.browser.openInEditor** (boolean, default: `false`)
  Open file browser in editor area instead of panel. When enabled, supports multiple browser instances for different hosts.

#### Transfer Queue

- **simpleSftp.transferQueue.maxConcurrent** (number, default: `2`, range: 1-10)
  Maximum number of concurrent file transfers

- **simpleSftp.transferQueue.autoRetry** (boolean, default: `true`)
  Automatically retry failed transfers

- **simpleSftp.transferQueue.maxRetries** (number, default: `3`, range: 0-10)
  Maximum retry attempts for failed transfers

- **simpleSftp.transferQueue.retryDelay** (number, default: `2000`, range: 1000-60000)
  Delay between retry attempts (milliseconds)

- **simpleSftp.transferQueue.showNotifications** (boolean, default: `true`)
  Show notifications for transfer completion

- **simpleSftp.transferQueue.historySize** (number, default: `100`, range: 10-1000)
  Maximum number of transfer history records to keep

#### File Verification

- **simpleSftp.verification.enabled** (boolean, default: `false`)
  Verify file integrity after transfer using checksum. Requires md5sum/sha256sum on remote server.

- **simpleSftp.verification.algorithm** (enum: `md5`|`sha256`, default: `sha256`)
  Checksum algorithm (MD5: faster, SHA256: more secure)

- **simpleSftp.verification.threshold** (number, default: `10`, minimum: 0)
  Minimum file size (MB) for verification. Set to 0 to verify all files.

#### File Transfer

- **simpleSftp.transfer.preservePermissions** (boolean, default: `true`)
  Preserve file permissions (chmod) during transfers

- **simpleSftp.transfer.preserveTimestamps** (boolean, default: `true`)
  Preserve file modification and access times

- **simpleSftp.transfer.followSymlinks** (boolean, default: `false`)
  Follow symbolic links instead of preserving them

#### Parallel Transfer (Large Files)

- **simpleSftp.parallelTransfer.enabled** (boolean, default: `true`)
  Enable parallel chunk-based transfer for large files

- **simpleSftp.parallelTransfer.threshold** (number, default: `100`, minimum: 10)
  Minimum file size (MB) to trigger parallel transfer

- **simpleSftp.parallelTransfer.chunkSize** (number, default: `10`, range: 1-50)
  Size of each chunk in parallel transfer (MB)

- **simpleSftp.parallelTransfer.maxConcurrent** (number, default: `5`, range: 1-10)
  Maximum number of concurrent chunk transfers

#### UI

- **simpleSftp.ui.hideStatusBar** (boolean, default: `false`)
  Hide the transfer status bar

- **simpleSftp.speedUnit** (enum: `auto`|`KB`|`MB`, default: `auto`)
  Download speed display unit

### Security Notes

- **Host configurations** (names, addresses, ports, groups) are synced across devices via VS Code Settings Sync
- **Authentication credentials** (passwords, private keys, passphrases) are stored locally only using VS Code's SecretStorage
- Credentials are **never** synced across devices for security
- Each device requires separate authentication configuration
- Sync is handled automatically by VS Code when Settings Sync is enabled

### Known Limitations

- Folder upload uploads files individually (not as archive)
- Symbolic links are followed during upload
- File permissions are preserved when possible

### Troubleshooting

#### Connection Issues
1. Use "Test Connection" to verify credentials
2. Check "Simple SFTP: Show Output Logs" for detailed error messages
3. Verify SSH access works from terminal: `ssh user@host -p port`

#### Windows SSH Agent
- Ensure OpenSSH Authentication Agent service is running
- Start service: `Start-Service ssh-agent` in PowerShell (Administrator)

#### Import Issues
- Verify ~/.ssh/config file exists and is readable
- Check config file syntax is valid

### Release Notes

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

### Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Package extension
npm run package

# Publish to marketplace
npm run publish
```

### License

See [LICENSE](LICENSE) file for details.

### Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

### Links

- [GitHub Repository](https://github.com/iwangbowen/simple-sftp)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=WangBowen.simple-sftp)
- [Report Issues](https://github.com/iwangbowen/simple-sftp/issues)

---

## Simple SFTP - 中文说明

> [English](#simple-sftp) | [中文说明](#simple-sftp---中文说明)

一个轻量级的 VS Code 扩展，支持通过 SFTP 上传/下载文件到远程主机，并支持跨设备主机配置同步。

### 支持本项目

如果你觉得这个扩展有帮助，可以请我喝杯咖啡！

<img src="resources/wechat-pay.jpg" alt="微信支付" width="200"/>

### 功能特性

#### 文件管理

- **双面板文件浏览器**: 本地和远程文件系统并列可视化界面
  - **面包屑导航**: 可点击的路径段，快速跳转目录
    - 点击任意路径段跳转到对应目录
    - 智能溢出处理 - 优先显示最后的路径段
    - 支持 Windows (C:\) 和 Unix (/) 路径格式
  - **文件权限**: 显示和编辑远程文件的 Unix 风格权限
    - 权限列显示 rwx 格式（如 `rwxr-xr-x`）
    - 右键菜单修改文件权限
    - 支持八进制（755）和符号（rwxr-xr-x）输入格式
  - **键盘快捷键**:
    - Ctrl+A（Mac 上为 Cmd+A）：选中当前面板所有可见项
  - 实时搜索/过滤文件
  - 点击按钮快速上传/下载
  - Panel 或 Editor 区域显示模式
  - 支持多个浏览器实例(Editor 模式)
- **快速上传/下载**: 直接从资源管理器或编辑器上传或下载文件
- **路径书签**: 保存并快速访问常用的远程目录
  - 点击远程路径区域切换书签下拉菜单
  - 从上下文菜单添加书签（文件、文件夹或空白区域）
  - 快速导航到保存的远程目录

#### 主机管理

- **树形视图界面**: 使用分组和颜色编码组织主机
- **SSH 配置导入**: 从 ~/.ssh/config 导入现有配置
- **导入/导出**: 通过 JSON 文件备份或共享主机配置
- **跨设备同步**: 主机配置通过 VS Code 设置同步自动同步

#### 认证方式

- **多种方法**: 密码、私钥或 SSH Agent
- **安全存储**: 凭据本地存储(永不同步)
- **免密码设置**: 自动配置基于 SSH 密钥的认证
- **Windows SSH Agent**: 通过命名管道原生支持

#### 传输管理

- **传输队列**: 可视化任务管理,实时进度显示
  - 暂停、恢复或取消传输
  - 自动重试失败的传输
  - 传输历史与统计
  - 基于优先级的队列(小文件优先)
- **高级功能**:
  - 大文件(100MB+)并行分块传输
  - 文件完整性验证(MD5/SHA256)
  - 保留文件权限和时间戳
  - 智能主机选择(最近使用的优先)

#### 性能优化

- **SSH 连接池**: 自动连接复用,速度提升 5-10 倍
- **并行传输**: 最多 5 个并发文件传输
- **大文件优化**: 超过 100MB 的文件自动分块传输

### 快速开始

#### 添加新主机

1. 在活动栏中打开 Simple SFTP 面板
2. 点击工具栏中的 "+" 图标
3. 按提示输入：
   - 主机名称（显示名称）
   - 主机名或 IP 地址
   - 端口（默认：22）
   - 用户名
   - 默认远程路径
   - 可选：分组和颜色

#### 从 SSH 配置导入

1. 点击工具栏中的云下载图标
2. 从 ~/.ssh/config 中选择要导入的主机
3. 选择一个分组或创建新分组
4. 导入的主机将出现在树形视图中

#### 导入和导出主机

##### 导出主机

将主机配置导出为 JSON 文件，用于备份或分享：

- **导出所有主机**：点击工具栏中的导出图标，或使用命令面板 → "Simple SFTP: Export All Hosts"
- **导出分组**：右键点击分组 → "Export Group"
- **导出单个主机**：右键点击主机 → "Export Host"

导出的 JSON 文件包含：
- 主机配置（名称、地址、端口、用户名、路径、颜色等）
- 分组信息
- 书签和最近使用的路径
- **注意**：出于安全考虑，认证凭据（密码、私钥）**不会**被导出

##### 导入主机

从 JSON 文件导入主机配置：

1. 点击工具栏中的"Import Hosts"，或使用命令面板 → "Simple SFTP: Import Hosts"
2. 选择要导入的 JSON 文件
3. 查看导入预览，显示新增和重复的主机
4. 确认导入

**导入行为**：
- **新主机**：自动导入
- **重复主机**（相同的 `username@host:port`）：自动跳过
- **分组**：现有分组自动合并；新分组会被创建
- **认证**：导入后需要单独配置认证

#### 配置认证

##### 方式 1：手动配置

1. 在树形视图中右键点击主机
2. 选择 "Configure Authentication"
3. 选择认证方法：
   - 密码
   - 私钥（可选密码短语）
   - SSH Agent

##### 方式 2：设置免密码登录

1. 右键点击主机
2. 选择 "Setup Passwordless Login"
3. 提示时输入密码
4. 扩展将自动将 SSH 公钥复制到远程主机

#### 上传文件

##### 从资源管理器或编辑器

1. 在资源管理器中右键点击任意文件或文件夹，或在编辑器中右键点击
2. 选择 "Upload to Remote Host"
3. 选择目标主机（最近使用的主机优先显示）
4. 浏览并选择远程目录
5. 使用目录项上的上传按钮快速上传

##### 智能主机选择

- 最近上传或下载过的主机显示在顶部
- 便于在常见工作流中重复使用相同主机
- 每个主机的认证状态清晰显示

#### 下载文件

##### 方法 1：从侧边栏下载（自定义位置）

1. 在树形视图中右键点击主机
2. 选择 "Download from Remote Host"
3. 使用智能路径导航浏览远程目录
4. 点击文件/目录上的下载按钮快速下载
5. 根据需要切换点文件可见性
6. 选择下载文件的保存位置

##### 方法 2：下载到当前文件夹（快速下载）

1. 在资源管理器中右键点击任意文件或文件夹
2. 选择 "Download from Remote Host to Here"
3. 选择源主机（最近使用的主机优先显示）
4. 浏览并选择远程文件/文件夹
5. 文件直接下载到选中的本地文件夹

两种方法都支持：

- 下载单个文件或整个目录
- 带输入框的智能路径导航
- 最近使用的主机快速访问
- 实时进度跟踪

#### 编辑主机配置

1. 在树形视图中右键点击主机
2. 选择 "Edit Host"
3. 更新主机名、端口或其他设置

#### 测试连接

1. 右键点击主机
2. 选择 "Test Connection"
3. 在通知中查看结果

### 系统要求

- VS Code 1.108.0 或更高版本
- 远程主机的 SSH 访问权限
- 免密码设置需要：SSH 密钥对（~/.ssh/id_rsa 或类似）

### 命令面板

在命令面板中可用以下命令（Ctrl/Cmd+Shift+P）：

- **Simple SFTP: Add Host** - 添加新的远程主机
- **Simple SFTP: Add Group** - 创建主机分组
- **Simple SFTP: Import from SSH Config** - 从 ~/.ssh/config 导入
- **Simple SFTP: Show Output Logs** - 打开日志查看器

其他命令可通过树形视图和文件资源管理器的右键菜单访问。

### 设置

在 VS Code 设置(Ctrl/Cmd+,)中配置 Simple SFTP:

#### 文件浏览器

- **simpleSftp.showDotFiles** (布尔值,默认: `true`)
  在远程文件浏览器中显示隐藏文件和目录(点文件)

- **simpleSftp.browser.openInEditor** (布尔值,默认: `false`)
  在编辑器区域而不是面板中打开文件浏览器。启用后,支持为不同主机打开多个浏览器实例。

#### 传输队列

- **simpleSftp.transferQueue.maxConcurrent** (数字,默认: `2`,范围: 1-10)
  最大并发文件传输数

- **simpleSftp.transferQueue.autoRetry** (布尔值,默认: `true`)
  自动重试失败的传输

- **simpleSftp.transferQueue.maxRetries** (数字,默认: `3`,范围: 0-10)
  失败传输的最大重试次数

- **simpleSftp.transferQueue.retryDelay** (数字,默认: `2000`,范围: 1000-60000)
  重试之间的延迟(毫秒)

- **simpleSftp.transferQueue.showNotifications** (布尔值,默认: `true`)
  显示传输完成通知

- **simpleSftp.transferQueue.historySize** (数字,默认: `100`,范围: 10-1000)
  保留的传输历史记录最大数量

#### 文件验证

- **simpleSftp.verification.enabled** (布尔值,默认: `false`)
  传输后使用校验和验证文件完整性。需要远程服务器上有 md5sum/sha256sum。

- **simpleSftp.verification.algorithm** (枚举: `md5`|`sha256`,默认: `sha256`)
  校验和算法(MD5: 更快,SHA256: 更安全)

- **simpleSftp.verification.threshold** (数字,默认: `10`,最小值: 0)
  验证的最小文件大小(MB)。设置为 0 验证所有文件。

#### 文件传输

- **simpleSftp.transfer.preservePermissions** (布尔值,默认: `true`)
  传输期间保留文件权限(chmod)

- **simpleSftp.transfer.preserveTimestamps** (布尔值,默认: `true`)
  保留文件修改和访问时间

- **simpleSftp.transfer.followSymlinks** (布尔值,默认: `false`)
  跟随符号链接而不是保留它们

#### 并行传输(大文件)

- **simpleSftp.parallelTransfer.enabled** (布尔值,默认: `true`)
  为大文件启用基于并行分块的传输

- **simpleSftp.parallelTransfer.threshold** (数字,默认: `100`,最小值: 10)
  触发并行传输的最小文件大小(MB)

- **simpleSftp.parallelTransfer.chunkSize** (数字,默认: `10`,范围: 1-50)
  并行传输中每个分块的大小(MB)

- **simpleSftp.parallelTransfer.maxConcurrent** (数字,默认: `5`,范围: 1-10)
  最大并发分块传输数

#### UI

- **simpleSftp.ui.hideStatusBar** (布尔值,默认: `false`)
  隐藏传输状态栏

- **simpleSftp.speedUnit** (枚举: `auto`|`KB`|`MB`,默认: `auto`)
  下载速度显示单位

### 安全说明

- **主机配置**（名称、地址、端口、分组）通过 VS Code 设置同步在设备间同步
- **认证凭据**（密码、私钥、密码短语）仅使用 VS Code 的 SecretStorage 本地存储
- 凭据**永远不会**在设备间同步，确保安全
- 每个设备需要单独配置认证
- 启用设置同步后，同步由 VS Code 自动处理

### 已知限制

- 文件夹上传是逐个上传文件（不是打包上传）
- 上传时会跟随符号链接
- 尽可能保留文件权限

### 故障排查

#### 连接问题

1. 使用 "Test Connection" 验证凭据
2. 查看 "Simple SFTP: Show Output Logs" 获取详细错误信息
3. 验证从终端访问 SSH：`ssh user@host -p port`

#### Windows SSH Agent

- 确保 OpenSSH Authentication Agent 服务正在运行
- 启动服务：在 PowerShell（管理员）中运行 `Start-Service ssh-agent`

#### 导入问题

- 验证 ~/.ssh/config 文件存在且可读
- 检查配置文件语法是否有效

### 发布说明

详细的发布说明请查看 [CHANGELOG.md](CHANGELOG.md)。

### 开发

```bash
# 安装依赖
npm install

# 编译
npm run compile

# 监视模式
npm run watch

# 打包扩展
npm run package

# 发布到市场
npm run publish
```

### 许可证

详情请查看 [LICENSE](LICENSE) 文件。

### 贡献

欢迎贡献！请随时提交问题或拉取请求。

### 链接

- [GitHub 仓库](https://github.com/iwangbowen/simple-sftp)
- [VS Code 市场](https://marketplace.visualstudio.com/items?itemName=WangBowen.simple-sftp)
- [报告问题](https://github.com/iwangbowen/simple-sftp/issues)
