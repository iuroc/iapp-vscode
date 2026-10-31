import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export interface AndroidSourceItem {
  key: string;
  url: string;
  fileName: string;
  sizeHint: number;
}

/** 官方 Android 34 源码 + AndroidX/Material 源码 jar，合计约 48 MB。 */
export const ANDROID_SOURCES_ITEMS: readonly AndroidSourceItem[] = [
  {
    key: "android-framework",
    url: "https://dl.google.com/android/repository/sources-34_r01.zip",
    fileName: "sources-34_r01.zip",
    sizeHint: 45_502_712,
  },
  {
    key: "androidx-core",
    url: "https://dl.google.com/android/maven2/androidx/core/core/1.13.1/core-1.13.1-sources.jar",
    fileName: "androidx-core-1.13.1-sources.jar",
    sizeHint: 1_900_000,
  },
  {
    key: "material",
    url: "https://dl.google.com/android/maven2/com/google/android/material/material/1.12.0/material-1.12.0-sources.jar",
    fileName: "material-1.12.0-sources.jar",
    sizeHint: 1_600_000,
  },
];

export interface InstalledAndroidSources {
  androidSourceZip?: string;
  jars: string[];
}

export function installedAndroidSources(storageDir: string): InstalledAndroidSources {
  const result: InstalledAndroidSources = { jars: [] };
  for (const item of ANDROID_SOURCES_ITEMS) {
    const file = path.join(storageDir, item.fileName);
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
      continue;
    }
    if (item.fileName.endsWith(".zip")) {
      result.androidSourceZip ??= file;
    } else {
      result.jars.push(file);
    }
  }
  return result;
}

export type DownloadFunction = (
  url: string,
  destination: string,
  options: { signal?: AbortSignal; onProgress?: (received: number, total: number) => void },
) => Promise<void>;

export interface EnsureAndroidSourcesOptions {
  storageDir: string;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  download?: DownloadFunction;
}

export async function ensureAndroidSources(
  options: EnsureAndroidSourcesOptions,
): Promise<InstalledAndroidSources> {
  fs.mkdirSync(options.storageDir, { recursive: true });
  const totalHint = ANDROID_SOURCES_ITEMS.reduce((sum, item) => sum + item.sizeHint, 0);
  let completedHint = 0;
  const download = options.download ?? downloadToFile;

  for (const item of ANDROID_SOURCES_ITEMS) {
    if (options.signal?.aborted) {
      throw new Error("已取消下载");
    }
    const destination = path.join(options.storageDir, item.fileName);
    if (fs.existsSync(destination) && fs.statSync(destination).size > 0) {
      completedHint += item.sizeHint;
      options.onProgress?.(Math.round((completedHint / totalHint) * 100));
      continue;
    }
    await download(item.url, destination, {
      signal: options.signal,
      onProgress: (received, total) => {
        const size = total > 0 ? total : item.sizeHint;
        const percent = Math.round(((completedHint + Math.min(received, size)) / totalHint) * 100);
        options.onProgress?.(Math.min(percent, 100));
      },
    });
    if (!fs.existsSync(destination) || fs.statSync(destination).size === 0) {
      throw new Error(`下载结果为空: ${item.url}`);
    }
    completedHint += item.sizeHint;
  }
  options.onProgress?.(100);
  return installedAndroidSources(options.storageDir);
}

export async function downloadToFile(
  url: string,
  destination: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (received: number, total: number) => void;
  } = {},
  redirects = 5,
): Promise<void> {
  const partial = `${destination}.part`;
  fs.rmSync(partial, { force: true });
  await new Promise<void>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("已取消下载"));
      return;
    }
    const request = https.get(
      url,
      { family: 4, timeout: 60_000, headers: { "User-Agent": "iapp-vscode" } },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (redirects <= 0) {
            reject(new Error(`重定向过多: ${url}`));
            return;
          }
          downloadToFile(
            new URL(response.headers.location, url).toString(),
            destination,
            options,
            redirects - 1,
          ).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`下载失败 ${status}: ${url}`));
          return;
        }
        const total = Number(response.headers["content-length"]) || 0;
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          options.onProgress?.(received, total);
        });
        pipeline(response, fs.createWriteStream(partial))
          .then(() => {
            fs.renameSync(partial, destination);
            resolve();
          })
          .catch((error) => {
            fs.rmSync(partial, { force: true });
            reject(error);
          });
      },
    );
    request.on("timeout", () => request.destroy(new Error(`连接超时: ${url}`)));
    request.on("error", (error) => {
      fs.rmSync(partial, { force: true });
      reject(error);
    });
    options.signal?.addEventListener(
      "abort",
      () => request.destroy(new Error("已取消下载")),
      { once: true },
    );
  });
}
