# Change Log

## 5.2.5 - 2026-02-12

- **UX**: Refined Grid View top bar interactions (size controls alignment/hover/click behavior) and simplified loading text to `Loading`.
- **Feature**: Hosts TreeView now supports drag-and-drop sorting with persistent order (including cross-group reordering).

## 5.2.4 - 2026-02-11

- **Feature**: Added icon size controls (Small/Medium/Large) for Grid View with persistent settings

## 5.2.3 - 2026-02-11

- **Enhancement**: Migrated speed trend chart from Canvas to SVG for crisp rendering

## 5.2.2 - 2026-02-10

- **Enhancement**: Optimized speed trend chart with transparent background and interactive tooltip

## 5.2.1 - 2026-02-10

- **Feature**: Added real-time speed trend chart in transfer task details
- **Fix**: Corrected transfer speed calculation
- **Fix**: Made status bar clickable to open task details

## 5.2.0 - 2026-02-07

- **Feature**: Added "Duplicate" context menu option for files and folders

## 5.1.0 - 2026-02-06

- **Feature**: Grid/Icon view mode with image thumbnails
- **Configuration**: Thumbnail cache size and max file size now configurable

## 5.0.0 - 2026-02-06

- **Breaking Change**: Migrated host configurations to VS Code Settings Sync

## 4.9.1 - 2026-02-06

- **Fix**: Fixed webview upload dialog on Windows/Linux

## 4.9.0 - 2026-02-06

- **Feature**: Added "Download to..." and "Upload Files..." context menu options
- **Feature**: Panel layout setting for default layout configuration
- **Fix**: Hide tooltip when right-click context menu opens

## 4.8.0 - 2026-02-03

- **Feature**: File and folder hover tooltips with modification time and folder size

## 4.7.0 - 2026-02-03

- **Feature**: Display total size of selected files in footer
- **Feature**: "Open in Terminal" context menu option for both panels

## 4.6.8 - 2026-02-03

- **Feature**: Connection Pool displays operation history with expandable rows

## 4.6.7 - 2026-02-03

- **UX**: Cleaned up command palette - hid 27 context-specific commands
- **UI**: Connection Pool Status redesigned with minimalist WebView

## 4.6.6 - 2026-02-02

- **UI**: More compact bookmark list design

## 4.6.5 - 2026-02-02

- **UI**: Improved dual-panel browser footer layout
- **UX**: Live delete progress counter during batch delete operations

## 4.6.4 - 2026-02-02

- **UX**: Real-time delete progress text

## 4.6.3 - 2026-02-02

- **UX**: Breadcrumb improvements and Copy Full Path context menu

## 4.6.2 - 2026-02-02

- **UX**: Added ESC key support to close breadcrumb path dropdown

## 4.6.1 - 2026-02-02

- **Fix**: Breadcrumb dropdown toggle issue

## 4.6.0 - 2026-02-02

- **Feature**: Enhanced breadcrumb navigation with VS Code-style tree dropdown

---

## 4.5.0 - 2026-02-03

- **Feature**: Sortable column headers (name, time, size)
- **Fix**: Remote files show correct modification times
- **UI**: Responsive file list with auto-truncate
- **Feature**: Host/bookmark click opens SFTP directly
- **Feature**: Bookmark color customization

---

## 4.4.2 - 2026-02-02

- **Fix**: Empty file opening error handling
- **Change**: Parallel transfer disabled by default

---

## 4.4.1 - 2026-02-01

- **UI**: Expanded file icon mappings and refined breadcrumb style

---

## 4.4.0 - 2026-02-01

- **Feature**: Resource Dashboard for system resource monitoring

---

## 4.3.3 - 2026-01-31

- **UX**: Fixed bookmark navigation and moved edit actions to context menus

---

## 4.3.2 - 2026-01-30

- **Feature**: Enhanced remote file opening with auto-restore after restart

---

## 4.3.1 - 2026-01-29

- **Feature**: Enhanced port forwarding UI with Dynamic Forwarding

---

## 4.3.0 - 2026-01-28

- **Feature**: Standalone port forwarding panel

---

## 4.2.0 - 2026-01-28

- **Change**: Extension display name updated to "Simple SFTP Plus"

---

## 4.0.0 - 2026-01-28

- **Feature**: Added port forwarding management

---

## 3.11.0 - 2026-01-27

- **Feature**: Extended file icon support to 200+ file types
- **Feature**: Resource label formatter for editor tab titles
- **UI**: Redesigned Activity Bar icon with modern minimalist style

