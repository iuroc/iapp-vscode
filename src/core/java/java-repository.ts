import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";
import {
  ClassSourceIndex,
  ClassSourceLocation,
  classIndexFromDirectory,
  classIndexFromZip,
} from "./class-source.js";
import {
  JavaClassInfo,
  JavaFileInfo,
  findClassByFqcn,
  parseJavaFile,
} from "./java-class-parser.js";

interface ZipHandle {
  zip: yauzl.ZipFile;
  entries: Map<string, yauzl.Entry>;
}

export interface JavaSourceConfig {
  jdkHome?: string;
  androidSources?: string;
  extraSourceJars?: string[];
}

export interface JavaClassContext {
  file: JavaFileInfo;
  class: JavaClassInfo;
}

export class JavaSourceRepository {
  private readonly indexes: ClassSourceIndex[] = [];
  private readonly memory = new Map<string, JavaFileInfo>();
  private readonly zipHandles = new Map<string, Promise<ZipHandle>>();
  private readonly fileCache = new Map<string, Promise<JavaFileInfo | undefined>>();
  private readonly classCache = new Map<string, Promise<JavaClassContext | undefined>>();

  static async create(config: JavaSourceConfig): Promise<JavaSourceRepository> {
    const repository = new JavaSourceRepository();
    const srcZip = config.jdkHome ? path.join(config.jdkHome, "lib", "src.zip") : undefined;
    if (srcZip && fs.existsSync(srcZip)) {
      await repository.addZipSource(srcZip);
    }
    if (config.androidSources && fs.existsSync(config.androidSources)) {
      const stats = fs.statSync(config.androidSources);
      if (stats.isDirectory()) {
        repository.addDirectorySource(config.androidSources);
      } else if (config.androidSources.endsWith(".zip")) {
        await repository.addZipSource(config.androidSources);
      }
    }
    for (const jar of config.extraSourceJars ?? []) {
      if (fs.existsSync(jar)) {
        await repository.addZipSource(jar);
      }
    }
    return repository;
  }

  async addZipSource(zipPath: string): Promise<void> {
    this.indexes.push(await classIndexFromZip(zipPath));
  }

  addDirectorySource(directory: string): void {
    this.indexes.push(classIndexFromDirectory(directory));
  }

  /** 内置 stub（例如 iApp 的 `Aid_javaCode`）不落盘，直接参与索引。 */
  addMemorySource(fqcn: string, text: string): void {
    const file = parseJavaFile(fqcn, text);
    file.source = { kind: "memory", root: "", path: fqcn };
    this.memory.set(fqcn, file);
  }

  get sourceCount(): number {
    return this.indexes.length;
  }

  get classCount(): number {
    return this.indexes.reduce((count, index) => count + index.size, 0);
  }

  resolveClassLocation(fqcn: string): ClassSourceLocation | undefined {
    if (this.memory.has(fqcn)) {
      return { kind: "memory", root: "", path: fqcn };
    }
    for (const index of this.indexes) {
      const found = index.resolve(fqcn);
      if (found) {
        return found;
      }
    }
    // `Map.Entry` 这类嵌套类落在外部类的文件里。
    const dot = fqcn.lastIndexOf(".");
    if (dot > 0) {
      return this.resolveClassLocation(fqcn.slice(0, dot));
    }
    return undefined;
  }

  async getFile(location: ClassSourceLocation): Promise<JavaFileInfo | undefined> {
    const key = `${location.root}:${location.path}`;
    const cached = this.fileCache.get(key);
    if (cached) {
      return cached;
    }
    const pending = this.readFile(location);
    this.fileCache.set(key, pending);
    return pending;
  }

  async getClassContext(fqcn: string): Promise<JavaClassContext | undefined> {
    const cached = this.classCache.get(fqcn);
    if (cached) {
      return cached;
    }
    const pending = this.loadClassContext(fqcn);
    this.classCache.set(fqcn, pending);
    return pending;
  }

  dispose(): void {
    for (const pending of this.zipHandles.values()) {
      pending.then((handle) => handle.zip.close()).catch(() => undefined);
    }
    this.zipHandles.clear();
  }

  private async loadClassContext(fqcn: string): Promise<JavaClassContext | undefined> {
    const location = this.resolveClassLocation(fqcn);
    if (!location) {
      return undefined;
    }
    const file = await this.getFile(location);
    if (!file) {
      return undefined;
    }
    const cls = findClassByFqcn(file, fqcn) ?? file.classes[0];
    return cls ? { file, class: cls } : undefined;
  }

  private async readFile(location: ClassSourceLocation): Promise<JavaFileInfo | undefined> {
    if (location.kind === "memory") {
      return this.memory.get(location.path);
    }
    if (location.kind === "dir") {
      const fullPath = path.join(location.root, location.path);
      try {
        const file = parseJavaFile(fullPath, fs.readFileSync(fullPath, "utf8"));
        file.source = location;
        return file;
      } catch {
        return undefined;
      }
    }
    const text = await this.readZipEntry(location.root, location.path);
    if (text === undefined) {
      return undefined;
    }
    const file = parseJavaFile(location.path, text);
    file.source = location;
    return file;
  }

  private async readZipEntry(zipPath: string, entryPath: string): Promise<string | undefined> {
    const handle = await this.openZip(zipPath);
    const entry = handle.entries.get(entryPath);
    if (!entry) {
      return undefined;
    }
    return new Promise((resolve, reject) => {
      handle.zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          reject(error);
          return;
        }
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        stream.on("error", reject);
      });
    });
  }

  private openZip(zipPath: string): Promise<ZipHandle> {
    const cached = this.zipHandles.get(zipPath);
    if (cached) {
      return cached;
    }
    const pending = new Promise<ZipHandle>((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (error, zip) => {
        if (error || !zip) {
          reject(error ?? new Error(`无法打开 zip: ${zipPath}`));
          return;
        }
        const entries = new Map<string, yauzl.Entry>();
        zip.on("entry", (entry) => {
          if (!entry.fileName.endsWith("/")) {
            entries.set(entry.fileName, entry);
          }
          zip.readEntry();
        });
        zip.on("end", () => resolve({ zip, entries }));
        zip.on("error", reject);
        zip.readEntry();
      });
    });
    this.zipHandles.set(zipPath, pending);
    return pending;
  }
}
