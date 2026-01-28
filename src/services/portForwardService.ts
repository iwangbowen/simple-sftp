import * as vscode from 'vscode';
import { Client, ConnectConfig } from 'ssh2';
import { randomUUID } from 'crypto';
import { PortForwardConfig, PortForwarding, PortForwardingEvent, ForwardType, RemoteForwardConfig, DynamicForwardConfig } from '../types/portForward.types';
import { HostConfig, HostAuthConfig } from '../types';
import { logger } from '../logger';
import { addAuthToConnectConfig } from '../utils/jumpHostHelper';

export class PortForwardService {
    private static instance: PortForwardService;
    private forwardings: Map<string, PortForwarding> = new Map();
    private sshClients: Map<string, Client> = new Map();
    private eventEmitter: vscode.EventEmitter<PortForwardingEvent>;
    public readonly onPortForwardingEvent: vscode.Event<PortForwardingEvent>;
    private context?: vscode.ExtensionContext;
    private static readonly STORAGE_KEY = 'portForwardings';

    private constructor() {
        this.eventEmitter = new vscode.EventEmitter<PortForwardingEvent>();
        this.onPortForwardingEvent = this.eventEmitter.event;
    }

    public static getInstance(): PortForwardService {
        if (!PortForwardService.instance) {
            PortForwardService.instance = new PortForwardService();
        }
        return PortForwardService.instance;
    }

    /**
     * Initialize service with context and restore saved forwardings
     */
    public initialize(context: vscode.ExtensionContext): void {
        this.context = context;
        this.loadFromGlobalState();
    }

    /**
     * Save forwardings to globalState
     */
    private async saveToGlobalState(): Promise<void> {
        if (!this.context) {
            return;
        }

        // Convert Map to array for serialization (exclude SSH clients)
        const forwardingsArray = Array.from(this.forwardings.values()).map(f => ({
            ...f,
            // Reset status to inactive when saving (SSH clients are not persisted)
            status: 'inactive' as const
        }));

        await this.context.globalState.update(PortForwardService.STORAGE_KEY, forwardingsArray);
        logger.debug(`[Port Forward] Saved ${forwardingsArray.length} forwarding configs to globalState`);
    }

    /**
     * Load forwardings from globalState
     */
    private loadFromGlobalState(): void {
        if (!this.context) {
            return;
        }

        const saved = this.context.globalState.get<PortForwarding[]>(PortForwardService.STORAGE_KEY, []);

        // Restore forwardings to Map (all as inactive since SSH connections are not persisted)
        for (const forwarding of saved) {
            this.forwardings.set(forwarding.id, {
                ...forwarding,
                status: 'inactive'
            });
        }

        logger.info(`[Port Forward] Restored ${saved.length} forwarding configs from globalState`);
    }

