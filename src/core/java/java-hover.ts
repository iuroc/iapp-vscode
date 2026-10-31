import { JavaClassContext } from "./java-repository.js";
import { JavaMemberMatch } from "./java-resolver.js";
import { JavaClassInfo, JavaMethodInfo, rawTypeName } from "./java-class-parser.js";

export interface JavaHoverContent {
  signature: string;
  details: string[];
  javadoc?: string;
}

export function javaMethodHover(match: JavaMemberMatch): JavaHoverContent {
  const { method, context } = match;
  const signature = method.isConstructor
    ? `${context.class.name}(${paramsOf(method)})`
    : `${method.returnType} ${context.class.name}.${method.name}(${paramsOf(method)})`;
  const details = [`声明于 \`${context.class.fqcn}\``];
  if (context.class.superClass) {
    details.push(`继承 \`${rawTypeName(context.class.superClass)}\``);
  }
  return { signature, details, javadoc: method.javadoc };
}

export function javaClassHover(context: JavaClassContext): JavaHoverContent {
  const cls = context.class;
  return {
    signature: classSignature(cls),
    details: [`\`${cls.fqcn}\``, `${cls.methods.length} 个方法 · ${cls.fields.length} 个字段`],
    javadoc: cls.javadoc,
  };
}

function classSignature(cls: JavaClassInfo): string {
  const extendsText = cls.superClass ? ` extends ${rawTypeName(cls.superClass)}` : "";
  const implementsText =
    cls.kind === "interface"
      ? cls.interfaces.length > 0
        ? ` extends ${cls.interfaces.map(rawTypeName).join(", ")}`
        : ""
      : cls.interfaces.length > 0
        ? ` implements ${cls.interfaces.map(rawTypeName).join(", ")}`
        : "";
  return `${cls.kind} ${cls.fqcn}${extendsText}${implementsText}`;
}

function paramsOf(method: JavaMethodInfo): string {
  return method.params.map((param) => `${param.type} ${param.name}`).join(", ");
}
