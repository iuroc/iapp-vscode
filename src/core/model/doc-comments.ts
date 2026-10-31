interface SourceLine {
  text: string;
  start: number;
  end: number;
}

/**
 * 读取声明上方的文档注释：
 * - `/** ... *\/`（允许中间有空行、`@param` 等标签）
 * - 连续的 `// ...` 行
 *
 * 注释与声明之间允许最多两个空行；只有分隔线的注释块（如
 * `// ---------- 日志 ----------`）视为分节标题，不挂到方法上。
 */
export function docCommentBefore(source: string, offset: number): string | undefined {
  const lines = sourceLines(source);
  const lineIndex = findLine(lines, offset);
  if (lineIndex <= 0) {
    return undefined;
  }
  const line = lines[lineIndex];
  if (source.slice(line.start, offset).trim() !== "") {
    return undefined;
  }

  let previousIndex = lineIndex - 1;
  let gap = 0;
  while (previousIndex >= 0 && lines[previousIndex].text.trim() === "") {
    gap++;
    previousIndex--;
  }
  if (previousIndex < 0 || gap > 2) {
    return undefined;
  }

  const previous = lines[previousIndex];
  const trimmed = previous.text.trim();

  if (trimmed.startsWith("//")) {
    const collected: string[] = [];
    let index = previousIndex;
    while (index >= 0) {
      const text = lines[index].text.trim();
      if (!text.startsWith("//")) {
        break;
      }
      collected.unshift(text.replace(/^\/\/\s?/, ""));
      index--;
    }
    return acceptComment(cleanCommentLines(collected), gap);
  }

  if (trimmed.endsWith("*/")) {
    const start = source.lastIndexOf("/**", previous.end);
    if (start < 0) {
      return undefined;
    }
    const openLineStart = source.lastIndexOf("\n", start) + 1;
    if (source.slice(openLineStart, start).trim() !== "") {
      return undefined;
    }
    const closing = source.indexOf("*/", start);
    if (closing < 0 || closing < previous.start || closing > previous.end) {
      return undefined;
    }
    const block = source.slice(start, closing + 2);
    if (!block.startsWith("/**")) {
      return undefined;
    }
    return acceptComment(cleanBlockComment(block), gap);
  }

  return undefined;
}

function acceptComment(text: string | undefined, gap: number): string | undefined {
  if (!text) {
    return undefined;
  }
  if (gap > 0 && isSeparatorOnly(text)) {
    return undefined;
  }
  return text;
}

function isSeparatorOnly(text: string): boolean {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every(isSeparatorLine);
}

function isSeparatorLine(line: string): boolean {
  const compact = line.replace(/\s/g, "");
  if (compact.length < 4) {
    return false;
  }
  const marks = (compact.match(/[-=_*#~]/g) ?? []).length;
  return marks >= 3 && marks / compact.length >= 0.6;
}

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      lines.push({
        text: source.slice(start, i).replace(/\r$/, ""),
        start,
        end: i,
      });
      start = i + 1;
    }
  }
  lines.push({ text: source.slice(start).replace(/\r$/, ""), start, end: source.length });
  return lines;
}

function findLine(lines: SourceLine[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lines[mid].start <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

export function cleanBlockComment(block: string): string | undefined {
  const start = block.indexOf("/*");
  const end = block.lastIndexOf("*/");
  if (start < 0 || end < start) {
    return undefined;
  }
  const inner = block.slice(start + 2, end);
  const lines = inner.split(/\r?\n/).map((line) => line.replace(/^\s*\* ?/, "").trimEnd());
  return cleanCommentLines(lines);
}

export function cleanCommentLines(lines: string[]): string | undefined {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[0].trim() === "") {
    trimmed.shift();
  }
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === "") {
    trimmed.pop();
  }
  const text = trimmed
    .join("\n")
    .replace(/\{@link(?:code|plain)?\s+([^}]+)\}/g, "$1")
    .trim();
  return text || undefined;
}
