import { ProjectModel } from "../iapp/project.js";
import { SourceRange } from "../model/source.js";
import { resolveEntryCall } from "./resolver.js";
import { methodDetail } from "./symbols.js";

export type TreeNodeKind = "project" | "module" | "page" | "method" | "event" | "call";

export interface ProjectTreeNode {
  kind: TreeNodeKind;
  label: string;
  detail?: string;
  tooltip?: string;
  /** 点击后打开的文件；分组节点为空。 */
  filePath?: string;
  range?: SourceRange;
  children?: ProjectTreeNode[];
}

export function buildProjectTree(model: ProjectModel): ProjectTreeNode {
  const modules: ProjectTreeNode[] = [...model.modules.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((module) => ({
      kind: "module",
      label: module.name,
      detail: `${module.parsed.methods.length} 方法`,
      tooltip: module.parsed.documentation,
      filePath: module.filePath,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      children: module.parsed.methods.map((method) => ({
        kind: "method",
        label: method.name,
        detail: methodDetail(method),
        filePath: module.filePath,
        range: method.nameRange,
      })),
    }));

  const pages: ProjectTreeNode[] = [...model.pages.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((page) => ({
      kind: "page",
      label: page.name,
      detail: `${page.parsed.events.length} 事件`,
      filePath: page.filePath,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      children: page.parsed.events.map((event) => ({
        kind: "event",
        label: event.type,
        detail: `${event.calls.length} 调用`,
        filePath: page.filePath,
        range: event.range,
        children: event.calls.map((call) => {
          const target = resolveEntryCall(model, call).targets[0];
          return {
            kind: "call",
            label: target
              ? `${target.module.name}.${target.method.name}`
              : (call.args[2]?.value ?? call.text),
            detail: call.name,
            filePath: target ? target.module.filePath : page.filePath,
            range: target ? target.method.nameRange : call.range,
          };
        }),
      })),
    }));

  return {
    kind: "project",
    label: model.manifest.packageName || "iApp 工程",
    detail: model.root,
    children: [...modules, ...pages],
  };
}
