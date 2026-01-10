# Change Log

## [0.8.1] - 2026-01-10

### Enhanced

- **Modern File Browser with resourceUri**: Remote file browser now uses VS Code's new QuickPick API features
  - Automatic file/folder icon derivation from current file icon theme (VS Code 1.108+)
  - Clean display with file names auto-derived from resourceUri
  - Custom URI scheme (`scp-remote://`) for better integration
  - Persistent instructional text with `prompt` property
  - Improved parent directory navigation with arrow-up icon
  - File size shown in `detail` property
  - **Correct Implementation**:
    - `label` set to empty string for resourceUri to derive filename
    - `iconPath` **not set** when resourceUri is present (VS Code 1.108+)
    - VS Code automatically derives icon from file icon theme based on resourceUri
  - **Backward Compatibility**: Smart runtime detection for seamless experience across versions
    - VS Code 1.108+: Uses `resourceUri` for automatic icon derivation from file icon theme
    - VS Code 1.85-1.107: Falls back to displaying filename and standard ThemeIcon
    - Detection via **VS Code version number** check (`vscode.version >= 1.108`)
    - **Performance optimized**: Detection result cached globally, only checked once per extension session

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
