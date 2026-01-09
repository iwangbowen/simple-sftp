# Change Log

## [0.6.0] - 2026-01-10

### Enhanced
- Remote file browser with smart path navigation
- Alphabetical sorting (directories first, then files)
- Quick upload/download buttons on each item
- Dot files visibility toggle (configurable)
- Simplified UI
- New activity bar icon

### Added
- Configuration: simpleScp.showDotFiles (default: true)

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
