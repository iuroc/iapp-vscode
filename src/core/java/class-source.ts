import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";

export type ClassSourceKind = "zip" | "dir" | "memory";

export interface ClassSourceLocation {
  kind: ClassSourceKind;
  /** zip 文件或源码目录的绝对路径。 */
  root: string;
  /** zip 内的 entry 名，或相对源码目录的路径。 */
  path: string;
}

/** FQCN -> 源码位置。只建立类级映射，成员等按需解析。 */
export class ClassSourceIndex {
  private readonly locations = new Map<string, ClassSourceLocation>();

  add(kind: ClassSourceKind, root: string, entryPath: string): void {
    const fqcn = entryPathToFqcn(entryPath);
    if (fqcn && !this.locations.has(fqcn)) {
      this.locations.set(fqcn, { kind, root, path: entryPath });
    }
  }

  resolve(fqcn: string): ClassSourceLocation | undefined {
    return this.locations.get(fqcn);
  }

  get size(): number {
    return this.locations.size;
  }

  entries(): IterableIterator<[string, ClassSourceLocation]> {
    return this.locations.entries();
  }
}

const MODULE_PREFIX = /^(?:java|jdk|javafx)(?:\.[\w-]+)+\//;
/** Android SDK sources 压缩包可能带 `sources/android-34/` 或 `src/` 前缀。 */
const SDK_PREFIX =
  /^(?:src\/)?(?:sources\/)?android-\d+\/|^src\/(?=(?:android|androidx|com|java|javax|org)\/)/;

/**
 * 把源码文件路径规范化为 FQCN。
 *
 * - JDK：`java.base/java/util/ArrayList.java` -> `java.util.ArrayList`
 * - Android / AndroidX：按普通包路径映射
 * - 跳过 `module-info.java`、`package-info.java` 与 `META-INF/`
 */
export function entryPathToFqcn(entryPath: string): string | null {
  const normalized = entryPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized.endsWith(".java")) {
    return null;
  }
  if (/(^|\/)(module-info|package-info)\.java$/.test(normalized)) {
    return null;
  }
  if (normalized.startsWith("META-INF/")) {
    return null;
  }
  const stripped = normalized.replace(MODULE_PREFIX, "").replace(SDK_PREFIX, "");
  const withoutExtension = stripped.slice(0, -".java".length);
  return withoutExtension.split("/").join(".");
}

export async function listZipEntries(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error(`无法打开 zip: ${zipPath}`));
        return;
      }
      const entries: string[] = [];
      zip.on("entry", (entry) => {
        if (!entry.fileName.endsWith("/")) {
          entries.push(entry.fileName);
        }
        zip.readEntry();
      });
      zip.on("end", () => resolve(entries));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

export function listJavaFiles(root: string): string[] {
  const results: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".java")) {
        results.push(path.relative(root, fullPath).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return results;
}

export async function classIndexFromZip(zipPath: string): Promise<ClassSourceIndex> {
  const index = new ClassSourceIndex();
  for (const entry of await listZipEntries(zipPath)) {
    index.add("zip", zipPath, entry);
  }
  return index;
}

export function classIndexFromDirectory(root: string): ClassSourceIndex {
  const index = new ClassSourceIndex();
  for (const entry of listJavaFiles(root)) {
    index.add("dir", root, entry);
  }
  return index;
}
