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

#### Core Functionality
- **Quick File Upload/Download**: Upload or download files directly from Explorer, Editor, or Sidebar with intelligent host selection
- **Dual Download Modes**:
  - Download from Sidebar with custom save location
  - Download from Explorer directly to selected folder
- **Smart Host Selection**: Recently used hosts (upload or download) appear first for quick access
- **Host Management**: Organize and manage remote hosts in TreeView interface with groups and color coding
- **Cross-Device Sync**: Host configurations automatically sync across devices via VS Code Settings Sync
- **SSH Config Import**: Import existing configurations from ~/.ssh/config with group selection
- **Enhanced File Browser**:
  - Smart path navigation with input box
  - Alphabetical sorting (directories first, then files)
  - Quick upload/download buttons on each item
  - Dot files visibility toggle (configurable via settings)
  - Parent directory navigation with ".."
  - File size display for easy reference

#### Authentication
- **Multiple Methods**: Support for Password, Private Key, and SSH Agent authentication
- **Secure Storage**: Authentication credentials stored locally (not synced) for security
- **Passwordless Setup**: Automatically configure SSH key-based authentication
- **Visual Indicators**: Clear status icons showing which hosts have authentication configured
- **Windows SSH Agent**: Native support for Windows OpenSSH Agent via named pipes

#### User Experience
- **Smart Commands**: Only essential commands shown in Command Palette
- **Progress Tracking**: Real-time indicators for uploads and long-running operations
- **Color Coding**: Assign colors to hosts for easy visual identification
- **Connection Testing**: Test SSH connections before uploading files
- **Copy SSH Command**: Quickly copy connection commands to clipboard
- **Output Logs**: Dedicated log viewer for troubleshooting

#### Performance
- **SSH Connection Pool**: Automatic connection reuse for 5-10x performance improvement
  - Maintains up to 5 concurrent connections
  - Automatically reuses connections for consecutive operations
  - Idle connections auto-close after 5 minutes
  - View connection pool status in Command Palette
  - Dramatically faster repeated file operations

#### Platform Support
- Compatible with Windows, macOS, and Linux
- Cross-platform SSH Agent integration
- Works with standard OpenSSH configurations

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

#### simpleSftp.showDotFiles

- **Type**: boolean
- **Default**: true
- **Description**: Show hidden files and directories (starting with dot) in remote file browser

You can change this setting in VS Code Settings (Ctrl/Cmd+,) to control the default behavior. The setting can also be temporarily toggled using the eye icon button in the file browser.

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

#### 核心功能

- **快速文件上传/下载**：直接从资源管理器、编辑器或侧边栏上传或下载文件，智能主机选择
- **双重下载模式**：
  - 从侧边栏下载，可自定义保存位置
  - 从资源管理器下载，直接保存到选中的文件夹
- **智能主机选择**：最近使用的主机（上传或下载）优先显示，便于快速访问
- **主机管理**：在树形视图界面中管理远程主机，支持分组和颜色标记
- **跨设备同步**：主机配置通过 VS Code 设置同步自动在设备间同步
- **SSH 配置导入**：从 ~/.ssh/config 导入现有配置，支持分组选择
- **增强的文件浏览器**：
  - 智能路径导航，支持输入框
  - 字母排序（目录优先，然后是文件）
  - 每个项目都有快速上传/下载按钮
  - 点文件可见性切换（可通过设置配置）
  - 使用 ".." 导航到父目录
  - 文件大小显示，便于参考

#### 认证方式

- **多种方法**：支持密码、私钥和 SSH Agent 认证
- **安全存储**：认证凭据本地存储（不同步），确保安全
- **免密码设置**：自动配置基于 SSH 密钥的认证
- **可视化指示器**：清晰的状态图标显示哪些主机已配置认证
- **Windows SSH Agent**：通过命名管道原生支持 Windows OpenSSH Agent

#### 用户体验

- **智能命令**：命令面板中仅显示必要命令
- **进度跟踪**：上传和长时间运行操作的实时进度指示器
- **颜色标记**：为主机分配颜色，便于视觉识别
- **连接测试**：上传文件前测试 SSH 连接
- **复制 SSH 命令**：快速复制连接命令到剪贴板
- **输出日志**：专用日志查看器，便于故障排查

#### 性能优化

- **SSH 连接池**：自动连接复用，性能提升 5-10 倍
  - 维护最多 5 个并发连接
  - 自动复用连接进行连续操作
  - 闲置连接 5 分钟后自动关闭
  - 在命令面板中查看连接池状态
  - 大幅加快重复文件操作

#### 平台支持

- 兼容 Windows、macOS 和 Linux
- 跨平台 SSH Agent 集成
- 支持标准 OpenSSH 配置

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

#### simpleSftp.showDotFiles (显示隐藏文件)

- **类型**：boolean
- **默认值**：true
- **描述**：在远程文件浏览器中显示隐藏文件和目录（以点开头）

你可以在 VS Code 设置（Ctrl/Cmd+,）中更改此设置以控制默认行为。也可以使用文件浏览器中的眼睛图标按钮临时切换此设置。

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
