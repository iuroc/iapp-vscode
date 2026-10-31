import { ProjectModel, ProjectModule, ProjectPage } from "../iapp/project.js";
import { MjavaCall } from "../java/mjava-parser.js";
import { IyuEvent } from "../iyu/iyu-parser.js";
import { findIyuTagDoc, scanIyuTags } from "../iyu/tags.js";
import { LineIndex, SourceRange } from "../model/source.js";
import {
  loadClosure,
  resolveEntryCall,
  resolveMethod,
  resolvePage,
} from "../navigation/resolver.js";

export type IappSeverity = "error" | "warning" | "information";

export interface IappDiagnostic {
  code: string;
  severity: IappSeverity;
  message: string;
  range: SourceRange;
  filePath: string;
}

export interface LintOptions {
  disabledRules?: readonly string[];
}

interface RuleCheck {
  code: string;
  name: string;
  pattern: RegExp;
  message: string;
}

/** 八条解析期致命写法。 */
export const FATAL_RULES: readonly RuleCheck[] = [
  {
    code: "MJAVA-FINAL",
    name: "final 修饰符",
    pattern: /\bfinal\b/,
    message: "mjava 不支持 final 修饰符，整个模块会解析失败。",
  },
  {
    code: "MJAVA-LAMBDA",
    name: "lambda ->",
    pattern: /->/,
    message: "mjava 不支持 lambda（->），整个模块会解析失败。",
  },
  {
    code: "MJAVA-VARARGS",
    name: "可变参数 ...",
    pattern: /\.\.\.\s*\)|\w+\s*\.\.\./,
    message: "mjava 不支持可变参数（...），整个模块会解析失败。",
  },
  {
    code: "MJAVA-HEX",
    name: "大十六进制字面量",
    pattern: /0x[89A-Fa-f][0-9A-Fa-f]{3,}/,
    message: "十六进制字面量超出 int 范围，整个模块会解析失败。",
  },
  {
    code: "MJAVA-BSH",
    name: "new bsh.*",
    pattern: /new\s+bsh\./,
    message: "不能实例化 bsh.* 内部类，整个模块会解析失败。",
  },
  {
    code: "MJAVA-FQN-TYPE",
    name: "类型声明里的全限定名",
    pattern: /^\s*(android|androidx|com|org|java|javax)\.[\w.]+\s+\w+\s*(=|;)/,
    message: "类型声明不要写全限定名，改用 import；否则整个模块会解析失败。",
  },
  {
    code: "MJAVA-FQN-NEW",
    name: "new 里的全限定名",
    pattern: /=\s*new\s+(android|androidx|com|org)\.\w/,
    message: "new 不要写全限定名，改用 import；否则整个模块会解析失败。",
  },
  {
    code: "MJAVA-ESCAPE",
    name: "字符串非法转义",
    pattern: /(?<!\\)\\[sdwSDWbBAZ]/,
    message: "正则转义要写成 \\\\s 这类双反斜杠形式，单个 \\s 会让模块解析失败。",
  },
];

