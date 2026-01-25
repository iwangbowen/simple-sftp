// @ts-check
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    let jumpHostsData = []; // Array of jump host configurations
    let jumpHostIdCounter = 0;

    // DOM Elements
    const form = document.getElementById('hostConfigForm');
    const pageTitleEl = document.getElementById('pageTitle');
    const authTypeSelect = document.getElementById('authType');
    const jumpHostToggle = document.getElementById('jumpHostToggle');
    const jumpHostConfig = document.getElementById('jumpHostConfig');
    const jumpHostsList = document.getElementById('jumpHostsList');
    const addJumpHostBtn = document.getElementById('addJumpHost');
    const testConnectionBtn = document.getElementById('testConnection');
    const cancelBtn = document.getElementById('cancel');
    const browseKeyBtn = document.getElementById('browseKey');

    // Initialize
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command || message.type) {
            case 'loadConfig':
                loadHostConfig(message.config);
                break;
            case 'testResult':
            case 'testConnectionResult':
                if (!message.success) {
                    vscode.postMessage({ type: 'error', message: message.message });
                }
                break;
            case 'singleJumpHostTestResult':
                // Handle single jump host test result
                const jumpHostId = message.jumpHostId;
                const card = document.getElementById(`jump-host-${jumpHostId}`);
                if (card) {
                    const testBtn = card.querySelector('.test-jump');
                    const icon = testBtn?.querySelector('i');

                    if (icon && testBtn) {
                        if (message.success) {
                            icon.className = 'codicon codicon-pass';
                            icon.style.color = 'var(--vscode-testing-iconPassed)';
                        } else {
                            icon.className = 'codicon codicon-error';
                            icon.style.color = 'var(--vscode-testing-iconFailed)';
                        }

                        testBtn.disabled = false;

                        // Reset after 3 seconds
                        setTimeout(() => {
                            icon.className = 'codicon codicon-debug-disconnect';
                            icon.style.color = '';
                        }, 3000);
                    }
                }
                break;
            case 'privateKeyPath':
                const pathInput = message.isJumpHost
                    ? document.querySelector(`#jump-${message.jumpHostId}-privateKeyPath`)
                    : document.getElementById('privateKeyPath');
                if (pathInput) {
                    pathInput.value = message.path;
                }
                break;
        }
    });

    // Auth type change handler for main host
    authTypeSelect.addEventListener('change', () => {
        updateAuthFields('');
    });

    // Jump host toggle
    jumpHostToggle.addEventListener('click', () => {
        const isExpanded = jumpHostConfig.style.display === 'block';
        jumpHostConfig.style.display = isExpanded ? 'none' : 'block';
        jumpHostToggle.classList.toggle('expanded', !isExpanded);
    });

    // Add jump host
    addJumpHostBtn.addEventListener('click', () => {
        addJumpHostCard();
    });

    // Browse private key for main host
    browseKeyBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'browsePrivateKey', isJumpHost: false });
    });

    // Test connection
    testConnectionBtn.addEventListener('click', async () => {
        console.log('[WebView] Test button clicked');

        if (!validate()) {
            console.log('[WebView] Validation failed');
            return;
        }

        console.log('[WebView] Validation passed, collecting form data');
        const config = collectFormData();
        console.log('[WebView] Sending test connection request with config:', config);
        vscode.postMessage({ type: 'testConnection', config });
    });

    // Cancel
    cancelBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancel' });
    });

    // Form submit
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!validate()) {
            return;
        }

        const config = collectFormData();
        vscode.postMessage({ type: 'save', config });
    });

    /**
     * Add a jump host card to the list
     * @param {any} [jumpHostData] - Optional data to pre-fill
     */
    function addJumpHostCard(jumpHostData) {
        const id = ++jumpHostIdCounter;
        const jumpHost = jumpHostData || {
            host: '',
            port: 22,
            username: '',
            authType: 'password',
            password: '',
            privateKeyPath: '',
            passphrase: ''
        };

        const card = document.createElement('div');
        card.className = 'jump-host-card';
        card.id = `jump-host-${id}`;
        card.dataset.id = id.toString();

        card.innerHTML = `
            <div class="jump-host-header">
                <div class="jump-host-title">
                    <span>Jump Host ${jumpHostsData.length + 1}</span>
                </div>
                <div class="jump-host-actions">
                    <button type="button" class="icon-button-small test-jump" title="Test this jump host" data-id="${id}">
                        <i class="codicon codicon-debug-disconnect"></i>
                    </button>
                    ${jumpHostsData.length > 0 ? `
                        <button type="button" class="icon-button-small move-up" title="Move up">
                            <i class="codicon codicon-arrow-up"></i>
                        </button>
                        <button type="button" class="icon-button-small move-down" title="Move down">
                            <i class="codicon codicon-arrow-down"></i>
                        </button>
                    ` : ''}
                    <button type="button" class="icon-button-small danger remove" title="Remove">
                        <i class="codicon codicon-trash"></i>
                    </button>
                </div>
            </div>

            <div class="form-row">
                <div class="form-group flex-2">
                    <label for="jump-${id}-host">Host</label>
                    <input type="text" id="jump-${id}-host" placeholder="jump.example.com" value="${jumpHost.host || ''}" />
                </div>
                <div class="form-group flex-1">
                    <label for="jump-${id}-port">Port</label>
                    <input type="number" id="jump-${id}-port" value="${jumpHost.port || 22}" min="1" max="65535" />
                </div>
            </div>

            <div class="form-group">
                <label for="jump-${id}-username">Username</label>
                <input type="text" id="jump-${id}-username" placeholder="admin" value="${jumpHost.username || ''}" />
            </div>

            <div class="form-group">
                <label for="jump-${id}-authType">Auth Type</label>
                <select id="jump-${id}-authType">
                    <option value="password" ${jumpHost.authType === 'password' ? 'selected' : ''}>Password</option>
                    <option value="privateKey" ${jumpHost.authType === 'privateKey' ? 'selected' : ''}>Private Key</option>
                    <option value="agent" ${jumpHost.authType === 'agent' ? 'selected' : ''}>SSH Agent</option>
                </select>
            </div>

            <!-- Password auth -->
            <div class="form-group auth-option" id="jump-${id}-passwordAuth">
                <label for="jump-${id}-password">Password</label>
                <input type="password" id="jump-${id}-password" placeholder="Jump host password" value="${jumpHost.password || ''}" />
            </div>

            <!-- Private Key auth -->
            <div class="form-group auth-option" id="jump-${id}-privateKeyAuth" style="display: none;">
                <label for="jump-${id}-privateKeyPath">Private Key Path</label>
                <div class="input-group">
                    <input type="text" id="jump-${id}-privateKeyPath" placeholder="~/.ssh/id_rsa" value="${jumpHost.privateKeyPath || ''}" />
                    <button type="button" class="icon-button browse-jump-key" data-id="${id}">
                        <i class="codicon codicon-folder-opened"></i>
                    </button>
                </div>
            </div>

            <div class="form-group auth-option" id="jump-${id}-passphraseAuth" style="display: none;">
                <label for="jump-${id}-passphrase">Passphrase <span class="optional">(Optional)</span></label>
                <input type="password" id="jump-${id}-passphrase" placeholder="If private key is encrypted" value="${jumpHost.passphrase || ''}" />
            </div>

            <!-- SSH Agent auth -->
            <div class="form-group auth-option" id="jump-${id}-agentAuth" style="display: none;">
                <div class="info-note">
                    <i class="codicon codicon-info"></i>
                    <span>Use system SSH Agent for authentication</span>
                </div>
            </div>
        `;

        jumpHostsList.appendChild(card);
        jumpHostsData.push({ id, ...jumpHost });

        // Add event listeners
        const authTypeSelect = document.getElementById(`jump-${id}-authType`);
        authTypeSelect.addEventListener('change', () => {
            updateAuthFields(`jump-${id}-`);
        });

        const browseBtn = card.querySelector('.browse-jump-key');
        browseBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'browsePrivateKey', isJumpHost: true, jumpHostId: id });
        });

        const testBtn = card.querySelector('.test-jump');
        testBtn.addEventListener('click', () => {
            testSingleJumpHost(id);
        });

        const removeBtn = card.querySelector('.remove');
        removeBtn.addEventListener('click', () => {
            removeJumpHostCard(id);
        });

        const moveUpBtn = card.querySelector('.move-up');
        if (moveUpBtn) {
            moveUpBtn.addEventListener('click', () => {
                moveJumpHostCard(id, 'up');
            });
        }

        const moveDownBtn = card.querySelector('.move-down');
        if (moveDownBtn) {
            moveDownBtn.addEventListener('click', () => {
                moveJumpHostCard(id, 'down');
            });
        }

        // Update auth fields
        updateAuthFields(`jump-${id}-`);
        updateJumpHostTitles();
    }

    /**
     * Test a single jump host connection
     * @param {number} id
     */
    function testSingleJumpHost(id) {
        const card = document.getElementById(`jump-host-${id}`);
        if (!card) return;

        const testBtn = card.querySelector('.test-jump');
        const icon = testBtn.querySelector('i');

        // Show loading state
        icon.className = 'codicon codicon-loading codicon-modifier-spin';
        testBtn.disabled = true;

        // Collect jump host data
        const jumpHostConfig = {
            host: document.getElementById(`jump-${id}-host`)?.value || '',
            port: Number.parseInt(document.getElementById(`jump-${id}-port`)?.value || '22', 10),
            username: document.getElementById(`jump-${id}-username`)?.value || '',
            authType: document.getElementById(`jump-${id}-authType`)?.value || 'password',
            password: document.getElementById(`jump-${id}-password`)?.value || '',
            privateKeyPath: document.getElementById(`jump-${id}-privateKeyPath`)?.value || '',
            passphrase: document.getElementById(`jump-${id}-passphrase`)?.value || ''
        };

        // Validate
        if (!jumpHostConfig.host || !jumpHostConfig.username) {
            icon.className = 'codicon codicon-error';
            testBtn.disabled = false;
            setTimeout(() => {
                icon.className = 'codicon codicon-debug-disconnect';
            }, 2000);
            return;
        }

        // Send test request
        vscode.postMessage({
            type: 'testSingleJumpHost',
            jumpHostId: id,
            jumpHostConfig
        });
    }

    /**
     * Remove a jump host card
     * @param {number} id
     */
    function removeJumpHostCard(id) {
        const card = document.getElementById(`jump-host-${id}`);
        if (card) {
            card.remove();
        }
        jumpHostsData = jumpHostsData.filter(jh => jh.id !== id);
        updateJumpHostTitles();
    }

    /**
     * Move a jump host card up or down
     * @param {number} id
     * @param {'up'|'down'} direction
     */
    function moveJumpHostCard(id, direction) {
        const index = jumpHostsData.findIndex(jh => jh.id === id);
        if (index === -1) return;

        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= jumpHostsData.length) return;

        // Swap in data array
        [jumpHostsData[index], jumpHostsData[newIndex]] = [jumpHostsData[newIndex], jumpHostsData[index]];

        // Re-render all cards
        renderJumpHosts();
    }

    /**
     * Re-render all jump host cards
     */
    function renderJumpHosts() {
        jumpHostsList.innerHTML = '';
        const tempData = [...jumpHostsData];
        jumpHostsData = [];
        jumpHostIdCounter = 0;
        tempData.forEach(jh => {
            const { id, ...data } = jh;
            addJumpHostCard(data);
        });
    }

    /**
     * Update jump host titles (Jump Host 1, 2, 3, ...)
     */
    function updateJumpHostTitles() {
        const cards = jumpHostsList.querySelectorAll('.jump-host-card');
        cards.forEach((card, index) => {
            const titleSpan = card.querySelector('.jump-host-title span');
            if (titleSpan) {
                titleSpan.textContent = `Jump Host ${index + 1}`;
            }
        });
    }

    /**
     * Update authentication fields visibility
     * @param {string} prefix - Field prefix ('' for main host, 'jump-{id}-' for jump hosts)
     */
    function updateAuthFields(prefix) {
        const authType = document.getElementById(`${prefix}authType`)?.value;

        const passwordAuth = document.getElementById(`${prefix}passwordAuth`);
        const privateKeyAuth = document.getElementById(`${prefix}privateKeyAuth`);
        const passphraseAuth = document.getElementById(`${prefix}passphraseAuth`);
        const agentAuth = document.getElementById(`${prefix}agentAuth`);

        if (!authType) return;

        // Hide all
        if (passwordAuth) passwordAuth.style.display = 'none';
        if (privateKeyAuth) privateKeyAuth.style.display = 'none';
        if (passphraseAuth) passphraseAuth.style.display = 'none';
        if (agentAuth) agentAuth.style.display = 'none';

        // Show relevant fields
        if (authType === 'password' && passwordAuth) {
            passwordAuth.style.display = 'block';
        } else if (authType === 'privateKey') {
            if (privateKeyAuth) privateKeyAuth.style.display = 'block';
            if (passphraseAuth) passphraseAuth.style.display = 'block';
        } else if (authType === 'agent' && agentAuth) {
            agentAuth.style.display = 'block';
        }
    }

    /**
     * Load host configuration
     * @param {any} config
     */
    function loadHostConfig(config) {
        if (config.id) {
            pageTitleEl.textContent = `Edit Host: ${config.name || config.host}`;
        }

        // Basic fields
        document.getElementById('name').value = config.name || '';
        document.getElementById('host').value = config.host || '';
        document.getElementById('port').value = config.port || 22;
        document.getElementById('username').value = config.username || '';
        document.getElementById('defaultRemotePath').value = config.defaultRemotePath || '';
        document.getElementById('color').value = config.color || '';
        document.getElementById('starred').checked = config.starred || false;
        document.getElementById('group').value = config.group || '';

        // Auth fields
        document.getElementById('authType').value = config.authType || 'password';
        document.getElementById('password').value = config.password || '';
        document.getElementById('privateKeyPath').value = config.privateKeyPath || '';
        document.getElementById('passphrase').value = config.passphrase || '';

        updateAuthFields('');

        // Load jump hosts
        jumpHostsList.innerHTML = '';
        jumpHostsData = [];
        jumpHostIdCounter = 0;

        if (config.jumpHosts && Array.isArray(config.jumpHosts)) {
            config.jumpHosts.forEach(jh => {
                addJumpHostCard(jh);
            });
        } else if (config.jumpHost) {
            // Backward compatibility: single jumpHost
            addJumpHostCard(config.jumpHost);
        }
    }

    /**
     * Collect form data
     * @returns {any}
     */
    function collectFormData() {
        const config = {
            name: document.getElementById('name').value.trim(),
            host: document.getElementById('host').value.trim(),
            port: parseInt(document.getElementById('port').value, 10),
            username: document.getElementById('username').value.trim(),
            defaultRemotePath: document.getElementById('defaultRemotePath').value.trim(),
            color: document.getElementById('color').value,
            starred: document.getElementById('starred').checked,
            group: document.getElementById('group').value,
            authType: document.getElementById('authType').value,
            password: document.getElementById('password').value,
            privateKeyPath: document.getElementById('privateKeyPath').value.trim(),
            passphrase: document.getElementById('passphrase').value
        };

        // Collect jump hosts
        const jumpHosts = jumpHostsData.map(jh => {
            const id = jh.id;
            return {
                host: document.getElementById(`jump-${id}-host`)?.value.trim() || '',
                port: parseInt(document.getElementById(`jump-${id}-port`)?.value || '22', 10),
                username: document.getElementById(`jump-${id}-username`)?.value.trim() || '',
                authType: document.getElementById(`jump-${id}-authType`)?.value || 'password',
                password: document.getElementById(`jump-${id}-password`)?.value || '',
                privateKeyPath: document.getElementById(`jump-${id}-privateKeyPath`)?.value.trim() || '',
                passphrase: document.getElementById(`jump-${id}-passphrase`)?.value || ''
            };
        }).filter(jh => jh.host); // Filter out empty jump hosts

        config.jumpHosts = jumpHosts.length > 0 ? jumpHosts : undefined;

        return config;
    }

    /**
     * Validate form
     * @returns {boolean}
     */
    function validate() {
        const name = document.getElementById('name').value.trim();
        const host = document.getElementById('host').value.trim();
        const port = parseInt(document.getElementById('port').value, 10);
        const username = document.getElementById('username').value.trim();

        if (!name) {
            vscode.postMessage({ type: 'error', message: 'Please provide a name for the host' });
            return false;
        }

        if (!host) {
            vscode.postMessage({ type: 'error', message: 'Please provide a host address' });
            return false;
        }

        if (!port || port < 1 || port > 65535) {
            vscode.postMessage({ type: 'error', message: 'Please provide a valid port number (1-65535)' });
            return false;
        }

        if (!username) {
            vscode.postMessage({ type: 'error', message: 'Please provide a username' });
            return false;
        }

        return true;
    }

    // Initialize auth fields
    updateAuthFields('');
})();
