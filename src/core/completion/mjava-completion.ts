import { ProjectModel, ProjectModule } from "../iapp/project.js";
import { IAPP_STUB_FQCN } from "../java/iapp-stubs.js";
import { JavaMethodInfo } from "../java/java-class-parser.js";
import type { JavaSourceRepository } from "../java/java-repository.js";
import { JavaMemberList, JavaTypeResolver } from "../java/java-resolver.js";
import { MjavaFile, MjavaMethod } from "../java/mjava-parser.js";
import { MjavaTypeInference } from "../java/type-inference.js";
import { SourcePosition } from "../model/source.js";
import { compare } from "../navigation/locate.js";
import { loadClosure } from "../navigation/resolver.js";
import { methodDetail } from "../navigation/symbols.js";
import { CompletionCandidate } from "./types.js";

export function completeMethods(
  model: ProjectModel,
  moduleName: string,
  prefix: string,
): CompletionCandidate[] {
  const current = model.modules.get(moduleName);
  if (!current) {
    return [];
  }
  const loaded = loadClosure(model, moduleName);
  loaded.delete(moduleName);

  const candidates: CompletionCandidate[] = [];
  const seen = new Set<string>();
  const push = (module: ProjectModule, method: MjavaMethod, sortGroup: number): void => {
    const key = `${module.name}#${method.name}#${method.params.map((param) => param.type).join(",")}`;
    if (seen.has(key) || !matches(method.name, prefix)) {
      return;
    }
    seen.add(key);
    candidates.push(methodCandidate(method, module.name, sortGroup));
  };

  for (const method of current.parsed.methods) {
    push(current, method, 0);
  }
  for (const name of loaded) {
    const module = model.modules.get(name);
    if (!module) {
      continue;
    }
    for (const method of module.parsed.methods) {
      push(module, method, 1);
    }
  }
  for (const module of model.modules.values()) {
    if (module.name !== moduleName && !loaded.has(module.name)) {
      for (const method of module.parsed.methods) {
        push(module, method, 2);
      }
    }
  }
  return sortCandidates(candidates);
}

/** 当前方法可见的局部变量、形参与模块字段。 */
export function completeVariables(
  parsed: MjavaFile,
  moduleName: string,
  method: MjavaMethod | undefined,
  position: SourcePosition,
  prefix: string,
): CompletionCandidate[] {
  const candidates: CompletionCandidate[] = [];
  const seen = new Set<string>();
  const push = (name: string, type: string, label: string): void => {
    if (seen.has(name) || !matches(name, prefix)) {
      return;
    }
    seen.add(name);
    candidates.push({
      label: name,
      kind: "variable",
      detail: type ? `${type} ${name}` : name,
      documentation: label,
      insertText: name,
      sortGroup: 0,
    });
  };

  if (method) {
    const locals = method.locals
      .filter(
        (local) =>
          compare(local.nameRange.start, position) <= 0,
      )
      .sort((a, b) => compare(b.nameRange.start, a.nameRange.start));
    for (const local of locals) {
      push(local.name, local.type, "局部变量");
    }
    for (const param of method.params) {
      push(param.name, param.type, "形参");
    }
  }
  for (const field of parsed.fields) {
    push(field.name, field.type, `模块字段 · ${moduleName}`);
  }
  return sortCandidates(candidates);
}

export function completeModules(model: ProjectModel, prefix: string): CompletionCandidate[] {
  return sortCandidates(
    [...model.modules.values()]
      .filter((module) => matches(module.name, prefix))
      .map((module) => ({
        label: module.name,
        kind: "module",
        detail: `${module.parsed.methods.length} 方法`,
        documentation: [module.parsed.documentation, `模块 ${module.name}`]
          .filter(Boolean)
          .join("\n\n"),
        insertText: module.name,
        sortGroup: 0,
      })),
  );
}

export function completePages(model: ProjectModel, prefix: string): CompletionCandidate[] {
  return sortCandidates(
    [...model.pages.values()]
      .filter((page) => matches(`${page.name}.iyu`, prefix) || matches(page.name, prefix))
      .map((page) => ({
        label: `${page.name}.iyu`,
        kind: "page",
        detail: `${page.parsed.events.length} 事件`,
        documentation: `页面 ${page.name}`,
        insertText: `${page.name}.iyu`,
        sortGroup: 0,
      })),
  );
}

