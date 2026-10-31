import { LineIndex, SourceRange } from "../model/source.js";

export interface IyuAttribute {
  name: string;
  value: string;
  range: SourceRange;
}

export interface IyuProperty {
  key: string;
  value: string;
  range: SourceRange;
}

export interface IyuArgument {
  raw: string;
  /** 字符串字面量的值；非字符串参数为 undefined。 */
  value?: string;
  range: SourceRange;
}

export interface IyuCall {
  name: string;
  args: IyuArgument[];
  range: SourceRange;
  text: string;
}

export interface IyuView {
  tag: string;
  attributes: IyuAttribute[];
  properties: IyuProperty[];
  eventProperties: IyuProperty[];
  children: IyuView[];
  range: SourceRange;
}

export interface IyuEvent {
  type: string;
  calls: IyuCall[];
  range: SourceRange;
  bodyRange: SourceRange;
  bodyText: string;
}

export interface IyuIssue {
  message: string;
  range: SourceRange;
}

export interface IyuPage {
  page: string;
  text: string;
  views: IyuView[];
  events: IyuEvent[];
  issues: IyuIssue[];
}

interface CommentSpan {
  start: number;
  end: number;
}

const TAG_PATTERN = /<(\/?)([A-Za-z][\w]*)((?:"[^"]*"|'[^']*'|[^<>])*?)(\/?)>/g;
const ATTRIBUTE_PATTERN = /([A-Za-z_][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const WORD_PATTERN = /[A-Za-z_$][\w$]*/y;

export function parseIyu(page: string, source: string): IyuPage {
  const index = new LineIndex(source);
  const views: IyuView[] = [];
  const events: IyuEvent[] = [];
  const issues: IyuIssue[] = [];
  const commentSpans = collectCommentSpans(source);
  const viewStack: IyuView[] = [];
  const viewOpenOffsets: number[] = [];

  let pptView: IyuView | null = null;
  let eventView: IyuView | null = null;
  let currentEvent: IyuEvent | null = null;
  let currentEventBodyStart = 0;
  let currentEventOpenOffset = 0;
  let lastIndex = 0;

  const handleText = (text: string, base: number): void => {
    if (currentEvent) {
      currentEvent.calls.push(...parseCalls(text, base, index));
    } else if (pptView) {
      pptView.properties.push(...parseProperties(text, base, index));
    } else if (eventView) {
      eventView.eventProperties.push(...parseProperties(text, base, index));
    }
  };

  let match: RegExpExecArray | null;
  TAG_PATTERN.lastIndex = 0;
  while ((match = TAG_PATTERN.exec(source))) {
    if (isInsideComment(match.index, commentSpans)) {
      continue;
    }
    const [full, slash, tagName, attributesText, selfClosing] = match;
    handleText(source.slice(lastIndex, match.index), lastIndex);
    lastIndex = TAG_PATTERN.lastIndex;
    const tagStart = match.index;
    const attrsOffset = tagStart + 1 + slash.length + tagName.length;
    const closing = slash === "/";
    const isSelfClosing = selfClosing === "/";
    const range = index.rangeAt(tagStart, tagStart + full.length);

    if (tagName === "View") {
      if (closing) {
        closeView();
      } else {
        const view: IyuView = {
          tag: "View",
          attributes: parseAttributes(attributesText, attrsOffset, index),
          properties: [],
          eventProperties: [],
          children: [],
          range,
        };
        const parent = viewStack[viewStack.length - 1];
        if (parent) {
          parent.children.push(view);
        } else {
          views.push(view);
        }
        if (!isSelfClosing) {
          viewStack.push(view);
          viewOpenOffsets.push(tagStart);
        }
      }
    } else if (tagName === "ppt") {
      if (closing) {
        pptView = null;
      } else if (viewStack.length > 0) {
        pptView = viewStack[viewStack.length - 1];
      } else {
        issues.push({ message: "<ppt> 出现在 <View> 之外", range });
      }
    } else if (tagName === "event") {
      if (closing) {
        eventView = null;
      } else if (viewStack.length > 0) {
        eventView = viewStack[viewStack.length - 1];
      } else {
        issues.push({ message: "<event> 出现在 <View> 之外", range });
      }
    } else if (tagName === "eventItme") {
      if (closing) {
        closeEvent(tagStart);
      } else {
        if (currentEvent) {
          issues.push({ message: "<eventItme> 嵌套未闭合", range });
          closeEvent(tagStart);
        }
        const type = parseAttributes(attributesText, attrsOffset, index).find(
          (attribute) => attribute.name === "type",
        );
        currentEvent = {
          type: type?.value ?? "",
          calls: [],
          range,
          bodyRange: range,
          bodyText: "",
        };
        currentEventBodyStart = TAG_PATTERN.lastIndex;
        currentEventOpenOffset = tagStart;
        if (isSelfClosing) {
          closeEvent(tagStart);
        }
      }
    } else if (tagName === "UIEventset") {
      // 容器本身不产生符号，事件由 eventItme 承载。
    }
  }
  handleText(source.slice(lastIndex), lastIndex);

  if (currentEvent) {
    issues.push({
      message: "<eventItme> 未闭合",
      range: index.rangeAt(currentEventOpenOffset, source.length),
    });
    finishEvent(source.length);
    events.push(currentEvent);
    currentEvent = null;
  }
  while (viewStack.length > 0) {
    const offset = viewOpenOffsets.pop() ?? 0;
    issues.push({
      message: "<View> 未闭合",
      range: index.rangeAt(offset, Math.min(offset + 1, source.length)),
    });
    viewStack.pop();
  }

  return { page, text: source, views, events, issues };

  function closeView(): void {
    if (viewStack.length === 0) {
      issues.push({
        message: "</View> 没有对应的开始标签",
        range: index.rangeAt(TAG_PATTERN.lastIndex - 1, TAG_PATTERN.lastIndex),
      });
      return;
    }
    const view = viewStack.pop();
    const openOffset = viewOpenOffsets.pop() ?? 0;
    if (view) {
      view.range = index.rangeAt(openOffset, TAG_PATTERN.lastIndex);
    }
    if (view === pptView) pptView = null;
    if (view === eventView) eventView = null;
  }

  function closeEvent(closeOffset: number): void {
    if (!currentEvent) {
      return;
    }
    finishEvent(closeOffset);
    events.push(currentEvent);
    currentEvent = null;
  }

  function finishEvent(endOffset: number): void {
    if (!currentEvent) {
      return;
    }
    currentEvent.bodyRange = index.rangeAt(currentEventBodyStart, Math.max(currentEventBodyStart, endOffset));
    currentEvent.bodyText = source.slice(currentEventBodyStart, endOffset);
    currentEvent.range = index.rangeAt(currentEventOpenOffset, endOffset);
  }
}

function parseAttributes(
  text: string,
  base: number,
  index: LineIndex,
): IyuAttribute[] {
  const attributes: IyuAttribute[] = [];
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(text))) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attributes.push({
      name: match[1],
      value,
      range: index.rangeAt(base + match.index, base + match.index + match[0].length),
    });
  }
  return attributes;
}

