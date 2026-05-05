# Change Log

## 6.25.0 - 2026-05-05

- **Feature**: Image preview backdrop blur — background is now blurred when previewing images in the webview. Toolbar, nav arrows, and image shadow have been simplified for a cleaner look.
- **Feature**: Added `simpleSftp.imagePreview.backdropBlur` (default: `20`) and `simpleSftp.imagePreview.backdropOpacity` (default: `0.2`) settings to customize the preview background effect. Changes apply in real time without reloading.
- **Docs**: Added missing `simpleSftp.recentPaths.timeFormat`, `simpleSftp.remoteWatch.enabled`, and `simpleSftp.remoteWatch.pollInterval` entries to README configuration reference.

## 6.24.0 - 2026-04-29

- **Fix**: Added delete confirmation dialog for Crontab operations; improved data loading and refresh logic.

## 6.23.0 - 2026-04-29

- **Feature**: Resource Dashboard added a dedicated **Crontab** tab.

## 6.22.0 - 2026-04-29

- **Feature**: Resource Dashboard — Docker tab containers are now clickable; clicking any row opens a **real-time log stream modal** (`docker logs -f`) with auto-scroll, clear, and manual stop controls.

## 6.21.0 - 2026-04-29

- **Enhancement**: Resource Dashboard tab bar is now responsive — when the panel is too narrow, overflow tabs collapse into a **⋯ more** dropdown menu; the button highlights when the active tab is hidden.

## 6.20.0 - 2026-04-27

- **Feature**: Resource Dashboard — added **Ports**, **Users**, **Services**, and **Docker** tabs.

## 6.19.0 - 2026-04-26

- **Feature**: Resource Dashboard added a dedicated **Memory** tab with VS Code-native styling, including memory overview, health indicator, and usage breakdown bars for Used/Available/Swap.

## 6.18.0 - 2026-04-22

- **Feature**: Logs tab in Resource Dashboard now has a download button — click to save the currently selected log file to a local path via save dialog.

## 6.17.0 - 2026-04-21

- **Feature**: Resource Dashboard Processes tab — Actions column is now sticky to the right when scrolling horizontally.
- **Feature**: Added "View process details" button in the Actions column; opens a modal showing PID, Name, User, State, TTY, Start Time, CPU Time, CPU %, Memory %, RSS, VSZ and full Command.
- **Enhancement**: `ProcessInfo` model now includes `tty` and `start` fields parsed from `ps aux` output.

## 6.16.0 - 2026-04-20

- **Feature**: Process list supports real-time search — filter by PID, name, user, state, or command; match count shown and filter clearable with the clear button or Escape.

## 6.15.0 - 2026-04-20

- **Feature**: Resource Dashboard Processes tab now shows a **Name** column with the executable basename. Sortable; also appears in the Overview Top 5 table.

## 6.14.0 - 2026-04-20

- **Enhancement**: Export single host to SSH Config now shows an "Open ~/.ssh/config" button in the notification.

## 6.13.0 - 2026-04-18

- **Feature**: Resource Dashboard Logs tab — added auto-refresh (every 5s), keyword search with regex support, Highlight/Filter toggle, and match count indicator.

## 6.12.0 - 2026-04-18

- **Feature**: Resource Dashboard — added **Logs** tab for viewing remote system logs; supports file selector, tail-line count (100/200/500/1000), and syntax-highlighted output.

## 6.11.0 - 2026-04-18

- **Feature**: Resource Dashboard — added Kill Process action in the process table; hover a row to reveal a signal dropdown (SIGTERM / SIGINT / SIGHUP / SIGKILL) with a confirmation dialog before sending.

## 6.10.1 - 2026-04-18

- **Fix**: Resolved TypeScript type errors in `deltaSyncManager.ts` and `uploadOnSaveService.test.ts`.

## 6.10.0 - 2026-04-18

- **Feature**: Resource Dashboard — added Disk I/O metric card with read/write dual sparkline.
- **Feature**: CPU, Memory, and Disk I/O cards are now expandable with a history chart and min/avg/max stats.

## 6.9.0 - 2026-04-18

- **Feature**: Resource Dashboard — added metric cards (CPU, Memory, Disk) with sparkline history and Top 5 CPU processes in the Overview tab.
- **Feature**: Process, Network, and I/O tables support clickable column sorting.
- **Enhancement**: Tab switches show a loading spinner; health timestamp uses `YYYY-MM-DD HH:mm:ss` format.

## 6.8.0 - 2026-04-18

- **Feature**: Recent paths support single-entry deletion — hover an entry to reveal and click the delete button.

## 6.7.5 - 2026-04-17

- **Enhancement**: "Export All to SSH Config" notification now includes an "Open ~/.ssh/config" button.

## 6.7.0 - 2026-04-17

- **Feature**: Remote task management — create, edit, delete, and run tasks (SSH commands) from the VS Code interface.
- **Feature**: Remote file watching — prompts when a monitored remote file changes.
- **Enhancement**: SSH connection management enhanced with directory sync preview via DeltaSyncManager.

## 6.6.5 - 2026-04-17

- **Feature**: Dual-panel browser supports opening a path in a new editor tab.

## 6.6.0 - 2026-04-17

- **Feature**: Add custom notes to hosts — edit via QuickPick or the host form. Notes appear in the host tooltip.
- **Enhancement**: Bookmark descriptions now display in the bookmark dropdown below the path.

## 6.5.0 - 2026-04-16

- **Enhancement**: Recent paths now show access time. Default format is absolute; switch to relative via `simpleSftp.recentPaths.timeFormat`.

## 6.4.5 - 2026-04-15

- **Enhancement**: Right-click context menu now includes **Sort By** and **View Mode** submenus for operations previously only available via toolbar buttons.

## 6.4.0 - 2026-04-14

- **Enhancement**: Added Cyan and Pink to the bookmark color palette (8 colors total). Host color picker updated to match.

## 6.3.5 - 2026-04-13

- **Feature**: Host context menu includes **Recent Paths** — opens a QuickPick list of the last 20 visited paths for direct navigation.

## 6.3.0 - 2026-04-11

- **Feature**: Remote panel tracks **recently visited paths** — click the history icon to browse the last 20 paths per host. History persists across restarts.
- **Enhancement**: Bookmark toggle updated to use the bookmark icon.

## 6.2.0 - 2026-04-10

- **Feature**: Image preview supports **zoom in / zoom out** via toolbar buttons, scroll wheel, or keyboard shortcuts. Zoom level shown in real time.

## 6.1.7 - 2026-04-04

- **Enhancement**: Image file tooltip now shows **format** and **dimensions** without downloading the full file.

## 6.1.6 - 2026-04-01

- **Fix**: Codicons now load correctly when installed from the Marketplace. Assets bundled into `resources/codicons/` at build time.

## 6.1.5 - 2026-03-31

- **Feature**: Added **back / forward navigation buttons** to both panel headers for browser-style directory history.

## 6.1.0 - 2026-03-26

- **Feature**: Deploy Profiles — map local directories to remote paths with upload on save, glob exclude patterns, and conflict strategies.

## 6.0.3 - 2026-03-18

- **Feature**: Resource Dashboard shows richer network insights: IP/state, packet counters, error/drop counters, and live RX/TX rates.
- **Feature**: Deeper process and memory details: state, runtime, RSS/VSZ, buffers, cache, and swap usage.
- **Enhancement**: Health Summary with Healthy/Warning/Critical status and CPU/memory/disk alerts.
- **Fix**: Hardened Webview CSP handling and improved Linux disk metrics compatibility.

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
