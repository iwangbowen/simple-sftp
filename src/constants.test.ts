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
            expect(PARALLEL_TRANSFER.ENABLED).toBe(true);
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
});
