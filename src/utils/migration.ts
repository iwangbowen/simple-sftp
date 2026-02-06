import * as vscode from 'vscode';
import { logger } from '../logger';
import { StorageData } from '../types';

/**
 * Migrate host configurations from globalState to settings
 *
 * Migration strategy:
 * 1. Check if settings already has data → use settings (already migrated)
 * 2. If settings is empty → read from globalState → write to settings → clear globalState
 * 3. Next time: settings has data → skip migration
 */
export async function migrateHostConfigsToSettings(
  context: vscode.ExtensionContext
): Promise<void> {
  const STORAGE_KEY = 'hostConfigs';
  const config = vscode.workspace.getConfiguration('simpleSftp');

  // Step 1: Check if settings already has data
  const settingsHosts = config.get<any[]>('hosts', []);
  const settingsGroups = config.get<any[]>('groups', []);
  const settingsRecentUsed = config.get<string[]>('recentUsed', []);

  if (settingsHosts.length > 0 || settingsGroups.length > 0 || settingsRecentUsed.length > 0) {
    logger.info('Settings already has host configurations, skipping migration');
    return;
  }

  // Step 2: Read from globalState
  const globalStateData = context.globalState.get<StorageData>(STORAGE_KEY);

  if (!globalStateData || (globalStateData.hosts.length === 0 && globalStateData.groups.length === 0 && (!globalStateData.recentUsed || globalStateData.recentUsed.length === 0))) {
    logger.info('No data in globalState to migrate');
    return;
  }

  logger.info('=== Starting migration to settings ===');
  logger.info(`Found ${globalStateData.hosts.length} hosts, ${globalStateData.groups.length} groups, and ${globalStateData.recentUsed?.length || 0} recent in globalState`);

  try {
    // Step 3: Write to settings (Global scope for cross-device sync)
    if (globalStateData.hosts.length > 0) {
      await config.update('hosts', globalStateData.hosts, vscode.ConfigurationTarget.Global);
      logger.info(`✓ Migrated ${globalStateData.hosts.length} hosts to settings`);
    }

    if (globalStateData.groups.length > 0) {
      await config.update('groups', globalStateData.groups, vscode.ConfigurationTarget.Global);
      logger.info(`✓ Migrated ${globalStateData.groups.length} groups to settings`);
    }

    if (globalStateData.recentUsed && globalStateData.recentUsed.length > 0) {
      await config.update('recentUsed', globalStateData.recentUsed, vscode.ConfigurationTarget.Global);
      logger.info(`✓ Migrated ${globalStateData.recentUsed.length} recent used hosts to settings`);
    }

    // Step 4: Clear globalState (cleanup)
    await context.globalState.update(STORAGE_KEY, undefined);
    logger.info('✓ Cleared globalState data');

    // Also clear the sync keys (no longer needed)
    context.globalState.setKeysForSync([]);
    logger.info('✓ Cleared sync keys');

    logger.info('=== Migration completed successfully ===');

    // Notify user
    vscode.window.showInformationMessage(
      'Simple SFTP: Host configurations have been upgraded to use VS Code Settings Sync for better reliability.'
    );
  } catch (error: any) {
    logger.error('Migration failed:', error);
    vscode.window.showWarningMessage(
      `Simple SFTP: Failed to migrate configurations. Error: ${error.message}`
    );
    throw error;
  }
}
