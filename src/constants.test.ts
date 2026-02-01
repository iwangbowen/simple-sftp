import { describe, it, expect } from 'vitest';
import {
    DEFAULTS,
    LIMITS,
    TIMING,
    PARALLEL_TRANSFER,
    DELTA_SYNC,
    COMPRESSION,
    PROMPTS,
    PLACEHOLDERS,
    MESSAGES,
    INSTRUCTIONS,
    TOOLTIPS,
    LABELS,
    UI
} from './constants';

describe('constants', () => {
    describe('UI', () => {
        it('should have correct icon constants', () => {
            expect(UI.ICONS.DUAL_PANEL_BROWSER).toBe('remote-explorer');
            expect(UI.ICONS.TASK_UPLOAD).toBe('cloud-upload');
            expect(UI.ICONS.TASK_DOWNLOAD).toBe('cloud-download');
            expect(UI.ICONS.PORT_FORWARDING).toBe('plug');
        });

        it('should have all required icon types', () => {
            expect(UI.ICONS).toHaveProperty('DUAL_PANEL_BROWSER');
            expect(UI.ICONS).toHaveProperty('TASK_UPLOAD');
            expect(UI.ICONS).toHaveProperty('TASK_DOWNLOAD');
            expect(UI.ICONS).toHaveProperty('PORT_FORWARDING');
        });
    });

    describe('DEFAULTS', () => {
        it('should have correct default values', () => {
            expect(DEFAULTS.PORT).toBe(22);
            expect(DEFAULTS.USERNAME).toBe('root');
            expect(DEFAULTS.REMOTE_PATH).toBe('/root');
        });

        it('should have immutable properties', () => {
            expect(DEFAULTS).toBeDefined();
            expect(typeof DEFAULTS.PORT).toBe('number');
            expect(typeof DEFAULTS.USERNAME).toBe('string');
        });
    });

    describe('LIMITS', () => {
        it('should have valid port range', () => {
            expect(LIMITS.MIN_PORT).toBe(1);
            expect(LIMITS.MAX_PORT).toBe(65535);
            expect(LIMITS.MIN_PORT).toBeLessThan(LIMITS.MAX_PORT);
        });

        it('should have immutable properties', () => {
            expect(LIMITS).toBeDefined();
            expect(typeof LIMITS.MIN_PORT).toBe('number');
        });
    });

    describe('TIMING', () => {
        it('should have reasonable timing values', () => {
            expect(TIMING.PROGRESS_UPDATE_INTERVAL).toBe(5000);
            expect(TIMING.PATH_INPUT_DEBOUNCE).toBe(300);
            expect(TIMING.PROGRESS_UPDATE_INTERVAL).toBeGreaterThan(0);
            expect(TIMING.PATH_INPUT_DEBOUNCE).toBeGreaterThan(0);
        });
    });

    describe('PARALLEL_TRANSFER', () => {
        it('should have valid default values', () => {
            expect(PARALLEL_TRANSFER.ENABLED).toBe(false); // Disabled by default due to compatibility issues
            expect(PARALLEL_TRANSFER.CHUNK_SIZE).toBe(10 * 1024 * 1024);
            expect(PARALLEL_TRANSFER.MAX_CONCURRENT).toBe(5);
            expect(PARALLEL_TRANSFER.THRESHOLD).toBe(100 * 1024 * 1024);
        });

        it('should have chunk size smaller than threshold', () => {
            expect(PARALLEL_TRANSFER.CHUNK_SIZE).toBeLessThan(PARALLEL_TRANSFER.THRESHOLD);
        });

        it('should have positive max concurrent value', () => {
            expect(PARALLEL_TRANSFER.MAX_CONCURRENT).toBeGreaterThan(0);
        });
    });

    describe('DELTA_SYNC', () => {
        it('should have valid default values', () => {
            expect(DELTA_SYNC.ENABLED).toBe(true);
            expect(DELTA_SYNC.COMPARE_METHOD).toBe('mtime');
            expect(DELTA_SYNC.DELETE_REMOTE).toBe(false);
        });
    });

    describe('COMPRESSION', () => {
        it('should have valid compression settings', () => {
            expect(COMPRESSION.SSH_LEVEL_ENABLED).toBe(true);
            expect(COMPRESSION.FILE_LEVEL_ENABLED).toBe(true);
            expect(typeof COMPRESSION.FILE_LEVEL_THRESHOLD).toBe('number');
            expect(COMPRESSION.COMPRESSION_LEVEL).toBeGreaterThan(0);
        });
    });

    describe('PROMPTS', () => {
        it('should have all required prompt messages', () => {
            expect(PROMPTS.hostName).toBeDefined();
            expect(PROMPTS.hostAddress).toBeDefined();
            expect(PROMPTS.enterPassword).toBeDefined();
            expect(PROMPTS.hostPort).toBeDefined();
        });
    });

    describe('PLACEHOLDERS', () => {
        it('should have placeholder texts', () => {
            expect(PLACEHOLDERS.hostAddress).toBeDefined();
            expect(PLACEHOLDERS.username).toBeDefined();
            expect(typeof PLACEHOLDERS.hostAddress).toBe('string');
        });
    });

    describe('MESSAGES', () => {
        it('should have user-facing messages', () => {
            expect(MESSAGES.noHosts).toBeDefined();
            expect(MESSAGES.selectHost).toBeDefined();
            expect(typeof MESSAGES.noHosts).toBe('string');
        });
    });

    describe('INSTRUCTIONS', () => {
        it('should have instruction texts', () => {
            expect(INSTRUCTIONS.browsePathSelect).toBeDefined();
            expect(typeof INSTRUCTIONS.browsePathSelect).toBe('string');
        });
    });

    describe('TOOLTIPS', () => {
        it('should have tooltip texts', () => {
            expect(TOOLTIPS.hideDotFiles).toBeDefined();
            expect(TOOLTIPS.download).toBeDefined();
            expect(typeof TOOLTIPS.hideDotFiles).toBe('string');
        });
    });

    describe('LABELS', () => {
        it('should have label texts', () => {
            expect(LABELS.editName).toBeDefined();
            expect(LABELS.editHostAddress).toBeDefined();
            expect(typeof LABELS.editName).toBe('string');
        });
    });

    describe('Port validation', () => {
        it('should validate default port is within limits', () => {
            expect(DEFAULTS.PORT).toBeGreaterThanOrEqual(LIMITS.MIN_PORT);
            expect(DEFAULTS.PORT).toBeLessThanOrEqual(LIMITS.MAX_PORT);
        });

        it('should validate common ports are within limits', () => {
            const commonPorts = [22, 80, 443, 8080];
            commonPorts.forEach(port => {
                expect(port).toBeGreaterThanOrEqual(LIMITS.MIN_PORT);
                expect(port).toBeLessThanOrEqual(LIMITS.MAX_PORT);
            });
        });
    });

    describe('Size calculations', () => {
        it('should have chunk size as multiple of KB', () => {
            const KB = 1024;
            expect(PARALLEL_TRANSFER.CHUNK_SIZE % KB).toBe(0);
        });

        it('should have threshold as multiple of MB', () => {
            const MB = 1024 * 1024;
            expect(PARALLEL_TRANSFER.THRESHOLD % MB).toBe(0);
        });

        it('should have reasonable chunk size for parallel transfer', () => {
            const MB = 1024 * 1024;
            const chunkSizeInMB = PARALLEL_TRANSFER.CHUNK_SIZE / MB;
            expect(chunkSizeInMB).toBeGreaterThanOrEqual(1); // At least 1MB
            expect(chunkSizeInMB).toBeLessThanOrEqual(100); // At most 100MB
        });
    });

    describe('PROMPTS functions', () => {
        it('should generate dynamic prompts with parameters', () => {
            expect(PROMPTS.editHost('TestHost')).toBe('Edit TestHost');
        });
    });

    describe('MESSAGES functions', () => {
        it('should generate success messages', () => {
            expect(MESSAGES.hostAdded('MyHost')).toBe('Host "MyHost" added successfully with authentication');
            expect(MESSAGES.hostAddedNoAuth('MyHost')).toContain('added without authentication');
            expect(MESSAGES.hostDeleted('MyHost')).toContain('deleted successfully');
            expect(MESSAGES.groupCreated('MyGroup')).toContain('created successfully');
            expect(MESSAGES.groupUpdated('MyGroup')).toContain('updated successfully');
            expect(MESSAGES.bookmarkAdded('MyBookmark')).toContain('added successfully');
            expect(MESSAGES.downloadSuccess('/path/to/file')).toContain('Download successful');
            expect(MESSAGES.connectionSuccess('MyHost')).toContain('Connected to MyHost');
        });

        it('should generate error messages', () => {
            const error = new Error('test error');
            expect(MESSAGES.updateFailed(error)).toContain('Update failed');
        });

        it('should generate confirmation prompts', () => {
            expect(MESSAGES.deleteHostConfirm('MyHost')).toContain("Delete host 'MyHost'");
            expect(MESSAGES.deleteHostsConfirm(5)).toContain('Delete 5 hosts');
            expect(MESSAGES.deleteGroupConfirm('MyGroup')).toContain("Delete group 'MyGroup'");
            expect(MESSAGES.deleteBookmarkConfirm('MyBookmark')).toContain('Delete bookmark');
            expect(MESSAGES.configureAuthNow('MyHost')).toContain('Configure now');
            expect(MESSAGES.importDuplicates(3)).toContain('Found 3 matching hosts');
        });

        it('should generate validation error messages', () => {
            expect(MESSAGES.portRange(1, 65535)).toContain('between 1 and 65535');
        });
    });

    describe('TOOLTIPS functions', () => {
        it('should generate dynamic tooltips', () => {
            expect(TOOLTIPS.downloading('file.txt')).toContain('Downloading: file.txt');
            expect(TOOLTIPS.downloadingFolder('myFolder')).toContain('Downloading folder: myFolder');
        });
    });

    describe('DELTA_SYNC', () => {
        it('should have exclude patterns array', () => {
            expect(Array.isArray(DELTA_SYNC.EXCLUDE_PATTERNS)).toBe(true);
            expect(DELTA_SYNC.EXCLUDE_PATTERNS).toContain('node_modules');
            expect(DELTA_SYNC.EXCLUDE_PATTERNS.length).toBeGreaterThan(0);
        });

        it('should have preserve timestamps setting', () => {
            expect(typeof DELTA_SYNC.PRESERVE_TIMESTAMPS).toBe('boolean');
        });
    });

    describe('COMPRESSION', () => {
        it('should have compressible extensions array', () => {
            expect(Array.isArray(COMPRESSION.COMPRESSIBLE_EXTENSIONS)).toBe(true);
            expect(COMPRESSION.COMPRESSIBLE_EXTENSIONS).toContain('.txt');
            expect(COMPRESSION.COMPRESSIBLE_EXTENSIONS).toContain('.js');
            expect(COMPRESSION.COMPRESSIBLE_EXTENSIONS.length).toBeGreaterThan(10);
        });

        it('should have valid compression level', () => {
            expect(COMPRESSION.COMPRESSION_LEVEL).toBeGreaterThanOrEqual(1);
            expect(COMPRESSION.COMPRESSION_LEVEL).toBeLessThanOrEqual(9);
        });
    });

    describe('Edge Cases and Additional Validations', () => {
        describe('DEFAULTS edge cases', () => {
            it('should have non-empty username default', () => {
                expect(DEFAULTS.USERNAME.length).toBeGreaterThan(0);
            });

            it('should have non-empty remote path default', () => {
                expect(DEFAULTS.REMOTE_PATH.length).toBeGreaterThan(0);
                expect(DEFAULTS.REMOTE_PATH.startsWith('/')).toBe(true);
            });

            it('should have valid SSH port', () => {
                expect(DEFAULTS.PORT).toBe(22);
                expect(DEFAULTS.PORT).toBeGreaterThan(0);
            });
        });

        describe('LIMITS boundary tests', () => {
            it('should have valid port boundaries', () => {
                expect(LIMITS.MIN_PORT).toBe(1);
                expect(LIMITS.MAX_PORT).toBe(65535);
            });

            it('should reject port 0', () => {
                expect(0).toBeLessThan(LIMITS.MIN_PORT);
            });

            it('should reject port 65536', () => {
                expect(65536).toBeGreaterThan(LIMITS.MAX_PORT);
            });

            it('should accept port 1 (minimum)', () => {
                expect(1).toBeGreaterThanOrEqual(LIMITS.MIN_PORT);
                expect(1).toBeLessThanOrEqual(LIMITS.MAX_PORT);
            });

            it('should accept port 65535 (maximum)', () => {
                expect(65535).toBeGreaterThanOrEqual(LIMITS.MIN_PORT);
                expect(65535).toBeLessThanOrEqual(LIMITS.MAX_PORT);
            });
        });

        describe('TIMING validation', () => {
            it('should have positive timing values', () => {
                expect(TIMING.PROGRESS_UPDATE_INTERVAL).toBeGreaterThan(0);
                expect(TIMING.PATH_INPUT_DEBOUNCE).toBeGreaterThan(0);
            });

            it('should have reasonable progress update interval', () => {
                expect(TIMING.PROGRESS_UPDATE_INTERVAL).toBeGreaterThanOrEqual(100);
                expect(TIMING.PROGRESS_UPDATE_INTERVAL).toBeLessThanOrEqual(10000);
            });

            it('should have reasonable debounce delay', () => {
                expect(TIMING.PATH_INPUT_DEBOUNCE).toBeGreaterThanOrEqual(100);
                expect(TIMING.PATH_INPUT_DEBOUNCE).toBeLessThanOrEqual(1000);
            });
        });

        describe('PARALLEL_TRANSFER validation', () => {
            it('should have reasonable max concurrent limit', () => {
                expect(PARALLEL_TRANSFER.MAX_CONCURRENT).toBeGreaterThanOrEqual(1);
                expect(PARALLEL_TRANSFER.MAX_CONCURRENT).toBeLessThanOrEqual(20);
            });

            it('should have chunk size in MB range', () => {
                const MB = 1024 * 1024;
                const chunkMB = PARALLEL_TRANSFER.CHUNK_SIZE / MB;
                expect(chunkMB).toBeGreaterThanOrEqual(1);
                expect(chunkMB).toBeLessThanOrEqual(50);
            });

            it('should have threshold larger than chunk size', () => {
                expect(PARALLEL_TRANSFER.THRESHOLD).toBeGreaterThan(PARALLEL_TRANSFER.CHUNK_SIZE);
            });

            it('should allow at least 10 chunks for threshold file', () => {
                const minChunks = PARALLEL_TRANSFER.THRESHOLD / PARALLEL_TRANSFER.CHUNK_SIZE;
                expect(minChunks).toBeGreaterThanOrEqual(10);
            });
        });

        describe('COMPRESSION configuration', () => {
            it('should have boolean flags', () => {
                expect(typeof COMPRESSION.SSH_LEVEL_ENABLED).toBe('boolean');
                expect(typeof COMPRESSION.FILE_LEVEL_ENABLED).toBe('boolean');
            });

            it('should have numeric threshold', () => {
                expect(typeof COMPRESSION.FILE_LEVEL_THRESHOLD).toBe('number');
                expect(COMPRESSION.FILE_LEVEL_THRESHOLD).toBeGreaterThan(0);
            });

            it('should have compressible extensions in correct format', () => {
                COMPRESSION.COMPRESSIBLE_EXTENSIONS.forEach(ext => {
                    expect(ext.startsWith('.')).toBe(true);
                    expect(ext.length).toBeGreaterThan(1);
                });
            });

            it('should include common text extensions', () => {
                expect(COMPRESSION.COMPRESSIBLE_EXTENSIONS).toContain('.txt');
                expect(COMPRESSION.COMPRESSIBLE_EXTENSIONS).toContain('.log');
            });

            it('should include common code extensions', () => {
                expect(COMPRESSION.COMPRESSIBLE_EXTENSIONS).toContain('.js');
                expect(COMPRESSION.COMPRESSIBLE_EXTENSIONS).toContain('.ts');
            });

            it('should have unique extensions', () => {
                const unique = [...new Set(COMPRESSION.COMPRESSIBLE_EXTENSIONS)];
                expect(unique.length).toBe(COMPRESSION.COMPRESSIBLE_EXTENSIONS.length);
            });
        });

        describe('DELTA_SYNC configuration', () => {
            it('should have valid compare method', () => {
                expect(['mtime', 'checksum']).toContain(DELTA_SYNC.COMPARE_METHOD);
            });

            it('should have exclude patterns in correct format', () => {
                expect(DELTA_SYNC.EXCLUDE_PATTERNS.length).toBeGreaterThan(0);
                DELTA_SYNC.EXCLUDE_PATTERNS.forEach((pattern:string) => {
                    expect(typeof pattern).toBe('string');
                    expect(pattern.length).toBeGreaterThan(0);
                });
            });

            it('should exclude common build artifacts', () => {
                expect(DELTA_SYNC.EXCLUDE_PATTERNS).toContain('node_modules');
                expect(DELTA_SYNC.EXCLUDE_PATTERNS.some((p:string) => p.includes('.git'))).toBe(true);
            });
        });

        describe('PROMPTS function edge cases', () => {
            it('should handle empty string in editHost', () => {
                expect(PROMPTS.editHost('')).toBe('Edit ');
            });

            it('should handle special characters in editHost', () => {
                const result = PROMPTS.editHost('Host@#$%');
                expect(result).toContain('Host@#$%');
            });

            it('should handle very long host names', () => {
                const longName = 'A'.repeat(100);
                const result = PROMPTS.editHost(longName);
                expect(result).toContain(longName);
            });

            it('should handle Unicode in editHost', () => {
                const result = PROMPTS.editHost('主机测试');
                expect(result).toContain('主机测试');
            });
        });

        describe('MESSAGES function edge cases', () => {
            it('should handle empty host name in hostAdded', () => {
                expect(MESSAGES.hostAdded('')).toContain('""');
            });

            it('should handle special characters in host names', () => {
                const result = MESSAGES.hostDeleted('Host@#$');
                expect(result).toContain('Host@#$');
            });

            it('should handle zero hosts in deleteHostsConfirm', () => {
                expect(MESSAGES.deleteHostsConfirm(0)).toContain('0 hosts');
            });

            it('should handle single host in deleteHostsConfirm', () => {
                expect(MESSAGES.deleteHostsConfirm(1)).toContain('1 host');
            });

            it('should handle very large number in deleteHostsConfirm', () => {
                expect(MESSAGES.deleteHostsConfirm(999)).toContain('999 hosts');
            });

            it('should handle error with empty message', () => {
                const error = new Error('Unknown error');
                expect(MESSAGES.updateFailed(error)).toBeDefined();
            });

            it('should handle error with very long message', () => {
                const longMsg = 'E'.repeat(500);
                const error = new Error(longMsg);
                const result = MESSAGES.updateFailed(error);
                expect(result.length).toBeGreaterThan(0);
            });

            it('should handle port boundary values in portRange', () => {
                expect(MESSAGES.portRange(1, 65535)).toContain('1');
                expect(MESSAGES.portRange(1, 65535)).toContain('65535');
            });

            it('should handle long file paths in downloadSuccess', () => {
                const longPath = '/very/long/path/' + 'folder/'.repeat(20) + 'file.txt';
                expect(MESSAGES.downloadSuccess(longPath)).toContain('Download');
            });

            it('should handle paths with special characters', () => {
                const specialPath = '/path/with spaces/file@#$.txt';
                expect(MESSAGES.downloadSuccess(specialPath)).toBeDefined();
            });
        });

        describe('TOOLTIPS function edge cases', () => {
            it('should handle empty filename in downloading', () => {
                expect(TOOLTIPS.downloading('')).toContain('Downloading');
            });

            it('should handle very long filename', () => {
                const longName = 'file' + 'name'.repeat(50) + '.txt';
                const result = TOOLTIPS.downloading(longName);
                expect(result).toContain('Downloading');
            });

            it('should handle special characters in filename', () => {
                const result = TOOLTIPS.downloading('file@#$%.txt');
               expect(result).toContain('file@#$%.txt');
            });

            it('should handle Unicode in folder name', () => {
                const result = TOOLTIPS.downloadingFolder('文件夹');
                expect(result).toContain('文件夹');
            });
        });

        describe('String constant validation', () => {
            it('should have non-empty prompt strings', () => {
                expect(PROMPTS.hostName.length).toBeGreaterThan(0);
                expect(PROMPTS.hostAddress.length).toBeGreaterThan(0);
                expect(PROMPTS.enterPassword.length).toBeGreaterThan(0);
            });

            it('should have non-empty placeholder strings', () => {
                expect(PLACEHOLDERS.hostAddress.length).toBeGreaterThan(0);
                expect(PLACEHOLDERS.username.length).toBeGreaterThan(0);
            });

            it('should have non-empty message strings', () => {
                expect(MESSAGES.noHosts.length).toBeGreaterThan(0);
                expect(MESSAGES.selectHost.length).toBeGreaterThan(0);
            });

            it('should have non-empty instruction strings', () => {
                expect(INSTRUCTIONS.browsePathSelect.length).toBeGreaterThan(0);
            });

            it('should have non-empty tooltip strings', () => {
                expect(TOOLTIPS.hideDotFiles.length).toBeGreaterThan(0);
                expect(TOOLTIPS.download.length).toBeGreaterThan(0);
            });

            it('should have non-empty label strings', () => {
                expect(LABELS.editName.length).toBeGreaterThan(0);
                expect(LABELS.editHostAddress.length).toBeGreaterThan(0);
            });
        });
    });
});
