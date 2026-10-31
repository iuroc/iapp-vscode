import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findAndroidSources, findJdkHome } from "../../src/core/java/source-discovery.js";

test("8.1 自动探测 JDK 与 Android 源码", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "iapp-discovery-"));
  try {
    const jdk = path.join(root, "jdk-25");
    fs.mkdirSync(path.join(jdk, "lib"), { recursive: true });
    fs.writeFileSync(path.join(jdk, "lib", "src.zip"), "fake");
    assert.equal(findJdkHome({ env: {}, roots: [root] }), jdk);
    assert.equal(findJdkHome({ env: { JAVA_HOME: jdk }, roots: [] }), jdk);

    const sdk = path.join(root, "sdk");
    fs.mkdirSync(path.join(sdk, "sources", "android-33", "android"), { recursive: true });
    fs.mkdirSync(path.join(sdk, "sources", "android-34", "android"), { recursive: true });
    assert.equal(
      findAndroidSources({ env: {}, sdkRoots: [sdk] }),
      path.join(sdk, "sources", "android-34"),
    );
    assert.equal(
      findAndroidSources({ env: { ANDROID_HOME: sdk } }),
      path.join(sdk, "sources", "android-34"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("8.1 找不到时返回 undefined", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "iapp-discovery-empty-"));
  try {
    assert.equal(findJdkHome({ env: {}, roots: [root] }), undefined);
    assert.equal(findAndroidSources({ env: {}, sdkRoots: [root] }), undefined);
    assert.equal(
      findJdkHome({ explicit: path.join(root, "missing"), env: {}, roots: [root] }),
      undefined,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
