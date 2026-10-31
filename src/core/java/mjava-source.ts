export interface MjavaImport {
  /** 不含 `import` 与分号的完整名字，例如 `java.util.ArrayList`。 */
  name: string;
  isStatic: boolean;
  /** 0 基行号，指向原文件。 */
  line: number;
  /** 原文件中 import 名字的起止偏移。 */
  from: number;
  to: number;
  /** 原文件中的行列范围，由解析器补齐。 */
  range?: import("../model/source.js").SourceRange;
}

export interface WrappedMjava {
  /** 交给 Lezer 解析的合成源码。 */
  text: string;
  /** 合成源码第 1 行的长度（含换行），用于把偏移量映射回原文件。 */
  headerLength: number;
  imports: MjavaImport[];
}

const IMPORT_PATTERN = /^\s*import\s+(static\s+)?([\w.$*]+)\s*;\s*$/;

/**
 * Lezer 把 Java 模块系统的上下文关键字当成全局保留字，真实的 mjava 会把 `to`
 * 用作形参名（例如 `ix_moveTo(File from, File to)`）。这里做等长替换，
 * 只影响喂给解析器的合成源码，节点偏移量与原文件完全一致。
 */
const RESERVED_IDENTIFIERS: ReadonlyMap<string, string> = new Map([
  ["to", "t0"],
  ["with", "w1th"],
  ["uses", "u5es"],
  ["provides", "pr0v1des"],
]);

function sanitizeReservedIdentifiers(source: string): string {
  const out = source.split("");
  const isIdentifierStart = (ch: string): boolean => /[A-Za-z_$]/.test(ch);
  const isIdentifierPart = (ch: string): boolean => /[\w$]/.test(ch);

  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
        } else if (source[i] === quote) {
          i++;
          break;
        } else {
          i++;
        }
      }
      continue;
    }
    if (!isIdentifierStart(ch)) {
      i++;
      continue;
    }

    const start = i;
    while (i < source.length && isIdentifierPart(source[i])) i++;
    const word = source.slice(start, i);
    const replacement = RESERVED_IDENTIFIERS.get(word);
    if (replacement && replacement.length === word.length) {
      for (let k = 0; k < replacement.length; k++) {
        out[start + k] = replacement[k];
      }
    }
  }
  return out.join("");
}

/**
 * 提取顶层 import，把原文件包进一个合成 class。
 *
 * 合成源码只有第 1 行是新增的，其余部分与原文件逐字符等长（import 行用空格覆盖），
 * 因此合成偏移量减去 headerLength 就是原文件偏移量，行号与列号都不会漂移。
 */
export function wrapMjavaSource(source: string): WrappedMjava {
  const sanitized = sanitizeReservedIdentifiers(source);
  const imports: MjavaImport[] = [];
  const bodyParts: string[] = [];
  let offset = 0;
  let line = 0;

  for (const part of sanitized.split(/(\r\n|\n|\r)/)) {
    if (part === "\r\n" || part === "\n" || part === "\r") {
      bodyParts.push(part);
      offset += part.length;
      line++;
      continue;
    }

    const originalPart = source.slice(offset, offset + part.length);
    const match = IMPORT_PATTERN.exec(originalPart);
    if (match) {
      const nameStart = originalPart.indexOf(match[2]);
      imports.push({
        name: match[2],
        isStatic: Boolean(match[1]),
        line,
        from: offset + nameStart,
        to: offset + nameStart + match[2].length,
      });
      // 保留长度：列号与后续偏移量都不变。
      bodyParts.push(" ".repeat(part.length));
    } else {
      bodyParts.push(part);
    }
    offset += part.length;
  }

  const importText = imports
    .map((item) => `import ${item.isStatic ? "static " : ""}${item.name};`)
    .join(" ");
  const header = `${importText ? `${importText} ` : ""}class __IAppWrap {\n`;
  return {
    text: `${header}${bodyParts.join("")}\n}\n`,
    headerLength: header.length,
    imports,
  };
}
