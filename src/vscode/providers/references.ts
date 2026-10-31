import * as vscode from "vscode";
import { ProjectModel } from "../../core/iapp/project.js";
import { parseIyu } from "../../core/iyu/iyu-parser.js";
import { parseMjava } from "../../core/java/mjava-parser.js";
import { inRange, iyuCallAt, mjavaSymbolAt } from "../../core/navigation/locate.js";
import { findVariableReferences, variableAt } from "../../core/navigation/variables.js";
import {
  JavaMemberTarget,
  explicitCallTarget,
  findJavaMemberReferences,
  findMethodReferences,
} from "../../core/navigation/references.js";
import {
  ResolutionResult,
  resolveEntryCall,
  resolveMethod,
  resolveQualifiedMethod,
} from "../../core/navigation/resolver.js";
import { JavaEngine, JavaService } from "../java-service.js";
import { methodLocation } from "../java-locations.js";
import { ProjectService } from "../project-service.js";
import { baseName, toLocation } from "./shared.js";

export class IappReferenceProvider implements vscode.ReferenceProvider {
  constructor(
    private readonly projects: ProjectService,
    private readonly java: JavaService,
  ) {}

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location[] | undefined> {
    const model = this.projects.getProjectForFile(document.uri.fsPath);
    if (!model) {
      return undefined;
    }
    const cancelled = () => token.isCancellationRequested;
    const engine = await this.java.ready();

    if (document.languageId === "mjava") {
      return this.mjavaReferences(model, document, position, context, engine, cancelled);
    }
    if (document.languageId === "iyu") {
      const page = parseIyu(baseName(document), document.getText());
      const call = iyuCallAt(page, position);
      if (!call) {
        return undefined;
      }
      return this.referencesOf(model, resolveEntryCall(model, call), cancelled);
    }
    return undefined;
  }

  private async mjavaReferences(
    model: ProjectModel,
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    engine: JavaEngine,
    cancelled: () => boolean,
  ): Promise<vscode.Location[] | undefined> {
    const moduleName = baseName(document);
    const parsed = parseMjava(moduleName, document.getText());
    const inImport = parsed.imports.some(
      (item) => item.range !== undefined && inRange(item.range, position),
    );
    const variable = inImport ? undefined : variableAt(parsed, moduleName, position);
    if (variable) {
      const module = model.modules.get(moduleName);
      if (module) {
        const locations = findVariableReferences(
          module,
          variable,
          context.includeDeclaration,
          cancelled,
        ).map((item) => toLocation(item.filePath, item.range));
        return locations.length > 0 ? locations : undefined;
      }
      return undefined;
    }
    const symbol = mjavaSymbolAt(parsed, position);
    if (!symbol) {
      return undefined;
    }
    if (symbol.kind === "method") {
      const locations = findMethodReferences(
        model,
        moduleName,
        symbol.method,
        context.includeDeclaration,
        cancelled,
      ).map((item) => toLocation(item.filePath, item.range));
      return locations.length > 0 ? locations : undefined;
    }
    if (symbol.kind === "call") {
      const call = symbol.call;
      if (call.qualifier === "i") {
        if (call.name !== "call") {
          return undefined;
        }
        const target = explicitCallTarget(call.args);
        if (!target) {
          return undefined;
        }
        return this.referencesOf(
          model,
          resolveQualifiedMethod(model, target.qualified, target.argCount),
          cancelled,
        );
      }
      if (!call.qualifier) {
        const result = resolveMethod(model, moduleName, call.name, call.args.length);
        return this.referencesOf(model, result, cancelled);
      }

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
      const targets = new Map<string, JavaMemberTarget>();
      for (const match of matches) {
        const target: JavaMemberTarget = {
          fqcn: match.context.class.fqcn,
          name: match.method.name,
          paramCount: match.method.params.length,
        };
        targets.set(`${target.fqcn}#${target.name}/${target.paramCount}`, target);
      }
      const locations: vscode.Location[] = [];
      for (const target of targets.values()) {
        locations.push(
          ...(await findJavaMemberReferences(
            model,
            engine.resolver,
            engine.inference,
            target,
            cancelled,
          )).map((item) => toLocation(item.filePath, item.range)),
        );
      }
      if (context.includeDeclaration) {
        for (const match of matches) {
          const location = methodLocation(match);
          if (location) {
            locations.push(location);
          }
        }
      }
      return dedupe(locations);
    }
    return undefined;
  }

  private referencesOf(
    model: ProjectModel,
    result: ResolutionResult,
    cancelled: () => boolean,
  ): vscode.Location[] | undefined {
    const locations: vscode.Location[] = [];
    for (const target of result.targets) {
      for (const reference of findMethodReferences(
        model,
        target.module.name,
        target.method,
        false,
        cancelled,
      )) {
        locations.push(toLocation(reference.filePath, reference.range));
      }
    }
    return locations.length > 0 ? dedupe(locations) : undefined;
  }
}

function dedupe(locations: vscode.Location[]): vscode.Location[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = `${location.uri.toString()}:${location.range.start.line}:${location.range.start.character}:${location.range.end.character}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
