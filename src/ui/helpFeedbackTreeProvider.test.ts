import { describe, it, expect, beforeEach } from 'vitest';
import { HelpFeedbackTreeProvider } from './helpFeedbackTreeProvider';

describe('HelpFeedbackTreeProvider', () => {
  let provider: HelpFeedbackTreeProvider;

  beforeEach(() => {
    provider = new HelpFeedbackTreeProvider();
  });

  describe('Constructor', () => {
    it('should create provider instance', () => {
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(HelpFeedbackTreeProvider);
    });

    it('should have onDidChangeTreeData event', () => {
      expect(provider.onDidChangeTreeData).toBeDefined();
    });
  });

  describe('getTreeItem', () => {
    it('should return the tree item itself', async () => {
      const children = await provider.getChildren();
      const firstChild = children[0];

      const item = provider.getTreeItem(firstChild);

      expect(item).toBe(firstChild);
      expect(item.label).toBeDefined();
      expect(item.command).toBeDefined();
    });
  });

  describe('getChildren', () => {
    it('should return root items when no element provided', async () => {
      const children = await provider.getChildren();

      expect(children).toBeDefined();
      expect(children.length).toBe(4);
    });

    it('should return Read Documentation item', async () => {
      const children = await provider.getChildren();
      const docItem = children.find((item) => item.label === 'Read Documentation');

      expect(docItem).toBeDefined();
      expect(docItem?.command?.command).toBe('simpleScp.openGitHubReadme');
      expect(docItem?.command?.title).toBe('Read Documentation');
    });

    it('should return Review Issues item', async () => {
      const children = await provider.getChildren();
      const issuesItem = children.find((item) => item.label === 'Review Issues');

      expect(issuesItem).toBeDefined();
      expect(issuesItem?.command?.command).toBe('simpleScp.openIssues');
      expect(issuesItem?.command?.title).toBe('Review Issues');
    });

    it('should return Report Issue item', async () => {
      const children = await provider.getChildren();
      const reportItem = children.find((item) => item.label === 'Report Issue');

      expect(reportItem).toBeDefined();
      expect(reportItem?.command?.command).toBe('simpleScp.reportIssue');
      expect(reportItem?.command?.title).toBe('Report Issue');
    });

    it('should return View on GitHub item', async () => {
      const children = await provider.getChildren();
      const githubItem = children.find((item) => item.label === 'View on GitHub');

      expect(githubItem).toBeDefined();
      expect(githubItem?.command?.command).toBe('simpleScp.openGitHubRepo');
      expect(githubItem?.command?.title).toBe('View on GitHub');
    });

    it('should return empty array when element is provided', async () => {
      const rootChildren = await provider.getChildren();
      const firstChild = rootChildren[0];

      const children = await provider.getChildren(firstChild);

      expect(children).toEqual([]);
    });

    it('should return all items with icons', async () => {
      const children = await provider.getChildren();

      for (const child of children) {
        expect(child.iconPath).toBeDefined();
      }
    });

    it('should return all items with commands', async () => {
      const children = await provider.getChildren();

      for (const child of children) {
        expect(child.command).toBeDefined();
        expect(child.command?.command).toBeDefined();
        expect(child.command?.title).toBeDefined();
      }
    });
  });

  describe('refresh', () => {
    it('should call refresh without errors', () => {
      expect(() => {
        provider.refresh();
      }).not.toThrow();
    });

    it('should trigger onDidChangeTreeData event when refresh is called', () => {
      return new Promise<void>((resolve) => {
        provider.onDidChangeTreeData(() => {
          resolve();
        });

        provider.refresh();
      });
    });
  });
});
