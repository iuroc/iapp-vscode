import path from "node:path";
import * as vscode from "vscode";
import {
  ProjectModel,
  findProjectRoot,
  isIappProject,
  loadProject,
  updateProjectFile,
} from "../core/iapp/project.js";

const CHANGE_DEBOUNCE_MS = 80;

export class ProjectService implements vscode.Disposable {
  private readonly models = new Map<string, ProjectModel>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly changeEmitter = new vscode.EventEmitter<string>();
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.watcher = vscode.workspace.createFileSystemWatcher(
      "**/{*.mjava,*.iyu,AndroidManifest.xml}",
    );
    this.disposables.push(
      this.watcher,
      this.watcher.onDidChange((uri) => this.schedule(uri.fsPath)),
      this.watcher.onDidCreate((uri) => this.schedule(uri.fsPath)),
      this.watcher.onDidDelete((uri) => this.schedule(uri.fsPath)),
    );
  }

  /** 文件所在工程的模型；文件不属于任何工程时返回 undefined。 */
  getProjectForFile(filePath: string): ProjectModel | undefined {
    const root = findProjectRoot(filePath);
    return root ? this.getModel(root) : undefined;
  }

  getModel(root: string): ProjectModel {
    const cached = this.models.get(root);
    if (cached) {
      return cached;
    }
    const model = loadProject(root);
    this.models.set(root, model);
    return model;
  }

  /** 工作区里所有满足识别条件的工程根（入口页或 iApp manifest）。 */
  async discoverProjectRoots(): Promise<string[]> {
    const exclude = "**/{node_modules,dist,out,out-test}/**";
    const roots = new Set<string>();
    for (const file of await vscode.workspace.findFiles("**/src/mian.iyu", exclude)) {
      const root = path.dirname(path.dirname(file.fsPath));
      if (isIappProject(root)) {
        roots.add(root);
      }
    }
    for (const file of await vscode.workspace.findFiles("**/AndroidManifest.xml", exclude)) {
      const root = path.dirname(file.fsPath);
      if (isIappProject(root)) {
        roots.add(root);
      }
    }
    return [...roots];
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.changeEmitter.dispose();
  }

  private schedule(filePath: string): void {
    const root = findProjectRoot(filePath);
    if (!root) {
      return;
    }
    const pending = this.timers.get(root);
    if (pending) {
      clearTimeout(pending);
    }
    this.timers.set(
      root,
      setTimeout(() => {
        this.timers.delete(root);
        this.refresh(root, filePath);
      }, CHANGE_DEBOUNCE_MS),
    );
  }

  private refresh(root: string, filePath: string): void {
    if (!isIappProject(root)) {
      this.models.delete(root);
      this.changeEmitter.fire(root);
      return;
    }
    const model = this.models.get(root);
    if (model) {
      updateProjectFile(model, filePath);
    } else {
      this.models.set(root, loadProject(root));
    }
    this.changeEmitter.fire(root);
  }
}
