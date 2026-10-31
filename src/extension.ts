import path from "node:path";
import * as vscode from "vscode";
import { registerAndroidSourcesCommand } from "./vscode/android-sources-command.js";
import { DiagnosticsService } from "./vscode/diagnostics-service.js";
import { JAVA_SOURCE_SCHEME } from "./vscode/java-locations.js";
import { JavaService } from "./vscode/java-service.js";
import { JavaSourceContentProvider } from "./vscode/java-source-provider.js";
import { IappCompletionProvider } from "./vscode/providers/completion.js";
import { IappDefinitionProvider } from "./vscode/providers/definition.js";
import { IappHoverProvider } from "./vscode/providers/hover.js";
import { IappReferenceProvider } from "./vscode/providers/references.js";
import { IappDocumentSymbolProvider } from "./vscode/providers/symbols.js";
import { ProjectService } from "./vscode/project-service.js";
import { ProjectTreeProvider } from "./vscode/tree/project-tree-provider.js";

const SELECTORS: vscode.DocumentFilter[] = [
  { language: "mjava", scheme: "file" },
  { language: "iyu", scheme: "file" },
];

export function activate(context: vscode.ExtensionContext): void {
  const projects = new ProjectService();
  const java = new JavaService(
    path.join(context.globalStorageUri.fsPath, "android-sources"),
  );
  const diagnostics = new DiagnosticsService(projects);
  const tree = new ProjectTreeProvider(projects);

  context.subscriptions.push(
    projects,
    java,
    diagnostics,
    tree,
    vscode.window.registerTreeDataProvider("iapp.projectTree", tree),
    registerAndroidSourcesCommand(context, java),
    vscode.commands.registerCommand("iapp.refreshProjects", () => tree.refresh()),
    vscode.commands.registerCommand(
      "iapp.openLocation",
      async (filePath: string, line = 0, character = 0) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        const editor = await vscode.window.showTextDocument(document, { preview: true });
        const position = new vscode.Position(line, character);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter,
        );
      },
    ),
    vscode.workspace.registerTextDocumentContentProvider(
      JAVA_SOURCE_SCHEME,
      new JavaSourceContentProvider(java),
    ),
    vscode.languages.registerDefinitionProvider(
      SELECTORS,
      new IappDefinitionProvider(projects, java),
    ),
    vscode.languages.registerHoverProvider(
      SELECTORS,
      new IappHoverProvider(projects, java),
    ),
    vscode.languages.registerDocumentSymbolProvider(
      SELECTORS,
      new IappDocumentSymbolProvider(projects),
    ),
    vscode.languages.registerReferenceProvider(
      SELECTORS,
      new IappReferenceProvider(projects, java),
    ),
    vscode.languages.registerCompletionItemProvider(
      SELECTORS,
      new IappCompletionProvider(projects, java),
      ".",
      '"',
      "<",
    ),
  );
  void diagnostics.refreshAll();
}

export function deactivate(): void {
  // 资源释放由各注册项自行处理。
}
