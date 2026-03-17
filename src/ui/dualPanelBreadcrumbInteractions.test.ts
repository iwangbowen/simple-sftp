import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function extractFunctionSource(fileContent: string, functionName: string): string {
  const signature = `function ${functionName}(`;
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

function loadBrowserScript() {
  const scriptPath = path.resolve(__dirname, '../../resources/webview/dual-panel-browser.js');
  return fs.readFileSync(scriptPath, 'utf8');
}

type BreadcrumbRuntime = {
  navigateBreadcrumbPath: (panel: string, targetPath: string) => void;
  toggleBreadcrumbContextMenu: (
    segment: any,
    panel: string,
    dropdownPath: string,
    isRoot: boolean,
    highlightPath?: string
  ) => void;
  setSearchView: (value: boolean) => void;
  setBreadcrumbDropdown: (value: any) => void;
  setPathInput: (element: { value: string } | null) => void;
  getState: () => {
    currentSearchPath: string;
    currentRemotePath: string;
    renderBreadcrumbCalls: Array<any[]>;
    loadDirectoryCalls: Array<any[]>;
    showDropdownCalls: Array<any[]>;
    closeDropdownCalls: number;
  };
};

class MockClassList {
  constructor(private readonly owner: MockElement) {}

  add(...tokens: string[]) {
    const next = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    tokens.forEach((token) => next.add(token));
    this.owner.className = Array.from(next).join(' ');
  }

  contains(token: string): boolean {
    return this.owner.className.split(/\s+/).filter(Boolean).includes(token);
  }
}

class MockElement {
  public children: MockElement[] = [];
  public dataset: Record<string, string> = {};
  public textContent = '';
  public title = '';
  public className = '';
  public scrollWidth = 320;
  public clientWidth = 120;
  public scrollLeft = 0;
  public readonly classList = new MockClassList(this);
  private readonly listeners = new Map<string, Array<(event: any) => void>>();
  private innerHtmlValue = '';

  constructor(public readonly tagName: string) {}

  set innerHTML(value: string) {
    this.innerHtmlValue = value;
    this.children = [];
  }

  get innerHTML(): string {
    return this.innerHtmlValue;
  }

  appendChild(child: MockElement): MockElement {
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, handler: (event: any) => void) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type: string, event: Record<string, unknown> = {}) {
    let defaultPrevented = false;
    let propagationStopped = false;

    const dispatchedEvent = {
      ...event,
      preventDefault() {
        defaultPrevented = true;
      },
      stopPropagation() {
        propagationStopped = true;
      },
      get defaultPrevented() {
        return defaultPrevented;
      },
      get propagationStopped() {
        return propagationStopped;
      }
    };

    (this.listeners.get(type) ?? []).forEach((handler) => handler.call(this, dispatchedEvent));
    return dispatchedEvent;
  }
}

function createBreadcrumbRuntime(): BreadcrumbRuntime {
  const scriptContent = loadBrowserScript();
  const navigateSource = extractFunctionSource(scriptContent, 'navigateBreadcrumbPath');
  const toggleSource = extractFunctionSource(scriptContent, 'toggleBreadcrumbContextMenu');

  return new Function(`
    let isSearchViewVisible = false;
    let currentSearchPath = '';
    let currentRemotePath = '';
    let breadcrumbDropdown = null;

    const renderBreadcrumbCalls = [];
    const loadDirectoryCalls = [];
    const showDropdownCalls = [];
    let closeDropdownCalls = 0;

    const document = {
      getElementById: () => null
    };

    function renderBreadcrumb(...args) {
      renderBreadcrumbCalls.push(args);
    }

    function loadDirectory(...args) {
      loadDirectoryCalls.push(args);
    }

    function closeBreadcrumbDropdown() {
      closeDropdownCalls += 1;
    }

    function showBreadcrumbDropdown(...args) {
      showDropdownCalls.push(args);
    }

    ${navigateSource}
    ${toggleSource}

    return {
      navigateBreadcrumbPath,
      toggleBreadcrumbContextMenu,
      setSearchView(value) {
        isSearchViewVisible = value;
      },
      setBreadcrumbDropdown(value) {
        breadcrumbDropdown = value;
      },
      setPathInput(element) {
        document.getElementById = (id) => id === 'search-path-input' ? element : null;
      },
      getState() {
        return {
          currentSearchPath,
          currentRemotePath,
          renderBreadcrumbCalls,
          loadDirectoryCalls,
          showDropdownCalls,
          closeDropdownCalls
        };
      }
    };
  `)() as BreadcrumbRuntime;
}

type RenderBreadcrumbRuntime = {
  breadcrumb: MockElement;
  renderBreadcrumb: (panel: string, fullPath: string) => void;
  navigateCalls: Array<any[]>;
  contextCalls: Array<any[]>;
};

