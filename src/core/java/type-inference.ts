import { MjavaCall, MjavaFile, MjavaMethod } from "./mjava-parser.js";
import { rawTypeName } from "./java-class-parser.js";
import type { JavaClassContext, JavaSourceRepository } from "./java-repository.js";
import type { JavaTypeResolver } from "./java-resolver.js";
import { SourcePosition } from "../model/source.js";
import { compare } from "../navigation/locate.js";

export interface InferenceContext {
  parsed: MjavaFile;
  method?: MjavaMethod;
  /** 调用点位置，用于排除尚未声明的局部变量。 */
  position?: SourcePosition;
}

const PRIMITIVES = new Set([
  "void",
  "boolean",
  "byte",
  "char",
  "short",
  "int",
  "long",
  "float",
  "double",
]);

const SPECIAL_TYPES: ReadonlyMap<string, string> = new Map([
  ["activity", "android.app.Activity"],
  ["i", "com.iapp.app.Aid_javaCode"],
]);

/** 轻量“接收者 -> 类型”推断；推断不出时返回 undefined，不猜。 */
export class MjavaTypeInference {
  constructor(
    private readonly repository: JavaSourceRepository,
    private readonly resolver: JavaTypeResolver,
  ) {}

  async inferCallReceiver(call: MjavaCall, context: InferenceContext): Promise<string | undefined> {
    if (!call.qualifier) {
      return undefined;
    }
    return this.inferExpression(call.qualifier, {
      ...context,
      position: call.nameRange.start,
    });
  }

  async inferExpression(expression: string, context: InferenceContext): Promise<string | undefined> {
    const expr = expression.trim();
    if (!expr) {
      return undefined;
    }

    const inner = stripOuterParens(expr);
    if (inner !== expr) {
      return this.inferExpression(inner, context);
    }

    const cast = /^\(\s*([A-Za-z_$][\w$.]*(?:\s*<[^()]*>)?(?:\[\s*\])*)\s*\)\s*([\s\S]+)$/.exec(
      expr,
    );
    if (cast) {
      const castType = await this.resolveDeclaredType(cast[1], context.parsed);
      if (castType) {
        return castType;
      }
    }

    const created = /^new\s+([A-Za-z_$][\w$.]*(?:\s*<[^()]*>)?(?:\[\s*\])*)/.exec(expr);
    if (created) {
      return this.resolveDeclaredType(created[1], context.parsed);
    }

    if (/^".*"$/.test(expr)) {
      return this.resolveTypeName("String", context.parsed);
    }

    if (hasTopLevelOperator(expr, "+") && expr.includes('"')) {
      return this.resolveTypeName("String", context.parsed);
    }

    const array = splitArrayAccess(expr);
    if (array) {
      const base = await this.inferExpression(array.base, context);
      return base?.endsWith("[]") ? base.slice(0, -2) : undefined;
    }

    const call = splitCall(expr);
    if (call) {
      return this.inferCallResult(call, context);
    }

    const field = splitFieldAccess(expr);
    if (field) {
      const receiver = await this.inferExpression(field.receiver, context);
      if (!receiver) {
        return undefined;
      }
      const match = await this.resolver.findField(stripArray(receiver), field.name);
      return match ? this.resolveJavaType(match.field.type, match.context) : undefined;
    }

    return this.typeOfIdentifier(expr, context);
  }

  async resolveTypeName(name: string, parsed: MjavaFile): Promise<string | undefined> {
    const cleaned = rawTypeName(name);
    if (!cleaned || PRIMITIVES.has(cleaned)) {
      return undefined;
    }
    if (cleaned.includes(".") && this.repository.resolveClassLocation(cleaned)) {
      return cleaned;
    }
    const segments = cleaned.split(".");
    const simple = segments[0];
    const rest = segments.slice(1).join(".");
    for (const imported of parsed.imports) {
      if (imported.name === cleaned) {
        return imported.name;
      }
      if (!imported.isStatic && imported.name.endsWith(`.${simple}`)) {
        return rest ? `${imported.name}.${rest}` : imported.name;
      }
    }
    const javaLang = `java.lang.${cleaned}`;
    if (this.repository.resolveClassLocation(javaLang)) {
      return javaLang;
    }
    return undefined;
  }

  private async resolveDeclaredType(
    typeText: string,
    parsed: MjavaFile,
  ): Promise<string | undefined> {
    const arrayDepth = (typeText.match(/\[\s*\]/g) ?? []).length;
    const base = rawTypeName(typeText);
    if (!base) {
      return undefined;
    }
    const resolved = await this.resolveTypeName(base, parsed);
    if (!resolved) {
      return undefined;
    }
    return `${resolved}${"[]".repeat(arrayDepth)}`;
  }

