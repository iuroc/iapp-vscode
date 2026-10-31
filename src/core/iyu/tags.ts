export interface IyuTagAttributeDoc {
  name: string;
  summary: string;
  valueHint?: string;
}

export interface IyuTagDoc {
  name: string;
  summary: string;
  details: string[];
  attributes: IyuTagAttributeDoc[];
  children: string[];
  example?: string;
}

export interface ScannedTagAttribute {
  name: string;
  nameStart: number;
  nameEnd: number;
  value?: string;
  valueStart?: number;
  valueEnd?: number;
}

export interface ScannedTag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
  attributes: ScannedTagAttribute[];
}

export type TagCompletionContext =
  | { kind: "tag"; prefix: string }
  | { kind: "closing"; prefix: string }
  | { kind: "attribute"; prefix: string; tagName: string; existingAttributes: string[] };

const VIEW_ATTRIBUTES: IyuTagAttributeDoc[] = [
  {
    name: "id",
    summary: "控件标识，整数；mjava 用 findViewById(id) 或 i.gvs(id) 获取。",
    valueHint: "1",
  },
  {
    name: "did",
    summary: "父容器 id；0 表示根控件。",
    valueHint: "0",
  },
  {
    name: "type",
    summary: "控件类型，如 FrameLayout、TextView；短名或全类名。",
    valueHint: "FrameLayout",
  },
];

const EVENT_ITEM_ATTRIBUTES: IyuTagAttributeDoc[] = [
  {
    name: "type",
    summary: "事件类型，如 loading、loadingComplete、resume、clicki。",
    valueHint: "loading",
  },
];

export const IYU_TAG_DOCS: readonly IyuTagDoc[] = [
  {
    name: "View",
    summary: "声明一个控件。",
    details: [
      "必须写 id、did、type 三个属性；did 指向父容器，0 表示根。",
      "`<View>` 内部用 `<ppt>` 写属性、用 `<event>` 写控件事件。",
      "多个 `<View>` 可以并列，iyu 不要求单一根节点。",
    ],
    attributes: VIEW_ATTRIBUTES,
    children: ["ppt", "event"],
    example: '<View id="1" did="0" type="FrameLayout">',
  },
  {
    name: "ppt",
    summary: "控件属性块，每行一个 key=value。",
    details: [
      "属性行必须从行首开始，前面不能有空格；`key = value` 两边带空格会让该行整行失效。",
      "常用属性：width/height、backgroundcolor、text、textsize、padding、gravity。",
    ],
    attributes: [],
    children: [],
    example: "<ppt>width=-1\nheight=-1</ppt>",
  },
  {
    name: "event",
    summary: "控件级事件块。",
    details: [
      "放在 `<View>` 内，内部用 `<eventItme type=\"...\">` 绑定该控件的事件。",
      "事件体只写 `call` / `addv`，其它逻辑下沉到 mjava。",
    ],
    attributes: [],
    children: ["eventItme"],
  },
  {
    name: "UIEventset",
    summary: "页面级全局事件区。",
    details: [
      "内部用 `<eventItme type=\"...\">` 绑定 loading、loadingComplete、resume 等界面事件。",
      "同一页面的全局事件都集中在这一块。",
    ],
    attributes: [],
    children: ["eventItme"],
  },
  {
    name: "eventItme",
    summary: "单个事件入口。",
    details: [
      "`type` 是事件名；载入完毕是 `loadingComplete`（驼峰）。",
      "事件体只允许 `call(null, \"mjava\", \"mod.method\", ...)` 与 `addv(...)`。",
      "事件体行尾注释会中断整个载入事件。",
    ],
    attributes: EVENT_ITEM_ATTRIBUTES,
    children: [],
    example: '<eventItme type="loading">\ncall(null, "mjava", "mod.first")\n</eventItme>',
  },
];

export function findIyuTagDoc(name: string): IyuTagDoc | undefined {
  return IYU_TAG_DOCS.find((doc) => doc.name === name);
}