/** `i.call("mjava", "mod.method")` 与 iyu `call` 的字符串补全。 */
export function completeQualifiedMethods(
  model: ProjectModel,
  prefix: string,
): CompletionCandidate[] {
  const dot = prefix.lastIndexOf(".");
  const moduleFilter = dot >= 0 ? prefix.slice(0, dot) : prefix;
  const methodFilter = dot >= 0 ? prefix.slice(dot + 1) : "";
  const candidates: CompletionCandidate[] = [];
  const seen = new Set<string>();

  for (const module of model.modules.values()) {
    if (!matches(module.name, moduleFilter)) {
      continue;
    }
    for (const method of module.parsed.methods) {
      if (dot >= 0 && !matches(method.name, methodFilter)) {
        continue;
      }
      const label = `${module.name}.${method.name}`;
      if (!matches(label, prefix)) {
        continue;
      }
      const key = `${label}#${method.params.map((param) => param.type).join(",")}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({
        label,
        kind: "method",
        detail: methodDetail(method),
        documentation: [method.documentation, `模块 ${module.name}`]
          .filter(Boolean)
          .join("\n\n"),
        insertText: label,
        sortGroup: 0,
      });
    }
  }
  return sortCandidates(candidates);
}

export async function completeIMembers(
  repository: JavaSourceRepository,
  resolver: JavaTypeResolver,
  prefix: string,
): Promise<CompletionCandidate[]> {
  const context = await repository.getClassContext(IAPP_STUB_FQCN);
  if (!context) {
    return [];
  }
  const members = await resolver.listMembers(IAPP_STUB_FQCN);
  return memberCandidates(members, prefix, IAPP_STUB_FQCN);
}

export async function completeJavaMembers(
  parsed: MjavaFile,
  method: MjavaMethod | undefined,
  receiver: string,
  prefix: string,
  inference: MjavaTypeInference,
  resolver: JavaTypeResolver,
  position?: SourcePosition,
): Promise<CompletionCandidate[]> {
  const type = await inference.inferExpression(receiver, { parsed, method, position });
  if (!type) {
    return [];
  }
  const fqcn = type.replace(/\[\]$/, "");
  const members = await resolver.listMembers(fqcn);
  return memberCandidates(members, prefix, fqcn);
}

function memberCandidates(
  members: JavaMemberList,
  prefix: string,
  receiverFqcn: string,
): CompletionCandidate[] {
  const candidates: CompletionCandidate[] = [];
  for (const match of members.methods) {
    const method = match.method;
    if (!matches(method.name, prefix)) {
      continue;
    }
    const documentation = [
      method.javadoc,
      `声明于 ${match.context.class.fqcn}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    candidates.push({
      label: method.name,
      kind: "method",
      detail: javaMethodDetail(method),
      documentation,
      insertText: methodSnippet(method),
      snippet: true,
      sortGroup: memberGroup(match.context.class.fqcn, receiverFqcn),
    });
  }
  for (const match of members.fields) {
    const field = match.field;
    if (!matches(field.name, prefix)) {
      continue;
    }
    candidates.push({
      label: field.name,
      kind: "field",
      detail: javaFieldDetail(field),
      documentation: [
        field.javadoc,
        `声明于 ${match.context.class.fqcn}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      insertText: field.name,
      sortGroup: memberGroup(match.context.class.fqcn, receiverFqcn),
    });
  }
  return sortCandidates(candidates).slice(0, 800);
}

function memberGroup(declaringClass: string, receiverType: string): number {
  if (declaringClass === receiverType) {
    return 0;
  }
  return declaringClass === "java.lang.Object" ? 9 : 1;
}

function methodCandidate(
  method: MjavaMethod,
  moduleName: string,
  sortGroup: number,
): CompletionCandidate {
  return {
    label: method.name,
    kind: "method",
    detail: methodDetail(method),
    documentation: [method.documentation, `模块 ${moduleName}`]
      .filter(Boolean)
      .join("\n\n"),
    insertText: methodSnippet(method),
    snippet: true,
    sortGroup,
  };
}

function methodSnippet(method: { name: string; params: Array<{ name: string }> }): string {
  if (method.params.length === 0) {
    return `${method.name}()`;
  }
  const params = method.params
    .map((param, index) => `\${${index + 1}:${param.name}}`)
    .join(", ");
  return `${method.name}(${params})`;
}

function javaMethodDetail(method: JavaMethodInfo): string {
  const params = method.params.map((param) => `${param.type} ${param.name}`).join(", ");
  return `${method.returnType} ${method.name}(${params})`;
}

function matches(label: string, prefix: string): boolean {
  return prefix === "" || label.startsWith(prefix);
}

function sortCandidates(candidates: CompletionCandidate[]): CompletionCandidate[] {
  return candidates.sort(
    (a, b) => a.sortGroup - b.sortGroup || a.label.localeCompare(b.label),
  );
}

function javaFieldDetail(field: { type: string; name: string }): string {
  return `${field.type} ${field.name}`;
}
