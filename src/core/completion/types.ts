export type CompletionKind =
  | "method"
  | "field"
  | "variable"
  | "module"
  | "page"
  | "event"
  | "class";

export interface CompletionCandidate {
  label: string;
  kind: CompletionKind;
  detail?: string;
  documentation?: string;
  insertText?: string;
  snippet?: boolean;
  /** 0 当前模块/当前类，1 加载集/父类，2 全局，9 内置 Object。 */
  sortGroup: number;
}
