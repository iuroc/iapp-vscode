import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/java";
import { docCommentBefore } from "../model/doc-comments.js";
import { fileComment } from "../model/file-comment.js";
import { LineIndex, SourceRange } from "../model/source.js";
import { MjavaImport, wrapMjavaSource } from "./mjava-source.js";

export interface MjavaParameter {
  name: string;
  type: string;
  nameRange: SourceRange;
}

export interface MjavaLocal {
  name: string;
  type: string;
  nameRange: SourceRange;
  range: SourceRange;
  initializer?: string;
}

export interface MjavaMethod {
  name: string;
  nameRange: SourceRange;
  range: SourceRange;
  bodyRange?: SourceRange;
  returnType: string;
  visibility: "public" | "private" | "protected" | "";
  params: MjavaParameter[];
  locals: MjavaLocal[];
  /** 声明正上方的 `/** *\/` 或连续 `//` 注释。 */
  documentation?: string;
}

export interface MjavaField {
  name: string;
  nameRange: SourceRange;
  range: SourceRange;
  type: string;
  visibility: "public" | "private" | "protected" | "";
}

export interface MjavaArgument {
  raw: string;
  /** 字符串字面量的值；非字符串参数为 undefined。 */
  value?: string;
  range: SourceRange;
}

export interface MjavaCall {
  name: string;
  /** 点号前的接收者文本，例如 `i`、`page`、`a.b`；裸调用为 undefined。 */
  qualifier?: string;
  nameRange: SourceRange;
  range: SourceRange;
  args: MjavaArgument[];
  /** 所在模块顶层方法名；模块级字段初始化里的调用为空。 */
  enclosingMethod?: string;
}

export interface MjavaFile {
  module: string;
  text: string;
  imports: MjavaImport[];
  methods: MjavaMethod[];
  fields: MjavaField[];
  calls: MjavaCall[];
  /** 文件开头第一个连续注释块。 */
  documentation?: string;
  /** 含匿名类/回调里的方法声明，用于统计；模块可调用方法只看 {@link methods}。 */
  declaredMethodCount: number;
  hasSyntaxErrors: boolean;
}

const WRAPPER_CLASS = "__IAppWrap";
const VISIBILITY = /\b(public|private|protected)\b/;

export function parseMjava(module: string, source: string): MjavaFile {
  const wrapped = wrapMjavaSource(source);
  const tree = parser.parse(wrapped.text);
  const index = new LineIndex(source);

  const toOriginal = (offset: number): number => Math.max(0, offset - wrapped.headerLength);
  const rangeOf = (node: SyntaxNode): SourceRange =>
    index.rangeAt(toOriginal(node.from), toOriginal(node.to));
  const textOf = (node: SyntaxNode): string =>
    source.slice(toOriginal(node.from), toOriginal(node.to));

  const wrapper = findWrapper(tree.topNode, (node) => wrapped.text.slice(node.from, node.to));
  const methods: MjavaMethod[] = [];
  const fields: MjavaField[] = [];
  const calls: MjavaCall[] = [];

  const classBody = wrapper?.getChild("ClassBody");
  if (classBody) {
    for (let child = classBody.firstChild; child; child = child.nextSibling) {
      if (child.name === "MethodDeclaration") {
        const method = readMethod(child, source, toOriginal, textOf, rangeOf);
        if (method) {
          methods.push(method);
          calls.push(
            ...readCalls(
              child,
              method.name,
              (from, to) => source.slice(toOriginal(from), toOriginal(to)),
              rangeOf,
            ),
          );
        }
      } else if (child.name === "FieldDeclaration") {
        fields.push(...readFields(child, textOf, rangeOf));
      }
    }
  }

  return {
    module,
    text: source,
    imports: wrapped.imports.map((item) => ({
      ...item,
      range: index.rangeAt(item.from, item.to),
    })),
    methods,
    fields,
    calls,
    documentation: fileComment(source),
    declaredMethodCount: classBody ? countMethodNodes(classBody) : 0,
    hasSyntaxErrors: hasErrorNode(tree.topNode),
  };
}