    /**
     * Start port forwarding
     */
    public async startForwarding(
        hostConfig: HostConfig,
        authConfig: HostAuthConfig,
        config: PortForwardConfig
    ): Promise<PortForwarding> {
        const id = randomUUID();
        const localHost = config.localHost || '127.0.0.1';
        const remoteHost = config.remoteHost || 'localhost';
        const localPort = config.localPort || config.remotePort; // Default to remote port if not specified

        // Check if forwarding already exists for this combination (including inactive ones)
        const existing = Array.from(this.forwardings.values()).find(
            f => f.hostId === hostConfig.id &&
                f.remotePort === config.remotePort &&
                f.localPort === localPort
        );

        // If active forwarding exists, return it
        if (existing && existing.status === 'active') {
            logger.info(`Active port forwarding already exists: ${existing.localHost}:${existing.localPort} -> ${remoteHost}:${config.remotePort}`);
            return existing;
        }

        // If inactive forwarding exists, reuse it
        let forwarding: PortForwarding;
        if (existing) {
            logger.info(`Reusing existing inactive forwarding for ${existing.localHost}:${existing.localPort} -> ${remoteHost}:${config.remotePort}`);
            forwarding = existing;
            forwarding.status = 'inactive'; // Will be set to active later
            forwarding.error = undefined; // Clear previous error
            forwarding.origin = config.origin || 'manual';
            if (config.label) {
                forwarding.label = config.label;
            }
        } else {
            // Create new forwarding
            forwarding = {
                id,
                hostId: hostConfig.id,
                remotePort: config.remotePort,
                localPort: localPort,
                localHost,
                remoteHost,
                status: 'inactive',
                label: config.label,
                origin: 'manual',
                createdAt: Date.now(),
                forwardType: config.forwardType || 'local'
            };
        }

        try {
            // Create SSH client (already in 'ready' state when returned)
            const client = await this.createSSHClient(hostConfig, authConfig);
            this.sshClients.set(forwarding.id, client);

            logger.debug(`[Port Forward] SSH client ready, creating local server...`);

            // Create local server for port forwarding
            const net = require('net');
            const server = net.createServer((socket: any) => {
                logger.debug(`[Port Forward] New connection on local port ${forwarding.localPort}`);
                // Forward connections to remote
                client.forwardOut(
                    localHost,
                    forwarding.localPort,
                    remoteHost,
                    config.remotePort,
                    (err: Error | undefined, stream: any) => {
                        if (err) {
                            logger.error(`Port forward error: ${err.message}`);
                            socket.end();
                            return;
                        }
                        socket.pipe(stream).pipe(socket);

                        socket.on('error', (sockErr: Error) => {
                            logger.error(`Socket error: ${sockErr.message}`);
                        });

                        stream.on('error', (streamErr: Error) => {
                            logger.error(`Stream error: ${streamErr.message}`);
                        });
                    }
                );
            });

            // Listen on local port
            await new Promise<void>((resolve, reject) => {
                server.on('error', (err: Error) => {
                    logger.error(`Port forward server error: ${err.message}`);
                    forwarding.status = 'error';
                    forwarding.error = err.message;
                    reject(err);
                });

                server.listen(config.localPort || 0, localHost, () => {
                    const addr = server.address() as any;
                    forwarding.localPort = addr.port;
                    forwarding.status = 'active';
                    logger.info(`Port forwarding started: ${localHost}:${forwarding.localPort} -> ${remoteHost}:${config.remotePort}`);
                    resolve();
                });
            });

            // Store server reference for cleanup
            (client as any)._forwardServer = server;

            // Handle SSH client errors
            client.on('error', (err: Error) => {
                logger.error(`SSH client error during port forwarding: ${err.message}`);
                forwarding.status = 'error';
                forwarding.error = err.message;
                server.close();
            });

            client.on('close', () => {
                logger.info(`SSH client connection closed for port forwarding ${forwarding.id}`);
                server.close();
                forwarding.status = 'inactive';
            });

            this.forwardings.set(forwarding.id, forwarding);

            this.eventEmitter.fire({
                type: 'started',
                forwarding
            });

            // Save to globalState for persistence
            await this.saveToGlobalState();

            return forwarding;

        } catch (error: any) {
            forwarding.status = 'error';
            forwarding.error = error.message;
            this.forwardings.set(forwarding.id, forwarding);

            this.eventEmitter.fire({
                type: 'error',
                forwarding,
                error: error.message
            });

            throw error;
        }
    }

    /**
     * Stop port forwarding
     */
    public async stopForwarding(id: string): Promise<void> {
        const forwarding = this.forwardings.get(id);
        if (!forwarding) {
            throw new Error(`Port forwarding ${id} not found`);
        }

        const client = this.sshClients.get(id);
        if (client) {
            // Close the forward server and wait for it to complete
            const server = (client as any)._forwardServer;
            if (server) {
                await new Promise<void>((resolve, reject) => {
                    // Set a timeout for server close
                    const timeout = setTimeout(() => {
                        logger.warn(`Server close timeout for port forwarding ${id}`);
                        resolve();
                    }, 3000);

                    // Close all existing connections first
                    server.getConnections((err: Error | null, count: number) => {
                        if (!err && count > 0) {
                            logger.debug(`Closing ${count} active connections for port forwarding ${id}`);
                        }
                    });

                    server.close((err?: Error) => {
                        clearTimeout(timeout);
                        if (err) {
                            logger.error(`Error closing server: ${err.message}`);
                            // Don't reject, just log and continue
                        }
                        resolve();
                    });
                });
            }

            // End SSH client
            client.end();
            this.sshClients.delete(id);
        }

        forwarding.status = 'inactive';
        this.forwardings.set(id, forwarding);

        this.eventEmitter.fire({
            type: 'stopped',
            forwarding
        });

        logger.info(`Port forwarding stopped: ${forwarding.localHost}:${forwarding.localPort} -> ${forwarding.remoteHost}:${forwarding.remotePort}`);

        // Save to globalState for persistence
        await this.saveToGlobalState();
    }

