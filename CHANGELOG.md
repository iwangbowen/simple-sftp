# Change Log

## [1.0.7] - 2026-01-14

### Added

- **Expand All Button**: New button in the Hosts view title bar to expand all groups and hosts with bookmarks
  - Complementary to the built-in collapse all button
  - Located in the navigation area of the Hosts view next to refresh button
  - Expands all groups and hosts that have bookmarks for quick overview
  - Uses optimized parallel expansion (expand: 3) for smooth performance
  - Expands up to 3 levels: group → hosts → bookmarks
  - Implemented TreeDataProvider.getParent() for TreeView.reveal() support

### Improved

- Better tree navigation with expand/collapse controls
- Optimized tree expansion using parallel promises for responsiveness

## [1.0.6] - 2026-01-14

### Added

- **Help and Feedback View**: New dedicated view in the Simple SCP sidebar for easier access to support resources
  - **Read Documentation**: Quick link to GitHub README documentation
  - **Review Issues**: Browse existing issues on GitHub
  - **Report Issue**: Launch VS Code's built-in issue reporter for this extension
  - **View on GitHub**: Direct link to the GitHub repository
  - Integrated as a permanent view in the Simple SCP container
  - Uses intuitive icons for each action item

### Improved

- Enhanced user experience with centralized access to help resources
- Streamlined issue reporting workflow using VS Code's native issue reporter

## [1.0.5] - 2026-01-13

### Added

- **Host Import/Export**: Complete import and export functionality for host configurations
  - **Export All Hosts**: Export all host configurations to JSON file
  - **Export Group**: Export specific group with all its hosts
  - **Export Host**: Export individual host configuration
  - **Import Hosts**: Import host configurations from JSON file with conflict detection
  - Export includes: host settings, groups, bookmarks, recent paths (excludes authentication credentials for security)
  - Import behavior: automatically merges groups, skips duplicate hosts (same `username@host:port`), shows preview before import
  - "View File" button after export to quickly open and review exported JSON file in VS Code

### Changed

- **Bilingual README**: Added complete Chinese translation in README.md
  - Maintained English version at top with "English" section
  - Added Chinese version below with "中文说明" section
  - Language navigation links at the top of both sections
  - Consistent heading hierarchy between English and Chinese versions

### Improved

- **UI Polish**: Removed redundant "Download started" notifications
  - Download progress now only shown via Transfer Queue and status bar
  - Reduces notification clutter for better user experience

### Fixed

- **Import Dialog**: Fixed duplicate "Cancel" button in import confirmation dialog
  - Modal dialogs now display correctly with single Cancel button

## [1.0.0] - 2026-01-13

### 🎉 Major Release: Transfer Queue System

#### New Features

- **Transfer Queue Management**: Complete transfer queue system for all uploads and downloads
  - All file transfers automatically added to queue for unified management
  - Real-time progress tracking with speed and ETA display
  - Transfer Queue TreeView with file-level visibility
  - Status bar integration showing active transfer progress
  - Concurrent transfer control (configurable max concurrent transfers)

- **Task Control**: Full lifecycle management for transfer tasks
  - **Pause/Resume**: Pause ongoing transfers and resume from beginning
    - Transfer immediately stops when paused
    - Resume restarts transfer from 0% (SFTP protocol limitation)
    - Proper abort signal handling across all SSH operations
  - **Cancel**: Abort transfers with automatic cleanup
    - Incomplete local files deleted on download cancellation
    - Incomplete remote files deleted on upload cancellation
    - Prevents partial file accumulation
  - **Retry**: Automatic retry for failed transfers with exponential backoff
  - **Remove**: Clean up tasks from queue history

- **Queue Operations**: Global queue control
  - Pause entire queue to stop all transfers
  - Resume queue to continue pending transfers
  - Clear completed tasks
  - Clear all tasks

- **Transfer History**: Persistent history tracking
  - Completed transfers saved to history
  - Failed transfers logged for troubleshooting
  - View transfer statistics

- **Visual Indicators**:
  - Status bar shows: current file, progress percentage, transfer speed
  - TreeView displays: status icons, progress bars, file details
  - Context menu buttons: pause/resume/cancel based on task status

