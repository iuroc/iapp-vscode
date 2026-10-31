import * as vscode from "vscode";
import { javaLocationFromUri } from "./java-locations.js";
import { JavaService } from "./java-service.js";

export class JavaSourceContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly java: JavaService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const engine = await this.java.ready();
    const file = await engine.repository.getFile(javaLocationFromUri(uri));
    return file?.text ?? "// 源码不可用";
  }
}
