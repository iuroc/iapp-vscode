import { MjavaCall, MjavaField, MjavaFile, MjavaMethod } from "../java/mjava-parser.js";
import { MjavaImport } from "../java/mjava-source.js";
import { IyuCall, IyuEvent, IyuPage } from "../iyu/iyu-parser.js";
import { SourcePosition, SourceRange } from "../model/source.js";

export type MjavaSymbolAt =
  | { kind: "call"; call: MjavaCall }
  | { kind: "method"; method: MjavaMethod }
  | { kind: "field"; field: MjavaField }
  | { kind: "import"; import: MjavaImport };

export function inRange(range: SourceRange, position: SourcePosition): boolean {
  return compare(position, range.start) >= 0 && compare(position, range.end) <= 0;
}

export function compare(a: SourcePosition, b: SourcePosition): number {
  return a.line !== b.line ? a.line - b.line : a.character - b.character;
}

export function mjavaSymbolAt(
  parsed: MjavaFile,
  position: SourcePosition,
): MjavaSymbolAt | undefined {
  const call = innermost(
    parsed.calls.filter((item) => inRange(item.range, position)),
  );
  if (call) {
    return { kind: "call", call };
  }
  const method = parsed.methods.find((item) => inRange(item.nameRange, position));
  if (method) {
    return { kind: "method", method };
  }
  const field = parsed.fields.find((item) => inRange(item.nameRange, position));
  if (field) {
    return { kind: "field", field };
  }
  const imported = parsed.imports.find(
    (item) => item.range !== undefined && inRange(item.range, position),
  );
  if (imported) {
    return { kind: "import", import: imported };
  }
  return undefined;
}

export function iyuCallAt(page: IyuPage, position: SourcePosition): IyuCall | undefined {
  return innermost(
    page.events.flatMap((event) => event.calls).filter((call) => inRange(call.range, position)),
  );
}

export function iyuEventAt(page: IyuPage, position: SourcePosition): IyuEvent | undefined {
  return page.events.find((event) => inRange(event.range, position));
}

function innermost<T extends { range: SourceRange }>(items: T[]): T | undefined {
  let best: T | undefined;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const span = spanOf(item.range);
    if (span < bestSpan) {
      best = item;
      bestSpan = span;
    }
  }
  return best;
}

function spanOf(range: SourceRange): number {
  return (
    (range.end.line - range.start.line) * 1_000_000 +
    (range.end.character - range.start.character)
  );
}
