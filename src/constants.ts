/**
 * Constants used throughout the CommandHandler
 */

export const DEFAULTS = {
  PORT: 22,
  USERNAME: 'root',
  REMOTE_PATH: '/root',
} as const;

export const LIMITS = {
  MIN_PORT: 1,
  MAX_PORT: 65535,
} as const;

export const TIMING = {
  PROGRESS_UPDATE_INTERVAL: 5000, // ms - Update download progress every 5 seconds
  PATH_INPUT_DEBOUNCE: 300, // ms - Debounce for path input
} as const;

export const PARALLEL_TRANSFER = {
  // Default values (can be overridden by configuration)
  CHUNK_SIZE: 10 * 1024 * 1024,        // 10MB per chunk
  MAX_CONCURRENT: 5,                    // Maximum concurrent chunk transfers
  THRESHOLD: 100 * 1024 * 1024,         // Minimum file size to use parallel transfer (100MB)
  ENABLED: true,                        // Enable/disable parallel transfer feature
} as const;

/**
 * Get parallel transfer configuration from VS Code settings
 * Configuration values are in MB, converted to bytes internally
 */
export function getParallelTransferConfig() {
  const vscode = require('vscode');
  const config = vscode.workspace.getConfiguration('simpleSftp.parallelTransfer');

  const MB = 1024 * 1024;

  return {
    enabled: config.get<boolean>('enabled', PARALLEL_TRANSFER.ENABLED),
    threshold: config.get<number>('threshold', PARALLEL_TRANSFER.THRESHOLD / MB) * MB,
    chunkSize: config.get<number>('chunkSize', PARALLEL_TRANSFER.CHUNK_SIZE / MB) * MB,
    maxConcurrent: config.get<number>('maxConcurrent', PARALLEL_TRANSFER.MAX_CONCURRENT),
  };
}

export const DELTA_SYNC = {
  ENABLED: true,                        // Enable/disable delta sync (skip unchanged files)
  COMPARE_METHOD: 'mtime' as const,     // 'mtime' | 'checksum' - Method to detect file changes
  DELETE_REMOTE: false,                 // Delete remote files that don't exist locally
  PRESERVE_TIMESTAMPS: false,           // Preserve file modification times (experimental)
  EXCLUDE_PATTERNS: [                   // Files/folders to exclude from sync
    'node_modules',
    String.raw`\.git`,
    String.raw`\.vscode`,
    String.raw`.*\.log`
  ],
} as const;

export const COMPRESSION = {
  // SSH connection-level compression (always enabled for all transfers)
  SSH_LEVEL_ENABLED: true,              // Enable SSH connection-level compression

  // File-level gzip compression for large text files
  FILE_LEVEL_ENABLED: true,             // Enable file-level gzip compression
  FILE_LEVEL_THRESHOLD: 50 * 1024 * 1024, // Min file size for file-level compression (50MB)
  COMPRESSION_LEVEL: 6,                 // Gzip compression level (1-9, 6 is balanced)

  // File extensions eligible for file-level compression
  COMPRESSIBLE_EXTENSIONS: [
    '.txt', '.log', '.json', '.xml', '.csv', '.md', '.yaml', '.yml',
    '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.sass', '.less',
    '.html', '.htm', '.sql', '.sh', '.bash', '.py', '.java', '.c', '.cpp', '.h'
  ],
} as const;

export const PROMPTS = {
  // Add Host steps
  hostName: 'Step 1/6: Enter host name',
  hostAddress: 'Step 2/6: Enter host address',
  hostPort: 'Step 3/6: Enter port number (optional, default: 22)',
  hostUsername: 'Step 4/6: Enter username',
  hostAuthNow: 'Step 6/6: Configure authentication now?',

  // Edit Host
  editHost: (name: string) => `Edit ${name}`,
  editHostName: 'Modify host name',
  editHostAddress: 'Enter host address (IP or domain)',
  editPort: 'Enter SSH port',
  editRemotePath: 'Set default remote path (optional)',
  selectGroup: 'Select a group',
  selectColor: 'Select color',

  // Authentication
  authType: 'Select authentication type',
  enterPassword: 'Enter password',
  selectPrivateKey: 'Select private key file',
  selectPublicKey: 'Select public key for passwordless login',

  // Groups
  groupName: 'Enter group name',

  // Paths
  selectLocalFiles: 'Select files or folders to upload',
  selectDownloadLocation: 'Select download location',
  typePathOrSelect: 'Type a path or select from the list',
} as const;

export const PLACEHOLDERS = {
  hostName: 'e.g., My Server',
  hostAddress: 'e.g., 192.168.1.100 or example.com',
  port: '22',
  username: 'root',
  groupName: 'e.g., Production Servers',
  remotePath: 'e.g., /var/www',
} as const;