    /**
     * Start remote port forwarding (reverse tunnel: -R)
     * Remote server listens on remotePort and forwards traffic to localHost:localPort
     */
    public async startRemoteForwarding(
        hostConfig: HostConfig,
        authConfig: HostAuthConfig,
        config: RemoteForwardConfig
    ): Promise<PortForwarding> {
        const id = randomUUID();
        const localHost = config.localHost || '127.0.0.1';
        const remoteHost = config.remoteHost || '127.0.0.1';

        // Check if forwarding already exists for this combination
        const existing = Array.from(this.forwardings.values()).find(
            f => f.hostId === hostConfig.id &&
                f.remotePort === config.remotePort &&
                f.localPort === config.localPort &&
                f.forwardType === 'remote'
        );

        // If active forwarding exists, return it
        if (existing && existing.status === 'active') {
            logger.info(`Active remote forwarding already exists: ${remoteHost}:${existing.remotePort} -> ${localHost}:${existing.localPort}`);
            return existing;
        }

        // If inactive forwarding exists, reuse it
        let forwarding: PortForwarding;
        if (existing) {
            logger.info(`Reusing existing inactive remote forwarding for ${remoteHost}:${existing.remotePort} -> ${localHost}:${existing.localPort}`);
            forwarding = existing;
            forwarding.status = 'inactive';
            forwarding.error = undefined;
            if (config.label) {
                forwarding.label = config.label;
            }
        } else {
            forwarding = {
                id,
                hostId: hostConfig.id,
                remotePort: config.remotePort,
                localPort: config.localPort,
                localHost,
                remoteHost,
                status: 'inactive',
                label: config.label,
                origin: 'manual',
                createdAt: Date.now(),
                forwardType: 'remote'
            };
        }

        try {
            const client = await this.createSSHClient(hostConfig, authConfig);
            this.sshClients.set(forwarding.id, client);

            logger.debug(`[Remote Forward] SSH client ready, setting up remote forwarding...`);

            // Set up remote port forwarding using forwardIn
            await new Promise<void>((resolve, reject) => {
                client.forwardIn(remoteHost, config.remotePort, (err: Error | undefined) => {
                    if (err) {
                        logger.error(`Remote forward error: ${err.message}`);
                        forwarding.status = 'error';
                        forwarding.error = err.message;
                        reject(err);
                        return;
                    }
                    forwarding.status = 'active';
                    logger.info(`Remote forwarding started: ${remoteHost}:${config.remotePort} -> ${localHost}:${config.localPort}`);
                    resolve();
                });
            });

            // Handle incoming connections from remote
            const net = require('node:net');
            client.on('tcp connection', (info: any, accept: () => any, reject: () => void) => {
                logger.debug(`[Remote Forward] Incoming connection from ${info.srcIP}:${info.srcPort}`);

                const stream = accept();
                const socket = net.connect(config.localPort, localHost, () => {
                    logger.debug(`[Remote Forward] Connected to local ${localHost}:${config.localPort}`);
                    stream.pipe(socket).pipe(stream);
                });

                socket.on('error', (sockErr: Error) => {
                    logger.error(`[Remote Forward] Socket error: ${sockErr.message}`);
                    stream.close();
                });

                stream.on('error', (streamErr: Error) => {
                    logger.error(`[Remote Forward] Stream error: ${streamErr.message}`);
                    socket.destroy();
                });
            });

            // Handle SSH client errors
            client.on('error', (err: Error) => {
                logger.error(`SSH client error during remote forwarding: ${err.message}`);
                forwarding.status = 'error';
                forwarding.error = err.message;
            });

            client.on('close', () => {
                logger.info(`SSH client connection closed for remote forwarding ${forwarding.id}`);
                forwarding.status = 'inactive';
            });

            this.forwardings.set(forwarding.id, forwarding);

            this.eventEmitter.fire({
                type: 'started',
                forwarding
            });

            await this.saveToGlobalState();

            return forwarding;

        } catch (error: any) {
            forwarding.status = 'error';
            forwarding.error = error.message;
            this.forwardings.set(forwarding.id, forwarding);

            this.eventEmitter.fire({
                type: 'error',
                forwarding,
                error: error.message
            });

            throw error;
        }
    }

