# Change Log

## 6.14.0 - 2026-04-20

- **Enhancement**: Export single host to SSH Config now shows an "Open ~/.ssh/config" button in the notification, matching the behavior of "Export All Hosts to SSH Config".

## 6.13.0 - 2026-04-18

- **Feature**: Resource Dashboard Logs tab — added auto-refresh toggle (every 5s, stops when switched away), keyword search bar with regex support, Highlight/Filter toggle, match count indicator, and clear search button.

## 6.12.0 - 2026-04-18

- **Feature**: Resource Dashboard — added **Logs** tab for viewing remote system logs under `/var/log`; supports file selector, configurable tail-line count (100/200/500/1000), and syntax-highlighted output with error/warn/info color coding.

## 6.11.0 - 2026-04-18

- **Feature**: Resource Dashboard — added Kill Process action column to the process table; hover any row to reveal a signal selector dropdown (SIGTERM / SIGINT / SIGHUP / SIGKILL) with a VS Code modal confirmation before the signal is sent to the remote host.

## 6.10.1 - 2026-04-18

- **Fix**: Resolved TypeScript type errors in `deltaSyncManager.ts` (mtime compatibility cast) and `uploadOnSaveService.test.ts` (missing required `DeployProfile` fields).

## 6.10.0 - 2026-04-18

- **Feature**: Resource Dashboard — added Disk I/O metric card with read/write speed dual sparkline.
- **Feature**: Resource Dashboard — CPU, Memory, and Disk I/O metric cards are now clickable to expand a detailed history chart with min/avg/max stats.

## 6.9.0 - 2026-04-18

- **Feature**: Resource Dashboard — added CPU / Memory / Disk metric cards with sparkline history charts and Top 5 CPU processes snapshot in Overview tab.
- **Feature**: Resource Dashboard — Processes, Network, and I/O tables support clickable column sorting.
- **Enhancement**: Tab switches now show a loading spinner instead of a "No data" flash.
- **Enhancement**: Health summary timestamp now uses `YYYY-MM-DD HH:mm:ss` format.

## 6.8.0 - 2026-04-18

- **Feature**: 最近路径记录支持单条删除 — 鼠标悬停时显示删除按钮，点击可移除单条访问记录，无需清空全部。

## 6.7.5 - 2026-04-17

- **Enhancement**: "Export All to SSH Config" command now shows an "Open ~/.ssh/config" button in the notification; clicking it opens (or auto-creates) `~/.ssh/config` in a side-by-side editor for easy copy-paste.

## 6.7.0 - 2026-04-17

- **Feature**: 新增远程任务管理功能，支持任务的添加、编辑、删除和执行（通过 VS Code 界面管理远程 SSH 命令）。
- **Feature**: 实现远程文件变化监视，文件发生变更时自动提示用户处理。
- **Enhancement**: 增强 SSH 连接管理，支持目录同步预览与执行（基于 DeltaSyncManager）。
- **Enhancement**: 更新部署配置及传输历史视图，展示任务状态与同步结果。

## 6.6.5 - 2026-04-17

- **Feature**: Dual-panel browser now supports opening a path in a new editor tab via a dedicated command.

## 6.6.0 - 2026-04-17

- **Feature**: Add custom notes to hosts — edit via QuickPick "Edit Notes" or the advanced host form. Notes appear in the host tooltip.
- **Enhancement**: Bookmark descriptions now display in the bookmark dropdown below the path.

## 6.5.0 - 2026-04-16

- **Enhancement**: Recent paths now display access time. Default format is absolute (`2026-04-16 14:30`); switch to relative (`2h ago`) via `simpleSftp.recentPaths.timeFormat`. Hovering shows the alternate format as tooltip.

## 6.4.5 - 2026-04-15

- **Enhancement**: Right-click context menu now includes **Sort By** (Name / Size / Modified Time) and **View Mode** (List View / Grid View) submenus, providing additional entry points for operations previously only available via toolbar buttons.

## 6.4.0 - 2026-04-14

- **Enhancement**: Added 🩵 Cyan and 🩷 Pink to the bookmark color palette (now 8 colors total).
- **Fix**: Host color picker was missing Orange; it now shows the same full 8-color palette as bookmarks.

## 6.3.5 - 2026-04-13

- **Feature**: Sidebar host context menu now includes a **Recent Paths** entry — click to open a QuickPick list of the last 20 visited remote paths for that host, and navigate directly to the selected path.

## 6.3.0 - 2026-04-11

- **Feature**: Remote panel now tracks **recently visited paths** — click the history icon (⟳) to view a dropdown list of the last 20 paths per host. Clicking any entry navigates directly to that path. History persists across VS Code restarts and can be cleared with the "Clear" button.
- **Enhancement**: Bookmark toggle button updated to use the bookmark icon for clearer visual identity.

## 6.2.0 - 2026-04-10

- **Feature**: Image preview now supports **zoom in / zoom out** — use the `+` / `-` toolbar buttons, mouse scroll wheel, or keyboard shortcuts (`+`, `-`, `0` to reset). Zoom level displayed in real time. Toolbar and title bar now use a frosted-glass background for readability on light-colored images.

## 6.1.7 - 2026-04-04

- **Enhancement**: File tooltip for images now displays additional metadata — **format** (PNG, JPEG, GIF, WebP, BMP, SVG, etc.) and **dimensions** (width × height px). Works for both local and remote image files without downloading the entire file.

## 6.1.6 - 2026-04-01

- **Fix**: Webview codicons (icons) now load correctly when the extension is installed from the Marketplace. Previously, packaging with `--no-dependencies` excluded `node_modules/@vscode/codicons`, causing a 404 error. Codicon assets are now bundled into `resources/codicons/` at build time.

## 6.1.5 - 2026-03-31

