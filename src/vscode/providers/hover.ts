import * as vscode from "vscode";
import { ProjectModel } from "../../core/iapp/project.js";
import { parseIyu } from "../../core/iyu/iyu-parser.js";
import { parseMjava } from "../../core/java/mjava-parser.js";
import { javaClassHover, javaMethodHover } from "../../core/java/java-hover.js";
import { lexicalContextAt } from "../../core/completion/lexical.js";
import { tagAtOffset } from "../../core/iyu/tags.js";
import { inRange, iyuCallAt, iyuEventAt, mjavaSymbolAt } from "../../core/navigation/locate.js";
import { variableAt, variableHover } from "../../core/navigation/variables.js";
import {
  HoverContent,
  entryHover,
  methodHover,
  moduleHover,
  pageHover,
  resolveModule,
  resolvePage,
  resolveQualifiedMethod,
  resolveMethod,
} from "../../core/navigation/resolver.js";
import { JavaEngine, JavaService } from "../java-service.js";
import { ProjectService } from "../project-service.js";
import { explicitCallTarget } from "../../core/navigation/references.js";
import { appendPlainText } from "./markdown.js";
import { IDENTIFIER_PATTERN, baseName } from "./shared.js";

export class IappHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly projects: ProjectService,
    private readonly java: JavaService,
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const model = this.projects.getProjectForFile(document.uri.fsPath);
    if (!model) {
      return undefined;
    }
    if (document.languageId === "mjava") {
      return this.mjavaHover(model, document, position);
    }
    if (document.languageId === "iyu") {
      return this.iyuHover(model, document, position);
    }
    return undefined;
  }

  private async mjavaHover(
    model: ProjectModel,
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const moduleName = baseName(document);
    const parsed = parseMjava(moduleName, document.getText());
    const inImport = parsed.imports.some(
      (item) => item.range !== undefined && inRange(item.range, position),
    );
    const variable = inImport ? undefined : variableAt(parsed, moduleName, position);
    if (variable) {
      return hoverOf([variableHover(variable)]);
    }
    const symbol = mjavaSymbolAt(parsed, position);
    if (!symbol) {
      const engine = await this.java.ready();
      return this.javaWordHover(engine, parsed, document, position);
    }
    if (symbol.kind === "method") {
      return hoverOf([methodHover(moduleName, symbol.method)]);
    }
    if (symbol.kind === "field") {
      return hoverOf([
        {
          signature: `${symbol.field.type} ${moduleName}.${symbol.field.name}`,
          details: [`模块 \`${moduleName}\``],
        },
      ]);
    }

    const engine = await this.java.ready();
    if (symbol.kind === "import") {
      const context = await engine.repository.getClassContext(symbol.import.name);
      return context ? hoverOf([javaClassHover(context)]) : undefined;
    }

    const call = symbol.call;
    if (call.qualifier === "i") {
      const first = call.args[0]?.value;
      if (call.name === "fn" && first) {
        const module = resolveModule(model, first);
        return module ? hoverOf([moduleHover(module)]) : undefined;
      }
      if (call.name === "uigo" && first) {
        const page = resolvePage(model, first);
        return page ? hoverOf([pageHover(page)]) : undefined;
      }
      if (call.name === "call") {
        const target = explicitCallTarget(call.args);
        if (target) {
          const result = resolveQualifiedMethod(model, target.qualified, target.argCount);
          return hoverOf(
            result.targets.map((item) =>
              methodHover(item.module.name, item.method, target.argCount),
            ),
          );
        }
      }
    }

    if (!call.qualifier) {
      const result = resolveMethod(model, moduleName, call.name, call.args.length);
      if (result.targets.length > 0) {
        return hoverOf(
          result.targets.map((item) =>
            methodHover(item.module.name, item.method, call.args.length),
          ),
        );
      }
    }

    const javaHover = await this.javaCallHover(engine, parsed, call);
    if (javaHover) {
      return javaHover;
    }
    return this.javaWordHover(engine, parsed, document, position);
  }

  private async javaCallHover(
    engine: JavaEngine,
    parsed: ReturnType<typeof parseMjava>,
    call: ReturnType<typeof parseMjava>["calls"][number],
  ): Promise<vscode.Hover | undefined> {
    const method = parsed.methods.find((item) => item.name === call.enclosingMethod);
    const receiverType = await engine.inference.inferCallReceiver(call, { parsed, method });
    if (!receiverType) {
      return undefined;
    }
    const matches = await engine.resolver.findMethods(
      receiverType.replace(/\[\]$/, ""),
      call.name,
      call.args.length,
    );
    return matches.length > 0 ? hoverOf(matches.map(javaMethodHover)) : undefined;
  }

  private async javaWordHover(
    engine: JavaEngine,
    parsed: ReturnType<typeof parseMjava>,
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const range = document.getWordRangeAtPosition(position, IDENTIFIER_PATTERN);
    if (!range) {
      return undefined;
    }
    const word = document.getText(range);
    const special =
      word === "i"
        ? "com.iapp.app.Aid_javaCode"
        : word === "activity"
          ? "android.app.Activity"
          : undefined;
    const fqcn = special ?? (await engine.inference.resolveTypeName(word, parsed));
    if (!fqcn) {
      return undefined;
    }
    const context = await engine.repository.getClassContext(fqcn);
    return context ? hoverOf([javaClassHover(context)]) : undefined;
  }

  private iyuHover(
    model: ProjectModel,
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const text = document.getText();
    if (lexicalContextAt(text, document.offsetAt(position)) === "code") {
      const hit = tagAtOffset(text, document.offsetAt(position));
      if (hit) {
        return this.iyuTagHover(hit);
      }
    }
    const page = parseIyu(baseName(document), text);
    const call = iyuCallAt(page, position);
    if (call) {
      const eventType = iyuEventAt(page, position)?.type ?? "";
      const hover = entryHover(model, eventType, call);
      return hover ? hoverOf([hover]) : undefined;
    }
    const event = iyuEventAt(page, position);
    if (event) {
      return hoverOf([
        {
          signature: `事件 ${event.type}`,
          details: [`${event.calls.length} 条调用`],
          language: "text",
        },
      ]);
    }
    return undefined;
  }

  private iyuTagHover(
    hit: NonNullable<ReturnType<typeof tagAtOffset>>,
  ): vscode.Hover | undefined {
    const signature = hit.tag.closing ? `</${hit.tag.name}>` : `<${hit.tag.name}>`;
    if (hit.attribute) {
      const attribute = hit.doc?.attributes.find((item) => item.name === hit.attribute?.name);
      return hoverOf([
        {
          signature: `${hit.tag.name} ${hit.attribute.name}`,
          language: "text",
          details: [
            attribute?.summary ?? "未知属性。",
            `所属标签：${signature}`,
          ],
        },
      ]);
    }
    if (hit.doc) {
      return hoverOf([
        {
          signature,
          language: "text",
          details: [
            hit.doc.summary,
            ...hit.doc.details,
            ...hit.doc.attributes.map((attribute) => `${attribute.name}：${attribute.summary}`),
            hit.doc.children.length > 0 ? `子标签：${hit.doc.children.join("、")}` : "",
          ].filter(Boolean),
        },
      ]);
    }
    return hoverOf([
      {
        signature,
        language: "text",
        details: ["未知标签；iyu 只支持 View、ppt、event、UIEventset、eventItme。"],
      },
    ]);
  }
}

function hoverOf(contents: HoverContent[]): vscode.Hover | undefined {
  if (contents.length === 0) {
    return undefined;
  }
  const markdown = new vscode.MarkdownString();
  contents.forEach((content, index) => {
    if (index > 0) {
      markdown.appendMarkdown("\n\n---\n\n");
    }
    markdown.appendCodeblock(content.signature, content.language ?? "java");
    if (content.javadoc) {
      markdown.appendMarkdown("\n\n");
      appendPlainText(markdown, content.javadoc);
    }
    if (content.details.length > 0) {
      markdown.appendMarkdown(`\n${content.details.map((item) => `- ${item}`).join("\n")}`);
    }
  });
  return new vscode.Hover(markdown);
}
