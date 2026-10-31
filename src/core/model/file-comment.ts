import { cleanBlockComment, cleanCommentLines } from "./doc-comments.js";

/**
 * 文件级注释：文件开头的第一个连续注释块。
 *
 * - 允许开头有空行；
 * - `//` 连续行合并，`//` 空行仍属于同一块；
 * - `/** *\/` 或 `/* *\/` 块注释；
 * - 遇到空行或代码即停止，不合并空行后的第二段注释。
 */
export function fileComment(source: string): string | undefined {
  const lines = source.replace(/^﻿/, "").split(/\r?\n/);
  let index = 0;
  while (index < lines.length && lines[index].trim() === "") {
    index++;
  }
  if (index >= lines.length) {
    return undefined;
  }

  const first = lines[index].trim();
  if (first.startsWith("//")) {
    const collected: string[] = [];
    while (index < lines.length && lines[index].trim().startsWith("//")) {
      collected.push(lines[index].trim().replace(/^\/\/\s?/, ""));
      index++;
    }
    return cleanCommentLines(collected);
  }

  if (first.startsWith("/*")) {
    const blockLines: string[] = [];
    let closed = false;
    while (index < lines.length) {
      blockLines.push(lines[index]);
      if (lines[index].includes("*/")) {
        closed = true;
        index++;
        break;
      }
      index++;
    }
    if (!closed) {
      return undefined;
    }
    const block = cleanBlockComment(blockLines.join("\n"));
    const trailing: string[] = [];
    while (index < lines.length && lines[index].trim().startsWith("//")) {
      trailing.push(lines[index].trim().replace(/^\/\/\s?/, ""));
      index++;
    }
    const tail = cleanCommentLines(trailing);
    return [block, tail].filter(Boolean).join("\n\n") || undefined;
  }

  return undefined;
}
