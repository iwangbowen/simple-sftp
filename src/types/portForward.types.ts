/** Type of port forwarding */
export type ForwardType = 'local' | 'remote' | 'dynamic';

export interface PortForwardConfig {
    /** Remote port to forward (for local forwarding) or bind on remote (for remote forwarding) */
    remotePort: number;
    /** Local port to bind to (optional, will auto-assign if not specified) */
    localPort?: number;
    /** Local host to bind to (default: 127.0.0.1) */
    localHost?: string;
    /** Remote host to forward to (default: localhost on remote) */
    remoteHost?: string;
    /** Description or label for this forwarding */
    label?: string;
    /** Type of forwarding (default: 'local') */
    forwardType?: ForwardType;
    /** Origin (manual or auto) */
    origin?: 'manual' | 'auto';
}

/** Configuration for remote forwarding (-R) */
export interface RemoteForwardConfig {
    /** Port to bind on remote server */
    remotePort: number;
    /** Local port to forward to */
    localPort: number;
    /** Remote host to bind on (default: 127.0.0.1) */
    remoteHost?: string;
    /** Local host to forward to (default: localhost) */
    localHost?: string;
    /** Description or label for this forwarding */
    label?: string;
}

/** Configuration for dynamic forwarding (-D / SOCKS5 proxy) */
export interface DynamicForwardConfig {
    /** Local port for SOCKS5 proxy */
    localPort: number;
    /** Local host to bind to (default: 127.0.0.1) */
    localHost?: string;
    /** Description or label for this forwarding */
    label?: string;
}

export interface PortForwarding {
    /** Unique ID for this forwarding */
    id: string;
    /** Remote host configuration ID */
    hostId: string;
    /** Remote port (for local/remote forwarding) */
    remotePort: number;
    /** Local port actually bound */
    localPort: number;
    /** Local host bound to */
    localHost: string;
    /** Remote host forwarded to */
    remoteHost: string;
    /** Status */
    status: 'active' | 'inactive' | 'error';
    /** Error message if status is 'error' */
    error?: string;
    /** Optional label */
    label?: string;
    /** Running process info (if detectable) */
    runningProcess?: string;
    /** Origin (Auto Forwarded, Manual, etc.) */
    origin: 'manual' | 'auto';
    /** Creation timestamp */
    createdAt: number;
    /** Type of forwarding (default: 'local') */
    forwardType: ForwardType;
}

export interface PortForwardingEvent {
    type: 'started' | 'stopped' | 'error' | 'deleted';
    forwarding: PortForwarding;
    error?: string;
}

export interface RemoteListeningPort {
    /** Port number */
    port: number;
    /** Process ID */
    pid?: number;
    /** Process name */
    processName?: string;
    /** Process command */
    command?: string;
    /** Listen address (e.g., 0.0.0.0, 127.0.0.1, ::) */
    listenAddress?: string;
    /** Whether this port is already being forwarded */
    isForwarded?: boolean;
}