- **Feature**: Added **back / forward navigation buttons** (← →) to both panel headers for browser-style directory history.

## 6.1.0 - 2026-03-26

- **Feature**: Deploy Profiles — map local directories to remote paths with automatic upload on save, glob exclude patterns, conflict strategies, and a dedicated sidebar panel.

## 6.0.3 - 2026-03-18

- **Feature**: Resource Dashboard now shows richer network insights, including interface IP/state, packet counters, error/drop counters, and live RX/TX rates.
- **Feature**: Resource Dashboard now shows deeper process and memory details, including process state/runtime/RSS/VSZ plus memory buffers, cache, and swap usage.
- **Enhancement**: Added a Health Summary to Resource Dashboard with `Healthy` / `Warning` / `Critical` status and clear CPU, memory, and disk alerts.
- **Fix**: Hardened the dashboard Webview output and CSP handling, improved Linux block-device compatibility for disk metrics, and fixed edge-case parsing for memory availability and swap values.

## 6.0.2 - 2026-03-17

- **UX**: Dual-panel breadcrumb navigation now uses **left-click** to jump directly to the selected path and **right-click** to open the path context dropdown.
- **Fix**: Preserve the Windows local **`drives://`** breadcrumb path so navigation and context dropdowns stay correct in the drive list view.

## 6.0.1 - 2026-03-11

- **Feature**: Dual-panel SFTP webview now supports **Compress** and **Extract Here** for **local** files and folders — right-click any local file/folder to compress it to `.tar.gz` or `.zip`, or right-click a local archive to extract it in place. Uses platform-native tools: `tar`/`zip` on macOS/Linux, `tar.exe` and PowerShell `Compress-Archive`/`Expand-Archive` on Windows.

## 6.0.0 - 2026-03-10

- **Feature**: Dual-panel SFTP webview now supports **Compress** and **Extract Here** for remote files and folders — right-click any remote file/folder to compress it to `.tar.gz` or `.zip`, or right-click an archive to extract it in place. Supports `.tar.gz`, `.tgz`, `.tar.bz2`, `.tbz2`, `.tar.xz`, `.txz`, `.tar`, `.zip`, `.gz`, and `.bz2` formats.

## 5.2.22 - 2026-03-10

- **Fix**: Reset dual-panel footer selection state when switching or reloading directories, preventing stale selected counts and actions from carrying over to the next view.

## 5.2.21 - 2026-03-09

- **Feature**: Dual-panel SFTP webview now supports **Move...** for files and folders, including destination path picking and live footer progress feedback for batch moves.

## 5.2.20 - 2026-03-08

- **Feature**: Bookmarks in the Hosts panel now support **drag-and-drop reordering** — drag a bookmark within the same host to rearrange its position; the new order is persisted across sessions.

## 5.2.19 - 2026-03-07

- **Feature**: Editor webview now opens separate tabs for different host/bookmark contexts while reusing the same tab for the same context.

## 5.2.18 - 2026-03-07

- **Fix**: Prevent hidden hover tooltips from blocking hover and cursor feedback on Grid View items.

## 5.2.17 - 2026-03-06

- **Fix**: Fixed inline create item layout in Grid View for both **New Folder** and **New File**, so input fields render correctly inside grid cards.
- **Fix**: Clicking blank area in file tree now cancels pending **New Folder/New File** input.
- **Fix**: Updated inline rename input style to match the new inline create input style.
- **UX**: Clicking blank area while inline renaming now commits the rename (same as click-outside confirm behavior).

## 5.2.16 - 2026-03-05

- **Feature**: Bookmark nodes in the Hosts panel now support **Open SSH Terminal Here** — opens a terminal at the bookmarked remote path.
- **Feature**: WebView file browser supports **rubber band selection** — drag on the panel background to select multiple files in both List and Grid views.

## 5.2.15 - 2026-03-03

- **Fix**: Fixed inline rename input in Grid View — the input box now stays within the item bounds with correct width, centered text, and matching font size; also fixed Backspace and Delete keys incorrectly triggering navigation/deletion while renaming.

## 5.2.14 - 2026-02-28

- **Feature**: Added a new interactive Walkthrough for first-time users to explore the Hosts panel, File Browser, and Port Forwarding. Users can also open it via the `Simple SFTP: Open Walkthrough` command.

## 5.2.13 - 2026-02-27

- **Feature**: Added sorting controls to Grid View — a dropdown (Name/Size/Date) and direction toggle button in the toolbar row, keeping sort state in sync with List View.

## 5.2.12 - 2026-02-24

- **UX**: Redesigned the Activity Bar icon to match the new document-with-arrows style.

## 5.2.11 - 2026-02-24

- **UX**: Redesigned transfer task details page with sleek compact card layout, terminal-style progress bar (solid fill, blinking cursor, sharp edges), tighter spacing, and fixed broken CSS rules.

## 5.2.10 - 2026-02-24

- **UX**: Redesigned the bookmark dropdown list to be more sleek and compact, featuring a single-line layout with icons, better vertical alignment, and improved theme color integration.

## 5.2.9 - 2026-02-22

- **UX**: Removed the dark gradient background from the image preview toolbar to make the entire modal fully transparent, and enhanced text shadows for better visibility of the filename and action buttons.

## 5.2.8 - 2026-02-20

- **UX**: Image preview overlay now uses a fully transparent background — the image floats directly over the file browser with a gradient toolbar overlay and drop shadow

## 5.2.7 - 2026-02-13

- **Fix**: Fixed clickability issue in Grid View where container elements were blocking pointer events on some items

## 5.2.6 - 2026-02-12

- **Feature/UX**: Added in-webview image floating preview from file context menu with keyboard navigation (←/→), rotation, centered title, and side navigation controls.

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
