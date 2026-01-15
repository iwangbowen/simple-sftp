import * as vscode from 'vscode';

/**
 * Tree item for help and feedback view
 */
class HelpFeedbackItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly command?: vscode.Command,
    public readonly iconPath?: vscode.ThemeIcon
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = command;
    this.iconPath = iconPath;
  }
}

/**
 * Tree data provider for Help and Feedback view
 */
export class HelpFeedbackTreeProvider implements vscode.TreeDataProvider<HelpFeedbackItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<HelpFeedbackItem | undefined | null | void> = new vscode.EventEmitter<HelpFeedbackItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<HelpFeedbackItem | undefined | null | void> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: HelpFeedbackItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: HelpFeedbackItem): Promise<HelpFeedbackItem[]> {
    if (element) {
      return [];
    }

    return [
      new HelpFeedbackItem(
        'Read Documentation',
        {
          command: 'simpleSftp.openGitHubReadme',
          title: 'Read Documentation',
          arguments: []
        },
        new vscode.ThemeIcon('book')
      ),
      new HelpFeedbackItem(
        'Review Issues',
        {
          command: 'simpleSftp.openIssues',
          title: 'Review Issues',
          arguments: []
        },
        new vscode.ThemeIcon('issues')
      ),
      new HelpFeedbackItem(
        'Report Issue',
        {
          command: 'simpleSftp.reportIssue',
          title: 'Report Issue',
          arguments: []
        },
        new vscode.ThemeIcon('comment')
      ),
      new HelpFeedbackItem(
        'View on GitHub',
        {
          command: 'simpleSftp.openGitHubRepo',
          title: 'View on GitHub',
          arguments: []
        },
        new vscode.ThemeIcon('github')
      )
    ];
  }
}
