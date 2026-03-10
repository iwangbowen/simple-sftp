import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function extractFunctionSource(fileContent: string, functionName: string): string {
  const signature = `function ${functionName}`;
  const startIndex = fileContent.indexOf(signature);

  if (startIndex < 0) {
    throw new Error(`Could not find ${functionName} in dual-panel-browser.js`);
  }

  const braceStartIndex = fileContent.indexOf('{', startIndex);
  if (braceStartIndex < 0) {
    throw new Error(`Could not find opening brace for ${functionName}`);
  }

  let depth = 0;
  for (let index = braceStartIndex; index < fileContent.length; index += 1) {
    const char = fileContent[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return fileContent.slice(startIndex, index + 1);
      }
    }
  }

  throw new Error(`Could not find closing brace for ${functionName}`);
}

function loadComputeSelectionState() {
  const scriptPath = path.resolve(__dirname, '../../resources/webview/dual-panel-browser.js');
  const scriptContent = fs.readFileSync(scriptPath, 'utf8');
  const functionSource = extractFunctionSource(scriptContent, 'computeSelectionState');

  return new Function(`${functionSource}; return computeSelectionState;`)() as (state: {
    selectedItems: Array<any>;
    selectedItem: any;
    lastSelectedItem: any;
    panelToClear?: string;
  }) => {
    selectedItems: Array<any>;
    selectedItem: any;
    lastSelectedItem: any;
    changed: boolean;
  };
}

function loadBrowserScript() {
  const scriptPath = path.resolve(__dirname, '../../resources/webview/dual-panel-browser.js');
  return fs.readFileSync(scriptPath, 'utf8');
}

describe('computeSelectionState', () => {
  it('clears selections for the updated panel and keeps other panel selections intact', () => {
    const computeSelectionState = loadComputeSelectionState();

    const localSelection = {
      dataset: { panel: 'local' },
      isConnected: true
    };
    const staleRemoteSelection = {
      dataset: { panel: 'remote' },
      isConnected: true
    };

    const nextState = computeSelectionState({
      selectedItems: [localSelection, staleRemoteSelection],
      selectedItem: staleRemoteSelection,
      lastSelectedItem: staleRemoteSelection,
      panelToClear: 'remote'
    });

    expect(nextState.selectedItems).toEqual([localSelection]);
    expect(nextState.selectedItem).toBe(localSelection);
    expect(nextState.lastSelectedItem).toBe(localSelection);
    expect(nextState.changed).toBe(true);
  });

  it('drops detached selections even without an explicit panel reset', () => {
    const computeSelectionState = loadComputeSelectionState();

    const detachedSelection = {
      dataset: { panel: 'remote' },
      isConnected: false
    };

    const nextState = computeSelectionState({
      selectedItems: [detachedSelection],
      selectedItem: detachedSelection,
      lastSelectedItem: detachedSelection
    });

    expect(nextState.selectedItems).toEqual([]);
    expect(nextState.selectedItem).toBeNull();
    expect(nextState.lastSelectedItem).toBeNull();
    expect(nextState.changed).toBe(true);
  });

  it('returns unchanged state when there is nothing to clear', () => {
    const computeSelectionState = loadComputeSelectionState();

    const localSelection = {
      dataset: { panel: 'local' },
      isConnected: true
    };

    const nextState = computeSelectionState({
      selectedItems: [localSelection],
      selectedItem: localSelection,
      lastSelectedItem: localSelection
    });

    expect(nextState.selectedItems).toEqual([localSelection]);
    expect(nextState.selectedItem).toBe(localSelection);
    expect(nextState.lastSelectedItem).toBe(localSelection);
    expect(nextState.changed).toBe(false);
  });
});

describe('selection reset integration points', () => {
  it('resets panel selection during loading and tree re-render flows', () => {
    const scriptContent = loadBrowserScript();
    const showLoadingSource = extractFunctionSource(scriptContent, 'showLoading');
    const renderFileTreeSource = extractFunctionSource(scriptContent, 'renderFileTree');

    expect(showLoadingSource).toContain('const clearedSelection = clearSelectionForPanel(panel);');
    expect(showLoadingSource).toContain('updateFooterStats(panel);');
    expect(renderFileTreeSource).toContain('clearSelectionForPanel(panel);');
  });
});
