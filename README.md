# Simple SCP

A lightweight VS Code extension for uploading files to remote hosts via SCP/SFTP with cross-device host configuration synchronization.

## Support This Project

If you find this extension helpful, consider buying me a coffee!

<img src="resources/wechat-pay.jpg" alt="WeChat Pay" width="200"/>

## Features

### Core Functionality
- **Quick File Upload/Download**: Upload or download files directly from Explorer, Editor, or remote file browser
- **Host Management**: Organize and manage remote hosts in TreeView interface
- **Cross-Device Sync**: Host configurations automatically sync across devices via VS Code Settings Sync
- **SSH Config Import**: Import existing configurations from ~/.ssh/config with group selection
- **Enhanced File Browser**:
  - Smart path navigation with input box
  - Alphabetical sorting (directories first, then files)
  - Quick upload/download buttons on each item
  - Dot files visibility toggle (configurable via settings)
  - Parent directory navigation with ".."

### Authentication
- **Multiple Methods**: Support for Password, Private Key, and SSH Agent authentication
- **Secure Storage**: Authentication credentials stored locally (not synced) for security
- **Passwordless Setup**: Automatically configure SSH key-based authentication
- **Visual Indicators**: Clear status icons showing which hosts have authentication configured
- **Windows SSH Agent**: Native support for Windows OpenSSH Agent via named pipes

### User Experience
- **Smart Commands**: Only essential commands shown in Command Palette
- **Progress Tracking**: Real-time indicators for uploads and long-running operations
- **Color Coding**: Assign colors to hosts for easy visual identification
- **Connection Testing**: Test SSH connections before uploading files
- **Copy SSH Command**: Quickly copy connection commands to clipboard
- **Output Logs**: Dedicated log viewer for troubleshooting

### Platform Support
- Compatible with Windows, macOS, and Linux
- Cross-platform SSH Agent integration
- Works with standard OpenSSH configurations

## Getting Started

### Add a New Host

1. Open the Simple SCP panel in the Activity Bar
2. Click the "+" icon in the toolbar
3. Follow the prompts to enter:
   - Host name (display name)
   - Hostname or IP address
   - Port (default: 22)
   - Username
   - Default remote path
   - Optional: Group and color

### Import from SSH Config

1. Click the cloud download icon in the toolbar
2. Select hosts to import from your ~/.ssh/config
3. Choose a group or create a new one
4. Imported hosts will appear in the TreeView

### Configure Authentication

**Option 1: Configure Manually**
1. Right-click a host in the TreeView
2. Select "Configure Authentication"
3. Choose authentication method:
   - Password
   - Private Key (with optional passphrase)
   - SSH Agent

**Option 2: Setup Passwordless Login**
1. Right-click a host
2. Select "Setup Passwordless Login"
3. Enter your password when prompted
4. The extension will automatically copy your SSH public key to the remote host

### Upload Files

**From Explorer:**
1. Right-click any file or folder
2. Select "Simple SCP: Upload to Remote Host"
3. Choose the destination host
4. Browse and select the remote directory
5. Use upload buttons on directory items for quick upload

**From Editor:**
1. Right-click in the editor
2. Select "Simple SCP: Upload to Remote Host"
3. Follow the same steps

### Download Files

1. Right-click a host in the TreeView
2. Select "Download from Remote Host"
3. Browse remote directories with smart path navigation
4. Click download buttons on files/directories for quick download
5. Toggle dot files visibility as needed
6. Select destination for downloaded files

### Edit Host Configuration

1. Right-click a host in the TreeView
2. Select "Edit Host"
3. Update hostname, port, or other settings

### Test Connection

1. Right-click a host
2. Select "Test Connection"
3. View the result in a notification

## Requirements

- VS Code 1.85.0 or higher
- SSH access to remote hosts
- For passwordless setup: SSH key pair (~/.ssh/id_rsa or similar)

## Command Palette

The following commands are available in the Command Palette (Ctrl/Cmd+Shift+P):

- **Simple SCP: Add Host** - Add a new remote host
- **Simple SCP: Add Group** - Create a host group
- **Simple SCP: Import from SSH Config** - Import from ~/.ssh/config
- **Simple SCP: Show Output Logs** - Open the log viewer

Additional commands are available via context menus in the TreeView and file explorers.

## Settings

### simpleScp.showDotFiles

- **Type**: boolean
- **Default**: true
- **Description**: Show hidden files and directories (starting with dot) in remote file browser

You can change this setting in VS Code Settings (Ctrl/Cmd+,) to control the default behavior. The setting can also be temporarily toggled using the eye icon button in the file browser.

## Security Notes

- **Host configurations** (names, addresses, ports, groups) are synced across devices via VS Code Settings Sync
- **Authentication credentials** (passwords, private keys, passphrases) are stored locally only using VS Code's SecretStorage
- Credentials are **never** synced across devices for security
- Each device requires separate authentication configuration
- Sync is handled automatically by VS Code when Settings Sync is enabled

## Known Limitations

- Folder upload uploads files individually (not as archive)
- Symbolic links are followed during upload
- File permissions are preserved when possible

## Troubleshooting

**Connection Issues:**
1. Use "Test Connection" to verify credentials
2. Check "Simple SCP: Show Output Logs" for detailed error messages
3. Verify SSH access works from terminal: `ssh user@host -p port`

**Windows SSH Agent:**
- Ensure OpenSSH Authentication Agent service is running
- Start service: `Start-Service ssh-agent` in PowerShell (Administrator)

**Import Issues:**
- Verify ~/.ssh/config file exists and is readable
- Check config file syntax is valid

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

### 0.6.0

Enhanced remote file browser with smart path navigation, alphabetical sorting, quick upload/download buttons, and configurable dot files visibility.

### 0.5.0

Initial public release with full SCP/SFTP upload functionality, multiple authentication methods, SSH config import, and cross-device host synchronization.

## Development

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

## License

See [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Links

- [GitHub Repository](https://github.com/iwangbowen/simple-scp)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=WangBowen.simple-scp)
- [Report Issues](https://github.com/iwangbowen/simple-scp/issues)
