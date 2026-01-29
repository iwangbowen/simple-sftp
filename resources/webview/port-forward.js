/**
 * Port Forwarding Module
 *
 * This module provides port forwarding functionality that can be used in:
 * 1. Standalone port forwarding webview (port-forward.html)
 * 2. Embedded in the dual-panel-browser (dual-panel-browser.html)
 *
 * It communicates with the extension backend via VS Code postMessage API.
 */

/* eslint-disable no-undef */

(function(globalThis) {
    'use strict';

    // ===== State Variables =====
    let isPortForwardViewVisible = false;
    let currentForwardings = [];
    let currentLocalPorts = [];  // Store scanned local ports for remote forwarding
    let currentRemotePorts = []; // Store scanned remote ports for local forwarding
    let currentForwardTab = 'local';
    let isInitialLoading = true; // Track if we're still in initial loading state
    let skipNextRender = false; // Flag to skip next render (prevent flicker during state updates)

    // Reference to vscode API - should be injected or available globally
    let vscode = null;

    // ===== Configuration =====
    const config = {
        isStandalone: false, // Set to true for standalone webview
        autoScanOnOpen: true, // Auto-scan ports when view opens
        showCloseButton: true, // Show close button in header (false for standalone)
    };

    // ===== HTML Templates =====

    /**
     * Get the HTML template for all port forwarding panels
     * This allows code reuse between standalone and embedded views
     * @returns {string} HTML content for port forwarding panels
     */
    function getPortForwardPanelsTemplate() {
        return `
            <!-- Local Forwarding Panel -->
            <div class="port-forward-panel active" id="local-forward-panel">
                <div class="port-forward-panel-desc">
                    <span class="codicon codicon-info"></span>
                    Map remote port to local, access remote services locally (ssh -L)
                </div>
                <div class="port-forward-table-container">
                    <table class="port-forward-table">
                        <thead>
                            <tr>
                                <th class="status-column"></th>
                                <th>Remote Port</th>
                                <th>Process</th>
                                <th>Listen Address</th>
                                <th>Forward To</th>
                            </tr>
                        </thead>
                        <tbody id="unified-ports-table-body">
                            <tr class="port-forward-empty">
                                <td colspan="5">No ports detected</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Remote Forwarding Panel -->
            <div class="port-forward-panel" id="remote-forward-panel">
                <div class="port-forward-panel-desc">
                    <span class="codicon codicon-info"></span>
                    Forward local ports to remote server (ssh -R)
                </div>
                <div class="port-forward-table-container">
                    <table class="port-forward-table">
                        <thead>
                            <tr>
                                <th class="status-column"></th>
                                <th>Local Port</th>
                                <th>Process</th>
                                <th>Listen Address</th>
                                <th>Forward To</th>
                            </tr>
                        </thead>
                        <tbody id="remote-forward-table-body">
                            <tr class="port-forward-empty">
                                <td colspan="5">No local ports detected</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Dynamic Forwarding Panel (SOCKS5) -->
            <div class="port-forward-panel" id="dynamic-forward-panel">
                <div class="port-forward-panel-desc">
                    <span class="codicon codicon-info"></span>
                    Create SOCKS5 proxy, tunnel all traffic through remote server (ssh -D)
                </div>
                <div class="port-forward-table-container">
                    <table class="port-forward-table">
                        <thead>
                            <tr>
                                <th class="status-column"></th>
                                <th>Proxy Port</th>
                                <th>Listen Address</th>
                                <th>Label</th>
                            </tr>
                        </thead>
                        <tbody id="dynamic-forward-table-body">
                            <tr class="port-forward-empty">
                                <td colspan="4">No dynamic forwarding configured</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // ===== Initialization =====

    /**
     * Initialize the port forwarding module
     * @param {object} options Configuration options
     * @param {object} options.vscode VS Code API instance
     * @param {boolean} [options.isStandalone=false] Whether this is standalone mode
     * @param {boolean} [options.showCloseButton=true] Whether to show close button
     */
    function initPortForwardModule(options = {}) {
        vscode = options.vscode || (typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null);

        if (!vscode) {
            console.error('[Port Forward] VS Code API not available');
            return;
        }

        config.isStandalone = options.isStandalone || false;
        config.showCloseButton = options.showCloseButton !== false;

        // Initialize view
        initPortForwardView();

        // Setup message listener
        setupMessageListener();

        // For standalone, auto-open the view and load data
        if (config.isStandalone) {
            isPortForwardViewVisible = true;

            // Show initial loading state in tables
            const unifiedTbody = document.getElementById('unified-ports-table-body');
            const remoteTbody = document.getElementById('remote-forward-table-body');
            const dynamicTbody = document.getElementById('dynamic-forward-table-body');
            const loadingHtml = '<tr class="port-forward-loading"><td colspan="5" style="text-align: center; padding: 20px;"><span class="codicon codicon-loading codicon-modifier-spin"></span> Loading...</td></tr>';

            if (unifiedTbody) unifiedTbody.innerHTML = loadingHtml;
            if (remoteTbody) remoteTbody.innerHTML = loadingHtml;
            if (dynamicTbody) dynamicTbody.innerHTML = loadingHtml;

            vscode.postMessage({ command: 'getPortForwardings' });
            if (config.autoScanOnOpen) {
                handleScanRemotePorts();
            }
        }

        console.log('[Port Forward] Module initialized', { isStandalone: config.isStandalone });
    }

    /**
     * Initialize port forward view event listeners
     */
    function initPortForwardView() {
        // Inject panel templates if not already present
        const panelContent = document.querySelector('.port-forward-view-content');
        if (panelContent && !panelContent.querySelector('#local-forward-panel')) {
            console.log('[Port Forward] Injecting panel templates');
            panelContent.innerHTML = getPortForwardPanelsTemplate();
        }

        // Toggle port forwarding view button (for embedded mode)
        const toggleButton = document.getElementById('toggle-port-forward-view');
        if (toggleButton && !config.isStandalone) {
            toggleButton.addEventListener('click', () => {
                if (isPortForwardViewVisible) {
                    closePortForwardView();
                } else {
                    openPortForwardView();
                }
            });
        }

        // Close button in header
        const closeButton = document.getElementById('close-port-forward-view');
        if (closeButton) {
            closeButton.addEventListener('click', closePortForwardView);
            if (!config.showCloseButton || config.isStandalone) {
                closeButton.style.display = 'none';
            }
        }

        // Add port button
        const addPortButton = document.getElementById('add-port-forward');
        if (addPortButton) {
            addPortButton.addEventListener('click', showAddPortModal);
        }

        // Add port modal close buttons
        const addPortClose = document.getElementById('add-port-close');
        const cancelAddPort = document.getElementById('cancel-add-port');
        const confirmAddPort = document.getElementById('confirm-add-port');

        if (addPortClose) addPortClose.addEventListener('click', hideAddPortModal);
        if (cancelAddPort) cancelAddPort.addEventListener('click', hideAddPortModal);
        if (confirmAddPort) confirmAddPort.addEventListener('click', handleAddPort);

        // Scan remote ports button
        const scanPortsButton = document.getElementById('scan-remote-ports');
        if (scanPortsButton) {
            scanPortsButton.addEventListener('click', handleScanRemotePorts);
        }

        // Initialize tab switching
        initPortForwardTabs();

        // Initialize dynamic forwarding handlers
        initDynamicForwardHandlers();
    }

    /**
     * Setup message listener for backend communication
     */
    function setupMessageListener() {
        window.addEventListener('message', event => {
            const message = event.data;
            handleMessage(message);
        });
    }

    /**
     * Handle messages from the extension backend
     * @param {object} message The message from backend
     */
    function handleMessage(message) {
        switch (message.command || message.type) {
            case 'portForwardings':
                // Update port forwarding list (handle both data and forwardings properties)
                currentForwardings = message.data || message.forwardings || [];
                console.log('[Port Forward] Received portForwardings, calling render for tab:', currentForwardTab, currentForwardings.length);

                // Skip render if we just did a local update
                if (skipNextRender) {
                    skipNextRender = false;
                    console.log('[Port Forward] Skipping render to prevent flicker');
                    break;
                }

                // Render based on current active tab
                renderCurrentTab();
                break;

            case 'portForwardingStarted': {
                // Immediately update the indicator to show forwarded state (no flicker)
                const startedForwarding = message.forwarding;
                if (startedForwarding?.id) {
                    // Try to update indicator by ID first
                    const updated = updateIndicatorById(startedForwarding.id, 'forwarded');
                    if (!updated && startedForwarding.remotePort) {
                        // For local forwards, also try by remote port
                        updateIndicatorById(String(startedForwarding.remotePort), 'forwarded');
                    }
                }
                // Update local state
                if (startedForwarding) {
                    // Check if this forwarding already exists
                    const existingIndex = currentForwardings.findIndex(f => f.id === startedForwarding.id);
                    if (existingIndex >= 0) {
                        currentForwardings[existingIndex] = { ...currentForwardings[existingIndex], ...startedForwarding, status: 'active' };
                    } else {
                        currentForwardings.push({ ...startedForwarding, status: 'active' });
                    }
                }
                // Set flag to skip next render (prevent flicker)
                skipNextRender = true;
                // Fetch latest data from backend (will silently update state without flicker)
                setTimeout(() => {
                    vscode.postMessage({ command: 'getPortForwardings' });
                    if (currentForwardTab === 'local') {
                        handleScanRemotePorts();
                    }
                }, 300);
                break;
            }

            case 'portForwardingStopped': {
                // Immediately update the indicator to show available/inactive state (no flicker)
                const stoppedId = message.forwarding?.id || message.id;
                if (stoppedId) {
                    console.log('[Port Forward] Stopping forwarding', stoppedId);
                    // Update indicator immediately
                    updateIndicatorById(stoppedId, 'available');
                    // Update local state
                    currentForwardings = currentForwardings.map(f =>
                        f.id === stoppedId ? { ...f, status: 'inactive' } : f
                    );
                    console.log('[Port Forward] After updating, currentForwardings count:', currentForwardings.length);
                }
                // Set flag to skip next render (prevent flicker)
                skipNextRender = true;
                // Fetch latest data from backend after a small delay (will silently update state)
                setTimeout(() => {
                    vscode.postMessage({ command: 'getPortForwardings' });
                    if (currentForwardTab === 'local') {
                        handleScanRemotePorts();
                    }
                }, 300);
                break;
            }

            case 'portForwardingError': {
                // Remove loading state from the relevant indicator
                const errorId = message.forwarding?.id || message.id;
                if (errorId) {
                    // Just remove loading class, restore previous state
                    const indicator = document.querySelector(`.port-status-indicator[data-id="${errorId}"]`);
                    if (indicator) {
                        indicator.classList.remove('loading');
                    }
                }
                // Refresh port forwarding list to reflect any changes
                vscode.postMessage({ command: 'getPortForwardings' });
                break;
            }

            case 'portForwardingDeleted':
                // Remove from local state and re-render
                const deletedId = message.forwarding?.id || message.id;
                if (deletedId) {
                    currentForwardings = currentForwardings.filter(f => f.id !== deletedId);
                    renderCurrentTab();
                }
                break;

            case 'remotePorts':
                // Update remote ports list - initial loading is complete
                isInitialLoading = false;
                console.log('[Port Forward] Received remotePorts, calling renderRemotePorts', message.data?.length);
                renderRemotePorts(message.data);
                break;

            case 'localPorts':
                // Update local ports list (for remote forwarding tab)
                console.log('[Port Forward] Received localPorts', message.data?.length);
                currentLocalPorts = message.data || [];
                if (currentForwardTab === 'remote') {
                    renderRemoteForwards();
                }
                break;
        }
    }

    /**
     * Render based on current active tab
     */
    function renderCurrentTab() {
        if (currentForwardTab === 'local') {
            renderUnifiedPorts();
        } else if (currentForwardTab === 'remote') {
            renderRemoteForwards();
        } else if (currentForwardTab === 'dynamic') {
            renderDynamicForwards();
        }
    }

    // ===== Tab Management =====

    function initPortForwardTabs() {
        const tabs = document.querySelectorAll('.port-forward-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabType = tab.dataset.tab;
                if (tabType === currentForwardTab) return;

                // Update active tab
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Update active panel
                const panels = document.querySelectorAll('.port-forward-panel');
                panels.forEach(panel => panel.classList.remove('active'));

                const targetPanel = document.getElementById(`${tabType}-forward-panel`);
                if (targetPanel) {
                    targetPanel.classList.add('active');
                }

                currentForwardTab = tabType;

                // Render appropriate content
                if (tabType === 'local') {
                    renderUnifiedPorts();
                } else if (tabType === 'remote') {
                    renderRemoteForwards();
                    // Scan local ports for remote forwarding
                    handleScanLocalPorts();
                } else if (tabType === 'dynamic') {
                    renderDynamicForwards();
                }
            });
        });
    }

    // ===== View Open/Close =====

    function openPortForwardView() {
        const portForwardView = document.getElementById('panel-port-forward-view');

        if (portForwardView) {
            portForwardView.style.display = 'flex';
            isPortForwardViewVisible = true;

            // Show initial loading state in table
            const tbody = document.getElementById('unified-ports-table-body');
            if (tbody && currentForwardings.length === 0 && currentRemotePorts.length === 0) {
                tbody.innerHTML = '<tr class="port-forward-loading"><td colspan="5" style="text-align: center; padding: 20px;"><span class="codicon codicon-loading codicon-modifier-spin"></span> Loading port forwardings...</td></tr>';
            }

            // Request port forwarding list from backend
            vscode.postMessage({ command: 'getPortForwardings' });

            // Auto-scan remote ports on view open
            if (config.autoScanOnOpen) {
                handleScanRemotePorts();
            }

            // Emit event for external handlers (e.g., to hide file tree)
            window.dispatchEvent(new CustomEvent('portForwardViewOpened'));
        }
    }

    function closePortForwardView() {
        const portForwardView = document.getElementById('panel-port-forward-view');

        if (portForwardView) {
            portForwardView.style.display = 'none';
            isPortForwardViewVisible = false;

            // Emit event for external handlers (e.g., to show file tree)
            window.dispatchEvent(new CustomEvent('portForwardViewClosed'));
        }
    }

    // ===== Add Port Modal =====

    function showAddPortModal() {
        const modal = document.getElementById('add-port-modal');
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('active');
            // Focus on remote port input
            const remotePortInput = document.getElementById('port-remote-port');
            setTimeout(() => remotePortInput?.focus(), 100);
        }
    }

    function hideAddPortModal() {
        const modal = document.getElementById('add-port-modal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
            // Clear inputs
            const remotePort = document.getElementById('port-remote-port');
            const localPort = document.getElementById('port-local-port');
            const label = document.getElementById('port-label');
            const remoteHost = document.getElementById('port-remote-host');

            if (remotePort) remotePort.value = '';
            if (localPort) localPort.value = '';
            if (label) label.value = '';
            if (remoteHost) remoteHost.value = 'localhost';
        }
    }

    function handleAddPort() {
        const remotePortInput = document.getElementById('port-remote-port');
        const localPortInput = document.getElementById('port-local-port');
        const labelInput = document.getElementById('port-label');
        const remoteHostInput = document.getElementById('port-remote-host');

        const remotePort = Number.parseInt(remotePortInput?.value, 10);
        const localPort = localPortInput?.value;
        const label = labelInput?.value || '';
        const remoteHost = remoteHostInput?.value || 'localhost';

        if (!remotePort || remotePort < 1 || remotePort > 65535) {
            vscode.postMessage({
                command: 'showError',
                message: 'Please enter a valid remote port (1-65535)'
            });
            return;
        }

        const config = {
            remotePort,
            localPort: localPort ? Number.parseInt(localPort, 10) : undefined,
            label,
            remoteHost
        };

        console.log('[Port Forward] Sending startPortForward command:', config);

        vscode.postMessage({
            command: 'startPortForward',
            config
        });

        hideAddPortModal();
    }

    // ===== Port Scanning =====

    function handleScanRemotePorts() {
        const button = document.getElementById('scan-remote-ports');
        if (!button) return;

        // Disable button and add spin animation
        button.disabled = true;
        const icon = button.querySelector('.codicon-refresh');
        if (icon) {
            icon.classList.add('codicon-loading', 'codicon-modifier-spin');
            icon.classList.remove('codicon-refresh');
        }

        // Show loading state in table
        const tbody = document.getElementById('unified-ports-table-body');
        if (tbody) {
            tbody.innerHTML = '<tr class="port-forward-loading"><td colspan="5" style="text-align: center; padding: 20px;"><span class="codicon codicon-loading codicon-modifier-spin"></span> Refreshing remote ports...</td></tr>';
        }

        vscode.postMessage({ command: 'scanRemotePorts' });
    }

    function handleScanLocalPorts() {
        vscode.postMessage({ command: 'scanLocalPorts' });
    }

    // ===== Render Functions =====

    function renderRemotePorts(remotePorts) {
        currentRemotePorts = remotePorts || [];
        renderUnifiedPorts();

        // Re-enable scan button and restore icon
        const button = document.getElementById('scan-remote-ports');
        if (button) {
            button.disabled = false;
            const icon = button.querySelector('.codicon');
            if (icon) {
                icon.classList.remove('codicon-loading', 'codicon-modifier-spin');
                icon.classList.add('codicon-refresh');

                // Show brief success feedback
                const originalTitle = button.title;
                button.title = 'Refreshed ✓';
                setTimeout(() => {
                    button.title = originalTitle;
                }, 2000);
            }
        }
    }

    function renderUnifiedPorts() {
        const tbody = document.getElementById('unified-ports-table-body');
        if (!tbody) {
            console.warn('[Port Forward] unified-ports-table-body element not found');
            return;
        }

        // Filter out inactive forwardings - only show active ones
        const activeForwardings = currentForwardings.filter(f => f.status === 'active');

        console.log('[Port Forward] renderUnifiedPorts called', {
            totalForwardings: currentForwardings.length,
            activeForwardings: activeForwardings.length,
            remotePortsCount: currentRemotePorts.length
        });

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
        activeForwardings.forEach(f => {
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
            // If still in initial loading, show loading state
            if (isInitialLoading) {
                tbody.innerHTML = '<tr class="port-forward-loading"><td colspan="5" style="text-align: center; padding: 20px;"><span class="codicon codicon-loading codicon-modifier-spin"></span> Loading...</td></tr>';
            } else {
                tbody.innerHTML = '<tr class="port-forward-empty"><td colspan="5">No ports detected</td></tr>';
            }
            return;
        }

        tbody.innerHTML = sortedPorts.map(portInfo => {
            const { port, process, pid, command, listenAddress, status, forwarding } = portInfo;

            // Process info with tooltip
            const processInfo = command
                ? `<span title="${escapeHtml(command)}">${process || 'Unknown'}${pid ? ` (${pid})` : ''}</span>`
                : (process
                    ? `${process}${pid ? ` (${pid})` : ''}`
                    : '-');

            // Status indicator (clickable circle)
            let statusIndicator = '';
            let statusClass = '';
            let statusTitle = '';
            if (status === 'forwarded') {
                statusClass = 'forwarded';
                statusTitle = 'Click to stop forwarding';
                statusIndicator = `<div class="port-status-indicator ${statusClass}" data-action="stop" data-id="${forwarding.id}" title="${statusTitle}"></div>`;
            } else {
                statusClass = 'available';
                statusTitle = 'Click to forward port';
                statusIndicator = `<div class="port-status-indicator ${statusClass}" data-action="forward" data-port="${port}" title="${statusTitle}"></div>`;
            }

            // Forwarded address or local port input
            let forwardedToContent = '';
            if (status === 'forwarded' && forwarding) {
                const forwardedAddress = `${forwarding.localHost}:${forwarding.localPort}`;
                forwardedToContent = `<span class="port-clickable" data-action="openBrowser" data-address="${forwardedAddress}" title="Click to open in browser">${forwardedAddress}</span>`;
            } else {
                // Show local port input for available ports
                forwardedToContent = `<input type="number"
                                             class="local-port-input"
                                             id="local-port-${port}"
                                             value="${port}"
                                             min="1"
                                             max="65535"
                                             placeholder="${port}"
                                             title="Local port to forward to" />`;
            }

            // Render port number - clickable if forwarded
            const portDisplay = status === 'forwarded' && forwarding
                ? `<span class="port-clickable" data-action="openBrowser" data-port="${port}" data-forwarding="${forwarding.id}" title="Click to open in browser">${port}</span>`
                : `${port}`;

            return `
                <tr data-port="${port}" class="port-row-${status}">
                    <td class="status-cell">${statusIndicator}</td>
                    <td><strong>${portDisplay}</strong></td>
                    <td>${processInfo}</td>
                    <td>${listenAddress || '-'}</td>
                    <td>${forwardedToContent}</td>
                </tr>
            `;
        }).join('');

        // Setup event listeners
        setupUnifiedPortsTableListeners(tbody);
    }

    function setupUnifiedPortsTableListeners(tbody) {
        // Remove old listener if exists
        const existingHandler = tbody._portActionHandler;
        if (existingHandler) {
            tbody.removeEventListener('click', existingHandler);
        }

        // Add new event listener
        const portActionHandler = (e) => {
            // Don't interfere with input interactions
            if (e.target.classList.contains('local-port-input')) {
                return;
            }

            // Handle clickable port/address to open browser
            const clickableElement = e.target.closest('.port-clickable');
            if (clickableElement && clickableElement.getAttribute('data-action') === 'openBrowser') {
                const address = clickableElement.getAttribute('data-address');
                const port = clickableElement.getAttribute('data-port');
                const forwardingId = clickableElement.getAttribute('data-forwarding');

                if (address) {
                    // Click on forwarded address
                    vscode.postMessage({ command: 'openBrowser', address });
                } else if (port && forwardingId) {
                    // Click on port number (when forwarded)
                    const forwarding = currentForwardings.find(f => f.id === forwardingId);
                    if (forwarding) {
                        const url = `${forwarding.localHost}:${forwarding.localPort}`;
                        vscode.postMessage({ command: 'openBrowser', address: url });
                    }
                }
                return;
            }

            const indicator = e.target.closest('.port-status-indicator');
            if (!indicator) return;

            const action = indicator.getAttribute('data-action');
            const id = indicator.getAttribute('data-id');
            const port = indicator.getAttribute('data-port');

            // Add loading state to indicator
            console.log('[Port Forward] Click on indicator:', { action, id, port, classes: indicator.className });
            indicator.classList.add('loading');
            console.log('[Port Forward] After adding loading:', indicator.className);

            if (action === 'stop') {
                vscode.postMessage({ command: 'stopPortForward', id });
            } else if (action === 'forward') {
                const remotePort = Number.parseInt(port, 10);

                // Get local port from input
                const localPortInput = document.getElementById(`local-port-${remotePort}`);
                const localPort = localPortInput ? Number.parseInt(localPortInput.value || remotePort, 10) : remotePort;

                if (!localPort || localPort < 1 || localPort > 65535) {
                    vscode.postMessage({
                        command: 'showError',
                        message: 'Please enter a valid local port (1-65535)'
                    });
                    return;
                }

                const forwardConfig = {
                    remotePort,
                    localPort,
                    localHost: '127.0.0.1',
                    remoteHost: 'localhost',
                    label: ''
                };

                console.log('[Port Forward] Quick forward:', forwardConfig);

                vscode.postMessage({
                    command: 'startPortForward',
                    config: forwardConfig
                });
            }
        };

        tbody._portActionHandler = portActionHandler;
        tbody.addEventListener('click', portActionHandler);
    }

    function renderRemoteForwards() {
        const tbody = document.getElementById('remote-forward-table-body');
        if (!tbody) return;

        // Filter remote forwardings
        const remoteForwardings = currentForwardings.filter(f => f.forwardType === 'remote');

        console.log('[Port Forward] renderRemoteForwards called', {
            totalForwardings: currentForwardings.length,
            remoteForwardings: remoteForwardings.length,
            localPortsCount: currentLocalPorts.length
        });

        // Create a map of all local ports
        const portsMap = new Map();

        // First, add all scanned local ports
        currentLocalPorts.forEach(lp => {
            portsMap.set(lp.port, {
                localPort: lp.port,
                process: lp.processName,
                pid: lp.pid,
                command: lp.command,
                listenAddress: lp.listenAddress,
                status: 'available',
                forwarding: null
            });
        });

        // Then, overlay/update with active remote forwardings
        remoteForwardings.forEach(f => {
            const existingPort = portsMap.get(f.localPort);
            if (existingPort) {
                existingPort.status = f.status === 'active' ? 'forwarded' : 'inactive';
                existingPort.forwarding = f;
            } else {
                // Forwarding exists but port not detected
                portsMap.set(f.localPort, {
                    localPort: f.localPort,
                    process: f.runningProcess || '-',
                    pid: null,
                    command: null,
                    listenAddress: f.localHost,
                    status: f.status === 'active' ? 'forwarded' : 'inactive',
                    forwarding: f
                });
            }
        });

        // Sort by port number
        const sortedPorts = Array.from(portsMap.values()).sort((a, b) => a.localPort - b.localPort);

        // Render table
        if (sortedPorts.length === 0) {
            tbody.innerHTML = '<tr class="port-forward-empty"><td colspan="5">No local ports detected</td></tr>';
            return;
        }

        tbody.innerHTML = sortedPorts.map(portInfo => {
            const { localPort, process, pid, command, listenAddress, status, forwarding } = portInfo;

            // Process info with tooltip
            const processInfo = command
                ? `<span title="${escapeHtml(command)}">${process || 'Unknown'}${pid ? ` (${pid})` : ''}</span>`
                : (process
                    ? `${process}${pid ? ` (${pid})` : ''}`
                    : '-');

            // Status indicator (clickable circle)
            let statusIndicator = '';
            let statusClass = '';
            let statusTitle = '';

            if (status === 'forwarded' && forwarding) {
                statusClass = 'forwarded';
                statusTitle = 'Click to stop forwarding';
                statusIndicator = `<div class="port-status-indicator ${statusClass}" data-action="stop" data-id="${forwarding.id}" title="${statusTitle}"></div>`;
            } else {
                statusClass = 'available';
                statusTitle = 'Click to forward this port to remote';
                statusIndicator = `<div class="port-status-indicator ${statusClass}" data-action="forward" data-local-port="${localPort}" title="${statusTitle}"></div>`;
            }

            // Forward To column - show remote address if forwarded, or input for remote port
            let forwardToContent = '';
            if (status === 'forwarded' && forwarding) {
                const forwardedAddress = `${forwarding.remoteHost}:${forwarding.remotePort}`;
                forwardToContent = `<span>${forwardedAddress}</span>`;
            } else {
                // Show remote port input for available ports
                forwardToContent = `<input type="number"
                                          class="local-port-input"
                                          id="remote-port-for-${localPort}"
                                          value="${localPort}"
                                          min="1"
                                          max="65535"
                                          placeholder="${localPort}"
                                          title="Remote port to bind on" />`;
            }

            return `
                <tr data-local-port="${localPort}" class="port-row-${status}">
                    <td class="status-cell">${statusIndicator}</td>
                    <td><strong>${localPort}</strong></td>
                    <td>${processInfo}</td>
                    <td>${listenAddress || '-'}</td>
                    <td>${forwardToContent}</td>
                </tr>
            `;
        }).join('');

        // Setup event listeners
        setupRemoteForwardTableListeners(tbody);
    }

    function setupRemoteForwardTableListeners(tbody) {
        // Remove old listener if exists
        const existingHandler = tbody._remoteForwardHandler;
        if (existingHandler) {
            tbody.removeEventListener('click', existingHandler);
        }

        const remoteForwardHandler = (e) => {
            // Don't interfere with input interactions
            if (e.target.classList.contains('local-port-input') || e.target.classList.contains('forward-input')) {
                return;
            }

            const indicator = e.target.closest('.port-status-indicator');

            if (indicator) {
                // Add loading state to indicator
                indicator.classList.add('loading');

                const action = indicator.dataset.action;
                const id = indicator.dataset.id;
                const localPortStr = indicator.dataset.localPort;

                if (action === 'stop') {
                    vscode.postMessage({ command: 'stopPortForward', id });
                } else if (action === 'forward' && localPortStr) {
                    const localPort = Number.parseInt(localPortStr, 10);

                    // Get remote port from input
                    const remotePortInput = document.getElementById(`remote-port-for-${localPort}`);
                    const remotePort = remotePortInput ? Number.parseInt(remotePortInput.value || localPort, 10) : localPort;

                    if (!remotePort || remotePort < 1 || remotePort > 65535) {
                        vscode.postMessage({
                            command: 'showError',
                            message: 'Please enter a valid remote port (1-65535)'
                        });
                        return;
                    }

                    const forwardConfig = {
                        localPort,
                        localHost: '127.0.0.1',
                        remotePort,
                        remoteHost: '127.0.0.1'
                    };

                    console.log('[Remote Forward] Quick forward:', forwardConfig);

                    vscode.postMessage({
                        command: 'startRemoteForward',
                        config: forwardConfig
                    });
                }
            }
        };

        tbody._remoteForwardHandler = remoteForwardHandler;
        tbody.addEventListener('click', remoteForwardHandler);
    }

    function initDynamicForwardHandlers() {
        const tbody = document.getElementById('dynamic-forward-table-body');
        if (!tbody) return;

        // Remove existing handler to avoid duplicates
        const existingHandler = tbody._addDynamicHandler;
        if (existingHandler) {
            tbody.removeEventListener('click', existingHandler);
        }

        // Handle click on add-dynamic-indicator
        const addDynamicHandler = (e) => {
            const indicator = e.target.closest('.add-dynamic-indicator');
            if (indicator) {
                const localPort = document.getElementById('dynamic-new-local-port')?.value;
                const localHost = document.getElementById('dynamic-new-local-host')?.value || '127.0.0.1';
                const label = document.getElementById('dynamic-new-label')?.value || 'SOCKS5 Proxy';

                if (!localPort) {
                    vscode.postMessage({
                        command: 'showError',
                        message: 'Please enter proxy port'
                    });
                    return;
                }

                const forwardConfig = {
                    localPort: Number.parseInt(localPort, 10),
                    localHost,
                    label
                };

                console.log('[Dynamic Forward] Starting dynamic forwarding:', forwardConfig);

                vscode.postMessage({
                    command: 'startDynamicForward',
                    config: forwardConfig
                });

                // Clear inputs
                const portInput = document.getElementById('dynamic-new-local-port');
                const labelInput = document.getElementById('dynamic-new-label');
                if (portInput) portInput.value = '';
                if (labelInput) labelInput.value = '';
            }
        };

        tbody._addDynamicHandler = addDynamicHandler;
        tbody.addEventListener('click', addDynamicHandler);
    }

    function renderDynamicForwards() {
        const tbody = document.getElementById('dynamic-forward-table-body');
        if (!tbody) return;

        // Filter dynamic forwardings
        const dynamicForwardings = currentForwardings.filter(f => f.forwardType === 'dynamic');

        if (dynamicForwardings.length === 0) {
            // Show a default inactive SOCKS5 proxy row that can be activated
            tbody.innerHTML = `
                <tr class="port-forward-empty">
                    <td colspan="4">No dynamic forwarding configured</td>
                </tr>
                <tr data-default="true" class="default-dynamic-row">
                    <td class="status-cell">
                        <div class="port-status-indicator available"
                             data-action="start-default"
                             data-type="dynamic"
                             title="Click to start SOCKS5 proxy"></div>
                    </td>
                    <td><strong>1080</strong></td>
                    <td>127.0.0.1</td>
                    <td>SOCKS5 Proxy</td>
                </tr>
            `;
            setupDynamicForwardTableListeners(tbody);
            return;
        }

        const rowsHtml = dynamicForwardings.map(f => {
            const statusClass = f.status === 'active' ? 'forwarded' : 'available';
            const statusTitle = f.status === 'active' ? 'Click to stop proxy' : 'Click to start proxy';

            return `
                <tr data-id="${f.id}">
                    <td class="status-cell">
                        <div class="port-status-indicator ${statusClass}"
                             data-action="${f.status === 'active' ? 'stop' : 'start'}"
                             data-id="${f.id}"
                             data-type="dynamic"
                             title="${statusTitle}"></div>
                    </td>
                    <td><strong>${f.localPort}</strong></td>
                    <td>${f.localHost}</td>
                    <td>${f.label || 'SOCKS5 Proxy'}</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rowsHtml;

        // Re-initialize handlers
        setupDynamicForwardTableListeners(tbody);
    }

    function setupDynamicForwardTableListeners(tbody) {
        // Remove existing handler to avoid duplicates
        const existingHandler = tbody._dynamicForwardHandler;
        if (existingHandler) {
            tbody.removeEventListener('click', existingHandler);
        }

        const dynamicForwardHandler = (e) => {
            const indicator = e.target.closest('.port-status-indicator:not(.add-dynamic-indicator)');

            if (indicator) {
                // Add loading state to indicator
                indicator.classList.add('loading');

                const action = indicator.dataset.action;
                const id = indicator.dataset.id;

                if (action === 'stop') {
                    vscode.postMessage({ command: 'stopPortForward', id });
                } else if (action === 'start') {
                    // Re-start an inactive dynamic forwarding
                    const forwarding = currentForwardings.find(f => f.id === id);
                    if (forwarding) {
                        vscode.postMessage({
                            command: 'startDynamicForward',
                            config: {
                                localPort: forwarding.localPort,
                                localHost: forwarding.localHost,
                                label: forwarding.label
                            },
                            existingId: id
                        });
                    }
                } else if (action === 'start-default') {
                    // Start default SOCKS5 proxy (port 1080, 127.0.0.1)
                    vscode.postMessage({
                        command: 'startDynamicForward',
                        config: {
                            localPort: 1080,
                            localHost: '127.0.0.1',
                            label: 'SOCKS5 Proxy'
                        }
                    });
                }
            }
        };

        tbody._dynamicForwardHandler = dynamicForwardHandler;
        tbody.addEventListener('click', dynamicForwardHandler);
    }

    // ===== Indicator State Update Functions =====

    /**
     * Update a specific indicator's state without re-rendering the entire table
     * @param {string} id - The forwarding ID
     * @param {string} newStatus - 'forwarded', 'available', 'inactive', or 'loading'
     * @returns {boolean} - Whether the indicator was found and updated
     */
    function updateIndicatorById(id, newStatus) {
        const indicator = document.querySelector(`.port-status-indicator[data-id="${id}"]`);
        if (!indicator) {
            // Try finding by port number as well
            const portIndicator = document.querySelector(`.port-status-indicator[data-port="${id}"]`);
            if (portIndicator) {
                updateIndicatorElement(portIndicator, newStatus);
                return true;
            }
            return false;
        }
        updateIndicatorElement(indicator, newStatus);
        return true;
    }

    /**
     * Update indicator element classes based on status
     */
    function updateIndicatorElement(indicator, newStatus) {
        // Remove all status classes
        indicator.classList.remove('loading', 'available', 'forwarded', 'inactive');

        // Add new status class
        if (newStatus === 'forwarded') {
            indicator.classList.add('forwarded');
            indicator.dataset.action = 'stop';
        } else if (newStatus === 'available') {
            indicator.classList.add('available');
            indicator.dataset.action = 'forward';
        } else if (newStatus === 'inactive') {
            indicator.classList.add('inactive');
            indicator.dataset.action = 'start';
        } else if (newStatus === 'loading') {
            indicator.classList.add('loading');
        }
    }

    /**
     * Remove loading state from all indicators (used when receiving full data update)
     */
    function removeAllLoadingStates() {
        const loadingIndicators = document.querySelectorAll('.port-status-indicator.loading');
        loadingIndicators.forEach(indicator => {
            indicator.classList.remove('loading');
        });
    }

    // ===== Utility Functions =====

    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ===== Global Functions (for backwards compatibility) =====

    globalThis.stopPortForward = function(id) {
        vscode.postMessage({
            command: 'stopPortForward',
            id
        });
    };

    globalThis.deletePortForward = function(id) {
        if (confirm('Are you sure you want to delete this port forwarding?')) {
            vscode.postMessage({
                command: 'deletePortForward',
                id
            });
        }
    };

    // ===== Export Module =====

    // Export for module usage
    const PortForwardModule = {
        init: initPortForwardModule,
        openView: openPortForwardView,
        closeView: closePortForwardView,
        refresh: () => {
            vscode.postMessage({ command: 'getPortForwardings' });
        },
        scanRemotePorts: handleScanRemotePorts,
        scanLocalPorts: handleScanLocalPorts,
        showAddModal: showAddPortModal,
        hideAddModal: hideAddPortModal,
        handleMessage: handleMessage,
        isViewVisible: () => isPortForwardViewVisible,
        getCurrentForwardings: () => currentForwardings,
        getCurrentTab: () => currentForwardTab,
    };

    // Export to global scope
    globalThis.PortForwardModule = PortForwardModule;

    // Auto-initialize if DOM is ready and vscode is available
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Check if standalone mode (presence of standalone marker)
            const isStandalone = document.body.classList.contains('port-forward-standalone');
            if (isStandalone) {
                initPortForwardModule({ isStandalone: true, showCloseButton: false });
            }
        });
    } else {
        // DOM already ready
        const isStandalone = document.body.classList.contains('port-forward-standalone');
        if (isStandalone) {
            initPortForwardModule({ isStandalone: true, showCloseButton: false });
        }
    }

})(typeof globalThis !== 'undefined' ? globalThis : window);
