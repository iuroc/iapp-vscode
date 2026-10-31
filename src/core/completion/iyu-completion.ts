import { ProjectModel } from "../iapp/project.js";
import { completeQualifiedMethods } from "./mjava-completion.js";
import { CompletionCandidate } from "./types.js";

const BUILTIN_EVENTS = [
  "loading",
  "loadingComplete",
  "resume",
  "clicki",
  "downkey",
  "editormonitor",
];

/** iyu `eventItme type="..."` 的候选：内置事件 + 工程里已出现的类型。 */
export function completeEventTypes(
  model: ProjectModel,
  prefix: string,
): CompletionCandidate[] {
  const names = new Set(BUILTIN_EVENTS);
  for (const page of model.pages.values()) {
    for (const event of page.parsed.events) {
      if (event.type) {
        names.add(event.type);
      }
    }
  }
  return [...names]
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      label: name,
      kind: "event",
      detail: "iyu 事件",
      insertText: name,
      sortGroup: 0,
    }));
}

/** iyu `call(null, "mjava", "mod.method")` 的目标补全。 */
export function completeCallTargets(
  model: ProjectModel,
  prefix: string,
): CompletionCandidate[] {
  return completeQualifiedMethods(model, prefix);
}