---

## 3.10.0 - 2026-01-26

- **Feature**: Batch rename with find & replace and pattern naming modes
- **Feature**: Real-time preview with error detection

---

## 3.9.0 - 2026-01-25

- **Feature**: Jump Host single test feature with individual test button

---

## 3.8.0 - 2026-01-25

- **Feature**: Jump Host (Proxy) configuration with multi-hop SSH support
- **Fix**: Jump host authentication in connection pool

---

## 3.7.0 - 2026-01-23

- **Feature**: Search history navigation with keyboard shortcuts
- **Fix**: Backspace key behavior in search view

---

## 3.6.0 - 2026-01-22

- **Feature**: Delta sync - skip unchanged files by modification time
- **Configuration**: `simpleSftp.transfer.deltaSyncEnabled` option

---

## 3.5.0 - 2026-01-21

- **Feature**: File integrity checker for transfer verification

---

## 3.4.0 - 2026-01-20

- **Feature**: Attribute preserving transfer with chmod/utime

---

## 3.3.0 - 2026-01-19

- **Feature**: Compression transfer for text files

---

## 3.2.0 - 2026-01-18

- **Feature**: Improved transfer queue service

---

## 3.1.0 - 2026-01-17

- **Feature**: Enhanced host manager

---

## 3.0.0 - 2026-01-16

- **Feature**: Complete refactor of core architecture

---

## 2.6.0 - 2026-01-15

- **Feature**: Enhanced transfer task details with real-time updates

---

## 2.5.0 - 2026-01-15

- **Feature**: Directory transfer support with parallel chunks
- **Feature**: Automatic MD5 checksum verification

---

## 2.4.0 - 2026-01-15

- **Feature**: Transfer queue system with task management

---

## 2.3.0 - 2026-01-14

- **Feature**: Sync mode for browse files
- **Configuration**: Max retries option
- **Breaking Change**: All transfers now use queue automatically

---

## 2.2.0 - 2026-01-14

- **Feature**: Host groups for organization
- **Feature**: Multi-select operations for hosts/groups
- **Feature**: Move hosts between groups

---

## 2.1.0 - 2026-01-13

- **Feature**: Quick download from context menu
- **Feature**: Checksum verification
- **Configuration**: Connection timeout option

---

## 2.0.0 - 2026-01-13

- **Feature**: Browse files with visual interface
- **Feature**: Quick action buttons for upload/download
- **Feature**: Path history per host

---

## 0.9.9 - 2026-01-13

- **Feature**: Duplicate host functionality
- **Enhancement**: Renamed "Sync with Host" to "Browse Files"
- **Enhancement**: Consistent UI layout

---

## 0.9.8 - 2026-01-12

- **Feature**: Virtual Workspaces incompatibility declaration
- **Enhancement**: Reduced notification noise
- **Enhancement**: Enhanced authentication prompts

---

## 0.9.7 - 2026-01-12

- **Feature**: Welcome view with quick action buttons
- **Feature**: Enhanced sync logging

---

## 0.9.6 - 2026-01-12

- **Feature**: SSH connection pool with 5 active connections
- **Performance**: 5-10x faster for consecutive operations
- **Enhancement**: Reduced notifications and improved dialogs

---

## 0.9.5 - 2026-01-12

- **Feature**: Custom golden star icons for favorites
- **Enhancement**: Bidirectional file browsing
- **Enhancement**: Streamlined context menu

---

## 0.9.0 - 2026-01-11

- **Feature**: Recent path memory (last 10 paths)
- **Feature**: Path bookmarks
- **Feature**: Download progress UI with speed and ETA

---

## 0.8.1 - 2026-01-10

- **Feature**: Modern file browser with QuickPick API

---

## 0.8.0 - 2026-01-10

- **Feature**: Star/unstar hosts to mark favorites

---

## 0.7.1 - 2026-01-10

- **Change**: Updated extension description

---

## 0.7.0 - 2026-01-10

- **Feature**: Multi-select delete and move hosts
- **Feature**: Unified "Add" menu
- **Feature**: Recent uploads tracking

---

## 0.6.0 - 2026-01-10

- **Feature**: Remote file browser with smart navigation
- **Configuration**: Dot files visibility toggle

---

## 0.5.0 - 2026-01-09

- **Feature**: Quick file upload via SFTP
- **Feature**: Host management with TreeView
- **Feature**: Multiple authentication methods
- **Feature**: Import hosts from SSH config
- **Feature**: Color-coded hosts
- **Feature**: Output logs viewer
