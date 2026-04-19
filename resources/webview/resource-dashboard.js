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

  // Sparkline history
  let cpuHistory = [];
  let memHistory = [];
  let diskReadHistory = [];
  let diskWriteHistory = [];
  const MAX_SPARKLINE_POINTS = 20;

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
      case 'logs': {
        const logOutput = document.getElementById('logOutput');
        if (logOutput) { logOutput.innerHTML = '<span class="log-loading">Loading log files…</span>'; }
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

      case 'logsFiles':
        handleLogsFiles(message.data);
        break;

      case 'logsContent':
        handleLogsContent(message.data);
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

    // Update metric cards and sparklines
    updateMetricCards(data);

    // Refresh top processes in overview (in case processes were already loaded)
    updateOverviewTopProcesses();

    // Pre-fetch process data for overview top 5 if not yet loaded
    if (currentProcesses.length === 0) {
      vscode.postMessage({ type: 'refresh', tab: 'processes' });
    }
  }

  function updateMetricCards(data) {
    const cpuUsage = data.cpu.usage;
    const metricCpuValue = document.getElementById('metricCpuValue');
    metricCpuValue.textContent = `${cpuUsage.toFixed(1)}%`;
    metricCpuValue.className = `metric-card-value ${getUsageClass(cpuUsage)}`;
    cpuHistory.push(cpuUsage);
    if (cpuHistory.length > MAX_SPARKLINE_POINTS) { cpuHistory.shift(); }
    renderSparkline('cpuSparkline', cpuHistory, 'cpu-sparkline-line');
    if (document.getElementById('metricCpuCard')?.classList.contains('expanded')) {
      renderDetailChart('cpuDetailChart', cpuHistory, 'cpu-sparkline-line', 'cpuDetailMin', 'cpuDetailAvg', 'cpuDetailMax', '%');
    }

    const memUsage = data.memory.usage;
    const metricMemValue = document.getElementById('metricMemValue');
    metricMemValue.textContent = `${memUsage.toFixed(1)}%`;
    metricMemValue.className = `metric-card-value ${getUsageClass(memUsage)}`;
    memHistory.push(memUsage);
    if (memHistory.length > MAX_SPARKLINE_POINTS) { memHistory.shift(); }
    renderSparkline('memSparkline', memHistory, 'mem-sparkline-line');
    if (document.getElementById('metricMemCard')?.classList.contains('expanded')) {
      renderDetailChart('memDetailChart', memHistory, 'mem-sparkline-line', 'memDetailMin', 'memDetailAvg', 'memDetailMax', '%');
    }

    if (data.disk && data.disk.length > 0) {
      const primaryDisk = data.disk.reduce((a, b) => (a.usage > b.usage ? a : b));
      const diskUsage = primaryDisk.usage;
      const metricDiskValue = document.getElementById('metricDiskValue');
      metricDiskValue.textContent = `${diskUsage.toFixed(1)}%`;
      metricDiskValue.className = `metric-card-value ${getUsageClass(diskUsage)}`;
      const diskBar = document.getElementById('metricDiskBar');
      diskBar.style.width = `${Math.min(diskUsage, 100)}%`;
      diskBar.className = `metric-disk-bar-fill ${getUsageClass(diskUsage)}`;
    }
  }

  function getUsageClass(pct) {
    if (pct >= 80) { return 'usage-danger'; }
    if (pct >= 60) { return 'usage-warn'; }
    return 'usage-normal';
  }

  function renderSparkline(svgId, history, lineClass) {
    const svg = document.getElementById(svgId);
    if (!svg || history.length < 2) { return; }
    const W = 100;
    const H = 30;
    const maxVal = Math.max(...history, 1);
    const points = history.map((val, i) => {
      const x = ((i / (history.length - 1)) * W).toFixed(1);
      const y = (H - (val / maxVal) * H * 0.9).toFixed(1);
      return `${x},${y}`;
    }).join(' ');
    svg.innerHTML = `<polyline class="${lineClass}" points="${points}"/>`;
  }

  function renderDetailChart(svgId, history, lineClass, minId, avgId, maxId, unit) {
    const svg = document.getElementById(svgId);
    if (!svg || history.length < 2) { return; }
    const W = 100;
    const H = 50;
    const maxVal = Math.max(...history, 1);
    const points = history.map((val, i) => {
      const x = ((i / (history.length - 1)) * W).toFixed(1);
      const y = (H - (val / maxVal) * H * 0.9).toFixed(1);
      return `${x},${y}`;
    }).join(' ');
    const gridLines = [0.25, 0.5, 0.75].map(pct => {
      const y = (H - pct * H * 0.9).toFixed(1);
      return `<line x1="0" y1="${y}" x2="100" y2="${y}" class="detail-grid-line"/>`;
    }).join('');
    svg.innerHTML = `${gridLines}<polyline class="${lineClass}" points="${points}"/>`;
    const min = Math.min(...history);
    const max = Math.max(...history);
    const avg = history.reduce((s, v) => s + v, 0) / history.length;
    const minEl = document.getElementById(minId);
    const avgEl = document.getElementById(avgId);
    const maxEl = document.getElementById(maxId);
    if (minEl) { minEl.textContent = `Min ${min.toFixed(1)}${unit}`; }
    if (avgEl) { avgEl.textContent = `Avg ${avg.toFixed(1)}${unit}`; }
    if (maxEl) { maxEl.textContent = `Max ${max.toFixed(1)}${unit}`; }
  }

  function renderDualChart(svgId, history1, history2, lineClass1, lineClass2, H, showGrid) {
    const svg = document.getElementById(svgId);
    if (!svg) { return; }
    const len = Math.max(history1.length, history2.length);
    if (len < 2) { return; }
    const W = 100;
    const maxVal = Math.max(...history1, ...history2, 1);
    function padAndMap(hist) {
      const padded = hist.length < len ? [...new Array(len - hist.length).fill(0), ...hist] : hist;
      return padded.map((val, i) => {
        const x = ((i / (len - 1)) * W).toFixed(1);
        const y = (H - (val / maxVal) * H * 0.9).toFixed(1);
        return `${x},${y}`;
      }).join(' ');
    }
    let content = '';
    if (showGrid) {
      content = [0.25, 0.5, 0.75].map(pct => {
        const y = (H - pct * H * 0.9).toFixed(1);
        return `<line x1="0" y1="${y}" x2="100" y2="${y}" class="detail-grid-line"/>`;
      }).join('');
    }
    content += `<polyline class="${lineClass1}" points="${padAndMap(history1)}"/><polyline class="${lineClass2}" points="${padAndMap(history2)}"/>`;
    svg.innerHTML = content;
  }

  function updateOverviewTopProcesses() {
    const tbody = document.getElementById('overviewTopProcesses');
    if (!tbody) { return; }
    if (currentProcesses.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No data — visit Processes tab to load</td></tr>';
      return;
    }
    const top5 = [...currentProcesses]
      .sort((a, b) => (Number.parseFloat(b.cpu) || 0) - (Number.parseFloat(a.cpu) || 0))
      .slice(0, 5);
    tbody.innerHTML = '';
    top5.forEach(proc => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${proc.pid}</td>
        <td>${escapeHtml(proc.user)}</td>
        <td>${proc.cpu}%</td>
        <td>${proc.mem}%</td>
        <td style="font-family: var(--vscode-editor-font-family);">${escapeHtml(proc.command)}</td>
      `;
      tbody.appendChild(row);
    });
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
    updateOverviewTopProcesses();
  }

  function renderProcessTable() {
    const processList = document.getElementById('processList');

    if (currentProcesses.length === 0) {
      processList.innerHTML = '<tr><td colspan="10" class="empty-state">No process data available</td></tr>';
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
          <td class="process-actions-cell">
            <div class="process-kill-dropdown">
              <button class="process-kill-btn" data-pid="${proc.pid}" title="Send signal to process">
                <i class="codicon codicon-debug-stop"></i>
              </button>
              <div class="process-kill-menu" id="killMenu-${proc.pid}">
                <div class="process-kill-menu-item" data-pid="${proc.pid}" data-signal="SIGTERM">SIGTERM <span class="kill-menu-hint">(graceful)</span></div>
                <div class="process-kill-menu-item" data-pid="${proc.pid}" data-signal="SIGINT">SIGINT <span class="kill-menu-hint">(interrupt)</span></div>
                <div class="process-kill-menu-item" data-pid="${proc.pid}" data-signal="SIGHUP">SIGHUP <span class="kill-menu-hint">(hangup)</span></div>
                <div class="process-kill-menu-item kill-menu-danger" data-pid="${proc.pid}" data-signal="SIGKILL">SIGKILL <span class="kill-menu-hint">(force)</span></div>
              </div>
            </div>
          </td>
        `;
        processList.appendChild(row);
      });

      processList.style.opacity = '1';
    }, 100);
  }

  function closeAllKillMenus() {
    document.querySelectorAll('.process-kill-menu.open').forEach(m => m.classList.remove('open'));
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.process-kill-btn');
    if (btn) {
      e.stopPropagation();
      const pid = btn.dataset.pid;
      const menu = document.getElementById(`killMenu-${pid}`);
      const isOpen = menu?.classList.contains('open');
      closeAllKillMenus();
      if (!isOpen && menu) { menu.classList.add('open'); }
      return;
    }
    const item = e.target.closest('.process-kill-menu-item');
    if (item) {
      const pid = Number.parseInt(item.dataset.pid);
      const signal = item.dataset.signal;
      closeAllKillMenus();
      vscode.postMessage({ type: 'killProcess', pid, signal });
      return;
    }
    closeAllKillMenus();
  });

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

    // Update Disk I/O metric card
    const totalRead = currentIODevices.reduce((sum, d) => sum + (d.readKBps || 0), 0);
    const totalWrite = currentIODevices.reduce((sum, d) => sum + (d.writeKBps || 0), 0);
    diskReadHistory.push(totalRead);
    diskWriteHistory.push(totalWrite);
    if (diskReadHistory.length > MAX_SPARKLINE_POINTS) { diskReadHistory.shift(); }
    if (diskWriteHistory.length > MAX_SPARKLINE_POINTS) { diskWriteHistory.shift(); }
    updateDiskIOCard(totalRead, totalWrite);
  }

  function updateDiskIOCard(readKBps, writeKBps) {
    const readEl = document.getElementById('metricDiskIORead');
    const writeEl = document.getElementById('metricDiskIOWrite');
    if (readEl) { readEl.textContent = `${formatKBps(readKBps)} KB/s`; }
    if (writeEl) { writeEl.textContent = `${formatKBps(writeKBps)} KB/s`; }
    if (diskReadHistory.length >= 2 || diskWriteHistory.length >= 2) {
      renderDualChart('diskIOSparkline', diskReadHistory, diskWriteHistory, 'disk-read-line', 'disk-write-line', 30, false);
    }
    if (document.getElementById('metricDiskIOCard')?.classList.contains('expanded')) {
      renderDualChart('diskIODetailChart', diskReadHistory, diskWriteHistory, 'disk-read-line', 'disk-write-line', 50, true);
    }
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

  function handleLogsFiles(files) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;

    const select = document.getElementById('logFileSelect');
    if (!select) { return; }

    // Preserve current selection if still valid
    const prevValue = select.value;
    select.innerHTML = '<option value="">-- Select a log file --</option>';
    if (files && files.length > 0) {
      files.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        select.appendChild(opt);
      });
    } else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No readable log files found in /var/log';
      opt.disabled = true;
      select.appendChild(opt);
    }

    // Restore previous selection or pick first log
    if (prevValue && files?.includes(prevValue)) {
      select.value = prevValue;
    } else if (files && files.length > 0) {
      // Auto-select the first file and load it
      select.value = files[0];
      fetchLogContent(files[0]);
    }
  }

  function handleLogsContent(data) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;

    const logOutput = document.getElementById('logOutput');
    if (!logOutput) { return; }

    const lines = (data.content || '').split('\n');
    logOutput.style.opacity = '0.4';
    setTimeout(() => {
      logOutput.innerHTML = '';
      lines.forEach((line, idx) => {
        const span = document.createElement('span');
        span.className = `log-line ${getLogLineSeverity(line)}`;
        span.textContent = `${String(idx + 1).padStart(5, ' ')}  ${line}`;
        logOutput.appendChild(span);
        logOutput.appendChild(document.createTextNode('\n'));
      });
      // Scroll to bottom
      logOutput.scrollTop = logOutput.scrollHeight;
      logOutput.style.opacity = '1';
    }, 80);
  }

  function getLogLineSeverity(line) {
    const lower = line.toLowerCase();
    if (/error|fail|critical|crit|emerg|alert/.test(lower)) { return 'log-line-error'; }
    if (/warn/.test(lower)) { return 'log-line-warn'; }
    if (/info|notice/.test(lower)) { return 'log-line-info'; }
    return '';
  }

  function fetchLogContent(filePath) {
    const linesSelect = document.getElementById('logLinesSelect');
    const lines = linesSelect ? Number.parseInt(linesSelect.value, 10) : 200;
    const logOutput = document.getElementById('logOutput');
    if (logOutput) { logOutput.innerHTML = '<span class="log-loading">Loading…</span>'; }
    vscode.postMessage({ type: 'fetchLogs', filePath, lines });
  }

  // Logs tab: file selector change
  const logFileSelect = document.getElementById('logFileSelect');
  if (logFileSelect) {
    logFileSelect.addEventListener('change', () => {
      if (logFileSelect.value) { fetchLogContent(logFileSelect.value); }
    });
  }

  // Logs tab: lines selector change
  const logLinesSelect = document.getElementById('logLinesSelect');
  if (logLinesSelect) {
    logLinesSelect.addEventListener('change', () => {
      if (logFileSelect?.value) { fetchLogContent(logFileSelect.value); }
    });
  }

  // Logs tab: refresh button
  const logRefreshBtn = document.getElementById('logRefreshBtn');
  if (logRefreshBtn) {
    logRefreshBtn.addEventListener('click', () => {
      if (logFileSelect?.value) {
        fetchLogContent(logFileSelect.value);
      } else {
        // Re-list files
        vscode.postMessage({ type: 'refresh', tab: 'logs' });
      }
    });
  }

  // Metric card expand/collapse click handlers
  ['metricCpuCard', 'metricMemCard', 'metricDiskIOCard'].forEach(cardId => {
    const card = document.getElementById(cardId);
    if (!card) { return; }
    card.addEventListener('click', () => {
      card.classList.toggle('expanded');
      if (!card.classList.contains('expanded')) { return; }
      if (cardId === 'metricCpuCard') {
        renderDetailChart('cpuDetailChart', cpuHistory, 'cpu-sparkline-line', 'cpuDetailMin', 'cpuDetailAvg', 'cpuDetailMax', '%');
      } else if (cardId === 'metricMemCard') {
        renderDetailChart('memDetailChart', memHistory, 'mem-sparkline-line', 'memDetailMin', 'memDetailAvg', 'memDetailMax', '%');
      } else if (cardId === 'metricDiskIOCard') {
        if (diskReadHistory.length === 0) {
          vscode.postMessage({ type: 'refresh', tab: 'io' });
        } else {
          renderDualChart('diskIODetailChart', diskReadHistory, diskWriteHistory, 'disk-read-line', 'disk-write-line', 50, true);
        }
      }
    });
  });
})();
