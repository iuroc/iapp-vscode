import { ProjectModule, ProjectPage } from "../iapp/project.js";
import { MjavaMethod } from "../java/mjava-parser.js";
import { IyuCall } from "../iyu/iyu-parser.js";
import { SourceRange } from "../model/source.js";

export type CoreSymbolKind = "method" | "field" | "event" | "call";

export interface CoreSymbol {
  name: string;
  detail: string;
  kind: CoreSymbolKind;
  range: SourceRange;
  selectionRange: SourceRange;
  children?: CoreSymbol[];
}

export function mjavaSymbols(module: ProjectModule): CoreSymbol[] {
  const fields: CoreSymbol[] = module.parsed.fields.map((field) => ({
    name: field.name,
    detail: field.type,
    kind: "field",
    range: field.range,
    selectionRange: field.nameRange,
  }));
  const methods: CoreSymbol[] = module.parsed.methods.map((method) => ({
    name: method.name,
    detail: methodDetail(method),
    kind: "method",
    range: method.range,
    selectionRange: method.nameRange,
  }));
  return [...fields, ...methods];
}

export function iyuSymbols(
  page: ProjectPage,
  resolveTarget: (call: IyuCall) => string | undefined,
): CoreSymbol[] {
  return page.parsed.events.map((event) => ({
    name: event.type,
    detail: event.calls.length > 0 ? `${event.calls.length} 条调用` : "空事件",
    kind: "event",
    range: event.range,
    selectionRange: event.range,
    children: event.calls.map((call) => ({
      name: resolveTarget(call) ?? callTargetText(call),
      detail: call.name,
      kind: "call",
      range: call.range,
      selectionRange: call.range,
    })),
  }));
}

export function methodDetail(method: MjavaMethod): string {
  const params = method.params.map((param) => `${param.type} ${param.name}`).join(", ");
  return `${method.returnType} ${method.name}(${params})`;
}

function callTargetText(call: IyuCall): string {
  return call.args[2]?.value ?? call.text;
}
