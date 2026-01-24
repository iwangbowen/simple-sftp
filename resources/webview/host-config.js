// @ts-check
(function () {
    const vscode = acquireVsCodeApi();

    // Get DOM elements
    const elements = {
        // Basic settings
        name: document.getElementById('name'),
        host: document.getElementById('host'),
        port: document.getElementById('port'),
        username: document.getElementById('username'),
        authType: document.getElementById('authType'),
        password: document.getElementById('password'),
        privateKeyPath: document.getElementById('privateKeyPath'),
        passphrase: document.getElementById('passphrase'),
        browseKey: document.getElementById('browseKey'),
        defaultRemotePath: document.getElementById('defaultRemotePath'),
        color: document.getElementById('color'),
        starred: document.getElementById('starred'),

        // Jump host settings
        jumpHost: document.getElementById('jumpHost'),
        jumpPort: document.getElementById('jumpPort'),
        jumpUsername: document.getElementById('jumpUsername'),
        jumpAuthType: document.getElementById('jumpAuthType'),
        jumpPassword: document.getElementById('jumpPassword'),
        jumpPrivateKeyPath: document.getElementById('jumpPrivateKeyPath'),
        jumpPassphrase: document.getElementById('jumpPassphrase'),
        jumpBrowseKey: document.getElementById('jumpBrowseKey'),

        // Buttons
        testConnection: document.getElementById('testConnection'),
        cancel: document.getElementById('cancel'),
        save: document.getElementById('save'),

        // Page elements
        pageTitle: document.getElementById('pageTitle')
    };

    // State
    let isEditMode = false;

    // Collapsible section toggle
    const sectionHeader = document.querySelector('.section-header');
    const sectionContent = document.querySelector('.section-content');

    if (sectionHeader) {
        sectionHeader.addEventListener('click', () => {
            const isExpanded = sectionHeader.classList.contains('expanded');

            if (isExpanded) {
                sectionHeader.classList.remove('expanded');
                if (sectionContent) sectionContent.style.display = 'none';
            } else {
                sectionHeader.classList.add('expanded');
                if (sectionContent) sectionContent.style.display = 'block';
            }
        });
    }

    // Jump host auth type change
    if (elements.authType) {
        elements.authType.addEventListener('change', () => {
            updateAuthVisibility();
        });
    }

    if (elements.jumpAuthType) {
        elements.jumpAuthType.addEventListener('change', () => {
            updateJumpAuthVisibility();
        });
    }

    function updateAuthVisibility() {
        if (!elements.authType) return;

        const authType = elements.authType.value;

        // Hide all auth options
        const passwordAuth = document.getElementById('passwordAuth');
        const privateKeyAuth = document.getElementById('privateKeyAuth');
        const passphraseAuth = document.getElementById('passphraseAuth');
        const agentAuth = document.getElementById('agentAuth');

        if (passwordAuth) passwordAuth.style.display = 'none';
        if (privateKeyAuth) privateKeyAuth.style.display = 'none';
        if (passphraseAuth) passphraseAuth.style.display = 'none';
        if (agentAuth) agentAuth.style.display = 'none';

        // Show relevant auth options
        if (authType === 'password') {
            if (passwordAuth) passwordAuth.style.display = 'block';
        } else if (authType === 'privateKey') {
            if (privateKeyAuth) privateKeyAuth.style.display = 'block';
            if (passphraseAuth) passphraseAuth.style.display = 'block';
        } else if (authType === 'agent') {
            if (agentAuth) agentAuth.style.display = 'block';
        }
    }

    function updateJumpAuthVisibility() {
        if (!elements.jumpAuthType) return;

        const authType = elements.jumpAuthType.value;

        //Hide all auth options
        const passwordAuth = document.getElementById('jumpPasswordAuth');
        const privateKeyAuth = document.getElementById('jumpPrivateKeyAuth');
        const passphraseAuth = document.getElementById('jumpPassphraseAuth');
        const agentAuth = document.getElementById('jumpAgentAuth');

        if (passwordAuth) passwordAuth.style.display = 'none';
        if (privateKeyAuth) privateKeyAuth.style.display = 'none';
        if (passphraseAuth) passphraseAuth.style.display = 'none';
        if (agentAuth) agentAuth.style.display = 'none';

        // Show relevant auth options
        if (authType === 'password') {
            if (passwordAuth) passwordAuth.style.display = 'block';
        } else if (authType === 'privateKey') {
            if (privateKeyAuth) privateKeyAuth.style.display = 'block';
            if (passphraseAuth) passphraseAuth.style.display = 'block';
        } else if (authType === 'agent') {
            if (agentAuth) agentAuth.style.display = 'block';
        }
    }

    // Browse for private key
    if (elements.browseKey) {
        elements.browseKey.addEventListener('click', () => {
            vscode.postMessage({
                command: 'browsePrivateKey',
                context: 'host'
            });
        });
    }

    if (elements.jumpBrowseKey) {
        elements.jumpBrowseKey.addEventListener('click', () => {
            vscode.postMessage({
                command: 'browsePrivateKey',
                context: 'jumpHost'
            });
        });
    }

    // Test connection
    if (elements.testConnection) {
        elements.testConnection.addEventListener('click', async () => {
            const config = collectFormData();

            if (!validateBasicFields(config)) {
                return;
            }

            elements.testConnection.disabled = true;
            elements.testConnection.innerHTML = '<i class="codicon codicon-loading codicon-modifier-spin"></i> Testing...';

            vscode.postMessage({
                command: 'testConnection',
                config: config
            });
        });
    }

    // Save configuration
    if (elements.save) {
        elements.save.addEventListener('click', (e) => {
            e.preventDefault();
            const config = collectFormData();

            if (!validateBasicFields(config)) {
                return;
            }

            if (config.jumpHost && !validateJumpHostFields(config.jumpHost)) {
                return;
            }

            vscode.postMessage({
                command: 'save',
                config: config,
                isEditMode: isEditMode
            });
        });
    }

    // Cancel
    if (elements.cancel) {
        elements.cancel.addEventListener('click', () => {
            vscode.postMessage({
                command: 'cancel'
            });
        });
    }

    // Collect form data
    function collectFormData() {
        const config = {
            name: elements.name?.value.trim() || '',
            host: elements.host?.value.trim() || '',
            port: Number.parseInt(elements.port?.value || '22'),
            username: elements.username?.value.trim() || '',
            authType: elements.authType?.value || 'password',
            defaultRemotePath: elements.defaultRemotePath?.value.trim() || undefined,
            color: elements.color?.value || undefined,
            starred: elements.starred?.checked || false
        };

        // Add auth credentials based on type
        if (config.authType === 'password') {
            config.password = elements.password?.value || '';
        } else if (config.authType === 'privateKey') {
            config.privateKeyPath = elements.privateKeyPath?.value.trim() || '';
            if (elements.passphrase?.value) {
                config.passphrase = elements.passphrase.value;
            }
        }

        // Collect jump host config if filled
        const jumpHostValue = elements.jumpHost?.value.trim();
        if (jumpHostValue) {
            const jumpHost = {
                host: jumpHostValue,
                port: Number.parseInt(elements.jumpPort?.value || '22'),
                username: elements.jumpUsername?.value.trim() || '',
                authType: elements.jumpAuthType?.value || 'password'
            };

            // Add auth credentials based on type
            if (jumpHost.authType === 'password') {
                jumpHost.password = elements.jumpPassword?.value || '';
            } else if (jumpHost.authType === 'privateKey') {
                jumpHost.privateKeyPath = elements.jumpPrivateKeyPath?.value.trim() || '';
                if (elements.jumpPassphrase?.value) {
                    jumpHost.passphrase = elements.jumpPassphrase.value;
                }
            }

            config.jumpHost = jumpHost;
        }

        return config;
    }

    // Validate basic fields
    function validateBasicFields(config) {
        if (!config.name) {
            showError('Please enter host name');
            return false;
        }

        if (!config.host) {
            showError('Please enter host address');
            return false;
        }

        if (!config.port || config.port < 1 || config.port > 65535) {
            showError('Please enter valid port number (1-65535)');
            return false;
        }

        if (!config.username) {
            showError('Please enter username');
            return false;
        }

        return true;
    }

    // Validate jump host fields
    function validateJumpHostFields(jumpHost) {
        if (!jumpHost.host) {
            showError('Please enter jump host address');
            return false;
        }

        if (!jumpHost.port || jumpHost.port < 1 || jumpHost.port > 65535) {
            showError('Please enter valid jump host port (1-65535)');
            return false;
        }

        if (!jumpHost.username) {
            showError('Please enter jump host username');
            return false;
        }

        if (jumpHost.authType === 'password' && !jumpHost.password) {
            showError('Please enter jump host password');
            return false;
        }

        if (jumpHost.authType === 'privateKey' && !jumpHost.privateKeyPath) {
            showError('Please select jump host private key file');
            return false;
        }

        return true;
    }

    // Show error message
    function showError(message) {
        vscode.postMessage({
            command: 'showError',
            message: message
        });
    }

    // Load configuration into form
    function loadConfig(config) {
        isEditMode = !!config?.id;

        // Update page title
        if (elements.pageTitle) {
            elements.pageTitle.textContent = isEditMode ? 'Edit Host Configuration' : 'Add Host';
        }

        if (!config) {
            return;
        }

        // Load basic settings
        if (elements.name) elements.name.value = config.name || '';
        if (elements.host) elements.host.value = config.host || '';
        if (elements.port) elements.port.value = config.port || 22;
        if (elements.username) elements.username.value = config.username || '';
        if (elements.authType) elements.authType.value = config.authType || 'password';

        // Load auth credentials
        if (config.authType === 'password') {
            if (elements.password) elements.password.value = config.password || '';
        } else if (config.authType === 'privateKey') {
            if (elements.privateKeyPath) elements.privateKeyPath.value = config.privateKeyPath || '';
            if (elements.passphrase) elements.passphrase.value = config.passphrase || '';
        }

        updateAuthVisibility();

        if (elements.defaultRemotePath) elements.defaultRemotePath.value = config.defaultRemotePath || '';
        if (elements.color) elements.color.value = config.color || '';
        if (elements.starred) elements.starred.checked = config.starred || false;

        // Load jump host settings
        if (config.jumpHost) {
            // Expand jump host section
            if (sectionHeader && sectionContent) {
                sectionHeader.classList.add('expanded');
                sectionContent.style.display = 'block';
            }

            if (elements.jumpHost) elements.jumpHost.value = config.jumpHost.host || '';
            if (elements.jumpPort) elements.jumpPort.value = config.jumpHost.port || 22;
            if (elements.jumpUsername) elements.jumpUsername.value = config.jumpHost.username || '';
            if (elements.jumpAuthType) elements.jumpAuthType.value = config.jumpHost.authType || 'password';

            if (config.jumpHost.authType === 'password') {
                if (elements.jumpPassword) elements.jumpPassword.value = config.jumpHost.password || '';
            } else if (config.jumpHost.authType === 'privateKey') {
                if (elements.jumpPrivateKeyPath) elements.jumpPrivateKeyPath.value = config.jumpHost.privateKeyPath || '';
                if (elements.jumpPassphrase) elements.jumpPassphrase.value = config.jumpHost.passphrase || '';
            }

            updateJumpAuthVisibility();
        } else {
            // Collapse jump host section if not configured
            if (sectionHeader && sectionContent) {
                sectionHeader.classList.remove('expanded');
                sectionContent.style.display = 'none';
            }
        }
    }

    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.command) {
            case 'loadConfig':
                loadConfig(message.config);
                break;

            case 'testConnectionResult':
                if (elements.testConnection) {
                    elements.testConnection.disabled = false;
                    elements.testConnection.innerHTML = '<i class="codicon codicon-debug-disconnect"></i> Test Connection';
                }

                if (message.success) {
                    vscode.postMessage({
                        command: 'showInfo',
                        message: 'Connection test successful!'
                    });
                }
                break;

            case 'privateKeyPath':
                if (message.context === 'jumpHost') {
                    if (elements.jumpPrivateKeyPath) {
                        elements.jumpPrivateKeyPath.value = message.path;
                    }
                } else if (message.context === 'host') {
                    if (elements.privateKeyPath) {
                        elements.privateKeyPath.value = message.path;
                    }
                }
                break;
        }
    });

    // Initialize
    updateAuthVisibility();
    updateJumpAuthVisibility();

    // Request initial configuration
    vscode.postMessage({
        command: 'ready'
    });
})();
