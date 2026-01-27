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
        initPortForwardView();

        // 通知扩展 WebView 已准备就绪
        vscode.postMessage({ command: 'ready' });
    });

    // ===== 事件监听器 =====
    function initializeEventListeners() {
        // Header buttons
        document.getElementById('back-to-hosts')?.addEventListener('click', backToHostSelection);
        document.getElementById('refresh-local')?.addEventListener('click', () => refreshPanel('local'));
        document.getElementById('refresh-remote')?.addEventListener('click', () => refreshPanel('remote'));

        // Toolbar buttons
        document.getElementById('new-local-folder')?.addEventListener('click', () => createFolder('local'));
        document.getElementById('new-remote-folder')?.addEventListener('click', () => createFolder('remote'));
        document.getElementById('upload-selected')?.addEventListener('click', uploadSelected);
        document.getElementById('download-selected')?.addEventListener('click', downloadSelected);

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

        // 双击还原默认尺寸
        resizer.addEventListener('dblclick', () => {
            localPanel.style.flex = '1';
            remotePanel.style.flex = '1';
            updatePercentage(50);
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

        // 清空搜索框
        const searchInput = document.getElementById(`${panel}-search`);
        if (searchInput) {
            searchInput.value = '';
        }

        // 清空内容
        treeContainer.innerHTML = '';

        // 添加返回上一级按钮(如果不是根目录)
        const currentPath = panel === 'local' ? currentLocalPath : currentRemotePath;
        if (currentPath && currentPath !== '/' && currentPath !== '' && currentPath !== 'drives://') {
            const backItem = createBackItem(panel);
            treeContainer.appendChild(backItem);
        }

        // 渲染当前目录的所有文件和文件夹
        nodes.forEach(node => {
            const item = createTreeItem(node, panel);
            treeContainer.appendChild(item);
        });
    }

    /**
     * 创建返回上一级按钮
     * @param {string} panel
     * @returns {HTMLElement}
     */
    function createBackItem(panel) {
        const item = document.createElement('div');
        item.className = 'tree-item back-item';

        // Icon
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-arrow-up tree-item-icon';
        item.appendChild(icon);

        // Label
        const label = document.createElement('span');
        label.className = 'tree-item-label';
        label.textContent = '..';
        item.appendChild(label);

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

        // Modified time
        if (node.modifiedTime) {
            const time = document.createElement('span');
            time.className = 'tree-item-time';
            time.textContent = formatTime(node.modifiedTime);
            item.appendChild(time);
        }

        // Permissions (for both local and remote files)
        console.log(`createTreeItem: panel=${panel}, node.permissions=${node.permissions}, node.mode=${node.mode}`);
        if (node.permissions) {
            const permissions = document.createElement('span');
            permissions.className = 'tree-item-permissions';
            permissions.textContent = node.permissions;
            permissions.title = `Mode: ${node.mode ? node.mode.toString(8) : 'N/A'}`;
            item.appendChild(permissions);
        }

        // Size (for files) or placeholder (for folders)
        const size = document.createElement('span');
        size.className = 'tree-item-size';
        if (!node.isDirectory && node.size !== undefined) {
            size.textContent = formatFileSize(node.size);
        } else {
            size.textContent = '-';  // 文件夹显示占位符
        }
        item.appendChild(size);

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

        return item;
    }

    // ===== 辅助函数 =====

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

        treeContainer.innerHTML = `
            <div class="loading">
                <span class="codicon codicon-loading codicon-modifier-spin"></span>
                Loading ${panel} files...
            </div>
        `;
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
            'package.json': 'codicon-extensions',
            'package-lock.json': 'codicon-lock',
            'yarn.lock': 'codicon-lock',
            'pnpm-lock.yaml': 'codicon-lock',
            'composer.json': 'codicon-extensions',
            'composer.lock': 'codicon-lock',
            'gemfile': 'codicon-ruby',
            'gemfile.lock': 'codicon-lock',
            'cargo.toml': 'codicon-package',
            'cargo.lock': 'codicon-lock',
            'go.mod': 'codicon-package',
            'go.sum': 'codicon-lock',
            'requirements.txt': 'codicon-package',
            'pipfile': 'codicon-package',
            'pipfile.lock': 'codicon-lock',

            // Config files
            'tsconfig.json': 'codicon-settings-gear',
            'jsconfig.json': 'codicon-settings-gear',
            'webpack.config.js': 'codicon-settings-gear',
            'vite.config.js': 'codicon-settings-gear',
            'vite.config.ts': 'codicon-settings-gear',
            'rollup.config.js': 'codicon-settings-gear',
            'babel.config.js': 'codicon-settings-gear',
            '.babelrc': 'codicon-settings-gear',
            'eslint.config.js': 'codicon-checklist',
            '.eslintrc': 'codicon-checklist',
            '.eslintrc.js': 'codicon-checklist',
            '.eslintrc.json': 'codicon-checklist',
            '.prettierrc': 'codicon-symbol-color',
            '.editorconfig': 'codicon-settings-gear',
            'docker-compose.yml': 'codicon-vm-active',
            'docker-compose.yaml': 'codicon-vm-active',
            'dockerfile': 'codicon-vm',
            '.dockerignore': 'codicon-vm',

            // README and docs
            'readme.md': 'codicon-book',
            'readme': 'codicon-book',
            'changelog.md': 'codicon-versions',
            'changelog': 'codicon-versions',
            'license': 'codicon-law',
            'license.md': 'codicon-law',
            'contributing.md': 'codicon-organization',

            // Git
            '.gitignore': 'codicon-git-commit',
            '.gitattributes': 'codicon-git-commit',
            '.gitmodules': 'codicon-git-commit',
            '.gitkeep': 'codicon-git-commit',

            // CI/CD
            '.travis.yml': 'codicon-build',
            'jenkinsfile': 'codicon-build',
            '.gitlab-ci.yml': 'codicon-build',
            'azure-pipelines.yml': 'codicon-build',

            // Environment
            '.env': 'codicon-settings',
            '.env.local': 'codicon-settings',
            '.env.development': 'codicon-settings',
            '.env.production': 'codicon-settings',
        };

        if (specialFiles[fileName]) {
            return specialFiles[fileName];
        }

        const ext = node.name.split('.').pop()?.toLowerCase();
        const iconMap = {
            // JavaScript/TypeScript
            'js': 'codicon-symbol-namespace',
            'jsx': 'codicon-symbol-namespace',
            'ts': 'codicon-symbol-interface',
            'tsx': 'codicon-symbol-interface',
            'mjs': 'codicon-symbol-namespace',
            'cjs': 'codicon-symbol-namespace',
            'vue': 'codicon-symbol-namespace',

            // Data formats
            'json': 'codicon-json',
            'xml': 'codicon-code',
            'yaml': 'codicon-symbol-key',
            'yml': 'codicon-symbol-key',
            'toml': 'codicon-symbol-key',
            'ini': 'codicon-symbol-key',
            'csv': 'codicon-graph',
            'tsv': 'codicon-graph',

            // Markup/Documentation
            'md': 'codicon-markdown',
            'markdown': 'codicon-markdown',
            'html': 'codicon-code',
            'htm': 'codicon-code',
            'xhtml': 'codicon-code',
            'txt': 'codicon-file-text',
            'pdf': 'codicon-file-pdf',
            'doc': 'codicon-file-text',
            'docx': 'codicon-file-text',
            'odt': 'codicon-file-text',
            'rtf': 'codicon-file-text',

            // Styling
            'css': 'codicon-symbol-color',
            'scss': 'codicon-symbol-color',
            'sass': 'codicon-symbol-color',
            'less': 'codicon-symbol-color',
            'styl': 'codicon-symbol-color',

            // Programming languages
            'py': 'codicon-snake',
            'pyc': 'codicon-file-binary',
            'pyd': 'codicon-file-binary',
            'java': 'codicon-symbol-class',
            'class': 'codicon-file-binary',
            'jar': 'codicon-file-zip',
            'c': 'codicon-symbol-method',
            'cpp': 'codicon-symbol-method',
            'cc': 'codicon-symbol-method',
            'cxx': 'codicon-symbol-method',
            'h': 'codicon-symbol-method',
            'hpp': 'codicon-symbol-method',
            'hxx': 'codicon-symbol-method',
            'cs': 'codicon-symbol-class',
            'go': 'codicon-symbol-namespace',
            'rs': 'codicon-symbol-struct',
            'php': 'codicon-symbol-misc',
            'rb': 'codicon-ruby',
            'swift': 'codicon-symbol-class',
            'kt': 'codicon-symbol-class',
            'kts': 'codicon-symbol-class',
            'scala': 'codicon-symbol-class',
            'lua': 'codicon-symbol-namespace',
            'pl': 'codicon-symbol-namespace',
            'pm': 'codicon-symbol-namespace',
            'r': 'codicon-graph',
            'dart': 'codicon-symbol-class',
            'elm': 'codicon-symbol-namespace',
            'ex': 'codicon-symbol-namespace',
            'exs': 'codicon-symbol-namespace',
            'erl': 'codicon-symbol-namespace',
            'hrl': 'codicon-symbol-namespace',
            'clj': 'codicon-symbol-namespace',
            'cljs': 'codicon-symbol-namespace',
            'hs': 'codicon-symbol-namespace',
            'ml': 'codicon-symbol-namespace',
            'fs': 'codicon-symbol-namespace',

            // Shell/Scripts
            'sh': 'codicon-terminal',
            'bash': 'codicon-terminal',
            'zsh': 'codicon-terminal',
            'fish': 'codicon-terminal',
            'ps1': 'codicon-terminal-powershell',
            'psm1': 'codicon-terminal-powershell',
            'bat': 'codicon-terminal-cmd',
            'cmd': 'codicon-terminal-cmd',

            // Images
            'png': 'codicon-file-media',
            'jpg': 'codicon-file-media',
            'jpeg': 'codicon-file-media',
            'gif': 'codicon-file-media',
            'svg': 'codicon-file-media',
            'ico': 'codicon-file-media',
            'webp': 'codicon-file-media',
            'bmp': 'codicon-file-media',
            'tiff': 'codicon-file-media',
            'tif': 'codicon-file-media',
            'psd': 'codicon-file-media',
            'ai': 'codicon-file-media',
            'eps': 'codicon-file-media',
            'raw': 'codicon-file-media',

            // Audio/Video
            'mp3': 'codicon-music',
            'wav': 'codicon-music',
            'flac': 'codicon-music',
            'aac': 'codicon-music',
            'ogg': 'codicon-music',
            'wma': 'codicon-music',
            'm4a': 'codicon-music',
            'mp4': 'codicon-play',
            'avi': 'codicon-play',
            'mov': 'codicon-play',
            'mkv': 'codicon-play',
            'webm': 'codicon-play',
            'flv': 'codicon-play',
            'wmv': 'codicon-play',

            // Archives
            'zip': 'codicon-file-zip',
            'tar': 'codicon-file-zip',
            'gz': 'codicon-file-zip',
            'bz2': 'codicon-file-zip',
            'xz': 'codicon-file-zip',
            'rar': 'codicon-file-zip',
            '7z': 'codicon-file-zip',
            'tgz': 'codicon-file-zip',
            'tbz': 'codicon-file-zip',
            'deb': 'codicon-package',
            'rpm': 'codicon-package',
            'apk': 'codicon-package',
            'dmg': 'codicon-package',
            'iso': 'codicon-file-zip',

            // Fonts
            'ttf': 'codicon-symbol-color',
            'otf': 'codicon-symbol-color',
            'woff': 'codicon-symbol-color',
            'woff2': 'codicon-symbol-color',
            'eot': 'codicon-symbol-color',

            // Database
            'sql': 'codicon-database',
            'db': 'codicon-database',
            'sqlite': 'codicon-database',
            'sqlite3': 'codicon-database',
            'mdb': 'codicon-database',

            // Binary/Executables
            'exe': 'codicon-file-binary',
            'dll': 'codicon-file-binary',
            'so': 'codicon-file-binary',
            'dylib': 'codicon-file-binary',
            'o': 'codicon-file-binary',
            'a': 'codicon-file-binary',
            'lib': 'codicon-file-binary',
            'bin': 'codicon-file-binary',

            // Others
            'log': 'codicon-output',
            'lock': 'codicon-lock',
            'pid': 'codicon-symbol-numeric',
            'cert': 'codicon-shield',
            'pem': 'codicon-shield',
            'key': 'codicon-key',
            'pub': 'codicon-key',
            'crt': 'codicon-shield',
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
        rootSpan.title = 'Go to root';
        rootSpan.addEventListener('click', function() {
            loadDirectory(panel, this.dataset.path);
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
            segment.title = `Go to ${segment.dataset.path}`;

            // Make all but last segment clickable
            if (i < segments.length - 1) {
                segment.classList.add('breadcrumb-clickable');
                segment.addEventListener('click', function() {
                    loadDirectory(panel, this.dataset.path);
                });
            } else {
                segment.classList.add('breadcrumb-current');
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

            case 'triggerCreateFolder':
                // Trigger inline folder creation from context menu
                createFolder(message.panel);
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
                    remoteTree.innerHTML = `
                        <div class="loading">
                            <span class="codicon codicon-loading codicon-modifier-spin"></span>
                            Loading remote files...
                        </div>
                    `;
                }
                break;
            }

            case 'updateStatus':
                document.getElementById('status-text').textContent = message.text;
                break;

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

            case 'portForwardings':
                // Update port forwarding list
                renderPortForwardings(message.data);
                break;

            case 'portForwardingStarted':
                // Refresh port forwarding list
                vscode.postMessage({ command: 'getPortForwardings' });
                break;

            case 'portForwardingStopped':
                // Refresh port forwarding list
                vscode.postMessage({ command: 'getPortForwardings' });
                break;

            case 'portForwardingError':
                // Show error message
                alert(`Port Forwarding Error: ${message.error || 'Unknown error'}`);
                vscode.postMessage({ command: 'getPortForwardings' });
                break;

            case 'remotePorts':
                // Update remote ports list
                renderRemotePorts(message.data);
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
                                ${host.hasAuth ? '' : '<span class="codicon codicon-warning host-no-auth" title="No authentication configured"></span>'}
                                <div class="host-info">
                                    <div class="host-name">
                                        ${host.name}
                                        ${host.group ? `<span class="host-group">[${host.group}]</span>` : ''}
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
        remoteTree.innerHTML = '<div class="empty-message">← Select a host to start browsing</div>';

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
        toggleButton?.addEventListener('click', () => {
            if (isSearchViewVisible) {
                closeSearchView();
            } else {
                openSearchView();
            }
        });

        // Start search button
        const searchButton = document.getElementById('start-search-button');
        searchButton?.addEventListener('click', performSearch);

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

    function initPortForwardView() {
        // Toggle port forwarding view button
        const toggleButton = document.getElementById('toggle-port-forward-view');
        toggleButton?.addEventListener('click', () => {
            if (isPortForwardViewVisible) {
                closePortForwardView();
            } else {
                openPortForwardView();
            }
        });

        // Add port button
        const addPortButton = document.getElementById('add-port-forward');
        addPortButton?.addEventListener('click', showAddPortModal);

        // Add port modal close buttons
        const addPortClose = document.getElementById('add-port-close');
        const cancelAddPort = document.getElementById('cancel-add-port');
        const confirmAddPort = document.getElementById('confirm-add-port');

        addPortClose?.addEventListener('click', hideAddPortModal);
        cancelAddPort?.addEventListener('click', hideAddPortModal);
        confirmAddPort?.addEventListener('click', handleAddPort);

        // Scan remote ports button
        const scanPortsButton = document.getElementById('scan-remote-ports');
        scanPortsButton?.addEventListener('click', handleScanRemotePorts);
    }

    function openPortForwardView() {
        const portForwardView = document.getElementById('panel-port-forward-view');
        const remoteTree = document.getElementById('remote-tree');
        const searchView = document.getElementById('panel-search-view');

        if (portForwardView && remoteTree) {
            // Close search view if open
            if (isSearchViewVisible) {
                closeSearchView();
            }

            // Hide file tree, show port forward view
            remoteTree.style.display = 'none';
            if (searchView) {
                searchView.style.display = 'none';
            }
            portForwardView.style.display = 'flex';
            isPortForwardViewVisible = true;

            // Request port forwarding list from backend
            vscode.postMessage({ command: 'getPortForwardings' });

            // Auto-scan remote ports on view open
            handleScanRemotePorts();
        }
    }

    function closePortForwardView() {
        const portForwardView = document.getElementById('panel-port-forward-view');
        const remoteTree = document.getElementById('remote-tree');

        if (portForwardView && remoteTree) {
            portForwardView.style.display = 'none';
            remoteTree.style.display = 'block';
            isPortForwardViewVisible = false;
        }
    }

    function showAddPortModal() {
        const modal = document.getElementById('add-port-modal');
        if (modal) {
            modal.style.display = 'flex';
            // Focus on remote port input
            const remotePortInput = document.getElementById('port-remote-port');
            setTimeout(() => remotePortInput?.focus(), 100);
        }
    }

    function hideAddPortModal() {
        const modal = document.getElementById('add-port-modal');
        if (modal) {
            modal.style.display = 'none';
            // Clear inputs
            document.getElementById('port-remote-port').value = '';
            document.getElementById('port-local-port').value = '';
            document.getElementById('port-label').value = '';
            document.getElementById('port-remote-host').value = 'localhost';
        }
    }

    function handleAddPort() {
        const remotePort = parseInt(document.getElementById('port-remote-port').value);
        const localPort = document.getElementById('port-local-port').value;
        const label = document.getElementById('port-label').value;
        const remoteHost = document.getElementById('port-remote-host').value || 'localhost';

        if (!remotePort || remotePort < 1 || remotePort > 65535) {
            alert('Please enter a valid remote port (1-65535)');
            return;
        }

        const config = {
            remotePort,
            localPort: localPort ? parseInt(localPort) : undefined,
            label,
            remoteHost
        };

        vscode.postMessage({
            command: 'startPortForward',
            config
        });

        hideAddPortModal();
    }

    // Port forwarding state (initialized earlier)
    let currentRemotePorts = [];

    function renderPortForwardings(forwardings) {
        currentForwardings = forwardings || [];
        renderUnifiedPorts();
    }

    function renderUnifiedPorts() {
        const tbody = document.getElementById('unified-ports-table-body');
        if (!tbody) return;

        // Create a map of all ports (using port number as key)
        const portsMap = new Map();

        // First, add all remote ports
        currentRemotePorts.forEach(rp => {
            portsMap.set(rp.port, {
                port: rp.port,
                process: rp.processName,
                pid: rp.pid,
                command: rp.command,
                listenAddress: rp.listenAddress,
                status: 'available',
                forwarding: null
            });
        });

        // Then, overlay/update with active forwardings
        currentForwardings.forEach(f => {
            const existingPort = portsMap.get(f.remotePort);
            if (existingPort) {
                existingPort.status = 'forwarded';
                existingPort.forwarding = f;
            } else {
                // Forwarding exists but port not detected (might be stopped process)
                portsMap.set(f.remotePort, {
                    port: f.remotePort,
                    process: f.runningProcess || '-',
                    pid: null,
                    command: null,
                    listenAddress: '-',
                    status: 'forwarded',
                    forwarding: f
                });
            }
        });

        // Sort by port number
        const sortedPorts = Array.from(portsMap.values()).sort((a, b) => a.port - b.port);

        // Render table
        if (sortedPorts.length === 0) {
            tbody.innerHTML = '<tr class=\"port-forward-empty\"><td colspan=\"6\">No ports detected</td></tr>';
            return;
        }

        tbody.innerHTML = sortedPorts.map(portInfo => {
            const { port, process, pid, command, listenAddress, status, forwarding } = portInfo;

            // Process info with tooltip
            const processInfo = command
                ? `<span title=\"${command.replace(/\"/g, '&quot;')}\">${process || 'Unknown'}${pid ? ` (${pid})` : ''}</span>`
                : (process
                    ? `${process}${pid ? ` (${pid})` : ''}`
                    : '-');

            // Status badge
            let statusBadge = '';
            if (status === 'forwarded') {
                statusBadge = '<span class=\"port-status-badge forwarded\">Forwarded</span>';
            } else {
                statusBadge = '<span class=\"port-status-badge available\">Available</span>';
            }

            // Forwarded address
            const forwardedTo = forwarding
                ? `${forwarding.localHost}:${forwarding.localPort}`
                : '-';

            // Actions
            let actions = '';
            if (status === 'forwarded' && forwarding) {
                actions = `
                    <button class=\"port-forward-action-btn stop\" onclick=\"stopPortForward('${forwarding.id}')\">Stop</button>
                    <button class=\"port-forward-action-btn delete\" onclick=\"deletePortForward('${forwarding.id}')\">Delete</button>
                `;
            } else {
                actions = `<button class=\"port-forward-action-btn\" onclick=\"quickForwardPort(${port})\">Forward</button>`;
            }

            return `
                <tr data-port=\"${port}\" class=\"port-row-${status}\">
                    <td><strong>${port}</strong></td>
                    <td>${processInfo}</td>
                    <td>${listenAddress || '-'}</td>
                    <td>${statusBadge}</td>
                    <td>${forwardedTo}</td>
                    <td>
                        <div class=\"port-forward-actions\">
                            ${actions}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Make these functions global so they can be called from inline onclick
    window.stopPortForward = function(id) {
        vscode.postMessage({
            command: 'stopPortForward',
            id
        });
    };

    window.deletePortForward = function(id) {
        if (confirm('Are you sure you want to delete this port forwarding?')) {
            vscode.postMessage({
                command: 'deletePortForward',
                id
            });
        }
    };

    function handleScanRemotePorts() {
        vscode.postMessage({ command: 'scanRemotePorts' });

        // Show loading state
        const tbody = document.getElementById('unified-ports-table-body');
        if (tbody) {
            tbody.innerHTML = '<tr class="port-forward-empty"><td colspan="6"><span class="codicon codicon-loading codicon-modifier-spin"></span> Refreshing ports...</td></tr>';
        }
    }

    function renderRemotePorts(remotePorts) {
        currentRemotePorts = remotePorts || [];
        renderUnifiedPorts();
    }

    window.quickForwardPort = function(port) {
        // Pre-fill add port modal with detected port
        document.getElementById('port-remote-port').value = port;
        document.getElementById('port-local-port').value = port;
        showAddPortModal();
    };

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
