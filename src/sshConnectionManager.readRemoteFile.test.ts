import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SshConnectionManager } from './sshConnectionManager';
import { HostConfig, HostAuthConfig } from './types';

// Mock ssh2-sftp-client
vi.mock('ssh2-sftp-client', () => {
    return {
        default: vi.fn()
    };
});

describe('SshConnectionManager - readRemoteFile', () => {
    const mockHostConfig: HostConfig = {
        id: 'test-host',
        name: 'Test Host',
        host: 'example.com',
        port: 22,
        username: 'testuser',
        defaultRemotePath: '/home/testuser'
    };

    const mockAuthConfig: HostAuthConfig = {
        authType: 'password',
        password: 'testpassword'
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should read remote file content', async () => {
        const mockContent = Buffer.from('Hello, World!', 'utf-8');
        const remotePath = '/home/testuser/test.txt';

        // Mock the SFTP get method
        const mockSftpClient = {
            get: vi.fn().mockResolvedValue(mockContent)
        };

        // Mock the connection pool's getConnection method
        const mockGetConnection = vi.fn().mockResolvedValue({
            client: {} as any,
            sftpClient: mockSftpClient,
            connectionId: 'test-connection-id'
        });

        const mockReleaseConnection = vi.fn();

        // Access and mock the private connectionPool property
        (SshConnectionManager as any).connectionPool = {
            getConnection: mockGetConnection,
            releaseConnection: mockReleaseConnection
        };

        // Call the method
        const result = await SshConnectionManager.readRemoteFile(
            mockHostConfig,
            mockAuthConfig,
            remotePath
        );

        // Verify the result
        expect(result).toBeInstanceOf(Buffer);
        expect(result.toString('utf-8')).toBe('Hello, World!');
        expect(mockSftpClient.get).toHaveBeenCalledWith(remotePath);
        expect(mockReleaseConnection).toHaveBeenCalledWith(mockHostConfig);
    });

    it('should handle errors when reading remote file', async () => {
        const remotePath = '/home/testuser/nonexistent.txt';
        const mockError = new Error('File not found');

        // Mock the SFTP get method to throw an error
        const mockSftpClient = {
            get: vi.fn().mockRejectedValue(mockError)
        };

        // Mock the connection pool's getConnection method
        const mockGetConnection = vi.fn().mockResolvedValue({
            client: {} as any,
            sftpClient: mockSftpClient,
            connectionId: 'test-connection-id'
        });

        const mockReleaseConnection = vi.fn();

        // Access and mock the private connectionPool property
        (SshConnectionManager as any).connectionPool = {
            getConnection: mockGetConnection,
            releaseConnection: mockReleaseConnection
        };

        // Call the method and expect it to throw
        await expect(
            SshConnectionManager.readRemoteFile(
                mockHostConfig,
                mockAuthConfig,
                remotePath
            )
        ).rejects.toThrow('File not found');

        // Verify releaseConnection was still called
        expect(mockReleaseConnection).toHaveBeenCalledWith(mockHostConfig);
    });
});
