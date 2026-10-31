import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadProject } from "../../src/core/iapp/project.js";
import { buildProjectTree } from "../../src/core/navigation/tree.js";

const alphaRoot = path.resolve(__dirname, "../../../test/fixtures/projects/alpha");

test("7.1 树模型：工程 -> 模块/页面 -> 方法/入口", () => {
  const tree = buildProjectTree(loadProject(alphaRoot));
  assert.equal(tree.kind, "project");
  assert.equal(tree.label, "com.fixture.alpha");
  const modules = tree.children?.filter((node) => node.kind === "module") ?? [];
  const pages = tree.children?.filter((node) => node.kind === "page") ?? [];
  assert.deepEqual(
    modules.map((node) => node.label),
    ["home", "misc", "ui"],
  );
  assert.deepEqual(
    pages.map((node) => node.label),
    ["mian", "search"],
  );

  const home = modules.find((node) => node.label === "home");
  assert.ok(home);
  assert.deepEqual(
    home.children?.map((node) => node.label),
    ["first", "second", "second", "shared"],
  );
  assert.equal(home.children?.[0].filePath, home.filePath);
});

test("7.2 树节点带跳转位置", () => {
  const tree = buildProjectTree(loadProject(alphaRoot));
  const page = tree.children?.find((node) => node.label === "mian");
  assert.ok(page);
  const call = page.children?.[0].children?.[0];
  assert.ok(call);
  assert.equal(call.label, "home.first");
  assert.equal(path.basename(call.filePath ?? ""), "home.mjava");
  assert.equal(call.range?.start.line, 0);
});

