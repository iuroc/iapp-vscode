import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ANDROID_SOURCES_ITEMS,
  ensureAndroidSources,
  installedAndroidSources,
} from "../../src/core/java/android-sources.js";

test("8.2 mock 下载：落盘、进度、缓存复用", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "iapp-sources-"));
  const storageDir = path.join(root, "cache");
  const calls: string[] = [];
  const percentages: number[] = [];
  try {
    const first = await ensureAndroidSources({
      storageDir,
      onProgress: (percent) => percentages.push(percent),
      download: async (url, destination, options) => {
        calls.push(url);
        fs.writeFileSync(destination, Buffer.alloc(16, 1));
        options.onProgress?.(8, 16);
      },
    });
    assert.equal(calls.length, ANDROID_SOURCES_ITEMS.length);
    assert.ok(first.androidSourceZip?.endsWith("sources-34_r01.zip"));
    assert.equal(first.jars.length, 2);
    assert.equal(percentages.at(-1), 100);

    const secondCalls: string[] = [];
    const second = await ensureAndroidSources({
      storageDir,
      download: async (url, destination) => {
        secondCalls.push(url);
        fs.writeFileSync(destination, "x");
      },
    });
    assert.equal(secondCalls.length, 0);
    assert.deepEqual(second, first);
    assert.deepEqual(installedAndroidSources(storageDir), first);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("8.2 取消下载", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "iapp-sources-cancel-"));
  try {
    await assert.rejects(
      ensureAndroidSources({
        storageDir: path.join(root, "cache"),
        signal: AbortSignal.abort(),
        download: async () => undefined,
      }),
      /取消/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
