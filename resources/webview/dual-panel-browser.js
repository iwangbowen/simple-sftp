// Dual Panel File Browser - Frontend Logic (Flat Directory Navigation)
// @ts-check

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    /** @type {HTMLElement | null} */
    let selectedItem = null;
    /** @type {HTMLElement[]} */
    let selectedItems = [];
    /** @type {HTMLElement | null} */
    let lastSelectedItem = null;
    /** @type {string} */
    let currentLocalPath = '';
    /** @type {string} */
    let currentRemotePath = '';
    /** @type {string} */
    let currentHostId = '';
    /** @type {Array<{name: string, path: string}>} */
    let currentBookmarks = [];
    /** @type {{path: string, panel: string, name: string} | null} */
    let fileSelectedForCompare = null;
    /** @type {Object.<string, number>} */
    let loadingTimers = {};
    /** @type {number | null} */
    let clickTimer = null;
    /** @type {string} */
    let lastActivePanel = 'remote';
    /** @type {Object.<string, {column: string, direction: 'asc' | 'desc'}>} */
    let sortState = {
        local: { column: 'name', direction: 'asc' },
        remote: { column: 'name', direction: 'asc' }
    };
    /** @type {HTMLElement | null} */
    let breadcrumbDropdown = null;
    /** @type {Object.<string, number>} */
    let breadcrumbClickTimers = {};
    /** @type {Object.<string, number>} */
    let breadcrumbTreeLoadingTimers = {};
    /** @type {HTMLElement | null} */
    let fileTooltip = null;
    /** @type {number | null} */
    let tooltipShowTimer = null;
    /** @type {AbortController | null} */
    let tooltipRequestController = null;
    /** @type {HTMLElement | null} */
    let currentTooltipItem = null;
    /** @type {MouseEvent | null} */
    let currentTooltipEvent = null;
    /** @type {boolean} */
    let altKeyPressed = false;
    /** @type {Object.<string, 'list' | 'grid'>} */
    let viewMode = {
        local: 'list',
        remote: 'list'
    };
    /** @type {number} */
    let thumbnailSize = 96;
    let isAltKeyPressed = false;
    /** @type {boolean} */
    let isMouseOnTooltip = false;

    // Thumbnail lazy loading
    /** @type {IntersectionObserver | null} */
    let thumbnailObserver = null;

    // ===== 初始化 =====
    document.addEventListener('DOMContentLoaded', () => {
        // 从DOM中读取初始路径
        const localPathElement = document.getElementById('local-path');
        const remotePathElement = document.getElementById('remote-path');
        if (localPathElement) {
            currentLocalPath = localPathElement.textContent || '';
        }
        if (remotePathElement) {
            currentRemotePath = remotePathElement.textContent || '';
        }

        initializeEventListeners();
        initializeResizer();
        initializeSearchView();
        initializeColumnHeaders();
        // Initialize port forwarding using shared module
        if (typeof PortForwardModule !== 'undefined') {
            PortForwardModule.init({ vscode, isStandalone: false, showCloseButton: true });
        }

        // Listen for port forward view events
        window.addEventListener('portForwardViewOpened', () => {
            updateMoreButtonToBackButton();
        });
        window.addEventListener('portForwardViewClosed', () => {
            restoreMoreButtonToNormal();
        });

        // 通知扩展 WebView 已准备就绪
        vscode.postMessage({ command: 'ready' });

        // Initialize file tooltip
        initializeFileTooltip();

        // Initialize thumbnail lazy loading observer
        initializeThumbnailObserver();
    });

    // ===== 事件监听器 =====
    function initializeEventListeners() {
        // Header buttons
        document.getElementById('back-to-hosts')?.addEventListener('click', backToHostSelection);
        document.getElementById('refresh-local')?.addEventListener('click', () => refreshPanel('local'));
        document.getElementById('refresh-remote')?.addEventListener('click', () => refreshPanel('remote'));

        // View mode toggle buttons
        document.getElementById('local-view-toggle')?.addEventListener('click', () => toggleViewModeButton('local'));
        document.getElementById('remote-view-toggle')?.addEventListener('click', () => toggleViewModeButton('remote'));

        // Maximize panel buttons
        document.getElementById('maximize-local')?.addEventListener('click', () => togglePanelMaximize('local'));
        document.getElementById('maximize-remote')?.addEventListener('click', () => togglePanelMaximize('remote'));

        // More buttons - trigger context menu on click
        document.getElementById('local-more-toggle')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
            e.stopPropagation();
        });

        // Remote panel more button - can switch between menu and back button
        const remoteMoreToggle = document.getElementById('more-toggle');
        remoteMoreToggle?.addEventListener('click', (e) => {
            // Check if we're in a special view (search or port forward)
            if (isSearchViewVisible) {
                // Close search view
                e.preventDefault();
                closeSearchView();
                e.stopPropagation();
            } else if (typeof PortForwardModule !== 'undefined' && PortForwardModule.isViewVisible && PortForwardModule.isViewVisible()) {
                // Close port forward view
                e.preventDefault();
                PortForwardModule.closeView();
                e.stopPropagation();
            } else {
                // Open context menu
                e.preventDefault();
                e.target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
                e.stopPropagation();
            }
        });

        // Note: New folder, upload, and download are now in the native VS Code context menu
        // triggered by the "More" buttons above

        // Search inputs
        document.getElementById('local-search')?.addEventListener('input', (e) => filterTree('local', e.target.value));
        document.getElementById('remote-search')?.addEventListener('input', (e) => filterTree('remote', e.target.value));

        // Search inputs - Enter key handling
        document.getElementById('local-search')?.addEventListener('keydown', (e) => handleSearchKeydown(e, 'local'));
        document.getElementById('remote-search')?.addEventListener('keydown', (e) => handleSearchKeydown(e, 'remote'));

        // Regex toggle buttons
        document.getElementById('local-regex-toggle')?.addEventListener('click', () => {
            const toggle = document.getElementById('local-regex-toggle');
            toggle?.classList.toggle('active');
            // 重新应用过滤
            const searchInput = document.getElementById('local-search');
            if (searchInput) {
                filterTree('local', searchInput.value);
            }
        });

        document.getElementById('remote-regex-toggle')?.addEventListener('click', () => {
            const toggle = document.getElementById('remote-regex-toggle');
            toggle?.classList.toggle('active');
            // 重新应用过滤
            const searchInput = document.getElementById('remote-search');
            if (searchInput) {
                filterTree('remote', searchInput.value);
            }
        });

        // Bookmark dropdown toggle
        const bookmarkToggle = document.getElementById('bookmark-toggle');
        bookmarkToggle?.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent immediate close
            toggleBookmarkDropdown();
        });

        // Click outside to close bookmark dropdown
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('bookmark-dropdown');
            const toggleBtn = document.getElementById('bookmark-toggle');
            if (dropdown && toggleBtn &&
                !dropdown.contains(e.target) &&
                !toggleBtn.contains(e.target)) {
                closeBookmarkDropdown();
            }
        });

        // Context menu for empty area in file trees
        ['local-tree', 'remote-tree'].forEach(treeId => {
            const tree = document.getElementById(treeId);
            if (!tree) return;

            // Track which panel was last clicked/focused
            tree.addEventListener('click', (e) => {
                const panel = treeId === 'local-tree' ? 'local' : 'remote';
                lastActivePanel = panel;

                // Deselect all when clicking empty area
                if (e.target.id === treeId || e.target.classList.contains('file-tree')) {
                    clearSelection();
                }
            });

            tree.addEventListener('contextmenu', (e) => {
                // Hide tooltip when context menu opens
                hideFileTooltip();

                // Update active panel on right-click too
                const panel = treeId === 'local-tree' ? 'local' : 'remote';
                lastActivePanel = panel;

                // Only handle if clicked directly on tree container (not on items)
                if (e.target.id === treeId || e.target.classList.contains('file-tree')) {
                    const currentPath = panel === 'local' ? currentLocalPath : currentRemotePath;

                    // Set context data for empty area
                    tree.dataset.vscodeContext = JSON.stringify({
                        webviewSection: panel === 'local' ? 'localEmpty' : 'remoteEmpty',
                        panel: panel,
                        currentPath: currentPath,
                        preventDefaultContextMenuItems: true
                    });
                }
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl+A / Cmd+A: Select all visible items in focused panel
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault();
                selectAllInPanel(lastActivePanel);
            }
        });
    }

    // ===== Panel Resizer =====
    function initializeResizer() {
        const resizer = document.getElementById('resizer');
        const localPanel = document.querySelector('.local-panel');
        const remotePanel = document.querySelector('.remote-panel');
        const indicator = document.getElementById('resize-indicator');
        const localPercentageSpan = indicator?.querySelector('.local-percentage');
        const remotePercentageSpan = indicator?.querySelector('.remote-percentage');

        if (!resizer || !localPanel || !remotePanel) return;

        // Get panel layout configuration from window.panelLayoutConfig
        const config = window.panelLayoutConfig || {};
        const panelLayout = config.panelLayout || 'equal';

        let isResizing = false;
        let hideIndicatorTimer = null;

        // 显示百分比指示器
        const showIndicator = () => {
            if (indicator) {
                indicator.classList.add('visible');
            }
            // 清除隐藏定时器
            if (hideIndicatorTimer) {
                clearTimeout(hideIndicatorTimer);
                hideIndicatorTimer = null;
            }
        };

        // 延迟隐藏百分比指示器
        const hideIndicator = () => {
            if (hideIndicatorTimer) {
                clearTimeout(hideIndicatorTimer);
            }
            hideIndicatorTimer = setTimeout(() => {
                if (indicator) {
                    indicator.classList.remove('visible');
                }
            }, 800); // 800ms后隐藏
        };

        // 更新百分比显示
        const updatePercentage = (leftPercent) => {
            const rightPercent = 100 - leftPercent;
            if (localPercentageSpan) {
                localPercentageSpan.textContent = `${Math.round(leftPercent)}%`;
            }
            if (remotePercentageSpan) {
                remotePercentageSpan.textContent = `${Math.round(rightPercent)}%`;
            }
        };

        // Apply initial layout based on configuration
        const applyInitialLayout = () => {
            switch (panelLayout) {
                case 'localMaximized':
                    // Use the existing maximize function
                    togglePanelMaximize('local');
                    break;
                case 'remoteMaximized':
                    // Use the existing maximize function
                    togglePanelMaximize('remote');
                    break;
                case 'equal':
                default:
                    // Equal split - no action needed, default state
                    updatePercentage(50);
                    break;
            }
        };

        // Apply initial layout
        applyInitialLayout();

        // 双击还原默认尺寸
        resizer.addEventListener('dblclick', () => {
            applyInitialLayout();
            showIndicator();
            hideIndicator();
        });

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            showIndicator();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const containerWidth = document.querySelector('.dual-panel')?.clientWidth || 0;
            const newLeftWidth = e.clientX;
            const leftPercent = (newLeftWidth / containerWidth) * 100;

            if (leftPercent > 20 && leftPercent < 80) {
                localPanel.style.flex = `0 0 ${leftPercent}%`;
                remotePanel.style.flex = `1`;
                updatePercentage(leftPercent);
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                hideIndicator();
            }
        });
    }



    // ===== 文件排序 =====
    /**
     * @param {Array<Object>} nodes - 文件节点数组
     * @param {string} panel - 'local' | 'remote'
     * @returns {Array<Object>} 排序后的节点数组
     */
    function sortFileList(nodes, panel) {
        const state = sortState[panel];
        const folders = nodes.filter(n => n.isDirectory);
        const files = nodes.filter(n => !n.isDirectory);

        const compareFn = (a, b) => {
            let result = 0;
            switch (state.column) {
                case 'name':
                    result = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
                    break;
                case 'size':
                    result = (a.size || 0) - (b.size || 0);
                    break;
                case 'time':
                    result = (a.modifiedTime || 0) - (b.modifiedTime || 0);
                    break;
                default:
                    result = 0;
            }
            return state.direction === 'asc' ? result : -result;
        };

        folders.sort(compareFn);
        files.sort(compareFn);

        return [...folders, ...files];
    }

    /**
     * @param {string} panel - 'local' | 'remote'
     */
    function updateColumnHeaders(panel) {
        const header = document.getElementById(`${panel}-tree-header`);
        if (!header) return;

        const state = sortState[panel];
        header.querySelectorAll('.column-header').forEach(col => {
            col.classList.remove('sorted-asc', 'sorted-desc');
            const colName = col.dataset.column;
            if (colName === state.column) {
                col.classList.add(`sorted-${state.direction}`);
            }
        });
    }

    /**
     * @param {string} panel - 'local' | 'remote'
     * @param {string} column - 列名
     */
    function handleColumnHeaderClick(panel, column) {
        const state = sortState[panel];
        if (state.column === column) {
            // 切换排序方向
            state.direction = state.direction === 'asc' ? 'desc' : 'asc';
        } else {
            // 新列,默认升序
            state.column = column;
            state.direction = 'asc';
        }

        // 对当前DOM中的tree-item进行排序
        const treeContainer = document.getElementById(`${panel}-tree`);
        if (!treeContainer) return;

        const items = Array.from(treeContainer.querySelectorAll('.tree-item:not(.back-item)'));

        // 按照文件夹和文件分组
        const folders = items.filter(item => item.dataset.isDir === 'true');
        const files = items.filter(item => item.dataset.isDir !== 'true');

        // 排序比较函数
        const compareFn = (a, b) => {
            let result = 0;
            switch (column) {
                case 'name':
                    result = a.dataset.name.localeCompare(b.dataset.name, undefined, { numeric: true, sensitivity: 'base' });
                    break;
                case 'size': {
                    const sizeA = Number.parseFloat(a.dataset.size || '0');
                    const sizeB = Number.parseFloat(b.dataset.size || '0');
                    result = sizeA - sizeB;
                    break;
                }
                case 'time': {
                    const timeA = Number.parseFloat(a.dataset.modifiedTime || '0');
                    const timeB = Number.parseFloat(b.dataset.modifiedTime || '0');
                    result = timeA - timeB;
                    break;
                }
                default:
                    result = 0;
            }
            return state.direction === 'asc' ? result : -result;
        };

        folders.sort(compareFn);
        files.sort(compareFn);

        // 重新排列DOM元素
        const sortedItems = [...folders, ...files];
        const backItem = treeContainer.querySelector('.back-item');

        // 清空非表头元素
        Array.from(treeContainer.children).forEach(child => {
            if (!child.classList.contains('file-tree-header')) {
                child.remove();
            }
        });

        // 重新添加
        if (backItem) {
            treeContainer.appendChild(backItem);
        }
        sortedItems.forEach(item => {
            treeContainer.appendChild(item);
        });

        // 更新列头排序指示器
        updateColumnHeaders(panel);
    }

    /**
     * 初始化列头点击事件
     */
    function initializeColumnHeaders() {
        ['local', 'remote'].forEach(panel => {
            const header = document.getElementById(`${panel}-tree-header`);
            if (!header) return;

            header.querySelectorAll('.column-header[data-column]').forEach(col => {
                col.addEventListener('click', () => {
                    const column = col.dataset.column;
                    if (column) {
                        handleColumnHeaderClick(panel, column);
                    }
                });
            });
        });
    }

    // ===== File Tooltip Functions =====
    /**
     * Initialize file/folder tooltip
     */
    function initializeFileTooltip() {
        // Create tooltip element
        fileTooltip = document.createElement('div');
        fileTooltip.className = 'file-tooltip';
        document.body.appendChild(fileTooltip);

        // Track Alt key state
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Alt') {
                isAltKeyPressed = true;
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Alt') {
                isAltKeyPressed = false;
                // If mouse is not on tooltip and Alt is released, hide tooltip
                if (!isMouseOnTooltip && fileTooltip && fileTooltip.classList.contains('visible')) {
                    hideFileTooltip();
                }
            }
        });

        // Track mouse on tooltip
        fileTooltip.addEventListener('mouseenter', () => {
            isMouseOnTooltip = true;
        });

        fileTooltip.addEventListener('mouseleave', () => {
            isMouseOnTooltip = false;
            // If Alt is not pressed, hide tooltip when mouse leaves
            if (!isAltKeyPressed) {
                hideFileTooltip();
            }
        });
    }

    /**
     * Show tooltip for file/folder
     * @param {HTMLElement} item - Tree item element
     * @param {MouseEvent} event - Mouse event
     */
    function showFileTooltip(item, event) {
        // Clear any existing timer
        if (tooltipShowTimer) {
            clearTimeout(tooltipShowTimer);
            tooltipShowTimer = null;
        }

        // Cancel any pending request
        if (tooltipRequestController) {
            tooltipRequestController.abort();
            tooltipRequestController = null;
        }

        // Only show tooltip for directories
        const isDir = item.dataset.isDir === 'true';
        if (!isDir) {
            // For files, show simple tooltip with basic info after delay
            currentTooltipItem = item;
            currentTooltipEvent = event;

            tooltipShowTimer = setTimeout(() => {
                showFileBasicTooltip(item, event);
            }, 750);
            return;
        }

        // Store current item and event for later positioning
        currentTooltipItem = item;
        currentTooltipEvent = event;

        // Set timeout to delay tooltip display (750ms)
        tooltipShowTimer = setTimeout(() => {
            const path = item.dataset.path;
            const panel = item.dataset.panel;
            const name = item.dataset.name;

            // Request folder details from backend
            // Tooltip will only show when data arrives from updateTooltipWithFolderDetails
            tooltipRequestController = new AbortController();
            vscode.postMessage({
                command: 'getFolderDetails',
                data: { path, panel }
            });

        }, 750);
    }

    /**
     * Show basic tooltip for files
     * @param {HTMLElement} item - Tree item element
     * @param {MouseEvent} event - Mouse event
     */
    function showFileBasicTooltip(item, event) {
        const name = item.dataset.name;
        const modifiedTime = item.dataset.modifiedTime;
        const size = item.dataset.size;

        // Format modified time from timestamp
        let modifiedDate = 'Unknown';
        if (modifiedTime && modifiedTime !== '0') {
            const timestamp = parseInt(modifiedTime, 10);
            modifiedDate = formatTime(new Date(timestamp));
        }

        const sizeText = formatFileSize(parseInt(size, 10));

        fileTooltip.innerHTML = `
            <div class="tooltip-header">${name}</div>
            <div class="tooltip-section">
                <span class="tooltip-label">Modified Date:</span>
                <span class="tooltip-value">${modifiedDate}</span>
            </div>
            <div class="tooltip-section">
                <span class="tooltip-label">Size:</span>
                <span class="tooltip-value">${sizeText}</span>
            </div>
        `;

        positionTooltip(event);
        fileTooltip.classList.add('visible');
    }

    /**
     * Update tooltip with folder details
     * @param {Object} data - Folder details data
     */
    function updateTooltipWithFolderDetails(data) {
        // Only update if this is still the item we're hovering
        if (!currentTooltipItem) {
            return;
        }

        const { name, modifiedTime, size, sizeTimedOut, folders, files } = data;

        // Modified time is already formatted by backend (TimeUtils.formatTime)
        const modifiedDate = modifiedTime || 'Unknown';

        let html = `<div class="tooltip-header">${name}</div>`;

        // Modified Date (always show)
        html += `
            <div class="tooltip-section">
                <span class="tooltip-label">Modified Date:</span>
                <span class="tooltip-value">${modifiedDate}</span>
            </div>
        `;

        // Size (only show if not timed out and has value)
        if (!sizeTimedOut && size !== undefined && size !== null) {
            html += `
                <div class="tooltip-section">
                    <span class="tooltip-label">Size:</span>
                    <span class="tooltip-value">${formatFileSize(size)}</span>
                </div>
            `;
        }

        // Show folders (without icons, inline style)
        if (folders && folders.length > 0) {
            const maxShow = 10;
            const hasMore = folders.length > maxShow;
            const displayFolders = folders.slice(0, maxShow);
            const folderText = displayFolders.join(', ');

            html += `
                <div class="tooltip-section">
                    <span class="tooltip-label">Folders:</span>
                    <span class="tooltip-value">${folderText}${hasMore ? `, ...and ${folders.length - maxShow} more` : ''}</span>
                </div>
            `;
        }

        // Show files (without icons, inline style)
        if (files && files.length > 0) {
            const maxShow = 10;
            const hasMore = files.length > maxShow;
            const displayFiles = files.slice(0, maxShow);
            const fileText = displayFiles.join(', ');

            html += `
                <div class="tooltip-section">
                    <span class="tooltip-label">Files:</span>
                    <span class="tooltip-value">${fileText}${hasMore ? `, ...and ${files.length - maxShow} more` : ''}</span>
                </div>
            `;
        }

        fileTooltip.innerHTML = html;

        // Now show the tooltip with data ready
        if (currentTooltipEvent) {
            positionTooltip(currentTooltipEvent);
        }
        fileTooltip.classList.add('visible');
    }

    /**
     * Hide tooltip
     */
    function hideFileTooltip() {
        // Clear any existing timer
        if (tooltipShowTimer) {
            clearTimeout(tooltipShowTimer);
            tooltipShowTimer = null;
        }

        // Cancel any pending request
        if (tooltipRequestController) {
            tooltipRequestController.abort();
            tooltipRequestController = null;
        }

        // Clear current item
        currentTooltipItem = null;
        currentTooltipEvent = null;

        if (fileTooltip) {
            fileTooltip.classList.remove('visible');
        }
    }

    /**
     * Position tooltip near mouse cursor
     * @param {MouseEvent} event - Mouse event
     */
    function positionTooltip(event) {
        if (!fileTooltip) return;

        const offset = 10;
        let x = event.clientX + offset;
        let y = event.clientY + offset;

        // Ensure tooltip doesn't go off-screen
        const rect = fileTooltip.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        // Adjust horizontal position if needed
        if (x + rect.width > windowWidth) {
            x = event.clientX - rect.width - offset;
        }

        // Adjust vertical position if needed
        if (y + rect.height > windowHeight) {
            y = event.clientY - rect.height - offset;
        }

        fileTooltip.style.left = `${x}px`;
        fileTooltip.style.top = `${y}px`;
    }

    // ===== 文件树渲染 =====
    /**
     * @param {string} panel - 'local' | 'remote'
     * @param {Array<Object>} nodes - 文件节点数组
     */
    function renderFileTree(panel, nodes) {
        // 取消可能存在的加载定时器
        cancelLoading(panel);

        const treeContainer = document.getElementById(`${panel}-tree`);
        if (!treeContainer) return;

        // Apply view mode class
        const currentViewMode = viewMode[panel] || 'list';
        console.log(`[ViewMode] Rendering ${panel} tree with view mode:`, currentViewMode);
        if (currentViewMode === 'grid') {
            treeContainer.classList.add('grid-view');
            treeContainer.setAttribute('data-thumbnail-size', thumbnailSize.toString());
            console.log(`[ViewMode] Applied grid-view class to ${panel}-tree`);
        } else {
            treeContainer.classList.remove('grid-view');
            treeContainer.removeAttribute('data-thumbnail-size');
            console.log(`[ViewMode] Removed grid-view class from ${panel}-tree`);
        }

        // 清空搜索框
        const searchInput = document.getElementById(`${panel}-search`);
        if (searchInput) {
            searchInput.value = '';
        }

        // 清空内容 (保留列头)
        Array.from(treeContainer.children).forEach(child => {
            if (!child.classList.contains('file-tree-header')) {
                child.remove();
            }
        });

        // 排序节点
        const sortedNodes = sortFileList(nodes, panel);

        // 添加返回上一级按钮(如果不是根目录)
        const currentPath = panel === 'local' ? currentLocalPath : currentRemotePath;
        if (currentPath && currentPath !== '/' && currentPath !== '' && currentPath !== 'drives://') {
            const backItem = createBackItem(panel);
            treeContainer.appendChild(backItem);
        }

        // 渲染当前目录的所有文件和文件夹
        sortedNodes.forEach(node => {
            const item = createTreeItem(node, panel);
            treeContainer.appendChild(item);
        });

        // 更新列头排序指示器
        updateColumnHeaders(panel);

        // Update footer stats (total items)
        updateFooterStats(panel);
    }

    /**
     * 创建返回上一级按钮
     * @param {string} panel
     * @returns {HTMLElement}
     */
    function createBackItem(panel) {
        const item = document.createElement('div');
        item.className = 'tree-item back-item';
        // 添加必要的data属性以保持一致性
        item.dataset.name = '..';
        item.dataset.isDir = 'true';
        item.dataset.modifiedTime = '0';
        item.dataset.size = '0';

        // Icon placeholder (keep for alignment)
        const icon = document.createElement('span');
        icon.className = 'tree-item-icon';
        item.appendChild(icon);

        // Label
        const label = document.createElement('span');
        label.className = 'tree-item-label';
        label.textContent = '..';
        item.appendChild(label);

        // 添加空列以保持对齐
        const time = document.createElement('span');
        time.className = 'tree-item-time';
        time.textContent = '';
        item.appendChild(time);

        const permissions = document.createElement('span');
        permissions.className = 'tree-item-permissions';
        permissions.textContent = '';
        item.appendChild(permissions);

        const size = document.createElement('span');
        size.className = 'tree-item-size';
        size.textContent = '';
        item.appendChild(size);

        // Click to go back
        item.addEventListener('click', () => {
            const currentPath = panel === 'local' ? currentLocalPath : currentRemotePath;
            const parentPath = getParentPath(currentPath, panel);
            if (parentPath) {
                loadDirectory(panel, parentPath);
            }
        });

        return item;
    }

    /**
     * @param {Object} node - 文件节点
     * @param {string} panel - 'local' | 'remote'
     * @returns {HTMLElement}
     */
    function createTreeItem(node, panel) {
        const item = document.createElement('div');
        item.className = 'tree-item';
        item.dataset.path = node.path;
        item.dataset.isDir = node.isDirectory.toString();
        item.dataset.panel = panel;
        item.dataset.name = node.name;
        item.dataset.type = node.isDirectory ? 'directory' : 'file';
        // 将modifiedTime转换为timestamp数字用于排序
        item.dataset.modifiedTime = node.modifiedTime ? new Date(node.modifiedTime).getTime().toString() : '0';
        item.dataset.size = (node.size || 0).toString(); // 保存原始大小用于排序

        // VS Code Native Context Menu
        const contextData = {
            webviewSection: panel === 'local' ? 'localFile' : 'remoteFile',
            filePath: node.path,
            fileName: node.name,
            isDirectory: node.isDirectory,
            isFile: !node.isDirectory,
            panel: panel,
            hasFileSelectedForCompare: fileSelectedForCompare !== null,
            isFileSelectedForCompare: fileSelectedForCompare?.path === node.path,
            preventDefaultContextMenuItems: true
        };
        item.dataset.vscodeContext = JSON.stringify(contextData);

        // Icon
        const icon = document.createElement('span');
        icon.className = `codicon tree-item-icon ${getFileIcon(node)}`;
        item.appendChild(icon);

        // Label
        const label = document.createElement('span');
        label.className = 'tree-item-label';
        label.textContent = node.name;
        item.appendChild(label);

        // Modified time - 始终添加,保持列对齐
        const time = document.createElement('span');
        time.className = 'tree-item-time';
        time.textContent = node.modifiedTime ? formatTime(node.modifiedTime) : '';
        item.appendChild(time);

        // Permissions - 始终添加,保持列对齐
        const permissions = document.createElement('span');
        permissions.className = 'tree-item-permissions';
        if (node.permissions) {
            permissions.textContent = node.permissions;
            permissions.title = `Mode: ${node.mode ? node.mode.toString(8) : 'N/A'}`;
        }
        item.appendChild(permissions);

        // Size (for files) or placeholder (for folders)
        const size = document.createElement('span');
        size.className = 'tree-item-size';
        if (!node.isDirectory && node.size !== undefined) {
            size.textContent = formatFileSize(node.size);
        } else {
            size.textContent = '-';  // 文件夹显示占位符
        }
        item.appendChild(size);

        // Apply grid view layout if enabled
        const currentViewMode = viewMode[panel] || 'list';
        if (currentViewMode === 'grid') {
            // Clear list view structure
            item.innerHTML = '';

            // Create grid view icon container
            const iconContainer = document.createElement('div');
            iconContainer.className = 'grid-view-icon-container';

            // Check if this is an image file for thumbnail
            const isImage = !node.isDirectory && isImageFile(node.name);

            if (isImage) {
                // Create thumbnail image element
                const thumbnail = document.createElement('img');
                thumbnail.className = 'tree-item-thumbnail';
                thumbnail.alt = node.name;
                thumbnail.dataset.path = node.path;

                // Store data for lazy loading
                thumbnail.dataset.thumbnailPath = node.path;
                thumbnail.dataset.thumbnailPanel = panel;
                if (node.size !== undefined) {
                    thumbnail.dataset.thumbnailFilesize = node.size.toString();
                }

                // Add loading indicator
                const loadingIcon = document.createElement('span');
                loadingIcon.className = 'codicon codicon-loading thumbnail-loading';
                iconContainer.appendChild(loadingIcon);

                // Observe thumbnail for lazy loading
                if (thumbnailObserver) {
                    thumbnailObserver.observe(thumbnail);
                }

                iconContainer.appendChild(thumbnail);
            } else {
                // Use icon for non-images
                const gridIcon = document.createElement('span');
                gridIcon.className = `codicon tree-item-icon ${getFileIcon(node)}`;
                iconContainer.appendChild(gridIcon);
            }

            item.appendChild(iconContainer);

            // Create grid view label section
            const labelContainer = document.createElement('div');
            labelContainer.className = 'grid-view-label';

            const gridLabel = document.createElement('span');
            gridLabel.className = 'tree-item-label';
            gridLabel.textContent = node.name;
            labelContainer.appendChild(gridLabel);

            // Show size for files in grid view
            if (!node.isDirectory && node.size !== undefined) {
                const gridSize = document.createElement('span');
                gridSize.className = 'tree-item-size';
                gridSize.textContent = formatFileSize(node.size);
                labelContainer.appendChild(gridSize);
            }

            item.appendChild(labelContainer);
        }

        // Event listeners
        item.addEventListener('click', (e) => {
            // 清除之前的单击定时器
            if (clickTimer) {
                clearTimeout(clickTimer);
                clickTimer = null;
                return; // 这是双击,不执行单击逻辑
            }

            // 设置单击延迟,等待可能的双击
            clickTimer = setTimeout(() => {
                selectItem(item, e.ctrlKey, e.shiftKey);
                clickTimer = null;
            }, 250);
        });

        item.addEventListener('dblclick', (e) => {
            // Hide tooltip when double-clicking
            hideFileTooltip();

            // 清除单击定时器
            if (clickTimer) {
                clearTimeout(clickTimer);
                clickTimer = null;
            }

            if (node.isDirectory) {
                // 双击文件夹进入
                loadDirectory(panel, node.path);
            } else {
                // 双击文件打开
                vscode.postMessage({
                    command: 'openFile',
                    data: { path: node.path, panel }
                });
            }
        });

        // Ensure item is selected on right-click (before context menu opens)
        item.addEventListener('contextmenu', (e) => {
            // Hide tooltip when context menu opens
            hideFileTooltip();

            // Cancel any pending click timer
            if (clickTimer) {
                clearTimeout(clickTimer);
                clickTimer = null;
            }

            // If the item is not already selected, select it immediately (single selection)
            if (!item.classList.contains('selected')) {
                console.log(`Right-click selecting item: ${node.path}`);
                selectItem(item, false, false);
            } else {
                console.log(`Item already selected: ${node.path}, total selected: ${selectedItems.length}`);
            }
        });

        // Tooltip on hover
        item.addEventListener('mouseenter', (e) => {
            showFileTooltip(item, e);
        });

        // Update tooltip position as mouse moves
        item.addEventListener('mousemove', (e) => {
            // Only update position if tooltip is not yet visible (during delay period)
            // Once visible, keep it fixed to prevent jittery movement
            if (!fileTooltip || !fileTooltip.classList.contains('visible')) {
                currentTooltipEvent = e;
            }
        });

        item.addEventListener('mouseleave', () => {
            // Check if tooltip is visible
            const isTooltipVisible = fileTooltip && fileTooltip.classList.contains('visible');

            if (!isTooltipVisible) {
                // Tooltip not shown yet, cancel it
                hideFileTooltip();
            } else {
                // Tooltip is visible, delay to allow mouse to enter tooltip if Alt is pressed
                setTimeout(() => {
                    // Only hide if Alt is not pressed or mouse is not on tooltip
                    if (!isAltKeyPressed || !isMouseOnTooltip) {
                        hideFileTooltip();
                    }
                }, 50); // Small delay to allow transition to tooltip
            }
        });

        // No mousemove handler - tooltip stays fixed at initial position

        return item;
    }

    // ===== 辅助函数 =====

    /**
     * Check if a file is an image based on extension
     * @param {string} filename
     * @returns {boolean}
     */
    function isImageFile(filename) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
        const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
        return imageExtensions.includes(ext);
    }

    /**
     * Request thumbnail from backend
     * @param {string} path - File path
     * @param {string} panel - Panel name
     * @param {HTMLImageElement} thumbnail - Thumbnail image element
     * @param {HTMLElement} loadingIcon - Loading icon element
     * @param {HTMLElement} iconContainer - Icon container element
     */
    function requestThumbnail(path, panel, thumbnail, loadingIcon, iconContainer, fileSize) {
        vscode.postMessage({
            command: 'generateThumbnail',
            data: {
                path,
                panel,
                size: thumbnailSize,
                fileSize: fileSize  // Pass file size for backend size check
            }
        });

        // Store reference for when thumbnail data arrives
        thumbnail.dataset.requestId = `${panel}:${path}`;

        // Set timeout to remove loading icon if thumbnail generation fails
        setTimeout(() => {
            if (loadingIcon.parentNode === iconContainer) {
                iconContainer.removeChild(loadingIcon);
            }
        }, 10000); // 10 second timeout
    }

    /**
     * Switch view mode for a panel
     * @param {string} panel - Panel name ('local' or 'remote')
     * @param {'list' | 'grid'} mode - View mode
     */
    function switchViewMode(panel, mode) {
        if (!panel || !mode) {
            console.error('Invalid switchViewMode parameters:', panel, mode);
            return;
        }

        console.log(`[ViewMode] Switching ${panel} panel to ${mode} view`);

        // Update view mode state
        viewMode[panel] = mode;
        console.log(`[ViewMode] Updated viewMode state:`, viewMode);

        // Update view mode button
        updateViewModeButton(panel, mode);

        // Save preference to VS Code settings
        vscode.postMessage({
            command: 'updateViewMode',
            data: { panel, mode }
        });

        // Re-render the current directory to apply new view mode
        const currentPath = panel === 'local' ? currentLocalPath : currentRemotePath;
        console.log(`[ViewMode] Current path for ${panel}:`, currentPath);
        if (currentPath) {
            // Request directory reload with unified loadDirectory command
            vscode.postMessage({
                command: 'loadDirectory',
                panel: panel,
                path: currentPath
            });
            console.log(`[ViewMode] Sent loadDirectory command for ${panel} panel`);
        }
    }

    /**
     * Toggle view mode button for a panel
     * @param {string} panel - Panel name ('local' or 'remote')
     */
    function toggleViewModeButton(panel) {
        const currentMode = viewMode[panel] || 'list';
        const newMode = currentMode === 'list' ? 'grid' : 'list';
        switchViewMode(panel, newMode);
    }

    /**
     * Update view mode button icon and title
     * @param {string} panel - Panel name ('local' or 'remote')
     * @param {'list' | 'grid'} mode - Current view mode
     */
    function updateViewModeButton(panel, mode) {
        const button = document.getElementById(`${panel}-view-toggle`);
        if (!button) {
            return;
        }

        const icon = button.querySelector('.codicon');
        if (!icon) {
            return;
        }

        if (mode === 'list') {
            // In list mode, show grid icon to indicate "switch to grid"
            icon.className = 'codicon codicon-symbol-array';
            button.title = 'Switch to Grid View';
        } else {
            // In grid mode, show list icon to indicate "switch to list"
            icon.className = 'codicon codicon-list-tree';
            button.title = 'Switch to List View';
        }
    }

    /**
     * Initialize Intersection Observer for lazy loading thumbnails
     */
    function initializeThumbnailObserver() {
        if (thumbnailObserver) {
            return; // Already initialized
        }

        thumbnailObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const thumbnail = entry.target;

                    // Check if thumbnail has data attributes set
                    const path = thumbnail.dataset.thumbnailPath;
                    const panel = thumbnail.dataset.thumbnailPanel;
                    const fileSize = thumbnail.dataset.thumbnailFilesize;

                    if (path && panel) {
                        // Find the loading icon and icon container
                        const iconContainer = thumbnail.parentElement;
                        const loadingIcon = iconContainer ? iconContainer.querySelector('.thumbnail-loading') : null;

                        // Request thumbnail from backend
                        requestThumbnail(path, panel, thumbnail, loadingIcon, iconContainer, fileSize ? Number.parseInt(fileSize, 10) : undefined);

                        // Stop observing this thumbnail
                        thumbnailObserver.unobserve(thumbnail);

                        // Clean up data attributes
                        delete thumbnail.dataset.thumbnailPath;
                        delete thumbnail.dataset.thumbnailPanel;
                        delete thumbnail.dataset.thumbnailFilesize;
                    }
                }
            });
        }, {
            root: null, // use viewport as root
            rootMargin: '50px', // load thumbnails 50px before they enter viewport
            threshold: 0.01 // trigger when even 1% is visible
        });
    }

    /**
     * 处理搜索框的键盘事件
     * @param {KeyboardEvent} e - 键盘事件
     * @param {string} panel - 'local' | 'remote'
     */
    function handleSearchKeydown(e, panel) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const treeContainer = document.getElementById(`${panel}-tree`);
            if (!treeContainer) return;

            // 获取所有可见的文件项(不包括返回上一级按钮)
            const visibleItems = Array.from(
                treeContainer.querySelectorAll('.tree-item:not(.back-item)')
            ).filter(item => item.style.display !== 'none');

            // 如果只有一个可见项
            if (visibleItems.length === 1) {
                const item = visibleItems[0];
                const isDirectory = item.dataset.isDir === 'true';
                const path = item.dataset.path;

                if (isDirectory) {
                    // 进入文件夹
                    loadDirectory(panel, path);
                } else {
                    // 选中文件
                    selectItem(item);
                }
            }
        }
    }

    /**
     * 筛选文件树
     * @param {string} panel - 'local' | 'remote'
     * @param {string} searchText - 搜索文本
     */
    function filterTree(panel, searchText) {
        const treeContainer = document.getElementById(`${panel}-tree`);
        if (!treeContainer) return;

        const items = treeContainer.querySelectorAll('.tree-item:not(.back-item)');
        const trimmedSearch = searchText.trim();
        const regexToggle = document.getElementById(`${panel}-regex-toggle`);
        const useRegex = regexToggle?.classList.contains('active');

        // 如果搜索文本为空，显示所有项
        if (trimmedSearch === '') {
            items.forEach(item => {
                item.style.display = 'flex';
            });
            updateFooterStats(panel);
            return;
        }

        let matcher;
        if (useRegex) {
            // 正则表达式模式
            try {
                matcher = new RegExp(trimmedSearch, 'i'); // 不区分大小写
            } catch (e) {
                // 正则表达式语法错误，回退到普通文本搜索
                console.warn('Invalid regex pattern:', trimmedSearch, e);
                const lowerSearchText = trimmedSearch.toLowerCase();
                matcher = { test: (str) => str.toLowerCase().includes(lowerSearchText) };
            }
        } else {
            // 普通文本搜索（不区分大小写）
            const lowerSearchText = trimmedSearch.toLowerCase();
            matcher = { test: (str) => str.toLowerCase().includes(lowerSearchText) };
        }

        items.forEach(item => {
            const label = item.querySelector('.tree-item-label')?.textContent || '';

            if (matcher.test(label)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });

        // Update footer stats
        updateFooterStats(panel);
    }

    /**
     * 获取父目录路径
     */
    function getParentPath(path, panel) {
        if (!path || path === '/' || path === '' || path === 'drives://') return null;

        if (panel === 'local') {
            // Windows: C:\Users\iwang -> C:\Users
            // Unix: /home/user -> /home
            const separator = path.includes('\\') ? '\\' : '/';
            const parts = path.split(separator).filter(p => p);

            // Windows: 如果当前已经是驱动器根目录 (如 "C:"), 返回驱动器列表标识
            if (parts.length === 1 && parts[0].match(/^[A-Za-z]:$/)) {
                return 'drives://';
            }

            if (parts.length === 0) return '/';
            parts.pop();
            if (parts.length === 0) return '/';

            if (path.startsWith(separator)) {
                return separator + parts.join(separator);
            }
            return parts.join(separator) + (parts.length === 1 && path.includes(':') ? separator : '');
        } else {
            // Remote paths are always Unix-style
            const parts = path.split('/').filter(p => p);
            if (parts.length === 0) return '/';
            parts.pop();
            if (parts.length === 0) return '/';
            return '/' + parts.join('/');
        }
    }

    /**
     * 加载目录内容
     */
    function loadDirectory(panel, path) {
        // 延迟显示加载状态(500ms后才显示,避免快速加载时的闪烁)
        scheduleLoading(panel);

        vscode.postMessage({
            command: panel === 'local' ? 'loadLocalDir' : 'loadRemoteDir',
            path: path
        });
    }

    /**
     * 安排延迟显示加载状态
     * @param {string} panel - 'local' | 'remote'
     */
    function scheduleLoading(panel) {
        // 清除之前的定时器(如果有)
        if (loadingTimers[panel]) {
            clearTimeout(loadingTimers[panel]);
        }

        // 设置新的定时器,500ms后显示加载状态
        loadingTimers[panel] = setTimeout(() => {
            showLoading(panel);
        }, 500);
    }

    /**
     * 取消加载状态显示
     * @param {string} panel - 'local' | 'remote'
     */
    function cancelLoading(panel) {
        if (loadingTimers[panel]) {
            clearTimeout(loadingTimers[panel]);
            delete loadingTimers[panel];
        }
    }

    /**
     * 显示加载状态
     * @param {string} panel - 'local' | 'remote'
     */
    function showLoading(panel) {
        const treeContainer = document.getElementById(`${panel}-tree`);
        if (!treeContainer) return;

        // 清空内容但保留表头
        Array.from(treeContainer.children).forEach(child => {
            if (!child.classList.contains('file-tree-header')) {
                child.remove();
            }
        });

        // 添加loading元素
        const loading = document.createElement('div');
        loading.className = 'loading';
        loading.innerHTML = `
            <span class="codicon codicon-loading codicon-modifier-spin"></span>
            Loading ${panel} files...
        `;
        treeContainer.appendChild(loading);
    }

    /**
     * @param {Object} node
     * @returns {string}
     */
    function getFileIcon(node) {
        // Windows 驱动器特殊图标
        if (node.isDirectory && node.name.match(/^[A-Za-z]:$/)) {
            return 'codicon-database';
        }

        if (node.isDirectory) {
            return 'codicon-folder';
        }

        // 特殊文件名匹配
        const fileName = node.name.toLowerCase();
        const specialFiles = {
            // Package managers
            'package.json': 'codicon-json',
            'package-lock.json': 'codicon-lock',
            'yarn.lock': 'codicon-lock',
            'pnpm-lock.yaml': 'codicon-lock',
            'bun.lockb': 'codicon-lock',
            'composer.json': 'codicon-json',
            'composer.lock': 'codicon-lock',
            'gemfile': 'codicon-ruby',
            'gemfile.lock': 'codicon-lock',
            'cargo.toml': 'codicon-package',
            'cargo.lock': 'codicon-lock',
            'go.mod': 'codicon-package',
            'go.sum': 'codicon-lock',
            'requirements.txt': 'codicon-python',
            'pipfile': 'codicon-python',
            'pipfile.lock': 'codicon-lock',
            'poetry.lock': 'codicon-lock',
            'pyproject.toml': 'codicon-python',

            // Config files - Build tools
            'tsconfig.json': 'codicon-settings-gear',
            'jsconfig.json': 'codicon-settings-gear',
            'webpack.config.js': 'codicon-settings-gear',
            'webpack.config.ts': 'codicon-settings-gear',
            'vite.config.js': 'codicon-settings-gear',
            'vite.config.ts': 'codicon-settings-gear',
            'vite.config.mjs': 'codicon-settings-gear',
            'rollup.config.js': 'codicon-settings-gear',
            'rollup.config.mjs': 'codicon-settings-gear',
            'esbuild.config.js': 'codicon-settings-gear',
            'turbo.json': 'codicon-settings-gear',
            'nx.json': 'codicon-settings-gear',

            // Config files - Babel
            'babel.config.js': 'codicon-settings-gear',
            'babel.config.json': 'codicon-settings-gear',
            '.babelrc': 'codicon-settings-gear',
            '.babelrc.js': 'codicon-settings-gear',
            '.babelrc.json': 'codicon-settings-gear',

            // Config files - ESLint
            'eslint.config.js': 'codicon-checklist',
            'eslint.config.mjs': 'codicon-checklist',
            '.eslintrc': 'codicon-checklist',
            '.eslintrc.js': 'codicon-checklist',
            '.eslintrc.json': 'codicon-checklist',
            '.eslintrc.yml': 'codicon-checklist',
            '.eslintrc.yaml': 'codicon-checklist',
            '.eslintignore': 'codicon-checklist',

            // Config files - Prettier
            '.prettierrc': 'codicon-symbol-color',
            '.prettierrc.js': 'codicon-symbol-color',
            '.prettierrc.json': 'codicon-symbol-color',
            '.prettierrc.yml': 'codicon-symbol-color',
            '.prettierrc.yaml': 'codicon-symbol-color',
            'prettier.config.js': 'codicon-symbol-color',
            '.prettierignore': 'codicon-symbol-color',

            // Config files - StyleLint
            '.stylelintrc': 'codicon-symbol-color',
            '.stylelintrc.js': 'codicon-symbol-color',
            '.stylelintrc.json': 'codicon-symbol-color',
            'stylelint.config.js': 'codicon-symbol-color',

            // Config files - Testing
            'vitest.config.js': 'codicon-beaker',
            'vitest.config.ts': 'codicon-beaker',
            'jest.config.js': 'codicon-beaker',
            'jest.config.ts': 'codicon-beaker',
            'karma.conf.js': 'codicon-beaker',
            'playwright.config.js': 'codicon-beaker',
            'playwright.config.ts': 'codicon-beaker',
            'cypress.config.js': 'codicon-beaker',
            'cypress.config.ts': 'codicon-beaker',

            // Config files - Framework specific
            'next.config.js': 'codicon-settings-gear',
            'next.config.mjs': 'codicon-settings-gear',
            'nuxt.config.js': 'codicon-settings-gear',
            'nuxt.config.ts': 'codicon-settings-gear',
            'astro.config.js': 'codicon-settings-gear',
            'astro.config.mjs': 'codicon-settings-gear',
            'svelte.config.js': 'codicon-settings-gear',
            'remix.config.js': 'codicon-settings-gear',
            'gatsby-config.js': 'codicon-settings-gear',
            'vue.config.js': 'codicon-settings-gear',
            'angular.json': 'codicon-settings-gear',

            // Config files - TypeScript
            'tsconfig.build.json': 'codicon-settings-gear',
            'tsconfig.node.json': 'codicon-settings-gear',
            'tsconfig.app.json': 'codicon-settings-gear',

            // Config files - Other
            '.editorconfig': 'codicon-settings-gear',
            '.browserslistrc': 'codicon-browser',
            'browserslist': 'codicon-browser',
            'nodemon.json': 'codicon-settings-gear',
            '.npmrc': 'codicon-settings-gear',
            '.yarnrc': 'codicon-settings-gear',
            '.nvmrc': 'codicon-settings-gear',

            // Docker
            'docker-compose.yml': 'codicon-vm-active',
            'docker-compose.yaml': 'codicon-vm-active',
            'docker-compose.dev.yml': 'codicon-vm-active',
            'docker-compose.prod.yml': 'codicon-vm-active',
            'dockerfile': 'codicon-vm',
            'dockerfile.dev': 'codicon-vm',
            'dockerfile.prod': 'codicon-vm',
            '.dockerignore': 'codicon-vm',
            'compose.yml': 'codicon-vm-active',
            'compose.yaml': 'codicon-vm-active',

            // README and docs
            'readme.md': 'codicon-book',
            'readme': 'codicon-book',
            'readme.txt': 'codicon-book',
            'changelog.md': 'codicon-versions',
            'changelog': 'codicon-versions',
            'history.md': 'codicon-versions',
            'license': 'codicon-law',
            'license.md': 'codicon-law',
            'license.txt': 'codicon-law',
            'contributing.md': 'codicon-organization',
            'contributors.md': 'codicon-organization',
            'contributors': 'codicon-organization',
            'authors': 'codicon-organization',
            'authors.md': 'codicon-organization',
            'code_of_conduct.md': 'codicon-law',
            'security.md': 'codicon-shield',
            'support.md': 'codicon-comment',
            'funding.yml': 'codicon-heart',

            // Git
            '.gitignore': 'codicon-git-commit',
            '.gitattributes': 'codicon-git-commit',
            '.gitmodules': 'codicon-git-commit',
            '.gitkeep': 'codicon-git-commit',
            '.gitconfig': 'codicon-settings-gear',
            '.mailmap': 'codicon-git-commit',

            // GitHub
            '.github/workflows': 'codicon-github-action',
            'dependabot.yml': 'codicon-github',
            'pull_request_template.md': 'codicon-git-pull-request',

            // CI/CD
            '.travis.yml': 'codicon-build',
            'jenkinsfile': 'codicon-build',
            '.gitlab-ci.yml': 'codicon-build',
            'azure-pipelines.yml': 'codicon-build',
            '.circleci/config.yml': 'codicon-build',
            'bitbucket-pipelines.yml': 'codicon-build',
            '.drone.yml': 'codicon-build',
            'appveyor.yml': 'codicon-build',

            // Environment
            '.env': 'codicon-settings',
            '.env.local': 'codicon-settings',
            '.env.development': 'codicon-settings',
            '.env.production': 'codicon-settings',
            '.env.test': 'codicon-settings',
            '.env.staging': 'codicon-settings',
            '.env.example': 'codicon-settings',
            '.env.sample': 'codicon-settings',

            // VSCode
            'launch.json': 'codicon-debug',
            'tasks.json': 'codicon-tasklist',
            'settings.json': 'codicon-settings-gear',
            'extensions.json': 'codicon-extensions',

            // Other important files
            'makefile': 'codicon-tools',
            'rakefile': 'codicon-ruby',
            'gruntfile.js': 'codicon-settings-gear',
            'gulpfile.js': 'codicon-settings-gear',
            'procfile': 'codicon-server',
            '.htaccess': 'codicon-settings-gear',
            'nginx.conf': 'codicon-server',
            'apache.conf': 'codicon-server',
        };

        if (specialFiles[fileName]) {
            return specialFiles[fileName];
        }

        const ext = node.name.split('.').pop()?.toLowerCase();
        const iconMap = {
            // JavaScript/TypeScript
            'js': 'codicon-file-code',
            'jsx': 'codicon-file-code',
            'ts': 'codicon-file-code',
            'tsx': 'codicon-file-code',
            'mjs': 'codicon-file-code',
            'cjs': 'codicon-file-code',
            'mts': 'codicon-file-code',
            'cts': 'codicon-file-code',

            // Frontend frameworks
            'vue': 'codicon-file-code',
            'svelte': 'codicon-file-code',
            'astro': 'codicon-file-code',

            // Data formats
            'json': 'codicon-json',
            'json5': 'codicon-json',
            'jsonc': 'codicon-json',
            'xml': 'codicon-code',
            'yaml': 'codicon-symbol-key',
            'yml': 'codicon-symbol-key',
            'toml': 'codicon-symbol-key',
            'ini': 'codicon-symbol-key',
            'conf': 'codicon-settings-gear',
            'config': 'codicon-settings-gear',
            'properties': 'codicon-symbol-key',
            'csv': 'codicon-graph',
            'tsv': 'codicon-graph',
            'parquet': 'codicon-database',
            'avro': 'codicon-database',
            'proto': 'codicon-code',
            'protobuf': 'codicon-code',

            // Markup/Documentation
            'md': 'codicon-markdown',
            'mdx': 'codicon-markdown',
            'markdown': 'codicon-markdown',
            'html': 'codicon-code',
            'htm': 'codicon-code',
            'xhtml': 'codicon-code',
            'shtml': 'codicon-code',
            'pug': 'codicon-code',
            'jade': 'codicon-code',
            'haml': 'codicon-code',
            'ejs': 'codicon-code',
            'erb': 'codicon-code',
            'hbs': 'codicon-code',
            'handlebars': 'codicon-code',
            'mustache': 'codicon-code',
            'njk': 'codicon-code',
            'nunjucks': 'codicon-code',
            'twig': 'codicon-code',
            'liquid': 'codicon-code',
            'txt': 'codicon-file-text',
            'text': 'codicon-file-text',
            'log': 'codicon-output',
            'pdf': 'codicon-file-pdf',
            'doc': 'codicon-file-text',
            'docx': 'codicon-file-text',
            'odt': 'codicon-file-text',
            'rtf': 'codicon-file-text',
            'tex': 'codicon-file-text',
            'latex': 'codicon-file-text',
            'rst': 'codicon-file-text',
            'asciidoc': 'codicon-file-text',
            'adoc': 'codicon-file-text',

            // Styling
            'css': 'codicon-symbol-color',
            'scss': 'codicon-symbol-color',
            'sass': 'codicon-symbol-color',
            'less': 'codicon-symbol-color',
            'styl': 'codicon-symbol-color',
            'stylus': 'codicon-symbol-color',
            'pcss': 'codicon-symbol-color',
            'postcss': 'codicon-symbol-color',

            // Programming languages - Python
            'py': 'codicon-python',
            'pyi': 'codicon-python',
            'pyw': 'codicon-python',
            'pyx': 'codicon-python',
            'pyd': 'codicon-file-binary',
            'pyc': 'codicon-file-binary',
            'pyo': 'codicon-file-binary',

            // Programming languages - Java/JVM
            'java': 'codicon-file-code',
            'kt': 'codicon-file-code',
            'kts': 'codicon-file-code',
            'scala': 'codicon-file-code',
            'groovy': 'codicon-file-code',
            'gradle': 'codicon-settings-gear',
            'class': 'codicon-file-binary',
            'jar': 'codicon-file-zip',
            'war': 'codicon-file-zip',
            'ear': 'codicon-file-zip',

            // Programming languages - C/C++
            'c': 'codicon-file-code',
            'cpp': 'codicon-file-code',
            'cc': 'codicon-file-code',
            'cxx': 'codicon-file-code',
            'c++': 'codicon-file-code',
            'h': 'codicon-file-code',
            'hpp': 'codicon-file-code',
            'hh': 'codicon-file-code',
            'hxx': 'codicon-file-code',
            'h++': 'codicon-file-code',
            'inl': 'codicon-file-code',
            'ipp': 'codicon-file-code',

            // Programming languages - C#/.NET
            'cs': 'codicon-file-code',
            'csx': 'codicon-file-code',
            'vb': 'codicon-file-code',
            'fs': 'codicon-file-code',
            'fsx': 'codicon-file-code',
            'fsi': 'codicon-file-code',

            // Programming languages - Go
            'go': 'codicon-file-code',

            // Programming languages - Rust
            'rs': 'codicon-file-code',
            'rlib': 'codicon-file-binary',

            // Programming languages - PHP
            'php': 'codicon-file-code',
            'phtml': 'codicon-file-code',
            'php3': 'codicon-file-code',
            'php4': 'codicon-file-code',
            'php5': 'codicon-file-code',
            'phps': 'codicon-file-code',

            // Programming languages - Ruby
            'rb': 'codicon-ruby',
            'rbw': 'codicon-ruby',
            'rake': 'codicon-ruby',
            'gemspec': 'codicon-ruby',

            // Programming languages - Swift/Obj-C
            'swift': 'codicon-file-code',
            'm': 'codicon-file-code',
            'mm': 'codicon-file-code',

            // Programming languages - Functional
            'hs': 'codicon-file-code',
            'lhs': 'codicon-file-code',
            'elm': 'codicon-file-code',
            'ml': 'codicon-file-code',
            'mli': 'codicon-file-code',
            'clj': 'codicon-file-code',
            'cljs': 'codicon-file-code',
            'cljc': 'codicon-file-code',
            'edn': 'codicon-file-code',

            // Programming languages - Erlang/Elixir
            'erl': 'codicon-file-code',
            'hrl': 'codicon-file-code',
            'ex': 'codicon-file-code',
            'exs': 'codicon-file-code',
            'eex': 'codicon-file-code',
            'heex': 'codicon-file-code',
            'leex': 'codicon-file-code',

            // Programming languages - Other
            'lua': 'codicon-file-code',
            'pl': 'codicon-file-code',
            'pm': 'codicon-file-code',
            'r': 'codicon-graph',
            'rmd': 'codicon-graph',
            'rdata': 'codicon-database',
            'rds': 'codicon-database',
            'dart': 'codicon-file-code',
            'zig': 'codicon-file-code',
            'nim': 'codicon-file-code',
            'nimble': 'codicon-file-code',
            'v': 'codicon-file-code',
            'vsh': 'codicon-file-code',
            'jl': 'codicon-file-code',
            'cr': 'codicon-file-code',

            // Shell/Scripts
            'sh': 'codicon-terminal-bash',
            'bash': 'codicon-terminal-bash',
            'zsh': 'codicon-terminal',
            'fish': 'codicon-terminal',
            'ksh': 'codicon-terminal',
            'csh': 'codicon-terminal',
            'tcsh': 'codicon-terminal',
            'ps1': 'codicon-terminal-powershell',
            'psm1': 'codicon-terminal-powershell',
            'psd1': 'codicon-terminal-powershell',
            'bat': 'codicon-terminal-cmd',
            'cmd': 'codicon-terminal-cmd',
            'awk': 'codicon-terminal',
            'sed': 'codicon-terminal',

            // Images - Raster
            'png': 'codicon-file-media',
            'jpg': 'codicon-file-media',
            'jpeg': 'codicon-file-media',
            'gif': 'codicon-file-media',
            'webp': 'codicon-file-media',
            'bmp': 'codicon-file-media',
            'tiff': 'codicon-file-media',
            'tif': 'codicon-file-media',
            'ico': 'codicon-file-media',
            'icns': 'codicon-file-media',
            'cur': 'codicon-file-media',
            'heic': 'codicon-file-media',
            'heif': 'codicon-file-media',
            'avif': 'codicon-file-media',
            'jxl': 'codicon-file-media',

            // Images - Vector & Design
            'svg': 'codicon-file-media',
            'eps': 'codicon-file-media',
            'ai': 'codicon-file-media',
            'psd': 'codicon-file-media',
            'psb': 'codicon-file-media',
            'sketch': 'codicon-file-media',
            'fig': 'codicon-file-media',
            'xd': 'codicon-file-media',
            'xcf': 'codicon-file-media',
            'raw': 'codicon-file-media',
            'cr2': 'codicon-file-media',
            'nef': 'codicon-file-media',
            'dng': 'codicon-file-media',

            // Audio
            'mp3': 'codicon-music',
            'wav': 'codicon-music',
            'flac': 'codicon-music',
            'aac': 'codicon-music',
            'ogg': 'codicon-music',
            'oga': 'codicon-music',
            'opus': 'codicon-music',
            'wma': 'codicon-music',
            'm4a': 'codicon-music',
            'aiff': 'codicon-music',
            'aif': 'codicon-music',
            'ape': 'codicon-music',
            'alac': 'codicon-music',
            'mid': 'codicon-music',
            'midi': 'codicon-music',

            // Video
            'mp4': 'codicon-play',
            'm4v': 'codicon-play',
            'avi': 'codicon-play',
            'mov': 'codicon-play',
            'mkv': 'codicon-play',
            'webm': 'codicon-play',
            'flv': 'codicon-play',
            'wmv': 'codicon-play',
            'mpg': 'codicon-play',
            'mpeg': 'codicon-play',
            'ogv': 'codicon-play',
            '3gp': 'codicon-play',
            'm3u8': 'codicon-play',

            // Archives - Common
            'zip': 'codicon-file-zip',
            'tar': 'codicon-file-zip',
            'gz': 'codicon-file-zip',
            'gzip': 'codicon-file-zip',
            'bz2': 'codicon-file-zip',
            'bzip2': 'codicon-file-zip',
            'xz': 'codicon-file-zip',
            'lz': 'codicon-file-zip',
            'lzma': 'codicon-file-zip',
            'zst': 'codicon-file-zip',
            'zstd': 'codicon-file-zip',
            'rar': 'codicon-file-zip',
            '7z': 'codicon-file-zip',
            'tgz': 'codicon-file-zip',
            'tbz': 'codicon-file-zip',
            'tbz2': 'codicon-file-zip',
            'txz': 'codicon-file-zip',
            'tlz': 'codicon-file-zip',

            // Archives - Packages
            'deb': 'codicon-package',
            'rpm': 'codicon-package',
            'apk': 'codicon-package',
            'dmg': 'codicon-package',
            'pkg': 'codicon-package',
            'msi': 'codicon-package',
            'exe': 'codicon-file-binary',
            'app': 'codicon-package',
            'AppImage': 'codicon-package',
            'snap': 'codicon-package',
            'flatpak': 'codicon-package',

            // Archives - Other
            'iso': 'codicon-file-zip',
            'img': 'codicon-file-zip',
            'vdi': 'codicon-vm',
            'vmdk': 'codicon-vm',
            'vhd': 'codicon-vm',
            'vhdx': 'codicon-vm',

            // Fonts
            'ttf': 'codicon-text-size',
            'otf': 'codicon-text-size',
            'woff': 'codicon-text-size',
            'woff2': 'codicon-text-size',
            'eot': 'codicon-text-size',
            'pfb': 'codicon-text-size',
            'pfm': 'codicon-text-size',

            // Database
            'sql': 'codicon-database',
            'psql': 'codicon-database',
            'mysql': 'codicon-database',
            'pgsql': 'codicon-database',
            'db': 'codicon-database',
            'sqlite': 'codicon-database',
            'sqlite3': 'codicon-database',
            'db3': 'codicon-database',
            'mdb': 'codicon-database',
            'accdb': 'codicon-database',
            'frm': 'codicon-database',
            'ibd': 'codicon-database',
            'dbf': 'codicon-database',

            // Binary/Executables
            'dll': 'codicon-file-binary',
            'so': 'codicon-file-binary',
            'dylib': 'codicon-file-binary',
            'o': 'codicon-file-binary',
            'obj': 'codicon-file-binary',
            'a': 'codicon-file-binary',
            'lib': 'codicon-file-binary',
            'wasm': 'codicon-file-binary',
            'bin': 'codicon-file-binary',
            'out': 'codicon-file-binary',
            'elf': 'codicon-file-binary',

            // Certificates & Keys
            'cert': 'codicon-shield',
            'pem': 'codicon-shield',
            'crt': 'codicon-shield',
            'cer': 'codicon-shield',
            'der': 'codicon-shield',
            'p12': 'codicon-shield',
            'pfx': 'codicon-shield',
            'p7b': 'codicon-shield',
            'p7c': 'codicon-shield',
            'key': 'codicon-key',
            'pub': 'codicon-key',
            'priv': 'codicon-key',
            'ppk': 'codicon-key',

            // Temporary & Cache
            'tmp': 'codicon-file',
            'temp': 'codicon-file',
            'cache': 'codicon-file',
            'bak': 'codicon-file',
            'backup': 'codicon-file',
            'swp': 'codicon-file',
            'swo': 'codicon-file',
            'DS_Store': 'codicon-file',

            // Misc
            'lock': 'codicon-lock',
            'pid': 'codicon-symbol-numeric',
            'gpg': 'codicon-shield',
            'asc': 'codicon-shield',
            'sig': 'codicon-shield',
            'torrent': 'codicon-cloud-download',
            'magnet': 'codicon-magnet',
        };

        return iconMap[ext || ''] || 'codicon-file';
    }

    /**
     * @param {number} bytes
     * @returns {string}
     */
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * 格式化时间为ISO格式(不带时区)
     * @param {Date|string} time
     * @returns {string}
     */
    function formatTime(time) {
        const date = typeof time === 'string' ? new Date(time) : time;
        // 格式: YYYY-MM-DD HH:mm:ss
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }



    // ===== Bookmark Dropdown =====
    /**
     * Toggle bookmark dropdown visibility
     */
    function toggleBookmarkDropdown() {
        const dropdown = document.getElementById('bookmark-dropdown');
        const toggleBtn = document.getElementById('bookmark-toggle');
        if (!dropdown || !toggleBtn) return;

        const isVisible = dropdown.style.display === 'flex';
        if (isVisible) {
            closeBookmarkDropdown();
        } else {
            openBookmarkDropdown();
        }
    }

    /**
     * Open bookmark dropdown
     */
    function openBookmarkDropdown() {
        const dropdown = document.getElementById('bookmark-dropdown');
        const toggleBtn = document.getElementById('bookmark-toggle');
        if (!dropdown || !toggleBtn) return;

        // Always request fresh bookmarks from backend before showing
        vscode.postMessage({
            command: 'getBookmarks'
        });

        // Show dropdown after requesting data
        dropdown.style.display = 'flex';
        toggleBtn.classList.add('active');
    }

    /**
     * Close bookmark dropdown
     */
    function closeBookmarkDropdown() {
        const dropdown = document.getElementById('bookmark-dropdown');
        const toggleBtn = document.getElementById('bookmark-toggle');
        if (!dropdown || !toggleBtn) return;

        dropdown.style.display = 'none';
        toggleBtn.classList.remove('active');
    }

    /**
     * Close breadcrumb dropdown
     */
    function closeBreadcrumbDropdown() {
        if (breadcrumbDropdown && breadcrumbDropdown.parentElement) {
            breadcrumbDropdown.parentElement.removeChild(breadcrumbDropdown);
            breadcrumbDropdown = null;
        }
    }

    /**
     * Show breadcrumb dropdown menu
     * @param {HTMLElement} segment - The breadcrumb segment element
     * @param {string} panel - 'local' | 'remote'
     * @param {string} path - The path to load directory contents from
     * @param {boolean} isRoot - Whether this is the root segment
     * @param {string} [highlightPath] - Optional path to highlight in the dropdown
     */
    async function showBreadcrumbDropdown(segment, panel, path, isRoot, highlightPath) {
        // Close any existing dropdown
        closeBreadcrumbDropdown();

        // Request directory listing from backend
        vscode.postMessage({
            command: 'getBreadcrumbDirectory',
            panel: panel,
            path: path,
            isRoot: isRoot,
            highlightPath: highlightPath || path
        });

        // Create and show dropdown (will be populated when backend responds)
        breadcrumbDropdown = document.createElement('div');
        breadcrumbDropdown.className = 'breadcrumb-dropdown';
        breadcrumbDropdown.dataset.panel = panel;
        breadcrumbDropdown.dataset.path = path;
        breadcrumbDropdown.dataset.highlightPath = highlightPath || path;
        breadcrumbDropdown.innerHTML = `
            <div class="breadcrumb-dropdown-loading">
                <span class="codicon codicon-loading codicon-modifier-spin"></span>
                Loading...
            </div>
        `;

        // Position dropdown below the segment
        const rect = segment.getBoundingClientRect();
        const breadcrumbContainer = segment.closest('.breadcrumb');
        if (!breadcrumbContainer) {
            return;
        }

        // Position dropdown below the breadcrumb container using fixed positioning
        // This avoids being clipped by overflow-y: hidden on breadcrumb container
        const containerRect = breadcrumbContainer.getBoundingClientRect();
        breadcrumbDropdown.style.position = 'fixed';
        breadcrumbDropdown.style.top = `${containerRect.bottom + 2}px`; // 2px gap below breadcrumb
        breadcrumbDropdown.style.left = `${rect.left}px`;
        breadcrumbDropdown.style.zIndex = '1000';

        // Add to body instead of breadcrumb container to avoid overflow hidden
        document.body.appendChild(breadcrumbDropdown);

        // ESC to close
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeBreadcrumbDropdown();
                document.removeEventListener('keydown', escHandler);
                document.removeEventListener('click', closeHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        // Click outside to close
        const closeHandler = (e) => {
            if (!breadcrumbDropdown || !breadcrumbDropdown.contains(e.target)) {
                closeBreadcrumbDropdown();
                document.removeEventListener('click', closeHandler);
                document.removeEventListener('keydown', escHandler);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeHandler);
        }, 10);
    }

    /**
     * Render breadcrumb dropdown content
     * @param {Object} data - Directory data from backend
     */
    function renderBreadcrumbDropdown(data) {
        if (!breadcrumbDropdown) {
            return;
        }

        const { panel, nodes, currentPath } = data;

        // Clear loading state
        breadcrumbDropdown.innerHTML = '';

        // Create scrollable list
        const list = document.createElement('div');
        list.className = 'breadcrumb-dropdown-list';

        // Sort: folders first, then files, alphabetically
        const folders = nodes.filter(n => n.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
        const files = nodes.filter(n => !n.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
        const allNodes = [...folders, ...files];

        allNodes.forEach(node => {
            const item = createBreadcrumbTreeItem(node, panel, currentPath, 0);
            list.appendChild(item);
        });

        breadcrumbDropdown.appendChild(list);
    }

    /**
     * Create breadcrumb tree item with expand/collapse support
     * @param {Object} node - File/folder node
     * @param {string} panel - 'local' | 'remote'
     * @param {string} currentPath - Current selected path
     * @param {number} level - Indent level (0 = root)
     */
    function createBreadcrumbTreeItem(node, panel, currentPath, level) {
        const item = document.createElement('div');
        item.className = 'breadcrumb-dropdown-item';
        item.style.paddingLeft = `${8 + level * 12}px`; // Indent based on level (更紧凑)
        item.dataset.path = node.path;
        item.dataset.isDirectory = node.isDirectory;

        if (node.path === currentPath) {
            item.classList.add('selected');
        }

        if (node.isDirectory) {
            // Folder with chevron for expand/collapse
            const chevron = document.createElement('span');
            chevron.className = 'codicon codicon-chevron-right breadcrumb-tree-chevron';
            chevron.title = 'Expand';

            // Click chevron to expand/collapse
            chevron.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleBreadcrumbTreeItem(item, node, panel, level);
            });
            item.appendChild(chevron);

            const icon = document.createElement('span');
            icon.className = 'codicon codicon-folder';
            item.appendChild(icon);

            const label = document.createElement('span');
            label.className = 'breadcrumb-dropdown-item-label';
            label.textContent = node.name;
            item.appendChild(label);

            // Click folder name to navigate or update search path
            label.addEventListener('click', () => {
                if (panel === 'remote' && isSearchViewVisible) {
                    // In search view: update search path and breadcrumb
                    const pathInput = document.getElementById('search-path-input');
                    if (pathInput) {
                        pathInput.value = node.path;
                        currentSearchPath = node.path;
                        currentRemotePath = node.path;
                        renderBreadcrumb('remote', node.path);
                        // Load directory in background for when user returns to file tree
                        loadDirectory('remote', node.path);
                    }
                } else {
                    // In file tree view: navigate
                    loadDirectory(panel, node.path);
                }
                closeBreadcrumbDropdown();
            });
        } else {
            // File (add spacer to align with folders)
            const spacer = document.createElement('span');
            spacer.className = 'breadcrumb-tree-spacer';
            item.appendChild(spacer);

            const icon = document.createElement('span');
            icon.className = 'codicon codicon-file';
            item.appendChild(icon);

            const label = document.createElement('span');
            label.className = 'breadcrumb-dropdown-item-label';
            label.textContent = node.name;
            item.appendChild(label);

            // Click file to navigate to parent directory or update search path
            item.addEventListener('click', () => {
                const separator = panel === 'local' && node.path.includes('\\') ? '\\' : '/';
                const parentPath = node.path.substring(0, node.path.lastIndexOf(separator));

                if (panel === 'remote' && isSearchViewVisible) {
                    // In search view: update search path to parent directory and breadcrumb
                    const pathInput = document.getElementById('search-path-input');
                    if (pathInput) {
                        pathInput.value = parentPath || '/';
                        currentSearchPath = parentPath || '/';
                        currentRemotePath = parentPath || '/';
                        renderBreadcrumb('remote', parentPath || '/');
                        // Load directory in background for when user returns to file tree
                        loadDirectory('remote', parentPath || '/');
                    }
                } else {
                    // In file tree view: navigate to parent
                    loadDirectory(panel, parentPath || '/');
                }
                closeBreadcrumbDropdown();
            });
        }

        return item;
    }

    /**
     * Toggle expand/collapse of breadcrumb tree item
     * @param {HTMLElement} item - The tree item element
     * @param {Object} node - File/folder node
     * @param {string} panel - 'local' | 'remote'
     * @param {number} level - Current indent level
     */
    function toggleBreadcrumbTreeItem(item, node, panel, level) {
        const chevron = item.querySelector('.breadcrumb-tree-chevron');
        const isExpanded = chevron.classList.contains('codicon-chevron-down');

        if (isExpanded) {
            // Collapse: remove children
            chevron.classList.remove('codicon-chevron-down');
            chevron.classList.add('codicon-chevron-right');
            chevron.title = 'Expand';

            // Remove all child items (next siblings with higher indent)
            let nextItem = item.nextElementSibling;
            while (nextItem && parseInt(nextItem.style.paddingLeft) > parseInt(item.style.paddingLeft)) {
                const toRemove = nextItem;
                nextItem = nextItem.nextElementSibling;
                toRemove.remove();
            }
        } else {
            // Expand: load and show children
            chevron.classList.remove('codicon-chevron-right');
            chevron.classList.add('codicon-chevron-down');
            chevron.title = 'Collapse';

            // Delay showing loading indicator to reduce visual clutter for fast operations
            const timerId = `${node.path}_${Date.now()}`;
            breadcrumbTreeLoadingTimers[timerId] = setTimeout(() => {
                // Only show loading if still pending (not already loaded)
                if (item.dataset.pendingExpansion === 'true') {
                    const loadingItem = document.createElement('div');
                    loadingItem.className = 'breadcrumb-dropdown-item breadcrumb-tree-loading';
                    loadingItem.style.paddingLeft = `${8 + (level + 1) * 12}px`;
                    loadingItem.innerHTML = '<span class="codicon codicon-loading codicon-modifier-spin"></span> Loading...';
                    loadingItem.dataset.timerId = timerId;

                    // Insert after current item
                    if (item.nextElementSibling) {
                        item.parentElement.insertBefore(loadingItem, item.nextElementSibling);
                    } else {
                        item.parentElement.appendChild(loadingItem);
                    }
                }
                delete breadcrumbTreeLoadingTimers[timerId];
            }, 500); // 500ms delay before showing loading

            // Request children from backend
            vscode.postMessage({
                command: 'getBreadcrumbTreeChildren',
                panel: panel,
                path: node.path,
                parentItemId: timerId
            });

            // Store context for when response arrives
            item.dataset.pendingExpansion = 'true';
            item.dataset.expansionLevel = level + 1;
            item.dataset.timerId = timerId;
        }
    }

    /**
     * Render breadcrumb tree children (for expansion)
     * @param {Object} data - Children data from backend
     */
    function renderBreadcrumbTreeChildren(data) {
        const { panel, parentPath, nodes } = data;

        // Find the parent item that requested this expansion
        const list = breadcrumbDropdown.querySelector('.breadcrumb-dropdown-list');
        if (!list) return;

        const parentItem = Array.from(list.querySelectorAll('.breadcrumb-dropdown-item')).find(
            item => item.dataset.path === parentPath && item.dataset.pendingExpansion === 'true'
        );

        if (!parentItem) return;

        // Cancel loading timer if still pending
        const timerId = parentItem.dataset.timerId;
        if (timerId && breadcrumbTreeLoadingTimers[timerId]) {
            clearTimeout(breadcrumbTreeLoadingTimers[timerId]);
            delete breadcrumbTreeLoadingTimers[timerId];
        }

        // Remove loading indicator if it was shown
        let nextItem = parentItem.nextElementSibling;
        if (nextItem && nextItem.classList.contains('breadcrumb-tree-loading')) {
            nextItem.remove();
        }

        // Clear pending flag
        delete parentItem.dataset.pendingExpansion;
        delete parentItem.dataset.timerId;
        const level = parseInt(parentItem.dataset.expansionLevel);

        if (!nodes || nodes.length === 0) {
            // Empty folder - no content to display
            return;
        }

        // Sort and create child items
        const folders = nodes.filter(n => n.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
        const files = nodes.filter(n => !n.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
        const allNodes = [...folders, ...files];

        // Insert children after parent
        const fragment = document.createDocumentFragment();
        allNodes.forEach(node => {
            const childItem = createBreadcrumbTreeItem(node, panel, '', level);
            fragment.appendChild(childItem);
        });

        // Insert all children at once
        if (parentItem.nextElementSibling) {
            list.insertBefore(fragment, parentItem.nextElementSibling);
        } else {
            list.appendChild(fragment);
        }
    }

    /**
     * Render bookmarks in dropdown
     * @param {Array<{name: string, path: string}>} bookmarks
     */
    function renderBookmarks(bookmarks) {
        currentBookmarks = bookmarks || [];
        const listContainer = document.getElementById('bookmark-list');
        if (!listContainer) {
            return;
        }

        if (currentBookmarks.length === 0) {
            listContainer.innerHTML = '<div class="bookmark-dropdown-empty">No bookmarks</div>';
            return;
        }

        listContainer.innerHTML = '';
        currentBookmarks.forEach(bookmark => {
            const item = document.createElement('div');
            item.className = 'bookmark-dropdown-item';
            item.innerHTML = `
                <div class="bookmark-dropdown-item-content">
                    <div class="bookmark-dropdown-item-name">${escapeHtml(bookmark.name)}</div>
                    <div class="bookmark-dropdown-item-path">${escapeHtml(bookmark.path)}</div>
                </div>
            `;
            item.addEventListener('click', () => {
                loadDirectory('remote', bookmark.path);
                closeBookmarkDropdown();
            });
            listContainer.appendChild(item);
        });
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} text
     * @returns {string}
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ===== Other Interactions =====
    /**
     * Select one or multiple items
     * @param {HTMLElement} item - Item to select
     * @param {boolean} ctrlKey - Ctrl key pressed (toggle selection)
     * @param {boolean} shiftKey - Shift key pressed (range selection)
     */
    function selectItem(item, ctrlKey = false, shiftKey = false) {
        const panel = item.dataset.panel;
        const treeContainer = document.getElementById(`${panel}-tree`);
        if (!treeContainer) return;

        // 获取所有文件项(不包括返回上一级按钮)
        const allItems = Array.from(
            treeContainer.querySelectorAll('.tree-item:not(.back-item)')
        );

        if (shiftKey && lastSelectedItem && lastSelectedItem.dataset.panel === panel) {
            // Shift+Click: 范围选择
            const lastIndex = allItems.indexOf(lastSelectedItem);
            const currentIndex = allItems.indexOf(item);

            if (lastIndex >= 0 && currentIndex >= 0) {
                const startIndex = Math.min(lastIndex, currentIndex);
                const endIndex = Math.max(lastIndex, currentIndex);

                // 如果没有按 Ctrl,先清除之前的选择
                if (!ctrlKey) {
                    selectedItems.forEach(i => i.classList.remove('selected'));
                    selectedItems = [];
                }

                // 选择范围内的所有项
                for (let i = startIndex; i <= endIndex; i++) {
                    const targetItem = allItems[i];
                    if (!targetItem.classList.contains('selected')) {
                        targetItem.classList.add('selected');
                        selectedItems.push(targetItem);
                    }
                }
            }
        } else if (ctrlKey) {
            // Ctrl+Click: 切换选择
            if (item.classList.contains('selected')) {
                item.classList.remove('selected');
                selectedItems = selectedItems.filter(i => i !== item);
            } else {
                item.classList.add('selected');
                selectedItems.push(item);
            }
            lastSelectedItem = item;
        } else {
            // 普通点击: 单选
            selectedItems.forEach(i => i.classList.remove('selected'));
            selectedItems = [item];
            item.classList.add('selected');
            lastSelectedItem = item;
        }

        // 更新 selectedItem (保持向后兼容)
        selectedItem = selectedItems.length > 0 ? selectedItems[0] : null;

        // Update context variables for menu visibility
        updateContextVariables();

        // Update footer stats
        updateFooterStats('local');
        updateFooterStats('remote');
    }

    /**
     * Select all items in a panel
     * @param {string} panel - 'local' | 'remote'
     */
    function selectAllInPanel(panel) {
        const treeContainer = document.getElementById(`${panel}-tree`);
        if (!treeContainer) return;

        // Get all visible file items (excluding back button and new folder items)
        const visibleItems = Array.from(
            treeContainer.querySelectorAll('.tree-item:not(.back-item):not(.new-folder-item)')
        ).filter(item => item.style.display !== 'none');

        // Clear current selection
        selectedItems.forEach(i => i.classList.remove('selected'));
        selectedItems = [];

        // Select all visible items
        visibleItems.forEach(item => {
            item.classList.add('selected');
            selectedItems.push(item);
        });

        // Update last selected item
        lastSelectedItem = visibleItems.length > 0 ? visibleItems[visibleItems.length - 1] : null;
        selectedItem = selectedItems.length > 0 ? selectedItems[0] : null;

        // Update context variables for menu visibility
        updateContextVariables();

        // Update footer stats
        updateFooterStats(panel);
    }

    /**
     * Clear all selections
     */
    function clearSelection() {
        selectedItems.forEach(i => i.classList.remove('selected'));
        selectedItems = [];
        selectedItem = null;
        lastSelectedItem = null;

        // Update context variables for menu visibility
        updateContextVariables();

        // Update footer stats
        updateFooterStats('local');
        updateFooterStats('remote');
    }

    /**
     * Update context variables for webview context menu
     */
    function updateContextVariables() {
        const hasMultiple = selectedItems.length > 1;

        // Update data-vscode-context on all selected items
        selectedItems.forEach(item => {
            const currentContext = item.dataset.vscodeContext ? JSON.parse(item.dataset.vscodeContext) : {};
            currentContext.hasMultipleSelection = hasMultiple;
            item.dataset.vscodeContext = JSON.stringify(currentContext);
        });
    }

    /**
     * Update diff button visibility based on selection
     */
    function updateDiffButtonState() {
        // Deprecated - using context menu instead
    }

    /**
     * Update all tree items' vscodeContext to reflect current compare selection state
     */
    function updateTreeItemsContext() {
        const allItems = document.querySelectorAll('.tree-item:not(.back-item)');
        allItems.forEach(item => {
            const isDirectory = item.dataset.isDir === 'true';
            const panel = item.dataset.panel;
            const filePath = item.dataset.path;
            const fileName = item.dataset.name;

            const contextData = {
                webviewSection: panel === 'local' ? 'localFile' : 'remoteFile',
                filePath: filePath,
                fileName: fileName,
                isDirectory: isDirectory,
                isFile: !isDirectory,
                panel: panel,
                hasFileSelectedForCompare: fileSelectedForCompare !== null,
                isFileSelectedForCompare: fileSelectedForCompare?.path === filePath,
                preventDefaultContextMenuItems: true
            };
            item.dataset.vscodeContext = JSON.stringify(contextData);
        });
    }

    /**
     * Navigate back to host selection page
     */
    function backToHostSelection() {
        vscode.postMessage({
            command: 'backToHostSelection'
        });
    }

    /**
     * Refresh panel content
     * @param {string} panel - 'local' | 'remote'
     */
    /**
     * Toggle panel maximize/restore state
     */
    let maximizedPanel = null; // Track which panel is maximized: 'local', 'remote', or null
    let savedLocalFlex = null; // Save local panel flex before maximize
    let savedRemoteFlex = null; // Save remote panel flex before maximize

    function togglePanelMaximize(panel) {
        const localPanel = document.querySelector('.local-panel');
        const remotePanel = document.querySelector('.remote-panel');
        const resizer = document.getElementById('resizer');
        const localMaxBtn = document.getElementById('maximize-local');
        const remoteMaxBtn = document.getElementById('maximize-remote');

        if (!localPanel || !remotePanel || !resizer || !localMaxBtn || !remoteMaxBtn) {
            return;
        }

        // If clicking the already maximized panel, restore to normal
        if (maximizedPanel === panel) {
            // Restore previous layout with saved flex values
            localPanel.style.flex = savedLocalFlex || '1';
            localPanel.style.display = 'flex';
            remotePanel.style.flex = savedRemoteFlex || '1';
            remotePanel.style.display = 'flex';
            resizer.style.display = 'flex';

            // Update button icons to "maximize"
            localMaxBtn.querySelector('.codicon').className = 'codicon codicon-screen-full';
            remoteMaxBtn.querySelector('.codicon').className = 'codicon codicon-screen-full';
            localMaxBtn.title = 'Maximize Panel';
            remoteMaxBtn.title = 'Maximize Panel';

            maximizedPanel = null;
            savedLocalFlex = null;
            savedRemoteFlex = null;
        } else {
            // Save current flex values before maximizing
            savedLocalFlex = getComputedStyle(localPanel).flex;
            savedRemoteFlex = getComputedStyle(remotePanel).flex;

            // Maximize the selected panel
            if (panel === 'local') {
                localPanel.style.flex = '1';
                localPanel.style.display = 'flex';
                remotePanel.style.flex = '0';
                remotePanel.style.display = 'none';
                localMaxBtn.querySelector('.codicon').className = 'codicon codicon-screen-normal';
                localMaxBtn.title = 'Restore Panel';
                remoteMaxBtn.querySelector('.codicon').className = 'codicon codicon-screen-full';
                remoteMaxBtn.title = 'Maximize Panel';
            } else {
                remotePanel.style.flex = '1';
                remotePanel.style.display = 'flex';
                localPanel.style.flex = '0';
                localPanel.style.display = 'none';
                remoteMaxBtn.querySelector('.codicon').className = 'codicon codicon-screen-normal';
                remoteMaxBtn.title = 'Restore Panel';
                localMaxBtn.querySelector('.codicon').className = 'codicon codicon-screen-full';
                localMaxBtn.title = 'Maximize Panel';
            }

            resizer.style.display = 'none';
            maximizedPanel = panel;
        }
    }

    function refreshPanel(panel) {
        // 延迟显示加载状态(500ms后才显示,避免快速加载时的闪烁)
        scheduleLoading(panel);

        // 传递当前路径给后端
        const currentPath = panel === 'local' ? currentLocalPath : currentRemotePath;

        vscode.postMessage({
            command: panel === 'local' ? 'refreshLocal' : 'refreshRemote',
            path: currentPath
        });
    }

    function createFolder(panel) {
        const treeContainer = document.getElementById(`${panel}-tree`);
        if (!treeContainer) return;

        // 移除已存在的新建项(如果有)
        const existingWrapper = treeContainer.querySelector('.new-folder-wrapper');
        if (existingWrapper) {
            existingWrapper.remove();
        }

        // 创建包装容器
        const wrapper = document.createElement('div');
        wrapper.className = 'new-folder-wrapper';

        // 创建新的内联编辑项
        const newItem = document.createElement('div');
        newItem.className = 'tree-item new-folder-item';

        // Icon
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-folder tree-item-icon';
        newItem.appendChild(icon);

        // Input
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tree-item-input';
        input.placeholder = 'Folder name or path (e.g., parent/child)';
        newItem.appendChild(input);

        // 将项添加到包装容器
        wrapper.appendChild(newItem);

        // Error message (在项外面)
        const errorMsg = document.createElement('div');
        errorMsg.className = 'tree-item-error';
        errorMsg.style.display = 'none';
        wrapper.appendChild(errorMsg);

        // 插入到文件树顶部(返回上一级按钮之后)
        const backItem = treeContainer.querySelector('.back-item');
        if (backItem && backItem.nextSibling) {
            treeContainer.insertBefore(wrapper, backItem.nextSibling);
        } else if (backItem) {
            treeContainer.appendChild(wrapper);
        } else {
            treeContainer.insertBefore(wrapper, treeContainer.firstChild);
        }

        // 聚焦输入框
        input.focus();

        /**
         * 验证文件夹名称
         * @param {string} name - 文件夹名称或路径
         * @returns {string|null} - 错误信息或null
         */
        const validateFolderName = (name) => {
            // 空名称
            if (!name || name.trim().length === 0) {
                return 'A file or folder name must be provided';
            }

            // 分割路径
            const parts = name.split('/').filter(p => p.trim());

            // 检查每个部分
            for (const part of parts) {
                // 不能以点开头或结尾
                if (part.startsWith('.') || part.endsWith('.')) {
                    return String.raw`Folder name "${part}" cannot start or end with a period`;
                }

                // 不能只包含点和空格
                if (/^[.\s]+$/.test(part)) {
                    return String.raw`Folder name "${part}" cannot consist only of periods and spaces`;
                }

                // Windows/Linux 禁用字符 (允许 / 用于多级创建,不允许 \)
                const invalidChars = /[\\:*?"<>|]/;
                if (invalidChars.test(part)) {
                    return String.raw`Folder name "${part}" cannot contain: \ : * ? " < > |`;
                }

                // Windows 保留名称
                const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
                if (reservedNames.test(part.trim())) {
                    return String.raw`"${part}" is reserved by the system`;
                }

                // 长度限制
                if (part.length > 255) {
                    return String.raw`Folder name "${part}" is too long (maximum 255 characters)`;
                }
            }

            return null; // 验证通过
        };

        // 实时验证
        input.addEventListener('input', () => {
            const error = validateFolderName(input.value);
            if (error) {
                errorMsg.textContent = error;
                errorMsg.style.display = 'block';
                input.classList.add('has-error');
            } else {
                errorMsg.style.display = 'none';
                input.classList.remove('has-error');
            }
        });

        // 处理输入框事件
        const finishCreation = async (confirm) => {
            if (confirm && input.value.trim()) {
                const folderName = input.value.trim();

                // 最终验证
                const error = validateFolderName(folderName);
                if (error) {
                    errorMsg.textContent = error;
                    errorMsg.style.display = 'block';
                    input.classList.add('has-error');
                    input.focus();
                    return;
                }

                // 发送创建请求
                const currentPath = panel === 'local' ? currentLocalPath : currentRemotePath;
                vscode.postMessage({
                    command: 'createFolder',
                    data: {
                        parentPath: currentPath,
                        name: folderName,
                        panel: panel
                    }
                });
            }

            // 移除输入项
            wrapper.remove();
        };

        // Enter 确认
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                finishCreation(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishCreation(false);
            }
        });

        // 失去焦点时取消
        input.addEventListener('blur', () => {
            setTimeout(() => finishCreation(false), 150);
        });
    }

    function createFile(panel) {
        const treeContainer = document.getElementById(`${panel}-tree`);
        if (!treeContainer) return;

        // 移除已存在的新建项(如果有)
        const existingWrapper = treeContainer.querySelector('.new-file-wrapper');
        if (existingWrapper) {
            existingWrapper.remove();
        }

        // 创建包装容器
        const wrapper = document.createElement('div');
        wrapper.className = 'new-file-wrapper';

        // 创建新的内联编辑项
        const newItem = document.createElement('div');
        newItem.className = 'tree-item new-file-item';

        // Icon
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-file tree-item-icon';
        newItem.appendChild(icon);

        // Input
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tree-item-input';
        input.placeholder = 'File name (e.g., example.txt)';
        newItem.appendChild(input);

        // 将项添加到包装容器
        wrapper.appendChild(newItem);

        // Error message (在项外面)
        const errorMsg = document.createElement('div');
        errorMsg.className = 'tree-item-error';
        errorMsg.style.display = 'none';
        wrapper.appendChild(errorMsg);

        // 插入到文件树顶部(返回上一级按钮之后)
        const backItem = treeContainer.querySelector('.back-item');
        if (backItem && backItem.nextSibling) {
            treeContainer.insertBefore(wrapper, backItem.nextSibling);
        } else if (backItem) {
            treeContainer.appendChild(wrapper);
        } else {
            treeContainer.insertBefore(wrapper, treeContainer.firstChild);
        }

        // 聚焦输入框
        input.focus();

        /**
         * 验证文件名称
         * @param {string} name - 文件名称
         * @returns {string|null} - 错误信息或null
         */
        const validateFileName = (name) => {
            // 空名称
            if (!name || name.trim().length === 0) {
                return 'A file name must be provided';
            }

            const trimmedName = name.trim();

            // 不允许路径分隔符(文件必须在当前目录创建)
            if (trimmedName.includes('/') || trimmedName.includes('\\')) {
                return String.raw`File name cannot contain path separators (/ or \)`;
            }

            // 不能以点开头或结尾
            if (trimmedName.startsWith('.') || trimmedName.endsWith('.')) {
                return 'File name cannot start or end with a period';
            }

            // 不能只包含点和空格
            if (/^[.\s]+$/.test(trimmedName)) {
                return 'File name cannot consist only of periods and spaces';
            }

            // Windows/Linux 禁用字符
            const invalidChars = /[\\/:*?"<>|]/;
            if (invalidChars.test(trimmedName)) {
                return String.raw`File name cannot contain: \ / : * ? " < > |`;
            }

            // Windows 保留名称
            const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
            const nameWithoutExt = trimmedName.split('.')[0];
            if (reservedNames.test(nameWithoutExt)) {
                return `"${nameWithoutExt}" is reserved by the system`;
            }

            // 长度限制
            if (trimmedName.length > 255) {
                return 'File name is too long (maximum 255 characters)';
            }

            return null; // 验证通过
        };

        // 实时验证
        input.addEventListener('input', () => {
            const error = validateFileName(input.value);
            if (error) {
                errorMsg.textContent = error;
                errorMsg.style.display = 'block';
                input.classList.add('has-error');
            } else {
                errorMsg.style.display = 'none';
                input.classList.remove('has-error');
            }
        });

        // 处理输入框事件
        const finishCreation = async (confirm) => {
            if (confirm && input.value.trim()) {
                const fileName = input.value.trim();

                // 最终验证
                const error = validateFileName(fileName);
                if (error) {
                    errorMsg.textContent = error;
                    errorMsg.style.display = 'block';
                    input.classList.add('has-error');
                    input.focus();
                    return;
                }

                // 发送创建请求
                const currentPath = panel === 'local' ? currentLocalPath : currentRemotePath;
                vscode.postMessage({
                    command: 'createFile',
                    data: {
                        parentPath: currentPath,
                        name: fileName,
                        panel: panel
                    }
                });
            }

            // 移除输入项
            wrapper.remove();
        };

        // Enter 确认
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                finishCreation(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishCreation(false);
            }
        });

        // 失去焦点时取消
        input.addEventListener('blur', () => {
            setTimeout(() => finishCreation(false), 150);
        });
    }

    function uploadSelected() {
        const localItems = selectedItems.filter(item => item.dataset.panel === 'local');
        if (localItems.length === 0) {
            console.warn('No local items selected for upload');
            return;
        }

        console.log(`Uploading ${localItems.length} item(s)`);

        if (localItems.length === 1) {
            // Single item upload (backward compatible)
            vscode.postMessage({
                command: 'upload',
                data: { localPath: localItems[0].dataset.path, remotePath: currentRemotePath }
            });
        } else {
            // Batch upload
            const paths = localItems.map(item => item.dataset.path);
            vscode.postMessage({
                command: 'batchUpload',
                data: { localPaths: paths, remotePath: currentRemotePath }
            });
        }
    }

    function downloadSelected() {
        const remoteItems = selectedItems.filter(item => item.dataset.panel === 'remote');
        if (remoteItems.length === 0) {
            console.warn('No remote items selected for download');
            return;
        }

        console.log(`Downloading ${remoteItems.length} item(s)`);

        if (remoteItems.length === 1) {
            // Single item download (backward compatible)
            vscode.postMessage({
                command: 'download',
                data: { remotePath: remoteItems[0].dataset.path, localPath: currentLocalPath }
            });
        } else {
            // Batch download
            const paths = remoteItems.map(item => item.dataset.path);
            vscode.postMessage({
                command: 'batchDownload',
                data: { remotePaths: paths, localPath: currentLocalPath }
            });
        }
    }

    /**
     * Batch rename selected files
     * @param {string} panel - 'local' or 'remote'
     */
    function batchRenameSelected(panel) {
        console.log(`batchRenameSelected called with panel: ${panel}`);
        console.log(`selectedItems count: ${selectedItems.length}`);
        console.log('selectedItems:', selectedItems.map(item => ({
            panel: item.dataset.panel,
            path: item.dataset.path,
            name: item.querySelector('.tree-item-label')?.textContent
        })));

        // Filter selected items by panel (both files and folders)
        const items = selectedItems.filter(item =>
            item.dataset.panel === panel
        );

        console.log(`filtered items count: ${items.length}`);

        if (items.length === 0) {
            vscode.postMessage({
                command: 'showError',
                message: 'No items selected for batch rename'
            });
            return;
        }

        // Collect file and folder information
        const files = items.map(item => ({
            path: item.dataset.path,
            name: item.querySelector('.tree-item-label')?.textContent || '',
            panel: panel,
            isDirectory: item.dataset.isDir === 'true'
        }));

        // Open batch rename modal
        openBatchRenameModal(files);
    }

    /**
     * Start inline rename for selected item (similar to VS Code Explorer)
     */
    function startInlineRename() {
        // Check if exactly one item is selected
        if (selectedItems.length !== 1) {
            if (selectedItems.length === 0) {
                vscode.postMessage({
                    command: 'showError',
                    message: 'Please select a file or folder to rename'
                });
            } else {
                vscode.postMessage({
                    command: 'showError',
                    message: 'Please select only one item to rename'
                });
            }
            return;
        }

        const item = selectedItems[0];
        const label = item.querySelector('.tree-item-label');
        if (!label) return;

        const originalName = label.textContent || '';
        const isDirectory = item.dataset.isDir === 'true';
        const panel = item.dataset.panel;

        // Create input element
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tree-item-rename-input';
        input.value = originalName;

        // Replace label with input
        label.style.display = 'none';
        label.parentElement?.insertBefore(input, label);

        // Select appropriate part of filename
        input.focus();
        if (isDirectory) {
            // For directories, select entire name
            input.select();
        } else {
            // For files, select name without extension
            const lastDot = originalName.lastIndexOf('.');
            if (lastDot > 0) {
                // Has extension, select name part only
                input.setSelectionRange(0, lastDot);
            } else {
                // No extension, select all
                input.select();
            }
        }

        // Finish rename function
        const finishRename = (save) => {
            if (save) {
                const newName = input.value.trim();

                // Validate new name
                if (!newName) {
                    vscode.postMessage({
                        command: 'showError',
                        message: 'Name cannot be empty'
                    });
                    input.focus();
                    return;
                }

                if (newName.includes('/') || newName.includes('\\')) {
                    vscode.postMessage({
                        command: 'showError',
                        message: 'Name cannot contain path separators'
                    });
                    input.focus();
                    return;
                }

                if (newName !== originalName) {
                    // Send rename request
                    vscode.postMessage({
                        command: 'rename',
                        data: {
                            path: item.dataset.path,
                            newName: newName,
                            panel: panel
                        }
                    });
                }
            }

            // Restore label
            input.remove();
            label.style.display = '';
        };

        // Handle keyboard events
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                finishRename(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishRename(false);
            }
        });

        // Handle blur (click outside)
        input.addEventListener('blur', () => {
            // Small delay to allow Enter key to process first
            setTimeout(() => {
                if (input.parentElement) {
                    finishRename(true);
                }
            }, 100);
        });

        // Prevent item deselection when clicking on input
        input.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    /**
     * Show delete confirmation dialog with list of files to delete
     */
    function showDeleteConfirmation() {
        console.log(`showDeleteConfirmation called, selectedItems: ${selectedItems.length}`);

        if (selectedItems.length === 0) {
            console.warn('No items selected for deletion');
            return;
        }

        const panel = selectedItems[0].dataset.panel;

        // 统计文件和文件夹数量
        const folders = selectedItems.filter(item => item.dataset.isDir === 'true');
        const files = selectedItems.filter(item => item.dataset.isDir !== 'true');

        // 构建删除项目列表
        const itemsToDelete = selectedItems.map(item => ({
            path: item.dataset.path,
            name: item.querySelector('.tree-item-label')?.textContent || '',
            isDir: item.dataset.isDir === 'true'
        }));

        // 发送消息到后端显示确认对话框
        vscode.postMessage({
            command: 'requestDeleteConfirmation',
            data: {
                items: itemsToDelete,
                panel: panel,
                folders: folders.length,
                files: files.length
            }
        });
    }

    /**
     * Render breadcrumb navigation from path
     * @param {string} panel - 'local' or 'remote'
     * @param {string} fullPath - Full path to display
     */
    function renderBreadcrumb(panel, fullPath) {
        const breadcrumbId = panel === 'local' ? 'local-breadcrumb' : 'remote-breadcrumb';
        const breadcrumb = document.getElementById(breadcrumbId);
        if (!breadcrumb) return;

        // Clear existing breadcrumb
        breadcrumb.innerHTML = '';

        // Split path into segments
        const isWindows = panel === 'local' && /^[A-Za-z]:/.test(fullPath);
        const separator = panel === 'local' && isWindows ? '\\' : '/';

        let segments = [];
        let paths = [];

        if (isWindows) {
            // Windows path: C:\Users\iwang\Documents
            const parts = fullPath.split(separator).filter(Boolean);
            segments = parts;

            // Build cumulative paths
            paths.push(parts[0] + separator); // C:\
            for (let i = 1; i < parts.length; i++) {
                paths.push(paths[i - 1] + parts[i] + separator);
            }
        } else {
            // Unix path: /home/user/documents
            const parts = fullPath.split('/').filter(Boolean);
            segments = parts;

            // Build cumulative paths
            paths.push('/');
            for (let i = 0; i < parts.length; i++) {
                if (i === 0) {
                    paths.push('/' + parts[i]);
                } else {
                    paths.push(paths[i] + '/' + parts[i]);
                }
            }
        }

        // Create root segment
        const rootSpan = document.createElement('span');
        rootSpan.className = 'breadcrumb-segment breadcrumb-root';
        if (isWindows) {
            // Windows: display drive letter (e.g., "C:")
            rootSpan.textContent = segments[0];
        } else {
            // Unix: display "/" or first segment
            rootSpan.textContent = '/';
        }
        rootSpan.dataset.path = isWindows ? segments[0] + separator : '/';
        rootSpan.dataset.panel = panel;
        rootSpan.title = 'Click for dropdown, double-click to navigate';

        // Single click: show dropdown, double click: navigate
        rootSpan.addEventListener('click', function(e) {
            const element = this; // Save element reference
            const segmentKey = `${panel}_root`;

            if (breadcrumbClickTimers[segmentKey]) {
                // Double click: navigate or update search path
                clearTimeout(breadcrumbClickTimers[segmentKey]);
                breadcrumbClickTimers[segmentKey] = null;

                if (panel === 'remote' && isSearchViewVisible) {
                    // In search view: update search path and breadcrumb
                    const pathInput = document.getElementById('search-path-input');
                    if (pathInput) {
                        pathInput.value = element.dataset.path;
                        currentSearchPath = element.dataset.path;
                        currentRemotePath = element.dataset.path;
                        renderBreadcrumb('remote', element.dataset.path);
                        // Load directory in background for when user returns to file tree
                        loadDirectory('remote', element.dataset.path);
                    }
                } else {
                    // In file tree view: navigate
                    loadDirectory(panel, element.dataset.path);
                }
                closeBreadcrumbDropdown();
            } else {
                // Check if dropdown is already showing for this path
                if (breadcrumbDropdown &&
                    breadcrumbDropdown.dataset.panel === panel &&
                    breadcrumbDropdown.dataset.path === element.dataset.path) {
                    // Same path - close dropdown immediately, no timer
                    closeBreadcrumbDropdown();
                } else {
                    // Different path or no dropdown - show it after delay
                    breadcrumbClickTimers[segmentKey] = setTimeout(() => {
                        breadcrumbClickTimers[segmentKey] = null;
                        showBreadcrumbDropdown(element, panel, element.dataset.path, true);
                    }, 250);
                }
            }
        });
        breadcrumb.appendChild(rootSpan);

        // Create separators and segments
        for (let i = 0; i < segments.length; i++) {
            // For Windows, first segment is drive letter (already shown in root)
            if (isWindows && i === 0) {
                continue;
            }

            // Add separator
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-separator';
            sep.textContent = separator;
            breadcrumb.appendChild(sep);

            // Add segment
            const segment = document.createElement('span');
            segment.className = 'breadcrumb-segment';

            segment.textContent = segments[i];
            segment.dataset.path = paths[i + (isWindows ? 0 : 1)];
            segment.dataset.panel = panel;

            // All segments support dropdown (single click)
            const isLastSegment = (i === segments.length - 1);

            if (isLastSegment) {
                // Current segment: show parent directory dropdown (to see siblings)
                segment.classList.add('breadcrumb-current');
                segment.title = 'Click to show sibling folders';

                segment.addEventListener('click', function(e) {
                    const element = this;
                    // Get parent path of current segment
                    const currentSegmentPath = element.dataset.path;
                    const parentPath = getParentPath(currentSegmentPath, panel);

                    // If no parent path (root), don't show dropdown
                    if (!parentPath || parentPath === currentSegmentPath) {
                        return;
                    }

                    // Check if dropdown is already showing for this parent path
                    if (breadcrumbDropdown &&
                        breadcrumbDropdown.dataset.panel === panel &&
                        breadcrumbDropdown.dataset.path === parentPath) {
                        // Same parent path - close dropdown
                        closeBreadcrumbDropdown();
                    } else {
                        // Different path or no dropdown - show parent directory content
                        // Pass isRoot=true so backend uses parentPath directly (don't get parent again)
                        // Pass current segment path as highlightPath to highlight current folder
                        showBreadcrumbDropdown(element, panel, parentPath, true, currentSegmentPath);
                    }
                });
            } else {
                // Other segments: single click dropdown, double click navigate
                segment.classList.add('breadcrumb-clickable');
                segment.title = 'Click for dropdown, double-click to navigate';

                segment.addEventListener('click', function(e) {
                    const element = this; // Save element reference
                    const segmentKey = `${panel}_${element.dataset.path}`;

                    if (breadcrumbClickTimers[segmentKey]) {
                        // Double click: navigate or update search path
                        clearTimeout(breadcrumbClickTimers[segmentKey]);
                        breadcrumbClickTimers[segmentKey] = null;

                        if (panel === 'remote' && isSearchViewVisible) {
                            // In search view: update search path and breadcrumb
                            const pathInput = document.getElementById('search-path-input');
                            if (pathInput) {
                                pathInput.value = element.dataset.path;
                                currentSearchPath = element.dataset.path;
                                currentRemotePath = element.dataset.path;
                                renderBreadcrumb('remote', element.dataset.path);
                                // Load directory in background for when user returns to file tree
                                loadDirectory('remote', element.dataset.path);
                            }
                        } else {
                            // In file tree view: navigate
                            loadDirectory(panel, element.dataset.path);
                        }
                        closeBreadcrumbDropdown();
                    } else {
                        // Check if dropdown is already showing for this path
                        if (breadcrumbDropdown &&
                            breadcrumbDropdown.dataset.panel === panel &&
                            breadcrumbDropdown.dataset.path === element.dataset.path) {
                            // Same path - close dropdown immediately, no timer
                            closeBreadcrumbDropdown();
                        } else {
                            // Different path or no dropdown - show it after delay
                            breadcrumbClickTimers[segmentKey] = setTimeout(() => {
                                breadcrumbClickTimers[segmentKey] = null;
                                showBreadcrumbDropdown(element, panel, element.dataset.path, false);
                            }, 250);
                        }
                    }
                });
            }

            breadcrumb.appendChild(segment);
        }

        // 滚动到最右边,显示当前路径
        const scrollToEnd = () => {
            const maxScroll = Math.max(0, breadcrumb.scrollWidth - breadcrumb.clientWidth);
            breadcrumb.scrollLeft = maxScroll;
        };

        // 使用requestAnimationFrame确保DOM已经渲染
        requestAnimationFrame(() => {
            requestAnimationFrame(scrollToEnd);
        });
    }

    // 监听breadcrumb容器大小变化，自动滚动到最右边
    const localBreadcrumb = document.getElementById('local-breadcrumb');
    const remoteBreadcrumb = document.getElementById('remote-breadcrumb');

    if (localBreadcrumb && globalThis.ResizeObserver) {
        const localResizeObserver = new ResizeObserver(() => {
            const maxScroll = Math.max(0, localBreadcrumb.scrollWidth - localBreadcrumb.clientWidth);
            localBreadcrumb.scrollLeft = maxScroll;
        });
        localResizeObserver.observe(localBreadcrumb);
    }

    if (remoteBreadcrumb && globalThis.ResizeObserver) {
        const remoteResizeObserver = new ResizeObserver(() => {
            const maxScroll = Math.max(0, remoteBreadcrumb.scrollWidth - remoteBreadcrumb.clientWidth);
            remoteBreadcrumb.scrollLeft = maxScroll;
        });
        remoteResizeObserver.observe(remoteBreadcrumb);
    }

    // ===== 键盘快捷键 =====
    document.addEventListener('keydown', (e) => {
        // Ctrl+S: Upload selected local files
        if (e.ctrlKey && e.key === 's') {
            if (selectedItems.length > 0) {
                e.preventDefault();
                uploadSelected();
            }
        } else if (e.ctrlKey && e.key === 'd') {
            // Ctrl+D: Download selected remote files
            if (selectedItems.length > 0) {
                e.preventDefault();
                downloadSelected();
            }
        } else if (e.key === 'F2') {
            // F2: Inline rename
            if (selectedItems.length === 1) {
                e.preventDefault();
                startInlineRename();
            }
        } else if (e.key === 'Delete') {
            if (selectedItems.length > 0) {
                e.preventDefault();
                showDeleteConfirmation();
            }
        } else if (e.key === 'F5') {
            e.preventDefault();
            refreshPanel('local');
            refreshPanel('remote');
        } else if (e.key === 'Backspace') {
            // 检查是否在搜索框、新建文件夹输入框或批量重命名模态对话框中
            const activeElement = document.activeElement;
            const isInInput = activeElement && (
                activeElement.id === 'local-search' ||
                activeElement.id === 'remote-search' ||
                activeElement.classList.contains('tree-item-input') ||
                activeElement.classList.contains('rename-input') ||
                activeElement.classList.contains('local-port-input') ||
                // 检查是否在搜索视图的任何输入框中
                activeElement.closest('.panel-search-view') ||
                // 检查是否在批量重命名模态对话框中
                activeElement.closest('#batch-rename-modal') ||
                // 检查是否在任何模态对话框中
                activeElement.closest('.modal')
            );

            // 只有当不在输入框或模态对话框中时才返回上一级
            if (!isInInput) {
                // 返回上一级
                e.preventDefault();
                const panel = selectedItem?.dataset.panel || 'local';
                const currentPath = panel === 'local' ? currentLocalPath : currentRemotePath;
                const parentPath = getParentPath(currentPath, panel);
                if (parentPath) {
                    loadDirectory(panel, parentPath);
                }
            }
        }
    });

    // ===== 接收扩展消息 =====
    window.addEventListener('message', event => {
        const message = event.data;

        console.log('[Port Forward] Received message:', message.command, message);

        switch (message.command) {
            case 'showHostSelection':
                renderHostSelection(message.hosts);
                break;

            case 'updateLocalTree':
                currentLocalPath = message.data.path;
                renderBreadcrumb('local', message.data.path);
                renderFileTree('local', message.data.nodes);
                break;

            case 'updateRemoteTree':
                currentRemotePath = message.data.path;
                renderBreadcrumb('remote', message.data.path);
                renderFileTree('remote', message.data.nodes);
                break;

            case 'breadcrumbDirectory':
                // Render breadcrumb dropdown directory listing
                renderBreadcrumbDropdown(message.data);
                break;

            case 'breadcrumbTreeChildren':
                // Render breadcrumb tree children (expanding a folder)
                renderBreadcrumbTreeChildren(message.data);
                break;

            case 'triggerCreateFolder':
                // Trigger inline folder creation from context menu
                createFolder(message.panel);
                break;

            case 'triggerCreateFile':
                // Trigger inline file creation from context menu
                createFile(message.panel);
                break;

            case 'triggerDelete':
                // Trigger delete confirmation with current selection
                showDeleteConfirmation();
                break;

            case 'triggerBatchRename':
                // Trigger batch rename with current selection
                batchRenameSelected(message.panel);
                break;

            case 'triggerRename':
                // Trigger inline rename for single file/folder
                startInlineRename();
                break;

            case 'deleteConfirmationResult':
                if (message.data.confirmed) {
                    // Show progress
                    showFooterProgress(message.data.panel, 'Deleting...');

                    // Perform actual deletion
                    vscode.postMessage({
                        command: 'batchDelete',
                        data: {
                            panel: message.data.panel,
                            items: message.data.items
                        }
                    });
                }
                break;

            case 'updateFooterProgress':
                showFooterProgress(message.panel, message.message);
                break;

            case 'getSelectedForUpload':
                // Upload selected local files
                uploadSelected();
                break;

            case 'getSelectedForDownload':
                // Download selected remote files
                downloadSelected();
                break;

            case 'selectFileForCompare':
                // Select file for comparison
                fileSelectedForCompare = message.data;
                // Update all tree items' context to reflect the selection
                updateTreeItemsContext();
                break;

            case 'compareWithSelected':
                // Compare current file with previously selected file
                if (fileSelectedForCompare) {
                    vscode.postMessage({
                        command: 'diffFiles',
                        data: {
                            localPath: fileSelectedForCompare.panel === 'local' ? fileSelectedForCompare.path : message.data.path,
                            remotePath: fileSelectedForCompare.panel === 'remote' ? fileSelectedForCompare.path : message.data.path,
                            localName: fileSelectedForCompare.panel === 'local' ? fileSelectedForCompare.name : message.data.name,
                            remoteName: fileSelectedForCompare.panel === 'remote' ? fileSelectedForCompare.name : message.data.name,
                            firstPath: fileSelectedForCompare.path,
                            secondPath: message.data.path,
                            firstPanel: fileSelectedForCompare.panel,
                            secondPanel: message.data.panel
                        }
                    });
                    // Clear selection after comparison
                    fileSelectedForCompare = null;
                    updateTreeItemsContext();
                }
                break;

            case 'showRemoteLoading': {
                // 立即显示远程加载状态,不等待延迟
                const remoteTree = document.getElementById('remote-tree');
                if (remoteTree) {
                    // 清空内容但保留表头
                    Array.from(remoteTree.children).forEach(child => {
                        if (!child.classList.contains('file-tree-header')) {
                            child.remove();
                        }
                    });

                    // 添加loading元素
                    const loading = document.createElement('div');
                    loading.className = 'loading';
                    loading.innerHTML = `
                        <span class="codicon codicon-loading codicon-modifier-spin"></span>
                        Loading remote files...
                    `;
                    remoteTree.appendChild(loading);
                }
                break;
            }

case 'updateStatus':
                // Update progress message in any panel that is currently showing progress
                ['local', 'remote'].forEach(panel => {
                    const panelEl = document.querySelector(`.${panel}-panel`);
                    if (panelEl) {
                        const footerProgress = panelEl.querySelector('.footer-progress');
                        // Only update if the progress footer is currently visible
                        if (footerProgress && footerProgress.style.display !== 'none') {
                            const msgEl = footerProgress.querySelector('.progress-message');
                            if (msgEl) {
                                msgEl.textContent = message.text;
                            }
                        }
                    }
                });

            case 'updateQueue':
                document.getElementById('queue-text').textContent = `${message.count} active tasks`;
                break;

            case 'showPermissionsEditor':
                // Show the permissions editor modal
                showPermissionsEditor(
                    message.data.fileName,
                    message.data.filePath,
                    message.data.panel,
                    message.data.mode
                );
                break;

            case 'updateBookmarks':
                // Update bookmarks list
                console.log('Received updateBookmarks message:', message);
                renderBookmarks(message.data.bookmarks);
                break;

            case 'addBookmark':
                // Add bookmark - use provided path or current remote path
                if (message.data && message.data.path) {
                    vscode.postMessage({
                        command: 'addBookmark',
                        data: { path: message.data.path }
                    });
                } else {
                    addCurrentPathToBookmark();
                }
                break;

            case 'searchResults':
                // Display search results
                displaySearchResults(message.data);
                break;

            case 'searchError':
                // Show search error
                showSearchError(message.data.error);
                break;

            case 'searchHistory':
                // Update search history
                searchHistory = message.data || [];
                searchHistoryIndex = -1;
                break;

            case 'folderDetails':
                // Update tooltip with folder details
                updateTooltipWithFolderDetails(message.data);
                break;

            case 'portForwardings':
            case 'portForwardingStarted':
            case 'portForwardingStopped':
            case 'portForwardingError':
            case 'portForwardingDeleted':
            case 'remotePorts':
            case 'localPorts':
                // Delegate port forwarding messages to shared module
                if (typeof PortForwardModule !== 'undefined') {
                    PortForwardModule.handleMessage(message);
                }
                break;

            // Handle "More" menu commands from VS Code context menu
            case 'createFolderLocal':
                createFolder('local');
                break;

            case 'createFileLocal':
                createFile('local');
                break;

            case 'uploadSelected':
                uploadSelected();
                break;

            case 'createFolderRemote':
                createFolder('remote');
                break;

            case 'createFileRemote':
                createFile('remote');
                break;

            case 'downloadSelected':
                downloadSelected();
                break;

            case 'togglePortForwarding':
                if (typeof PortForwardModule !== 'undefined') {
                    if (PortForwardModule.isViewVisible && PortForwardModule.isViewVisible()) {
                        PortForwardModule.closeView();
                    } else {
                        PortForwardModule.openView();
                    }
                }
                break;

            case 'toggleSearchView':
                if (isSearchViewVisible) {
                    closeSearchView();
                } else {
                    openSearchView();
                }
                break;

            case 'switchToListView':
                // Handle switch to list view command
                if (message.panel) {
                    switchViewMode(message.panel, 'list');
                }
                break;

            case 'switchToGridView':
                // Handle switch to grid/icon view command
                if (message.panel) {
                    switchViewMode(message.panel, 'grid');
                }
                break;

            case 'thumbnailData':
                // Handle thumbnail data from backend
                if (message.data && message.data.dataUrl) {
                    const { panel, path, dataUrl } = message.data;
                    const requestId = `${panel}:${path}`;

                    // Find thumbnail element with matching request ID
                    const thumbnails = document.querySelectorAll('.tree-item-thumbnail');
                    thumbnails.forEach(thumb => {
                        if (thumb.dataset.requestId === requestId && thumb.parentNode) {
                            // Remove loading icon
                            const loadingIcon = thumb.parentNode.querySelector('.thumbnail-loading');
                            if (loadingIcon) {
                                loadingIcon.remove();
                            }

                            // Set thumbnail source
                            thumb.src = dataUrl;
                        }
                    });
                }
                break;

            case 'setViewMode':
                // Initialize view mode from settings
                if (message.data) {
                    if (message.data.local) {
                        viewMode.local = message.data.local;
                        updateViewModeButton('local', message.data.local);
                    }
                    if (message.data.remote) {
                        viewMode.remote = message.data.remote;
                        updateViewModeButton('remote', message.data.remote);
                    }
                    if (message.data.thumbnailSize) {
                        thumbnailSize = message.data.thumbnailSize;
                    }
                }
                break;
        }
    });

    /**
     * Add current remote path to bookmarks
     */
    function addCurrentPathToBookmark() {
        if (!currentRemotePath) {
            console.warn('No remote path selected');
            return;
        }

        vscode.postMessage({
            command: 'addBookmark',
            data: { path: currentRemotePath }
        });
    }

    /**
     * 渲染主机选择界面
     */
    function renderHostSelection(hosts) {
        const localTree = document.getElementById('local-tree');
        const remoteTree = document.getElementById('remote-tree');

        if (!localTree || !remoteTree) return;

        // 隐藏文件树,显示主机选择
        const selectionHTML = `
            <div class="host-selection-container">
                <h3>Select a Host to Browse Files</h3>
                <div class="host-list">
                    ${hosts.map(host => `
                        <div class="host-item-wrapper">
                            <div class="host-item" data-host-id="${host.id}">
                                ${host.starred ? '<span class="codicon codicon-star-full host-star"></span>' : '<span class="codicon codicon-remote host-icon"></span>'}
                                <div class="host-info">
                                    <div class="host-name">
                                        ${host.name}
                                        ${host.group ? `<span class="host-group">[${host.group}]</span>` : ''}
                                        ${!host.hasAuth ? '<span class="codicon codicon-warning auth-warning-icon" title="Authentication not configured"></span>' : ''}
                                    </div>
                                    <div class="host-details">${host.username}@${host.host}:${host.port}</div>
                                </div>
                                ${(host.bookmarks && host.bookmarks.length > 0) ?
                                    `<span class="codicon codicon-chevron-down bookmark-toggle" data-host-id="${host.id}" title="Toggle bookmarks"></span>` :
                                    '<span class="codicon codicon-chevron-right"></span>'}
                            </div>
                            ${(host.bookmarks && host.bookmarks.length > 0) ? `
                                <div class="bookmark-list collapsed" data-host-id="${host.id}">
                                    ${host.bookmarks.map(bookmark => `
                                        <div class="bookmark-item" data-host-id="${host.id}" data-path="${bookmark.path}">
                                            <span class="codicon codicon-bookmark bookmark-icon"></span>
                                            <div class="bookmark-info">
                                                <div class="bookmark-name">${bookmark.name}</div>
                                                <div class="bookmark-path">${bookmark.path}</div>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        localTree.innerHTML = selectionHTML;

        // Remote panel: 清空内容但保留表头
        Array.from(remoteTree.children).forEach(child => {
            if (!child.classList.contains('file-tree-header')) {
                child.remove();
            }
        });
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'empty-message';
        emptyMsg.textContent = '← Select a host to start browsing';
        remoteTree.appendChild(emptyMsg);

        // 添加主机点击事件
        document.querySelectorAll('.host-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // 检查是否点击的是书签切换按钮
                if (e.target.classList.contains('bookmark-toggle')) {
                    return; // 如果是书签切换,不处理主机打开
                }

                const hostId = item.dataset.hostId;
                vscode.postMessage({
                    command: 'selectHost',
                    hostId: hostId
                });
            });
        });

        // 添加书签切换事件
        document.querySelectorAll('.bookmark-toggle').forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止冒泡到主机项
                const hostId = toggle.dataset.hostId;
                const bookmarkList = document.querySelector(`.bookmark-list[data-host-id="${hostId}"]`);
                if (bookmarkList) {
                    bookmarkList.classList.toggle('collapsed');
                    // 切换图标
                    if (bookmarkList.classList.contains('collapsed')) {
                        toggle.classList.remove('codicon-chevron-down');
                        toggle.classList.add('codicon-chevron-right');
                    } else {
                        toggle.classList.remove('codicon-chevron-right');
                        toggle.classList.add('codicon-chevron-down');
                    }
                }
            });
        });

        // 添加书签点击事件
        document.querySelectorAll('.bookmark-item').forEach(item => {
            item.addEventListener('click', () => {
                const hostId = item.dataset.hostId;
                const path = item.dataset.path;
                vscode.postMessage({
                    command: 'openBookmark',
                    hostId: hostId,
                    path: path
                });
            });
        });
    }

    // ===== 权限编辑器 =====
    let currentPermissionsContext = null;

    /**
     * 显示权限编辑器模态框
     * @param {string} fileName - 文件名
     * @param {string} filePath - 文件路径
     * @param {string} panel - 'local' or 'remote'
     * @param {number} mode - 当前权限模式
     */
    function showPermissionsEditor(fileName, filePath, panel, mode) {
        currentPermissionsContext = { fileName, filePath, panel, mode };

        // 设置文件名
        document.getElementById('perm-file-name').textContent = fileName;

        // 设置复选框状态
        document.getElementById('owner-read').checked = (mode & 0o400) !== 0;
        document.getElementById('owner-write').checked = (mode & 0o200) !== 0;
        document.getElementById('owner-execute').checked = (mode & 0o100) !== 0;
        document.getElementById('group-read').checked = (mode & 0o040) !== 0;
        document.getElementById('group-write').checked = (mode & 0o020) !== 0;
        document.getElementById('group-execute').checked = (mode & 0o010) !== 0;
        document.getElementById('others-read').checked = (mode & 0o004) !== 0;
        document.getElementById('others-write').checked = (mode & 0o002) !== 0;
        document.getElementById('others-execute').checked = (mode & 0o001) !== 0;

        // 更新显示
        updatePermissionsDisplay();

        // 显示模态框
        document.getElementById('permissions-modal').style.display = 'flex';
    }

    /**
     * 隐藏权限编辑器模态框
     */
    function hidePermissionsEditor() {
        document.getElementById('permissions-modal').style.display = 'none';
        currentPermissionsContext = null;
    }

    /**
     * 更新权限显示
     */
    function updatePermissionsDisplay() {
        let mode = 0;

        if (document.getElementById('owner-read').checked) mode |= 0o400;
        if (document.getElementById('owner-write').checked) mode |= 0o200;
        if (document.getElementById('owner-execute').checked) mode |= 0o100;
        if (document.getElementById('group-read').checked) mode |= 0o040;
        if (document.getElementById('group-write').checked) mode |= 0o020;
        if (document.getElementById('group-execute').checked) mode |= 0o010;
        if (document.getElementById('others-read').checked) mode |= 0o004;
        if (document.getElementById('others-write').checked) mode |= 0o002;
        if (document.getElementById('others-execute').checked) mode |= 0o001;

        // 更新八进制显示
        document.getElementById('octal-value').textContent = mode.toString(8).padStart(3, '0');

        // 更新符号显示
        const symbolic = [
            document.getElementById('owner-read').checked ? 'r' : '-',
            document.getElementById('owner-write').checked ? 'w' : '-',
            document.getElementById('owner-execute').checked ? 'x' : '-',
            document.getElementById('group-read').checked ? 'r' : '-',
            document.getElementById('group-write').checked ? 'w' : '-',
            document.getElementById('group-execute').checked ? 'x' : '-',
            document.getElementById('others-read').checked ? 'r' : '-',
            document.getElementById('others-write').checked ? 'w' : '-',
            document.getElementById('others-execute').checked ? 'x' : '-'
        ].join('');
        document.getElementById('symbolic-value').textContent = symbolic;
    }

    // 初始化权限编辑器事件监听
    function initializePermissionsEditor() {
        // 复选框变化事件
        const permCheckboxes = document.querySelectorAll('#permissions-modal input[type="checkbox"]');
        permCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', updatePermissionsDisplay);
        });

        // 关闭按钮
        document.querySelector('.modal-close').addEventListener('click', hidePermissionsEditor);

        // 取消按钮
        document.getElementById('cancel-perms-button').addEventListener('click', hidePermissionsEditor);

        // 应用按钮
        document.getElementById('apply-perms-button').addEventListener('click', () => {
            if (!currentPermissionsContext) return;

            let mode = 0;
            if (document.getElementById('owner-read').checked) mode |= 0o400;
            if (document.getElementById('owner-write').checked) mode |= 0o200;
            if (document.getElementById('owner-execute').checked) mode |= 0o100;
            if (document.getElementById('group-read').checked) mode |= 0o040;
            if (document.getElementById('group-write').checked) mode |= 0o020;
            if (document.getElementById('group-execute').checked) mode |= 0o010;
            if (document.getElementById('others-read').checked) mode |= 0o004;
            if (document.getElementById('others-write').checked) mode |= 0o002;
            if (document.getElementById('others-execute').checked) mode |= 0o001;

            vscode.postMessage({
                command: 'applyPermissions',
                data: {
                    filePath: currentPermissionsContext.filePath,
                    panel: currentPermissionsContext.panel,
                    mode: mode
                }
            });

            hidePermissionsEditor();
        });

        // 点击模态框背景关闭
        document.getElementById('permissions-modal').addEventListener('click', (e) => {
            if (e.target.id === 'permissions-modal') {
                hidePermissionsEditor();
            }
        });
    }

    // 在 DOMContentLoaded 后初始化权限编辑器
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializePermissionsEditor);
    } else {
        initializePermissionsEditor();
    }

    // ===== Search View =====
    let isSearchViewVisible = false;
    let isPortForwardViewVisible = false;
    let currentForwardings = [];
    let currentLocalPorts = [];  // Store scanned local ports for remote forwarding
    let currentSearchResults = [];
    let currentSearchPath = '/';
    let searchHistory = [];
    let searchHistoryIndex = -1;

    /**
     * Initialize search view event listeners
     */
    function initializeSearchView() {
        // Toggle search view button (toggle between file tree and search)
        const toggleButton = document.getElementById('toggle-search-view');
        if (toggleButton) {
            toggleButton.addEventListener('click', () => {
                if (isSearchViewVisible) {
                    closeSearchView();
                } else {
                    openSearchView();
                }
            });
        }

        // Note: More dropdown menus are now native VS Code context menus

        // Start search button (both inline and standalone for compatibility)
        const searchButton = document.getElementById('start-search-button');
        const searchButtonInline = document.getElementById('start-search-button-inline');
        searchButton?.addEventListener('click', performSearch);
        searchButtonInline?.addEventListener('click', performSearch);

        // Clear results button
        const clearButton = document.getElementById('clear-search-results');
        clearButton?.addEventListener('click', clearSearchResults);

        // Toggle search details (include/exclude)
        const toggleDetailsBtn = document.getElementById('toggle-search-details');
        const searchDetails = document.getElementById('search-details');
        toggleDetailsBtn?.addEventListener('click', () => {
            if (searchDetails) {
                const isHidden = searchDetails.style.display === 'none';
                searchDetails.style.display = isHidden ? 'block' : 'none';
                toggleDetailsBtn.classList.toggle('active', isHidden);
            }
        });

        // Toggle buttons
        const matchCaseBtn = document.getElementById('search-match-case');
        const wholeWordBtn = document.getElementById('search-match-whole-word');
        const regexBtn = document.getElementById('search-use-regex');

        matchCaseBtn?.addEventListener('click', () => matchCaseBtn.classList.toggle('active'));
        wholeWordBtn?.addEventListener('click', () => wholeWordBtn.classList.toggle('active'));
        regexBtn?.addEventListener('click', () => regexBtn.classList.toggle('active'));

        // Path input handling
        const pathInput = document.getElementById('search-path-input');
        pathInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const newPath = pathInput.value.trim();
                if (newPath) {
                    currentSearchPath = newPath;
                }
            }
        });

        // Enter key to search
        const searchInput = document.getElementById('search-query-input');
        searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch();
                // Reset history index when performing new search
                searchHistoryIndex = -1;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                navigateSearchHistory('up');
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                navigateSearchHistory('down');
            }
        });

        // Filename-only checkbox changes
        const filenameOnlyCheckbox = document.getElementById('search-filename-only');
        filenameOnlyCheckbox?.addEventListener('change', (e) => {
            const searchQueryInput = document.getElementById('search-query-input');
            if (e.target.checked) {
                // Filename search
                searchQueryInput.placeholder = 'Search by filename (e.g., *.ts, test*)';
            } else {
                // Content search
                searchQueryInput.placeholder = 'Search in file contents';
            }
        });
    }

    // ===== Port Forwarding View =====
    // Port forwarding functionality is now handled by the shared PortForwardModule
    // which is loaded from port-forward.js. All port forwarding related functions,
    // state variables, and message handlers are managed by that module.
    // See: resources/webview/port-forward.js

    // Note: More dropdown menus are now native VS Code context menus
    // See package.json > contributes > menus > webview/context

    /**
     * Open search view
     */
    function openSearchView() {
        const searchView = document.getElementById('panel-search-view');
        const remoteTree = document.getElementById('remote-tree');

        if (searchView && remoteTree) {
            // Hide file tree, show search view
            remoteTree.style.display = 'none';
            searchView.style.display = 'flex';
            isSearchViewVisible = true;

            // Change more button to back button
            updateMoreButtonToBackButton();

            // Initialize search path with current remote path
            currentSearchPath = currentRemotePath || '/';
            const pathInput = document.getElementById('search-path-input');
            if (pathInput) {
                pathInput.value = currentSearchPath;
            }

            // Request search history from backend
            vscode.postMessage({ command: 'getSearchHistory' });

            // Focus on search input
            const searchInput = document.getElementById('search-query-input');
            if (searchInput) {
                setTimeout(() => searchInput.focus(), 100);
            }
        }
    }

    /**
     * Navigate search history with arrow keys
     */
    function navigateSearchHistory(direction) {
        if (searchHistory.length === 0) return;

        const searchInput = document.getElementById('search-query-input');
        if (!searchInput) return;

        if (direction === 'up') {
            // Go to older entries
            if (searchHistoryIndex < searchHistory.length - 1) {
                searchHistoryIndex++;
                searchInput.value = searchHistory[searchHistoryIndex];
            }
        } else if (direction === 'down') {
            // Go to newer entries
            if (searchHistoryIndex > 0) {
                searchHistoryIndex--;
                searchInput.value = searchHistory[searchHistoryIndex];
            } else if (searchHistoryIndex === 0) {
                // Clear when going past newest
                searchHistoryIndex = -1;
                searchInput.value = '';
            }
        }
    }

    /**
     * Close search view
     */
    function closeSearchView() {
        const searchView = document.getElementById('panel-search-view');
        const remoteTree = document.getElementById('remote-tree');

        if (searchView && remoteTree) {
            // Show file tree, hide search view
            searchView.style.display = 'none';
            remoteTree.style.display = ''; // Reset to default (uses CSS flex)
            isSearchViewVisible = false;

            // Restore more button to normal
            restoreMoreButtonToNormal();
        }
    }

    /**
     * Perform search based on current inputs
     */
    function performSearch() {
        const queryInput = document.getElementById('search-query-input');
        const includeInput = document.getElementById('search-files-include');
        const excludeInput = document.getElementById('search-files-exclude');
        const pathInput = document.getElementById('search-path-input');
        const filenameOnlyCheckbox = document.getElementById('search-filename-only');
        const caseSensitiveCheckbox = document.getElementById('search-case-sensitive');
        const matchCaseBtn = document.getElementById('search-match-case');
        const wholeWordBtn = document.getElementById('search-match-whole-word');
        const regexBtn = document.getElementById('search-use-regex');

        const query = queryInput?.value?.trim();
        if (!query) {
            vscode.postMessage({
                command: 'showError',
                message: 'Please enter a search query'
            });
            return;
        }

        // Get search path from input
        const searchPath = pathInput?.value?.trim() || currentSearchPath || '/';

        // Show loading state
        showSearchLoading();

        // Collect search options
        const searchOptions = {
            query: query,
            filesInclude: includeInput?.value?.trim() || '',
            filesExclude: excludeInput?.value?.trim() || '',
            filenameOnly: filenameOnlyCheckbox?.checked || false,
            caseSensitive: caseSensitiveCheckbox?.checked || matchCaseBtn?.classList.contains('active') || false,
            wholeWord: wholeWordBtn?.classList.contains('active') || false,
            useRegex: regexBtn?.classList.contains('active') || false,
            basePath: searchPath
        };

        // Send search request to backend
        vscode.postMessage({
            command: 'performSearch',
            data: searchOptions
        });
    }

    /**
     * Show loading state in search results
     */
    function showSearchLoading() {
        const resultsList = document.getElementById('search-results-list');
        if (resultsList) {
            resultsList.innerHTML = `
                <div class="search-loading">
                    <span class="codicon codicon-loading codicon-modifier-spin"></span>
                    <span>Searching...</span>
                </div>
            `;
        }
    }

    /**
     * Display search results
     * @param {Object} results - Search results from backend
     */
    function displaySearchResults(results) {
        currentSearchResults = results;
        const resultsList = document.getElementById('search-results-list');
        const resultsCount = document.getElementById('search-results-count');

        if (!resultsList || !resultsCount) return;

        if (!results || !results.files || results.files.length === 0) {
            resultsList.innerHTML = '<div class="search-empty-message">No results found</div>';
            resultsCount.textContent = 'No results';
            return;
        }

        // Update count
        const totalMatches = results.files.reduce((sum, file) => sum + (file.matches?.length || 0), 0);
        resultsCount.textContent = `${totalMatches} results in ${results.files.length} files`;

        // Render results
        resultsList.innerHTML = '';
        results.files.forEach(file => {
            const fileElement = createSearchResultFileElement(file);
            resultsList.appendChild(fileElement);
        });
    }

    /**
     * Create search result file element
     * @param {Object} file - File result object
     * @returns {HTMLElement}
     */
    function createSearchResultFileElement(file) {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'search-result-file';

        // File header
        const header = document.createElement('div');
        header.className = 'search-result-file-header';

        const chevron = document.createElement('span');
        chevron.className = 'codicon codicon-chevron-right';

        // File icon
        const icon = document.createElement('span');
        const filename = file.name || file.path.split('/').pop();
        const iconClass = getFileIcon({ name: filename, isDirectory: false });
        icon.className = `codicon tree-item-icon ${iconClass}`;

        const fileName = document.createElement('span');
        fileName.className = 'search-result-file-name';
        fileName.textContent = filename;

        const filePath = document.createElement('span');
        filePath.className = 'search-result-file-path';
        filePath.textContent = file.path;

        const count = document.createElement('span');
        count.className = 'search-result-file-count';
        count.textContent = file.matches?.length || 1;

        header.appendChild(chevron);
        header.appendChild(icon);
        header.appendChild(fileName);
        header.appendChild(filePath);
        header.appendChild(count);

        // Toggle expand/collapse (use collapsed class instead of expanded)
        header.addEventListener('click', () => {
            fileDiv.classList.toggle('collapsed');
        });

        // Double-click to open file
        header.addEventListener('dblclick', () => {
            vscode.postMessage({
                command: 'openFile',
                data: { path: file.path, panel: 'remote' }
            });
        });

        fileDiv.appendChild(header);

        // Matches container
        if (file.matches && file.matches.length > 0) {
            const matchesDiv = document.createElement('div');
            matchesDiv.className = 'search-result-matches';

            file.matches.forEach(match => {
                const matchElement = createSearchResultMatchElement(match, file.path);
                matchesDiv.appendChild(matchElement);
            });

            fileDiv.appendChild(matchesDiv);
        }

        return fileDiv;
    }

    /**
     * Create search result match element
     * @param {Object} match - Match object
     * @param {string} filePath - File path
     * @returns {HTMLElement}
     */
    function createSearchResultMatchElement(match, filePath) {
        const matchDiv = document.createElement('div');
        matchDiv.className = 'search-result-match';

        const lineNumber = document.createElement('span');
        lineNumber.className = 'search-result-match-line-number';
        lineNumber.textContent = match.line || '';

        const matchText = document.createElement('span');
        matchText.className = 'search-result-match-text';

        // Highlight matched text
        if (match.text && match.matchStart !== undefined && match.matchEnd !== undefined) {
            const before = match.text.substring(0, match.matchStart);
            const matched = match.text.substring(match.matchStart, match.matchEnd);
            const after = match.text.substring(match.matchEnd);

            matchText.innerHTML =
                escapeHtml(before) +
                '<span class="search-result-match-highlight">' + escapeHtml(matched) + '</span>' +
                escapeHtml(after);
        } else {
            matchText.textContent = match.text || '';
        }

        matchDiv.appendChild(lineNumber);
        matchDiv.appendChild(matchText);

        // Click to open file at specific line with highlighting
        matchDiv.addEventListener('click', () => {
            vscode.postMessage({
                command: 'openFileAtLine',
                data: {
                    path: filePath,
                    panel: 'remote',
                    line: match.line || 1,
                    matchStart: match.matchStart,
                    matchEnd: match.matchEnd
                }
            });
        });

        return matchDiv;
    }

    /**
     * Clear search results
     */
    function clearSearchResults() {
        currentSearchResults = [];
        const resultsList = document.getElementById('search-results-list');
        const resultsCount = document.getElementById('search-results-count');

        if (resultsList) {
            resultsList.innerHTML = '<div class="search-empty-message">Enter a search query and press Search</div>';
        }
        if (resultsCount) {
            resultsCount.textContent = 'No results';
        }
    }

    /**
     * Show search error
     * @param {string} errorMessage
     */
    function showSearchError(errorMessage) {
        const resultsList = document.getElementById('search-results-list');
        if (resultsList) {
            resultsList.innerHTML = `
                <div class="search-error">
                    <strong>Search Error:</strong><br>
                    ${escapeHtml(errorMessage)}
                </div>
            `;
        }
    }

    // ===== Batch Rename Functionality =====

    /** @type {Array<{oldPath: string, oldName: string, newName: string, panel: string}>} */
    let batchRenameFiles = [];

    /**
     * Initialize batch rename modal
     */
    function initializeBatchRename() {
        // Close button
        document.getElementById('batch-rename-close')?.addEventListener('click', closeBatchRenameModal);
        document.getElementById('batch-rename-cancel')?.addEventListener('click', closeBatchRenameModal);

        // Mode tabs
        document.querySelectorAll('.rename-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                switchRenameMode(tab.dataset.mode);
            });
        });

        // Find & Replace inputs
        document.getElementById('find-input')?.addEventListener('input', updateBatchRenamePreview);
        document.getElementById('replace-input')?.addEventListener('input', updateBatchRenamePreview);
        document.getElementById('find-regex-toggle')?.addEventListener('click', function() {
            this.classList.toggle('active');
            updateBatchRenamePreview();
        });
        document.getElementById('find-case-toggle')?.addEventListener('click', function() {
            this.classList.toggle('active');
            updateBatchRenamePreview();
        });

        // Pattern input
        document.getElementById('pattern-input')?.addEventListener('input', updateBatchRenamePreview);

        // Apply button
        document.getElementById('batch-rename-apply')?.addEventListener('click', applyBatchRename);

        // Close on background click
        document.getElementById('batch-rename-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'batch-rename-modal') {
                closeBatchRenameModal();
            }
        });
    }

    /**
     * Open batch rename modal with selected files
     * @param {Array<{path: string, name: string, panel: string}>} files
     */
    function openBatchRenameModal(files) {
        if (!files || files.length === 0) {
            return;
        }

        batchRenameFiles = files.map(f => ({
            oldPath: f.path,
            oldName: f.name,
            newName: f.name,
            panel: f.panel
        }));

        // Update title
        const title = document.getElementById('batch-rename-title');
        if (title) {
            title.textContent = `Batch Rename (${files.length} ${files.length === 1 ? 'file' : 'files'})`;
        }

        // Reset form
        const findInput = document.getElementById('find-input');
        const replaceInput = document.getElementById('replace-input');
        const patternInput = document.getElementById('pattern-input');
        if (findInput) findInput.value = '';
        if (replaceInput) replaceInput.value = '';
        if (patternInput) patternInput.value = '';

        // Reset toggles
        document.getElementById('find-regex-toggle')?.classList.remove('active');
        document.getElementById('find-case-toggle')?.classList.remove('active');

        // Switch to find & replace mode
        switchRenameMode('find-replace');

        // Update preview
        updateBatchRenamePreview();

        // Show modal
        const modal = document.getElementById('batch-rename-modal');
        if (modal) {
            modal.style.display = 'flex';
        }
    }

    /**
     * Close batch rename modal
     */
    function closeBatchRenameModal() {
        const modal = document.getElementById('batch-rename-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        batchRenameFiles = [];
    }

    /**
     * Switch rename mode
     * @param {string} mode - 'find-replace' | 'pattern'
     */
    function switchRenameMode(mode) {
        // Update tabs
        document.querySelectorAll('.rename-tab').forEach(tab => {
            if (tab.dataset.mode === mode) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // Update panels
        document.querySelectorAll('.rename-mode-panel').forEach(panel => {
            if (panel.id === `${mode}-panel`) {
                panel.classList.add('active');
            } else {
                panel.classList.remove('active');
            }
        });

        // Update preview
        updateBatchRenamePreview();
    }

    /**
     * Update batch rename preview
     */
    function updateBatchRenamePreview() {
        const activeMode = document.querySelector('.rename-tab.active')?.dataset.mode || 'find-replace';

        if (activeMode === 'find-replace') {
            updateFindReplacePreview();
        } else if (activeMode === 'pattern') {
            updatePatternPreview();
        }
    }

    /**
     * Update find & replace preview
     */
    function updateFindReplacePreview() {
        const findInput = document.getElementById('find-input')?.value || '';
        const replaceInput = document.getElementById('replace-input')?.value || '';
        const useRegex = document.getElementById('find-regex-toggle')?.classList.contains('active');
        const caseSensitive = document.getElementById('find-case-toggle')?.classList.contains('active');

        // Update file new names
        batchRenameFiles.forEach(file => {
            if (!findInput) {
                file.newName = file.oldName;
                return;
            }

            try {
                if (useRegex) {
                    const flags = caseSensitive ? 'g' : 'gi';
                    const regex = new RegExp(findInput, flags);
                    file.newName = file.oldName.replace(regex, replaceInput);
                } else {
                    const searchStr = caseSensitive ? findInput : findInput.toLowerCase();
                    const oldNameStr = caseSensitive ? file.oldName : file.oldName.toLowerCase();

                    if (oldNameStr.includes(searchStr)) {
                        // Simple string replacement
                        if (caseSensitive) {
                            file.newName = file.oldName.split(findInput).join(replaceInput);
                        } else {
                            // Case-insensitive replacement
                            const regex = new RegExp(escapeRegExp(findInput), 'gi');
                            file.newName = file.oldName.replace(regex, replaceInput);
                        }
                    } else {
                        file.newName = file.oldName;
                    }
                }
            } catch (error) {
                // Invalid regex, keep original name
                file.newName = file.oldName;
            }
        });

        renderBatchRenamePreview();
    }

    /**
     * Update pattern preview
     */
    function updatePatternPreview() {
        const pattern = document.getElementById('pattern-input')?.value || '';

        if (!pattern) {
            batchRenameFiles.forEach(file => {
                file.newName = file.oldName;
            });
        } else {
            batchRenameFiles.forEach((file, index) => {
                let newName = pattern;

                // Replace {name} with original filename (without extension)
                const nameWithoutExt = file.oldName.replace(/\.[^.]+$/, '');
                const ext = file.oldName.match(/\.[^.]+$/)?.[0] || '';
                newName = newName.replace(/{name}/g, nameWithoutExt);

                // Replace {n} with number
                newName = newName.replace(/{n}/g, (index + 1).toString());

                // Replace {NN} with zero-padded number (2 digits)
                newName = newName.replace(/{NN}/g, (index + 1).toString().padStart(2, '0'));

                // Replace {NNN} with zero-padded number (3 digits)
                newName = newName.replace(/{NNN}/g, (index + 1).toString().padStart(3, '0'));

                // Add extension if pattern doesn't already have one
                if (!newName.includes('.') && ext) {
                    newName += ext;
                }

                file.newName = newName;
            });
        }

        renderBatchRenamePreview();
    }

    /**
     * Render batch rename preview list
     */
    function renderBatchRenamePreview() {
        const previewList = document.getElementById('rename-preview-list');
        const previewCount = document.getElementById('rename-preview-count');

        if (!previewList) return;

        // Check for duplicates and empty names
        const newNames = new Set();
        const errors = new Map();

        batchRenameFiles.forEach((file, index) => {
            if (!file.newName || file.newName.trim() === '') {
                errors.set(index, 'Empty name');
            } else if (newNames.has(file.newName)) {
                errors.set(index, 'Duplicate name');
            } else if (file.newName.includes('/') || file.newName.includes('\\')) {
                errors.set(index, 'Invalid characters');
            } else {
                newNames.add(file.newName);
            }
        });

        // Count changes
        const changedCount = batchRenameFiles.filter(f => f.oldName !== f.newName && !errors.has(batchRenameFiles.indexOf(f))).length;
        if (previewCount) {
            previewCount.textContent = `${changedCount} of ${batchRenameFiles.length} will be renamed`;
        }

        // Render preview items
        previewList.innerHTML = '';

        if (batchRenameFiles.length === 0) {
            previewList.innerHTML = '<div class="rename-preview-empty">No files selected</div>';
            return;
        }

        batchRenameFiles.forEach((file, index) => {
            const item = document.createElement('div');
            const hasError = errors.has(index);
            const isChanged = file.oldName !== file.newName && !hasError;

            item.className = `rename-preview-item ${hasError ? 'error' : isChanged ? 'changed' : 'unchanged'}`;

            // Icon
            const icon = document.createElement('span');
            icon.className = hasError ? 'codicon codicon-error' : isChanged ? 'codicon codicon-check' : 'codicon codicon-dash';
            item.appendChild(icon);

            // Old name
            const oldName = document.createElement('span');
            oldName.className = 'rename-preview-old';
            oldName.textContent = file.oldName;
            oldName.title = file.oldName;
            item.appendChild(oldName);

            // Arrow
            const arrow = document.createElement('span');
            arrow.className = 'rename-preview-arrow';
            arrow.textContent = '→';
            item.appendChild(arrow);

            // New name
            const newName = document.createElement('span');
            newName.className = 'rename-preview-new';
            newName.textContent = file.newName || '(empty)';
            newName.title = file.newName;
            item.appendChild(newName);

            // Error message
            if (hasError) {
                const errorMsg = document.createElement('span');
                errorMsg.className = 'rename-preview-error';
                errorMsg.textContent = `(${errors.get(index)})`;
                item.appendChild(errorMsg);
            }

            previewList.appendChild(item);
        });
    }

    /**
     * Apply batch rename
     */
    function applyBatchRename() {
        // Filter out files that won't be renamed or have errors
        const filesToRename = batchRenameFiles.filter(file => {
            if (!file.newName || file.newName.trim() === '') return false;
            if (file.newName === file.oldName) return false;
            if (file.newName.includes('/') || file.newName.includes('\\')) return false;
            return true;
        });

        if (filesToRename.length === 0) {
            vscode.postMessage({
                command: 'showError',
                message: 'No valid files to rename'
            });
            return;
        }

        // Check for duplicates
        const newNames = new Set();
        for (const file of filesToRename) {
            if (newNames.has(file.newName)) {
                vscode.postMessage({
                    command: 'showError',
                    message: `Duplicate name detected: ${file.newName}`
                });
                return;
            }
            newNames.add(file.newName);
        }

        // Send batch rename request
        vscode.postMessage({
            command: 'batchRename',
            data: {
                files: filesToRename.map(f => ({
                    oldPath: f.oldPath,
                    newName: f.newName,
                    panel: f.panel
                }))
            }
        });

        closeBatchRenameModal();
    }

    /**
     * Escape string for use in RegExp
     */
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Update more button to back button
     */
    function updateMoreButtonToBackButton() {
        const moreToggle = document.getElementById('more-toggle');
        if (moreToggle) {
            const icon = moreToggle.querySelector('.codicon');
            if (icon) {
                icon.className = 'codicon codicon-arrow-left';
            }
            moreToggle.title = 'Back to File List';
        }
    }

    /**
     * Restore more button to normal state
     */
    function restoreMoreButtonToNormal() {
        const moreToggle = document.getElementById('more-toggle');
        if (moreToggle) {
            const icon = moreToggle.querySelector('.codicon');
            if (icon) {
                icon.className = 'codicon codicon-kebab-vertical';
            }
            moreToggle.title = 'More...';
        }
    }

    /**
     * Export functions to be called by PortForwardModule
     */
    if (typeof window !== 'undefined') {
        window.updateMoreButtonToBackButton = updateMoreButtonToBackButton;
        window.restoreMoreButtonToNormal = restoreMoreButtonToNormal;
    }

    // ===== Footer Stats & Progress =====
    /**
     * Update footer statistics for a panel
     * @param {string} panel - 'local' | 'remote'
     */
    function updateFooterStats(panel) {
        // Find footer elements
        const panelEl = document.querySelector(`.${panel}-panel`);
        if (!panelEl) return;

        const footerStats = panelEl.querySelector('.footer-stats');
        const footerProgress = panelEl.querySelector('.footer-progress');

        // Ensure stats are visible and progress is hidden by default
        if (footerStats) footerStats.style.display = 'flex';
        if (footerProgress) footerProgress.style.display = 'none';

        // Count items
        const treeContainer = document.getElementById(`${panel}-tree`);
        if (!treeContainer) return;

        // Count all displayable items (excluding back item and empty messages)
        const items = Array.from(treeContainer.querySelectorAll('.tree-item:not(.back-item):not(.new-folder-wrapper):not(.new-file-wrapper)'));
        const itemCount = items.length;

        // Count selected items in this panel
        const selectedInPanel = selectedItems.filter(item => item.dataset.panel === panel);
        const selectedCount = selectedInPanel.length;

        // Calculate total size of selected files (excluding directories)
        let totalSize = 0;
        let fileCount = 0;
        selectedInPanel.forEach(item => {
            // Only count files, not directories
            if (item.dataset.isDir !== 'true' && item.dataset.size) {
                const size = Number.parseFloat(item.dataset.size);
                if (!isNaN(size)) {
                    totalSize += size;
                    fileCount++;
                }
            }
        });

        // Update elements
        const itemCountEl = panelEl.querySelector('.item-count');
        const selectedCountEl = panelEl.querySelector('.selection-info');

        if (itemCountEl) {
            itemCountEl.textContent = `${itemCount} items`;
        }

        if (selectedCountEl) {
            if (selectedCount > 0) {
                let text = `${selectedCount} selected`;
                // Add total size if there are files selected (not just folders)
                if (fileCount > 0 && totalSize > 0) {
                    text += ` (${formatFileSize(totalSize)})`;
                }
                selectedCountEl.textContent = text;
                selectedCountEl.style.display = 'inline';
            } else {
                selectedCountEl.style.display = 'none';
            }
        }
    }

    /**
     * Show progress message in panel footer
     * @param {string} panel - 'local' | 'remote'
     * @param {string} message - Message to display
     */
    function showFooterProgress(panel, message) {
        const panelEl = document.querySelector(`.${panel}-panel`);
        if (!panelEl) return;

        const footerStats = panelEl.querySelector('.footer-stats');
        const footerProgress = panelEl.querySelector('.footer-progress');
        const progressMessage = panelEl.querySelector('.progress-message');

        if (footerStats) footerStats.style.display = 'none';
        if (footerProgress) {
            footerProgress.style.display = 'flex';
            if (progressMessage) progressMessage.textContent = message;
        }
    }

    /**
     * Hide progress and show stats
     * @param {string} panel - 'local' | 'remote'
     * @param {number} delay - Delay in ms before hiding
     */
    function hideFooterProgress(panel, delay = 0) {
        if (delay > 0) {
            setTimeout(() => hideFooterProgress(panel, 0), delay);
            return;
        }

        const panelEl = document.querySelector(`.${panel}-panel`);
        if (!panelEl) return;

        const footerStats = panelEl.querySelector('.footer-stats');
        const footerProgress = panelEl.querySelector('.footer-progress');

        if (footerProgress) footerProgress.style.display = 'none';
        if (footerStats) footerStats.style.display = 'flex';

        // Update stats to ensure they are current
        updateFooterStats(panel);
    }

    // Initialize batch rename when DOM is ready
    initializeBatchRename();

    // ===== Message Handling from Extension =====

    // Listen for messages from extension to trigger batch rename
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'openBatchRename':
                if (message.files) {
                    openBatchRenameModal(message.files);
                }
                break;
        }
    });

})();
