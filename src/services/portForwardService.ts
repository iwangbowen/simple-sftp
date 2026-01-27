import * as vscode from 'vscode';
import { Client, ConnectConfig } from 'ssh2';
import { randomUUID } from 'crypto';
import { PortForwardConfig, PortForwarding, PortForwardingEvent } from '../types/portForward.types';
import { HostConfig, HostAuthConfig } from '../types';
import { logger } from '../logger';
import { addAuthToConnectConfig } from '../utils/jumpHostHelper';

export class PortForwardService {
    private static instance: PortForwardService;
    private forwardings: Map<string, PortForwarding> = new Map();
    private sshClients: Map<string, Client> = new Map();
    private eventEmitter: vscode.EventEmitter<PortForwardingEvent>;
    public readonly onPortForwardingEvent: vscode.Event<PortForwardingEvent>;

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

        // Check if forwarding already exists for this remote port
        const existing = Array.from(this.forwardings.values()).find(
            f => f.hostId === hostConfig.name &&
                f.remotePort === config.remotePort &&
                f.status === 'active'
        );

        if (existing) {
            throw new Error(`Port ${config.remotePort} is already being forwarded to local port ${existing.localPort}`);
        }

        const forwarding: PortForwarding = {
            id,
            hostId: hostConfig.name,
            remotePort: config.remotePort,
            localPort: config.localPort || 0, // Will be assigned by system if 0
            localHost,
            remoteHost,
            status: 'inactive',
            label: config.label,
            origin: 'manual',
            createdAt: Date.now()
        };

        try {
            // Create SSH client
            const client = await this.createSSHClient(hostConfig, authConfig);
            this.sshClients.set(id, client);

            // Request port forwarding
            await new Promise<void>((resolve, reject) => {
                client.on('ready', () => {
                    // Use forwardIn for reverse port forwarding (remote -> local)
                    // or use local port forwarding (local -> remote)
                    // For most use cases, we want local port forwarding
                    const net = require('net');
                    const server = net.createServer((socket: any) => {
                        // Forward connections to remote
                        client.forwardOut(
                            localHost,
                            forwarding.localPort,
                            remoteHost,
                            config.remotePort,
                            (err: Error, stream: any) => {
                                if (err) {
                                    logger.error(`Port forward error: ${err.message}`);
                                    socket.end();
                                    return;
                                }
                                socket.pipe(stream).pipe(socket);
                            }
                        );
                    });

                    server.listen(config.localPort || 0, localHost, () => {
                        const addr = server.address() as any;
                        forwarding.localPort = addr.port;
                        forwarding.status = 'active';
                        logger.info(`Port forwarding started: ${localHost}:${forwarding.localPort} -> ${remoteHost}:${config.remotePort}`);
                        resolve();
                    });

                    server.on('error', (err: Error) => {
                        logger.error(`Port forward server error: ${err.message}`);
                        forwarding.status = 'error';
                        forwarding.error = err.message;
                        reject(err);
                    });

                    // Store server reference for cleanup
                    (client as any)._forwardServer = server;
                });

                client.on('error', (err: Error) => {
                    logger.error(`SSH client error during port forwarding: ${err.message}`);
                    forwarding.status = 'error';
                    forwarding.error = err.message;
                    reject(err);
                });
            });

            this.forwardings.set(id, forwarding);

            this.eventEmitter.fire({
                type: 'started',
                forwarding
            });

            return forwarding;

        } catch (error: any) {
            forwarding.status = 'error';
            forwarding.error = error.message;
            this.forwardings.set(id, forwarding);

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
            // Close the forward server
            const server = (client as any)._forwardServer;
            if (server) {
                server.close();
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
     * Dispose all resources
     */
    public dispose(): void {
        this.stopAll();
        this.eventEmitter.dispose();
    }
}
