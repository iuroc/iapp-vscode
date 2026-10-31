import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/java";
import { docCommentBefore } from "../model/doc-comments.js";
import { LineIndex, SourceRange } from "../model/source.js";

export interface JavaImportInfo {
  name: string;
  isStatic: boolean;
  isWildcard: boolean;
  range: SourceRange;
}

export interface JavaParameterInfo {
  name: string;
  type: string;
}

export interface JavaMethodInfo {
  name: string;
  params: JavaParameterInfo[];
  returnType: string;
  nameRange: SourceRange;
  range: SourceRange;
  javadoc?: string;
  isConstructor: boolean;
}

export interface JavaFieldInfo {
  name: string;
  type: string;
  nameRange: SourceRange;
  range: SourceRange;
  javadoc?: string;
}

export type JavaTypeKind = "class" | "interface" | "enum" | "record";

export interface JavaClassInfo {
  name: string;
  /** 含外部类前缀，例如 `Map.Entry`。 */
  fqcn: string;
  kind: JavaTypeKind;
  superClass?: string;
  interfaces: string[];
  methods: JavaMethodInfo[];
  fields: JavaFieldInfo[];
  nested: JavaClassInfo[];
  nameRange: SourceRange;
  range: SourceRange;
  javadoc?: string;
}

export interface JavaFileInfo {
  path: string;
  text: string;
  packageName: string;
  imports: JavaImportInfo[];
  classes: JavaClassInfo[];
  /** 源码来源，由仓库在读取时补齐；自定义 URI 用它定位文件。 */
  source?: import("./class-source.js").ClassSourceLocation;
}

export function parseJavaFile(path: string, text: string): JavaFileInfo {
  const tree = parser.parse(text);
  const index = new LineIndex(text);
  const textOf = (node: SyntaxNode): string => text.slice(node.from, node.to);
  const rangeOf = (node: SyntaxNode): SourceRange => index.rangeAt(node.from, node.to);

  let packageName = "";
  const imports: JavaImportInfo[] = [];
  const classes: JavaClassInfo[] = [];

  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
    if (child.name === "PackageDeclaration") {
      packageName = parsePackage(child, textOf);
    } else if (child.name === "ImportDeclaration") {
      imports.push(parseImport(child, textOf, rangeOf));
    } else if (isTypeDeclaration(child)) {
      classes.push(parseClass(child, "", packageName, text, textOf, rangeOf));
    }
  }

  return { path, text, packageName, imports, classes };
}