    /**
     * Start dynamic port forwarding (SOCKS5 proxy: -D)
     * Creates a local SOCKS5 proxy that tunnels traffic through the SSH connection
     */
    public async startDynamicForwarding(
        hostConfig: HostConfig,
        authConfig: HostAuthConfig,
        config: DynamicForwardConfig
    ): Promise<PortForwarding> {
        const id = randomUUID();
        const localHost = config.localHost || '127.0.0.1';

        // Check if forwarding already exists for this combination
        const existing = Array.from(this.forwardings.values()).find(
            f => f.hostId === hostConfig.id &&
                f.localPort === config.localPort &&
                f.forwardType === 'dynamic'
        );

        // If active forwarding exists, return it
        if (existing && existing.status === 'active') {
            logger.info(`Active dynamic forwarding already exists on ${localHost}:${existing.localPort}`);
            return existing;
        }

        // If inactive forwarding exists, reuse it
        let forwarding: PortForwarding;
        if (existing) {
            logger.info(`Reusing existing inactive dynamic forwarding on ${localHost}:${existing.localPort}`);
            forwarding = existing;
            forwarding.status = 'inactive';
            forwarding.error = undefined;
            if (config.label) {
                forwarding.label = config.label;
            }
        } else {
            forwarding = {
                id,
                hostId: hostConfig.id,
                remotePort: 0, // Not applicable for dynamic forwarding
                localPort: config.localPort,
                localHost,
                remoteHost: '', // Dynamic - routes to any destination
                status: 'inactive',
                label: config.label || 'SOCKS5 Proxy',
                origin: 'manual',
                createdAt: Date.now(),
                forwardType: 'dynamic'
            };
        }

        try {
            const client = await this.createSSHClient(hostConfig, authConfig);
            this.sshClients.set(forwarding.id, client);

            logger.debug(`[Dynamic Forward] SSH client ready, creating SOCKS5 proxy server...`);

            // Create SOCKS5 proxy server
            const net = require('node:net');
            const server = net.createServer((socket: any) => {
                this.handleSocks5Connection(socket, client, forwarding);
            });

            // Listen on local port
            await new Promise<void>((resolve, reject) => {
                server.on('error', (err: Error) => {
                    logger.error(`SOCKS5 server error: ${err.message}`);
                    forwarding.status = 'error';
                    forwarding.error = err.message;
                    reject(err);
                });

                server.listen(config.localPort || 0, localHost, () => {
                    const addr = server.address();
                    forwarding.localPort = addr.port;
                    forwarding.status = 'active';
                    logger.info(`Dynamic forwarding (SOCKS5) started on ${localHost}:${forwarding.localPort}`);
                    resolve();
                });
            });

            // Store server reference for cleanup
            (client as any)._forwardServer = server;

            // Handle SSH client errors
            client.on('error', (err: Error) => {
                logger.error(`SSH client error during dynamic forwarding: ${err.message}`);
                forwarding.status = 'error';
                forwarding.error = err.message;
                server.close();
            });

            client.on('close', () => {
                logger.info(`SSH client connection closed for dynamic forwarding ${forwarding.id}`);
                server.close();
                forwarding.status = 'inactive';
            });

            this.forwardings.set(forwarding.id, forwarding);

            this.eventEmitter.fire({
                type: 'started',
                forwarding
            });

            await this.saveToGlobalState();

            return forwarding;

        } catch (error: any) {
            forwarding.status = 'error';
            forwarding.error = error.message;
            this.forwardings.set(forwarding.id, forwarding);

            this.eventEmitter.fire({
                type: 'error',
                forwarding,
                error: error.message
            });

            throw error;
        }
    }

