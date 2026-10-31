import * as vscode from "vscode";

/**
 * 把注释按纯文本追加到 Markdown：逐行 appendText（转义 Markdown 符号），
 * 行间用硬换行保留原始折行，避免 `---`、`*`、单换行被 Markdown 重新排版。
 */
export function appendPlainText(markdown: vscode.MarkdownString, text: string): void {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    markdown.appendText(line);
    if (index < lines.length - 1) {
      markdown.appendMarkdown(line.trim() === "" ? "\n\n" : "  \n");
    }
  });
}

export function plainTextMarkdown(text: string): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  appendPlainText(markdown, text);
  return markdown;
}
