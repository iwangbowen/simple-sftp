// @ts-check
(function() {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const refreshBtn = document.getElementById('refreshBtn');
    const refreshIntervalSelect = document.getElementById('refreshIntervalSelect');
    const totalConnectionsEl = document.getElementById('totalConnections');
    const activeConnectionsEl = document.getElementById('activeConnections');
    const idleConnectionsEl = document.getElementById('idleConnections');
    const tableBody = document.getElementById('connectionsTableBody');

    // Handle refresh button click
    refreshBtn?.addEventListener('click', () => {
        vscode.postMessage({ command: 'refresh' });
    });

    // Handle refresh interval change
    refreshIntervalSelect?.addEventListener('change', (e) => {
        const intervalMs = parseInt(e.target.value, 10);
        vscode.postMessage({
            command: 'changeRefreshInterval',
            intervalMs: intervalMs
        });
    });

    // Listen for messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'updateData':
                updateConnectionPoolData(message.data);
                break;
            case 'updateRefreshInterval':
                updateRefreshIntervalSelector(message.intervalMs);
                break;
        }
    });

    /**
     * Update refresh interval selector
     */
    function updateRefreshIntervalSelector(intervalMs) {
        if (refreshIntervalSelect) {
            refreshIntervalSelect.value = intervalMs.toString();
        }
    }

    /**
     * Update connection pool data display
     */
    function updateConnectionPoolData(data) {
        // Update summary
        if (totalConnectionsEl) {
            totalConnectionsEl.textContent = data.totalConnections.toString();
        }
        if (activeConnectionsEl) {
            activeConnectionsEl.textContent = data.activeConnections.toString();
        }
        if (idleConnectionsEl) {
            idleConnectionsEl.textContent = data.idleConnections.toString();
        }

        // Update table
        if (!tableBody) return;

        if (data.connections.length === 0) {
            tableBody.innerHTML = `
                <tr class="empty-state">
                    <td colspan="7">No connections in pool</td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = data.connections.map((conn, index) => {
            const statusIcon = conn.status === 'active' ? 'pulse' : 'circle-large-outline';
            const statusClass = conn.status;
            const createdTime = formatTime(conn.createdAt);
            const lastUsedTime = formatTime(conn.lastUsed);
            const idleTimeFormatted = formatIdleTime(conn.idleTime);
            const hasHistory = conn.operationHistory && conn.operationHistory.length > 0;
            const expandIcon = hasHistory ? 'chevron-right' : '';

            return `
                <tr class="connection-row" data-index="${index}">
                    <td>
                        ${hasHistory ? `<i class="codicon codicon-${expandIcon} expand-icon" data-index="${index}"></i>` : ''}
                    </td>
                    <td>${escapeHtml(conn.hostName)}</td>
                    <td>
                        <span class="status-badge ${statusClass}">
                            <i class="codicon codicon-${statusIcon}"></i>
                            ${conn.status}
                        </span>
                    </td>
                    <td><span class="time">${createdTime}</span></td>
                    <td><span class="time">${lastUsedTime}</span></td>
                    <td><span class="time">${idleTimeFormatted}</span></td>
                    <td>${conn.usageCount || 0}</td>
                </tr>
                ${hasHistory ? `
                <tr class="history-row" data-index="${index}">
                    <td colspan="7">
                        <div class="history-content">
                            <div class="history-title">
                                <i class="codicon codicon-history"></i> Operation History (Last ${conn.operationHistory.length})
                            </div>
                            <div class="history-items">
                                ${conn.operationHistory.map(op => {
                                    const icon = getOperationIcon(op.operation);
                                    return `
                                        <div class="history-item">
                                            <span class="history-operation ${op.operation}">
                                                <i class="codicon codicon-${icon}"></i>
                                                ${op.operation}
                                            </span>
                                            <span class="history-timestamp">${formatTime(op.timestamp)}</span>
                                            <span class="history-description">${escapeHtml(op.description || '')}</span>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    </td>
                </tr>
                ` : ''}
            `;
        }).join('');

        // Add click event listeners to expand icons
        document.querySelectorAll('.expand-icon').forEach(icon => {
            icon.addEventListener('click', (e) => {
                const index = e.target.getAttribute('data-index');
                toggleHistoryRow(index);
            });
        });

        // Restore expanded state
        const state = vscode.getState();
        if (state && state.expandedRows) {
            state.expandedRows.forEach(index => {
                const expandIcon = document.querySelector(`.expand-icon[data-index="${index}"]`);
                const historyRow = document.querySelector(`.history-row[data-index="${index}"]`);
                if (expandIcon && historyRow) {
                    expandIcon.classList.add('expanded');
                    historyRow.classList.add('expanded');
                }
            });
        }
    }

    /**
     * Toggle history row visibility
     */
    function toggleHistoryRow(index) {
        const expandIcon = document.querySelector(`.expand-icon[data-index="${index}"]`);
        const historyRow = document.querySelector(`.history-row[data-index="${index}"]`);

        if (expandIcon && historyRow) {
            const isExpanded = expandIcon.classList.toggle('expanded');
            historyRow.classList.toggle('expanded');

            // Save state
            const state = vscode.getState() || { expandedRows: [] };
            if (isExpanded) {
                if (!state.expandedRows.includes(index)) {
                    state.expandedRows.push(index);
                }
            } else {
                state.expandedRows = state.expandedRows.filter(i => i !== index);
            }
            vscode.setState(state);
        }
    }

    /**
     * Get icon for operation type
     */
    function getOperationIcon(operation) {
        const icons = {
            'create': 'add',
            'acquire': 'debug-start',
            'reuse': 'refresh',
            'release': 'debug-stop'
        };
        return icons[operation] || 'circle-filled';
    }

    /**
     * Format ISO timestamp to readable time
     */
    function formatTime(isoString) {
        if (!isoString) {
            return 'N/A';
        }

        const date = new Date(isoString);
        if (isNaN(date.getTime())) {
            return 'Invalid date';
        }

        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) {
            return 'Just now';
        } else if (diffMins < 60) {
            return `${diffMins}m ago`;
        } else if (diffMins < 1440) {
            const hours = Math.floor(diffMins / 60);
            return `${hours}h ago`;
        } else {
            return date.toLocaleString();
        }
    }

    /**
     * Format idle time duration
     */
    function formatIdleTime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}d ${hours % 24}h`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
})();