    /**
     * Handle SOCKS5 connection
     * Implements basic SOCKS5 protocol for CONNECT requests
     */
    private handleSocks5Connection(socket: any, client: Client, forwarding: PortForwarding): void {
        let stage = 0; // 0: greeting, 1: request, 2: connected

        socket.once('data', (data: Buffer) => {
            if (stage === 0) {
                // SOCKS5 greeting
                if (data[0] !== 0x05) {
                    logger.error('[SOCKS5] Invalid SOCKS version');
                    socket.end();
                    return;
                }

                // Reply: version 5, no authentication required
                socket.write(Buffer.from([0x05, 0x00]));
                stage = 1;

                socket.once('data', (requestData: Buffer) => {
                    this.handleSocks5Request(socket, requestData, client, forwarding);
                });
            }
        });

        socket.on('error', (err: Error) => {
            logger.error(`[SOCKS5] Socket error: ${err.message}`);
        });
    }

    /**
     * Handle SOCKS5 CONNECT request
     */
    private handleSocks5Request(socket: any, data: Buffer, client: Client, forwarding: PortForwarding): void {
        // SOCKS5 request format:
        // +----+-----+-------+------+----------+----------+
        // |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
        // +----+-----+-------+------+----------+----------+

        if (data[0] !== 0x05) {
            logger.error('[SOCKS5] Invalid request version');
            socket.end();
            return;
        }

        const cmd = data[1];
        if (cmd !== 0x01) { // Only support CONNECT
            logger.error(`[SOCKS5] Unsupported command: ${cmd}`);
            // Reply with command not supported
            socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
            socket.end();
            return;
        }

        const atyp = data[3];
        let destHost: string;
        let destPort: number;
        let offset: number;

        if (atyp === 0x01) { // IPv4
            destHost = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
            offset = 8;
        } else if (atyp === 0x03) { // Domain name
            const domainLength = data[4];
            destHost = data.slice(5, 5 + domainLength).toString();
            offset = 5 + domainLength;
        } else if (atyp === 0x04) { // IPv6
            const ipv6Parts = [];
            for (let i = 0; i < 8; i++) {
                ipv6Parts.push(data.readUInt16BE(4 + i * 2).toString(16));
            }
            destHost = ipv6Parts.join(':');
            offset = 20;
        } else {
            logger.error(`[SOCKS5] Unsupported address type: ${atyp}`);
            socket.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
            socket.end();
            return;
        }

        destPort = data.readUInt16BE(offset);

        logger.debug(`[SOCKS5] CONNECT request to ${destHost}:${destPort}`);

        // Forward through SSH connection
        client.forwardOut(
            forwarding.localHost,
            forwarding.localPort,
            destHost,
            destPort,
            (err: Error | undefined, stream: any) => {
                if (err) {
                    logger.error(`[SOCKS5] Forward error: ${err.message}`);
                    // Reply with general failure
                    socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
                    socket.end();
                    return;
                }

                // Reply with success
                const reply = Buffer.alloc(10);
                reply[0] = 0x05; // Version
                reply[1] = 0x00; // Success
                reply[2] = 0x00; // Reserved
                reply[3] = 0x01; // IPv4
                // Bind address (0.0.0.0:0)
                reply.writeUInt32BE(0, 4);
                reply.writeUInt16BE(0, 8);
                socket.write(reply);

                // Pipe data
                socket.pipe(stream).pipe(socket);

                socket.on('error', (sockErr: Error) => {
                    logger.error(`[SOCKS5] Socket error: ${sockErr.message}`);
                });

                stream.on('error', (streamErr: Error) => {
                    logger.error(`[SOCKS5] Stream error: ${streamErr.message}`);
                });
            }
        );
    }

    /**
     * Stop all port forwardings for a specific host
     */
    public async stopAllForHost(hostId: string): Promise<void> {
        const hostForwardings = Array.from(this.forwardings.values())
            .filter(f => f.hostId === hostId && f.status === 'active');

        for (const forwarding of hostForwardings) {
            try {
                await this.stopForwarding(forwarding.id);
            } catch (error: any) {
                logger.error(`Failed to stop port forwarding ${forwarding.id}: ${error.message}`);
            }
        }
    }

