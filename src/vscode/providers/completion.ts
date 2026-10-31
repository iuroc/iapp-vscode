import * as vscode from "vscode";
import { ProjectModel } from "../../core/iapp/project.js";
import { lexicalContextAt } from "../../core/completion/lexical.js";
import {
  completeIMembers,
  completeJavaMembers,
  completeMethods,
  completeModules,
  completePages,
  completeQualifiedMethods,
  completeVariables,
} from "../../core/completion/mjava-completion.js";
import { completeCallTargets, completeEventTypes } from "../../core/completion/iyu-completion.js";
import { IYU_TAG_DOCS, findIyuTagDoc, tagCompletionAt } from "../../core/iyu/tags.js";
import { extractMemberAccess } from "../../core/completion/receiver.js";
import { CompletionCandidate, CompletionKind } from "../../core/completion/types.js";
import { parseMjava } from "../../core/java/mjava-parser.js";
import { inRange } from "../../core/navigation/locate.js";
import { JavaService } from "../java-service.js";
import { ProjectService } from "../project-service.js";
import { plainTextMarkdown } from "./markdown.js";
import { IDENTIFIER_PATTERN, baseName } from "./shared.js";

const KIND_MAP: Record<CompletionKind, vscode.CompletionItemKind> = {
  method: vscode.CompletionItemKind.Method,
  field: vscode.CompletionItemKind.Field,
  variable: vscode.CompletionItemKind.Variable,
  module: vscode.CompletionItemKind.Module,
  page: vscode.CompletionItemKind.File,
  event: vscode.CompletionItemKind.Event,
  class: vscode.CompletionItemKind.Class,
};

