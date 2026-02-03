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
                    <td colspan="5">No connections in pool</td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = data.connections.map(conn => {
            const statusIcon = conn.status === 'active' ? 'pulse' : 'circle-large-outline';
            const statusClass = conn.status;
            const createdTime = formatTime(conn.createdAt);
            const lastUsedTime = formatTime(conn.lastUsed);
            const idleTimeFormatted = formatIdleTime(conn.idleTime);

            return `
                <tr>
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
                </tr>
            `;
        }).join('');
    }

    /**
     * Format ISO timestamp to readable time
     */
    function formatTime(isoString) {
        const date = new Date(isoString);
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