    /**
     * Stop all port forwardings
     */
    public async stopAll(): Promise<void> {
        const activeForwardings = Array.from(this.forwardings.values())
            .filter(f => f.status === 'active');

        for (const forwarding of activeForwardings) {
            try {
                await this.stopForwarding(forwarding.id);
            } catch (error: any) {
                logger.error(`Failed to stop port forwarding ${forwarding.id}: ${error.message}`);
            }
        }
    }

    /**
     * Get all port forwardings
     */
    public getAllForwardings(): PortForwarding[] {
        return Array.from(this.forwardings.values());
    }

    /**
     * Get port forwardings for a specific host
     */
    public getForwardingsForHost(hostId: string): PortForwarding[] {
        return Array.from(this.forwardings.values())
            .filter(f => f.hostId === hostId);
    }

    /**
     * Get port forwarding by ID
     */
    public getForwarding(id: string): PortForwarding | undefined {
        return this.forwardings.get(id);
    }

    /**
     * Delete port forwarding record (must be stopped first)
     */
    public async deleteForwarding(id: string): Promise<void> {
        const forwarding = this.forwardings.get(id);
        if (!forwarding) {
            throw new Error(`Port forwarding ${id} not found`);
        }

        if (forwarding.status === 'active') {
            await this.stopForwarding(id);
        }

        this.forwardings.delete(id);

        // Fire event to notify listeners
        this.eventEmitter.fire({
            type: 'deleted',
            forwarding
        });

        // Save to globalState for persistence
        await this.saveToGlobalState();
    }

    /**
     * Create SSH client for port forwarding
     */
    private async createSSHClient(hostConfig: HostConfig, authConfig: HostAuthConfig): Promise<Client> {
        return new Promise((resolve, reject) => {
            const client = new Client();

            const config: ConnectConfig = {
                host: hostConfig.host,
                port: hostConfig.port || 22,
                username: hostConfig.username,
                readyTimeout: 10000,
                keepaliveInterval: 10000
            };

            // Add authentication
            try {
                addAuthToConnectConfig(config, authConfig);
            } catch (error: any) {
                reject(error);
                return;
            }

            client.on('ready', () => {
                resolve(client);
            });

            client.on('error', (err: Error) => {
                reject(err);
            });

            client.connect(config);
        });
    }

    /**
     * Scan remote host for listening ports
     */
    public async scanRemotePorts(
        hostConfig: HostConfig,
        authConfig: HostAuthConfig
    ): Promise<import('../types/portForward.types').RemoteListeningPort[]> {
        try {
            const client = await this.createSSHClient(hostConfig, authConfig);

            try {
                const command = `ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "UNSUPPORTED"`;
                const output = await this.executeSSHCommand(client, command);

                // Get process command details for PIDs
                const portsWithPids = this.parseListeningPorts(output);
                const enrichedPorts = await this.enrichProcessInfo(client, portsWithPids);

                client.end();

                if (output.includes('UNSUPPORTED')) {
                    logger.warn('Neither ss nor netstat command available on remote host');
                    return [];
                }

                return enrichedPorts;
            } catch (error: any) {
                client.end();
                throw error;
            }
        } catch (error: any) {
            logger.error(`Failed to scan remote ports: ${error.message}`);
            throw error;
        }
    }

