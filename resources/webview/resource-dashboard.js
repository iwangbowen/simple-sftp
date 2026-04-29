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
  const tabNav = document.querySelector('.tab-nav');
  const tabNavTabs = document.querySelector('.tab-nav-tabs');
  const tabMoreBtn = document.getElementById('tabMoreBtn');
  const tabMoreMenu = document.getElementById('tabMoreMenu');

  // Current active tab
  let activeTab = 'overview';

  // Process sort state
  let currentProcesses = [];
  let processSortColumn = 'cpu';
  let processSortDir = 'desc';
  let processFilterQuery = '';

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

    // Update more button active indicator
    updateMoreBtnState();

    // Show loading state while fetching tab data
    showTabLoading(tabName);

    // Request data for the active tab
    requestTabData(tabName);
  }

  // ── Tab overflow management ────────────────────────────────────────────────

  function updateTabOverflow() {
    if (!tabNavTabs || !tabMoreBtn) { return; }

    // Reset all tabs to visible first so we can measure them
    tabButtons.forEach(btn => btn.classList.remove('tab-hidden'));
    tabMoreBtn.style.display = 'none';

    // Measure available width and total tabs width
    const navWidth = tabNavTabs.clientWidth;
    let totalWidth = 0;
    tabButtons.forEach(btn => { totalWidth += btn.offsetWidth; });

    if (totalWidth <= navWidth) {
      // All tabs fit — no overflow needed
      renderMoreMenu([]);
      return;
    }

    // Show more button and compute its width
    tabMoreBtn.style.display = 'flex';
    const moreBtnWidth = tabMoreBtn.offsetWidth;
    const available = navWidth - moreBtnWidth;

    // Walk through tabs left-to-right to find where overflow begins
    let used = 0;
    let overflowFrom = -1;
    const widths = Array.from(tabButtons).map(btn => btn.offsetWidth);
    for (let i = 0; i < tabButtons.length; i++) {
      used += widths[i];
      if (used > available) {
        overflowFrom = i;
        break;
      }
    }

    const hidden = [];
    if (overflowFrom >= 0) {
      tabButtons.forEach((btn, i) => {
        if (i >= overflowFrom) {
          btn.classList.add('tab-hidden');
          hidden.push(btn);
        }
      });
    }

    renderMoreMenu(hidden);
    updateMoreBtnState();
  }

  function renderMoreMenu(hiddenTabs) {
    if (!tabMoreMenu) { return; }
    tabMoreMenu.innerHTML = '';
    hiddenTabs.forEach(tab => {
      const item = document.createElement('button');
      item.className = 'tab-more-item' + (tab.dataset.tab === activeTab ? ' active' : '');
      item.dataset.tab = tab.dataset.tab;
      item.innerHTML = tab.innerHTML;
      item.addEventListener('click', () => {
        tabMoreMenu.classList.remove('open');
        switchTab(tab.dataset.tab);
      });
      tabMoreMenu.appendChild(item);
    });
  }

  function updateMoreBtnState() {
    if (!tabMoreBtn || !tabMoreMenu) { return; }
    const hiddenActive = Array.from(tabButtons).some(
      btn => btn.classList.contains('tab-hidden') && btn.dataset.tab === activeTab
    );
    tabMoreBtn.classList.toggle('active', hiddenActive);
    // Refresh active state in menu items
    tabMoreMenu.querySelectorAll('.tab-more-item').forEach(item => {
      item.classList.toggle('active', item.dataset.tab === activeTab);
    });
  }

  // Toggle more menu on button click
  if (tabMoreBtn) {
    tabMoreBtn.addEventListener('click', e => {
      e.stopPropagation();
      tabMoreMenu.classList.toggle('open');
    });
  }

  // Close menu when clicking outside
  document.addEventListener('click', () => {
    if (tabMoreMenu) { tabMoreMenu.classList.remove('open'); }
  });

  // Observe tab-nav resize
  if (typeof ResizeObserver !== 'undefined' && tabNavTabs) {
    new ResizeObserver(() => { updateTabOverflow(); }).observe(tabNavTabs);
  }

  // Initial overflow calculation
  updateTabOverflow();

  function showTabLoading(tabName) {
    const loadingRow = `<tr class="tab-loading-row"><td colspan="99"><span class="tab-loading-spinner"></span>Loading...</td></tr>`;
    const loadingDiv = `<div class="tab-loading-div"><span class="tab-loading-spinner"></span>Loading...</div>`;

    switch (tabName) {
      case 'memory': {
        const usedBar = document.getElementById('memoryUsedBar');
        const availableBar = document.getElementById('memoryAvailableBar');
        const swapBar = document.getElementById('memorySwapBar');
        const usedText = document.getElementById('memoryUsedBarText');
        const availableText = document.getElementById('memoryAvailableBarText');
        const swapText = document.getElementById('memorySwapBarText');
        if (usedBar) { usedBar.style.width = '0%'; }
        if (availableBar) { availableBar.style.width = '0%'; }
        if (swapBar) { swapBar.style.width = '0%'; }
        if (usedText) { usedText.textContent = 'Loading...'; }
        if (availableText) { availableText.textContent = 'Loading...'; }
        if (swapText) { swapText.textContent = 'Loading...'; }
        break;
      }
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
      case 'ports': {
        const portsList = document.getElementById('portsList');
        if (portsList) { portsList.innerHTML = loadingRow; }
        break;
      }
      case 'users': {
        const sessionsList = document.getElementById('userSessionsList');
        const historyList = document.getElementById('loginHistoryList');
        if (sessionsList) { sessionsList.innerHTML = loadingRow; }
        if (historyList) { historyList.innerHTML = loadingRow; }
        break;
      }
      case 'services': {
        const servicesList = document.getElementById('servicesList');
        if (servicesList) { servicesList.innerHTML = loadingRow; }
        break;
      }
      case 'docker': {
        const dockerList = document.getElementById('dockerList');
        if (dockerList) { dockerList.innerHTML = loadingRow; }
        break;
      }
      case 'crontab': {
        const crontabList = document.getElementById('crontabList');
        if (crontabList) { crontabList.innerHTML = loadingRow; }
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

      case 'logDownloadStart': {
        const dlBtn = document.getElementById('logDownloadBtn');
        if (dlBtn) {
          dlBtn.disabled = true;
          dlBtn.title = 'Downloading…';
          dlBtn.querySelector('i').className = 'codicon codicon-loading codicon-modifier-spin';
        }
        break;
      }

      case 'logDownloadEnd': {
        const dlBtn = document.getElementById('logDownloadBtn');
        if (dlBtn) {
          dlBtn.disabled = false;
          dlBtn.title = 'Download full log file to local';
          dlBtn.querySelector('i').className = 'codicon codicon-cloud-download';
        }
        break;
      }

      case 'portsData':
        handlePortsData(message.data);
        break;

      case 'usersData':
        handleUsersData(message.data);
        break;

      case 'servicesData':
        handleServicesData(message.data);
        break;

      case 'dockerData':
        handleDockerData(message.data);
        break;

      case 'crontabData':
        handleCrontabData(message.data);
        break;

      case 'crontabWriteResult':
        handleCrontabWriteResult(message);
        break;

      case 'dockerLogChunk':
        handleDockerLogChunk(message.containerId, message.chunk);
        break;

      case 'dockerLogEnd':
        handleDockerLogEnd(message.containerId, message.error);
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

    updateMemoryTab(data.memory);

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

  function updateMemoryTab(memory) {
    const total = Number(memory?.total) || 0;
    const used = Number(memory?.used) || 0;
    const available = Number(memory?.available) || 0;
    const usage = Number(memory?.usage) || 0;
    const buffers = Number(memory?.buffers) || 0;
    const cached = Number(memory?.cached) || 0;
    const swapTotal = Number(memory?.swapTotal) || 0;
    const swapUsed = Number(memory?.swapUsed) || 0;
    const swapUsage = Number(memory?.swapUsage) || 0;

    const usageEl = document.getElementById('memoryTabUsage');
    const totalEl = document.getElementById('memoryTabTotal');
    const usedEl = document.getElementById('memoryTabUsed');
    const availableEl = document.getElementById('memoryTabAvailable');
    const buffersEl = document.getElementById('memoryTabBuffers');
    const cachedEl = document.getElementById('memoryTabCached');
    const swapEl = document.getElementById('memoryTabSwap');
    const healthEl = document.getElementById('memoryTabHealth');

    if (usageEl) { usageEl.textContent = `${usage.toFixed(1)}%`; }
    if (totalEl) { totalEl.textContent = `${formatBytes(total)} MB`; }
    if (usedEl) { usedEl.textContent = `${formatBytes(used)} MB`; }
    if (availableEl) { availableEl.textContent = `${formatBytes(available)} MB`; }
    if (buffersEl) { buffersEl.textContent = `${formatBytes(buffers)} MB`; }
    if (cachedEl) { cachedEl.textContent = `${formatBytes(cached)} MB`; }
    if (swapEl) { swapEl.textContent = formatSwap(memory); }

    if (healthEl) {
      let stateClass = 'state-up';
      let stateText = 'Healthy';

      if (usage >= 90) {
        stateClass = 'state-error';
        stateText = 'Critical';
      } else if (usage >= 80) {
        stateClass = 'state-unknown';
        stateText = 'Warning';
      }

      healthEl.className = `status-pill ${stateClass}`;
      healthEl.textContent = stateText;
    }

    const usedPct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
    const availablePct = total > 0 ? Math.min((available / total) * 100, 100) : 0;
    const swapPct = swapTotal > 0 ? Math.min(swapUsage, 100) : 0;

    const usedBar = document.getElementById('memoryUsedBar');
    const availableBar = document.getElementById('memoryAvailableBar');
    const swapBar = document.getElementById('memorySwapBar');
    const usedBarText = document.getElementById('memoryUsedBarText');
    const availableBarText = document.getElementById('memoryAvailableBarText');
    const swapBarText = document.getElementById('memorySwapBarText');

    if (usedBar) {
      usedBar.style.width = `${usedPct.toFixed(1)}%`;
      usedBar.className = `memory-breakdown-bar-fill ${getUsageClass(usedPct)}`;
    }
    if (availableBar) {
      availableBar.style.width = `${availablePct.toFixed(1)}%`;
      availableBar.className = 'memory-breakdown-bar-fill usage-normal';
    }
    if (swapBar) {
      swapBar.style.width = `${swapPct.toFixed(1)}%`;
      swapBar.className = `memory-breakdown-bar-fill ${getUsageClass(swapPct)}`;
    }

    if (usedBarText) { usedBarText.textContent = `${usedPct.toFixed(1)}% (${formatBytes(used)} MB)`; }
    if (availableBarText) { availableBarText.textContent = `${availablePct.toFixed(1)}% (${formatBytes(available)} MB)`; }
    if (swapBarText) {
      swapBarText.textContent = swapTotal > 0
        ? `${swapPct.toFixed(1)}% (${formatBytes(swapUsed)} / ${formatBytes(swapTotal)} MB)`
        : 'Disabled';
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
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No data — visit Processes tab to load</td></tr>';
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
        <td style="font-family: var(--vscode-editor-font-family); font-weight: 500;">${escapeHtml(proc.name)}</td>
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
    const matchCountEl = document.getElementById('processMatchCount');
    const clearBtn = document.getElementById('processClearSearch');

    if (currentProcesses.length === 0) {
      processList.innerHTML = '<tr><td colspan="11" class="empty-state">No process data available</td></tr>';
      if (matchCountEl) { matchCountEl.textContent = ''; }
      return;
    }

    // Filter
    const query = processFilterQuery.trim().toLowerCase();
    const filtered = query
      ? currentProcesses.filter(p =>
          String(p.pid).includes(query) ||
          (p.name || '').toLowerCase().includes(query) ||
          (p.user || '').toLowerCase().includes(query) ||
          (p.command || '').toLowerCase().includes(query) ||
          (p.stat || '').toLowerCase().includes(query)
        )
      : currentProcesses;

    if (matchCountEl) {
      matchCountEl.textContent = query ? `${filtered.length} / ${currentProcesses.length}` : '';
    }
    if (clearBtn) {
      clearBtn.style.display = query ? '' : 'none';
    }

    // Sort
    const numericCols = new Set(['pid', 'cpu', 'mem', 'rss', 'vsz']);
    const sorted = [...filtered].sort((a, b) => {
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
      if (filtered.length === 0) {
        processList.innerHTML = '<tr><td colspan="11" class="empty-state">No matching processes</td></tr>';
        processList.style.opacity = '1';
        return;
      }

      processList.innerHTML = '';

      sorted.forEach(proc => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${proc.pid}</td>
          <td style="font-family: var(--vscode-editor-font-family); font-weight: 500;">${escapeHtml(proc.name)}</td>
          <td>${escapeHtml(proc.user)}</td>
          <td>${escapeHtml(proc.stat)}</td>
          <td>${proc.cpu}%</td>
          <td>${proc.mem}%</td>
          <td>${formatKilobytes(proc.rss)}</td>
          <td>${formatKilobytes(proc.vsz)}</td>
          <td>${escapeHtml(proc.time)}</td>
          <td style="font-family: var(--vscode-editor-font-family);">${escapeHtml(proc.command)}</td>
          <td class="process-actions-cell">
            <div class="process-actions-wrapper">
              <button class="process-detail-btn" data-pid="${proc.pid}" title="View process details">
                <i class="codicon codicon-info"></i>
              </button>
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
    const detailBtn = e.target.closest('.process-detail-btn');
    if (detailBtn) {
      e.stopPropagation();
      closeAllKillMenus();
      showProcessDetail(Number.parseInt(detailBtn.dataset.pid));
      return;
    }
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

  function showProcessDetail(pid) {
    const proc = currentProcesses.find(p => Number(p.pid) === pid);
    if (!proc) { return; }

    const modal = document.getElementById('processDetailModal');
    const titleEl = document.getElementById('processDetailTitle');
    const body = document.getElementById('processDetailBody');

    titleEl.textContent = `${proc.name}  —  PID ${proc.pid}`;

    const fields = [
      { label: 'PID',        value: proc.pid,              mono: true },
      { label: 'Name',       value: proc.name,             mono: true },
      { label: 'User',       value: proc.user },
      { label: 'State',      value: proc.stat,             mono: true },
      { label: 'TTY',        value: proc.tty || '—',       mono: true },
      { label: 'Start Time', value: proc.start || '—',     mono: true },
      { label: 'CPU Time',   value: proc.time,             mono: true },
      { label: 'CPU %',      value: `${proc.cpu}%` },
      { label: 'Memory %',   value: `${proc.mem}%` },
      { label: 'RSS',        value: formatKilobytes(proc.rss) },
      { label: 'VSZ',        value: formatKilobytes(proc.vsz) },
    ];

    let html = '<div class="process-detail-grid">';
    for (const f of fields) {
      html += `
        <span class="process-detail-label">${escapeHtml(f.label)}</span>
        <span class="process-detail-value${f.mono ? ' mono' : ''}">${escapeHtml(String(f.value ?? '—'))}</span>`;
    }
    if (proc.command) {
      html += `
        <hr class="process-detail-divider">
        <div class="process-detail-command-block">
          <div class="process-detail-command-label">Command</div>
          <div class="process-detail-command-value">${escapeHtml(proc.command)}</div>
        </div>`;
    }
    html += '</div>';

    body.innerHTML = html;
    modal.style.display = 'flex';
  }

  function closeProcessDetail() {
    const modal = document.getElementById('processDetailModal');
    if (modal) { modal.style.display = 'none'; }
  }

  const processDetailClose = document.getElementById('processDetailClose');
  const processDetailOverlay = document.getElementById('processDetailOverlay');
  if (processDetailClose) { processDetailClose.addEventListener('click', closeProcessDetail); }
  if (processDetailOverlay) { processDetailOverlay.addEventListener('click', closeProcessDetail); }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeProcessDetail(); }
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

  // Process search input
  const processSearchInput = document.getElementById('processSearchInput');
  const processClearSearchBtn = document.getElementById('processClearSearch');
  if (processSearchInput) {
    processSearchInput.addEventListener('input', () => {
      processFilterQuery = processSearchInput.value;
      renderProcessTable();
    });
    processSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        processFilterQuery = '';
        processSearchInput.value = '';
        renderProcessTable();
      }
    });
  }
  if (processClearSearchBtn) {
    processClearSearchBtn.addEventListener('click', () => {
      processFilterQuery = '';
      if (processSearchInput) { processSearchInput.value = ''; }
      renderProcessTable();
      processSearchInput?.focus();
    });
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

  // ── Logs state ──────────────────────────────────────────────
  let currentLogLines = [];        // raw string lines from last fetch
  let logSearchQuery = '';         // current search/filter term
  let logFilterMode = 'highlight'; // 'highlight' | 'filter'
  let logAutoRefreshTimer = null;  // setInterval handle
  const LOG_AUTO_REFRESH_MS = 5000;

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
      const dlBtn = document.getElementById('logDownloadBtn');
      if (dlBtn) { dlBtn.disabled = false; }
    } else if (files && files.length > 0) {
      // Auto-select the first file and load it
      select.value = files[0];
      fetchLogContent(files[0]);
      const dlBtn = document.getElementById('logDownloadBtn');
      if (dlBtn) { dlBtn.disabled = false; }
    }
  }

  function handleLogsContent(data) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;

    currentLogLines = (data.content || '').split('\n');
    renderLogOutput(true);
  }

  function renderLogOutput(scrollToBottom) {
    const logOutput = document.getElementById('logOutput');
    if (!logOutput) { return; }

    const query = logSearchQuery.trim();
    let regex = null;
    if (query) {
      try { regex = new RegExp(query, 'gi'); } catch { /* invalid regex: treat as plain text */ }
      if (!regex) {
        const escaped = query.replaceAll(String.raw`[$*+?.|()\[\]{}\\^]`, String.raw`\$&`);
        regex = new RegExp(escaped, 'gi');
      }
    }

    logOutput.style.opacity = '0.4';
    setTimeout(() => {
      logOutput.innerHTML = '';
      let matchCount = 0;

      currentLogLines.forEach((line, idx) => {
        // Filter mode: skip non-matching lines
        if (regex && logFilterMode === 'filter' && !regex.test(line)) {
          regex.lastIndex = 0;
          return;
        }
        regex && (regex.lastIndex = 0);

        const span = document.createElement('span');
        const severity = getLogLineSeverity(line);
        const severityClass = severity ? ` ${severity}` : '';
        span.className = `log-line${severityClass}`;

        const lineNum = String(idx + 1).padStart(5, ' ');

        if (regex && query) {
          // Build highlighted content
          let highlighted = `${lineNum}  `;
          let lastIdx = 0;
          let m;
          regex.lastIndex = 0;
          while ((m = regex.exec(line)) !== null) {
            highlighted += escapeHtml(line.slice(lastIdx, m.index));
            highlighted += `<mark class="log-match">${escapeHtml(m[0])}</mark>`;
            lastIdx = m.index + m[0].length;
            matchCount++;
            if (m[0].length === 0) { regex.lastIndex++; }
          }
          highlighted += escapeHtml(line.slice(lastIdx));
          span.innerHTML = highlighted;
          if (matchCount > 0 || logFilterMode === 'filter') { span.classList.add('log-line-has-match'); }
        } else {
          span.textContent = `${lineNum}  ${line}`;
        }

        logOutput.appendChild(span);
        logOutput.appendChild(document.createTextNode('\n'));
      });

      // Update match count badge
      const matchCountEl = document.getElementById('logMatchCount');
      if (matchCountEl) {
        const matchSuffix = matchCount === 1 ? '' : 'es';
        matchCountEl.textContent = query ? `${matchCount} match${matchSuffix}` : '';
      }

      if (scrollToBottom) { logOutput.scrollTop = logOutput.scrollHeight; }
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
  const logDownloadBtn = document.getElementById('logDownloadBtn');
  if (logFileSelect) {
    logFileSelect.addEventListener('change', () => {
      if (logFileSelect.value) {
        fetchLogContent(logFileSelect.value);
        if (logDownloadBtn) { logDownloadBtn.disabled = false; }
      } else if (logDownloadBtn) {
        logDownloadBtn.disabled = true;
      }
    });
  }

  if (logDownloadBtn) {
    logDownloadBtn.addEventListener('click', () => {
      const filePath = logFileSelect?.value;
      if (filePath) { vscode.postMessage({ type: 'downloadLog', filePath }); }
    });
  }

  // Logs tab: lines selector change
  const logLinesSelect = document.getElementById('logLinesSelect');
  if (logLinesSelect) {
    logLinesSelect.addEventListener('change', () => {
      if (logFileSelect?.value) { fetchLogContent(logFileSelect.value); }
    });
  }

  // Logs tab: manual refresh button
  const logRefreshBtn = document.getElementById('logRefreshBtn');
  if (logRefreshBtn) {
    logRefreshBtn.addEventListener('click', () => {
      if (logFileSelect?.value) {
        fetchLogContent(logFileSelect.value);
      } else {
        vscode.postMessage({ type: 'refresh', tab: 'logs' });
      }
    });
  }

  // Logs tab: auto-refresh toggle
  const logAutoRefreshBtn = document.getElementById('logAutoRefreshBtn');
  if (logAutoRefreshBtn) {
    logAutoRefreshBtn.addEventListener('click', () => {
      if (logAutoRefreshTimer) {
        clearInterval(logAutoRefreshTimer);
        logAutoRefreshTimer = null;
        logAutoRefreshBtn.classList.remove('active');
        logAutoRefreshBtn.title = 'Toggle auto-refresh every 5s';
      } else {
        logAutoRefreshBtn.classList.add('active');
        logAutoRefreshBtn.title = 'Auto-refresh ON (every 5s) — click to stop';
        logAutoRefreshTimer = setInterval(() => {
          if (logFileSelect?.value && activeTab === 'logs') {
            fetchLogContent(logFileSelect.value);
          }
        }, LOG_AUTO_REFRESH_MS);
      }
    });
  }

  // Logs tab: search input (debounced)
  const logSearchInput = document.getElementById('logSearchInput');
  const logClearSearchBtn = document.getElementById('logClearSearchBtn');
  const logFilterModeBtn = document.getElementById('logFilterModeBtn');
  let logSearchDebounce = null;

  if (logSearchInput) {
    logSearchInput.addEventListener('input', () => {
      logSearchQuery = logSearchInput.value;
      if (logClearSearchBtn) { logClearSearchBtn.style.display = logSearchQuery ? 'flex' : 'none'; }
      clearTimeout(logSearchDebounce);
      logSearchDebounce = setTimeout(() => renderLogOutput(false), 180);
    });
  }

  if (logClearSearchBtn) {
    logClearSearchBtn.addEventListener('click', () => {
      logSearchQuery = '';
      if (logSearchInput) { logSearchInput.value = ''; }
      logClearSearchBtn.style.display = 'none';
      const matchCountEl = document.getElementById('logMatchCount');
      if (matchCountEl) { matchCountEl.textContent = ''; }
      renderLogOutput(false);
    });
  }

  if (logFilterModeBtn) {
    logFilterModeBtn.addEventListener('click', () => {
      logFilterMode = logFilterMode === 'highlight' ? 'filter' : 'highlight';
      logFilterModeBtn.textContent = logFilterMode === 'highlight' ? 'Highlight' : 'Filter';
      logFilterModeBtn.classList.toggle('active', logFilterMode === 'filter');
      renderLogOutput(false);
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

  // ── Ports Tab ────────────────────────────────────────────────
  let currentPorts = [];
  let portsSortColumn = 'localPort';
  let portsSortDir = 'asc';

  function handlePortsData(ports) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;
    currentPorts = ports || [];
    renderPortsTable();
  }

  function renderPortsTable() {
    const tbody = document.getElementById('portsList');
    if (!tbody) { return; }

    if (currentPorts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No listening ports found</td></tr>';
      return;
    }

    const numericCols = new Set(['localPort', 'pid']);
    const sorted = [...currentPorts].sort((a, b) => {
      let aVal = a[portsSortColumn];
      let bVal = b[portsSortColumn];
      if (numericCols.has(portsSortColumn)) {
        aVal = Number(aVal) || 0;
        bVal = Number(bVal) || 0;
      } else {
        aVal = String(aVal || '').toLowerCase();
        bVal = String(bVal || '').toLowerCase();
      }
      if (aVal < bVal) { return portsSortDir === 'asc' ? -1 : 1; }
      if (aVal > bVal) { return portsSortDir === 'asc' ? 1 : -1; }
      return 0;
    });

    document.querySelectorAll('.ports-table th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === portsSortColumn) {
        th.classList.add(portsSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    tbody.innerHTML = '';
    sorted.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="port-number">${p.localPort}</span></td>
        <td><span class="proto-badge proto-${escapeHtml(p.proto)}">${escapeHtml(p.proto)}</span></td>
        <td><code>${escapeHtml(p.localAddress || '*')}</code></td>
        <td>${p.processName ? escapeHtml(p.processName) : '<span class="empty-state-inline">—</span>'}</td>
        <td>${p.pid != null ? p.pid : '<span class="empty-state-inline">—</span>'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.querySelectorAll('.ports-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (portsSortColumn === col) {
        portsSortDir = portsSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        portsSortColumn = col;
        portsSortDir = col === 'localPort' || col === 'pid' ? 'asc' : 'asc';
      }
      renderPortsTable();
    });
  });

  // ── Users Tab ────────────────────────────────────────────────
  function handleUsersData(data) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;
    renderUserSessions(data.sessions || []);
    renderLoginHistory(data.history || []);
  }

  function renderUserSessions(sessions) {
    const tbody = document.getElementById('userSessionsList');
    if (!tbody) { return; }
    if (sessions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No active sessions</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    sessions.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(s.user)}</strong></td>
        <td><code>${escapeHtml(s.tty)}</code></td>
        <td>${escapeHtml(s.from || '—')}</td>
        <td>${escapeHtml(s.loginTime || '—')}</td>
        <td>${escapeHtml(s.idle || '—')}</td>
        <td style="font-family: var(--vscode-editor-font-family);">${escapeHtml(s.what || '—')}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderLoginHistory(history) {
    const tbody = document.getElementById('loginHistoryList');
    if (!tbody) { return; }
    if (history.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No login history available</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    history.forEach(h => {
      const tr = document.createElement('tr');
      const isActive = (h.logoutTime || '').toLowerCase().includes('still logged in');
      const statusClass = isActive ? 'state-up' : '';
      tr.innerHTML = `
        <td><strong>${escapeHtml(h.user)}</strong></td>
        <td><code>${escapeHtml(h.tty)}</code></td>
        <td>${escapeHtml(h.from || '—')}</td>
        <td>${escapeHtml(h.loginTime || '—')}</td>
        <td><span class="${statusClass}">${escapeHtml(h.logoutTime || '—')}</span></td>
        <td>${escapeHtml(h.duration || '—')}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ── Services Tab ─────────────────────────────────────────────
  let currentServices = [];
  let servicesSortColumn = 'unit';
  let servicesSortDir = 'asc';
  let servicesFilterQuery = '';

  function handleServicesData(services) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;
    currentServices = services || [];
    renderServicesTable();
  }

  function renderServicesTable() {
    const tbody = document.getElementById('servicesList');
    if (!tbody) { return; }

    if (currentServices.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No systemd services found (systemd may not be available)</td></tr>';
      return;
    }

    const query = servicesFilterQuery.trim().toLowerCase();
    const filtered = query
      ? currentServices.filter(s =>
          s.unit.toLowerCase().includes(query) ||
          (s.description || '').toLowerCase().includes(query) ||
          s.sub.toLowerCase().includes(query)
        )
      : currentServices;

    const sorted = [...filtered].sort((a, b) => {
      let aVal = String(a[servicesSortColumn] || '').toLowerCase();
      let bVal = String(b[servicesSortColumn] || '').toLowerCase();
      if (aVal < bVal) { return servicesSortDir === 'asc' ? -1 : 1; }
      if (aVal > bVal) { return servicesSortDir === 'asc' ? 1 : -1; }
      return 0;
    });

    document.querySelectorAll('.services-table th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === servicesSortColumn) {
        th.classList.add(servicesSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    tbody.innerHTML = '';
    sorted.forEach(svc => {
      const isRunning = svc.sub === 'running';
      const isFailed = svc.sub === 'failed' || svc.active === 'failed';
      const stateClass = isFailed ? 'state-error' : isRunning ? 'state-up' : 'state-unknown';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family: var(--vscode-editor-font-family);">${escapeHtml(svc.unit.replace('.service', ''))}<span style="opacity:0.5">.service</span></td>
        <td><span class="status-pill ${stateClass}">${escapeHtml(svc.active)}</span></td>
        <td>${escapeHtml(svc.sub)}</td>
        <td>${escapeHtml(svc.load)}</td>
        <td style="color: var(--vscode-descriptionForeground);">${escapeHtml(svc.description || '')}</td>
        <td class="service-actions-cell">
          <button class="service-action-btn" data-unit="${escapeHtml(svc.unit)}" data-action="start" title="Start" ${isRunning ? 'disabled' : ''}>
            <i class="codicon codicon-play"></i>
          </button>
          <button class="service-action-btn" data-unit="${escapeHtml(svc.unit)}" data-action="stop" title="Stop" ${!isRunning ? 'disabled' : ''}>
            <i class="codicon codicon-debug-stop"></i>
          </button>
          <button class="service-action-btn" data-unit="${escapeHtml(svc.unit)}" data-action="restart" title="Restart">
            <i class="codicon codicon-debug-restart"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.querySelectorAll('.services-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (servicesSortColumn === col) {
        servicesSortDir = servicesSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        servicesSortColumn = col;
        servicesSortDir = 'asc';
      }
      renderServicesTable();
    });
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.service-action-btn');
    if (!btn || btn.disabled) { return; }
    const unit = btn.dataset.unit;
    const action = btn.dataset.action;
    if (unit && action) {
      vscode.postMessage({ type: 'serviceControl', unit, action });
    }
  });

  const servicesFilterInput = document.getElementById('servicesFilter');
  if (servicesFilterInput) {
    servicesFilterInput.addEventListener('input', () => {
      servicesFilterQuery = servicesFilterInput.value;
      renderServicesTable();
    });
  }

  // ── Docker Tab ───────────────────────────────────────────────
  let currentContainers = [];
  let dockerSortColumn = 'state';
  let dockerSortDir = 'asc';

  function handleDockerData(containers) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;
    currentContainers = containers || [];

    const unavailableEl = document.getElementById('dockerUnavailable');
    const tableEl = document.getElementById('dockerTable');
    if (unavailableEl && tableEl) {
      const isUnavailable = currentContainers.length === 0;
      // Cannot distinguish "unavailable" from "no containers" without a flag from backend
      // The backend returns [] for both cases; show a helpful empty state
      unavailableEl.style.display = 'none';
      tableEl.style.display = '';
    }
    renderDockerTable();
  }

  function renderDockerTable() {
    const tbody = document.getElementById('dockerList');
    if (!tbody) { return; }

    if (currentContainers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No containers found or Docker is not available</td></tr>';
      return;
    }

    const numericCols = new Set(['cpuPercent', 'memPercent', 'memUsage', 'netIn', 'netOut']);
    const sorted = [...currentContainers].sort((a, b) => {
      let aVal = a[dockerSortColumn];
      let bVal = b[dockerSortColumn];
      if (numericCols.has(dockerSortColumn)) {
        aVal = Number(aVal) || 0;
        bVal = Number(bVal) || 0;
      } else {
        aVal = String(aVal || '').toLowerCase();
        bVal = String(bVal || '').toLowerCase();
      }
      if (aVal < bVal) { return dockerSortDir === 'asc' ? -1 : 1; }
      if (aVal > bVal) { return dockerSortDir === 'asc' ? 1 : -1; }
      return 0;
    });

    document.querySelectorAll('.docker-table th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === dockerSortColumn) {
        th.classList.add(dockerSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    tbody.innerHTML = '';
    sorted.forEach(c => {
      const isRunning = c.state === 'running';
      const stateClass = isRunning ? 'state-up' : c.state === 'exited' ? 'state-error' : 'state-unknown';
      const cpuStr = c.cpuPercent != null ? `${c.cpuPercent.toFixed(1)}%` : '—';
      const memStr = c.memPercent != null ? `${c.memPercent.toFixed(1)}%` : '—';
      const netStr = (c.netIn != null && c.netOut != null)
        ? `↓${formatBytesSize(c.netIn)} / ↑${formatBytesSize(c.netOut)}`
        : '—';
      const tr = document.createElement('tr');
      tr.dataset.containerId = c.id;
      tr.style.cursor = 'pointer';
      tr.title = 'Click to view live logs';
      tr.innerHTML = `
        <td><code style="font-size:11px">${escapeHtml(c.id.slice(0, 12))}</code></td>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td style="font-family: var(--vscode-editor-font-family); font-size:11px;">${escapeHtml(c.image)}</td>
        <td><span class="status-pill ${stateClass}">${escapeHtml(c.state)}</span></td>
        <td style="color: var(--vscode-descriptionForeground); font-size:11px;">${escapeHtml(c.status)}</td>
        <td>${cpuStr}</td>
        <td>${memStr}</td>
        <td style="font-size:11px;">${netStr}</td>
        <td style="font-size:11px; color: var(--vscode-descriptionForeground);">${escapeHtml(c.ports || '—')}</td>
      `;
      tr.addEventListener('click', () => openDockerLogModal(c));
      tbody.appendChild(tr);
    });
  }

  // ── Docker Log Modal ─────────────────────────────────────────────────────

  let activeLogContainerId = null;

  const dockerLogModal = document.getElementById('dockerLogModal');
  const dockerLogOverlay = document.getElementById('dockerLogOverlay');
  const dockerLogContent = document.getElementById('dockerLogContent');
  const dockerLogTitle = document.getElementById('dockerLogTitle');
  const dockerLogStatus = document.getElementById('dockerLogStatus');
  const dockerLogClose = document.getElementById('dockerLogClose');
  const dockerLogClear = document.getElementById('dockerLogClear');
  const dockerLogAutoScroll = document.getElementById('dockerLogAutoScroll');

  function openDockerLogModal(container) {
    // Stop any existing stream first
    if (activeLogContainerId) {
      vscode.postMessage({ type: 'stopDockerLogs', containerId: activeLogContainerId });
    }
    activeLogContainerId = container.id;
    if (dockerLogTitle) { dockerLogTitle.textContent = `Logs — ${container.name} (${container.id.slice(0, 12)})`; }
    if (dockerLogContent) { dockerLogContent.textContent = ''; }
    if (dockerLogStatus) { dockerLogStatus.textContent = 'Connecting…'; }
    if (dockerLogModal) { dockerLogModal.style.display = ''; }
    vscode.postMessage({ type: 'dockerLogs', containerId: container.id });
  }

  function closeDockerLogModal() {
    if (activeLogContainerId) {
      vscode.postMessage({ type: 'stopDockerLogs', containerId: activeLogContainerId });
      activeLogContainerId = null;
    }
    if (dockerLogModal) { dockerLogModal.style.display = 'none'; }
    if (dockerLogContent) { dockerLogContent.textContent = ''; }
    if (dockerLogStatus) { dockerLogStatus.textContent = ''; }
  }

  if (dockerLogClose) { dockerLogClose.addEventListener('click', closeDockerLogModal); }
  if (dockerLogOverlay) { dockerLogOverlay.addEventListener('click', closeDockerLogModal); }
  if (dockerLogClear) { dockerLogClear.addEventListener('click', () => { if (dockerLogContent) { dockerLogContent.textContent = ''; } }); }

  // Handle incoming Docker log messages (registered below in message listener)
  function handleDockerLogChunk(containerId, chunk) {
    if (containerId !== activeLogContainerId) { return; }
    if (!dockerLogContent) { return; }
    if (dockerLogStatus) { dockerLogStatus.textContent = 'Streaming…'; }
    // Append chunk text (already includes timestamps from `docker logs --timestamps`)
    dockerLogContent.appendChild(document.createTextNode(chunk));
    // Auto-scroll to bottom
    if (dockerLogAutoScroll && dockerLogAutoScroll.checked) {
      dockerLogContent.scrollTop = dockerLogContent.scrollHeight;
    }
  }

  function handleDockerLogEnd(containerId, error) {
    if (containerId !== activeLogContainerId) { return; }
    if (dockerLogStatus) {
      dockerLogStatus.textContent = error ? `Error: ${error}` : 'Stream ended.';
    }
  }

  document.querySelectorAll('.docker-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (dockerSortColumn === col) {
        dockerSortDir = dockerSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        dockerSortColumn = col;
        dockerSortDir = col === 'cpuPercent' || col === 'memPercent' ? 'desc' : 'asc';
      }
      renderDockerTable();
    });
  });

  // ── Crontab Tab ──────────────────────────────────────────────────────────
  let currentCrontabEntries = [];
  let crontabSortColumn = 'source';
  let crontabSortDir = 'asc';

  function handleCrontabData(entries) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;
    currentCrontabEntries = entries || [];
    renderCrontabTable();
  }

  function renderCrontabTable() {
    const tbody = document.getElementById('crontabList');
    if (!tbody) { return; }

    if (currentCrontabEntries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No cron jobs found</td></tr>';
      return;
    }

    const sorted = [...currentCrontabEntries].map((e, i) => ({ ...e, _idx: i })).sort((a, b) => {
      let aVal = String(a[crontabSortColumn] || '').toLowerCase();
      let bVal = String(b[crontabSortColumn] || '').toLowerCase();
      if (aVal < bVal) { return crontabSortDir === 'asc' ? -1 : 1; }
      if (aVal > bVal) { return crontabSortDir === 'asc' ? 1 : -1; }
      return 0;
    });

    document.querySelectorAll('.crontab-table th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === crontabSortColumn) {
        th.classList.add(crontabSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    tbody.innerHTML = '';
    sorted.forEach(entry => {
      const isUserEntry = entry.source === 'user' && !entry.isEnvVar;
      const tr = document.createElement('tr');
      tr.dataset.idx = String(entry._idx);
      if (entry.isEnvVar) {
        tr.innerHTML = `
          <td><code style="font-size:11px;">${escapeHtml(entry.source)}</code></td>
          <td><span class="crontab-env-badge">ENV</span></td>
          <td><span class="empty-state-inline">—</span></td>
          <td style="font-family: var(--vscode-editor-font-family); font-size:11px;">${escapeHtml(entry.command)}</td>
          <td></td>
        `;
      } else {
        const schedule = entry.minute.startsWith('@')
          ? `<code class="crontab-schedule">${escapeHtml(entry.minute)}</code>`
          : `<code class="crontab-schedule">${escapeHtml([entry.minute, entry.hour, entry.dayOfMonth, entry.month, entry.dayOfWeek].join(' '))}</code>`;
        const actions = isUserEntry
          ? `<div class="crontab-actions-cell">
               <button class="crontab-action-btn crontab-edit-btn" title="Edit">
                 <i class="codicon codicon-edit"></i>
               </button>
               <button class="crontab-action-btn crontab-delete-btn" title="Delete">
                 <i class="codicon codicon-trash"></i>
               </button>
             </div>`
          : '<span class="empty-state-inline" title="Read-only system entry">—</span>';
        tr.innerHTML = `
          <td><code style="font-size:11px;">${escapeHtml(entry.source)}</code></td>
          <td>${schedule}</td>
          <td>${entry.user ? escapeHtml(entry.user) : '<span class="empty-state-inline">—</span>'}</td>
          <td style="font-family: var(--vscode-editor-font-family); font-size:11px;">${escapeHtml(entry.command)}</td>
          <td>${actions}</td>
        `;
      }
      tbody.appendChild(tr);
    });
  }

  document.querySelectorAll('.crontab-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (crontabSortColumn === col) {
        crontabSortDir = crontabSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        crontabSortColumn = col;
        crontabSortDir = 'asc';
      }
      renderCrontabTable();
    });
  });

  // ── Crontab CRUD ───────────────────────────────────────────────────
  let crontabEditIndex = -1; // -1 = new, >= 0 = index in currentCrontabEntries

  const crontabModal = document.getElementById('crontabModal');
  const crontabModalOverlay = document.getElementById('crontabModalOverlay');
  const crontabModalClose = document.getElementById('crontabModalClose');
  const crontabModalCancel = document.getElementById('crontabModalCancel');
  const crontabModalSave = document.getElementById('crontabModalSave');
  const crontabModalTitle = document.getElementById('crontabModalTitle');
  const crontabModalError = document.getElementById('crontabModalError');

  function openCrontabModal(entry, editIndex) {
    crontabEditIndex = editIndex != null ? editIndex : -1;
    if (crontabModalTitle) {
      crontabModalTitle.textContent = crontabEditIndex >= 0 ? 'Edit Cron Job' : 'Add Cron Job';
    }
    // Build schedule string
    let schedule = '* * * * *';
    if (entry) {
      if (entry.minute && entry.minute.startsWith('@')) {
        schedule = entry.minute;
      } else if (entry.minute) {
        schedule = [entry.minute, entry.hour, entry.dayOfMonth, entry.month, entry.dayOfWeek].join(' ');
      }
    }
    const schedInput = document.getElementById('crontabScheduleInput');
    const cmdInput = document.getElementById('crontabCommandInput');
    if (schedInput) { schedInput.value = schedule; }
    if (cmdInput) { cmdInput.value = entry?.command || ''; }
    if (crontabModalError) { crontabModalError.style.display = 'none'; }
    if (crontabModal) { crontabModal.style.display = 'flex'; }
    setTimeout(() => { if (schedInput) { schedInput.focus(); } }, 50);
  }

  function closeCrontabModal() {
    if (crontabModal) { crontabModal.style.display = 'none'; }
  }

  if (crontabModalClose) { crontabModalClose.addEventListener('click', closeCrontabModal); }
  if (crontabModalCancel) { crontabModalCancel.addEventListener('click', closeCrontabModal); }
  if (crontabModalOverlay) { crontabModalOverlay.addEventListener('click', closeCrontabModal); }

  const crontabAddBtn = document.getElementById('crontabAddBtn');
  if (crontabAddBtn) {
    crontabAddBtn.addEventListener('click', () => openCrontabModal(null, -1));
  }

  // Preset buttons click (delegated, inside modal)
  document.addEventListener('click', e => {
    const presetBtn = e.target.closest('.crontab-preset-btn');
    if (presetBtn) {
      const preset = presetBtn.dataset.preset;
      const schedInput = document.getElementById('crontabScheduleInput');
      if (schedInput) { schedInput.value = preset; schedInput.focus(); }
      return;
    }

    // Edit button in crontab table row
    const editBtn = e.target.closest('.crontab-edit-btn');
    if (editBtn) {
      const tr = editBtn.closest('tr');
      const idx = tr ? parseInt(tr.dataset.idx, 10) : -1;
      if (idx >= 0 && currentCrontabEntries[idx]) {
        openCrontabModal(currentCrontabEntries[idx], idx);
      }
      return;
    }

    // Delete button in crontab table row
    const deleteBtn = e.target.closest('.crontab-delete-btn');
    if (deleteBtn) {
      const tr = deleteBtn.closest('tr');
      const idx = tr ? parseInt(tr.dataset.idx, 10) : -1;
      if (idx >= 0 && currentCrontabEntries[idx]?.source === 'user') {
        const entry = currentCrontabEntries[idx];
        // Build updated user entries without the deleted one (sent along for provider to write)
        const updatedUserEntries = currentCrontabEntries.filter((e, i) =>
          i !== idx && e.source === 'user'
        );
        // Route through provider for VS Code confirmation dialog
        vscode.postMessage({ type: 'crontabDeleteRequest', entries: updatedUserEntries, command: entry.command });
      }
    }
  });

  // Validate and save crontab
  if (crontabModalSave) {
    crontabModalSave.addEventListener('click', () => {
      const schedInput = document.getElementById('crontabScheduleInput');
      const cmdInput = document.getElementById('crontabCommandInput');
      const schedStr = schedInput?.value.trim() || '';
      const command = cmdInput?.value.trim() || '';

      if (!schedStr) { showCrontabError('Schedule expression cannot be empty'); return; }
      if (!command) { showCrontabError('Command cannot be empty'); return; }

      const cronFieldPattern = /^[\d*/,\-]+$/;
      let minute, hour, dayOfMonth, month, dayOfWeek;

      if (schedStr.startsWith('@')) {
        const allowed = /^@(reboot|hourly|daily|weekly|monthly|yearly|annually|midnight)$/;
        if (!allowed.test(schedStr)) {
          showCrontabError(`Unknown special expression: ${schedStr}`);
          return;
        }
        minute = schedStr;
        hour = dayOfMonth = month = dayOfWeek = '';
      } else {
        const parts = schedStr.split(/\s+/);
        if (parts.length !== 5) { showCrontabError('Schedule must have 5 fields: min hour day month weekday'); return; }
        [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
        if (!cronFieldPattern.test(minute)) { showCrontabError('Invalid minute field'); return; }
        if (!cronFieldPattern.test(hour)) { showCrontabError('Invalid hour field'); return; }
        if (!cronFieldPattern.test(dayOfMonth)) { showCrontabError('Invalid day field'); return; }
        if (!cronFieldPattern.test(month)) { showCrontabError('Invalid month field'); return; }
        if (!cronFieldPattern.test(dayOfWeek)) { showCrontabError('Invalid weekday field'); return; }
      }

      const newEntry = { source: 'user', minute, hour, dayOfMonth, month, dayOfWeek, command };

      // Build updated user entries
      const userEntries = currentCrontabEntries.filter(e => e.source === 'user');
      let updatedUserEntries;
      if (crontabEditIndex >= 0) {
        // Replace the entry at the original index
        let userCount = 0;
        updatedUserEntries = userEntries.map(e => {
          // Find user entry that corresponds to crontabEditIndex in full array
          const fullIdx = currentCrontabEntries.indexOf(e);
          if (fullIdx === crontabEditIndex) { return newEntry; }
          return e;
        });
      } else {
        updatedUserEntries = [...userEntries, newEntry];
      }

      if (crontabModalSave) { crontabModalSave.disabled = true; }
      vscode.postMessage({ type: 'crontabWrite', entries: updatedUserEntries });
      closeCrontabModal();
    });
  }

  function showCrontabError(msg) {
    if (crontabModalError) {
      crontabModalError.textContent = msg;
      crontabModalError.style.display = 'block';
    }
  }

  function handleCrontabWriteResult(result) {
    if (crontabModalSave) { crontabModalSave.disabled = false; }
    if (result.success) {
      // Explicitly request fresh crontab data so the list always updates
      requestTabData('crontab');
    } else if (result.error) {
      // Show error banner above the table
      const errBanner = document.createElement('div');
      errBanner.className = 'crontab-write-error-banner';
      errBanner.textContent = `\u274C Crontab write failed: ${result.error}`;
      const section = document.querySelector('#crontabTab .section-content');
      if (section) {
        section.prepend(errBanner);
        setTimeout(() => errBanner.remove(), 6000);
      }
    }
  }

})();
