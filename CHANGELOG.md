# Change Log

## 4.4.2 - 2026-02-02

- **Fixed**: Empty file opening error - now properly handles zero-byte files
- **Changed**: Parallel transfer disabled by default due to proxy/tunnel compatibility issues

---

## 4.4.1 - 2026-02-01

- **UI Enhancement**: Expanded file icon mappings (280+ extensions), refined breadcrumb hover style, updated local panel icon to desktop device

---

## 4.4.0 - 2026-02-01

- **Resource Dashboard**: Added system resource monitoring (CPU, memory, disk) accessible from host context menu

---

## 4.3.3 - 2026-01-31

- **TreeView UX**: Fixed bookmark navigation and moved edit actions to context menus

---

## 4.3.2 - 2026-01-30

- **Remote File Opening**: Enhanced remote file opening experience - removed fixed timeout limit, loading closes automatically when file read completes; added 500ms delay to prevent flashing for quick opens; auto-restore remote files after VS Code restart

---

## 4.3.1 - 2026-01-29

- **Port Forwarding**: Enhanced UI with Dynamic Forwarding, improved tab navigation and refresh experience, fixed table scrolling and layout issues

---

## 4.3.0 - 2026-01-28

- **Port Forwarding**: Added standalone panel accessible from host context menu; refactored into shared modules for better maintainability

---

## 4.2.0 - 2026-01-28

### Changed

- **Brand Update**: Extension display name updated to "Simple SFTP Plus" to better reflect enhanced features including port forwarding while maintaining SFTP core identity

---

## 4.0.0 - 2026-01-28

### Added

- **Port Forwarding**: Added port forwarding management

---

## 3.11.0 - 2026-01-27

### Added