    /**
     * Execute SSH command and return output
     */
    private async executeSSHCommand(client: any, command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            client.exec(command, (err: Error, stream: any) => {
                if (err) {
                    reject(err);
                    return;
                }

                let output = '';
                let errorOutput = '';

                stream.on('data', (data: Buffer) => {
                    output += data.toString();
                });

                stream.stderr.on('data', (data: Buffer) => {
                    errorOutput += data.toString();
                });

                stream.on('close', (code: number) => {
                    if (code !== 0 && errorOutput) {
                        reject(new Error(`Command failed with code ${code}: ${errorOutput}`));
                    } else {
                        resolve(output);
                    }
                });
            });
        });
    }

    /**
     * Enrich port information with full process command details
     */
    private async enrichProcessInfo(
        client: any,
        ports: import('../types/portForward.types').RemoteListeningPort[]
    ): Promise<import('../types/portForward.types').RemoteListeningPort[]> {
        const pidsToQuery = ports.filter(p => p.pid).map(p => p.pid!);
        if (pidsToQuery.length === 0) {
            return ports;
        }

        try {
            // Query process command for all PIDs in batch
            const pidsStr = pidsToQuery.join(' ');
            const command = String.raw`for pid in ${pidsStr}; do if [ -f /proc/$pid/cmdline ]; then echo "PID:$pid"; tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null; echo; fi; done`;
            const output = await this.executeSSHCommand(client, command);

            // Parse output to map PID -> command
            const pidToCommand = new Map<number, string>();
            const lines = output.split('\n');
            let currentPid: number | null = null;

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith('PID:')) {
                    currentPid = Number.parseInt(trimmedLine.substring(4), 10);
                } else if (currentPid !== null && trimmedLine) {
                    pidToCommand.set(currentPid, trimmedLine);
                    currentPid = null;
                }
            }

            // Enrich ports with command info
            return ports.map(port => {
                if (port.pid && pidToCommand.has(port.pid)) {
                    return {
                        ...port,
                        command: pidToCommand.get(port.pid)
                    };
                }
                return port;
            });
        } catch (error: any) {
            logger.warn(`Failed to enrich process info: ${error.message}`);
            return ports; // Return original ports if enrichment fails
        }
    }

    /**
     * Parse ss or netstat output to extract listening ports
     */
    private parseListeningPorts(output: string): import('../types/portForward.types').RemoteListeningPort[] {
        const ports: import('../types/portForward.types').RemoteListeningPort[] = [];
        const lines = output.split('\n');
        const portMap = new Map<number, import('../types/portForward.types').RemoteListeningPort>();

        for (const line of lines) {
            // Skip header lines
            if (line.startsWith('State') || line.startsWith('Active') || line.startsWith('Proto') || !line.trim()) {
                continue;
            }

            // Parse ss output format:
            // LISTEN 0 128 0.0.0.0:8080 0.0.0.0:* users:(("node",pid=1234,fd=20))
            // or netstat format:
            // tcp 0 0 0.0.0.0:8080 0.0.0.0:* LISTEN 1234/node

            const ssRegex = /LISTEN\s+\S+\s+\S+\s+([\d.a-f:]+):(\d+).*?users:\(\("([^"]+)",pid=(\d+)/;
            const ssMatch = ssRegex.exec(line);
            if (ssMatch) {
                const [, listenAddr, portStr, processName, pidStr] = ssMatch;
                const port = Number.parseInt(portStr, 10);
                const pid = Number.parseInt(pidStr, 10);

                if (!portMap.has(port)) {
                    portMap.set(port, {
                        port,
                        pid,
                        processName,
                        listenAddress: listenAddr,
                        isForwarded: this.isPortForwarded(port)
                    });
                }
                continue;
            }

            const netstatRegex = /tcp\s+\S+\s+\S+\s+([\d.a-f:]+):(\d+).*?LISTEN\s+(\d+)\/(\S+)/;
            const netstatMatch = netstatRegex.exec(line);
            if (netstatMatch) {
                const [, listenAddr, portStr, pidStr, processName] = netstatMatch;
                const port = Number.parseInt(portStr, 10);
                const pid = Number.parseInt(pidStr, 10);

                if (!portMap.has(port)) {
                    portMap.set(port, {
                        port,
                        pid,
                        processName: processName.replace(/^-/, ''),
                        listenAddress: listenAddr,
                        isForwarded: this.isPortForwarded(port)
                    });
                }
            }
        }

        return Array.from(portMap.values()).sort((a, b) => a.port - b.port);
    }

    /**
     * Check if a port is already being forwarded
     */
    private isPortForwarded(port: number): boolean {
        return Array.from(this.forwardings.values()).some(
            f => f.remotePort === port && f.status === 'active'
        );
    }

    /**
     * Check if a local port is being forwarded (for remote forwarding)
     */
    private isLocalPortForwarded(port: number): boolean {
        return Array.from(this.forwardings.values()).some(
            f => f.localPort === port && f.forwardType === 'remote' && f.status === 'active'
        );
    }

    /**
     * Scan local machine for listening ports
     * Used for Remote Forwarding to show available local services
     */
    public async scanLocalPorts(): Promise<import('../types/portForward.types').RemoteListeningPort[]> {
        return new Promise((resolve, reject) => {
            const { exec } = require('child_process');
            const os = require('os');

            // Different commands for different platforms
            let command: string;
            if (os.platform() === 'win32') {
                command = 'netstat -ano | findstr "LISTENING"';
            } else {
                command = 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "UNSUPPORTED"';
            }

            exec(command, { maxBuffer: 1024 * 1024 }, (error: any, stdout: string, stderr: string) => {
                if (error) {
                    logger.error(`Failed to scan local ports: ${error.message}`);
                    resolve([]);
                    return;
                }

                if (stdout.includes('UNSUPPORTED')) {
                    logger.warn('Neither ss nor netstat command available');
                    resolve([]);
                    return;
                }

                const ports = this.parseLocalListeningPorts(stdout, os.platform());
                resolve(ports);
            });
        });
    }

    /**
     * Parse local listening ports from command output
     */
    private parseLocalListeningPorts(output: string, platform: string): import('../types/portForward.types').RemoteListeningPort[] {
        const portMap = new Map<number, import('../types/portForward.types').RemoteListeningPort>();
        const lines = output.split('\n');

        for (const line of lines) {
            if (!line.trim()) continue;

            if (platform === 'win32') {
                // Windows netstat format: TCP 0.0.0.0:8080 0.0.0.0:0 LISTENING 1234
                const winRegex = /TCP\s+([\d.]+):(\d+).*?LISTENING\s+(\d+)/i;
                const winMatch = winRegex.exec(line);
                if (winMatch) {
                    const [, listenAddr, portStr, pidStr] = winMatch;
                    const port = Number.parseInt(portStr, 10);
                    const pid = Number.parseInt(pidStr, 10);

                    if (!portMap.has(port) && port > 0) {
                        portMap.set(port, {
                            port,
                            pid,
                            listenAddress: listenAddr,
                            isForwarded: this.isLocalPortForwarded(port)
                        });
                    }
                }
            } else {
                // Linux ss format: LISTEN 0 128 0.0.0.0:8080 0.0.0.0:* users:(("node",pid=1234,fd=20))
                const ssRegex = /LISTEN\s+\S+\s+\S+\s+([\d.:*]+):(\d+).*?users:\(\("([^"]+)",pid=(\d+)/;
                const ssMatch = ssRegex.exec(line);
                if (ssMatch) {
                    const [, listenAddr, portStr, processName, pidStr] = ssMatch;
                    const port = Number.parseInt(portStr, 10);
                    const pid = Number.parseInt(pidStr, 10);

                    if (!portMap.has(port) && port > 0) {
                        portMap.set(port, {
                            port,
                            pid,
                            processName,
                            listenAddress: listenAddr,
                            isForwarded: this.isLocalPortForwarded(port)
                        });
                    }
                    continue;
                }

                // Linux netstat format: tcp 0 0 0.0.0.0:8080 0.0.0.0:* LISTEN 1234/node
                const netstatRegex = /tcp\s+\S+\s+\S+\s+([\d.:*]+):(\d+).*?LISTEN\s+(\d+)\/(\S+)/;
                const netstatMatch = netstatRegex.exec(line);
                if (netstatMatch) {
                    const [, listenAddr, portStr, pidStr, processName] = netstatMatch;
                    const port = Number.parseInt(portStr, 10);
                    const pid = Number.parseInt(pidStr, 10);

                    if (!portMap.has(port) && port > 0) {
                        portMap.set(port, {
                            port,
                            pid,
                            processName: processName.replace(/^-/, ''),
                            listenAddress: listenAddr,
                            isForwarded: this.isLocalPortForwarded(port)
                        });
                    }
                }
            }
        }

        return Array.from(portMap.values()).sort((a, b) => a.port - b.port);
    }

    /**
     * Dispose all resources
     */
    public dispose(): void {
        this.stopAll();
        this.eventEmitter.dispose();
    }
}
