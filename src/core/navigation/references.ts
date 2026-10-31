import { ProjectModel } from "../iapp/project.js";
import { MjavaCall, MjavaMethod } from "../java/mjava-parser.js";
import { JavaTypeResolver } from "../java/java-resolver.js";
import { MjavaTypeInference } from "../java/type-inference.js";
import { SourceRange } from "../model/source.js";
import {
  resolveEntryCall,
  resolveMethod,
  resolveQualifiedMethod,
} from "./resolver.js";

export interface ReferenceLocation {
  filePath: string;
  range: SourceRange;
}

export interface ExplicitCallTarget {
  qualified: string;
  argCount: number;
}

export interface JavaMemberTarget {
  fqcn: string;
  name: string;
  paramCount: number;
}

export function methodKey(moduleName: string, method: MjavaMethod): string {
  const { line, character } = method.nameRange.start;
  return `${moduleName}#${method.name}#${line}:${character}`;
}

/** mjava 的 `i.call("mjava", "mod.method", ...)`；语言参数在 args[0]。 */
export function explicitCallTarget(
  args: Array<{ value?: string }>,
): ExplicitCallTarget | undefined {
  if (args[0]?.value !== "mjava") {
    return undefined;
  }
  const first = args[1]?.value;
  if (!first) {
    return undefined;
  }
  if (first.includes(".")) {
    return { qualified: first, argCount: Math.max(0, args.length - 2) };
  }
  const second = args[2]?.value;
  if (!second || second.includes(".")) {
    return undefined;
  }
  return { qualified: `${first}.${second}`, argCount: Math.max(0, args.length - 3) };
}

/** 查找某个 iApp 方法在工程内的引用：mjava 裸调用、i.call、iyu 入口。 */
export function findMethodReferences(
  model: ProjectModel,
  moduleName: string,
  method: MjavaMethod,
  includeDeclaration: boolean,
  isCancelled?: () => boolean,
): ReferenceLocation[] {
  const key = methodKey(moduleName, method);
  const results: ReferenceLocation[] = [];
  if (includeDeclaration) {
    const module = model.modules.get(moduleName);
    if (module) {
      results.push({ filePath: module.filePath, range: method.nameRange });
    }
  }

  for (const module of model.modules.values()) {
    if (isCancelled?.()) {
      break;
    }
    for (const call of module.parsed.calls) {
      if (matchesCall(model, module.name, call, key)) {
        results.push({ filePath: module.filePath, range: referenceRange(call) });
      }
    }
  }

  for (const page of model.pages.values()) {
    if (isCancelled?.()) {
      break;
    }
    for (const event of page.parsed.events) {
      for (const call of event.calls) {
        const target = resolveEntryCall(model, call).targets[0];
        if (target && methodKey(target.module.name, target.method) === key) {
          results.push({
            filePath: page.filePath,
            range: call.args[2]?.range ?? call.range,
          });
        }
      }
    }
  }

  return dedupe(results);
}

function matchesCall(
  model: ProjectModel,
  moduleName: string,
  call: MjavaCall,
  key: string,
): boolean {
  if (call.qualifier === "i") {
    if (call.name !== "call") {
      return false;
    }
    const target = explicitCallTarget(call.args);
    if (!target) {
      return false;
    }
    return resolveQualifiedMethod(model, target.qualified, target.argCount).targets.some(
      (item) => methodKey(item.module.name, item.method) === key,
    );
  }
  if (call.qualifier) {
    return false;
  }
  return resolveMethod(model, moduleName, call.name, call.args.length).targets.some(
    (item) => methodKey(item.module.name, item.method) === key,
  );
}

function referenceRange(call: MjavaCall): SourceRange {
  if (call.qualifier === "i" && call.name === "call") {
    return call.args[1]?.range ?? call.range;
  }
  return call.nameRange;
}

/**
 * 查找 Java 成员在工程 mjava 里的调用点。
 * 只认接收者类型可推断、且声明落在同一类同一方法上的调用。
 */
export async function findJavaMemberReferences(
  model: ProjectModel,
  resolver: JavaTypeResolver,
  inference: MjavaTypeInference,
  target: JavaMemberTarget,
  isCancelled?: () => boolean,
): Promise<ReferenceLocation[]> {
  const results: ReferenceLocation[] = [];
  for (const module of model.modules.values()) {
    if (isCancelled?.()) {
      break;
    }
    const parsed = module.parsed;
    for (const call of parsed.calls) {
      if (call.name !== target.name || !call.qualifier || call.qualifier === "i") {
        continue;
      }
      const method = parsed.methods.find((item) => item.name === call.enclosingMethod);
      const receiverType = await inference.inferCallReceiver(call, { parsed, method });
      if (!receiverType) {
        continue;
      }
      const matches = await resolver.findMethods(
        receiverType.replace(/\[\]$/, ""),
        call.name,
        call.args.length,
      );
      if (
        matches.some(
          (match) =>
            match.context.class.fqcn === target.fqcn &&
            match.method.name === target.name &&
            match.method.params.length === target.paramCount,
        )
      ) {
        results.push({ filePath: module.filePath, range: call.nameRange });
      }
    }
  }
  return dedupe(results);
}

function dedupe(items: ReferenceLocation[]): ReferenceLocation[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.filePath}:${item.range.start.line}:${item.range.start.character}:${item.range.end.character}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
