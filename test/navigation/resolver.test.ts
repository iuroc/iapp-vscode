import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadProject } from "../../src/core/iapp/project.js";
import {
  resolveEntryCall,
  resolveMethod,
  resolveModule,
  resolvePage,
  resolveQualifiedMethod,
} from "../../src/core/navigation/resolver.js";

const root = path.resolve(__dirname, "../../../test/fixtures/projects/alpha");
const model = loadProject(root);

test("裸调用：本模块优先", () => {
  const result = resolveMethod(model, "home", "second", 0);
  assert.equal(result.source, "current");
  assert.deepEqual(
    result.targets.map((target) => `${target.module.name}.${target.method.name}`),
    ["home.second"],
  );
});

test("裸调用：经 i.fn 加载的模块", () => {
  const result = resolveMethod(model, "home", "ui_col", 0);
  assert.equal(result.source, "loaded");
  assert.deepEqual(
    result.targets.map((target) => target.module.name),
    ["ui"],
  );
});

test("裸调用：全局唯一", () => {
  const result = resolveMethod(model, "misc", "ui_col", 0);
  assert.equal(result.source, "global");
  assert.deepEqual(
    result.targets.map((target) => `${target.module.name}.${target.method.name}`),
    ["ui.ui_col"],
  );
});

test("裸调用：不同模块重名时返回全部候选", () => {
  const result = resolveMethod(model, "misc", "shared", 0);
  assert.equal(result.source, "global");
  assert.deepEqual(
    result.targets.map((target) => target.module.name).sort(),
    ["home", "ui"],
  );
});

test("裸调用：没有个数匹配时退回同名候选", () => {
  const result = resolveMethod(model, "home", "second", 5);
  assert.equal(result.source, "current");
  assert.equal(result.targets.length, 2);
});

test("参数个数筛选重载", () => {
  const result = resolveMethod(model, "home", "second", 1);
  assert.equal(result.source, "current");
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].method.params.length, 1);
});

test("显式 mod.method", () => {
  const result = resolveQualifiedMethod(model, "ui.ui_row", 0);
  assert.equal(result.source, "explicit");
  assert.deepEqual(
    result.targets.map((target) => `${target.module.name}.${target.method.name}`),
    ["ui.ui_row"],
  );
  assert.equal(resolveQualifiedMethod(model, "nope.method").targets.length, 0);
});

test("iyu 入口 call 解析", () => {
  const page = model.pages.get("mian");
  assert.ok(page);
  const call = page.parsed.events[0].calls[0];
  const result = resolveEntryCall(model, call);
  assert.equal(result.source, "entry");
  assert.deepEqual(
    result.targets.map((target) => `${target.module.name}.${target.method.name}`),
    ["home.first"],
  );
  assert.equal(result.targets[0].method.params.length, 0);
});

test("模块与页面路径解析", () => {
  assert.equal(resolveModule(model, "ui")?.name, "ui");
  assert.equal(resolveModule(model, '"ui"')?.name, "ui");
  assert.equal(resolvePage(model, "search.iyu")?.name, "search");
  assert.equal(resolvePage(model, "search")?.name, "search");
  assert.equal(resolvePage(model, "missing.iyu"), undefined);
});

test("无法消歧时返回 none", () => {
  const result = resolveMethod(model, "misc", "doesNotExist");
  assert.equal(result.source, "none");
  assert.equal(result.targets.length, 0);
});