/** 扫描 iyu 里所有标签，跳过字符串、行注释与 HTML 注释。 */
export function scanIyuTags(source: string): ScannedTag[] {
  const tags: ScannedTag[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      i = skipQuoted(source, i);
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i + 2);
      i = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (ch !== "<") {
      i++;
      continue;
    }
    if (source[i + 1] === "?") {
      const end = source.indexOf("?>", i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }

    const closing = source[i + 1] === "/";
    let cursor = i + (closing ? 2 : 1);
    if (!/[A-Za-z]/.test(source[cursor] ?? "")) {
      i++;
      continue;
    }
    const nameStart = cursor;
    while (cursor < source.length && /[\w]/.test(source[cursor])) {
      cursor++;
    }
    const name = source.slice(nameStart, cursor);
    const attributes: ScannedTagAttribute[] = [];
    let selfClosing = false;

    while (cursor < source.length) {
      while (cursor < source.length && /\s/.test(source[cursor])) {
        cursor++;
      }
      if (source.startsWith("/>", cursor)) {
        selfClosing = true;
        cursor += 2;
        break;
      }
      if (source[cursor] === ">") {
        cursor++;
        break;
      }
      if (source[cursor] === '"' || source[cursor] === "'") {
        cursor = skipQuoted(source, cursor);
        continue;
      }
      if (!/[A-Za-z_]/.test(source[cursor] ?? "")) {
        cursor++;
        continue;
      }
      const attrStart = cursor;
      while (cursor < source.length && /[\w:-]/.test(source[cursor])) {
        cursor++;
      }
      const attrName = source.slice(attrStart, cursor);
      const saved = cursor;
      while (cursor < source.length && /\s/.test(source[cursor])) {
        cursor++;
      }
      if (source[cursor] !== "=") {
        cursor = saved;
        attributes.push({ name: attrName, nameStart: attrStart, nameEnd: attrStart + attrName.length });
        continue;
      }
      cursor++;
      while (cursor < source.length && /\s/.test(source[cursor])) {
        cursor++;
      }
      const quote = source[cursor];
      if (quote === '"' || quote === "'") {
        const valueStart = cursor + 1;
        cursor = skipQuoted(source, cursor);
        attributes.push({
          name: attrName,
          nameStart: attrStart,
          nameEnd: attrStart + attrName.length,
          value: source.slice(valueStart, cursor - 1),
          valueStart,
          valueEnd: cursor - 1,
        });
      } else {
        const valueStart = cursor;
        while (cursor < source.length && !/[\s>]/.test(source[cursor])) {
          cursor++;
        }
        attributes.push({
          name: attrName,
          nameStart: attrStart,
          nameEnd: attrStart + attrName.length,
          value: source.slice(valueStart, cursor),
          valueStart,
          valueEnd: cursor,
        });
      }
    }

    tags.push({
      name,
      closing,
      selfClosing,
      start: i,
      end: cursor,
      nameStart,
      nameEnd: nameStart + name.length,
      attributes,
    });
    i = cursor;
  }
  return tags;
}

/**
 * 判断光标处的补全上下文：
 * - 刚输入 `<` 或 `<Vi`：标签名
 * - 刚输入 `</` 或 `</Vi`：闭合标签
 * - 在 `<View ...` 内输入属性：属性名
 */
export function tagCompletionAt(source: string, offset: number): TagCompletionContext | undefined {
  const openIndex = source.lastIndexOf("<", offset - 1);
  if (openIndex < 0) {
    return undefined;
  }
  const closeIndex = source.lastIndexOf(">", offset - 1);
  if (closeIndex > openIndex) {
    return undefined;
  }

  const inside = source.slice(openIndex + 1, offset);
  if (inside.startsWith("?") || inside.startsWith("!")) {
    return undefined;
  }
  if (inside.startsWith("/")) {
    const rest = inside.slice(1);
    if (!/^[A-Za-z]*$/.test(rest)) {
      return undefined;
    }
    return { kind: "closing", prefix: rest };
  }

  const nameMatch = /^([A-Za-z][\w]*)/.exec(inside);
  if (!nameMatch) {
    return { kind: "tag", prefix: inside };
  }
  const tagName = nameMatch[1];
  const afterName = inside.slice(nameMatch[0].length);
  if (/^\s*$/.test(afterName) && afterName.length === 0) {
    return { kind: "tag", prefix: inside };
  }
  const prefixMatch = /([A-Za-z_][\w:-]*)$/.exec(afterName);
  const prefix = prefixMatch && !/\s/.test(prefixMatch[0]) ? prefixMatch[1] : "";
  const existingAttributes = [...afterName.matchAll(/([A-Za-z_][\w:-]*)\s*=/g)].map(
    (match) => match[1],
  );
  return { kind: "attribute", prefix, tagName, existingAttributes };
}

export function tagAtOffset(
  source: string,
  offset: number,
): { tag: ScannedTag; doc?: IyuTagDoc; attribute?: ScannedTagAttribute } | undefined {
  for (const tag of scanIyuTags(source)) {
    if (offset < tag.start || offset > tag.end) {
      continue;
    }
    if (offset >= tag.nameStart && offset <= tag.nameEnd) {
      return { tag, doc: findIyuTagDoc(tag.name) };
    }
    for (const attribute of tag.attributes) {
      const inName = offset >= attribute.nameStart && offset <= attribute.nameEnd;
      const inValue =
        attribute.valueStart !== undefined &&
        attribute.valueEnd !== undefined &&
        offset >= attribute.valueStart &&
        offset <= attribute.valueEnd;
      if (inName || inValue) {
        const doc = findIyuTagDoc(tag.name);
        return { tag, doc, attribute };
      }
    }
    return { tag, doc: findIyuTagDoc(tag.name) };
  }
  return undefined;
}

function skipQuoted(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
    } else if (source[i] === quote) {
      return i + 1;
    } else {
      i++;
    }
  }
  return source.length;
}
