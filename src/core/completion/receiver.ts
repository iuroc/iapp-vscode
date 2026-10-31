export interface MemberAccess {
  /** 点号之前的接收者表达式。 */
  receiver: string;
  /** 点号之后已经输入的标识符前缀。 */
  prefix: string;
}

/**
 * 从当前行光标前的文本里识别成员访问，例如 `activity.getResources().ge`。
 * 只做词法级提取；推断仍交给 MjavaTypeInference。
 */
export function extractMemberAccess(linePrefix: string): MemberAccess | undefined {
  const text = linePrefix.replace(/\s+$/, "");
  if (!text) {
    return undefined;
  }

  let baseEnd = text.length;
  let prefix = "";
  if (text.endsWith(".")) {
    baseEnd = text.length - 1;
  } else {
    const match = /([A-Za-z_$][\w$]*)$/.exec(text);
    if (!match) {
      return undefined;
    }
    prefix = match[1];
    baseEnd = match.index;
    if (!text.slice(0, baseEnd).endsWith(".")) {
      return undefined;
    }
    baseEnd -= 1;
  }

  const scanned = scanReceiver(text, baseEnd);
  let receiver = scanned.value.trim();
  if (!receiver) {
    return undefined;
  }

  const before = text.slice(0, scanned.start).trimEnd();
  if (/\bnew$/.test(before)) {
    receiver = `new ${receiver}`;
  } else {
    const cast = /\(([A-Za-z_$][\w$.<>\[\]]*)\)$/.exec(before);
    if (cast) {
      receiver = `(${cast[1]}) ${receiver}`;
    }
  }
  return { receiver, prefix };
}

function scanReceiver(
  text: string,
  endExclusive: number,
): { value: string; start: number } {
  let i = endExclusive - 1;
  let parens = 0;
  let brackets = 0;
  let inString: string | null = null;

  while (i >= 0) {
    const ch = text[i];

    if (inString) {
      if (ch === inString && text[i - 1] !== "\\") {
        inString = null;
      }
      i--;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      i--;
      continue;
    }

    if (ch === ")") {
      parens++;
      i--;
      continue;
    }
    if (ch === "]") {
      brackets++;
      i--;
      continue;
    }
    if (ch === "(") {
      if (parens === 0) {
        break;
      }
      parens--;
      i--;
      continue;
    }
    if (ch === "[") {
      if (brackets === 0) {
        break;
      }
      brackets--;
      i--;
      continue;
    }

    if (parens > 0 || brackets > 0) {
      i--;
      continue;
    }
    if (/[\w$.[\]]/.test(ch)) {
      i--;
      continue;
    }
    break;
  }
  return { value: text.slice(i + 1, endExclusive), start: i + 1 };
}