function parseProperties(text: string, base: number, index: LineIndex): IyuProperty[] {
  const properties: IyuProperty[] = [];
  let offset = 0;
  for (const line of text.split(/(\r\n|\n|\r)/)) {
    if (line === "\r\n" || line === "\n" || line === "\r") {
      offset += line.length;
      continue;
    }
    const trimmed = line.trim();
    const leading = line.length - line.trimStart().length;
    const start = base + offset + leading;
    offset += line.length;
    if (!trimmed || trimmed.startsWith("//")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    properties.push({
      key,
      value,
      range: index.rangeAt(start, start + trimmed.length),
    });
  }
  return properties;
}

export function parseCalls(text: string, base: number, index: LineIndex): IyuCall[] {
  const calls: IyuCall[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipQuoted(text, i);
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const newline = text.indexOf("\n", i);
      i = newline < 0 ? text.length : newline + 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    WORD_PATTERN.lastIndex = i;
    const word = WORD_PATTERN.exec(text);
    if (!word) {
      i++;
      continue;
    }
    const name = word[0];
    let cursor = WORD_PATTERN.lastIndex;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
    if ((name === "call" || name === "addv") && text[cursor] === "(") {
      const parsed = parseCallAt(text, i, name, cursor, base, index);
      if (parsed) {
        calls.push(parsed.call);
        i = parsed.end;
        continue;
      }
    }
    i = WORD_PATTERN.lastIndex;
  }
  return calls;
}

function parseCallAt(
  text: string,
  start: number,
  name: string,
  openParen: number,
  base: number,
  index: LineIndex,
): { call: IyuCall; end: number } | null {
  let depth = 0;
  let i = openParen;
  let inString: string | null = null;
  const argRanges: Array<{ start: number; end: number }> = [];
  let argStart = openParen + 1;

  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      i++;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        if (text.slice(argStart, i).trim()) {
          argRanges.push({ start: argStart, end: i });
        }
        const end = i + 1;
        const args = argRanges.map((item) => toArgument(text, item.start, item.end, base, index));
        return {
          call: {
            name,
            args,
            range: index.rangeAt(base + start, base + end),
            text: text.slice(start, end),
          },
          end,
        };
      }
      i++;
      continue;
    }
    if (ch === "," && depth === 1) {
      argRanges.push({ start: argStart, end: i });
      argStart = i + 1;
    }
    i++;
  }
  return null;
}

function toArgument(
  text: string,
  start: number,
  end: number,
  base: number,
  index: LineIndex,
): IyuArgument {
  const raw = text.slice(start, end);
  const trimmed = raw.trim();
  const leading = raw.length - raw.trimStart().length;
  const argumentStart = start + leading;
  const stringMatch = /^"((?:[^"\\]|\\.)*)"$/.exec(trimmed);
  return {
    raw: trimmed,
    value: stringMatch ? unescapeString(stringMatch[1]) : undefined,
    range: index.rangeAt(base + argumentStart, base + argumentStart + trimmed.length),
  };
}

function unescapeString(value: string): string {
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

function skipQuoted(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
    } else if (text[i] === quote) {
      return i + 1;
    } else {
      i++;
    }
  }
  return i;
}

function collectCommentSpans(source: string): CommentSpan[] {
  const spans: CommentSpan[] = [];
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      const stop = end < 0 ? source.length : end + 3;
      spans.push({ start: i, end: stop });
      i = stop;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      i = skipQuoted(source, i);
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      const stop = newline < 0 ? source.length : newline;
      spans.push({ start: i, end: stop });
      i = stop;
      continue;
    }
    i++;
  }
  return spans;
}

function isInsideComment(offset: number, spans: CommentSpan[]): boolean {
  return spans.some((span) => offset >= span.start && offset < span.end);
}
