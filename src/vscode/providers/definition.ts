import * as vscode from "vscode";
import { ProjectModel } from "../../core/iapp/project.js";
import { parseIyu } from "../../core/iyu/iyu-parser.js";
import { parseMjava } from "../../core/java/mjava-parser.js";
import { inRange, iyuCallAt, mjavaSymbolAt } from "../../core/navigation/locate.js";
import { variableAt } from "../../core/navigation/variables.js";
import { explicitCallTarget } from "../../core/navigation/references.js";
import {
  ResolutionResult,
  resolveEntryCall,
  resolveModule,
  resolvePage,
  resolveQualifiedMethod,
  resolveMethod,
} from "../../core/navigation/resolver.js";
import { JavaEngine, JavaService } from "../java-service.js";
import { classLocation, methodLocation } from "../java-locations.js";
import { ProjectService } from "../project-service.js";
import { IDENTIFIER_PATTERN, baseName, fileLocation, toLocation } from "./shared.js";

export class IappDefinitionProvider implements vscode.DefinitionProvider {
  constructor(
    private readonly projects: ProjectService,
    private readonly java: JavaService,
  ) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[] | undefined> {
    const model = this.projects.getProjectForFile(document.uri.fsPath);
    if (!model) {
      return undefined;
    }
    if (document.languageId === "mjava") {
      return this.mjavaDefinition(model, document, position);
    }
    if (document.languageId === "iyu") {
      return this.iyuDefinition(model, document, position);
    }
    return undefined;
  }

  private async mjavaDefinition(
    model: ProjectModel,
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[] | undefined> {
    const moduleName = baseName(document);
    const parsed = parseMjava(moduleName, document.getText());
    const inImport = parsed.imports.some(
      (item) => item.range !== undefined && inRange(item.range, position),
    );
    const variable = inImport ? undefined : variableAt(parsed, moduleName, position);
    if (variable) {
      return [toLocation(document.uri.fsPath, variable.nameRange)];
    }
    const symbol = mjavaSymbolAt(parsed, position);
    if (!symbol) {
      const engine = await this.java.ready();
      return this.javaDefinitionForWord(engine, parsed, document, position);
    }
    if (symbol.kind === "method") {
      return [toLocation(document.uri.fsPath, symbol.method.nameRange)];
    }
    if (symbol.kind === "field") {
      return [toLocation(document.uri.fsPath, symbol.field.nameRange)];
    }

    const engine = await this.java.ready();
    if (symbol.kind === "import") {
      const context = await engine.repository.getClassContext(symbol.import.name);
      const location = context ? classLocation(context) : undefined;
      return location ? [location] : undefined;
    }

    const call = symbol.call;
    if (call.qualifier === "i") {
      const first = call.args[0]?.value;
      if (call.name === "fn" && first) {
        const module = resolveModule(model, first);
        return module ? [fileLocation(module.filePath)] : undefined;
      }
      if (call.name === "uigo" && first) {
        const page = resolvePage(model, first);
        return page ? [fileLocation(page.filePath)] : undefined;
      }
      if (call.name === "call") {
        const target = explicitCallTarget(call.args);
        return target
          ? locationsFor(resolveQualifiedMethod(model, target.qualified, target.argCount))
          : undefined;
      }
    }

    if (!call.qualifier) {
      return locationsFor(resolveMethod(model, moduleName, call.name, call.args.length));
    }

    const javaResult = await this.javaDefinitionForCall(engine, parsed, call);
    if (javaResult) {
      return javaResult;
    }
    return this.javaDefinitionForWord(engine, parsed, document, position);
  }

  private async javaDefinitionForWord(
    engine: JavaEngine,
    parsed: ReturnType<typeof parseMjava>,
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[] | undefined> {
    const range = document.getWordRangeAtPosition(position, IDENTIFIER_PATTERN);
    if (!range) {
      return undefined;
    }
    const word = document.getText(range);
    const special =
      word === "i" ? "com.iapp.app.Aid_javaCode" : word === "activity" ? "android.app.Activity" : undefined;
    const fqcn = special ?? (await engine.inference.resolveTypeName(word, parsed));
    if (!fqcn) {
      return undefined;
    }
    const context = await engine.repository.getClassContext(fqcn);
    const location = context ? classLocation(context) : undefined;
    return location ? [location] : undefined;
  }

  private async javaDefinitionForCall(
    engine: JavaEngine,
    parsed: ReturnType<typeof parseMjava>,
    call: ReturnType<typeof parseMjava>["calls"][number],
  ): Promise<vscode.Location[] | undefined> {
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
    const locations = matches
      .map((match) => methodLocation(match))
      .filter((item): item is vscode.Location => Boolean(item));
    return locations.length > 0 ? locations : undefined;
  }

  private async iyuDefinition(
    model: ProjectModel,
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[] | undefined> {
    const page = parseIyu(baseName(document), document.getText());
    const call = iyuCallAt(page, position);
    return call ? locationsFor(resolveEntryCall(model, call)) : undefined;
  }
}

export function locationsFor(result: ResolutionResult): vscode.Location[] | undefined {
  if (result.targets.length === 0) {
    return undefined;
  }
  return result.targets.map((target) =>
    toLocation(target.module.filePath, target.method.nameRange),
  );
}