export class IappCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly projects: ProjectService,
    private readonly java: JavaService,
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const model = this.projects.getProjectForFile(document.uri.fsPath);
    if (!model) {
      return undefined;
    }
    const text = document.getText();
    const offset = document.offsetAt(position);
    const lexical = lexicalContextAt(text, offset);
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);

    if (document.languageId === "mjava") {
      return this.mjavaCompletion(model, document, position, text, lexical, linePrefix, token);
    }
    if (document.languageId === "iyu") {
      return this.iyuCompletion(model, document, position, lexical, linePrefix);
    }
    return undefined;
  }

  private async mjavaCompletion(
    model: ProjectModel,
    document: vscode.TextDocument,
    position: vscode.Position,
    text: string,
    lexical: ReturnType<typeof lexicalContextAt>,
    linePrefix: string,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const engine = await this.java.ready();
    if (token.isCancellationRequested) {
      return undefined;
    }

    if (lexical === "string") {
      const stringRange = this.stringRange(document, position);
      if (!stringRange) {
        return undefined;
      }
      const stringPrefix = document
        .lineAt(position.line)
        .text.slice(stringRange.start.character, position.character);

      if (/i\s*\.\s*fn\s*\(\s*"[^"]*$/.test(linePrefix)) {
        return this.toItems(completeModules(model, stringPrefix), stringRange);
      }
      if (/i\s*\.\s*uigo\s*\(\s*"[^"]*$/.test(linePrefix)) {
        return this.toItems(completePages(model, stringPrefix), stringRange);
      }
      if (/i\s*\.\s*call\s*\(\s*"mjava"\s*,\s*"[^"]*$/.test(linePrefix)) {
        return this.toItems(completeQualifiedMethods(model, stringPrefix), stringRange);
      }
      return undefined;
    }

    if (lexical !== "code") {
      return undefined;
    }

    const member = extractMemberAccess(linePrefix);
    if (member) {
      const parsed = parseMjava(baseName(document), text);
      const method = parsed.methods.find((item) => inRange(item.range, position));
      const candidates =
        member.receiver === "i"
          ? await completeIMembers(engine.repository, engine.resolver, member.prefix)
          : await completeJavaMembers(
              parsed,
              method,
              member.receiver,
              member.prefix,
              engine.inference,
              engine.resolver,
              position,
            );
      return this.toItems(candidates, undefined, this.atParen(document, position));
    }

    const prefix = trailingWord(linePrefix);
    const parsed = parseMjava(baseName(document), text);
    const method = parsed.methods.find((item) => inRange(item.range, position));
    const candidates = [
      ...completeVariables(parsed, baseName(document), method, position, prefix),
      ...completeMethods(model, baseName(document), prefix),
    ];
    return this.toItems(candidates, undefined, this.atParen(document, position));
  }

  private iyuCompletion(
    model: ProjectModel,
    document: vscode.TextDocument,
    position: vscode.Position,
    lexical: ReturnType<typeof lexicalContextAt>,
    linePrefix: string,
  ): vscode.CompletionItem[] | undefined {
    if (lexical === "code") {
      return this.iyuTagCompletion(document, position);
    }
    if (lexical !== "string") {
      return undefined;
    }
    const stringRange = this.stringRange(document, position);
    if (!stringRange) {
      return undefined;
    }
    const stringPrefix = document
      .lineAt(position.line)
      .text.slice(stringRange.start.character, position.character);

    const eventType = /eventItme\s+type\s*=\s*"[^"]*$/.exec(linePrefix);
    if (eventType) {
      return this.toItems(completeEventTypes(model, stringPrefix), stringRange);
    }
    if (/call\s*\(\s*[^,]+,\s*"mjava"\s*,\s*"[^"]*$/.test(linePrefix)) {
      return this.toItems(completeCallTargets(model, stringPrefix), stringRange);
    }
    return undefined;
  }

  private iyuTagCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const context = tagCompletionAt(document.getText(), document.offsetAt(position));
    if (!context) {
      return undefined;
    }

    if (context.kind === "tag" || context.kind === "closing") {
      const docs = IYU_TAG_DOCS.filter((doc) => doc.name.startsWith(context.prefix));
      if (docs.length === 0) {
        return undefined;
      }
      return docs.map((doc) => {
        const item = new vscode.CompletionItem(doc.name, vscode.CompletionItemKind.Class);
        item.detail = doc.summary;
        item.documentation = plainTextMarkdown(
          [
            doc.summary,
            ...doc.details,
            doc.attributes.length > 0
              ? `属性：${doc.attributes.map((attribute) => attribute.name).join("、")}`
              : "",
            doc.children.length > 0 ? `子标签：${doc.children.join("、")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        item.insertText = context.kind === "closing" ? `${doc.name}>` : doc.name;
        return item;
      });
    }

    const doc = findIyuTagDoc(context.tagName);
    if (!doc || doc.attributes.length === 0) {
      return undefined;
    }
    const attributes = doc.attributes.filter(
      (attribute) =>
        attribute.name.startsWith(context.prefix) &&
        !context.existingAttributes.includes(attribute.name),
    );
    if (attributes.length === 0) {
      return undefined;
    }
    return attributes.map((attribute) => {
      const item = new vscode.CompletionItem(attribute.name, vscode.CompletionItemKind.Property);
      item.detail = attribute.summary;
      item.documentation = plainTextMarkdown(attribute.summary);
      item.insertText = new vscode.SnippetString(
        `${attribute.name}="\${1:${attribute.valueHint ?? ""}}"`,
      );
      return item;
    });
  }

  private toItems(
    candidates: CompletionCandidate[],
    stringRange?: vscode.Range,
    disableSnippet = false,
  ): vscode.CompletionItem[] | undefined {
    if (candidates.length === 0) {
      return undefined;
    }
    return candidates.map((candidate) => {
      const item = new vscode.CompletionItem(candidate.label, KIND_MAP[candidate.kind]);
      item.detail = candidate.detail;
      item.filterText = candidate.label;
      item.sortText = `${String(candidate.sortGroup).padStart(2, "0")}-${candidate.label}`;
      if (candidate.documentation) {
        item.documentation = plainTextMarkdown(candidate.documentation);
      }
      if (candidate.insertText) {
        if (candidate.snippet && !disableSnippet) {
          item.insertText = new vscode.SnippetString(candidate.insertText);
        } else {
          item.insertText = disableSnippet ? candidate.label : candidate.insertText;
        }
      }
      if (stringRange) {
        item.range = stringRange;
      }
      return item;
    });
  }

  private atParen(document: vscode.TextDocument, position: vscode.Position): boolean {
    const before =
      position.character > 0
        ? document.lineAt(position.line).text[position.character - 1]
        : "";
    const after =
      position.character < document.lineAt(position.line).text.length
        ? document.lineAt(position.line).text[position.character]
        : "";
    return before === "(" || after === "(";
  }

  private stringRange(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Range | undefined {
    const line = document.lineAt(position.line).text;
    let index = position.character - 1;
    while (index >= 0) {
      if (line[index] === '"' && line[index - 1] !== "\\") {
        return new vscode.Range(position.line, index + 1, position.line, position.character);
      }
      index--;
    }
    return undefined;
  }
}

function trailingWord(linePrefix: string): string {
  const match = new RegExp(`${IDENTIFIER_PATTERN.source}$`).exec(linePrefix);
  return match?.[0] ?? "";
}
