(function () {
  const vscode = acquireVsCodeApi();

  // DOM elements
  const refreshBtn = document.getElementById('refreshBtn');
  const viewLogsBtn = document.getElementById('viewLogsBtn');
  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const contentState = document.getElementById('contentState');
  const errorText = document.getElementById('errorText');
  const autoRefreshToggle = document.getElementById('autoRefreshToggle');
  const refreshIntervalSelect = document.getElementById('refreshInterval');

  // Tab elements
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  // Current active tab
  let activeTab = 'overview';

  // Process sort state
  let currentProcesses = [];
  let processSortColumn = 'cpu';
  let processSortDir = 'desc';

  // Network sort state
  let currentNetworkInterfaces = [];
  let networkSortColumn = 'name';
  let networkSortDir = 'asc';

  // I/O sort state
  let currentIODevices = [];
  let ioSortColumn = 'utilization';
  let ioSortDir = 'desc';

  // Auto-refresh state
  let autoRefreshInterval = null;
  let refreshIntervalSeconds = 20;

  // Start auto-refresh on load if checkbox is checked
  if (autoRefreshToggle.checked) {
    startAutoRefresh();
  }

  // Tab switching
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.dataset.tab;
      switchTab(tabName);
    });
  });

  function switchTab(tabName) {
    // Update active tab
    activeTab = tabName;

    // Update tab buttons
    tabButtons.forEach(btn => {
      if (btn.dataset.tab === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update tab contents
    tabContents.forEach(content => {
      if (content.id === `${tabName}Tab`) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });

    // Show loading state while fetching tab data
    showTabLoading(tabName);

    // Request data for the active tab
    requestTabData(tabName);
  }

  function showTabLoading(tabName) {
    const loadingRow = `<tr class="tab-loading-row"><td colspan="99"><span class="tab-loading-spinner"></span>Loading...</td></tr>`;
    const loadingDiv = `<div class="tab-loading-div"><span class="tab-loading-spinner"></span>Loading...</div>`;

    switch (tabName) {
      case 'processes':
        document.getElementById('processList').innerHTML = loadingRow;
        break;
      case 'network':
        document.getElementById('networkList').innerHTML = loadingRow;
        break;
      case 'io':
        document.getElementById('ioList').innerHTML = loadingRow;
        break;
      case 'disk': {
        const diskList = document.getElementById('diskList');
        if (diskList) { diskList.innerHTML = loadingDiv; }
        break;
      }
    }
  }

  function requestTabData(tabName) {
    vscode.postMessage({
      type: 'refresh',
      tab: tabName
    });
  }

  // Event listeners
  refreshBtn.addEventListener('click', () => {
    requestTabData(activeTab);
  });

  viewLogsBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'showLogs' });
  });

  // Auto-refresh toggle
  autoRefreshToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  // Refresh interval change
  refreshIntervalSelect.addEventListener('change', (e) => {
    const seconds = Number.parseInt(e.target.value);
    refreshIntervalSeconds = seconds;

    if (seconds === 0) {
      autoRefreshToggle.checked = false;
      stopAutoRefresh();
    } else if (autoRefreshToggle.checked) {
      // Restart with new interval
      stopAutoRefresh();
      startAutoRefresh();
    }
  });

  // Auto-refresh functions
  function startAutoRefresh() {
    if (refreshIntervalSeconds > 0) {
      autoRefreshInterval = setInterval(() => {
        requestTabData(activeTab);
      }, refreshIntervalSeconds * 1000);
    }
  }

  function stopAutoRefresh() {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }

  // Handle messages from extension
  window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.type) {
      case 'loading':
        handleLoading(message.data);
        break;

      case 'resourceData':
        handleResourceData(message.data);
        break;

      case 'processData':
        handleProcessData(message.data);
        break;

      case 'networkData':
        handleNetworkData(message.data);
        break;

      case 'ioData':
        handleIOData(message.data);
        break;

      case 'diskData':
        handleDiskData(message.data);
        break;

      case 'error':
        handleError(message.data);
        break;
    }
  });

  function handleLoading(isLoading) {
    if (isLoading) {
      // Only show loading state if content is not yet displayed (first load)
      // This prevents flashing during auto-refresh
      const isFirstLoad = contentState.style.display === 'none';
      if (isFirstLoad) {
        loadingState.style.display = 'flex';
        errorState.style.display = 'none';
        contentState.style.display = 'none';
      }
      refreshBtn.disabled = true;
    } else {
      loadingState.style.display = 'none';
      refreshBtn.disabled = false;
    }
  }

  function handleError(data) {
    loadingState.style.display = 'none';
    errorState.style.display = 'flex';
    contentState.style.display = 'none';
    errorText.textContent = data.message;
    refreshBtn.disabled = false;
  }

  function handleResourceData(data) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;

    updateHealthSummary(data.health);

    // Update system info
    document.getElementById('hostname').textContent = data.system.hostname;
    document.getElementById('os').textContent = data.system.os;
    document.getElementById('kernel').textContent = data.system.kernel;
    document.getElementById('uptime').textContent = data.system.uptime;

    // Update CPU info
    document.getElementById('cpuUsage').textContent = `${data.cpu.usage.toFixed(1)}%`;
    document.getElementById('cores').textContent = data.cpu.cores;
    document.getElementById('loadAvg').textContent = `${data.cpu.loadAvg1} / ${data.cpu.loadAvg5} / ${data.cpu.loadAvg15}`;

    // Update memory info
    document.getElementById('memoryUsage').textContent = `${data.memory.usage.toFixed(1)}%`;
    document.getElementById('memoryTotal').textContent = `${formatBytes(data.memory.total)} MB`;
    document.getElementById('memoryUsed').textContent = `${formatBytes(data.memory.used)} MB`;
    document.getElementById('memoryAvailable').textContent = `${formatBytes(data.memory.available)} MB`;
    document.getElementById('memoryBuffers').textContent = `${formatBytes(data.memory.buffers || 0)} MB`;
    document.getElementById('memoryCached').textContent = `${formatBytes(data.memory.cached || 0)} MB`;
    document.getElementById('memorySwap').textContent = formatSwap(data.memory);

    // Update disk summary for overview tab
    updateDiskSummary(data.disk);
  }

  function updateHealthSummary(health) {
    const healthBadge = document.getElementById('healthBadge');
    const healthSummary = document.getElementById('healthSummary');
    const healthAlerts = document.getElementById('healthAlerts');
    const healthUpdatedAt = document.getElementById('healthUpdatedAt');

    const status = health?.status || 'healthy';
    const summaryText = health?.summary || 'All monitored resources are within normal ranges.';

    healthBadge.textContent = capitalize(status);
    healthBadge.className = `health-badge health-${status}`;
    healthSummary.textContent = summaryText;
    healthUpdatedAt.textContent = health?.updatedAt
      ? `Updated ${formatTimestamp(health.updatedAt)}`
      : 'Updated just now';

    healthAlerts.innerHTML = '';

    if (!health?.alerts || health.alerts.length === 0) {
      healthAlerts.innerHTML = '<div class="health-alert-empty">No alerts</div>';
      return;
    }

    health.alerts.forEach((alert) => {
      const alertItem = document.createElement('div');
      alertItem.className = `health-alert health-${alert.severity}`;
      alertItem.innerHTML = `
        <span class="health-alert-severity">${capitalize(alert.severity)}</span>
        <div class="health-alert-content">
          <span class="health-alert-title">${escapeHtml(alert.label)}</span>
          <span class="health-alert-message">${escapeHtml(alert.message)}</span>
        </div>
      `;
      healthAlerts.appendChild(alertItem);
    });
  }

  function handleProcessData(processes) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;

    currentProcesses = processes || [];
    renderProcessTable();
  }

  function renderProcessTable() {
    const processList = document.getElementById('processList');

    if (currentProcesses.length === 0) {
      processList.innerHTML = '<tr><td colspan="9" class="empty-state">No process data available</td></tr>';
      return;
    }

    // Sort
    const numericCols = new Set(['pid', 'cpu', 'mem', 'rss', 'vsz']);
    const sorted = [...currentProcesses].sort((a, b) => {
      let aVal = a[processSortColumn];
      let bVal = b[processSortColumn];
      if (numericCols.has(processSortColumn)) {
        aVal = Number.parseFloat(aVal) || 0;
        bVal = Number.parseFloat(bVal) || 0;
      } else {
        aVal = String(aVal || '').toLowerCase();
        bVal = String(bVal || '').toLowerCase();
      }
      if (aVal < bVal) { return processSortDir === 'asc' ? -1 : 1; }
      if (aVal > bVal) { return processSortDir === 'asc' ? 1 : -1; }
      return 0;
    });

    // Update header sort indicators
    document.querySelectorAll('.process-table th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === processSortColumn) {
        th.classList.add(processSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    // Smooth update: fade out, update, fade in
    processList.style.opacity = '0.4';

    setTimeout(() => {
      processList.innerHTML = '';

      sorted.forEach(proc => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${proc.pid}</td>
          <td>${escapeHtml(proc.user)}</td>
          <td>${escapeHtml(proc.stat)}</td>
          <td>${proc.cpu}%</td>
          <td>${proc.mem}%</td>
          <td>${formatKilobytes(proc.rss)}</td>
          <td>${formatKilobytes(proc.vsz)}</td>
          <td>${escapeHtml(proc.time)}</td>
          <td style="font-family: var(--vscode-editor-font-family);">${escapeHtml(proc.command)}</td>
        `;
        processList.appendChild(row);
      });

      processList.style.opacity = '1';
    }, 100);
  }

  function handleNetworkData(interfaces) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;

    currentNetworkInterfaces = interfaces || [];
    renderNetworkTable();
  }

  function renderNetworkTable() {
    const networkList = document.getElementById('networkList');

    if (currentNetworkInterfaces.length === 0) {
      networkList.innerHTML = '<tr><td colspan="11" class="empty-state">No network data available</td></tr>';
      return;
    }

    const numericCols = new Set(['rxBytes', 'txBytes', 'rxRate', 'txRate', 'rxPackets', 'txPackets']);
    const sorted = [...currentNetworkInterfaces].sort((a, b) => {
      let aVal = a[networkSortColumn];
      let bVal = b[networkSortColumn];
      if (numericCols.has(networkSortColumn)) {
        aVal = Number(aVal) || 0;
        bVal = Number(bVal) || 0;
      } else {
        aVal = String(aVal || '').toLowerCase();
        bVal = String(bVal || '').toLowerCase();
      }
      if (aVal < bVal) { return networkSortDir === 'asc' ? -1 : 1; }
      if (aVal > bVal) { return networkSortDir === 'asc' ? 1 : -1; }
      return 0;
    });

    document.querySelectorAll('.network-table th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === networkSortColumn) {
        th.classList.add(networkSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    networkList.style.opacity = '0.4';

    setTimeout(() => {
      networkList.innerHTML = '';

      sorted.forEach(iface => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${escapeHtml(iface.name)}</td>
          <td>${renderStateBadge(iface.state)}</td>
          <td>${iface.ipAddress ? escapeHtml(iface.ipAddress) : '—'}</td>
          <td>${formatBytesSize(iface.rxBytes)}</td>
          <td>${formatBytesSize(iface.txBytes)}</td>
          <td>${typeof iface.rxRate === 'number' ? formatRate(iface.rxRate) : 'N/A'}</td>
          <td>${typeof iface.txRate === 'number' ? formatRate(iface.txRate) : 'N/A'}</td>
          <td>${formatCount(iface.rxPackets)}</td>
          <td>${formatCount(iface.txPackets)}</td>
          <td>${formatCount(iface.rxErrors || 0)} / ${formatCount(iface.rxDropped || 0)}</td>
          <td>${formatCount(iface.txErrors || 0)} / ${formatCount(iface.txDropped || 0)}</td>
        `;
        networkList.appendChild(row);
      });

      networkList.style.opacity = '1';
    }, 100);
  }

  function handleIOData(devices) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;

    currentIODevices = devices || [];
    renderIOTable();
  }

  function renderIOTable() {
    const ioList = document.getElementById('ioList');

    if (currentIODevices.length === 0) {
      ioList.innerHTML = '<tr><td colspan="4" class="empty-state">No I/O data available</td></tr>';
      return;
    }

    const numericCols = new Set(['readKBps', 'writeKBps', 'utilization']);
    const sorted = [...currentIODevices].sort((a, b) => {
      let aVal = a[ioSortColumn];
      let bVal = b[ioSortColumn];
      if (numericCols.has(ioSortColumn)) {
        aVal = Number(aVal) || 0;
        bVal = Number(bVal) || 0;
      } else {
        aVal = String(aVal || '').toLowerCase();
        bVal = String(bVal || '').toLowerCase();
      }
      if (aVal < bVal) { return ioSortDir === 'asc' ? -1 : 1; }
      if (aVal > bVal) { return ioSortDir === 'asc' ? 1 : -1; }
      return 0;
    });

    document.querySelectorAll('.io-table th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === ioSortColumn) {
        th.classList.add(ioSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    ioList.style.opacity = '0.4';

    setTimeout(() => {
      ioList.innerHTML = '';

      sorted.forEach(device => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${escapeHtml(device.device)}</td>
          <td>${formatKBps(device.readKBps)} KB/s</td>
          <td>${formatKBps(device.writeKBps)} KB/s</td>
          <td>${device.utilization.toFixed(1)}%</td>
        `;
        ioList.appendChild(row);
      });

      ioList.style.opacity = '1';
    }, 100);
  }

  function handleDiskData(disks) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;

    updateDiskList(disks);
  }

  function updateDiskSummary(disks) {
    const diskSummary = document.getElementById('diskSummary');

    if (!disks || disks.length === 0) {
      diskSummary.innerHTML = '<p style="color: var(--vscode-descriptionForeground); font-size: 12px;">No disk information available</p>';
      return;
    }

    // Smooth update: fade out, update, fade in
    diskSummary.style.opacity = '0.4';

    setTimeout(() => {
      diskSummary.innerHTML = '';

      disks.forEach((disk) => {
        const diskItem = document.createElement('div');
        diskItem.className = 'disk-item-summary';
        diskItem.innerHTML = `
          <div class="info-item">
            <span class="info-label">Mountpoint</span>
            <span class="info-value">${escapeHtml(disk.mountpoint)}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Usage</span>
            <span class="info-value">${disk.usage.toFixed(1)}%</span>
          </div>
          <div class="info-item">
            <span class="info-label">Total</span>
            <span class="info-value">${disk.total} GB</span>
          </div>
          <div class="info-item">
            <span class="info-label">Available</span>
            <span class="info-value">${disk.available} GB</span>
          </div>
        `;
        diskSummary.appendChild(diskItem);
      });

      diskSummary.style.opacity = '1';
    }, 100);
  }

  function updateDiskList(disks) {
    const diskList = document.getElementById('diskList');

    if (!disks || disks.length === 0) {
      diskList.innerHTML = '<p style="color: var(--vscode-descriptionForeground); font-size: 12px;">No disk information available</p>';
      return;
    }

    // Smooth update: fade out, update, fade in
    diskList.style.opacity = '0.4';

    setTimeout(() => {
      diskList.innerHTML = '';

      disks.forEach((disk) => {
        const diskItem = document.createElement('div');
        diskItem.className = 'disk-item';
        diskItem.innerHTML = `
          <div class="info-item">
            <span class="info-label">Mountpoint</span>
            <span class="info-value">${escapeHtml(disk.mountpoint)}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Filesystem</span>
            <span class="info-value">${escapeHtml(disk.filesystem)}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Usage</span>
            <span class="info-value">${disk.usage.toFixed(1)}%</span>
          </div>
          <div class="info-item">
            <span class="info-label">Total</span>
            <span class="info-value">${disk.total} GB</span>
          </div>
          <div class="info-item">
            <span class="info-label">Used</span>
            <span class="info-value">${disk.used} GB</span>
          </div>
          <div class="info-item">
            <span class="info-label">Available</span>
            <span class="info-value">${disk.available} GB</span>
          </div>
        `;
        diskList.appendChild(diskItem);
      });

      diskList.style.opacity = '1';
    }, 100);
  }

  function formatBytes(mb) {
    return mb.toLocaleString();
  }

  function formatSwap(memory) {
    if (!memory?.swapTotal) {
      return 'Disabled';
    }

    return `${formatBytes(memory.swapUsed || 0)} / ${formatBytes(memory.swapTotal)} MB (${(memory.swapUsage || 0).toFixed(1)}%)`;
  }

  function formatBytesSize(bytes) {
    if (bytes >= 1073741824) {
      return (bytes / 1073741824).toFixed(2) + ' GB';
    } else if (bytes >= 1048576) {
      return (bytes / 1048576).toFixed(2) + ' MB';
    } else if (bytes >= 1024) {
      return (bytes / 1024).toFixed(2) + ' KB';
    }
    return bytes + ' B';
  }

  function formatRate(bytesPerSec) {
    if (bytesPerSec >= 1048576) {
      return (bytesPerSec / 1048576).toFixed(2) + ' MB/s';
    } else if (bytesPerSec >= 1024) {
      return (bytesPerSec / 1024).toFixed(2) + ' KB/s';
    }
    return bytesPerSec.toFixed(0) + ' B/s';
  }

  function formatKBps(kbps) {
    if (kbps >= 1024) {
      return (kbps / 1024).toFixed(2) + ' MB';
    }
    return kbps.toFixed(2);
  }

  function formatKilobytes(kb) {
    if (kb >= 1048576) {
      return (kb / 1048576).toFixed(2) + ' GB';
    }

    if (kb >= 1024) {
      return (kb / 1024).toFixed(2) + ' MB';
    }

    return `${kb} KB`;
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'just now';
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  function capitalize(value) {
    if (!value) {
      return '';
    }

    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function renderStateBadge(state) {
    const safeState = escapeHtml(state || 'UNKNOWN');
    const normalizedState = String(state || 'unknown').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
    return `<span class="status-pill state-${normalizedState}">${safeState}</span>`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Process table header sort click handlers
  document.querySelectorAll('.process-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (processSortColumn === col) {
        processSortDir = processSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        processSortColumn = col;
        processSortDir = col === 'cpu' || col === 'mem' ? 'desc' : 'asc';
      }
      renderProcessTable();
    });
  });

  // Network table header sort click handlers
  document.querySelectorAll('.network-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      const numericCols = new Set(['rxBytes', 'txBytes', 'rxRate', 'txRate', 'rxPackets', 'txPackets']);
      if (networkSortColumn === col) {
        networkSortDir = networkSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        networkSortColumn = col;
        networkSortDir = numericCols.has(col) ? 'desc' : 'asc';
      }
      renderNetworkTable();
    });
  });

  // I/O table header sort click handlers
  document.querySelectorAll('.io-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (ioSortColumn === col) {
        ioSortDir = ioSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        ioSortColumn = col;
        ioSortDir = col === 'device' ? 'asc' : 'desc';
      }
      renderIOTable();
    });
  });
})();
