import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadProject } from "../../src/core/iapp/project.js";
import { IAPP_STUB_FQCN, IAPP_STUB_SOURCE } from "../../src/core/java/iapp-stubs.js";
import { JavaSourceRepository } from "../../src/core/java/java-repository.js";
import { JavaTypeResolver } from "../../src/core/java/java-resolver.js";
import { MjavaTypeInference } from "../../src/core/java/type-inference.js";
import {
  findJavaMemberReferences,
  findMethodReferences,
} from "../../src/core/navigation/references.js";

const fixtures = path.resolve(__dirname, "../../../test/fixtures/projects");
const alphaRoot = path.join(fixtures, "alpha");
const androidRoot = path.resolve(__dirname, "../../../test/fixtures/android-sources");

function lineOf(reference: { filePath: string; range: { start: { line: number } } }): string {
  return `${path.basename(reference.filePath)}:${reference.range.start.line}`;
}

test("查找引用：声明、裸调用、i.call、iyu 入口", () => {
  const model = loadProject(alphaRoot);
  const home = model.modules.get("home");
  assert.ok(home);
  const first = home.parsed.methods.find((method) => method.name === "first");
  assert.ok(first);

  const withDeclaration = findMethodReferences(model, "home", first, true).map(lineOf);
  assert.deepEqual(withDeclaration.sort(), ["home.mjava:0", "mian.iyu:6", "misc.mjava:1"]);

  const withoutDeclaration = findMethodReferences(model, "home", first, false).map(lineOf);
  assert.deepEqual(withoutDeclaration.sort(), ["mian.iyu:6", "misc.mjava:1"]);
});

test("查找引用：加载集里的裸调用", () => {
  const model = loadProject(alphaRoot);
  const ui = model.modules.get("ui");
  assert.ok(ui);
  const col = ui.parsed.methods.find((method) => method.name === "ui_col");
  assert.ok(col);
  assert.deepEqual(
    findMethodReferences(model, "ui", col, true).map(lineOf).sort(),
    ["home.mjava:8", "ui.mjava:0"],
  );
});

test("查找引用：i.call 显式目标", () => {
  const model = loadProject(alphaRoot);
  const ui = model.modules.get("ui");
  assert.ok(ui);
  const row = ui.parsed.methods.find((method) => method.name === "ui_row");
  assert.ok(row);
  assert.deepEqual(
    findMethodReferences(model, "ui", row, true).map(lineOf).sort(),
    ["home.mjava:3", "ui.mjava:3"],
  );
});

test("查找引用：Java 成员在 mjava 里的调用点", async () => {
  const model = loadProject(path.join(fixtures, "java-usage"));
  const repository = await JavaSourceRepository.create({ androidSources: androidRoot });
  repository.addMemorySource(IAPP_STUB_FQCN, IAPP_STUB_SOURCE);
  const resolver = new JavaTypeResolver(repository);
  const inference = new MjavaTypeInference(repository, resolver);

  const setText = await findJavaMemberReferences(model, resolver, inference, {
    fqcn: "android.widget.TextView",
    name: "setText",
    paramCount: 1,
  });
  assert.deepEqual(setText.map(lineOf).sort(), ["usage.mjava:3", "usage.mjava:4"]);

  const getId = await findJavaMemberReferences(model, resolver, inference, {
    fqcn: "android.view.View",
    name: "getId",
    paramCount: 0,
  });
  assert.deepEqual(getId.map(lineOf), ["usage.mjava:5"]);
  repository.dispose();
});
