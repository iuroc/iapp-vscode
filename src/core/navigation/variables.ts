import { ProjectModule } from "../iapp/project.js";
import { MjavaFile, MjavaLocal, MjavaMethod } from "../java/mjava-parser.js";
import { LineIndex, SourcePosition, SourceRange } from "../model/source.js";
import { compare, inRange } from "./locate.js";
import type { ReferenceLocation } from "./references.js";

export type VariableKind = "local" | "param" | "field";

export interface VariableDefinition {
  kind: VariableKind;
  name: string;
  type: string;
  nameRange: SourceRange;
  moduleName: string;
  methodName?: string;
}

export interface VariableHoverContent {
  signature: string;
  details: string[];
}

export interface IdentifierOccurrence {
  name: string;
  range: SourceRange;
  kind: "code" | "member" | "call";
}

const KEYWORDS = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
  "class", "const", "continue", "default", "do", "double", "else", "enum",
  "extends", "final", "finally", "float", "for", "goto", "if", "implements",
  "import", "instanceof", "int", "interface", "long", "native", "new",
  "package", "private", "protected", "public", "return", "short", "static",
  "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "try", "void", "volatile", "while", "true", "false", "null",
]);

/** 光标处的变量声明；局部变量 > 形参 > 模块字段。 */
export function variableAt(
  parsed: MjavaFile,
  moduleName: string,
  position: SourcePosition,
): VariableDefinition | undefined {
  const index = new LineIndex(parsed.text);
  const occurrence = scanIdentifiers(parsed.text, 0, parsed.text.length, index).find(
    (item) => inRange(item.range, position),
  );
  if (!occurrence) {
    return undefined;
  }
  return resolveVariable(parsed, moduleName, occurrence, parsed.text, index);
}

export function findVariableReferences(
  module: ProjectModule,
  definition: VariableDefinition,
  includeDeclaration: boolean,
  isCancelled?: () => boolean,
): ReferenceLocation[] {
  const parsed = module.parsed;
  const index = new LineIndex(parsed.text);
  const method =
    definition.kind === "field"
      ? undefined
      : parsed.methods.find((item) => item.name === definition.methodName);
  const from = method ? index.offsetAt(method.range.start) : 0;
  const to = method ? index.offsetAt(method.range.end) : parsed.text.length;
  const references: ReferenceLocation[] = [];

  for (const occurrence of scanIdentifiers(parsed.text, from, to, index)) {
    if (isCancelled?.()) {
      break;
    }
    if (occurrence.name !== definition.name) {
      continue;
    }
    if (sameRange(occurrence.range, definition.nameRange)) {
      if (includeDeclaration) {
        references.push({ filePath: module.filePath, range: occurrence.range });
      }
      continue;
    }
    const resolved = resolveVariable(parsed, module.name, occurrence, parsed.text, index);
    if (resolved && sameVariable(resolved, definition)) {
      references.push({ filePath: module.filePath, range: occurrence.range });
    }
  }
  return references;
}

export function variableHover(definition: VariableDefinition): VariableHoverContent {
  const label =
    definition.kind === "local"
      ? "局部变量"
      : definition.kind === "param"
        ? "形参"
        : "模块字段";
  const location = definition.methodName
    ? `${definition.moduleName}.${definition.methodName}`
    : definition.moduleName;
  return {
    signature: `${definition.type} ${definition.name}`,
    details: [label, `声明于 \`${location}\``],
  };
}

function resolveVariable(
  parsed: MjavaFile,
  moduleName: string,
  occurrence: IdentifierOccurrence,
  text: string,
  index: LineIndex,
): VariableDefinition | undefined {
  if (occurrence.kind !== "code" && !isThisMember(text, occurrence, index)) {
    return undefined;
  }
  const memberOfThis = occurrence.kind === "member";

  const method = parsed.methods.find((item) => inRange(item.range, occurrence.range.start));
  if (method && !memberOfThis) {
    const local = visibleLocal(method, occurrence);
    if (local) {
      return {
        kind: "local",
        name: local.name,
        type: local.type,
        nameRange: local.nameRange,
        moduleName,
        methodName: method.name,
      };
    }
    const param = method.params.find((item) => item.name === occurrence.name);
    if (param) {
      return {
        kind: "param",
        name: param.name,
        type: param.type,
        nameRange: param.nameRange,
        moduleName,
        methodName: method.name,
      };
    }
  }

  const field = parsed.fields.find((item) => item.name === occurrence.name);
  if (field) {
    return {
      kind: "field",
      name: field.name,
      type: field.type,
      nameRange: field.nameRange,
      moduleName,
      methodName: method?.name,
    };
  }
  return undefined;
}

function visibleLocal(method: MjavaMethod, occurrence: IdentifierOccurrence): MjavaLocal | undefined {
  return method.locals
    .filter(
      (local) =>
        local.name === occurrence.name &&
        compare(local.nameRange.start, occurrence.range.start) <= 0,
    )
    .sort((a, b) => compare(b.nameRange.start, a.nameRange.start))[0];
}

function isThisMember(text: string, occurrence: IdentifierOccurrence, index: LineIndex): boolean {
  if (occurrence.kind !== "member") {
    return false;
  }
  const offset = index.offsetAt(occurrence.range.start);
  return /\bthis\s*\.\s*$/.test(text.slice(Math.max(0, offset - 12), offset));
}

function sameVariable(a: VariableDefinition, b: VariableDefinition): boolean {
  return (
    a.kind === b.kind &&
    a.name === b.name &&
    sameRange(a.nameRange, b.nameRange)
  );
}

function sameRange(a: SourceRange, b: SourceRange): boolean {
  return compare(a.start, b.start) === 0 && compare(a.end, b.end) === 0;
}

export function scanIdentifiers(
  text: string,
  from: number,
  to: number,
  index: LineIndex,
): IdentifierOccurrence[] {
  const occurrences: IdentifierOccurrence[] = [];
  let i = from;
  while (i < to) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      const newline = text.indexOf("\n", i + 2);
      i = newline < 0 ? to : Math.min(newline + 1, to);
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? to : Math.min(end + 2, to);
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipQuoted(text, i, to);
      continue;
    }
    if (!/[A-Za-z_$]/.test(ch)) {
      i++;
      continue;
    }
    const start = i;
    while (i < to && /[\w$]/.test(text[i])) {
      i++;
    }
    const name = text.slice(start, i);
    if (KEYWORDS.has(name)) {
      continue;
    }
    let previous = start - 1;
    while (previous >= from && /\s/.test(text[previous])) {
      previous--;
    }
    if (text[previous] === "@") {
      continue;
    }
    const member = text[previous] === ".";
    let next = i;
    while (next < to && /\s/.test(text[next])) {
      next++;
    }
    const kind: IdentifierOccurrence["kind"] = member
      ? "member"
      : text[next] === "("
        ? "call"
        : "code";
    occurrences.push({ name, range: index.rangeAt(start, i), kind });
  }
  return occurrences;
}

function skipQuoted(text: string, start: number, end: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < end) {
    if (text[i] === "\\") {
      i += 2;
    } else if (text[i] === quote) {
      return i + 1;
    } else {
      i++;
    }
  }
  return end;
}
