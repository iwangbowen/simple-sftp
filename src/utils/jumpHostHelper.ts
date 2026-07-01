import { Client, ConnectConfig } from 'ssh2';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { logger } from '../logger';
import { HostAuthConfig, JumpHostConfig } from '../types';

/**
 * Build `ssh` CLI arguments that route the connection through one or more jump hosts
 * using OpenSSH's `-J` (ProxyJump) flag. Returns an empty array when no jump hosts are
 * configured.
 *
 * Note: per `ssh(1)`, options supplied on the command line (e.g. `-i`) apply to the
 * destination host only, not to jump hosts. Jump hosts authenticate using the default
 * identity files / ssh-agent, or interactively prompt for a password when needed.
 */
export function buildProxyJumpArgs(jumpHosts?: JumpHostConfig[]): string[] {
  if (!jumpHosts || jumpHosts.length === 0) {
    return [];
  }

  const destinations = jumpHosts.map(jh => `${jh.username}@${jh.host}:${jh.port}`).join(',');
  return ['-J', destinations];
}

/**
 * Add authentication configuration to ConnectConfig
 */
export function addAuthToConnectConfig(connectConfig: ConnectConfig, authConfig: HostAuthConfig): void {
  logger.debug(`[Auth] Adding authentication: type=${authConfig.authType}`);

  if (authConfig.authType === 'password' && authConfig.password) {
    logger.debug('[Auth] Using password authentication');
    connectConfig.password = authConfig.password;
  } else if (authConfig.authType === 'privateKey' && authConfig.privateKeyPath) {
    const privateKeyPath = authConfig.privateKeyPath.replace(/^~/, os.homedir());
    logger.debug(`[Auth] Using private key: ${privateKeyPath}`);

    if (fs.existsSync(privateKeyPath)) {
      connectConfig.privateKey = fs.readFileSync(privateKeyPath);
      if (authConfig.passphrase) {
        logger.debug('[Auth] Private key has passphrase');
        connectConfig.passphrase = authConfig.passphrase;
      }
      logger.debug('[Auth] Private key loaded successfully');
    } else {
      const error = `Private key file not found: ${privateKeyPath}`;
      logger.error(`[Auth] ${error}`);
      throw new Error(error);
    }
  } else if (authConfig.authType === 'agent') {
    logger.debug('[Auth] Using SSH Agent');
    if (process.platform === 'win32') {
      const agentPath = String.raw`\\.\pipe\openssh-ssh-agent`;
      connectConfig.agent = agentPath;
      logger.debug(`[Auth] SSH Agent path (Windows): ${agentPath}`);
    } else {
      if (!process.env.SSH_AUTH_SOCK) {
        throw new Error(
          'SSH Agent not running. Please start SSH Agent:\n\n' +
          '  eval "$(ssh-agent -s)"\n' +
          '  ssh-add ~/.ssh/id_rsa\n\n' +
          'Or use Private Key authentication instead.'
        );
      }
      connectConfig.agent = process.env.SSH_AUTH_SOCK;
      logger.debug(`[Auth] SSH Agent path (Unix): ${process.env.SSH_AUTH_SOCK}`);
    }
  } else {
    const error = `Invalid or incomplete authentication configuration: type=${authConfig.authType}, hasPassword=${!!authConfig.password}, hasPrivateKey=${!!authConfig.privateKeyPath}`;
    logger.error(`[Auth] ${error}`);
    throw new Error(error);
  }
}

/**
 * Establish connection through a single jump host
 */