function createRenderBreadcrumbRuntime(): RenderBreadcrumbRuntime {
  const scriptContent = loadBrowserScript();
  const renderSource = extractFunctionSource(scriptContent, 'renderBreadcrumb');

  const breadcrumb = new MockElement('div');
  const elements = new Map<string, MockElement>([['local-breadcrumb', breadcrumb]]);
  const navigateCalls: Array<any[]> = [];
  const contextCalls: Array<any[]> = [];

  const renderBreadcrumb = new Function(
    'document',
    'requestAnimationFrame',
    'navigateBreadcrumbPath',
    'toggleBreadcrumbContextMenu',
    'getParentPath',
    `${renderSource}; return renderBreadcrumb;`
  )(
    {
      getElementById(id: string) {
        return elements.get(id) ?? null;
      },
      createElement(tagName: string) {
        return new MockElement(tagName);
      }
    },
    (callback: () => void) => callback(),
    (...args: any[]) => {
      navigateCalls.push(args);
    },
    (...args: any[]) => {
      contextCalls.push(args);
    },
    () => null
  ) as (panel: string, fullPath: string) => void;

  return {
    breadcrumb,
    renderBreadcrumb,
    navigateCalls,
    contextCalls
  };
}

describe('breadcrumb interaction helpers', () => {
  it('navigates immediately and syncs search state in remote search view', () => {
    const runtime = createBreadcrumbRuntime();
    const pathInput = { value: '' };

    runtime.setSearchView(true);
    runtime.setPathInput(pathInput);
    runtime.navigateBreadcrumbPath('remote', '/var/www/app');

    const state = runtime.getState();
    expect(pathInput.value).toBe('/var/www/app');
    expect(state.currentSearchPath).toBe('/var/www/app');
    expect(state.currentRemotePath).toBe('/var/www/app');
    expect(state.renderBreadcrumbCalls).toEqual([['remote', '/var/www/app']]);
    expect(state.loadDirectoryCalls).toEqual([['remote', '/var/www/app']]);
    expect(state.closeDropdownCalls).toBe(1);
  });

  it('opens a breadcrumb context dropdown on right click when it is not already open', () => {
    const runtime = createBreadcrumbRuntime();
    const segment = { dataset: {} };

    runtime.toggleBreadcrumbContextMenu(segment, 'local', '/tmp/demo', false);

    const state = runtime.getState();
    expect(state.closeDropdownCalls).toBe(0);
    expect(state.showDropdownCalls).toHaveLength(1);

    const [shownSegment, shownPanel, shownPath, shownIsRoot, shownHighlightPath] = state.showDropdownCalls[0];
    expect(shownSegment).toBe(segment);
    expect(shownPanel).toBe('local');
    expect(shownPath).toBe('/tmp/demo');
    expect(shownIsRoot).toBe(false);
    expect(shownHighlightPath).toBeUndefined();
  });

  it('closes the current breadcrumb dropdown when right-clicking the same context again', () => {
    const runtime = createBreadcrumbRuntime();
    const segment = { dataset: {} };

    runtime.setBreadcrumbDropdown({
      dataset: {
        panel: 'remote',
        path: '/srv/projects',
        highlightPath: '/srv/projects/simple-sftp'
      }
    });

    runtime.toggleBreadcrumbContextMenu(
      segment,
      'remote',
      '/srv/projects',
      true,
      '/srv/projects/simple-sftp'
    );

    const state = runtime.getState();
    expect(state.closeDropdownCalls).toBe(1);
    expect(state.showDropdownCalls).toEqual([]);
  });
});

describe('renderBreadcrumb runtime behavior', () => {
  it('keeps the Windows drives pseudo-path clickable without remapping it to /', () => {
    const runtime = createRenderBreadcrumbRuntime();

    runtime.renderBreadcrumb('local', 'drives://');

    expect(runtime.breadcrumb.children).toHaveLength(1);
    const [drivesSegment] = runtime.breadcrumb.children;
    expect(drivesSegment.textContent).toBe('Drives');
    expect(drivesSegment.dataset.path).toBe('drives://');

    drivesSegment.dispatch('click');
    expect(runtime.navigateCalls).toEqual([['local', 'drives://']]);

    const contextEvent = drivesSegment.dispatch('contextmenu');
    expect(contextEvent.defaultPrevented).toBe(true);
    expect(contextEvent.propagationStopped).toBe(true);
    expect(runtime.contextCalls).toHaveLength(1);
    expect(runtime.contextCalls[0][1]).toBe('local');
    expect(runtime.contextCalls[0][2]).toBe('drives://');
    expect(runtime.contextCalls[0][3]).toBe(true);
  });
});

describe('renderBreadcrumb integration', () => {
  it('binds right-click context handlers and no longer relies on click timers', () => {
    const scriptContent = loadBrowserScript();
    const renderBreadcrumbSource = extractFunctionSource(scriptContent, 'renderBreadcrumb');

    expect(renderBreadcrumbSource).toContain("fullPath === 'drives://'");
    expect(renderBreadcrumbSource).toContain("addEventListener('contextmenu'");
    expect(renderBreadcrumbSource).toContain('navigateBreadcrumbPath');
    expect(renderBreadcrumbSource).toContain('toggleBreadcrumbContextMenu');
    expect(renderBreadcrumbSource).not.toContain('breadcrumbClickTimers');
  });
});
