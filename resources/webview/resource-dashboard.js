(function () {
  const vscode = acquireVsCodeApi();

  // DOM elements
  const refreshBtn = document.getElementById('refreshBtn');
  const viewLogsBtn = document.getElementById('viewLogsBtn');
  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const contentState = document.getElementById('contentState');
  const errorText = document.getElementById('errorText');

  // System info elements
  const hostname = document.getElementById('hostname');
  const os = document.getElementById('os');
  const kernel = document.getElementById('kernel');
  const uptime = document.getElementById('uptime');

  // CPU info elements
  const cpuUsage = document.getElementById('cpuUsage');
  const cpuProgress = document.getElementById('cpuProgress');
  const cores = document.getElementById('cores');
  const loadAvg = document.getElementById('loadAvg');

  // Memory info elements
  const memoryUsage = document.getElementById('memoryUsage');
  const memoryProgress = document.getElementById('memoryProgress');
  const memoryTotal = document.getElementById('memoryTotal');
  const memoryUsed = document.getElementById('memoryUsed');
  const memoryAvailable = document.getElementById('memoryAvailable');

  // Disk list element
  const diskList = document.getElementById('diskList');

  // Event listeners
  refreshBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
  });

  viewLogsBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'showLogs' });
  });

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

      case 'error':
        handleError(message.data);
        break;
    }
  });

  function handleLoading(isLoading) {
    if (isLoading) {
      loadingState.style.display = 'flex';
      errorState.style.display = 'none';
      contentState.style.display = 'none';
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

    // Update system info
    hostname.textContent = data.system.hostname;
    os.textContent = data.system.os;
    kernel.textContent = data.system.kernel;
    uptime.textContent = data.system.uptime;

    // Update CPU info
    cpuUsage.textContent = `${data.cpu.usage.toFixed(1)}%`;
    cpuProgress.style.width = `${Math.min(data.cpu.usage, 100)}%`;
    updateProgressColor(cpuProgress, data.cpu.usage);

    cores.textContent = data.cpu.cores;
    loadAvg.textContent = `${data.cpu.loadAvg1} / ${data.cpu.loadAvg5} / ${data.cpu.loadAvg15}`;

    // Update memory info
    memoryUsage.textContent = `${data.memory.usage.toFixed(1)}%`;
    memoryProgress.style.width = `${Math.min(data.memory.usage, 100)}%`;
    updateProgressColor(memoryProgress, data.memory.usage);

    memoryTotal.textContent = `${formatBytes(data.memory.total)} MB`;
    memoryUsed.textContent = `${formatBytes(data.memory.used)} MB`;
    memoryAvailable.textContent = `${formatBytes(data.memory.available)} MB`;

    // Update disk info
    updateDiskList(data.disk);
  }

  function updateProgressColor(element, percentage) {
    element.classList.remove('warning', 'critical');
    if (percentage >= 90) {
      element.classList.add('critical');
    } else if (percentage >= 75) {
      element.classList.add('warning');
    }
  }

  function updateDiskList(disks) {
    if (!disks || disks.length === 0) {
      diskList.innerHTML = '<p style="color: var(--vscode-descriptionForeground);">No disk information available</p>';
      return;
    }

    diskList.innerHTML = '';

    disks.forEach((disk) => {
      const diskItem = document.createElement('div');
      diskItem.className = 'disk-item';

      diskItem.innerHTML = `
        <div class="disk-header">
          <div>
            <div class="disk-name">${disk.mountpoint}</div>
            <div class="disk-path">${disk.filesystem}</div>
          </div>
          <div class="disk-usage">${disk.usage}%</div>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${Math.min(disk.usage, 100)}%"></div>
        </div>
        <div class="disk-info">
          <span>Total: ${disk.total} GB</span>
          <span>Used: ${disk.used} GB</span>
          <span>Available: ${disk.available} GB</span>
        </div>
      `;

      // Update progress color
      const progressFill = diskItem.querySelector('.progress-fill');
      updateProgressColor(progressFill, disk.usage);

      diskList.appendChild(diskItem);
    });
  }

  function formatBytes(mb) {
    return mb.toLocaleString();
  }
})();
