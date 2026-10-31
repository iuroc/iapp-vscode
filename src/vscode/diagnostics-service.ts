import * as vscode from "vscode";
import {
  IappDiagnostic,
  IappSeverity,
  lintProject,
} from "../core/diagnostics/lint.js";
import { ProjectService } from "./project-service.js";
import { toRange } from "./providers/shared.js";

const SAVE_DEBOUNCE_MS = 150;
const SEVERITIES: Record<IappSeverity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
};

export class DiagnosticsService implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("iapp");
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly filesByRoot = new Map<string, Set<string>>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly projects: ProjectService) {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.languageId === "mjava" || document.languageId === "iyu") {
          this.schedule(document.uri.fsPath);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.languageId === "mjava" || document.languageId === "iyu") {
          this.schedule(document.uri.fsPath);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("iapp.lint.enabled") ||
          event.affectsConfiguration("iapp.lint.disabledRules")
        ) {
          void this.refreshAll();
        }
      }),
      projects.onDidChange((root) => this.refresh(root)),
    );
  }

  async refreshAll(): Promise<void> {
    for (const root of await this.projects.discoverProjectRoots()) {
      this.refresh(root);
    }
  }

  refresh(root: string): void {
    const config = vscode.workspace.getConfiguration("iapp");
    if (!config.get<boolean>("lint.enabled", true)) {
      this.clearRoot(root);
      return;
    }
    const model = this.projects.getModel(root);
    const diagnostics = lintProject(model, {
      disabledRules: config.get<string[]>("lint.disabledRules", []),
    });
    this.publish(root, diagnostics);
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.collection.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private schedule(filePath: string): void {
    const model = this.projects.getProjectForFile(filePath);
    if (!model) {
      return;
    }
    const pending = this.timers.get(model.root);
    if (pending) {
      clearTimeout(pending);
    }
    this.timers.set(
      model.root,
      setTimeout(() => {
        this.timers.delete(model.root);
        this.refresh(model.root);
      }, SAVE_DEBOUNCE_MS),
    );
  }

  private publish(
    root: string,
    diagnostics: Map<string, IappDiagnostic[]>,
  ): void {
    const previous = this.filesByRoot.get(root) ?? new Set<string>();
    const current = new Set<string>();
    for (const [filePath, items] of diagnostics) {
      current.add(filePath);
      this.set(filePath, items);
    }
    for (const filePath of previous) {
      if (!current.has(filePath)) {
        this.collection.delete(vscode.Uri.file(filePath));
      }
    }
    this.filesByRoot.set(root, current);
  }

  private set(filePath: string, items: IappDiagnostic[]): void {
    this.collection.set(
      vscode.Uri.file(filePath),
      items.map((item) => {
        const diagnostic = new vscode.Diagnostic(
          toRange(item.range),
          item.message,
          SEVERITIES[item.severity],
        );
        diagnostic.code = item.code;
        diagnostic.source = "iapp";
        return diagnostic;
      }),
    );
  }

  private clearRoot(root: string): void {
    for (const filePath of this.filesByRoot.get(root) ?? []) {
      this.collection.delete(vscode.Uri.file(filePath));
    }
    this.filesByRoot.delete(root);
  }
}
