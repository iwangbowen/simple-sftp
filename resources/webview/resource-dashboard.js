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
  const cores = document.getElementById('cores');
  const loadAvg = document.getElementById('loadAvg');

  // Memory info elements
  const memoryUsage = document.getElementById('memoryUsage');
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
    cores.textContent = data.cpu.cores;
    loadAvg.textContent = `${data.cpu.loadAvg1} / ${data.cpu.loadAvg5} / ${data.cpu.loadAvg15}`;

    // Update memory info
    memoryUsage.textContent = `${data.memory.usage.toFixed(1)}%`;
    memoryTotal.textContent = `${formatBytes(data.memory.total)} MB`;
    memoryUsed.textContent = `${formatBytes(data.memory.used)} MB`;
    memoryAvailable.textContent = `${formatBytes(data.memory.available)} MB`;

    // Update disk info
    updateDiskList(data.disk);
  }

  function updateDiskList(disks) {
    if (!disks || disks.length === 0) {
      diskList.innerHTML = '<p style="color: var(--vscode-descriptionForeground); font-size: 12px;">No disk information available</p>';
      return;
    }

    diskList.innerHTML = '';

    disks.forEach((disk) => {
      const diskItem = document.createElement('div');
      diskItem.className = 'disk-item';
      diskItem.innerHTML = `
        <div class="info-item">
          <span class="info-label">Mountpoint</span>
          <span class="info-value">${disk.mountpoint}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Filesystem</span>
          <span class="info-value">${disk.filesystem}</span>
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
  }

  function formatBytes(mb) {
    return mb.toLocaleString();
  }
})();
