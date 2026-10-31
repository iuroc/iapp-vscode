import * as vscode from "vscode";
import { ProjectModel } from "../../core/iapp/project.js";
import { parseIyu } from "../../core/iyu/iyu-parser.js";
import { parseMjava } from "../../core/java/mjava-parser.js";
import { CoreSymbol, iyuSymbols, mjavaSymbols } from "../../core/navigation/symbols.js";
import { resolveEntryCall } from "../../core/navigation/resolver.js";
import { ProjectService } from "../project-service.js";
import { baseName, toRange } from "./shared.js";

const SYMBOL_KINDS: Record<CoreSymbol["kind"], vscode.SymbolKind> = {
  method: vscode.SymbolKind.Method,
  field: vscode.SymbolKind.Field,
  event: vscode.SymbolKind.Event,
  call: vscode.SymbolKind.Function,
};

export class IappDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private readonly projects: ProjectService) {}

  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] | undefined {
    const model = this.projects.getProjectForFile(document.uri.fsPath);
    if (!model) {
      return undefined;
    }
    if (document.languageId === "mjava") {
      return toSymbols(this.mjavaSymbols(document));
    }
    if (document.languageId === "iyu") {
      return toSymbols(this.iyuSymbols(model, document));
    }
    return undefined;
  }

  private mjavaSymbols(document: vscode.TextDocument): CoreSymbol[] {
    const name = baseName(document);
    const parsed = parseMjava(name, document.getText());
    return mjavaSymbols({ name, filePath: document.uri.fsPath, parsed });
  }

  private iyuSymbols(model: ProjectModel, document: vscode.TextDocument): CoreSymbol[] {
    const name = baseName(document);
    const parsed = parseIyu(name, document.getText());
    return iyuSymbols({ name, filePath: document.uri.fsPath, parsed }, (call) => {
      const target = resolveEntryCall(model, call).targets[0];
      return target ? `${target.module.name}.${target.method.name}` : undefined;
    });
  }
}

function toSymbols(symbols: CoreSymbol[]): vscode.DocumentSymbol[] {
  return symbols.map((symbol) => {
    const result = new vscode.DocumentSymbol(
      symbol.name,
      symbol.detail,
      SYMBOL_KINDS[symbol.kind],
      toRange(symbol.range),
      toRange(symbol.selectionRange),
    );
    if (symbol.children && symbol.children.length > 0) {
      result.children = toSymbols(symbol.children);
    }
    return result;
  });
}
