// Dual Panel File Browser - Frontend Logic (Flat Directory Navigation)
// @ts-check

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    /** @type {HTMLElement | null} */
    let selectedItem = null;
    /** @type {HTMLElement | null} */
    let draggedItem = null;
    /** @type {string} */
    let currentLocalPath = '';
    /** @type {string} */
    let currentRemotePath = '';

    // ===== 初始化 =====
    document.addEventListener('DOMContentLoaded', () => {
        initializeEventListeners();
        initializeResizer();
        initializeDragAndDrop();

        // 通知扩展 WebView 已准备就绪
        vscode.postMessage({ command: 'ready' });
    });

    // ===== 事件监听器 =====
    function initializeEventListeners() {
        // Header buttons
        document.getElementById('refresh-local')?.addEventListener('click', () => refreshPanel('local'));
        document.getElementById('refresh-remote')?.addEventListener('click', () => refreshPanel('remote'));

        // Toolbar buttons
        document.getElementById('new-local-folder')?.addEventListener('click', () => createFolder('local'));
        document.getElementById('new-remote-folder')?.addEventListener('click', () => createFolder('remote'));
        document.getElementById('upload-selected')?.addEventListener('click', uploadSelected);
        document.getElementById('download-selected')?.addEventListener('click', downloadSelected);

        // Keyboard shortcuts
        document.addEventListener('keydown', handleKeyboardShortcuts);
    }

    // ===== Panel Resizer =====
    function initializeResizer() {
        const resizer = document.getElementById('resizer');
        const localPanel = document.querySelector('.local-panel');
        const remotePanel = document.querySelector('.remote-panel');

        if (!resizer || !localPanel || !remotePanel) return;

        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
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

    // ===== Drag and Drop =====
    function initializeDragAndDrop() {
        const localTree = document.getElementById('local-tree');
        const remoteTree = document.getElementById('remote-tree');

        if (!localTree || !remoteTree) return;

        // Local tree events
        localTree.addEventListener('dragstart', handleDragStart);
        localTree.addEventListener('dragover', handleDragOver);
        localTree.addEventListener('drop', handleDrop);
        localTree.addEventListener('dragend', handleDragEnd);

        // Remote tree events
        remoteTree.addEventListener('dragstart', handleDragStart);
        remoteTree.addEventListener('dragover', handleDragOver);
        remoteTree.addEventListener('drop', handleDrop);
        remoteTree.addEventListener('dragend', handleDragEnd);
    }

    // ===== 文件树渲染 =====
    /**
     * @param {string} panel - 'local' | 'remote'
     * @param {Array<Object>} nodes - 文件节点数组
     */
    function renderFileTree(panel, nodes) {
        const treeContainer = document.getElementById(`${panel}-tree`);
        if (!treeContainer) return;

        // 清空内容
        treeContainer.innerHTML = '';

        // 添加返回上一级按钮(如果不是根目录)
        const currentPath = panel === 'local' ? currentLocalPath : currentRemotePath;
        if (currentPath && currentPath !== '/' && currentPath !== '') {
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
        item.draggable = true;

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

        // Size (for files)
        if (!node.isDirectory && node.size !== undefined) {
            const size = document.createElement('span');
            size.className = 'tree-item-size';
            size.textContent = formatFileSize(node.size);
            item.appendChild(size);
        }

        // Event listeners
        item.addEventListener('click', (e) => {
            if (node.isDirectory) {
                // 单击文件夹进入
                loadDirectory(panel, node.path);
            } else {
                selectItem(item);
            }
        });

        item.addEventListener('dblclick', (e) => {
            if (!node.isDirectory) {
                // 双击文件打开
                vscode.postMessage({
                    command: 'openFile',
                    data: { path: node.path, panel }
                });
            }
        });

        return item;
    }

    // ===== 辅助函数 =====

    /**
     * 获取父目录路径
     */
    function getParentPath(path, panel) {
        if (!path || path === '/' || path === '') return null;

        if (panel === 'local') {
            // Windows: C:\Users\iwang -> C:\Users
            // Unix: /home/user -> /home
            const separator = path.includes('\\') ? '\\' : '/';
            const parts = path.split(separator).filter(p => p);
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
        vscode.postMessage({
            command: panel === 'local' ? 'loadLocalDir' : 'loadRemoteDir',
            path: path
        });
    }

    /**
     * @param {Object} node
     * @returns {string}
     */
    function getFileIcon(node) {
        if (node.isDirectory) {
            return 'codicon-folder';
        }

        const ext = node.name.split('.').pop()?.toLowerCase();
        const iconMap = {
            'js': 'codicon-symbol-namespace',
            'ts': 'codicon-symbol-interface',
            'json': 'codicon-json',
            'md': 'codicon-markdown',
            'html': 'codicon-code',
            'css': 'codicon-symbol-color',
            'py': 'codicon-snake',
            'java': 'codicon-symbol-class',
            'xml': 'codicon-code',
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
     * 格式化时间
     * @param {Date|string} time
     * @returns {string}
     */
    function formatTime(time) {
        const date = typeof time === 'string' ? new Date(time) : time;
        const now = new Date();
        const diff = now.getTime() - date.getTime();

        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;

        if (diff < minute) {
            return '刚刚';
        } else if (diff < hour) {
            return Math.floor(diff / minute) + '分钟前';
        } else if (diff < day) {
            return Math.floor(diff / hour) + '小时前';
        } else if (diff < 7 * day) {
            return Math.floor(diff / day) + '天前';
        } else {
            const month = date.getMonth() + 1;
            const dayOfMonth = date.getDate();
            return `${month}月${dayOfMonth}日`;
        }
    }

    // ===== 拖拽处理 =====
    function handleDragStart(e) {
        const target = /** @type {HTMLElement} */ (e.target)?.closest('.tree-item');
        if (!target || target.classList.contains('back-item')) return;

        draggedItem = target;
        target.classList.add('dragging');

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', target.dataset.path || '');
            e.dataTransfer.setData('source-panel', target.dataset.panel || '');
        }
    }

    function handleDragOver(e) {
        e.preventDefault();
        const target = /** @type {HTMLElement} */ (e.target)?.closest('.tree-item');
        if (!target || target.classList.contains('back-item')) return;

        // 只允许拖拽到对面的面板
        const dragPanel = draggedItem?.dataset.panel;
        const targetPanel = target.dataset.panel;

        if (dragPanel !== targetPanel) {
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
            }
            target.classList.add('drop-target');
        }
    }

    function handleDrop(e) {
        e.preventDefault();
        const target = /** @type {HTMLElement} */ (e.target)?.closest('.tree-item');
        if (!target || target.classList.contains('back-item')) return;

        target.classList.remove('drop-target');

        const sourcePath = e.dataTransfer?.getData('text/plain');
        const sourcePanel = e.dataTransfer?.getData('source-panel');
        const targetPanel = target.dataset.panel;

        if (!sourcePath || sourcePanel === targetPanel) return;

        // 获取目标路径
        const targetPath = target.dataset.isDir === 'true'
            ? target.dataset.path
            : (targetPanel === 'local' ? currentLocalPath : currentRemotePath);

        // 执行传输
        if (sourcePanel === 'local' && targetPanel === 'remote') {
            vscode.postMessage({
                command: 'upload',
                data: { localPath: sourcePath, remotePath: targetPath }
            });
        } else if (sourcePanel === 'remote' && targetPanel === 'local') {
            vscode.postMessage({
                command: 'download',
                data: { remotePath: sourcePath, localPath: targetPath }
            });
        }
    }

    function handleDragEnd(e) {
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
            draggedItem = null;
        }

        document.querySelectorAll('.drop-target').forEach(el => {
            el.classList.remove('drop-target');
        });
    }

    // ===== 其他交互 =====
    function selectItem(item) {
        if (selectedItem) {
            selectedItem.classList.remove('selected');
        }
        selectedItem = item;
        item.classList.add('selected');
    }

    // ===== Commands =====
    function refreshPanel(panel) {
        vscode.postMessage({
            command: panel === 'local' ? 'refreshLocal' : 'refreshRemote'
        });
    }

    function createFolder(panel) {
        const name = prompt('Enter folder name:');
        if (!name) return;

        const parentPath = panel === 'local' ? currentLocalPath : currentRemotePath;
        vscode.postMessage({
            command: 'createFolder',
            data: { parentPath, name, panel }
        });
    }

    function uploadSelected() {
        if (!selectedItem || selectedItem.dataset.panel !== 'local') return;
        vscode.postMessage({
            command: 'upload',
            data: { localPath: selectedItem.dataset.path, remotePath: currentRemotePath }
        });
    }

    function downloadSelected() {
        if (!selectedItem || selectedItem.dataset.panel !== 'remote') return;
        vscode.postMessage({
            command: 'download',
            data: { remotePath: selectedItem.dataset.path, localPath: currentLocalPath }
        });
    }

    function handleKeyboardShortcuts(e) {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 'r':
                    e.preventDefault();
                    const panel = selectedItem?.dataset.panel;
                    if (panel) refreshPanel(panel);
                    break;
                case 'u':
                    e.preventDefault();
                    uploadSelected();
                    break;
                case 'd':
                    e.preventDefault();
                    downloadSelected();
                    break;
            }
        } else if (e.key === 'Delete') {
            if (selectedItem) {
                const confirmed = confirm(`Delete "${selectedItem.dataset.path}"?`);
                if (confirmed) {
                    vscode.postMessage({
                        command: 'delete',
                        data: {
                            path: selectedItem.dataset.path,
                            panel: selectedItem.dataset.panel,
                            isDir: selectedItem.dataset.isDir === 'true'
                        }
                    });
                }
            }
        } else if (e.key === 'F5') {
            e.preventDefault();
            refreshPanel('local');
            refreshPanel('remote');
        } else if (e.key === 'Backspace') {
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

    // ===== 接收扩展消息 =====
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.command) {
            case 'updateLocalTree':
                currentLocalPath = message.data.path;
                document.getElementById('local-path').textContent = message.data.path;
                renderFileTree('local', message.data.nodes);
                break;

            case 'updateRemoteTree':
                currentRemotePath = message.data.path;
                document.getElementById('remote-path').textContent = message.data.path;
                renderFileTree('remote', message.data.nodes);
                break;

            case 'updateStatus':
                document.getElementById('status-text').textContent = message.text;
                break;

            case 'updateQueue':
                document.getElementById('queue-text').textContent = `${message.count} active tasks`;
                break;
        }
    });
})();