export const MESSAGES = {
  // Success messages
  hostAdded: (name: string) => `Host "${name}" added successfully with authentication`,
  hostAddedNoAuth: (name: string) => `Host "${name}" added without authentication. Configure it later.`,
  hostUpdated: 'Host updated successfully',
  authUpdated: 'Authentication updated successfully',
  hostDeleted: (name: string) => `Host "${name}" deleted successfully`,
  groupCreated: (name: string) => `Group "${name}" created successfully`,
  groupUpdated: (name: string) => `Group "${name}" updated successfully`,
  bookmarkAdded: (name: string) => `Bookmark '${name}' added successfully`,
  downloadSuccess: (path: string) => `Download successful: ${path}`,
  connectionSuccess: (name: string) => `Connected to ${name} successfully`,
  passwordlessConfigured: 'Passwordless login configured successfully',
  passwordlessAlreadyConfigured: 'Passwordless login is already configured for this host',

  // Warning messages
  noAuthConfigured: (name: string) => `No authentication configured for ${name}`,
  noHosts: 'Please add host configuration first',
  selectHost: 'Please select a host',
  selectGroup: 'Please select a group',
  selectBookmark: 'Please select a bookmark',
  hostNotFound: 'Host not found',

  // Error messages
  hostAddFailed: 'Failed to add host',
  updateFailed: (error: unknown) => `Update failed: ${error}`,
  hostDeleteFailed: 'Failed to delete host',
  groupCreateFailed: 'Failed to create group',
  groupUpdateFailed: 'Failed to update group',
  bookmarkAddFailed: 'Failed to add bookmark',
  downloadFailed: 'Download failed',
  uploadFailed: 'Upload failed',
  connectionFailed: 'Connection failed',
  readDirectoryFailed: 'Failed to read directory',
  passwordlessSetupFailed: 'Failed to set up passwordless login',
  sshConfigParseFailed: 'Failed to parse SSH config',
  noHostsInSshConfig: 'No hosts found in SSH config file',

  // Validation errors
  hostNameRequired: 'Host name is required',
  hostAddressRequired: 'Host address is required',
  usernameRequired: 'Username is required',
  portRequired: 'Port is required',
  portInvalid: 'Port must be between 1 and 65535',
  portRange: (min: number, max: number) => `Port must be a number between ${min} and ${max}`,

  // Confirmation prompts
  deleteHostConfirm: (name: string) => `Delete host '${name}'?`,
  deleteHostsConfirm: (count: number) => `Delete ${count} hosts?`,
  deleteGroupConfirm: (name: string) => `Delete group '${name}'? (Hosts in this group will not be deleted)`,
  deleteBookmarkConfirm: (name: string) => `Delete bookmark '${name}'?`,
  configureAuthNow: (name: string) => `No authentication configured for ${name}. Configure now?`,
  importDuplicates: (count: number) => `Found ${count} matching hosts. What would you like to do?`,

  // Action buttons
  delete: 'Delete',
  configure: 'Configure Authentication',
  cancel: 'Cancel',
  yes: 'Yes',
  no: 'No, configure later',
  viewLogs: 'View Logs',
  update: 'Update',
  skip: 'Skip',
  skipAll: 'Skip All',
} as const;

export const INSTRUCTIONS = {
  browsePathSelect: 'Navigate using arrows or type a path ending with /',
  browseBookmark: 'Navigate to the directory you want to bookmark',
  browseFiles: 'Click upload/download buttons or select file/folder',
  browseDownload: 'Select a file or folder to download',
  parsingSshConfig: 'Reading SSH config file',
} as const;

export const TOOLTIPS = {
  hideDotFiles: 'Hide dot files',
  showDotFiles: 'Show dot files',
  uploadToCurrent: 'Upload to current folder',
  bookmarkCurrent: 'Add bookmark for current folder',
  uploadToDir: 'Upload to this directory',
  bookmarkDir: 'Add bookmark for this directory',
  uploadHere: 'Upload to here',
  download: 'Download',
  downloading: (name: string) => `Downloading: ${name}`,
  downloadingFolder: (name: string) => `Downloading folder: ${name}`,
} as const;

export const LABELS = {
  // Edit Host options
  editName: 'Edit Name',
  editHostAddress: 'Edit Host Address',
  editPort: 'Edit Port',
  editRemotePath: 'Edit Default Remote Path',
  changeGroup: 'Change Group',
  editColor: 'Edit Color',
  configureAuth: 'Configure Authentication',

  // Group options
  noGroup: 'No Group',
  current: '(Current)',

  // Color options
  noColor: 'No Color',
  useDefaultColor: 'Use default color',
  red: 'Red',
  green: 'Green',
  blue: 'Blue',
  yellow: 'Yellow',
  purple: 'Purple',
} as const;
