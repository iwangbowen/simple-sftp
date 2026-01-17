// Dual Panel File Browser - Frontend Logic (Native Context Menu Version)
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
     * @param {HTMLElement?} parentElement - 父元素
     * @param {number} level - 缩进层级
     */
    function renderFileTree(panel, nodes, parentElement = null, level = 0) {
        const treeContainer = parentElement || document.getElementById(`${panel}-tree`);
        if (!treeContainer) return;

        // 清空加载提示
        if (!parentElement) {
            treeContainer.innerHTML = '';
        }

        nodes.forEach(node => {
            const item = createTreeItem(node, panel, level);
            treeContainer.appendChild(item);

            // 如果已展开且有子节点
            if (node.expanded && node.children && node.children.length > 0) {
                renderFileTree(panel, node.children, treeContainer, level + 1);
            }
        });
    }

    /**
     * @param {Object} node - 文件节点
     * @param {string} panel - 'local' | 'remote'
     * @param {number} level - 缩进层级
     * @returns {HTMLElement}
     */
    function createTreeItem(node, panel, level) {
        const item = document.createElement('div');
        item.className = 'tree-item';
        item.dataset.path = node.path;
        item.dataset.isDir = node.isDirectory.toString();
        item.dataset.panel = panel;
        item.draggable = true;

        // VS Code Native Context Menu - 关键配置
        const contextData = {
            webviewSection: panel === 'local' ? 'localFile' : 'remoteFile',
            filePath: node.path,
            isDirectory: node.isDirectory,
            panel: panel,
            preventDefaultContextMenuItems: true
        };
        item.dataset.vscodeContext = JSON.stringify(contextData);

        // Indent
        for (let i = 0; i < level; i++) {
            const indent = document.createElement('span');
            indent.className = 'tree-item-indent';
            item.appendChild(indent);
        }

        // Arrow (for directories)
        if (node.isDirectory) {
            const arrow = document.createElement('span');
            arrow.className = `codicon codicon-chevron-right tree-item-arrow ${node.expanded ? 'expanded' : ''}`;
            arrow.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDirectory(item, panel);
            });
            item.appendChild(arrow);
        } else {
            const spacer = document.createElement('span');
            spacer.className = 'tree-item-indent';
            item.appendChild(spacer);
        }

        // Icon
        const icon = document.createElement('span');
        icon.className = `codicon tree-item-icon ${getFileIcon(node)}`;
        item.appendChild(icon);

        // Label
        const label = document.createElement('span');
        label.className = 'tree-item-label';
        label.textContent = node.name;
        item.appendChild(label);

        // Size (for files)
        if (!node.isDirectory && node.size !== undefined) {
            const size = document.createElement('span');
            size.className = 'tree-item-size';
            size.textContent = formatFileSize(node.size);
            item.appendChild(size);
        }

        // Event listeners
        item.addEventListener('click', () => selectItem(item));
        item.addEventListener('dblclick', () => handleDoubleClick(item, panel));

        return item;
    }

    // ===== 文件图标 =====
    /**
     * @param {Object} node
     * @returns {string}
     */
    function getFileIcon(node) {
        if (node.isDirectory) {
            return node.expanded ? 'codicon-folder-opened' : 'codicon-folder';
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

    // ===== 文件大小格式化 =====
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

    // ===== 目录切换 =====
    /**
     * @param {HTMLElement} item
     * @param {string} panel
     */
    function toggleDirectory(item, panel) {
        const path = item.dataset.path;
        if (!path) return;

        const arrow = item.querySelector('.tree-item-arrow');
        const isExpanded = arrow?.classList.contains('expanded');

        if (isExpanded) {
            // 折叠:移除子节点
            arrow?.classList.remove('expanded');
            let nextSibling = item.nextElementSibling;
            while (nextSibling && nextSibling.dataset.path?.startsWith(path + '/')) {
                const toRemove = nextSibling;
                nextSibling = nextSibling.nextElementSibling;
                toRemove.remove();
            }
        } else {
            // 展开:加载子节点
            arrow?.classList.add('expanded');
            vscode.postMessage({
                command: panel === 'local' ? 'loadLocalDir' : 'loadRemoteDir',
                path: path
            });
        }
    }

    // ===== 拖拽处理 =====
    /**
     * @param {DragEvent} e
     */
    function handleDragStart(e) {
        const target = /** @type {HTMLElement} */ (e.target)?.closest('.tree-item');
        if (!target) return;

        draggedItem = target;
        target.classList.add('dragging');

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', target.dataset.path || '');
            e.dataTransfer.setData('source-panel', target.dataset.panel || '');
        }
    }

    /**
     * @param {DragEvent} e
     */
    function handleDragOver(e) {
        e.preventDefault();
        const target = /** @type {HTMLElement} */ (e.target)?.closest('.tree-item');
        if (!target || target.dataset.isDir !== 'true') return;

        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }

        target.classList.add('drop-target');
    }

    /**
     * @param {DragEvent} e
     */
    function handleDrop(e) {
        e.preventDefault();
        const target = /** @type {HTMLElement} */ (e.target)?.closest('.tree-item');
        if (!target) return;

        target.classList.remove('drop-target');

        const sourcePath = e.dataTransfer?.getData('text/plain');
        const sourcePanel = e.dataTransfer?.getData('source-panel');
        const targetPath = target.dataset.path;
        const targetPanel = target.dataset.panel;

        if (!sourcePath || !targetPath || sourcePanel === targetPanel) return;

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

    /**
     * @param {DragEvent} e
     */
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
    /**
     * @param {HTMLElement} item
     */
    function selectItem(item) {
        if (selectedItem) {
            selectedItem.classList.remove('selected');
        }
        selectedItem = item;
        item.classList.add('selected');
    }

    /**
     * @param {HTMLElement} item
     * @param {string} panel
     */
    function handleDoubleClick(item, panel) {
        const isDir = item.dataset.isDir === 'true';
        const path = item.dataset.path;

        if (isDir) {
            toggleDirectory(item, panel);
        } else {
            // 打开文件:本地直接打开,远程先下载
            vscode.postMessage({
                command: 'openFile',
                data: { path, panel }
            });
        }
    }

    // ===== Commands =====
    /**
     * @param {string} panel
     */
    function refreshPanel(panel) {
        vscode.postMessage({
            command: panel === 'local' ? 'refreshLocal' : 'refreshRemote'
        });
    }

    /**
     * @param {string} panel
     */
    function createFolder(panel) {
        const name = prompt('Enter folder name:');
        if (!name) return;

        const parentPath = selectedItem?.dataset.path || (panel === 'local' ? currentLocalPath : currentRemotePath);
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

    /**
     * @param {KeyboardEvent} e
     */
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