- **Extended File Icon Support**: Expanded file icon recognition to 200+ file types
  - Added special filename recognition (package.json, tsconfig.json, webpack.config.js, etc.)
  - Added more programming languages (Lua, Dart, Elixir, Erlang, Clojure, Haskell, F#, R, etc.)
  - Added media file types (audio: mp3, wav, flac; video: mp4, avi, mov, mkv)
  - Added font files (ttf, otf, woff, woff2)
  - Added certificate and key files (cert, pem, key, pub, crt)
  - Added binary files (exe, dll, so, dylib)
  - Added document formats (doc, docx, odt, rtf)
  - More appropriate Codicon mappings for better visual representation

- **Resource Label Formatter**: Fixed editor tab title display for remote files
  - Tab titles now correctly show only filename (e.g., `tsconfig.json` instead of `\opt\app\chestnut\tsconfig.json`)
  - Uses VS Code's official `resourceLabelFormatters` API
  - Proper forward slash separator for SFTP URI paths
  - Full path still visible in breadcrumb navigation and hover tooltip

### Changed

- **UI Improvements**:
  - Moved "Browse Files (QuickPick)" from inline button to context menu for cleaner interface
  - Changed `openInEditor` default value to `true` for better multi-instance support
  - Redesigned Activity Bar icon with modern minimalist style
    - Larger, clearer vertical arrows (upload ↑ / download ↓)
    - Refined folder outline with better proportions
    - Enhanced visibility with thicker strokes (5px arrows, 3.2px folder)

---

## 3.10.0 - 2026-01-26

### Added

- **Batch Rename Feature**: Powerful file batch renaming with intuitive preview
  - Batch rename multiple files simultaneously in dual-panel browser
  - Two rename modes:
    - **Find & Replace**: Simple text or regex-based find and replace
    - **Pattern Rename**: Use placeholders like `{name}`, `{n}`, `{NN}`, `{NNN}` for sequential naming
  - Real-time preview with visual feedback (✓ for changes, - for unchanged, ✗ for errors)
  - Error detection: duplicate names, empty names, invalid characters
  - Progress indicator for batch operations
  - Available via toolbar button (✏️ icon) when files are selected
  - Supports both local and remote panels
  - Automatically refreshes affected directories after rename

## 3.9.0 - 2026-01-25

### Added

- **Jump Host Single Test Feature**:
  - Each Jump Host card now has a "Test" button in the top right corner, allowing you to test the connectivity of that individual jump host

## 3.8.0 - 2026-01-25

### Added

- **Jump Host (Proxy) Configuration**: Full support for multi-hop SSH connections
  - New "Advanced Configuration" webview for configuring jump hosts
  - Support for multiple jump hosts in chain (multi-hop)
  - Each jump host supports password, private key, or SSH agent authentication
  - Dynamic add/remove jump host cards in the UI
  - Test connection validates entire hop chain

### Fixed

- **Jump Host Authentication**: Connection pool now properly loads jump host credentials
  - AuthManager integration for secure credential storage
  - Automatic loading of jump host auth from AuthManager on connection
  - Fixed "Invalid or incomplete authentication configuration" error when browsing through proxy

- **Test Connection Feedback**: Success message now displays properly after test connection completes

---

## 3.7.0 - 2026-01-23

### Added

- **Search History Navigation**: Keyboard-based search history navigation
  - Press ↑ key to browse older search queries
  - Press ↓ key to browse newer search queries
  - Automatically saves up to 20 recent search queries
  - Most recent searches appear first
  - Auto-deduplicates repeated queries

### Fixed

- **Search View Input Issues**: Fixed Backspace key behavior in search view
  - Backspace key now works correctly in all search input fields
  - Fixed issue where Backspace triggered "go up one level" in local panel
  - Applied to search query, path, include, and exclude input fields
- **Search View Toggle**: Fixed ability to return to directory view from search view
  - Toggle button now correctly switches between search and file tree views

---

## 3.6.0 - 2026-01-23

### Added

- **File Comparison**: Context menu based file diff comparison
  - "Select for Compare" and "Compare with Selected" options
  - Supports local-local, remote-remote, and local-remote comparisons

---

## 3.5.0 - 2026-01-22

### Added

- **Bookmark Management**: Quick access to bookmarked paths via dropdown menu
  - Click remote path area to toggle bookmark dropdown
  - Add bookmark from context menu (files, folders, or empty area)
  - Minimalist design without header or icons
  - Real-time sync between TreeView and webview
  - Auto-refresh after bookmark add/delete operations

- **Keyboard Shortcuts**: Enhanced productivity with keyboard navigation
  - **Ctrl+A (Cmd+A on Mac)**: Select all visible items in current panel
  - Smart panel detection based on last click location
  - Works in both file list and empty panel areas

- **Visual Feedback**: Improved user interaction feedback
  - Panel resize percentage indicator (e.g., "50% | 50%") during drag
  - Headers now follow panel resize for better visual consistency
  - 800ms fade-out animation for resize indicator

### Improved

- **UI Polish**: Better visual consistency and user experience
  - Prevented text selection on UI elements (user-select: none)
  - Fixed dropdown visibility issues with overflow handling
  - Cleaner context menus (removed Cut/Copy/Paste)

---

## 3.4.0 - 2026-01-22

### Removed

- **Drag and Drop File Transfer**: Removed drag-and-drop functionality between local and remote panels to simplify the UI
  - File transfers are now only available through toolbar buttons (Upload/Download)

### Added

- **Local File Permissions Support**: Local files now display and support permission editing on Linux/macOS systems
  - Permission information (rwx format) displayed for local files
  - Right-click context menu "Change Permissions" now works for both local and remote files
  - Visual permissions editor with checkboxes for Owner/Group/Others × Read/Write/Execute

- **Visual Permissions Editor**: Replaced text input with an in-webview modal dialog
  - Interactive checkbox grid for easy permission editing
  - Real-time display of octal (e.g., 755) and symbolic (e.g., rwxr-xr-x) formats
  - Custom-styled checkboxes matching VS Code theme
  - Modal dialog appears within the current webview instead of opening a new panel

### Improved

- **Breadcrumb Navigation**: Optimized path display for long paths
  - All path segments now display completely without truncation
  - Supports horizontal scrolling for long paths
  - Auto-scrolls to the right to show the current directory
  - No more ellipsis (...) in path names

- **Permissions Editor UI**: Cleaner, more compact design
  - Flat design without rounded corners or shadows
  - Reduced spacing and padding
  - Smaller font sizes for a more professional look
  - Better alignment with VS Code's design language

---

## 3.3.0 - 2026-01-21

### Added

- **Breadcrumb Navigation**: Path display is now clickable breadcrumb navigation
  - Click any path segment to jump to that directory
  - Optimized to prioritize displaying the last segments when space is limited
  - Supports both Windows (C:\Users\...) and Unix (/home/...) path formats

- **File Permissions Display & Editing**: Remote files now show Unix-style permissions
  - Permission column displays rwx format (e.g., `rwxr-xr-x`)
  - Right-click context menu "Change Permissions" for remote files
  - Input supports both octal (755) and symbolic (rwxr-xr-x) formats
  - Automatic directory refresh after permission changes

### Fixed

- Delete confirmation dialog now uses native VS Code modal instead of browser confirm() to avoid CSP sandbox restrictions
- Removed duplicate "Cancel" button in delete confirmation dialog
- Fixed keyboard shortcuts conflict (Ctrl+S for upload, Ctrl+D for download, Delete key for delete)
- Fixed permission data retrieval by using `sftp.stat()` to get detailed file attributes

### Improved

- Batch operations (delete/upload/download) now show detailed confirmation dialogs with file lists
- Better error handling with fallback for permission retrieval failures

---

## 3.2.0 - 2026-01-21

### Added

- Dual Panel Browser Editor Mode Support: New configuration to choose opening location (Panel or Editor area), supports multiple webview instances per host, automatic panel reuse

### Fixed

- Bookmark WebView browse respects configuration setting
- Context menu commands work in both Panel and Editor modes
- Resolved missing `@vscode/codicons` package dependency

---

## 3.1.1 - 2026-01-21

### Added

- Bookmark Management in SFTP Browser: Host selection page displays bookmarks with expand/collapse functionality, visual hierarchy with indentation

### Improved

- Cleaner host selection interface with organized bookmark display
- Quick access to favorite remote directories

---

## 3.1.0 - 2026-01-20

### Added

- Search/filter input boxes for quick file filtering
- "Back to Host Selection" button in browser header
- Auto-refresh directory after upload/download
- Delayed loading indicator (500ms) to reduce UI flicker

### Fixed

- Fixed directory refresh using current path instead of root path
- Upload/download now correctly target current directory
- Unified authentication warning messages
- Fixed duplicate "Cancel" buttons in modal dialogs

### Improved

- Show loading indicator when selecting host with slow connection
- Prevent Backspace key from navigating when typing in search box

---

## 3.0.1 - 2026-01-19

### Fixed

- Fixed Windows drive navigation from drive root (C:\) returns to drive list
- Added distinctive drive icon for Windows drives
- Fixed hover state on ".." (back) button
- Optimized layout: moved action buttons to header bar
- Fixed long path display with ellipsis
- Each panel header limited to 50% width to prevent overlapping

---

## 3.0.0 - 2026-01-19

### Added

- Dual-Panel Webview File Browser: Visual dual-panel interface for local and remote file systems
- Directory navigation with breadcrumb path display
- Click to upload/download files and folders
- Quick bookmark creation for remote directories
- Toggle visibility of hidden files (dot files)
- Display file size and modification time
- Support multiple webview panels for different hosts simultaneously

---

## 2.9.0 - 2026-01-17

### Added

- File Attributes and Symbolic Links Preservation: File permissions, modification timestamps, and symbolic links properly handled during transfers
- Configuration options: `simpleSftp.transfer.preservePermissions`, `simpleSftp.transfer.preserveTimestamps`, `simpleSftp.transfer.followSymlinks`
- Attribute preservation runs after checksum verification

---

## 2.8.0 - 2026-01-16

### Added

- Priority Queue System: Files automatically assigned priority based on file size (Small < 1MB: high, 1MB-100MB: normal, >100MB: low)
- Smart Queue Processing: Pending tasks sorted by priority then creation time
- Default `maxConcurrent` increased from 2 to 5 concurrent transfers

---

## 2.7.0 - 2026-01-16

### Added

- Transfer History Tree View: Dedicated tree view for browsing transfer history with color-coded status icons
- Enhanced Time Display: Consistent time formatting using `TimeUtils` (YYYY-MM-DD HH:mm:ss)
- Individual task deletion with trash icon button
- Clear all history button

### Removed

- Show Queue Statistics Button (information now accessible through individual task details)

---

## 2.6.0 - 2026-01-16

### Enhanced

- Real-time Progress Updates: Task detail view updates every 500ms with live transfer speed, progress, and ETA
- Visual Progress Bars: ASCII-style progress bars using block characters
- Smart Panel Management: Panels reused when viewing same task

---

## 2.5.0 - 2026-01-15

### Added

- Directory Transfer Support: Upload/download entire directories with automatic folder structure creation
- Parallel Chunk Transfer: Large files split into parallel chunks for faster transfers
- Configuration options: `simpleSftp.transfer.chunkSize`, `simpleSftp.transfer.parallelCount`
- Automatic checksum verification (MD5) for data integrity

---

## 2.4.0 - 2026-01-15

### Added

- Transfer Queue System: Queues file transfers for efficient management
- Transfer Task Management: View queued tasks with pause/resume/cancel options
- Task Persistence: Transfer history persists across sessions

---

## 2.3.0 - 2026-01-14

### Added

- Sync Mode for Browse Files: Bidirectional file operations in file browser
- Configuration option: `simpleSftp.transfer.maxRetries` for automatic retry on failures
- Automatic connection retry logic

### Enhanced

- Enhanced Browse Files with file listing improvements
- Better error handling and user feedback

### Breaking Changes

- Removed "Add to Queue" option - all transfers now use queue automatically
- Removed transfer mode selection dialog

---

## 2.2.0 - 2026-01-14

### Added

- Host Groups: Organize hosts into groups for better management
- Multi-select Operations: Delete multiple hosts/groups at once
- Move Hosts: Move hosts between groups or to root level

---

## 2.1.0 - 2026-01-13

### Added

- Quick Download: Download files from remote servers via context menu
- Checksum Verification: Automatic data integrity checking during transfers
- Connection Timeout: Configurable timeout for connection attempts

---

## 2.0.0 - 2026-01-13

### Added

- Browse Files Feature: Browse remote files with visual file browser interface
- Upload/Download Buttons: Quick action buttons on each file/folder
- Path History: Remember recently visited paths per host

---

## 0.9.9 - 2026-01-13

### Added

- Duplicate Host: Create host duplicates with one click, preserves all configurations

### Enhanced

- Browse Files: Renamed from "Sync with Host" for clearer semantics
- Unified UI Layout: Consistent inline button arrangement for hosts and bookmarks
- Path Logic Separation: Independent browsing paths for hosts and bookmarks
- Bookmark Browse Enhancement: Bookmarks now use sync mode

---

## 0.9.8 - 2026-01-12

### Added

- Virtual Workspaces Declaration: Formally declared incompatibility with VS Code Virtual Workspaces

### Improved

- Reduced Notification Noise: Removed unnecessary success notifications for local operations
- Enhanced Authentication Prompts: Important authentication configuration now use modal dialogs

---

## 0.9.7 - 2026-01-12

### Added

- Welcome View: Display welcome message with quick action buttons when no hosts configured
- Sync Logging: Enhanced output logs for troubleshooting sync issues

---

## 0.9.6 - 2026-01-12

### Performance

- SSH Connection Pool: Maintains pool of up to 5 active connections with automatic reuse, idle connections close after 5 minutes
- Performance improvement: 5-10x faster for consecutive operations

### Improved

- Removed unnecessary success notifications for delete operations
- All delete confirmations now use centered modal dialogs

---

## 0.9.5 - 2026-01-12

### Enhanced

- Custom Golden Star Icons: Starred hosts with authentication display vibrant golden stars
- Browse Files: Bidirectional file browsing with upload and download buttons
- Streamlined Context Menu: Test Connection moved to context menu

---

## 0.9.0 - 2026-01-11

### Added

- Recent Path Memory: Remembers last 10 visited paths per host
- Path Bookmarks: Add bookmarks as host sub-nodes for quick access
- Download Progress UI: Status bar display showing speed, progress, and ETA

### Improved

- Configurable Speed Unit: Choose auto/KB/MB for download speed display
- Smart File Size Format: Auto-select appropriate unit (B/KB/MB/GB/TB)
- Reduced UI Flicker: 5-second update interval for status bar

---

## 0.8.1 - 2026-01-10

### Enhanced

- Modern File Browser: Remote file browser uses VS Code's new QuickPick API with resourceUri
- Automatic file/folder icon derivation from current file icon theme (VS Code 1.108+)
- Backward Compatibility: Works across all VS Code versions

---

## 0.8.0 - 2026-01-10

### Added

- Star/Unstar Hosts: Toggle star status to mark favorites
- Starred hosts sorted to the top of the list

---

## 0.7.1 - 2026-01-10

### Changed

- Updated extension description to reflect support for both upload and download

---

## 0.7.0 - 2026-01-10

### Added

- Multi-select delete for hosts and groups
- Move hosts to groups (single/multi-select)
- Unified "Add" menu (host/group)
- Recent uploads tracking in host picker

### Improved

- Download dialog auto-fills remote filename
- Better delete confirmations

---

## 0.6.0 - 2026-01-10

### Enhanced

- Remote file browser with smart path navigation
- Alphabetical sorting (directories first, then files)
- Quick upload/download buttons on each item
- Dot files visibility toggle
- New activity bar icon

### Configuration

- Added: simpleSftp.showDotFiles (default: true)

---

## 0.5.0 - 2026-01-09

### Features

- Quick file upload via SFTP
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
