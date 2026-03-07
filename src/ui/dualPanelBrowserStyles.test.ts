import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const cssPath = path.resolve(__dirname, '../../resources/webview/dual-panel-browser.css');
const css = fs.readFileSync(cssPath, 'utf8');

function getCssBlock(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`, 'm'));
  expect(match, `Missing CSS block for ${selector}`).toBeTruthy();
  return match![1];
}

describe('dual-panel browser tooltip styles', () => {
  it('keeps hidden tooltip out of hit testing', () => {
    const hiddenTooltipBlock = getCssBlock('.file-tooltip');

    expect(hiddenTooltipBlock).toContain('visibility: hidden;');
    expect(hiddenTooltipBlock).toContain('pointer-events: none;');
  });

  it('restores tooltip interaction only when visible', () => {
    const visibleTooltipBlock = getCssBlock('.file-tooltip.visible');

    expect(visibleTooltipBlock).toContain('visibility: visible;');
    expect(visibleTooltipBlock).toContain('pointer-events: auto;');
  });
});
