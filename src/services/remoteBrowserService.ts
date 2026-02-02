import * as vscode from 'vscode';
import * as path from 'path';
import { HostManager } from '../hostManager';
import { SshConnectionManager } from '../sshConnectionManager';
import { HostConfig, HostAuthConfig } from '../types';
import { logger } from '../logger';
import { formatFileSize } from '../utils/formatUtils';

/**
 * Service for browsing remote files and directories
 */
export class RemoteBrowserService {
  constructor(
    private readonly hostManager: HostManager,
    private readonly onUploadHandler?: (config: HostConfig, authConfig: HostAuthConfig, remotePath: string, isDirectory: boolean) => Promise<void>,
    private readonly onDownloadHandler?: (config: HostConfig, authConfig: HostAuthConfig, remotePath: string, isDirectory: boolean) => Promise<void>
  ) {}

  /**
   * Generic remote file browser with path input navigation
   * @param config Host configuration
   * @param authConfig Authentication configuration
   * @param mode 'selectPath' for selecting a directory, 'browseFiles' for downloading files
   * @param title Title for the QuickPick
   * @param initialPath Optional initial path to start browsing from. If not provided, uses recent paths or default
   * @returns Promise resolving to selected path string or object with path and isDirectory
   */
  async browseRemoteFilesGeneric(
    config: HostConfig,
    authConfig: HostAuthConfig,
    mode: 'selectPath' | 'browseFiles' | 'selectBookmark' | 'sync',
    title: string,
    initialPath?: string
  ): Promise<string | { path: string; isDirectory: boolean } | undefined> {
    // Determine starting path
    let currentPath: string;
    if (initialPath) {
      // Use provided initial path (e.g., for bookmark browsing)
      currentPath = initialPath;
    } else {
      // Use default remote path or /root as fallback
      currentPath = config.defaultRemotePath || '/root';
    }
    // Read showDotFiles setting from configuration
    let showDotFiles = vscode.workspace.getConfiguration('simpleSftp').get<boolean>('showDotFiles', true);
    logger.info(`Browsing remote on ${config.name}, starting at: ${currentPath}`);

    return new Promise(async (resolve) => {
      const quickPick = vscode.window.createQuickPick();
      quickPick.placeholder = 'Type a path or select from the list';
      quickPick.canSelectMany = false;
      quickPick.busy = true;
      quickPick.title = title;

      // Add prompt for persistent instructional text
      (quickPick as any).prompt = mode === 'selectPath'
        ? 'Navigate using arrows or type a path ending with /'
        : mode === 'selectBookmark'
        ? 'Navigate to the directory you want to bookmark'
        : mode === 'sync'
        ? 'Click upload/download buttons or select file/folder'
        : 'Select a file or folder to download';

      // Add buttons based on mode
      const updateButtons = () => {
        if (mode === 'browseFiles') {
          quickPick.buttons = [
            {
              iconPath: new vscode.ThemeIcon(showDotFiles ? 'eye' : 'eye-closed'),
              tooltip: showDotFiles ? 'Hide dot files' : 'Show dot files'
            }
          ];
        } else if (mode === 'selectPath') {
          quickPick.buttons = [
            {
              iconPath: new vscode.ThemeIcon('cloud-upload'),
              tooltip: 'Upload to current folder'
            }
          ];
        } else if (mode === 'selectBookmark') {
          quickPick.buttons = [
            {
              iconPath: new vscode.ThemeIcon('bookmark'),
              tooltip: 'Add bookmark for current folder'
            }
          ];
        }
      };
      updateButtons();

      let isLoadingPath = false;

      // Function to load and display files/directories
      const loadDirectory = async (pathToLoad: string, updateValue: boolean = true) => {
        currentPath = pathToLoad;
        quickPick.busy = true;
        isLoadingPath = true;

        try {
          logger.debug(`Listing: ${currentPath}`);

          let quickPickItems: vscode.QuickPickItem[];

          if (mode === 'selectPath' || mode === 'selectBookmark') {
            // For path selection or bookmark selection, only show directories
            const directories = await SshConnectionManager.listRemoteDirectory(config, authConfig, currentPath);
            logger.debug(`Found ${directories.length} directories in ${currentPath}`);

            // Filter dot files if needed
            const filteredDirs = showDotFiles
              ? directories
              : directories.filter(dir => !dir.startsWith('.'));

            // Sort directories alphabetically
            const sortedDirs = [...filteredDirs].sort((a, b) => a.localeCompare(b));

            // Determine button icon and tooltip based on mode
            const buttonIcon = mode === 'selectBookmark' ? 'bookmark' : 'cloud-upload';
            const buttonTooltip = mode === 'selectBookmark'
              ? 'Add bookmark for this directory'
              : 'Upload to this directory';

            quickPickItems = [
              {
                label: '..',
                alwaysShow: true
              },
              ...sortedDirs.map(dir => {
                const fullPath = `${currentPath}/${dir}`.replace(/\/\//g, '/');

                return {
                  label: dir,
                  description: '',
                  resourceUri: vscode.Uri.parse(`sftp-remote://${config.host}${fullPath}`),  // 新版本使用,旧版本自动忽略
                  iconPath: vscode.ThemeIcon.Folder,  // 新版本触发主题图标,旧版本显示标准图标
                  alwaysShow: true,
                  buttons: [
                    {
                      iconPath: new vscode.ThemeIcon(buttonIcon),
                      tooltip: buttonTooltip
                    }
                  ],
                  dirName: dir
                } as any;
              }),
            ];
          } else {
            // For file browsing, show files and directories
            const items = await SshConnectionManager.listRemoteFiles(config, authConfig, currentPath);
            logger.debug(`Found ${items.length} items in ${currentPath}`);

            // Filter dot files if needed
            const filteredItems = showDotFiles
              ? items
              : items.filter(item => !item.name.startsWith('.'));

            // Sort: directories first (alphabetically), then files (alphabetically)
            const directories = filteredItems
              .filter(item => item.type === 'directory')
              .sort((a, b) => a.name.localeCompare(b.name));
            const files = filteredItems
              .filter(item => item.type === 'file')
              .sort((a, b) => a.name.localeCompare(b.name));
            const sortedItems = [...directories, ...files];

            quickPickItems = [
              {
                label: '..',
                alwaysShow: true
              },
              ...sortedItems.map(item => {
                const fullPath = `${currentPath}/${item.name}`.replace(/\/\//g, '/');
                const isDirectory = item.type === 'directory';
                const fileSize = item.type === 'file' ? formatFileSize(item.size) : '';

                // Determine which buttons to show based on mode
                const itemButtons = mode === 'sync' ? [
                  {
                    iconPath: new vscode.ThemeIcon('cloud-upload'),
                    tooltip: 'Upload to here'
                  },
                  {
                    iconPath: new vscode.ThemeIcon('cloud-download'),
                    tooltip: 'Download'
                  }
                ] : [
                  {
                    iconPath: new vscode.ThemeIcon('cloud-download'),
                    tooltip: 'Download'
                  }
                ];

                return {
                  label: item.name,
                  description: fileSize,  // 显示文件大小
                  resourceUri: vscode.Uri.parse(`sftp-remote://${config.host}${fullPath}`),  // 新版本使用,旧版本自动忽略
                  iconPath: isDirectory ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File,  // 新版本触发主题图标,旧版本显示标准图标
                  alwaysShow: true,
                  buttons: itemButtons,
                  item: item
                } as any;
              }),
            ];
          }

          quickPick.items = quickPickItems;
          quickPick.busy = false;
          updateButtons();

          // Update value with trailing slash after loading
          if (updateValue) {
            quickPick.value = currentPath + '/';
          }
          isLoadingPath = false;
        } catch (error) {
          quickPick.busy = false;
          isLoadingPath = false;
          logger.error(`Failed to list: ${currentPath}`, error as Error);

          const openLogs = 'View Logs';
          const choice = await vscode.window.showErrorMessage(
            `Failed to read directory: ${error}`,
            openLogs
          );

          if (choice === openLogs) {
            logger.show();
          }
          quickPick.hide();
          resolve(undefined);
        }
      };

      // Handle input value change - dynamic path navigation
      let inputTimeout: NodeJS.Timeout | undefined;
      quickPick.onDidChangeValue(async (value) => {
        if (inputTimeout) {
          clearTimeout(inputTimeout);
        }

        if (isLoadingPath) {
          return;
        }

        inputTimeout = setTimeout(async () => {
          if (!value) {
            return;
          }

          if (value.endsWith('/')) {
            const targetPath = value.slice(0, -1) || '/';
            if (targetPath !== currentPath) {
              await loadDirectory(targetPath);
            }
          } else {
            const lastSlashIndex = value.lastIndexOf('/');
            if (lastSlashIndex >= 0) {
              const parentPath = value.substring(0, lastSlashIndex) || '/';
              if (parentPath !== currentPath) {
                await loadDirectory(parentPath, false);
              }
            }
          }
        }, 300);
      });

      // Handle QuickPick button click
      quickPick.onDidTriggerButton(async () => {
        if (mode === 'browseFiles') {
          // Toggle dot files
          showDotFiles = !showDotFiles;
          updateButtons();
          loadDirectory(currentPath, false);
        } else if (mode === 'selectPath') {
          // Upload to current folder
          logger.info(`Selected current folder for upload: ${currentPath}`);
          quickPick.hide();
          resolve(currentPath);
        } else if (mode === 'selectBookmark') {
          // Add bookmark for current folder
          logger.info(`Selected current folder for bookmark: ${currentPath}`);
          quickPick.hide();
          resolve(currentPath);
        }
      });

      // Handle item button click
      quickPick.onDidTriggerItemButton(async (event) => {
        const selected = event.item as any;
        if (!selected || selected.label === '..' || selected.isDotFilesToggle) {
          return;
        }

        const buttonIndex = event.button === selected.buttons?.[0] ? 0 : 1;

        if (mode === 'sync') {
          // Sync mode: two buttons - upload (index 0) and download (index 1)
          const item = selected.item;
          const itemPath = `${currentPath}/${item.name}`.replace(/\/\//g, '/');

          if (buttonIndex === 0) {
            // Upload button clicked
            logger.info(`Upload button clicked for: ${itemPath}`);
            quickPick.hide();
            // Call upload handler with the remote path as target
            if (this.onUploadHandler) {
              await this.onUploadHandler(config, authConfig, itemPath, item.type === 'directory');
            }
            quickPick.show();
            await loadDirectory(currentPath, false);
          } else {
            // Download button clicked
            logger.info(`Download button clicked for: ${itemPath}`);
            quickPick.hide();
            if (this.onDownloadHandler) {
              await this.onDownloadHandler(config, authConfig, itemPath, item.type === 'directory');
            }
            quickPick.show();
            await loadDirectory(currentPath, false);
          }
        } else if (mode === 'browseFiles') {
          // Download button
          const item = selected.item;
          const itemPath = `${currentPath}/${item.name}`.replace(/\/\//g, '/');
          logger.info(`Selected for download via button: ${itemPath} (${item.type})`);
          quickPick.hide();
          resolve({
            path: itemPath,
            isDirectory: item.type === 'directory'
          });
        } else if (mode === 'selectPath') {
          // Upload button
          if (selected.dirName) {
            const targetPath = `${currentPath}/${selected.dirName}`.replace(/\/\//g, '/');
            logger.info(`Selected for upload via button: ${targetPath}`);
            quickPick.hide();
            resolve(targetPath);
          }
        } else if (mode === 'selectBookmark') {
          // Bookmark button
          if (selected.dirName) {
            const targetPath = `${currentPath}/${selected.dirName}`.replace(/\/\//g, '/');
            logger.info(`Selected directory for bookmark via button: ${targetPath}`);
            quickPick.hide();
            resolve(targetPath);
          }
        }
      });

      // Handle selection
      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0] as any;

        if (!selected) {
          return;
        }

        if (selected.label === '..') {
          const parentPath = path.dirname(currentPath);
          loadDirectory(parentPath);
        } else if (mode === 'browseFiles' && selected.item) {
          if (selected.item.type === 'directory') {
            const targetPath = `${currentPath}/${selected.item.name}`.replace(/\/\//g, '/');
            loadDirectory(targetPath);
          } else {
            const filePath = `${currentPath}/${selected.item.name}`.replace(/\/\//g, '/');
            logger.info(`Selected file for download: ${filePath}`);
            quickPick.hide();
            resolve({
              path: filePath,
              isDirectory: false
            });
          }
        } else if (mode === 'sync' && selected.item) {
          // Sync mode: enter directory if it's a directory, open file if it's a file
          if (selected.item.type === 'directory') {
            const targetPath = `${currentPath}/${selected.item.name}`.replace(/\/\//g, '/');
            loadDirectory(targetPath);
          } else {
            // Open the file in editor
            const filePath = `${currentPath}/${selected.item.name}`.replace(/\/\//g, '/');
            const uri = vscode.Uri.parse(`sftp://${config.id}${filePath}`);
            logger.info(`Opening remote file: ${filePath}`);
            await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
          }
        } else if ((mode === 'selectPath' || mode === 'selectBookmark') && selected.dirName) {
          const targetPath = `${currentPath}/${selected.dirName}`.replace(/\/\//g, '/');
          loadDirectory(targetPath);
        }
      });

      quickPick.onDidHide(() => {
        if (inputTimeout) {
          clearTimeout(inputTimeout);
        }
        quickPick.dispose();
        resolve(undefined);
      });

      quickPick.show();
      await loadDirectory(currentPath);
    });
  }

  /**
   * Select a remote directory path
   */
  async selectRemotePath(config: HostConfig, authConfig: HostAuthConfig): Promise<string | undefined> {
    const result = await this.browseRemoteFilesGeneric(
      config,
      authConfig,
      'selectPath',
      'Select remote directory'
    );
    return typeof result === 'string' ? result : undefined;
  }

  /**
   * Select a remote file or directory for download
   */
  async selectRemoteFileOrDirectory(config: HostConfig, authConfig: HostAuthConfig): Promise<{path: string, isDirectory: boolean} | undefined> {
    const result = await this.browseRemoteFilesGeneric(
      config,
      authConfig,
      'browseFiles',
      'Browse Remote Files'
    );
    return typeof result === 'object' ? result : undefined;
  }
}
