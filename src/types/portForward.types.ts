export interface PortForwardConfig {
    /** Remote port to forward */
    remotePort: number;
    /** Local port to bind to (optional, will auto-assign if not specified) */
    localPort?: number;
    /** Local host to bind to (default: 127.0.0.1) */
    localHost?: string;
    /** Remote host to forward to (default: localhost on remote) */
    remoteHost?: string;
    /** Description or label for this forwarding */
    label?: string;
}

export interface PortForwarding {
    /** Unique ID for this forwarding */
    id: string;
    /** Remote host configuration ID */
    hostId: string;
    /** Remote port */
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
}

export interface PortForwardingEvent {
    type: 'started' | 'stopped' | 'error';
    forwarding: PortForwarding;
    error?: string;
}
