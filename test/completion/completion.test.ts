import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { lexicalContextAt } from "../../src/core/completion/lexical.js";
import {
  completeIMembers,
  completeJavaMembers,
  completeMethods,
  completeModules,
  completePages,
  completeQualifiedMethods,
} from "../../src/core/completion/mjava-completion.js";
import { completeCallTargets, completeEventTypes } from "../../src/core/completion/iyu-completion.js";
import { extractMemberAccess } from "../../src/core/completion/receiver.js";
import { parseMjava } from "../../src/core/java/mjava-parser.js";
import { emptyManifest } from "../../src/core/iapp/manifest.js";
import { loadProject } from "../../src/core/iapp/project.js";
import { IAPP_STUB_FQCN, IAPP_STUB_SOURCE } from "../../src/core/java/iapp-stubs.js";
import { JavaSourceRepository } from "../../src/core/java/java-repository.js";
import { JavaTypeResolver } from "../../src/core/java/java-resolver.js";
import { MjavaTypeInference } from "../../src/core/java/type-inference.js";

const fixtures = path.resolve(__dirname, "../../../test/fixtures/projects");
const androidRoot = path.resolve(__dirname, "../../../test/fixtures/android-sources");
const alpha = loadProject(path.join(fixtures, "alpha"));

test("接收者提取", () => {
  assert.deepEqual(extractMemberAccess("tv."), { receiver: "tv", prefix: "" });
  assert.deepEqual(extractMemberAccess("  tv.se"), { receiver: "tv", prefix: "se" });
  assert.deepEqual(extractMemberAccess("activity.getResources()."), {
    receiver: "activity.getResources()",
    prefix: "",
  });
  assert.deepEqual(extractMemberAccess("new TextView(activity)."), {
    receiver: "new TextView(activity)",
    prefix: "",
  });
  assert.deepEqual(extractMemberAccess("(TextView) v."), {
    receiver: "(TextView) v",
    prefix: "",
  });
  assert.equal(extractMemberAccess("plainName"), undefined);
  assert.equal(extractMemberAccess("a + b"), undefined);
});

test("词法上下文：字符串与注释", () => {
  assert.equal(lexicalContextAt('call("ui', 9), "string");
  assert.equal(lexicalContextAt("// tv.", 6), "lineComment");
  assert.equal(lexicalContextAt("/* tv.", 7), "blockComment");
  assert.equal(lexicalContextAt("tv.", 3), "code");
});

test("mjava 方法补全：本模块、加载集、全局排序", () => {
  const all = completeMethods(alpha, "home", "");
  const labels = all.map((candidate) => candidate.label);
  assert.ok(labels.includes("first"));
  assert.ok(labels.includes("ui_col"));
  assert.ok(labels.includes("runAll"));

  const first = all.find((candidate) => candidate.label === "first");
  assert.equal(first?.sortGroup, 0);
  const uiCol = all.find((candidate) => candidate.label === "ui_col");
  assert.equal(uiCol?.sortGroup, 1);
  const runAll = all.find((candidate) => candidate.label === "runAll");
  assert.equal(runAll?.sortGroup, 2);

  const filtered = completeMethods(alpha, "home", "ui_");
  assert.deepEqual(
    filtered.map((candidate) => candidate.label),
    ["ui_col", "ui_row"],
  );
  assert.equal(filtered[0].insertText, "ui_col()");
});

test("mjava 方法补全的说明带声明注释", () => {
  const parsed = parseMjava(
    "doc",
    "// 模块说明：数学工具。\n\n/** 计算总和。 */\npublic int sum(int a, int b) {\n\treturn a + b;\n}\n",
  );
  const model = {
    root: "",
    manifest: emptyManifest(),
    modules: new Map([
      ["doc", { name: "doc", filePath: "doc.mjava", parsed }],
    ]),
    pages: new Map(),
    loadEdges: [],
    entryEdges: [],
  };
  const candidates = completeMethods(model, "doc", "sum");
  assert.equal(candidates.length, 1);
  assert.match(candidates[0].documentation ?? "", /计算总和/);
  assert.match(candidates[0].documentation ?? "", /模块 doc/);

  const modules = completeModules(model, "doc");
  assert.match(modules[0].documentation ?? "", /模块说明：数学工具/);
});

