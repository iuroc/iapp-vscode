import path from "node:path";
import * as vscode from "vscode";
import { SourceRange } from "../../core/model/source.js";

export const IDENTIFIER_PATTERN = /[A-Za-z_$][\w$]*/;

export function baseName(document: vscode.TextDocument): string {
  return path.basename(document.uri.fsPath, path.extname(document.uri.fsPath));
}

export function toRange(range: SourceRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  );
}

export function toLocation(filePath: string, range: SourceRange): vscode.Location {
  return new vscode.Location(vscode.Uri.file(filePath), toRange(range));
}

export function fileLocation(filePath: string): vscode.Location {
  return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(0, 0));
}
