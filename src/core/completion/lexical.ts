export type LexicalContext = "code" | "string" | "char" | "lineComment" | "blockComment";

/** 判断光标所在的词法区域，用于避免在字符串/注释里给出代码补全。 */
export function lexicalContextAt(text: string, offset: number): LexicalContext {
  type State = "code" | "line" | "block" | "string" | "char";
  let state: State = "code";
  let i = 0;
  const end = Math.max(0, Math.min(offset, text.length));
  while (i < end) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        i += 2;
      } else if (ch === "/" && next === "*") {
        state = "block";
        i += 2;
      } else if (text.startsWith("<!--", i)) {
        state = "block";
        i += 4;
      } else if (ch === '"') {
        state = "string";
        i++;
      } else if (ch === "'") {
        state = "char";
        i++;
      } else {
        i++;
      }
      continue;
    }
    if (state === "line") {
      if (ch === "\n") {
        state = "code";
      }
      i++;
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        i += 2;
      } else if (text.startsWith("-->", i)) {
        state = "code";
        i += 3;
      } else {
        i++;
      }
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if ((state === "string" && ch === '"') || (state === "char" && ch === "'")) {
      state = "code";
    }
    i++;
  }
  switch (state) {
    case "line":
      return "lineComment";
    case "block":
      return "blockComment";
    case "string":
      return "string";
    case "char":
      return "char";
    default:
      return "code";
  }
}