test("模块、页面与限定方法补全", () => {
  assert.deepEqual(
    completeModules(alpha, "u").map((candidate) => candidate.label),
    ["ui"],
  );
  assert.deepEqual(
    completePages(alpha, "sea").map((candidate) => candidate.label),
    ["search.iyu"],
  );
  assert.deepEqual(
    completeQualifiedMethods(alpha, "ui.ui_").map((candidate) => candidate.label).sort(),
    ["ui.ui_col", "ui.ui_row"],
  );
  assert.equal(completeQualifiedMethods(alpha, "").length, 8);
});

test("i 对象成员补全来自 Aid_javaCode stub", async () => {
  const repository = await JavaSourceRepository.create({ androidSources: androidRoot });
  repository.addMemorySource(IAPP_STUB_FQCN, IAPP_STUB_SOURCE);
  const resolver = new JavaTypeResolver(repository);
  const members = await completeIMembers(repository, resolver, "");
  const labels = members.map((candidate) => candidate.label);
  assert.ok(labels.includes("fn"));
  assert.ok(labels.includes("uigo"));
  assert.equal(labels.filter((label) => label === "sss").length, 2);

  const filtered = await completeIMembers(repository, resolver, "ss");
  assert.deepEqual(
    filtered.map((candidate) => candidate.label),
    ["ss", "ss", "ss_dim", "sss", "sss"],
  );
  repository.dispose();
});

test("Java 成员补全：继承成员与未知接收者", async () => {
  const repository = await JavaSourceRepository.create({ androidSources: androidRoot });
  const resolver = new JavaTypeResolver(repository);
  const inference = new MjavaTypeInference(repository, resolver);
  const model = loadProject(path.join(fixtures, "java-usage"));
  const usage = model.modules.get("usage");
  assert.ok(usage);
  const method = usage.parsed.methods[0];

  const setText = await completeJavaMembers(
    usage.parsed,
    method,
    "tv",
    "set",
    inference,
    resolver,
  );
  const setLabels = setText.map((candidate) => candidate.label);
  assert.equal(setLabels.filter((label) => label === "setText").length, 2);
  assert.ok(setLabels.includes("setId"));

  const inherited = await completeJavaMembers(
    usage.parsed,
    method,
    "tv",
    "getId",
    inference,
    resolver,
  );
  assert.deepEqual(inherited.map((candidate) => candidate.label), ["getId"]);

  assert.deepEqual(
    await completeJavaMembers(usage.parsed, method, "unknown", "", inference, resolver),
    [],
  );
  repository.dispose();
});

test("listMembers 沿继承链去重", async () => {
  const repository = await JavaSourceRepository.create({ androidSources: androidRoot });
  const resolver = new JavaTypeResolver(repository);
  const members = await resolver.listMembers("android.widget.TextView");
  const names = members.methods.map((match) => match.method.name);
  assert.ok(names.includes("getText"));
  assert.ok(names.includes("getId"));
  assert.equal(names.filter((name) => name === "setText").length, 2);
  assert.equal(names.includes("TextView"), false);
  const getId = members.methods.find((match) => match.method.name === "getId");
  assert.equal(getId?.context.class.fqcn, "android.view.View");
  assert.deepEqual(
    members.fields.map((match) => match.field.name),
    ["mText", "NO_ID", "mId"],
  );
  repository.dispose();
});

test("iyu 补全：事件类型与 call 目标", () => {
  const events = completeEventTypes(alpha, "");
  const names = events.map((candidate) => candidate.label);
  assert.ok(names.includes("loading"));
  assert.ok(names.includes("downkey"));
  assert.ok(names.includes("editormonitor"));

  const targets = completeCallTargets(alpha, "home.");
  assert.deepEqual(
    targets.map((candidate) => candidate.label).sort(),
    ["home.first", "home.second", "home.second", "home.shared"],
  );
});
