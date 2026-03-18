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

    // Request data for the active tab
    requestTabData(tabName);
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

    const processList = document.getElementById('processList');

    if (!processes || processes.length === 0) {
      processList.innerHTML = '<tr><td colspan="9" class="empty-state">No process data available</td></tr>';
      return;
    }

    // Smooth update: fade out, update, fade in
    processList.style.opacity = '0.4';

    setTimeout(() => {
      processList.innerHTML = '';

      processes.forEach(proc => {
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

    const networkList = document.getElementById('networkList');

    if (!interfaces || interfaces.length === 0) {
      networkList.innerHTML = '<tr><td colspan="11" class="empty-state">No network data available</td></tr>';
      return;
    }

    // Smooth update: fade out, update, fade in
    networkList.style.opacity = '0.4';

    setTimeout(() => {
      networkList.innerHTML = '';

      interfaces.forEach(iface => {
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

    const ioList = document.getElementById('ioList');

    if (!devices || devices.length === 0) {
      ioList.innerHTML = '<tr><td colspan="4" class="empty-state">No I/O data available</td></tr>';
      return;
    }

    // Smooth update: fade out, update, fade in
    ioList.style.opacity = '0.4';

    setTimeout(() => {
      ioList.innerHTML = '';

      devices.forEach(device => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${device.device}</td>
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

    return date.toLocaleTimeString();
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
})();