export async function establishJumpHostConnection(
  jumpHost: JumpHostConfig,
  targetHost: string,
  targetPort: number
): Promise<{ stream: any; jumpConn: Client }> {
  return new Promise((resolve, reject) => {
    const jumpConn = new Client();

    const jumpConfig: ConnectConfig = {
      host: jumpHost.host,
      port: jumpHost.port,
      username: jumpHost.username,
      readyTimeout: 30000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    };

    const jumpAuthConfig: HostAuthConfig = {
      hostId: 'jump',
      authType: jumpHost.authType,
      password: jumpHost.password,
      privateKeyPath: jumpHost.privateKeyPath,
      passphrase: jumpHost.passphrase
    };
    addAuthToConnectConfig(jumpConfig, jumpAuthConfig);

    jumpConn.on('ready', () => {
      logger.info(`Jump host connection established, forwarding to ${targetHost}:${targetPort}`);

      logger.debug(`[JumpHost] Calling forwardOut to ${targetHost}:${targetPort}...`);
      jumpConn.forwardOut(
        '127.0.0.1',
        0,
        targetHost,
        targetPort,
        (err, stream) => {
          logger.debug(`[JumpHost] forwardOut callback received, err=${err ? err.message : 'none'}`);
          if (err) {
            logger.error(`Failed to create forwarding stream: ${err.message}`);
            jumpConn.end();
            reject(err);
            return;
          }

          logger.info('Forwarding stream created successfully');
          resolve({ stream, jumpConn });
        }
      );
    });

    jumpConn.on('error', (err) => {
      logger.error(`Jump host connection error: ${err.message}`);
      reject(err);
    });

    logger.info(`Connecting to jump host: ${jumpHost.username}@${jumpHost.host}:${jumpHost.port}`);
    jumpConn.connect(jumpConfig);
  });
}

/**
 * Establish multi-hop jump host connections
 * Supports chaining: JumpHost1 → JumpHost2 → ... → Target
 */
export async function establishMultiHopConnection(
  jumpHosts: JumpHostConfig[],
  targetHost: string,
  targetPort: number
): Promise<{ stream: any; jumpConns: Client[] }> {
  if (!jumpHosts || jumpHosts.length === 0) {
    throw new Error('No jump hosts provided');
  }

  if (jumpHosts.length === 1) {
    // Single hop - use the simpler function
    const { stream, jumpConn } = await establishJumpHostConnection(jumpHosts[0], targetHost, targetPort);
    return { stream, jumpConns: [jumpConn] };
  }

  logger.info(`[MultiHop] Establishing ${jumpHosts.length}-hop connection chain`);
  const jumpConns: Client[] = [];

  try {
    let sock: any = undefined;

    // Connect through each jump host in sequence
    for (let i = 0; i < jumpHosts.length; i++) {
      const jumpHost = jumpHosts[i];
      const isLastHop = (i === jumpHosts.length - 1);
      const nextHost = isLastHop ? targetHost : jumpHosts[i + 1].host;
      const nextPort = isLastHop ? targetPort : jumpHosts[i + 1].port;

      logger.info(`[MultiHop ${i + 1}/${jumpHosts.length}] Connecting to ${jumpHost.username}@${jumpHost.host}:${jumpHost.port}`);

      // Connect to this jump host (possibly through previous sock)
      const jumpConn = await connectThroughSock(jumpHost, sock);
      jumpConns.push(jumpConn);

      // Create forward stream for the next hop
      logger.info(`[MultiHop ${i + 1}/${jumpHosts.length}] Creating forward stream to ${nextHost}:${nextPort}`);
      const stream = await createForwardStream(jumpConn, nextHost, nextPort);
      sock = stream;  // This stream becomes the sock for the next connection
    }

    logger.info('[MultiHop] All jump host connections established, final stream ready');
    return { stream: sock, jumpConns };
  } catch (error) {
    logger.error('[MultiHop] Failed to establish connection chain, cleaning up');
    jumpConns.forEach(conn => {
      try {
        conn.end();
      } catch (e) {
        logger.debug(`[MultiHop] Error during cleanup: ${(e as Error).message}`);
      }
    });
    throw error;
  }
}

/**
 * Connect to a jump host, optionally through a previous sock
 */
function connectThroughSock(
  jumpHost: JumpHostConfig,
  sock?: any
): Promise<Client> {
  return new Promise((resolve, reject) => {
    const jumpConn = new Client();

    const jumpConfig: ConnectConfig = {
      host: jumpHost.host,
      port: jumpHost.port,
      username: jumpHost.username,
      readyTimeout: 30000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    };

    // If sock is provided, use it (for nested jump hosts)
    if (sock) {
      jumpConfig.sock = sock;
    }

    // Add authentication
    const jumpAuthConfig: HostAuthConfig = {
      hostId: 'jump',
      authType: jumpHost.authType,
      password: jumpHost.password,
      privateKeyPath: jumpHost.privateKeyPath,
      passphrase: jumpHost.passphrase
    };
    addAuthToConnectConfig(jumpConfig, jumpAuthConfig);

    jumpConn.on('ready', () => {
      logger.info(`Jump host ${jumpHost.host} connected and ready`);
      resolve(jumpConn);
    });

    jumpConn.on('error', (err) => {
      logger.error(`Jump host ${jumpHost.host} connection error: ${err.message}`);
      reject(err);
    });

    logger.debug(`Connecting to jump host ${jumpHost.host}${sock ? ' (through previous hop)' : ''}`);
    jumpConn.connect(jumpConfig);
  });
}

