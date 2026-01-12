# Change Log

## [0.9.7] - 2026-01-12

### Added

- **Welcome View**: Display welcome message with quick action buttons when no hosts configured
  - Add Host button for quick host creation
  - Import from SSH Config button for easy setup
  - Documentation link for help
- **Sync Logging**: Enhanced output logs for troubleshooting sync issues
  - Show sync key and data statistics on startup
  - Log all data save operations with counts
  - Display host list details during initialization
- **Virtual Workspaces Declaration**: Formally declared incompatibility with VS Code Virtual Workspaces
  - Extension requires local file system access for SSH/SCP operations
  - Prevents installation in virtual workspace environments (vscode.dev, github.dev)

## [0.9.6] - 2026-01-12

### Performance

- **SSH Connection Pool**: Implemented connection reuse to significantly improve performance
  - Maintains pool of up to 5 active connections
  - Automatically reuses connections for repeated operations
  - All file operations now use connection pool:
    - List remote files/directories
    - Upload files and directories
    - Download files and directories
  - Idle connections close after 5 minutes
  - View pool status via Command Palette: "Show Connection Pool Status"
  - **Performance improvement: 5-10x faster for consecutive operations**

### Improved

- Removed unnecessary success notifications for delete operations
- All delete confirmations now use centered modal dialogs for better visibility

## [0.9.5] - 2026-01-12

### Enhanced

- **Custom Golden Star Icons**: Starred hosts with authentication now display vibrant golden stars (#FFD700)
- **Sync with Host**: Replaced download-only with bidirectional sync, each file/folder shows upload and download buttons
- **Streamlined Context Menu**: Test Connection moved from inline to context menu for cleaner interface

## [0.9.0] - 2026-01-11

### Added

- **Recent Path Memory**: Automatically remembers last 10 visited paths per host, auto-locates on next browse
- **Path Bookmarks**: Add bookmarks as host sub-nodes in tree view for quick access to frequently used directories
- **Download Progress UI**: Replaced notification with status bar display showing speed, progress, and ETA in tooltip

### Improved

- **Configurable Speed Unit**: Choose auto/KB/MB for download speed display
- **Smart File Size Format**: Auto-select appropriate unit (B/KB/MB/GB/TB) based on file size
- **Reduced UI Flicker**: 5-second update interval for status bar to minimize visual distraction

## [0.8.1] - 2026-01-10

### Enhanced

- **Modern File Browser with resourceUri**: Remote file browser now uses VS Code's new QuickPick API features
  - Automatic file/folder icon derivation from current file icon theme (VS Code 1.108+)
  - Custom URI scheme (`scp-remote://`) for better integration
  - Persistent instructional text with `prompt` property
  - Improved parent directory navigation with arrow-up icon
  - File size shown in `description` property
  - **Unified Implementation**:
    - `resourceUri` set unconditionally for all VS Code versions
    - `label` set to empty string (resourceUri derives filename in VS Code 1.108+)
    - `iconPath` set to `ThemeIcon.File`/`ThemeIcon.Folder` (used in VS Code < 1.108)
  - **Backward Compatibility**: Works seamlessly across all VS Code versions
    - VS Code 1.108+: Uses `resourceUri` for automatic icon derivation from active file icon theme
    - VS Code 1.85-1.107: Ignores `resourceUri`, uses `iconPath` with standard file/folder icons
    - **Simple approach**: Old VS Code versions automatically ignore unknown properties

### Improved

- Better visual hierarchy in file selection dialogs
- More intuitive placeholder and prompt text
- Consistent icon display across different themes

## [0.8.0] - 2026-01-10

### Added

- **Star/Unstar Hosts**: Toggle star status for hosts to mark favorites
  - Starred hosts with authentication: Yellow star icon (⭐)
  - Starred hosts without authentication: Gray star icon (⭐)
  - Starred hosts are sorted to the top of the list
  - Quick access to frequently used hosts
  - Star button in host context menu (inline action)

### Improved

- Host sorting: Starred hosts now appear first, followed by alphabetical order
- Visual distinction for favorite hosts with color-coded star icons
- Authentication status is preserved and visible even for starred hosts

## [0.7.1] - 2026-01-10

### Changed

- Updated extension description to accurately reflect support for both upload and download functionality
- Removed SFTP references (extension uses SCP protocol only)

## [0.7.0] - 2026-01-10

### Added

- Multi-select delete for hosts and groups
- Move hosts to groups (single/multi-select)
- Unified "Add" menu (host/group)
- Recent uploads tracking in host picker
- Group name display in host lists
- "Upload to current folder" button

### Improved

- Download dialog auto-fills remote filename
- Upload menu moved to visible position
- Better delete confirmations (modal for non-empty groups)

## [0.6.0] - 2026-01-10

### Enhanced

- Remote file browser with smart path navigation
- Alphabetical sorting (directories first, then files)
- Quick upload/download buttons on each item
- Dot files visibility toggle (configurable)
- Simplified UI
- New activity bar icon

### Configuration

- Added: simpleScp.showDotFiles (default: true)

### Changed

- Refactored to eliminate code duplication

## [0.5.0] - 2026-01-09

### Features

- Quick file upload via SCP/SFTP
- Host management with TreeView
- Multiple authentication methods
- Interactive remote path selector
- Import hosts from SSH config
- Color-coded hosts
- Edit host connection details
- Setup passwordless login
- Copy SSH command
- Output logs viewer

### Authentication

- Separate storage (local only, not synced)
- Visual indicators for status
- Windows SSH Agent support

### User Experience

- Upload from Explorer or Editor
- Theme-aware folder icons
- Clean command palette
- Progress indicators
- Real-time SSH config import

### Platform Support

- Windows, macOS, and Linux compatible
- Cross-platform SSH Agent
- Synced host configurations
