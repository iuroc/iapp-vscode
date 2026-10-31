import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface JdkDiscoveryOptions {
  explicit?: string;
  env?: NodeJS.ProcessEnv;
  roots?: string[];
}

export interface AndroidDiscoveryOptions {
  explicit?: string;
  env?: NodeJS.ProcessEnv;
  sdkRoots?: string[];
}

export function jdkRootCandidates(options: JdkDiscoveryOptions = {}): string[] {
  const env = options.env ?? process.env;
  const roots = options.roots ?? defaultJdkRoots();
  const candidates: string[] = [];
  if (env.JAVA_HOME) {
    candidates.push(env.JAVA_HOME);
  }
  for (const root of roots) {
    candidates.push(root);
    candidates.push(...childDirectories(root));
  }
  return unique(candidates);
}

export function findJdkHome(options: JdkDiscoveryOptions = {}): string | undefined {
  if (options.explicit && isJdkHome(options.explicit)) {
    return options.explicit;
  }
  return jdkRootCandidates(options).find(isJdkHome);
}

export function isJdkHome(directory: string): boolean {
  return fs.existsSync(path.join(directory, "lib", "src.zip"));
}

export function findAndroidSources(
  options: AndroidDiscoveryOptions = {},
): string | undefined {
  if (options.explicit && fs.existsSync(options.explicit)) {
    return options.explicit;
  }
  const env = options.env ?? process.env;
  const roots = options.sdkRoots ?? defaultAndroidSdkRoots(env);
  for (const root of roots) {
    const sources = path.join(root, "sources");
    if (!fs.existsSync(sources)) {
      continue;
    }
    const versions = fs
      .readdirSync(sources, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^android-\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => versionOf(b) - versionOf(a));
    if (versions.length > 0) {
      return path.join(sources, versions[0]);
    }
  }
  return undefined;
}

function defaultJdkRoots(): string[] {
  switch (os.platform()) {
    case "win32":
      return [
        "C:\\Program Files\\Java",
        "C:\\Program Files\\Eclipse Adoptium",
        "C:\\Program Files\\Microsoft",
        "E:\\Dev Tools",
        "E:\\Program Files",
        "D:\\Dev Tools",
      ];
    case "darwin":
      return ["/Library/Java/JavaVirtualMachines", "/opt/homebrew/opt"];
    default:
      return ["/usr/lib/jvm", "/opt/java", "/opt"];
  }
}

function defaultAndroidSdkRoots(env: NodeJS.ProcessEnv): string[] {
  const roots = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT].filter(Boolean) as string[];
  if (env.LOCALAPPDATA) {
    roots.push(path.join(env.LOCALAPPDATA, "Android", "Sdk"));
  }
  if (os.platform() === "win32") {
    roots.push("C:\\Android\\Sdk", "D:\\Android\\Sdk", "E:\\Android\\Sdk");
  } else if (os.platform() === "darwin") {
    roots.push(path.join(os.homedir(), "Library", "Android", "sdk"));
  } else {
    roots.push(path.join(os.homedir(), "Android", "Sdk"));
  }
  return unique(roots);
}

function childDirectories(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function versionOf(name: string): number {
  return Number.parseInt(name.slice("android-".length), 10) || 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