/**
 * Create a forward stream through a jump host connection
 */
function createForwardStream(
  jumpConn: Client,
  targetHost: string,
  targetPort: number
): Promise<any> {
  return new Promise((resolve, reject) => {
    jumpConn.forwardOut(
      '127.0.0.1',
      0,
      targetHost,
      targetPort,
      (err, stream) => {
        if (err) {
          logger.error(`Failed to create forwarding stream to ${targetHost}:${targetPort}: ${err.message}`);
          reject(err);
          return;
        }
        logger.debug(`Forward stream created to ${targetHost}:${targetPort}`);
        resolve(stream);
      }
    );
  });
}

/**
 * Per-hop progress report for a connection test
 */
export interface ConnectionTestStep {
  /** 0-based index of this hop */
  index: number;
  /** Total number of hops (jumpHosts.length + 1) */
  total: number;
  type: 'jumpHost' | 'target';
  /** e.g. "Jump Host 1" or "Target" */
  label: string;
  host: string;
  port: number;
  status: 'testing' | 'success' | 'error';
  error?: string;
  durationMs?: number;
}

/**
 * Test a multi-hop SSH connection one hop at a time, reporting each result via onStep.
 * The targetConnectConfig should NOT have a sock set; this function sets it internally.
 */
export async function testMultiHopWithProgress(
  jumpHosts: JumpHostConfig[],
  targetHost: string,
  targetPort: number,
  targetConnectConfig: ConnectConfig,
  onStep: (step: ConnectionTestStep) => void
): Promise<void> {
  const totalSteps = jumpHosts.length + 1;
  const jumpConns: Client[] = [];

  try {
    let sock: any = undefined;

    for (let i = 0; i < jumpHosts.length; i++) {
      const jumpHost = jumpHosts[i];
      const isLastJump = i === jumpHosts.length - 1;
      const nextHost = isLastJump ? targetHost : jumpHosts[i + 1].host;
      const nextPort = isLastJump ? targetPort : jumpHosts[i + 1].port;

      onStep({ index: i, total: totalSteps, type: 'jumpHost', label: `Jump Host ${i + 1}`, host: jumpHost.host, port: jumpHost.port, status: 'testing' });

      const start = Date.now();
      try {
        const jumpConn = await connectThroughSock(jumpHost, sock);
        jumpConns.push(jumpConn);

        const stream = await createForwardStream(jumpConn, nextHost, nextPort);
        sock = stream;

        // Report success only after forwarding stream is confirmed working
        onStep({ index: i, total: totalSteps, type: 'jumpHost', label: `Jump Host ${i + 1}`, host: jumpHost.host, port: jumpHost.port, status: 'success', durationMs: Date.now() - start });
      } catch (err) {
        onStep({ index: i, total: totalSteps, type: 'jumpHost', label: `Jump Host ${i + 1}`, host: jumpHost.host, port: jumpHost.port, status: 'error', error: (err as Error).message, durationMs: Date.now() - start });
        throw err;
      }
    }

    // Test the final target connection
    onStep({ index: jumpHosts.length, total: totalSteps, type: 'target', label: 'Target', host: targetHost, port: targetPort, status: 'testing' });

    const start = Date.now();
    const conn = new Client();
    if (sock) {
      targetConnectConfig.sock = sock;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          conn.end();
          reject(new Error('Connection timeout'));
        }, 30000);

        conn
          .on('ready', () => {
            clearTimeout(timer);
            conn.end();
            resolve();
          })
          .on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          })
          .connect(targetConnectConfig);
      });

      onStep({ index: jumpHosts.length, total: totalSteps, type: 'target', label: 'Target', host: targetHost, port: targetPort, status: 'success', durationMs: Date.now() - start });
    } catch (err) {
      onStep({ index: jumpHosts.length, total: totalSteps, type: 'target', label: 'Target', host: targetHost, port: targetPort, status: 'error', error: (err as Error).message, durationMs: Date.now() - start });
      throw err;
    }
  } finally {
    jumpConns.forEach(c => { try { c.end(); } catch { /* ignore cleanup errors */ } });
  }
}