/** 只认包裹用的 class；匿名类里的同名方法不是模块入口。 */
function findWrapper(
  program: SyntaxNode,
  textOf: (node: SyntaxNode) => string,
): SyntaxNode | null {
  // 包裹 class 的名字在第 1 行，没有原文件偏移，只能用合成源码取文本。
  for (let child = program.firstChild; child; child = child.nextSibling) {
    if (child.name !== "ClassDeclaration") {
      continue;
    }
    const name = child.getChild("Definition");
    if (name && textOf(name) === WRAPPER_CLASS) {
      return child;
    }
  }
  return null;
}

function readMethod(
  node: SyntaxNode,
  source: string,
  toOriginal: (offset: number) => number,
  textOf: (node: SyntaxNode) => string,
  rangeOf: (node: SyntaxNode) => SourceRange,
): MjavaMethod | null {
  const nameNode = node.getChild("Definition");
  if (!nameNode) {
    return null;
  }
  const modifiers = node.getChild("Modifiers");
  const paramsNode = node.getChild("FormalParameters");
  const body = node.getChild("Block");

  return {
    name: textOf(nameNode),
    nameRange: rangeOf(nameNode),
    range: rangeOf(node),
    bodyRange: body ? rangeOf(body) : undefined,
    returnType: joinTypeText(node, nameNode, textOf),
    visibility: readVisibility(modifiers ? textOf(modifiers) : ""),
    params: paramsNode ? readParameters(paramsNode, textOf, rangeOf) : [],
    locals: body ? readLocals(body, textOf, rangeOf) : [],
    documentation: docCommentBefore(source, toOriginal(node.from)),
  };
}