- **Configurable Settings**:
  - `simpleScp.transferQueue.maxConcurrent`: Max concurrent transfers (default: 2)
  - `simpleScp.transferQueue.autoRetry`: Enable automatic retry (default: true)
  - `simpleScp.transferQueue.maxRetries`: Max retry attempts (default: 3)
  - `simpleScp.transferQueue.retryDelay`: Delay between retries in ms (default: 2000)
  - `simpleScp.transferQueue.showNotifications`: Show completion notifications (default: true)

#### Technical Improvements

- **SSH Connection Integration**: AbortSignal support across all transfer methods
  - `uploadFile`, `downloadFile` now support abort signals
  - `uploadDirectory`, `downloadDirectory` properly handle cancellation
  - Signal checked at every progress update for immediate response

- **File Cleanup**: Smart incomplete file removal
  - New `SshConnectionManager.deleteRemoteFile` method
  - Recursive directory deletion support
  - Graceful error handling for cleanup failures

- **Event System**: Optimized update mechanism
  - Throttled TreeView refresh (1 second interval)
  - Throttled status bar updates (1 second interval)
  - Event-driven architecture: `onTaskUpdated`, `onQueueChanged`

- **State Management**: Robust task lifecycle
  - Proper running tasks tracking
  - Force removal from running set on pause
  - Correct status transitions: pending → running → completed/failed/paused/cancelled

#### Bug Fixes

- Fixed status bar visibility (immediate first update, then throttled)
- Fixed pause command showing "undefined" (correct TreeItem parameter extraction)
- Fixed resume not working (proper running tasks cleanup on pause)
- Fixed transfer not stopping on pause (AbortSignal propagation)

#### Breaking Changes

- Removed "Add to Queue" option - all transfers now use queue automatically
- Removed transfer mode selection dialog - streamlined workflow

### Enhanced

- **Browse Files**: Sync mode now properly handles directory navigation
  - Can enter subdirectories while browsing
  - Upload/download buttons work in sync mode

#### Developer Notes

- Transfer queue implemented as singleton service
- History service persists to workspace storage
- TreeProvider uses event-driven refresh
- Comprehensive logging for debugging

## [0.9.9] - 2026-01-13

### Added

- **Duplicate Host**: Quickly create host duplicates with one click
  - Intelligent naming with " (Copy)" suffix and automatic numbering
  - Copies all configurations: address, port, username, path, group, color, starred status
  - Preserves authentication settings (password/private key)
  - Optional immediate editing after creation
  - Accessible via context menu (first action item)

### Enhanced

- **Browse Files**: Renamed from "Sync with Host" for clearer semantics
  - Updated icon from sync to folder-opened
  - Title changed to "Browse Files"
  - Better reflects bidirectional file management capabilities

### Improved

- **Unified UI Layout**: Consistent inline button arrangement for hosts and bookmarks
  - Browse Files button appears first (folder icon)
  - Edit button appears second (edit icon)
  - Toggle Star moved from inline to context menu
  - Cleaner, more intuitive interface

- **Path Logic Separation**: Independent browsing paths for hosts and bookmarks
  - Host Browse Files: Always starts from configured defaultRemotePath
  - Bookmark Browse Files: Always starts from bookmark path
  - No cross-interference between host and bookmark browsing sessions

- **Bookmark Browse Enhancement**: Bookmarks now use sync mode
  - Supports both upload and download operations
  - Same powerful capabilities as host browsing
  - Reuses proven sync functionality

## [0.9.8] - 2026-01-12

### Added

- **Virtual Workspaces Declaration**: Formally declared incompatibility with VS Code Virtual Workspaces
  - Extension requires local file system access for SSH/SCP operations
  - Prevents installation in virtual workspace environments (vscode.dev, github.dev)

### Improved

- **Reduced Notification Noise**: Removed unnecessary success notifications for local operations
  - No more notifications for: host added/updated, group created/renamed, host moved, authentication configured
  - TreeView updates immediately to reflect changes
  - Only network operations (upload/download/connection test) show success notifications
  - Cleaner user experience with fewer interruptions

- **Enhanced Authentication Prompts**: Important authentication configuration prompts now use modal dialogs
  - Upload/download/sync/test connection without authentication now show centered modal dialogs
  - Prevents users from missing critical authentication setup steps
  - Ensures users must make a clear decision before continuing
  - Improves first-time user experience and reduces configuration errors

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
- **Browse Files**: Bidirectional file browsing with upload and download buttons on each file/folder
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
