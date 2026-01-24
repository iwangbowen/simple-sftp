import { Client, ConnectConfig } from 'ssh2';
import * as fs from 'fs';
import * as os from 'os';
import { logger } from '../logger';
import { HostAuthConfig, JumpHostConfig } from '../types';

/**
 * Add authentication configuration to ConnectConfig
 */
export function addAuthToConnectConfig(connectConfig: ConnectConfig, authConfig: HostAuthConfig): void {
  if (authConfig.authType === 'password' && authConfig.password) {
    connectConfig.password = authConfig.password;
  } else if (authConfig.authType === 'privateKey' && authConfig.privateKeyPath) {
    const privateKeyPath = authConfig.privateKeyPath.replace('~', os.homedir());
    if (fs.existsSync(privateKeyPath)) {
      connectConfig.privateKey = fs.readFileSync(privateKeyPath);
      if (authConfig.passphrase) {
        connectConfig.passphrase = authConfig.passphrase;
      }
    }
  } else if (authConfig.authType === 'agent') {
    // SSH Agent support
    // On Windows, try named pipe first, then environment variable
    // On Unix, use SSH_AUTH_SOCK environment variable
    if (process.platform === 'win32') {
      // Windows: Try named pipe for SSH Agent
      const agentPath = String.raw`\\.\pipe\openssh-ssh-agent`;
      connectConfig.agent = agentPath;
    } else {
      // Unix/WSL: Use SSH_AUTH_SOCK
      if (!process.env.SSH_AUTH_SOCK) {
        throw new Error(
          'SSH Agent not running. Please start SSH Agent:\n\n' +
          '  eval "$(ssh-agent -s)"\n' +
          '  ssh-add ~/.ssh/id_rsa\n\n' +
          'Or use Private Key authentication instead.'
        );
      }
      connectConfig.agent = process.env.SSH_AUTH_SOCK;
    }
  }
}

/**
 * Establish connection through jump host (async)
 * Returns a stream that can be used as sock for the target connection
 *
 * @param jumpHost - Jump host configuration
 * @param targetHost - Target server hostname/IP
 * @param targetPort - Target server port
 * @returns Promise with stream (for sock) and jumpConn (for cleanup)
 */
export async function establishJumpHostConnection(
  jumpHost: JumpHostConfig,
  targetHost: string,
  targetPort: number
): Promise<{ stream: any; jumpConn: Client }> {
  return new Promise((resolve, reject) => {
    const jumpConn = new Client();

    // Build jump host connection config
    const jumpConfig: ConnectConfig = {
      host: jumpHost.host,
      port: jumpHost.port,
      username: jumpHost.username,
      readyTimeout: 30000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    };

    // Add jump host authentication
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

      // Create forwarding stream through jump host to target server
      jumpConn.forwardOut(
        '127.0.0.1',  // Source address (arbitrary local address)
        0,            // Source port (arbitrary)
        targetHost,   // Target server address
        targetPort,   // Target server port
        (err, stream) => {
          if (err) {
            logger.error(`Failed to create forwarding stream: ${err.message}`);
            jumpConn.end();
            reject(err);
            return;
          }

          logger.info('Forwarding stream created successfully');
          // Return both the stream and jump connection
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
