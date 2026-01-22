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
    /** @type {Object.<string, number>} */
    let loadingTimers = {};
    /** @type {number | null} */
    let clickTimer = null;

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
    }

    // ===== Panel Resizer =====
    function initializeResizer() {
        const resizer = document.getElementById('resizer');
        const localPanel = document.querySelector('.local-panel');
        const remotePanel = document.querySelector('.remote-panel');

        if (!resizer || !localPanel || !remotePanel) return;

        let isResizing = false;

        // 双击还原默认尺寸
        resizer.addEventListener('dblclick', () => {
            localPanel.style.flex = '1';
            remotePanel.style.flex = '1';
        });

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const containerWidth = document.querySelector('.dual-panel')?.clientWidth || 0;
            const newLeftWidth = e.clientX;
            const leftPercent = (newLeftWidth / containerWidth) * 100;

            if (leftPercent > 20 && leftPercent < 80) {
                localPanel.style.flex = `0 0 ${leftPercent}%`;
                remotePanel.style.flex = `1`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
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

        // VS Code Native Context Menu
        const contextData = {
            webviewSection: panel === 'local' ? 'localFile' : 'remoteFile',
            filePath: node.path,
            isDirectory: node.isDirectory,
            panel: panel,
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

        // Permissions (for remote files only)
        console.log(`createTreeItem: panel=${panel}, node.permissions=${node.permissions}, node.mode=${node.mode}`);
        if (panel === 'remote' && node.permissions) {
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
        const lowerSearchText = searchText.toLowerCase().trim();

        items.forEach(item => {
            const label = item.querySelector('.tree-item-label')?.textContent || '';

            if (lowerSearchText === '' || label.toLowerCase().includes(lowerSearchText)) {
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

        const ext = node.name.split('.').pop()?.toLowerCase();
        const iconMap = {
            // JavaScript/TypeScript
            'js': 'codicon-symbol-namespace',
            'jsx': 'codicon-symbol-namespace',
            'ts': 'codicon-symbol-interface',
            'tsx': 'codicon-symbol-interface',
            'mjs': 'codicon-symbol-namespace',
            'cjs': 'codicon-symbol-namespace',

            // Data formats
            'json': 'codicon-json',
            'xml': 'codicon-code',
            'yaml': 'codicon-symbol-key',
            'yml': 'codicon-symbol-key',
            'toml': 'codicon-symbol-key',
            'ini': 'codicon-symbol-key',
            'csv': 'codicon-graph',

            // Markup/Documentation
            'md': 'codicon-markdown',
            'markdown': 'codicon-markdown',
            'html': 'codicon-code',
            'htm': 'codicon-code',
            'txt': 'codicon-file-text',
            'pdf': 'codicon-file-pdf',

            // Styling
            'css': 'codicon-symbol-color',
            'scss': 'codicon-symbol-color',
            'sass': 'codicon-symbol-color',
            'less': 'codicon-symbol-color',

            // Programming languages
            'py': 'codicon-snake',
            'java': 'codicon-symbol-class',
            'c': 'codicon-symbol-method',
            'cpp': 'codicon-symbol-method',
            'h': 'codicon-symbol-method',
            'hpp': 'codicon-symbol-method',
            'cs': 'codicon-symbol-class',
            'go': 'codicon-symbol-namespace',
            'rs': 'codicon-symbol-struct',
            'php': 'codicon-symbol-misc',
            'rb': 'codicon-ruby',
            'swift': 'codicon-symbol-class',
            'kt': 'codicon-symbol-class',
            'scala': 'codicon-symbol-class',

            // Shell/Scripts
            'sh': 'codicon-terminal',
            'bash': 'codicon-terminal',
            'zsh': 'codicon-terminal',
            'ps1': 'codicon-terminal-powershell',
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

            // Archives
            'zip': 'codicon-file-zip',
            'tar': 'codicon-file-zip',
            'gz': 'codicon-file-zip',
            'rar': 'codicon-file-zip',
            '7z': 'codicon-file-zip',

            // Others
            'sql': 'codicon-database',
            'db': 'codicon-database',
            'sqlite': 'codicon-database',
            'log': 'codicon-output',
            'env': 'codicon-symbol-key',
            'git': 'codicon-git-commit',
            'gitignore': 'codicon-symbol-event',
            'dockerfile': 'codicon-vm',
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



    // ===== 其他交互 =====
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
    }

    // ===== Commands =====
    function backToHostSelection() {
        // 请求后端显示主机选择页面
        vscode.postMessage({
            command: 'backToHostSelection'
        });
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
                // 动态设置 flex-shrink: 越前面的值越大,越容易被隐藏
                const shrinkValue = segments.length - i;
                segment.style.flexShrink = shrinkValue;
                segment.addEventListener('click', function() {
                    loadDirectory(panel, this.dataset.path);
                });
            } else {
                segment.classList.add('breadcrumb-current');
            }

            breadcrumb.appendChild(segment);
        }

        // 滚动到最右边,显示当前路径
        setTimeout(() => {
            breadcrumb.scrollLeft = breadcrumb.scrollWidth;
        }, 0);
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
            // 检查是否在搜索框或新建文件夹输入框中
            const activeElement = document.activeElement;
            const isInInput = activeElement && (
                activeElement.id === 'local-search' ||
                activeElement.id === 'remote-search' ||
                activeElement.classList.contains('tree-item-input')
            );

            // 只有当不在输入框中时才返回上一级
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
        }
    });

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
})();