  private async typeOfIdentifier(
    name: string,
    context: InferenceContext,
  ): Promise<string | undefined> {
    const { parsed, method, position } = context;
    if (method) {
      const visible = method.locals
        .filter(
          (local) =>
            local.name === name &&
            (!position || compare(local.nameRange.start, position) <= 0),
        )
        .sort((a, b) => compare(b.nameRange.start, a.nameRange.start))[0];
      if (visible) {
        return this.resolveDeclaredType(visible.type, parsed);
      }
      const param = method.params.find((item) => item.name === name);
      if (param) {
        return this.resolveDeclaredType(param.type, parsed);
      }
    }
    const special = SPECIAL_TYPES.get(name);
    if (special) {
      return special;
    }
    const field = parsed.fields.find((item) => item.name === name);
    if (field) {
      return this.resolveDeclaredType(field.type, parsed);
    }
    return this.resolveTypeName(name, parsed);
  }

  private async inferCallResult(
    call: { receiver?: string; name: string; args: string },
    context: InferenceContext,
  ): Promise<string | undefined> {
    const argCount = splitArguments(call.args).length;
    if (!call.receiver) {
      const method = context.parsed.methods.find((item) => item.name === call.name);
      return method ? this.resolveDeclaredType(method.returnType, context.parsed) : undefined;
    }
    let receiverType = await this.inferExpression(call.receiver, context);
    if (!receiverType) {
      receiverType = await this.resolveTypeName(call.receiver, context.parsed);
    }
    if (!receiverType) {
      return undefined;
    }
    const matches = await this.resolver.findMethods(stripArray(receiverType), call.name, argCount);
    const returns = new Set<string>();
    for (const match of matches) {
      const type = await this.resolveJavaType(match.method.returnType, match.context);
      if (type) {
        returns.add(type);
      }
    }
    return returns.size === 1 ? [...returns][0] : undefined;
  }

  private async resolveJavaType(
    typeText: string,
    context: JavaClassContext,
  ): Promise<string | undefined> {
    const arrayDepth = (typeText.match(/\[\s*\]/g) ?? []).length;
    const base = rawTypeName(typeText);
    if (!base) {
      return undefined;
    }
    const resolved = await this.resolver.resolveTypeName(base, context);
    return resolved ? `${resolved}${"[]".repeat(arrayDepth)}` : undefined;
  }
}

function stripOuterParens(expression: string): string {
  if (!expression.startsWith("(")) {
    return expression;
  }
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
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
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return i === expression.length - 1 ? expression.slice(1, -1).trim() : expression;
      }
    }
  }
  return expression;
}

function hasTopLevelOperator(expression: string, operator: string): boolean {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
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
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
    } else if (depth === 0 && ch === operator) {
      return true;
    }
  }
  return false;
}

function splitArrayAccess(expression: string): { base: string } | undefined {
  if (!expression.endsWith("]")) {
    return undefined;
  }
  let depth = 0;
  for (let i = expression.length - 1; i >= 0; i--) {
    const ch = expression[i];
    if (ch === "]") {
      depth++;
    } else if (ch === "[") {
      depth--;
      if (depth === 0) {
        return i > 0 ? { base: expression.slice(0, i).trim() } : undefined;
      }
    }
  }
  return undefined;
}

function splitCall(
  expression: string,
): { receiver?: string; name: string; args: string } | undefined {
  if (!expression.endsWith(")")) {
    return undefined;
  }
  let depth = 0;
  let inString: string | null = null;
  let open = -1;
  for (let i = expression.length - 1; i >= 0; i--) {
    const ch = expression[i];
    if (inString) {
      if (ch === inString && expression[i - 1] !== "\\") {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
    } else if (ch === ")") {
      depth++;
    } else if (ch === "(") {
      depth--;
      if (depth === 0) {
        open = i;
        break;
      }
    }
  }
  if (open < 0) {
    return undefined;
  }
  const before = expression.slice(0, open).trimEnd();
  const nameMatch = /([A-Za-z_$][\w$]*)$/.exec(before);
  if (!nameMatch) {
    return undefined;
  }
  const name = nameMatch[1];
  const rest = before.slice(0, nameMatch.index).trimEnd();
  return {
    receiver: rest.endsWith(".") ? rest.slice(0, -1).trim() : undefined,
    name,
    args: expression.slice(open + 1, -1),
  };
}

function splitFieldAccess(expression: string): { receiver: string; name: string } | undefined {
  const match = /^(.+)\.([A-Za-z_$][\w$]*)$/.exec(expression);
  return match ? { receiver: match[1].trim(), name: match[2] } : undefined;
}

export function splitArguments(text: string): string[] {
  if (!text.trim()) {
    return [];
  }
  const args: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
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
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
    } else if (ch === "," && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(text.slice(start).trim());
  return args.filter(Boolean);
}

function stripArray(type: string): string {
  return type.replace(/\[\]$/, "");
}
