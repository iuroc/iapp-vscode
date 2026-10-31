import { rawTypeName } from "./java-class-parser.js";
import type { JavaFieldInfo, JavaMethodInfo } from "./java-class-parser.js";
import type { JavaClassContext, JavaSourceRepository } from "./java-repository.js";

export interface JavaMemberMatch {
  context: JavaClassContext;
  method: JavaMethodInfo;
}

export interface JavaFieldMatch {
  context: JavaClassContext;
  field: JavaFieldInfo;
}

export interface JavaMemberList {
  methods: JavaMemberMatch[];
  fields: JavaFieldMatch[];
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

export class JavaTypeResolver {
  constructor(private readonly repository: JavaSourceRepository) {}

  async resolveTypeName(name: string, context: JavaClassContext): Promise<string | undefined> {
    const cleaned = rawTypeName(name).replace(/\[\s*\]/g, "").trim();
    if (!cleaned || PRIMITIVES.has(cleaned)) {
      return undefined;
    }
    if (cleaned.includes(".") && this.repository.resolveClassLocation(cleaned)) {
      return cleaned;
    }

    const segments = cleaned.split(".");
    const simple = segments[0];
    const rest = segments.slice(1).join(".");
    for (const imported of context.file.imports) {
      if (imported.isWildcard) {
        const candidate = `${imported.name}.${cleaned}`;
        if (this.repository.resolveClassLocation(candidate)) {
          return candidate;
        }
      } else if (imported.name === cleaned || imported.name.endsWith(`.${simple}`)) {
        return rest ? `${imported.name}.${rest}` : imported.name;
      }
    }

    const candidates = [
      context.file.packageName ? `${context.file.packageName}.${cleaned}` : "",
      ...outerPrefixes(context.class.fqcn).map((prefix) => `${prefix}.${cleaned}`),
      `java.lang.${cleaned}`,
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (this.repository.resolveClassLocation(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  findMethods(
    fqcn: string,
    name: string,
    argCount?: number,
  ): Promise<JavaMemberMatch[]> {
    return this.findMethodsInClass(fqcn, name, argCount, new Set());
  }

  /** 类及其父类/接口的完整成员表，用于补全；子类同签名成员覆盖父类。 */
  async listMembers(fqcn: string): Promise<JavaMemberList> {
    const methods = new Map<string, JavaMemberMatch>();
    const fields = new Map<string, JavaFieldMatch>();
    await this.collectMembers(fqcn, methods, fields, new Set());
    return { methods: [...methods.values()], fields: [...fields.values()] };
  }

  async findField(fqcn: string, name: string): Promise<JavaFieldMatch | undefined> {
    const context = await this.repository.getClassContext(fqcn);
    if (!context) {
      return undefined;
    }
    return this.findFieldInContext(context, name, new Set());
  }

  private async findMethodsInClass(
    fqcn: string,
    name: string,
    argCount: number | undefined,
    visited: Set<string>,
  ): Promise<JavaMemberMatch[]> {
    if (visited.has(fqcn)) {
      return [];
    }
    visited.add(fqcn);
    const context = await this.repository.getClassContext(fqcn);
    if (!context) {
      return [];
    }
    const own = context.class.methods.filter(
      (method) =>
        !method.isConstructor &&
        method.name === name &&
        (argCount === undefined || method.params.length === argCount),
    );
    if (own.length > 0) {
      return own.map((method) => ({ context, method }));
    }
    for (const parent of [context.class.superClass, ...context.class.interfaces]) {
      if (!parent) {
        continue;
      }
      const parentFqcn = await this.resolveTypeName(parent, context);
      if (!parentFqcn) {
        continue;
      }
      const found = await this.findMethodsInClass(parentFqcn, name, argCount, visited);
      if (found.length > 0) {
        return found;
      }
    }
    return [];
  }

  private async collectMembers(
    fqcn: string,
    methods: Map<string, JavaMemberMatch>,
    fields: Map<string, JavaFieldMatch>,
    visited: Set<string>,
  ): Promise<void> {
    if (visited.has(fqcn)) {
      return;
    }
    visited.add(fqcn);
    const context = await this.repository.getClassContext(fqcn);
    if (!context) {
      return;
    }
    for (const method of context.class.methods) {
      if (method.isConstructor) {
        continue;
      }
      const key = `${method.name}(${method.params.map((param) => param.type).join(",")})`;
      if (!methods.has(key)) {
        methods.set(key, { context, method });
      }
    }
    for (const field of context.class.fields) {
      if (!fields.has(field.name)) {
        fields.set(field.name, { context, field });
      }
    }
    for (const parent of [context.class.superClass, ...context.class.interfaces]) {
      if (!parent) {
        continue;
      }
      const parentFqcn = await this.resolveTypeName(parent, context);
      if (parentFqcn) {
        await this.collectMembers(parentFqcn, methods, fields, visited);
      }
    }
  }

  private async findFieldInContext(
    context: JavaClassContext,
    name: string,
    visited: Set<string>,
  ): Promise<JavaFieldMatch | undefined> {
    if (visited.has(context.class.fqcn)) {
      return undefined;
    }
    visited.add(context.class.fqcn);
    const own = context.class.fields.find((field) => field.name === name);
    if (own) {
      return { context, field: own };
    }
    for (const parent of [context.class.superClass, ...context.class.interfaces]) {
      if (!parent) {
        continue;
      }
      const parentFqcn = await this.resolveTypeName(parent, context);
      if (!parentFqcn) {
        continue;
      }
      const parentContext = await this.repository.getClassContext(parentFqcn);
      if (!parentContext) {
        continue;
      }
      const found = await this.findFieldInContext(parentContext, name, visited);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
}

function outerPrefixes(fqcn: string): string[] {
  const parts = fqcn.split(".");
  const prefixes: string[] = [];
  for (let i = parts.length; i > 0; i--) {
    prefixes.push(parts.slice(0, i).join("."));
  }
  return prefixes;
}
