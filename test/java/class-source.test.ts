import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  classIndexFromDirectory,
  classIndexFromZip,
  entryPathToFqcn,
} from "../../src/core/java/class-source.js";

test("JDK 模块前缀被剥离", () => {
  assert.equal(entryPathToFqcn("java.base/java/util/ArrayList.java"), "java.util.ArrayList");
  assert.equal(entryPathToFqcn("java.desktop/java/awt/Frame.java"), "java.awt.Frame");
  assert.equal(entryPathToFqcn("jdk.compiler/com/sun/tools/javac/Main.java"), "com.sun.tools.javac.Main");
});

test("Android 与 AndroidX 按包路径映射", () => {
  assert.equal(entryPathToFqcn("android/widget/TextView.java"), "android.widget.TextView");
  assert.equal(
    entryPathToFqcn("sources/android-34/android/widget/TextView.java"),
    "android.widget.TextView",
  );
  assert.equal(
    entryPathToFqcn("android-34/android/view/View.java"),
    "android.view.View",
  );
  assert.equal(
    entryPathToFqcn("src/android/widget/TextView.java"),
    "android.widget.TextView",
  );
  assert.equal(
    entryPathToFqcn("androidx/core/app/ActivityCompat.java"),
    "androidx.core.app.ActivityCompat",
  );
});

test("跳过 module-info、package-info 与 META-INF", () => {
  assert.equal(entryPathToFqcn("java.base/module-info.java"), null);
  assert.equal(entryPathToFqcn("android/widget/package-info.java"), null);
  assert.equal(entryPathToFqcn("META-INF/LICENSE.java"), null);
  assert.equal(entryPathToFqcn("android/widget/TextView.kt"), null);
});

test("夹具 Android 源码目录能解析 TextView", () => {
  const root = path.resolve(__dirname, "../../../test/fixtures/android-sources");
  const index = classIndexFromDirectory(root);
  const location = index.resolve("android.widget.TextView");
  assert.ok(location);
  assert.equal(location.kind, "dir");
  assert.equal(location.path, "android/widget/TextView.java");
  assert.ok(index.resolve("android.view.View"));
});

const jdkHome = process.env.IAPP_JDK_HOME;
const jdkZip = jdkHome ? path.join(jdkHome, "lib", "src.zip") : "";

test(
  "JDK src.zip 能解析 ArrayList 与 String",
  { skip: !jdkZip || !fs.existsSync(jdkZip) },
  async () => {
    const index = await classIndexFromZip(jdkZip);
    assert.ok(index.size > 10_000, `JDK 类数偏少: ${index.size}`);
    const arrayList = index.resolve("java.util.ArrayList");
    assert.ok(arrayList);
    assert.equal(arrayList.kind, "zip");
    assert.equal(arrayList.path, "java.base/java/util/ArrayList.java");
    assert.ok(index.resolve("java.lang.String"));
    assert.equal(index.resolve("base.java.util.ArrayList"), undefined);
  },
);
