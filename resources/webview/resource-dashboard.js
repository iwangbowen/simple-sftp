(function () {
  const vscode = acquireVsCodeApi();

  // DOM elements
  const refreshBtn = document.getElementById('refreshBtn');
  const viewLogsBtn = document.getElementById('viewLogsBtn');
  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const contentState = document.getElementById('contentState');
  const errorText = document.getElementById('errorText');

  // Tab elements
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  // Current active tab
  let activeTab = 'overview';

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

    // Update disk summary for overview tab
    updateDiskSummary(data.disk);
  }

  function handleProcessData(processes) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;

    const processList = document.getElementById('processList');

    if (!processes || processes.length === 0) {
      processList.innerHTML = '<tr><td colspan="5" class="empty-state">No process data available</td></tr>';
      return;
    }

    processList.innerHTML = '';

    processes.forEach(proc => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${proc.pid}</td>
        <td>${proc.user}</td>
        <td>${proc.cpu}%</td>
        <td>${proc.mem}%</td>
        <td style="font-family: var(--vscode-editor-font-family);">${escapeHtml(proc.command)}</td>
      `;
      processList.appendChild(row);
    });
  }

  function handleNetworkData(interfaces) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    contentState.style.display = 'flex';
    refreshBtn.disabled = false;

    const networkList = document.getElementById('networkList');

    if (!interfaces || interfaces.length === 0) {
      networkList.innerHTML = '<tr><td colspan="5" class="empty-state">No network data available</td></tr>';
      return;
    }

    networkList.innerHTML = '';

    interfaces.forEach(iface => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${iface.interface}</td>
        <td>${formatBytesSize(iface.rxBytes)}</td>
        <td>${formatBytesSize(iface.txBytes)}</td>
        <td>${formatRate(iface.rxRate)}</td>
        <td>${formatRate(iface.txRate)}</td>
      `;
      networkList.appendChild(row);
    });
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

    ioList.innerHTML = '';

    devices.forEach(device => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${device.device}</td>
        <td>${formatRate(device.readRate)}</td>
        <td>${formatRate(device.writeRate)}</td>
        <td>${device.utilization.toFixed(1)}%</td>
      `;
      ioList.appendChild(row);
    });
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

    diskSummary.innerHTML = '';

    disks.forEach((disk) => {
      const diskItem = document.createElement('div');
      diskItem.className = 'disk-item-summary';
      diskItem.innerHTML = `
        <div class="info-item">
          <span class="info-label">Mountpoint</span>
          <span class="info-value">${disk.mountpoint}</span>
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
  }

  function updateDiskList(disks) {
    const diskList = document.getElementById('diskList');

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

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
