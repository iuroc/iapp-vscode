import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isIappManifest, parseManifest } from "../../src/core/iapp/manifest.js";
import { isIappProject, loadProject, updateProjectFile } from "../../src/core/iapp/project.js";

const fixtures = path.resolve(__dirname, "../../../test/fixtures/projects");
const alphaRoot = path.join(fixtures, "alpha");
const betaRoot = path.join(fixtures, "beta");

test("工程识别：iApp manifest 与 src/mian.iyu", () => {
  assert.equal(isIappProject(alphaRoot), true);
  assert.equal(isIappProject(betaRoot), true);
  assert.equal(isIappProject(fixtures), false);
});

test("非 iApp manifest 不被识别", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iapp-detect-"));
  try {
    fs.writeFileSync(
      path.join(dir, "AndroidManifest.xml"),
      '<?xml version="1.0"?><manifest package="x"></manifest>',
    );
    assert.equal(isIappProject(dir), false);
    assert.equal(isIappManifest(fs.readFileSync(path.join(dir, "AndroidManifest.xml"), "utf8")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("清单字段解析", () => {
  const manifest = parseManifest(
    fs.readFileSync(path.join(alphaRoot, "AndroidManifest.xml"), "utf8"),
  );
  assert.deepEqual(manifest, {
    packageName: "com.fixture.alpha",
    title: "Alpha",
    versionName: "1.2",
    versionCode: 3,
    sdk: 34,
    permissions: ["android.permission.INTERNET", "android.permission.CAMERA"],
  });
});

test("ProjectModel：模块、页面、加载边、入口边", () => {
  const model = loadProject(alphaRoot);
  assert.deepEqual([...model.modules.keys()].sort(), ["home", "misc", "ui"]);
  assert.deepEqual([...model.pages.keys()].sort(), ["mian", "search"]);
  assert.equal(model.manifest.packageName, "com.fixture.alpha");
  assert.deepEqual(
    model.loadEdges.map((edge) => `${edge.fromModule}->${edge.toModule}`),
    ["home->ui"],
  );
  assert.equal(model.entryEdges.length, 1);
  assert.deepEqual(model.entryEdges[0].target, { module: "home", method: "first" });
});

test("工程隔离：同名 ui.mjava 各自独立", () => {
  const alpha = loadProject(alphaRoot);
  const beta = loadProject(betaRoot);
  assert.notEqual(alpha.root, beta.root);
  assert.notEqual(alpha.modules.get("ui")?.filePath, beta.modules.get("ui")?.filePath);
  assert.match(alpha.modules.get("ui")?.filePath ?? "", /alpha/);
  assert.match(beta.modules.get("ui")?.filePath ?? "", /beta/);
});

test("文件增删改后模型增量更新", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iapp-update-"));
  try {
    fs.cpSync(alphaRoot, dir, { recursive: true });
    const model = loadProject(dir);

    const homePath = path.join(dir, "src", "home.mjava");
    fs.writeFileSync(homePath, "public void first() {\n}\n\npublic void third() {\n}\n");
    updateProjectFile(model, homePath);
    assert.deepEqual(
      model.modules.get("home")?.parsed.methods.map((method) => method.name),
      ["first", "third"],
    );

    const extraPath = path.join(dir, "src", "extra.mjava");
    fs.writeFileSync(extraPath, 'public void extra() {\n\ti.fn("ui");\n}\n');
    updateProjectFile(model, extraPath);
    assert.ok(model.modules.has("extra"));
    assert.ok(
      model.loadEdges.some((edge) => edge.fromModule === "extra" && edge.toModule === "ui"),
    );

    fs.rmSync(extraPath);
    updateProjectFile(model, extraPath);
    assert.equal(model.modules.has("extra"), false);

    const pagePath = path.join(dir, "src", "mian.iyu");
    const pageText = fs
      .readFileSync(pagePath, "utf8")
      .replace('"home.first"', '"home.third"');
    fs.writeFileSync(pagePath, pageText);
    updateProjectFile(model, pagePath);
    assert.deepEqual(model.entryEdges[0].target, { module: "home", method: "third" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