const PREFIX_CALL = /^[a-z][a-z0-9]*_[a-z0-9_]+$/;
const NOQA = /(?:#|\/\/)\s*noqa(?:\s*:\s*([\w\s,-]+))?/i;

export function lintProject(
  model: ProjectModel,
  options: LintOptions = {},
): Map<string, IappDiagnostic[]> {
  const result = new Map<string, IappDiagnostic[]>();
  const push = (diagnostic: IappDiagnostic): void => {
    const list = result.get(diagnostic.filePath) ?? [];
    list.push(diagnostic);
    result.set(diagnostic.filePath, list);
  };

  const defined = new Set<string>();
  for (const module of model.modules.values()) {
    for (const method of module.parsed.methods) {
      defined.add(method.name);
    }
  }

  const callGraph = buildCallGraph(model);
  const loadCache = new Map<string, LoadedFunctions>();
  for (const module of model.modules.values()) {
    for (const diagnostic of lintModule(model, module, defined, callGraph, loadCache)) {
      push(diagnostic);
    }
  }
  for (const page of model.pages.values()) {
    for (const diagnostic of lintPage(model, page)) {
      push(diagnostic);
    }
  }

  const disabled = new Set(options.disabledRules ?? []);
  for (const [filePath, diagnostics] of result) {
    const text = fileText(model, filePath);
    const filtered = diagnostics.filter(
      (diagnostic) =>
        !disabled.has(diagnostic.code) && !isSuppressed(diagnostic, text),
    );
    if (filtered.length > 0) {
      result.set(filePath, filtered);
    } else {
      result.delete(filePath);
    }
  }
  return result;
}

interface CallerKey {
  module: string;
  method: string;
}

interface LoadedFunctions {
  modules: Set<string>;
  dynamic: boolean;
}

function lintModule(
  model: ProjectModel,
  module: ProjectModule,
  defined: Set<string>,
  callGraph: Map<string, CallerKey[]>,
  loadCache: Map<string, LoadedFunctions>,
): IappDiagnostic[] {
  const diagnostics: IappDiagnostic[] = [];
  const text = module.parsed.text;
  const index = new LineIndex(text);
  const lines = text.split(/\r\n|\n|\r/);

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const raw = lines[lineNo];
    const trimmed = raw.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      continue;
    }
    const range = index.rangeAt(index.offsetAt({ line: lineNo, character: 0 }), index.offsetAt({ line: lineNo, character: raw.length }));
    for (const rule of FATAL_RULES) {
      if (rule.pattern.test(raw)) {
        diagnostics.push({
          code: rule.code,
          severity: "error",
          message: rule.message,
          range,
          filePath: module.filePath,
        });
      }
    }
  }

  for (const call of module.parsed.calls) {
    if (!call.qualifier && PREFIX_CALL.test(call.name) && !defined.has(call.name)) {
      diagnostics.push({
        code: "IAPP-UNDEFINED-METHOD",
        severity: "error",
        message: `工程内没有定义方法 ${call.name}，运行期会 Command not found。`,
        range: call.nameRange,
        filePath: module.filePath,
      });
    }
    if (call.qualifier === "i" && call.name === "fn") {
      const target = call.args[0]?.value;
      if (target && !model.modules.has(target)) {
        diagnostics.push({
          code: "IAPP-MISSING-MODULE",
          severity: "error",
          message: `工程内没有 ${target}.mjava。`,
          range: call.args[0].range,
          filePath: module.filePath,
        });
      }
    }
    if (call.qualifier === "i" && call.name === "uigo") {
      const target = call.args[0]?.value;
      if (target && !resolvePage(model, target)) {
        diagnostics.push({
          code: "IAPP-MISSING-PAGE",
          severity: "error",
          message: `工程内没有页面 ${target}。`,
          range: call.args[0].range,
          filePath: module.filePath,
        });
      }
    }
    if (call.qualifier === "i" && call.name === "call") {
      for (const diagnostic of lintExplicitCall(model, call, module.filePath)) {
        diagnostics.push(diagnostic);
      }
    }
    for (const diagnostic of lintArity(model, module, call)) {
      diagnostics.push(diagnostic);
    }
  }

  const moduleDynamic = module.parsed.calls.some(
    (call) => call.qualifier === "i" && call.name === "fn" && !call.args[0]?.value,
  );
  if (!moduleDynamic) {
    for (const call of module.parsed.calls) {
      if (call.qualifier || call.name === "fn" || !call.enclosingMethod) {
        continue;
      }
      const result = resolveMethod(model, module.name, call.name, call.args.length);
      const target = result.targets[0];
      if (!target || target.module.name === module.name) {
        continue;
      }
      const loaded = loadedForFunction(
        model,
        callGraph,
        loadCache,
        module.name,
        call.enclosingMethod,
        new Set(),
      );
      if (loaded.dynamic || loaded.modules.has(target.module.name)) {
        continue;
      }
      diagnostics.push({
        code: "IAPP-LOAD-ORDER",
        severity: "warning",
        message: `调用 ${target.module.name}.${target.method.name} 前，当前调用链缺少 i.fn("${target.module.name}")。`,
        range: call.nameRange,
        filePath: module.filePath,
      });
    }
  }

  for (const diagnostic of lintDuplicates(model, module)) {
    diagnostics.push(diagnostic);
  }
  return diagnostics;
}

