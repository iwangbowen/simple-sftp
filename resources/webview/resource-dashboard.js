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
        const dockerImagesList = document.getElementById('dockerImagesList');
        const dockerVolumesList = document.getElementById('dockerVolumesList');
        const dockerNetworksList = document.getElementById('dockerNetworksList');
        const dockerComposeList = document.getElementById('dockerComposeList');
        if (dockerList) { dockerList.innerHTML = loadingRow; }
        if (dockerImagesList) { dockerImagesList.innerHTML = loadingRow; }
        if (dockerVolumesList) { dockerVolumesList.innerHTML = loadingRow; }
        if (dockerNetworksList) { dockerNetworksList.innerHTML = loadingRow; }
        if (dockerComposeList) { dockerComposeList.innerHTML = loadingRow; }
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

  const openFileBrowserBtn = document.getElementById('openFileBrowserBtn');
  openFileBrowserBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openFileBrowser' });
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

      case 'serviceStatusData':
        handleServiceStatusData(message);
        break;

      case 'serviceLogChunk':
        handleServiceLogChunk(message.unit, message.chunk);
        break;

      case 'serviceLogEnd':
        handleServiceLogEnd(message.unit, message.error);
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

      case 'crontabDeleteConfirmed':
        handleCrontabDeleteConfirmed();
        break;

      case 'dockerLogChunk':
        handleDockerLogChunk(message.containerId, message.chunk);
        break;

      case 'dockerLogEnd':
        handleDockerLogEnd(message.containerId, message.error);
        break;

      case 'dockerInspectData':
        handleDockerInspectData(message);
        break;

      case 'dockerComposeServicesData':
        handleDockerComposeServicesData(message);
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

  function formatLoginTime(raw) {
    if (!raw) { return '—'; }
    const d = new Date(raw);
    // If the backend normalized it to ISO, format consistently; otherwise show raw
    return Number.isNaN(d.getTime()) ? escapeHtml(raw) : formatTimestamp(raw);
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
  let logSilentRefresh = false;    // true when auto-refresh should not flicker
  const LOG_AUTO_REFRESH_MS = 5000;
  let allLogFiles = [];            // all available log file paths
  let selectedLogFile = null;      // currently selected log file path
  let focusedItemIndex = -1;       // keyboard-navigated item index (-1 = none)
  let logMatchElements = [];       // all <mark> elements from last render
  let logCurrentMatchIndex = -1;   // active match index (-1 = none)

  function setSelectedLogFile(filePath, fetchContent) {
    selectedLogFile = filePath;
    const label = document.getElementById('logFileSelectLabel');
    if (label) {
      if (filePath) {
        label.textContent = filePath.split('/').pop() || filePath;
        label.title = filePath;
        label.classList.remove('placeholder');
      } else {
        label.textContent = allLogFiles.length === 0 ? 'No readable log files found in /var/log' : '-- Select a log file --';
        label.title = '';
        label.classList.add('placeholder');
      }
    }
    const dlBtn = document.getElementById('logDownloadBtn');
    if (dlBtn) { dlBtn.disabled = !filePath; }
    if (fetchContent && filePath) { fetchLogContent(filePath); }
  }

  function updateFocusedItem(newIndex) {
    const list = document.getElementById('logFileSelectList');
    if (!list) { return; }
    const items = list.querySelectorAll('.log-file-select-item');
    focusedItemIndex = Math.max(-1, Math.min(newIndex, items.length - 1));
    items.forEach((item, i) => { item.classList.toggle('focused', i === focusedItemIndex); });
    if (focusedItemIndex >= 0 && items[focusedItemIndex]) {
      items[focusedItemIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  function renderLogFileList(filter) {
    const list = document.getElementById('logFileSelectList');
    if (!list) { return; }
    list.innerHTML = '';
    focusedItemIndex = -1;
    const f = (filter || '').toLowerCase().trim();
    const filtered = f ? allLogFiles.filter(fp => fp.toLowerCase().includes(f)) : allLogFiles;
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'log-file-select-empty';
      empty.textContent = f ? 'No matching files' : 'No readable log files found in /var/log';
      list.appendChild(empty);
      return;
    }
    filtered.forEach((fp, idx) => {
      const item = document.createElement('div');
      item.className = 'log-file-select-item' + (fp === selectedLogFile ? ' selected' : '');
      item.textContent = fp;
      item.title = fp;
      item.dataset.fp = fp;
      item.addEventListener('mousemove', () => { updateFocusedItem(idx); });
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        closeLogFileDropdown();
        if (fp !== selectedLogFile) {
          setSelectedLogFile(fp, true);
        }
      });
      list.appendChild(item);
    });
  }

  function openLogFileDropdown() {
    const dropdown = document.getElementById('logFileSelectDropdown');
    const wrapper = document.getElementById('logFileSelectWrapper');
    const searchInput = document.getElementById('logFileSelectSearch');
    if (!dropdown || !wrapper) { return; }
    // Position as fixed so it never affects document scroll width
    const rect = wrapper.getBoundingClientRect();
    const dropdownMinWidth = Math.max(rect.width, 320);
    let dropdownLeft = rect.left;
    // Flip to right-align when the panel would overflow the viewport right edge
    if (dropdownLeft + dropdownMinWidth > window.innerWidth - 4) {
      dropdownLeft = rect.right - dropdownMinWidth;
      if (dropdownLeft < 4) { dropdownLeft = 4; }
    }
    dropdown.style.top = rect.bottom + 'px';
    dropdown.style.left = dropdownLeft + 'px';
    dropdown.style.minWidth = dropdownMinWidth + 'px';
    dropdown.style.display = 'flex';
    wrapper.classList.add('open');
    if (searchInput) {
      searchInput.value = '';
      renderLogFileList('');
      searchInput.focus();
      setTimeout(() => {
        const selected = dropdown.querySelector('.log-file-select-item.selected');
        if (selected) { selected.scrollIntoView({ block: 'nearest' }); }
      }, 0);
    }
  }

  function closeLogFileDropdown() {
    const dropdown = document.getElementById('logFileSelectDropdown');
    const wrapper = document.getElementById('logFileSelectWrapper');
    if (!dropdown || !wrapper) { return; }
    dropdown.style.display = 'none';
    wrapper.classList.remove('open');
    focusedItemIndex = -1;
  }

  function handleLogsFiles(files) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;

    const prevValue = selectedLogFile;
    allLogFiles = files || [];

    if (allLogFiles.length > 0) {
      if (prevValue && allLogFiles.includes(prevValue)) {
        setSelectedLogFile(prevValue, false);
      } else {
        setSelectedLogFile(allLogFiles[0], true);
      }
    } else {
      setSelectedLogFile(null, false);
    }
  }

  function handleLogsContent(data) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;

    const newLines = (data.content || '').split('\n');
    // Silent refresh: skip full re-render if content is identical
    if (logSilentRefresh && newLines.join('\n') === currentLogLines.join('\n')) {
      logSilentRefresh = false;
      return;
    }
    const wasSilent = logSilentRefresh;
    logSilentRefresh = false;
    currentLogLines = newLines;
    renderLogOutput(!wasSilent, wasSilent);
  }

  function renderLogOutput(scrollToBottom, silent = false) {
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

    // Preserve scroll position for silent (auto-)refresh
    const prevScrollTop = silent ? logOutput.scrollTop : null;
    const prevScrollHeight = silent ? logOutput.scrollHeight : null;
    const wasAtBottom = !silent ? false
      : (logOutput.scrollHeight - logOutput.scrollTop - logOutput.clientHeight) < 40;

    // Only animate opacity for real data loads (scrollToBottom=true), not for client-side search/filter re-renders
    const needsAnimation = !silent && scrollToBottom;
    if (needsAnimation) { logOutput.style.opacity = '0.4'; }
    const doRender = () => {
      const frag = document.createDocumentFragment();
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

        frag.appendChild(span);
        frag.appendChild(document.createTextNode('\n'));
      });

      logOutput.innerHTML = '';
      logOutput.appendChild(frag);

      // Collect all match elements and reset active index
      logMatchElements = Array.from(logOutput.querySelectorAll('mark.log-match'));
      logCurrentMatchIndex = -1;
      updateLogMatchBadge();

      if (scrollToBottom) {
        logOutput.scrollTop = logOutput.scrollHeight;
      } else if (silent) {
        if (wasAtBottom) {
          // Was at bottom → follow new content
          logOutput.scrollTop = logOutput.scrollHeight;
        } else {
          // Preserve relative scroll position
          const newScrollHeight = logOutput.scrollHeight;
          logOutput.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
      }

      if (!needsAnimation) { logOutput.style.opacity = '1'; }
    };

    if (silent || !needsAnimation) {
      doRender();
    } else {
      setTimeout(doRender, 80);
    }
  }

  function updateLogMatchBadge() {
    const matchCountEl = document.getElementById('logMatchCount');
    if (!matchCountEl) { return; }
    if (!logSearchQuery.trim()) { matchCountEl.textContent = ''; return; }
    const total = logMatchElements.length;
    if (total === 0) { matchCountEl.textContent = 'No matches'; return; }
    if (logCurrentMatchIndex >= 0) {
      matchCountEl.textContent = `${logCurrentMatchIndex + 1}/${total}`;
    } else {
      matchCountEl.textContent = `${total} match${total === 1 ? '' : 'es'}`;
    }
  }

  function navigateLogMatch(direction) {
    if (logMatchElements.length === 0) { return; }
    if (logCurrentMatchIndex >= 0) {
      logMatchElements[logCurrentMatchIndex].classList.remove('log-match-active');
    }
    logCurrentMatchIndex = (logCurrentMatchIndex + direction + logMatchElements.length) % logMatchElements.length;
    const active = logMatchElements[logCurrentMatchIndex];
    active.classList.add('log-match-active');
    active.scrollIntoView({ block: 'center', behavior: 'instant' });
    updateLogMatchBadge();
  }

  function getLogLineSeverity(line) {
    const lower = line.toLowerCase();
    if (/error|fail|critical|crit|emerg|alert/.test(lower)) { return 'log-line-error'; }
    if (/warn/.test(lower)) { return 'log-line-warn'; }
    if (/info|notice/.test(lower)) { return 'log-line-info'; }
    return '';
  }

  function fetchLogContent(filePath, silent = false) {
    const linesSelect = document.getElementById('logLinesSelect');
    const lines = linesSelect ? Number.parseInt(linesSelect.value, 10) : 200;
    logSilentRefresh = silent;
    if (!silent) {
      const logOutput = document.getElementById('logOutput');
      if (logOutput) { logOutput.innerHTML = '<span class="log-loading">Loading…</span>'; }
    }
    vscode.postMessage({ type: 'fetchLogs', filePath, lines });
  }

  // Logs tab: custom searchable file selector
  const logFileSelectTrigger = document.getElementById('logFileSelectTrigger');
  if (logFileSelectTrigger) {
    logFileSelectTrigger.addEventListener('click', () => {
      const dropdown = document.getElementById('logFileSelectDropdown');
      if (dropdown && dropdown.style.display !== 'none') {
        closeLogFileDropdown();
      } else {
        openLogFileDropdown();
      }
    });
    logFileSelectTrigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLogFileDropdown();
      } else if (e.key === 'Escape') {
        closeLogFileDropdown();
      }
    });
  }

  const logFileSelectSearch = document.getElementById('logFileSelectSearch');
  if (logFileSelectSearch) {
    logFileSelectSearch.addEventListener('input', () => {
      renderLogFileList(logFileSelectSearch.value);
    });
    logFileSelectSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeLogFileDropdown();
        logFileSelectTrigger?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        updateFocusedItem(focusedItemIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        updateFocusedItem(focusedItemIndex - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const list = document.getElementById('logFileSelectList');
        if (list && focusedItemIndex >= 0) {
          const items = list.querySelectorAll('.log-file-select-item');
          const focused = items[focusedItemIndex];
          if (focused && focused.dataset.fp) {
            const fp = focused.dataset.fp;
            closeLogFileDropdown();
            if (fp !== selectedLogFile) { setSelectedLogFile(fp, true); }
          }
        }
      }
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('mousedown', (e) => {
    const wrapper = document.getElementById('logFileSelectWrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      closeLogFileDropdown();
    }
  });

  const logDownloadBtn = document.getElementById('logDownloadBtn');
  if (logDownloadBtn) {
    logDownloadBtn.addEventListener('click', () => {
      if (selectedLogFile) { vscode.postMessage({ type: 'downloadLog', filePath: selectedLogFile }); }
    });
  }

  // Logs tab: lines selector change
  const logLinesSelect = document.getElementById('logLinesSelect');
  if (logLinesSelect) {
    logLinesSelect.addEventListener('change', () => {
      if (selectedLogFile) { fetchLogContent(selectedLogFile); }
    });
  }

  // Logs tab: manual refresh button
  const logRefreshBtn = document.getElementById('logRefreshBtn');
  if (logRefreshBtn) {
    logRefreshBtn.addEventListener('click', () => {
      if (selectedLogFile) {
        fetchLogContent(selectedLogFile);
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
          if (selectedLogFile && activeTab === 'logs') {
            fetchLogContent(selectedLogFile, true /* silent */);
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
    logSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        navigateLogMatch(e.shiftKey ? -1 : 1);
      }
    });
  }

  if (logClearSearchBtn) {
    logClearSearchBtn.addEventListener('click', () => {
      logSearchQuery = '';
      if (logSearchInput) { logSearchInput.value = ''; }
      logClearSearchBtn.style.display = 'none';
      logMatchElements = [];
      logCurrentMatchIndex = -1;
      updateLogMatchBadge();
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
        <td>${formatLoginTime(s.loginTime || '')}</td>
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
        <td>${formatLoginTime(h.loginTime || '')}</td>
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
          <button class="service-action-btn service-status-btn" data-unit="${escapeHtml(svc.unit)}" title="View Status">
            <i class="codicon codicon-info"></i>
          </button>
          <button class="service-action-btn service-log-btn" data-unit="${escapeHtml(svc.unit)}" title="View Logs (journalctl)">
            <i class="codicon codicon-output"></i>
          </button>
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

  // Service Status Modal
  const serviceStatusModal = document.getElementById('serviceStatusModal');
  const serviceStatusOverlay = document.getElementById('serviceStatusOverlay');
  const serviceStatusClose = document.getElementById('serviceStatusClose');
  const serviceStatusTitle = document.getElementById('serviceStatusTitle');
  const serviceStatusContent = document.getElementById('serviceStatusContent');

  function openServiceStatusModal(unit) {
    if (serviceStatusTitle) { serviceStatusTitle.textContent = unit; }
    if (serviceStatusContent) { serviceStatusContent.textContent = 'Loading…'; }
    if (serviceStatusModal) { serviceStatusModal.style.display = 'flex'; }
    vscode.postMessage({ type: 'serviceStatus', unit });
  }

  function closeServiceStatusModal() {
    if (serviceStatusModal) { serviceStatusModal.style.display = 'none'; }
  }

  function handleServiceStatusData(msg) {
    if (!serviceStatusContent) { return; }
    if (msg.error) {
      serviceStatusContent.textContent = `Error: ${msg.error}`;
    } else {
      serviceStatusContent.textContent = msg.status || '(no output)';
    }
  }

  if (serviceStatusClose) { serviceStatusClose.addEventListener('click', closeServiceStatusModal); }
  if (serviceStatusOverlay) { serviceStatusOverlay.addEventListener('click', closeServiceStatusModal); }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && serviceStatusModal && serviceStatusModal.style.display !== 'none') {
      closeServiceStatusModal();
    }
  });

  // Service Journal Log Modal
  let activeLogServiceUnit = null;
  const serviceLogModal = document.getElementById('serviceLogModal');
  const serviceLogOverlay = document.getElementById('serviceLogOverlay');
  const serviceLogClose = document.getElementById('serviceLogClose');
  const serviceLogClear = document.getElementById('serviceLogClear');
  const serviceLogContent = document.getElementById('serviceLogContent');
  const serviceLogTitle = document.getElementById('serviceLogTitle');
  const serviceLogStatus = document.getElementById('serviceLogStatus');
  const serviceLogAutoScroll = document.getElementById('serviceLogAutoScroll');

  function openServiceLogModal(unit) {
    if (activeLogServiceUnit) {
      vscode.postMessage({ type: 'stopServiceLog', unit: activeLogServiceUnit });
    }
    activeLogServiceUnit = unit;
    if (serviceLogTitle) { serviceLogTitle.textContent = `Logs — ${unit}`; }
    if (serviceLogContent) { serviceLogContent.textContent = ''; }
    if (serviceLogStatus) { serviceLogStatus.textContent = 'Connecting…'; }
    if (serviceLogModal) { serviceLogModal.style.display = 'flex'; }
    vscode.postMessage({ type: 'serviceLog', unit });
  }

  function closeServiceLogModal() {
    if (activeLogServiceUnit) {
      vscode.postMessage({ type: 'stopServiceLog', unit: activeLogServiceUnit });
      activeLogServiceUnit = null;
    }
    if (serviceLogModal) { serviceLogModal.style.display = 'none'; }
    if (serviceLogContent) { serviceLogContent.textContent = ''; }
    if (serviceLogStatus) { serviceLogStatus.textContent = ''; }
  }

  function handleServiceLogChunk(unit, chunk) {
    if (unit !== activeLogServiceUnit) { return; }
    if (!serviceLogContent) { return; }
    if (serviceLogStatus) { serviceLogStatus.textContent = 'Streaming…'; }
    serviceLogContent.appendChild(document.createTextNode(chunk));
    if (serviceLogAutoScroll && serviceLogAutoScroll.checked) {
      serviceLogContent.scrollTop = serviceLogContent.scrollHeight;
    }
  }

  function handleServiceLogEnd(unit, error) {
    if (unit !== activeLogServiceUnit) { return; }
    if (serviceLogStatus) {
      serviceLogStatus.textContent = error ? `Error: ${error}` : 'Stream ended.';
    }
  }

  if (serviceLogClose) { serviceLogClose.addEventListener('click', closeServiceLogModal); }
  if (serviceLogOverlay) { serviceLogOverlay.addEventListener('click', closeServiceLogModal); }
  if (serviceLogClear) { serviceLogClear.addEventListener('click', () => { if (serviceLogContent) { serviceLogContent.textContent = ''; } }); }

  document.addEventListener('click', (e) => {
    const statusBtn = e.target.closest('.service-status-btn');
    if (statusBtn) {
      const unit = statusBtn.dataset.unit;
      if (unit) { openServiceStatusModal(unit); }
      return;
    }
    const logBtn = e.target.closest('.service-log-btn');
    if (logBtn) {
      const unit = logBtn.dataset.unit;
      if (unit) { openServiceLogModal(unit); }
      return;
    }
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
  let currentDockerImages = [];
  let currentDockerVolumes = [];
  let currentDockerNetworks = [];
  let currentDockerCompose = [];
  const expandedComposeProjects = new Set();
  const composeServicesCache = {}; // projectName -> { services, error }
  let dockerSortColumn = 'state';
  let dockerSortDir = 'asc';
  let dockerImageSortColumn = 'repository';
  let dockerImageSortDir = 'asc';
  let dockerVolumeSortColumn = 'name';
  let dockerVolumeSortDir = 'asc';
  let dockerNetworkSortColumn = 'name';
  let dockerNetworkSortDir = 'asc';
  let dockerComposeSortColumn = 'name';
  let dockerComposeSortDir = 'asc';

  function handleDockerData(data) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;

    // Support both old format (array) and new format (object with containers/images/volumes/networks)
    if (Array.isArray(data)) {
      currentContainers = data;
      currentDockerImages = [];
      currentDockerVolumes = [];
      currentDockerNetworks = [];
    } else {
      currentContainers = (data && data.containers) || [];
      currentDockerImages = (data && data.images) || [];
      currentDockerVolumes = (data && data.volumes) || [];
      currentDockerNetworks = (data && data.networks) || [];
      currentDockerCompose = (data && data.compose) || [];
    }

    // Update sub-tab count badges
    const containerCountEl = document.getElementById('dockerContainerCount');
    const imageCountEl = document.getElementById('dockerImageCount');
    const volumeCountEl = document.getElementById('dockerVolumeCount');
    const networkCountEl = document.getElementById('dockerNetworkCount');
    const composeCountEl = document.getElementById('dockerComposeCount');
    if (containerCountEl) { containerCountEl.textContent = currentContainers.length ? String(currentContainers.length) : ''; }
    if (imageCountEl) { imageCountEl.textContent = currentDockerImages.length ? String(currentDockerImages.length) : ''; }
    if (volumeCountEl) { volumeCountEl.textContent = currentDockerVolumes.length ? String(currentDockerVolumes.length) : ''; }
    if (networkCountEl) { networkCountEl.textContent = currentDockerNetworks.length ? String(currentDockerNetworks.length) : ''; }
    if (composeCountEl) { composeCountEl.textContent = currentDockerCompose.length ? String(currentDockerCompose.length) : ''; }

    renderDockerContainersTable();
    renderDockerImagesTable();
    renderDockerVolumesTable();
    renderDockerNetworksTable();
    renderDockerComposeTable();
  }

  function renderDockerContainersTable() {
    const tbody = document.getElementById('dockerList');
    if (!tbody) { return; }

    if (currentContainers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No containers found or Docker is not available</td></tr>';
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

    document.querySelectorAll('#dockerTable th[data-sort]').forEach(th => {
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
        <td class="docker-actions-cell">
          <button class="docker-action-btn docker-container-log-btn"
            data-container-id="${escapeHtml(c.id)}" data-container-name="${escapeHtml(c.name)}"
            title="View Logs"><i class="codicon codicon-output"></i></button>
          <button class="docker-action-btn docker-container-action-btn"
            data-container-id="${escapeHtml(c.id)}" data-action="start"
            title="Start" ${isRunning ? 'disabled' : ''}><i class="codicon codicon-play"></i></button>
          <button class="docker-action-btn docker-container-action-btn"
            data-container-id="${escapeHtml(c.id)}" data-action="stop"
            title="Stop" ${!isRunning ? 'disabled' : ''}><i class="codicon codicon-debug-stop"></i></button>
          <button class="docker-action-btn docker-container-action-btn"
            data-container-id="${escapeHtml(c.id)}" data-action="restart"
            title="Restart"><i class="codicon codicon-debug-restart"></i></button>
          <button class="docker-action-btn docker-inspect-btn"
            data-type="container" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}"
            title="Inspect"><i class="codicon codicon-json"></i></button>
          <button class="docker-action-btn docker-remove-btn"
            data-type="container" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}"
            title="Remove"><i class="codicon codicon-trash"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderDockerImagesTable() {
    const tbody = document.getElementById('dockerImagesList');
    if (!tbody) { return; }
    if (currentDockerImages.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No images found</td></tr>';
      return;
    }
    const sorted = [...currentDockerImages].sort((a, b) => {
      const aVal = dockerImageSortColumn === 'size' ? (Number(a.size) || 0) : String(a[dockerImageSortColumn] || '').toLowerCase();
      const bVal = dockerImageSortColumn === 'size' ? (Number(b.size) || 0) : String(b[dockerImageSortColumn] || '').toLowerCase();
      if (aVal < bVal) { return dockerImageSortDir === 'asc' ? -1 : 1; }
      if (aVal > bVal) { return dockerImageSortDir === 'asc' ? 1 : -1; }
      return 0;
    });
    document.querySelectorAll('#dockerImagesTable th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === dockerImageSortColumn) {
        th.classList.add(dockerImageSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
    tbody.innerHTML = '';
    sorted.forEach(img => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code style="font-size:11px">${escapeHtml(img.id)}</code></td>
        <td>${escapeHtml(img.repository)}</td>
        <td><span style="font-family: var(--vscode-editor-font-family); font-size:11px;">${escapeHtml(img.tag)}</span></td>
        <td>${formatBytesSize(img.size)}</td>
        <td style="color: var(--vscode-descriptionForeground); font-size:11px;">${escapeHtml(img.createdAt)}</td>
        <td class="docker-actions-cell">
          <button class="docker-action-btn docker-inspect-btn"
            data-type="image" data-id="${escapeHtml(img.id)}"
            data-name="${escapeHtml(img.repository + ':' + img.tag)}"
            title="Inspect"><i class="codicon codicon-json"></i></button>
          <button class="docker-action-btn docker-remove-btn"
            data-type="image" data-id="${escapeHtml(img.id)}"
            data-name="${escapeHtml(img.repository + ':' + img.tag)}"
            title="Remove Image"><i class="codicon codicon-trash"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderDockerVolumesTable() {
    const tbody = document.getElementById('dockerVolumesList');
    if (!tbody) { return; }
    if (currentDockerVolumes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No volumes found</td></tr>';
      return;
    }
    const sorted = [...currentDockerVolumes].sort((a, b) => {
      const aVal = String(a[dockerVolumeSortColumn] || '').toLowerCase();
      const bVal = String(b[dockerVolumeSortColumn] || '').toLowerCase();
      if (aVal < bVal) { return dockerVolumeSortDir === 'asc' ? -1 : 1; }
      if (aVal > bVal) { return dockerVolumeSortDir === 'asc' ? 1 : -1; }
      return 0;
    });
    document.querySelectorAll('#dockerVolumesTable th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === dockerVolumeSortColumn) {
        th.classList.add(dockerVolumeSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
    tbody.innerHTML = '';
    sorted.forEach(vol => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family: var(--vscode-editor-font-family); font-size:11px; max-width:200px; overflow:hidden; text-overflow:ellipsis;"
          title="${escapeHtml(vol.name)}">${escapeHtml(vol.name)}</td>
        <td>${escapeHtml(vol.driver || '—')}</td>
        <td style="font-size:11px; color: var(--vscode-descriptionForeground); max-width:250px; overflow:hidden; text-overflow:ellipsis;"
          title="${escapeHtml(vol.mountpoint || '')}">${escapeHtml(vol.mountpoint || '—')}</td>
        <td>${escapeHtml(vol.scope || '—')}</td>
        <td class="docker-actions-cell">
          <button class="docker-action-btn docker-inspect-btn"
            data-type="volume" data-id="${escapeHtml(vol.name)}" data-name="${escapeHtml(vol.name)}"
            title="Inspect"><i class="codicon codicon-json"></i></button>
          <button class="docker-action-btn docker-remove-btn"
            data-type="volume" data-id="${escapeHtml(vol.name)}" data-name="${escapeHtml(vol.name)}"
            title="Remove Volume"><i class="codicon codicon-trash"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderDockerNetworksTable() {
    const tbody = document.getElementById('dockerNetworksList');
    if (!tbody) { return; }
    if (currentDockerNetworks.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No networks found</td></tr>';
      return;
    }
    const sorted = [...currentDockerNetworks].sort((a, b) => {
      const aVal = String(a[dockerNetworkSortColumn] || '').toLowerCase();
      const bVal = String(b[dockerNetworkSortColumn] || '').toLowerCase();
      if (aVal < bVal) { return dockerNetworkSortDir === 'asc' ? -1 : 1; }
      if (aVal > bVal) { return dockerNetworkSortDir === 'asc' ? 1 : -1; }
      return 0;
    });
    document.querySelectorAll('#dockerNetworksTable th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === dockerNetworkSortColumn) {
        th.classList.add(dockerNetworkSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
    tbody.innerHTML = '';
    sorted.forEach(net => {
      const builtIn = ['bridge', 'host', 'none'].includes(net.name);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code style="font-size:11px">${escapeHtml(net.id)}</code></td>
        <td>${escapeHtml(net.name)}</td>
        <td>${escapeHtml(net.driver || '—')}</td>
        <td>${escapeHtml(net.scope || '—')}</td>
        <td>${net.internal ? '<span class="status-pill state-unknown">internal</span>' : '—'}</td>
        <td class="docker-actions-cell">
          <button class="docker-action-btn docker-inspect-btn"
            data-type="network" data-id="${escapeHtml(net.id)}" data-name="${escapeHtml(net.name)}"
            title="Inspect"><i class="codicon codicon-json"></i></button>
          <button class="docker-action-btn docker-remove-btn"
            data-type="network" data-id="${escapeHtml(net.id)}" data-name="${escapeHtml(net.name)}"
            title="Remove Network" ${builtIn ? 'disabled' : ''}><i class="codicon codicon-trash"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderDockerComposeTable() {
    const tbody = document.getElementById('dockerComposeList');
    if (!tbody) { return; }
    if (currentDockerCompose.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No Compose projects found. Make sure containers are running with Docker Compose.</td></tr>';
      return;
    }
    const sorted = [...currentDockerCompose].sort((a, b) => {
      const aVal = String(a[dockerComposeSortColumn] || '').toLowerCase();
      const bVal = String(b[dockerComposeSortColumn] || '').toLowerCase();
      if (aVal < bVal) { return dockerComposeSortDir === 'asc' ? -1 : 1; }
      if (aVal > bVal) { return dockerComposeSortDir === 'asc' ? 1 : -1; }
      return 0;
    });
    document.querySelectorAll('#dockerComposeTable th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === dockerComposeSortColumn) {
        th.classList.add(dockerComposeSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
    tbody.innerHTML = '';
    sorted.forEach(proj => {
      const hasRunning = proj.runningCount > 0;
      const allStopped = proj.runningCount === 0;
      const statusClass = hasRunning ? (proj.runningCount === proj.totalCount ? 'state-up' : 'state-unknown') : 'state-error';
      const isExpanded = expandedComposeProjects.has(proj.name);
      // Project row
      const tr = document.createElement('tr');
      tr.className = 'compose-project-row';
      tr.dataset.projectName = proj.name;
      tr.innerHTML = `
        <td class="compose-expand-cell">
          <button class="compose-expand-btn" data-project="${escapeHtml(proj.name)}" title="${isExpanded ? 'Collapse' : 'Show services'}">
            <i class="codicon codicon-chevron-${isExpanded ? 'down' : 'right'}"></i>
          </button>
        </td>
        <td><strong>${escapeHtml(proj.name)}</strong></td>
        <td>
          <span class="status-pill ${statusClass}">
            ${escapeHtml(String(proj.runningCount))}/${escapeHtml(String(proj.totalCount))} running
          </span>
        </td>
        <td style="font-size:11px; color: var(--vscode-descriptionForeground);">${escapeHtml(proj.status)}</td>
        <td style="font-size:11px; color: var(--vscode-descriptionForeground); max-width:220px; overflow:hidden; text-overflow:ellipsis;"
          title="${escapeHtml(proj.configFiles)}">${escapeHtml(proj.configFiles)}</td>
        <td class="docker-actions-cell">
          <button class="docker-action-btn compose-action-btn" data-project="${escapeHtml(proj.name)}" data-action="start" title="Start All"
            ${!allStopped ? 'disabled' : ''}><i class="codicon codicon-play"></i></button>
          <button class="docker-action-btn compose-action-btn" data-project="${escapeHtml(proj.name)}" data-action="stop" title="Stop All"
            ${allStopped ? 'disabled' : ''}><i class="codicon codicon-debug-stop"></i></button>
          <button class="docker-action-btn compose-action-btn" data-project="${escapeHtml(proj.name)}" data-action="restart" title="Restart All">
            <i class="codicon codicon-debug-restart"></i></button>
          <button class="docker-action-btn compose-project-inspect-btn" data-project="${escapeHtml(proj.name)}" title="Inspect Config (docker compose config)">
            <i class="codicon codicon-info"></i></button>
          <button class="docker-action-btn compose-action-btn" data-project="${escapeHtml(proj.name)}" data-action="down" title="Down (remove containers)">
            <i class="codicon codicon-trash"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
      // Services detail row (shown when expanded)
      if (isExpanded) {
        const detailTr = document.createElement('tr');
        detailTr.className = 'compose-detail-row';
        detailTr.dataset.projectName = proj.name;
        detailTr.innerHTML = `
          <td class="compose-expand-cell"></td>
          <td colspan="5" style="padding: 0 0 8px 12px;">
            <div class="compose-services-container" id="composeServices_${escapeHtml(proj.name)}">
              <span style="color: var(--vscode-descriptionForeground); font-size:12px;">
                <i class="codicon codicon-loading codicon-modifier-spin"></i> Loading services…
              </span>
            </div>
          </td>
        `;
        tbody.appendChild(detailTr);
        // If cached, render immediately; otherwise request
        if (composeServicesCache[proj.name]) {
          renderComposeServicesFromCache(proj.name);
        } else {
          vscode.postMessage({ type: 'dockerComposeServices', projectName: proj.name });
        }
      }
    });
  }

  function renderComposeServicesFromCache(projectName) {
    const container = document.getElementById(`composeServices_${projectName}`);
    if (!container) { return; }
    const cached = composeServicesCache[projectName];
    if (!cached) { return; }
    const { services, error } = cached;
    if (error) {
      container.innerHTML = `<span style="color: var(--vscode-errorForeground); font-size:12px;">Error: ${escapeHtml(error)}</span>`;
      return;
    }
    if (!services || services.length === 0) {
      container.innerHTML = '<span style="color: var(--vscode-descriptionForeground); font-size:12px;">No services found.</span>';
      return;
    }
    const rows = services.map(svc => {
      const isRunning = svc.state === 'running';
      const stateClass = isRunning ? 'state-up' : svc.state === 'exited' ? 'state-error' : 'state-unknown';
      const healthBadge = svc.health
        ? ` <span class="status-pill ${svc.health === 'healthy' ? 'state-up' : 'state-error'}" style="font-size:10px;">${escapeHtml(svc.health)}</span>`
        : '';
      return `<tr>
        <td style="font-size:12px; font-weight:500;">${escapeHtml(svc.service)}</td>
        <td style="font-size:11px; color: var(--vscode-descriptionForeground);">${escapeHtml(svc.name)}</td>
        <td><span class="status-pill ${stateClass}">${escapeHtml(svc.state)}</span>${healthBadge}</td>
        <td style="font-size:11px; color: var(--vscode-descriptionForeground);">${escapeHtml(svc.ports || '—')}</td>
        <td class="docker-actions-cell">
          <button class="docker-action-btn compose-action-btn" data-project="${escapeHtml(projectName)}"
            data-service="${escapeHtml(svc.service)}" data-action="start"
            title="Start service" ${isRunning ? 'disabled' : ''}><i class="codicon codicon-play"></i></button>
          <button class="docker-action-btn compose-action-btn" data-project="${escapeHtml(projectName)}"
            data-service="${escapeHtml(svc.service)}" data-action="stop"
            title="Stop service" ${!isRunning ? 'disabled' : ''}><i class="codicon codicon-debug-stop"></i></button>
          <button class="docker-action-btn compose-action-btn" data-project="${escapeHtml(projectName)}"
            data-service="${escapeHtml(svc.service)}" data-action="restart"
            title="Restart service"><i class="codicon codicon-debug-restart"></i></button>
          <button class="docker-action-btn docker-inspect-btn" data-type="container" data-id="${escapeHtml(svc.id)}"
            data-name="${escapeHtml(svc.name)}" title="Inspect container"><i class="codicon codicon-info"></i></button>
        </td>
      </tr>`;
    }).join('');
    container.innerHTML = `<table class="docker-table compose-services-table" style="margin:4px 0 4px 0;">
      <thead><tr>
        <th>Service</th><th>Container</th><th>State</th><th>Ports</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function handleDockerComposeServicesData(msg) {
    const { projectName, services, error } = msg;
    // Save to cache
    composeServicesCache[projectName] = { services, error };
    renderComposeServicesFromCache(projectName);
  }

  // ── Docker table sort & action event delegation ──────────────────────────
  document.addEventListener('click', (e) => {
    // Container table sort
    const containerTh = e.target.closest('#dockerTable th[data-sort]');
    if (containerTh) {
      const col = containerTh.dataset.sort;
      if (dockerSortColumn === col) { dockerSortDir = dockerSortDir === 'asc' ? 'desc' : 'asc'; }
      else { dockerSortColumn = col; dockerSortDir = (col === 'cpuPercent' || col === 'memPercent') ? 'desc' : 'asc'; }
      renderDockerContainersTable();
      return;
    }
    // Images table sort
    const imgTh = e.target.closest('#dockerImagesTable th[data-sort]');
    if (imgTh) {
      const col = imgTh.dataset.sort;
      if (dockerImageSortColumn === col) { dockerImageSortDir = dockerImageSortDir === 'asc' ? 'desc' : 'asc'; }
      else { dockerImageSortColumn = col; dockerImageSortDir = col === 'size' ? 'desc' : 'asc'; }
      renderDockerImagesTable();
      return;
    }
    // Volumes table sort
    const volTh = e.target.closest('#dockerVolumesTable th[data-sort]');
    if (volTh) {
      const col = volTh.dataset.sort;
      if (dockerVolumeSortColumn === col) { dockerVolumeSortDir = dockerVolumeSortDir === 'asc' ? 'desc' : 'asc'; }
      else { dockerVolumeSortColumn = col; dockerVolumeSortDir = 'asc'; }
      renderDockerVolumesTable();
      return;
    }
    // Networks table sort
    const netTh = e.target.closest('#dockerNetworksTable th[data-sort]');
    if (netTh) {
      const col = netTh.dataset.sort;
      if (dockerNetworkSortColumn === col) { dockerNetworkSortDir = dockerNetworkSortDir === 'asc' ? 'desc' : 'asc'; }
      else { dockerNetworkSortColumn = col; dockerNetworkSortDir = 'asc'; }
      renderDockerNetworksTable();
      return;
    }
    // Compose table sort
    const composeTh = e.target.closest('#dockerComposeTable th[data-sort]');
    if (composeTh) {
      const col = composeTh.dataset.sort;
      if (dockerComposeSortColumn === col) { dockerComposeSortDir = dockerComposeSortDir === 'asc' ? 'desc' : 'asc'; }
      else { dockerComposeSortColumn = col; dockerComposeSortDir = 'asc'; }
      renderDockerComposeTable();
      return;
    }
    // Compose expand/collapse
    const expandBtn = e.target.closest('.compose-expand-btn');
    if (expandBtn) {
      const projectName = expandBtn.dataset.project;
      if (!projectName) { return; }
      if (expandedComposeProjects.has(projectName)) {
        expandedComposeProjects.delete(projectName);
        renderDockerComposeTable();
      } else {
        expandedComposeProjects.add(projectName);
        // Clear stale cache so re-expand fetches fresh data
        delete composeServicesCache[projectName];
        renderDockerComposeTable();
      }
      return;
    }
    // Compose action button (project or service level)
    const composeActionBtn = e.target.closest('.compose-action-btn');
    if (composeActionBtn && !composeActionBtn.disabled) {
      const projectName = composeActionBtn.dataset.project;
      const action = composeActionBtn.dataset.action;
      const serviceName = composeActionBtn.dataset.service || undefined;
      if (projectName && action) {
        vscode.postMessage({ type: 'dockerComposeAction', projectName, action, serviceName });
      }
      return;
    }
    // Container log button
    const logBtn = e.target.closest('.docker-container-log-btn');
    if (logBtn) {
      const id = logBtn.dataset.containerId;
      const name = logBtn.dataset.containerName;
      if (id) { openDockerLogModal({ id, name: name || id }); }
      return;
    }
    // Container action (start/stop/restart)
    const containerActionBtn = e.target.closest('.docker-container-action-btn');
    if (containerActionBtn && !containerActionBtn.disabled) {
      const id = containerActionBtn.dataset.containerId;
      const action = containerActionBtn.dataset.action;
      if (id && action) { vscode.postMessage({ type: 'dockerContainerAction', containerId: id, action }); }
      return;
    }
    // Inspect button (containers, images, volumes, networks)
    const inspectBtn = e.target.closest('.docker-inspect-btn');
    if (inspectBtn) {
      const type = inspectBtn.dataset.type;
      const id = inspectBtn.dataset.id;
      const name = inspectBtn.dataset.name;
      if (type && id) { openDockerInspectModal(type, id, name || id); }
      return;
    }
    // Compose project inspect button (shows docker compose config)
    const composeInspectBtn = e.target.closest('.compose-project-inspect-btn');
    if (composeInspectBtn) {
      const projectName = composeInspectBtn.dataset.project;
      if (projectName) {
        if (dockerInspectTitle) { dockerInspectTitle.textContent = `Compose Config — ${projectName}`; }
        if (dockerInspectContent) { dockerInspectContent.textContent = 'Loading…'; }
        if (dockerInspectModal) { dockerInspectModal.style.display = ''; }
        vscode.postMessage({ type: 'dockerComposeInspect', projectName });
      }
      return;
    }
    // Remove button
    const removeBtn = e.target.closest('.docker-remove-btn');
    if (removeBtn && !removeBtn.disabled) {
      const type = removeBtn.dataset.type;
      const id = removeBtn.dataset.id;
      if (type === 'container') { vscode.postMessage({ type: 'dockerContainerAction', containerId: id, action: 'remove' }); }
      else if (type === 'image') { vscode.postMessage({ type: 'dockerImageAction', imageId: id, action: 'remove' }); }
      else if (type === 'volume') { vscode.postMessage({ type: 'dockerVolumeAction', volumeName: id, action: 'remove' }); }
      else if (type === 'network') { vscode.postMessage({ type: 'dockerNetworkAction', networkId: id, action: 'remove' }); }
      return;
    }
  });

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

  function handleDockerLogChunk(containerId, chunk) {
    if (containerId !== activeLogContainerId) { return; }
    if (!dockerLogContent) { return; }
    if (dockerLogStatus) { dockerLogStatus.textContent = 'Streaming…'; }
    dockerLogContent.appendChild(document.createTextNode(chunk));
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

  // ── Docker Inspect Modal ──────────────────────────────────────────────────

  const dockerInspectModal = document.getElementById('dockerInspectModal');
  const dockerInspectOverlay = document.getElementById('dockerInspectOverlay');
  const dockerInspectClose = document.getElementById('dockerInspectClose');
  const dockerInspectTitle = document.getElementById('dockerInspectTitle');
  const dockerInspectContent = document.getElementById('dockerInspectContent');

  function openDockerInspectModal(type, id, name) {
    if (dockerInspectTitle) { dockerInspectTitle.textContent = `Inspect (${type}) — ${name}`; }
    if (dockerInspectContent) { dockerInspectContent.textContent = 'Loading…'; }
    if (dockerInspectModal) { dockerInspectModal.style.display = ''; }
    vscode.postMessage({ type: 'dockerInspect', inspectType: type, id, name });
  }

  function closeDockerInspectModal() {
    if (dockerInspectModal) { dockerInspectModal.style.display = 'none'; }
    if (dockerInspectContent) { dockerInspectContent.textContent = ''; }
  }

  function handleDockerInspectData(msg) {
    if (!dockerInspectContent) { return; }
    if (msg.error) {
      dockerInspectContent.textContent = `Error: ${msg.error}`;
    } else {
      try {
        const parsed = JSON.parse(msg.data);
        dockerInspectContent.textContent = JSON.stringify(parsed, null, 2);
      } catch {
        dockerInspectContent.textContent = msg.data || '(no output)';
      }
    }
  }

  if (dockerInspectClose) { dockerInspectClose.addEventListener('click', closeDockerInspectModal); }
  if (dockerInspectOverlay) { dockerInspectOverlay.addEventListener('click', closeDockerInspectModal); }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (dockerInspectModal && dockerInspectModal.style.display !== 'none') { closeDockerInspectModal(); }
      if (dockerLogModal && dockerLogModal.style.display !== 'none') { closeDockerLogModal(); }
    }
  });

  // ── Crontab Tab ──────────────────────────────────────────────────────────
  let currentCrontabEntries = [];
  let crontabSortColumn = 'source';
  let crontabSortDir = 'asc';
  let crontabFilterQuery = '';
  // Stores the pending user entries sent with the last write/delete request
  // for immediate optimistic UI update before the server round-trip completes
  let pendingCrontabUserEntries = null;
  let pendingCrontabPreviousEntries = null;

  function handleCrontabData(entries) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;
    currentCrontabEntries = entries || [];
    pendingCrontabUserEntries = null;
    pendingCrontabPreviousEntries = null;
    if (crontabModalSave) { crontabModalSave.disabled = false; }
    renderCrontabTable();
  }

  function renderCrontabTable() {
    const tbody = document.getElementById('crontabList');
    if (!tbody) { return; }

    const matchCountEl = document.getElementById('crontabMatchCount');
    const clearBtn = document.getElementById('crontabClearSearch');

    if (currentCrontabEntries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No cron jobs found</td></tr>';
      if (matchCountEl) { matchCountEl.textContent = ''; }
      if (clearBtn) { clearBtn.style.display = 'none'; }
      return;
    }

    // Filter
    const query = crontabFilterQuery.trim().toLowerCase();
    const allIndexed = currentCrontabEntries.map((e, i) => ({ ...e, _idx: i }));
    const filtered = query
      ? allIndexed.filter(e => {
          const schedule = e.minute
            ? (e.minute.startsWith('@') ? e.minute : [e.minute, e.hour, e.dayOfMonth, e.month, e.dayOfWeek].join(' '))
            : '';
          return (
            (e.source || '').toLowerCase().includes(query) ||
            schedule.toLowerCase().includes(query) ||
            (e.user || '').toLowerCase().includes(query) ||
            (e.command || '').toLowerCase().includes(query)
          );
        })
      : allIndexed;

    if (matchCountEl) {
      matchCountEl.textContent = query ? `${filtered.length} / ${currentCrontabEntries.length}` : '';
    }
    if (clearBtn) {
      clearBtn.style.display = query ? '' : 'none';
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No matching cron jobs</td></tr>';
      return;
    }

    const sorted = [...filtered].sort((a, b) => {
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

  // Crontab search/filter input
  const crontabSearchInput = document.getElementById('crontabSearchInput');
  const crontabClearSearchBtn = document.getElementById('crontabClearSearch');
  if (crontabSearchInput) {
    crontabSearchInput.addEventListener('input', () => {
      crontabFilterQuery = crontabSearchInput.value;
      renderCrontabTable();
    });
    crontabSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        crontabFilterQuery = '';
        crontabSearchInput.value = '';
        renderCrontabTable();
      }
    });
  }
  if (crontabClearSearchBtn) {
    crontabClearSearchBtn.addEventListener('click', () => {
      crontabFilterQuery = '';
      if (crontabSearchInput) { crontabSearchInput.value = ''; }
      renderCrontabTable();
      crontabSearchInput?.focus();
    });
  }

  // ── Crontab CRUD ───────────────────────────────────────────────────
  let crontabEditIndex = -1; // -1 = new, >= 0 = index in currentCrontabEntries

  const crontabModal = document.getElementById('crontabModal');
  const crontabModalOverlay = document.getElementById('crontabModalOverlay');
  const crontabModalClose = document.getElementById('crontabModalClose');
  const crontabModalCancel = document.getElementById('crontabModalCancel');
  const crontabModalSave = document.getElementById('crontabModalSave');
  const crontabModalTitle = document.getElementById('crontabModalTitle');
  const crontabModalError = document.getElementById('crontabModalError');

  function applyCrontabUserEntries(userEntries) {
    const sysEntries = currentCrontabEntries.filter(e => e.source !== 'user');
    currentCrontabEntries = [...sysEntries, ...userEntries];
    renderCrontabTable();
  }

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
    if (crontabModalSave) { crontabModalSave.disabled = false; }
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
        pendingCrontabPreviousEntries = [...currentCrontabEntries];
        pendingCrontabUserEntries = updatedUserEntries;
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
      pendingCrontabPreviousEntries = [...currentCrontabEntries];
      pendingCrontabUserEntries = updatedUserEntries;
      applyCrontabUserEntries(updatedUserEntries);
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
      if (Array.isArray(result.data)) {
        currentCrontabEntries = result.data;
        renderCrontabTable();
      } else if (pendingCrontabUserEntries !== null) {
        applyCrontabUserEntries(pendingCrontabUserEntries);
        requestTabData('crontab');
      }
      pendingCrontabUserEntries = null;
      pendingCrontabPreviousEntries = null;
    } else {
      if (pendingCrontabPreviousEntries !== null) {
        currentCrontabEntries = pendingCrontabPreviousEntries;
        renderCrontabTable();
      }
      pendingCrontabUserEntries = null;
      pendingCrontabPreviousEntries = null;
      if (result.cancelled) { return; }
      if (result.error) {
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
  }

  function handleCrontabDeleteConfirmed() {
    if (pendingCrontabUserEntries !== null) {
      applyCrontabUserEntries(pendingCrontabUserEntries);
    }
  }

})();
