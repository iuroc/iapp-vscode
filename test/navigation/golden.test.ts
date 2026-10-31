import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadProject } from "../../src/core/iapp/project.js";
import { iyuCallAt, mjavaSymbolAt } from "../../src/core/navigation/locate.js";
import {
  resolveEntryCall,
  resolveMethod,
  resolveModule,
  resolvePage,
} from "../../src/core/navigation/resolver.js";

const root = path.resolve(__dirname, "../../../test/fixtures/projects/alpha");
const model = loadProject(root);
const home = model.modules.get("home");
assert.ok(home);

test("金样：home 内 ui_col() 跳到 ui.ui_col", () => {
  const call = home.parsed.calls.find((item) => item.name === "ui_col");
  assert.ok(call);
  const symbol = mjavaSymbolAt(home.parsed, call.nameRange.start);
  assert.equal(symbol?.kind, "call");
  const result = resolveMethod(model, "home", call.name, call.args.length);
  const target = result.targets[0];
  assert.ok(target);
  assert.equal(path.basename(target.module.filePath), "ui.mjava");
  assert.equal(target.method.nameRange.start.line, 0);
});

test("金样：i.fn(\"ui\") 跳到 ui.mjava", () => {
  const call = home.parsed.calls.find((item) => item.qualifier === "i" && item.name === "fn");
  assert.ok(call);
  const symbol = mjavaSymbolAt(home.parsed, call.args[0].range.start);
  assert.equal(symbol?.kind, "call");
  const module = resolveModule(model, call.args[0].value ?? "");
  assert.ok(module);
  assert.equal(path.basename(module.filePath), "ui.mjava");
});

test("金样：i.uigo(\"search.iyu\") 跳到 search.iyu", () => {
  const call = home.parsed.calls.find((item) => item.name === "uigo");
  assert.ok(call);
  const page = resolvePage(model, call.args[0].value ?? "");
  assert.ok(page);
  assert.equal(path.basename(page.filePath), "search.iyu");
});

test("金样：mian.iyu 的 home.first 跳到 home.mjava 第 1 行", () => {
  const page = model.pages.get("mian");
  assert.ok(page);
  const call = page.parsed.events[0].calls[0];
  const located = iyuCallAt(page.parsed, call.args[2].range.start);
  assert.equal(located, call);
  const result = resolveEntryCall(model, call);
  const target = result.targets[0];
  assert.ok(target);
  assert.equal(path.basename(target.module.filePath), "home.mjava");
  assert.equal(target.method.nameRange.start.line, 0);
});

test("金样：home.first 内的 second() 跳到 home.second 声明行", () => {
  const call = home.parsed.calls.find(
    (item) => item.name === "second" && item.qualifier === undefined,
  );
  assert.ok(call);
  const result = resolveMethod(model, "home", call.name, call.args.length);
  const target = result.targets[0];
  assert.ok(target);
  assert.equal(target.method.nameRange.start.line, 7);
});
