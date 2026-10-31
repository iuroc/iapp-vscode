import { ProjectModel, ProjectModule, ProjectPage } from "../iapp/project.js";
import { MjavaMethod } from "../java/mjava-parser.js";
import { IyuCall } from "../iyu/iyu-parser.js";

export type ResolutionSource = "current" | "loaded" | "global" | "explicit" | "entry" | "none";

export interface MethodTarget {
  module: ProjectModule;
  method: MjavaMethod;
}

export interface ResolutionResult {
  source: ResolutionSource;
  targets: MethodTarget[];
}

const EMPTY: ResolutionResult = { source: "none", targets: [] };

/** 当前模块通过 `i.fn` 可达的模块集合（含自身），按加载边传递闭包计算。 */
export function loadClosure(model: ProjectModel, moduleName: string): Set<string> {
  const closure = new Set<string>([moduleName]);
  const queue = [moduleName];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of model.loadEdges) {
      if (edge.fromModule === current && !closure.has(edge.toModule)) {
        closure.add(edge.toModule);
        queue.push(edge.toModule);
      }
    }
  }
  return closure;
}

export function resolveModule(model: ProjectModel, name: string): ProjectModule | undefined {
  return model.modules.get(normalizeModuleName(name));
}

export function resolvePage(model: ProjectModel, reference: string): ProjectPage | undefined {
  const base = reference.replace(/\\/g, "/").split("/").pop() ?? reference;
  return model.pages.get(base.replace(/\.iyu$/i, ""));
}

/** 显式限定名 `mod.method`，用于 `i.call(...)` 与 iyu 入口。 */
export function resolveQualifiedMethod(
  model: ProjectModel,
  qualified: string,
  argCount?: number,
  source: ResolutionSource = "explicit",
): ResolutionResult {
  const dot = qualified.indexOf(".");
  if (dot <= 0 || dot === qualified.length - 1) {
    return EMPTY;
  }
  const module = model.modules.get(qualified.slice(0, dot));
  if (!module) {
    return EMPTY;
  }
  const methods = selectByArity(methodsNamed(module, qualified.slice(dot + 1)), argCount);
  return methods.length > 0 ? { source, targets: methods.map((method) => ({ module, method })) } : EMPTY;
}

/**
 * 裸调用：本模块 -> `i.fn` 加载集 -> 全局唯一/候选。
 * 先按实参个数筛选；全工程都没有个数匹配时，退回第一层同名候选，避免“跳不过去”。
 */
export function resolveMethod(
  model: ProjectModel,
  moduleName: string,
  methodName: string,
  argCount?: number,
): ResolutionResult {
  const current = model.modules.get(moduleName);
  if (!current) {
    return EMPTY;
  }

  const tiers: Array<{ source: ResolutionSource; modules: ProjectModule[] }> = [];
  tiers.push({ source: "current", modules: [current] });
  const loaded = loadClosure(model, moduleName);
  loaded.delete(moduleName);
  tiers.push({
    source: "loaded",
    modules: [...loaded]
      .map((name) => model.modules.get(name))
      .filter((module): module is ProjectModule => Boolean(module)),
  });
  tiers.push({
    source: "global",
    modules: [...model.modules.values()].filter(
      (module) => module.name !== moduleName && !loaded.has(module.name),
    ),
  });

  for (const tier of tiers) {
    const exact = dedupe(
      tier.modules.flatMap((module) =>
        selectByArity(methodsNamed(module, methodName), argCount).map((method) => ({
          module,
          method,
        })),
      ),
    );
    if (exact.length > 0) {
      return { source: tier.source, targets: exact };
    }
  }

  for (const tier of tiers) {
    const fallback = dedupe(
      tier.modules.flatMap((module) =>
        methodsNamed(module, methodName).map((method) => ({ module, method })),
      ),
    );
    if (fallback.length > 0) {
      return { source: tier.source, targets: fallback };
    }
  }
  return EMPTY;
}

/** iyu 事件里的 `call(null, "mjava", "mod.method", ...)`。 */
export function resolveEntryCall(
  model: ProjectModel,
  call: IyuCall,
  source: ResolutionSource = "entry",
): ResolutionResult {
  if (call.name !== "call" || call.args.length < 3 || call.args[1].value !== "mjava") {
    return EMPTY;
  }
  const qualified = call.args[2].value;
  if (!qualified) {
    return EMPTY;
  }
  return resolveQualifiedMethod(model, qualified, call.args.length - 3, source);
}

export function methodsNamed(module: ProjectModule, name: string): MjavaMethod[] {
  return module.parsed.methods.filter((method) => method.name === name);
}

export function normalizeModuleName(name: string): string {
  return name.trim().replace(/^["']|["']$/g, "").replace(/\.mjava$/i, "");
}

function selectByArity(methods: MjavaMethod[], argCount?: number): MjavaMethod[] {
  if (argCount === undefined) {
    return methods;
  }
  return methods.filter((method) => method.params.length === argCount);
}

function dedupe(targets: MethodTarget[]): MethodTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.module.name}:${target.method.name}:${target.method.nameRange.start.line}:${target.method.nameRange.start.character}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export interface HoverContent {
  signature: string;
  details: string[];
  language?: string;
  javadoc?: string;
}

export function methodHover(
  moduleName: string,
  method: MjavaMethod,
  argCount?: number,
): HoverContent {
  const params = method.params.map((param) => `${param.type} ${param.name}`).join(", ");
  const signature = `${method.returnType} ${moduleName}.${method.name}(${params})`;
  const details = [`模块 \`${moduleName}\``];
  if (method.visibility) {
    details.push(`可见性 \`${method.visibility}\``);
  }
  if (argCount !== undefined) {
    details.push(`实参 ${argCount} 个`);
  }
  return { signature, details, javadoc: method.documentation };
}

export function moduleHover(module: ProjectModule): HoverContent {
  return {
    signature: `模块 ${module.name}`,
    details: [`${module.parsed.methods.length} 个方法`, module.filePath],
    language: "text",
    javadoc: module.parsed.documentation,
  };
}

export function pageHover(page: ProjectPage): HoverContent {
  return {
    signature: `页面 ${page.name}`,
    details: [`${page.parsed.events.length} 个事件入口`, page.filePath],
    language: "text",
  };
}

export function entryHover(
  model: ProjectModel,
  eventType: string,
  call: IyuCall,
): HoverContent | undefined {
  const resolved = resolveEntryCall(model, call);
  const target = resolved.targets[0];
  if (!target) {
    return undefined;
  }
  const hover = methodHover(
    target.module.name,
    target.method,
    call.args.length - 3,
  );
  hover.details.unshift(`事件 \`${eventType}\``);
  return hover;
}