function readLocals(
  body: SyntaxNode,
  textOf: (node: SyntaxNode) => string,
  rangeOf: (node: SyntaxNode) => SourceRange,
): MjavaLocal[] {
  const locals: MjavaLocal[] = [];
  const walk = (node: SyntaxNode): void => {
    // 匿名类/回调里的局部变量不属于当前方法。
    if (node.name === "ClassBody" || node.name === "MethodDeclaration") {
      return;
    }
    if (node.name === "LocalVariableDeclaration") {
      const declarators = node.getChildren("VariableDeclarator");
      const first = declarators[0];
      const type = first ? joinTypeText(node, first, textOf) : "";
      for (const declarator of declarators) {
        const nameNode = declarator.getChild("Definition");
        if (!nameNode) {
          continue;
        }
        const initializer = readInitializer(declarator, textOf);
        locals.push({
          name: textOf(nameNode),
          type,
          nameRange: rangeOf(nameNode),
          range: rangeOf(node),
          initializer,
        });
      }
    } else if (node.name === "EnhancedForStatement") {
      const spec = node.getChild("ForSpec");
      if (spec) {
        const local = readLoopVariable(spec, textOf, rangeOf);
        if (local) {
          locals.push(local);
        }
      }
    } else if (node.name === "CatchClause") {
      const parameter = node.getChild("CatchFormalParameter");
      if (parameter) {
        const local = readLoopVariable(parameter, textOf, rangeOf);
        if (local) {
          locals.push(local);
        }
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      walk(child);
    }
  };
  walk(body);
  return locals;
}

function readLoopVariable(
  node: SyntaxNode,
  textOf: (node: SyntaxNode) => string,
  rangeOf: (node: SyntaxNode) => SourceRange,
): MjavaLocal | null {
  const nameNode = node.getChild("Definition");
  if (!nameNode) {
    return null;
  }
  const parts: string[] = [];
  for (let child = node.firstChild; child && child.from < nameNode.from; child = child.nextSibling) {
    if (child.name !== "(" && child.name !== "Modifiers") {
      parts.push(textOf(child));
    }
  }
  return {
    name: textOf(nameNode),
    type: parts.join(" ").trim(),
    nameRange: rangeOf(nameNode),
    range: rangeOf(node),
  };
}

function readInitializer(
  declarator: SyntaxNode,
  textOf: (node: SyntaxNode) => string,
): string | undefined {
  let assign: SyntaxNode | null = null;
  for (let child = declarator.firstChild; child; child = child.nextSibling) {
    if (child.name === "AssignOp") {
      assign = child;
    } else if (assign) {
      return textOf(child);
    }
  }
  return undefined;
}

function readParameters(
  paramsNode: SyntaxNode,
  textOf: (node: SyntaxNode) => string,
  rangeOf: (node: SyntaxNode) => SourceRange,
): MjavaParameter[] {
  const params: MjavaParameter[] = [];
  for (const paramNode of paramsNode.getChildren("FormalParameter")) {
    const nameNode = paramNode.getChild("Definition");
    if (!nameNode) {
      continue;
    }
    params.push({
      name: textOf(nameNode),
      type: joinTypeText(paramNode, nameNode, textOf),
      nameRange: rangeOf(nameNode),
    });
  }
  return params;
}

function readFields(
  node: SyntaxNode,
  textOf: (node: SyntaxNode) => string,
  rangeOf: (node: SyntaxNode) => SourceRange,
): MjavaField[] {
  const modifiers = node.getChild("Modifiers");
  const visibility = readVisibility(modifiers ? textOf(modifiers) : "");
  const fields: MjavaField[] = [];
  for (const declarator of node.getChildren("VariableDeclarator")) {
    const nameNode = declarator.getChild("Definition");
    if (!nameNode) {
      continue;
    }
    fields.push({
      name: textOf(nameNode),
      nameRange: rangeOf(nameNode),
      range: rangeOf(node),
      type: joinTypeText(node, declarator, textOf),
      visibility,
    });
  }
  return fields;
}

/** 名字之前、修饰符之后的节点文本就是类型（支持泛型与数组）。 */
function joinTypeText(
  node: SyntaxNode,
  stop: SyntaxNode,
  textOf: (node: SyntaxNode) => string,
): string {
  const parts: string[] = [];
  for (let child = node.firstChild; child && child.from < stop.from; child = child.nextSibling) {
    if (child.name !== "Modifiers") {
      parts.push(textOf(child));
    }
  }
  return parts.join(" ").trim();
}

function readVisibility(modifiers: string): "public" | "private" | "protected" | "" {
  const match = VISIBILITY.exec(modifiers);
  return (match?.[1] as "public" | "private" | "protected" | undefined) ?? "";
}

function readCalls(
  node: SyntaxNode,
  enclosingMethod: string,
  textAt: (from: number, to: number) => string,
  rangeOf: (node: SyntaxNode) => SourceRange,
): MjavaCall[] {
  const calls: MjavaCall[] = [];
  const walk = (current: SyntaxNode): void => {
    if (current.name === "MethodInvocation") {
      const call = readInvocation(current, enclosingMethod, textAt, rangeOf);
      if (call) {
        calls.push(call);
      }
    }
    for (let child = current.firstChild; child; child = child.nextSibling) {
      walk(child);
    }
  };
  walk(node);
  return calls;
}

function readInvocation(
  node: SyntaxNode,
  enclosingMethod: string,
  textAt: (from: number, to: number) => string,
  rangeOf: (node: SyntaxNode) => SourceRange,
): MjavaCall | null {
  const methodNameNode = node.getChild("MethodName");
  if (!methodNameNode) {
    return null;
  }
  const identifier = methodNameNode.getChild("Identifier") ?? methodNameNode.firstChild;
  if (!identifier) {
    return null;
  }
  const argsNode = node.getChild("ArgumentList");
  const args: MjavaArgument[] = [];
  if (argsNode) {
    for (let arg = argsNode.firstChild; arg; arg = arg.nextSibling) {
      if (arg.name === "(" || arg.name === ")" || arg.name === ",") {
        continue;
      }
      const raw = textAt(arg.from, arg.to).trim();
      const stringMatch = /^"((?:[^"\\]|\\.)*)"$/.exec(raw);
      args.push({
        raw,
        value: stringMatch ? unescapeJava(stringMatch[1]) : undefined,
        range: rangeOf(arg),
      });
    }
  }
  const receiver = textAt(node.from, methodNameNode.from).replace(/\.\s*$/, "").trim();
  return {
    name: textAt(identifier.from, identifier.to),
    qualifier: receiver || undefined,
    nameRange: rangeOf(identifier),
    range: rangeOf(node),
    args,
    enclosingMethod,
  };
}

function unescapeJava(value: string): string {
  return value.replace(/\\(.)/g, (_match, ch: string) => {
    switch (ch) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      default:
        return ch;
    }
  });
}

function countMethodNodes(node: SyntaxNode): number {
  let count = node.name === "MethodDeclaration" ? 1 : 0;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    count += countMethodNodes(child);
  }
  return count;
}

function hasErrorNode(node: SyntaxNode): boolean {
  if (node.type.isError) {
    return true;
  }
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (hasErrorNode(child)) {
      return true;
    }
  }
  return false;
}
