import fs from "node:fs";
import path from "node:path";
import { IyuPage, IyuCall, parseIyu } from "../iyu/iyu-parser.js";
import { MjavaFile, parseMjava } from "../java/mjava-parser.js";
import { SourceRange } from "../model/source.js";
import { IappManifest, emptyManifest, isIappManifest, parseManifest } from "./manifest.js";

export interface ProjectModule {
  name: string;
  filePath: string;
  parsed: MjavaFile;
}

export interface ProjectPage {
  name: string;
  filePath: string;
  parsed: IyuPage;
}

export interface ModuleLoadEdge {
  fromModule: string;
  toModule: string;
  range: SourceRange;
}

export interface EntryTarget {
  module: string;
  method: string;
}

export interface EntryEdge {
  page: string;
  eventType: string;
  call: IyuCall;
  target: EntryTarget | null;
}

export interface ProjectModel {
  root: string;
  manifest: IappManifest;
  modules: Map<string, ProjectModule>;
  pages: Map<string, ProjectPage>;
  loadEdges: ModuleLoadEdge[];
  entryEdges: EntryEdge[];
}

/** 目录含 iApp manifest（根 `<iapp>`）或 `src/mian.iyu` 即视为工程根。 */
export function isIappProject(root: string): boolean {
  const manifestPath = path.join(root, "AndroidManifest.xml");
  if (fs.existsSync(manifestPath)) {
    try {
      if (isIappManifest(fs.readFileSync(manifestPath, "utf8"))) {
        return true;
      }
    } catch {
      // 读不到 manifest 时继续看入口页。
    }
  }
  return fs.existsSync(path.join(root, "src", "mian.iyu"));
}

/** 从任意文件/目录向上找最近的 iApp 工程根。 */
export function findProjectRoot(start: string): string | null {
  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth++) {
    if (isIappProject(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

export function loadProject(root: string): ProjectModel {
  const manifest = readManifest(path.join(root, "AndroidManifest.xml"));

  const modules = new Map<string, ProjectModule>();
  const pages = new Map<string, ProjectPage>();
  const srcDir = path.join(root, "src");
  if (fs.existsSync(srcDir)) {
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.join(srcDir, entry.name);
      if (entry.name.endsWith(".mjava")) {
        const name = entry.name.slice(0, -".mjava".length);
        const text = fs.readFileSync(filePath, "utf8");
        modules.set(name, { name, filePath, parsed: parseMjava(name, text) });
      } else if (entry.name.endsWith(".iyu")) {
        const name = entry.name.slice(0, -".iyu".length);
        const text = fs.readFileSync(filePath, "utf8");
        pages.set(name, { name, filePath, parsed: parseIyu(name, text) });
      }
    }
  }

  const model: ProjectModel = {
    root,
    manifest,
    modules,
    pages,
    loadEdges: [],
    entryEdges: [],
  };
  rebuildEdges(model);
  return model;
}

/**
 * 单个文件保存/新增/删除后的增量更新；返回同一个模型对象，供缓存方继续引用。
 * 工程清单（新增或删除模块）也走这里。
 */
export function updateProjectFile(model: ProjectModel, filePath: string): ProjectModel {
  const srcDir = path.join(model.root, "src");
  const relative = path.relative(srcDir, filePath);

  if (path.basename(filePath) === "AndroidManifest.xml" && path.dirname(filePath) === model.root) {
    model.manifest = readManifest(filePath);
  } else if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    const isMjava = filePath.endsWith(".mjava");
    const isIyu = filePath.endsWith(".iyu");
    if (isMjava || isIyu) {
      const name = path.basename(filePath, path.extname(filePath));
      if (!fs.existsSync(filePath)) {
        (isMjava ? model.modules : model.pages).delete(name);
      } else {
        const text = fs.readFileSync(filePath, "utf8");
        if (isMjava) {
          model.modules.set(name, { name, filePath, parsed: parseMjava(name, text) });
        } else {
          model.pages.set(name, { name, filePath, parsed: parseIyu(name, text) });
        }
      }
    }
  }

  rebuildEdges(model);
  return model;
}

function readManifest(manifestPath: string): IappManifest {
  if (!fs.existsSync(manifestPath)) {
    return emptyManifest();
  }
  try {
    return parseManifest(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return emptyManifest();
  }
}

function rebuildEdges(model: ProjectModel): void {
  model.loadEdges = [];
  for (const module of model.modules.values()) {
    model.loadEdges.push(...findLoadEdges(module));
  }
  model.entryEdges = [];
  for (const page of model.pages.values()) {
    for (const event of page.parsed.events) {
      for (const call of event.calls) {
        model.entryEdges.push({
          page: page.name,
          eventType: event.type,
          call,
          target: entryTarget(call),
        });
      }
    }
  }
}

const FN_PATTERN = /\bi\s*\.\s*fn\s*\(\s*"([^"]+)"\s*\)/g;

function findLoadEdges(module: ProjectModule): ModuleLoadEdge[] {
  const edges: ModuleLoadEdge[] = [];
  FN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FN_PATTERN.exec(module.parsed.text))) {
    edges.push({
      fromModule: module.name,
      toModule: match[1],
      range: {
        start: positionOf(module.parsed.text, match.index),
        end: positionOf(module.parsed.text, match.index + match[0].length),
      },
    });
  }
  return edges;
}

function entryTarget(call: IyuCall): EntryTarget | null {
  if (call.name !== "call" || call.args.length < 3) {
    return null;
  }
  if (call.args[1].value !== "mjava") {
    return null;
  }
  const qualified = call.args[2].value;
  if (!qualified) {
    return null;
  }
  const dot = qualified.indexOf(".");
  if (dot <= 0 || dot === qualified.length - 1) {
    return null;
  }
  return { module: qualified.slice(0, dot), method: qualified.slice(dot + 1) };
}

function positionOf(text: string, offset: number): SourceRange["start"] {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}
