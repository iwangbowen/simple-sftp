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
        hostId: 'test-host',
        authType: 'password',
        password: 'testpassword'
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should read remote file content', async () => {
        const mockContent = Buffer.from('Hello, World!', 'utf-8');
        const remotePath = '/home/testuser/test.txt';

        // Mock the SFTP stat and get methods
        const mockSftpClient = {
            stat: vi.fn().mockResolvedValue({ size: mockContent.length }), // Add stat mock
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
        expect(mockSftpClient.stat).toHaveBeenCalledWith(remotePath); // Verify stat was called
        expect(mockSftpClient.get).toHaveBeenCalledWith(remotePath);
        expect(mockReleaseConnection).toHaveBeenCalledWith(mockHostConfig);
    });

    it('should handle errors when reading remote file', async () => {
        const remotePath = '/home/testuser/nonexistent.txt';
        const mockError = new Error('File not found');

        // Mock the SFTP stat to throw an error
        const mockSftpClient = {
            stat: vi.fn().mockRejectedValue(mockError),
            get: vi.fn()
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

        // Verify that stat was called and get was not called
        expect(mockSftpClient.stat).toHaveBeenCalledWith(remotePath);
        expect(mockSftpClient.get).not.toHaveBeenCalled();
        // Verify releaseConnection was still called
        expect(mockReleaseConnection).toHaveBeenCalledWith(mockHostConfig);
    });
});