export function findClassByFqcn(file: JavaFileInfo, fqcn: string): JavaClassInfo | undefined {
  const target = fqcn.includes(".")
    ? fqcn
    : file.classes[0]?.fqcn;
  for (const cls of file.classes) {
    const found = findClass(cls, target);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function findClass(cls: JavaClassInfo, fqcn: string): JavaClassInfo | undefined {
  if (cls.fqcn === fqcn) {
    return cls;
  }
  for (const nested of cls.nested) {
    const found = findClass(nested, fqcn);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function parsePackage(node: SyntaxNode, textOf: (node: SyntaxNode) => string): string {
  const name = node.getChild("ScopedIdentifier");
  return name ? textOf(name) : "";
}

function parseImport(
  node: SyntaxNode,
  textOf: (node: SyntaxNode) => string,
  rangeOf: (node: SyntaxNode) => SourceRange,
): JavaImportInfo {
  const raw = textOf(node).replace(/^import\s+/, "").replace(/;$/, "").trim();
  const isStatic = raw.startsWith("static ");
  const name = raw.replace(/^static\s+/, "").trim();
  return {
    name: name.replace(/\.\*$/, ""),
    isStatic,
    isWildcard: name.endsWith(".*"),
    range: rangeOf(node),
  };
}

function isTypeDeclaration(node: SyntaxNode): boolean {
  return (
    node.name === "ClassDeclaration" ||
    node.name === "InterfaceDeclaration" ||
    node.name === "EnumDeclaration" ||
    node.name === "RecordDeclaration"
  );
}

function parseClass(
  node: SyntaxNode,
  outerFqcn: string,
  packageName: string,
  source: string,
  textOf: (node: SyntaxNode) => string,
  rangeOf: (node: SyntaxNode) => SourceRange,
): JavaClassInfo {
  const nameNode = node.getChild("Definition");
  const name = nameNode ? textOf(nameNode) : "";
  const fqcn = outerFqcn ? `${outerFqcn}.${name}` : packageName ? `${packageName}.${name}` : name;
  const kind: JavaTypeKind =
    node.name === "InterfaceDeclaration"
      ? "interface"
      : node.name === "EnumDeclaration"
        ? "enum"
        : node.name === "RecordDeclaration"
          ? "record"
          : "class";

  const superclassNode = node.getChild("Superclass");
  const superClass = superclassNode ? rawTypeName(textOf(superclassNode).replace(/^extends\s+/, "")) : undefined;
  const interfaces = readInterfaces(node, textOf);
  const nameRange = nameNode ? rangeOf(nameNode) : rangeOf(node);
  const javadoc = docCommentBefore(source, node.from);

  const methods: JavaMethodInfo[] = [];
  const fields: JavaFieldInfo[] = [];
  const nested: JavaClassInfo[] = [];
  const body =
    node.getChild("ClassBody") ?? node.getChild("InterfaceBody") ?? node.getChild("EnumBody");

  if (body) {
    for (let child = body.firstChild; child; child = child.nextSibling) {
      if (child.name === "MethodDeclaration") {
        methods.push(readMethod(child, textOf, rangeOf, source, false));
      } else if (child.name === "ConstructorDeclaration") {
        methods.push(readMethod(child, textOf, rangeOf, source, true));
      } else if (child.name === "FieldDeclaration") {
        fields.push(...readFields(child, textOf, rangeOf, source));
      } else if (isTypeDeclaration(child)) {
        nested.push(
          parseClass(child, fqcn, packageName, source, textOf, rangeOf),
        );
      }
    }
  }

  return {
    name,
    fqcn,
    kind,
    superClass,
    interfaces,
    methods,
    fields,
    nested,
    nameRange,
    range: rangeOf(node),
    javadoc,
  };
}

function readInterfaces(
  node: SyntaxNode,
  textOf: (node: SyntaxNode) => string,
): string[] {
  const container = node.getChild("SuperInterfaces") ?? node.getChild("ExtendsInterfaces");
  const list = container?.getChild("InterfaceTypeList");
  if (!list) {
    return [];
  }
  const result: string[] = [];
  for (let child = list.firstChild; child; child = child.nextSibling) {
    if (child.name !== ",") {
      result.push(rawTypeName(textOf(child)));
    }
  }
  return result;
}

function readMethod(
  node: SyntaxNode,
  textOf: (node: SyntaxNode) => string,
  rangeOf: (node: SyntaxNode) => SourceRange,
  source: string,
  isConstructor: boolean,
): JavaMethodInfo {
  const nameNode = node.getChild("Definition");
  const paramsNode = node.getChild("FormalParameters");
  const params: JavaParameterInfo[] = [];
  if (paramsNode) {
    for (const param of paramsNode.getChildren("FormalParameter")) {
      const paramName = param.getChild("Definition");
      if (!paramName) {
        continue;
      }
      params.push({
        name: textOf(paramName),
        type: joinBefore(param, paramName, textOf),
      });
    }
  }
  return {
    name: nameNode ? textOf(nameNode) : "",
    params,
    returnType: isConstructor || !nameNode ? "" : joinBefore(node, nameNode, textOf),
    nameRange: nameNode ? rangeOf(nameNode) : rangeOf(node),
    range: rangeOf(node),
    javadoc: docCommentBefore(source, node.from),
    isConstructor,
  };
}

function readFields(
  node: SyntaxNode,
  textOf: (node: SyntaxNode) => string,
  rangeOf: (node: SyntaxNode) => SourceRange,
  source: string,
): JavaFieldInfo[] {
  const fields: JavaFieldInfo[] = [];
  const javadoc = docCommentBefore(source, node.from);
  for (const declarator of node.getChildren("VariableDeclarator")) {
    const nameNode = declarator.getChild("Definition");
    if (!nameNode) {
      continue;
    }
    fields.push({
      name: textOf(nameNode),
      type: joinBefore(node, declarator, textOf),
      nameRange: rangeOf(nameNode),
      range: rangeOf(node),
      javadoc,
    });
  }
  return fields;
}

function joinBefore(
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

export function rawTypeName(type: string): string {
  let current = type.trim();
  let previous = "";
  while (current !== previous) {
    previous = current;
    current = current.replace(/<[^<>]*>/g, "");
  }
  return current.replace(/\[\s*\]/g, "").replace(/\s+/g, " ").trim();
}

/** 取声明前紧邻的 `/** ... *\/` 注释，截到第一段或第一个块标签。 */