function buildCallGraph(model: ProjectModel): Map<string, CallerKey[]> {
  const graph = new Map<string, CallerKey[]>();
  for (const module of model.modules.values()) {
    for (const call of module.parsed.calls) {
      if (call.qualifier || !call.enclosingMethod) {
        continue;
      }
      const result = resolveMethod(model, module.name, call.name, call.args.length);
      for (const target of result.targets) {
        const key = `${target.module.name}.${target.method.name}`;
        const callers = graph.get(key) ?? [];
        if (
          !callers.some(
            (caller) => caller.module === module.name && caller.method === call.enclosingMethod,
          )
        ) {
          callers.push({ module: module.name, method: call.enclosingMethod });
          graph.set(key, callers);
        }
      }
    }
  }
  return graph;
}

/**
 * 函数执行时已经加载的模块：自身模块的 `i.fn` 闭包，加上所有调用者把模块带进来的加载集。
 * 这是过近似；任一调用链上出现无法静态展开的 `i.fn` 时标记 dynamic，调用方不再报警。
 */
function loadedForFunction(
  model: ProjectModel,
  graph: Map<string, CallerKey[]>,
  cache: Map<string, LoadedFunctions>,
  moduleName: string,
  methodName: string,
  visiting: Set<string>,
): LoadedFunctions {
  const key = `${moduleName}.${methodName}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  if (visiting.has(key)) {
    return { modules: loadClosure(model, moduleName), dynamic: false };
  }
  visiting.add(key);

  const result: LoadedFunctions = {
    modules: loadClosure(model, moduleName),
    dynamic: false,
  };
  const module = model.modules.get(moduleName);
  for (const call of module?.parsed.calls ?? []) {
    if (
      call.qualifier === "i" &&
      call.name === "fn" &&
      call.enclosingMethod === methodName
    ) {
      const target = call.args[0]?.value;
      if (target) {
        result.modules.add(target);
      } else {
        result.dynamic = true;
      }
    }
  }
  for (const caller of graph.get(key) ?? []) {
    const callerLoaded = loadedForFunction(
      model,
      graph,
      cache,
      caller.module,
      caller.method,
      visiting,
    );
    for (const loaded of callerLoaded.modules) {
      result.modules.add(loaded);
    }
    if (callerLoaded.dynamic) {
      result.dynamic = true;
    }
  }

  visiting.delete(key);
  cache.set(key, result);
  return result;
}

function lintExplicitCall(
  model: ProjectModel,
  call: MjavaCall,
  filePath: string,
): IappDiagnostic[] {
  const diagnostics: IappDiagnostic[] = [];
  if (call.args[0]?.value !== "mjava") {
    return diagnostics;
  }
  const qualified = call.args[1]?.value;
  if (!qualified || !qualified.includes(".")) {
    return diagnostics;
  }
  const moduleName = qualified.slice(0, qualified.indexOf("."));
  const methodName = qualified.slice(qualified.indexOf(".") + 1);
  const module = model.modules.get(moduleName);
  const range = call.args[1].range;
  if (!module) {
    diagnostics.push({
      code: "IAPP-MISSING-MODULE",
      severity: "error",
      message: `工程内没有 ${moduleName}.mjava。`,
      range,
      filePath,
    });
    return diagnostics;
  }
  const methods = module.parsed.methods.filter((method) => method.name === methodName);
  if (methods.length === 0) {
    diagnostics.push({
      code: "IAPP-MISSING-METHOD",
      severity: "error",
      message: `${moduleName}.mjava 中没有方法 ${methodName}。`,
      range,
      filePath,
    });
    return diagnostics;
  }
  const argCount = call.args.length - 2;
  if (!methods.some((method) => method.params.length === argCount)) {
    diagnostics.push({
      code: "IAPP-ARITY",
      severity: "warning",
      message: `${moduleName}.${methodName} 声明 ${methods[0].params.length} 个参数，调用给了 ${argCount} 个。`,
      range,
      filePath,
    });
  }
  return diagnostics;
}

function lintArity(
  model: ProjectModel,
  module: ProjectModule,
  call: MjavaCall,
): IappDiagnostic[] {
  if (call.qualifier) {
    return [];
  }
  const result = resolveMethod(model, module.name, call.name, undefined);
  if (result.targets.length === 0) {
    return [];
  }
  if (result.targets.some((target) => target.method.params.length === call.args.length)) {
    return [];
  }
  const declared = result.targets[0].method.params.length;
  return [
    {
      code: "IAPP-ARITY",
      severity: "warning",
      message: `${result.targets[0].module.name}.${call.name} 声明 ${declared} 个参数，调用给了 ${call.args.length} 个。`,
      range: call.nameRange,
      filePath: module.filePath,
    },
  ];
}

function lintDuplicates(model: ProjectModel, module: ProjectModule): IappDiagnostic[] {
  const order = orderedClosure(model, module.name);
  const seen = new Map<string, ProjectModule>();
  const diagnostics: IappDiagnostic[] = [];
  const reported = new Set<string>();
  for (const name of order) {
    const current = model.modules.get(name);
    if (!current) {
      continue;
    }
    for (const method of current.parsed.methods) {
      const previous = seen.get(method.name);
      if (previous && previous.name !== current.name) {
        const key = `${current.name}:${method.name}`;
        if (!reported.has(key)) {
          reported.add(key);
          diagnostics.push({
            code: "IAPP-DUPLICATE-METHOD",
            severity: "information",
            message: `同一加载链里 ${previous.name} 与 ${current.name} 都定义了 ${method.name}，后加载者会覆盖先加载者。`,
            range: method.nameRange,
            filePath: current.filePath,
          });
        }
      }
      if (!previous) {
        seen.set(method.name, current);
      }
    }
  }
  return diagnostics;
}

function orderedClosure(model: ProjectModel, start: string): string[] {
  const order = [start];
  const seen = new Set(order);
  for (let i = 0; i < order.length; i++) {
    for (const edge of model.loadEdges) {
      if (edge.fromModule === order[i] && !seen.has(edge.toModule)) {
        seen.add(edge.toModule);
        order.push(edge.toModule);
      }
    }
  }
  return order;
}

function lintPage(model: ProjectModel, page: ProjectPage): IappDiagnostic[] {
  const diagnostics: IappDiagnostic[] = [];
  const text = page.parsed.text;
  const lines = text.split(/\r\n|\n|\r/);

  for (const event of page.parsed.events) {
    for (const call of event.calls) {
      if (call.name === "call" && call.args[1]?.value === "mjava") {
        const target = resolveEntryCall(model, call);
        const range = call.args[2]?.range ?? call.range;
        if (call.args[2]?.value?.includes(".") && target.targets.length === 0) {
          const qualified = call.args[2].value;
          const moduleName = qualified.slice(0, qualified.indexOf("."));
          const methodName = qualified.slice(qualified.indexOf(".") + 1);
          const module = model.modules.get(moduleName);
          if (!module) {
            diagnostics.push({
              code: "IAPP-MISSING-MODULE",
              severity: "error",
              message: `工程内没有 ${moduleName}.mjava。`,
              range,
              filePath: page.filePath,
            });
          } else {
            const methods = module.parsed.methods.filter(
              (method) => method.name === methodName,
            );
            if (methods.length === 0) {
              diagnostics.push({
                code: "IAPP-MISSING-METHOD",
                severity: "error",
                message: `${moduleName}.mjava 中没有方法 ${methodName}。`,
                range,
                filePath: page.filePath,
              });
            } else {
              const argCount = call.args.length - 3;
              if (!methods.some((method) => method.params.length === argCount)) {
                diagnostics.push({
                  code: "IAPP-ARITY",
                  severity: "warning",
                  message: `${moduleName}.${methodName} 声明 ${methods[0].params.length} 个参数，调用给了 ${argCount} 个。`,
                  range,
                  filePath: page.filePath,
                });
              }
            }
          }
        }
      }
    }
    for (const diagnostic of lintEventBody(page, event)) {
      diagnostics.push(diagnostic);
    }
  }

  for (const view of page.parsed.views) {
    for (const property of view.properties) {
      const line = lines[property.range.start.line] ?? "";
      const eq = line.indexOf("=");
      if (eq > 0 && (line[eq - 1] === " " || line[eq + 1] === " ")) {
        diagnostics.push({
          code: "IYU-PPT-SPACES",
          severity: "warning",
          message: "ppt 里的 key = value 两边带空格会让该行整行失效。",
          range: property.range,
          filePath: page.filePath,
        });
      }
    }
  }

  const index = new LineIndex(text);
  for (const tag of scanIyuTags(text)) {
    const doc = findIyuTagDoc(tag.name);
    const nameRange = index.rangeAt(tag.nameStart, tag.nameEnd);
    if (!doc) {
      diagnostics.push({
        code: "IYU-UNKNOWN-TAG",
        severity: "error",
        message: `未知标签 <${tag.name}>；iyu 只支持 View、ppt、event、UIEventset、eventItme。`,
        range: nameRange,
        filePath: page.filePath,
      });
      continue;
    }
    if (tag.closing) {
      continue;
    }
    for (const attribute of tag.attributes) {
      if (doc.attributes.some((item) => item.name === attribute.name)) {
        continue;
      }
      diagnostics.push({
        code: "IYU-UNKNOWN-ATTRIBUTE",
        severity: "warning",
        message: `<${tag.name}> 不支持属性 ${attribute.name}。`,
        range: index.rangeAt(attribute.nameStart, attribute.nameEnd),
        filePath: page.filePath,
      });
    }
    if (tag.name === "eventItme") {
      const type = tag.attributes.find((attribute) => attribute.name === "type");
      if (!type || !type.value) {
        diagnostics.push({
          code: "IYU-MISSING-EVENT-TYPE",
          severity: "error",
          message: "<eventItme> 缺少 type 事件名。",
          range: nameRange,
          filePath: page.filePath,
        });
      }
    }
  }

  const ids = new Map<string, SourceRange>();
  for (const view of page.parsed.views) {
    const id = view.attributes.find((attribute) => attribute.name === "id");
    if (!id) {
      continue;
    }
    if (ids.has(id.value)) {
      diagnostics.push({
        code: "IYU-DUPLICATE-ID",
        severity: "warning",
        message: `控件 id=${id.value} 重复。`,
        range: id.range,
        filePath: page.filePath,
      });
    } else {
      ids.set(id.value, id.range);
    }
  }
  return diagnostics;
}

function lintEventBody(page: ProjectPage, event: IyuEvent): IappDiagnostic[] {
  const diagnostics: IappDiagnostic[] = [];
  const bodyLines = event.bodyText.split(/\r\n|\n|\r/);
  for (let i = 0; i < bodyLines.length; i++) {
    const raw = bodyLines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    const line = event.bodyRange.start.line + i;
    const character = i === 0 ? event.bodyRange.start.character : 0;
    const range: SourceRange = {
      start: { line, character },
      end: { line, character: character + raw.length },
    };
    if (trimmed.startsWith("//")) {
      continue;
    }
    const comment = findTrailingComment(raw);
    if (comment >= 0) {
      diagnostics.push({
        code: "IYU-TRAILING-COMMENT",
        severity: "error",
        message: "事件体行尾注释会让整个载入事件中断。",
        range: {
          start: { line, character: character + comment },
          end: { line, character: character + raw.length },
        },
        filePath: page.filePath,
      });
    }
    const statement = (comment >= 0 ? raw.slice(0, comment) : raw).trim();
    if (statement && !/^(call|addv)\s*\(/.test(statement)) {
      diagnostics.push({
        code: "IYU-UNSUPPORTED-STATEMENT",
        severity: "error",
        message: "iyu 事件体只允许 call 与 addv，其它语句请下沉到 mjava。",
        range,
        filePath: page.filePath,
      });
    }
  }
  return diagnostics;
}

function findTrailingComment(line: string): number {
  let inString: string | null = null;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === "\\") {
        i++;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
    } else if (ch === "/" && line[i + 1] === "/") {
      return i;
    }
  }
  return -1;
}

function fileText(model: ProjectModel, filePath: string): string {
  for (const module of model.modules.values()) {
    if (module.filePath === filePath) {
      return module.parsed.text;
    }
  }
  for (const page of model.pages.values()) {
    if (page.filePath === filePath) {
      return page.parsed.text;
    }
  }
  return "";
}

function isSuppressed(diagnostic: IappDiagnostic, text: string): boolean {
  const lines = text.split(/\r\n|\n|\r/);
  const candidates = [diagnostic.range.start.line, diagnostic.range.start.line - 1];
  for (const lineNo of candidates) {
    const line = lines[lineNo];
    if (!line) {
      continue;
    }
    const match = NOQA.exec(line);
    if (!match) {
      continue;
    }
    if (!match[1]) {
      return true;
    }
    const rules = match[1].split(/[\s,]+/).filter(Boolean);
    if (rules.includes(diagnostic.code)) {
      return true;
    }
  }
  return false;
}
