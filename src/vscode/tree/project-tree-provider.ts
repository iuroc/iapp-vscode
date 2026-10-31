import * as vscode from "vscode";
import { ProjectTreeNode } from "../../core/navigation/tree.js";
import { buildProjectTree } from "../../core/navigation/tree.js";
import { ProjectService } from "../project-service.js";

interface TreeElement {
  node: ProjectTreeNode;
}

const ICONS: Record<ProjectTreeNode["kind"], string> = {
  project: "package",
  module: "symbol-module",
  page: "file-media",
  method: "symbol-method",
  event: "zap",
  call: "symbol-function",
};

export class ProjectTreeProvider
  implements vscode.TreeDataProvider<TreeElement>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private roots: string[] | undefined;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly projects: ProjectService) {
    this.disposables.push(
      projects.onDidChange(() => this.refresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
    );
  }

  refresh(): void {
    this.roots = undefined;
    this.changeEmitter.fire();
  }

  async getChildren(element?: TreeElement): Promise<TreeElement[]> {
    if (!element) {
      const roots = await this.discoverRoots();
      return roots.map((root) => ({
        node: buildProjectTree(this.projects.getModel(root)),
      }));
    }
    return (element.node.children ?? []).map((node) => ({ node }));
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    const node = element.node;
    const collapsible =
      node.children && node.children.length > 0
        ? node.kind === "project"
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsible);
    item.description = node.detail;
    if (node.tooltip) {
      item.tooltip = node.tooltip;
    }
    item.iconPath = new vscode.ThemeIcon(ICONS[node.kind]);
    item.id = `${node.kind}:${node.filePath ?? ""}:${node.label}:${node.range?.start.line ?? ""}`;
    if (node.filePath) {
      item.command = {
        command: "iapp.openLocation",
        title: "打开",
        arguments: [
          node.filePath,
          node.range?.start.line ?? 0,
          node.range?.start.character ?? 0,
        ],
      };
    }
    return item;
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.changeEmitter.dispose();
  }

  private discoverRoots(): Promise<string[]> {
    if (this.roots) {
      return Promise.resolve(this.roots);
    }
    return this.projects.discoverProjectRoots().then((roots) => {
      this.roots = roots;
      return roots;
    });
  }
}
