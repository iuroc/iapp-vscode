import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMjava } from "../../src/core/java/mjava-parser.js";
import { methodHover } from "../../src/core/navigation/resolver.js";
import { wrapMjavaSource } from "../../src/core/java/mjava-source.js";
import { LineIndex } from "../../src/core/model/source.js";

const FIXTURE = `// 首页模块
import android.view.View;
import java.util.ArrayList;

public String title = "home";

public void first() {
	View root = (View) new Object();
	lib_wire();
	i.fn("ui");
	i.call("mjava", "home.second", 1);
	page.addView(root, new Runnable() {
		public void run() { i.uigo("search.iyu"); }
	});
}

public View build(String name, int count) {
	return null;
}

private ArrayList<String> names() {
	return null;
}
`;

test("包裹后逐字符保留原文件偏移", () => {
  const wrapped = wrapMjavaSource(FIXTURE);
  assert.equal(wrapped.imports.length, 2);
  assert.deepEqual(
    wrapped.imports.map((item) => [item.name, item.line]),
    [
      ["android.view.View", 1],
      ["java.util.ArrayList", 2],
    ],
  );
  assert.equal(wrapped.text.length, wrapped.headerLength + FIXTURE.length + 3);
  const firstMethodOffset = FIXTURE.indexOf("public void first");
  assert.equal(
    wrapped.text.slice(wrapped.headerLength + firstMethodOffset).startsWith("public void first"),
    true,
  );
});

test("只把包裹 class 的直接方法当模块方法", () => {
  const parsed = parseMjava("home", FIXTURE);
  assert.equal(parsed.hasSyntaxErrors, false);
  assert.deepEqual(
    parsed.methods.map((method) => method.name),
    ["first", "build", "names"],
  );
  assert.deepEqual(
    parsed.fields.map((field) => [field.name, field.type, field.visibility]),
    [["title", "String", "public"]],
  );
});

test("方法注释：块注释与连续行注释", () => {
  const source = `/** 计算总和。
 * @param a 第一个
 * @param b 第二个
 */
public int sum(int a, int b) {
	return a + b;
}

// 第一行
// 第二行
public void second() {
}

// ---------- 分节 ----------

public void third() {
}
`;
  const parsed = parseMjava("doc", source);
  const sum = parsed.methods.find((method) => method.name === "sum");
  assert.ok(sum);
  assert.match(sum.documentation ?? "", /计算总和/);
  assert.match(sum.documentation ?? "", /@param a 第一个/);
  assert.match(sum.documentation ?? "", /@param b 第二个/);
  assert.equal(parsed.methods.find((method) => method.name === "second")?.documentation, "第一行\n第二行");
  assert.equal(parsed.methods.find((method) => method.name === "third")?.documentation, undefined);

  const hover = methodHover("doc", sum);
  assert.match(hover.javadoc ?? "", /计算总和/);
});

test("方法注释：与声明之间允许空行", () => {
  const source = `// ---------- 按压反馈 ----------
// 第三个参数必须给形状遮罩：传 null 时涟漪会溢出控件边界。
// 注意 content 传的是 null：会覆盖调用方已经设好的背景。
// 需要保留自身背景的控件，先挂一个透明覆盖层。

public void ripple() {
}
`;
  const parsed = parseMjava("widgets", source);
  const doc = parsed.methods[0].documentation ?? "";
  assert.match(doc, /按压反馈/);
  assert.match(doc, /透明覆盖层/);
  assert.match(doc, /会覆盖调用方已经设好的背景/);
});

test("调用表达式提取：裸调用、i.fn/i.call、匿名类内调用", () => {
  const parsed = parseMjava("home", FIXTURE);
  const bare = parsed.calls.find((call) => call.name === "lib_wire");
  assert.ok(bare);
  assert.equal(bare.qualifier, undefined);
  assert.equal(bare.enclosingMethod, "first");

  const fn = parsed.calls.find((call) => call.qualifier === "i" && call.name === "fn");
  assert.ok(fn);
  assert.equal(fn.args[0].value, "ui");

  const explicit = parsed.calls.find((call) => call.qualifier === "i" && call.name === "call");
  assert.ok(explicit);
  assert.deepEqual(
    explicit.args.map((arg) => arg.value),
    ["mjava", "home.second", undefined],
  );

  const uigo = parsed.calls.find((call) => call.name === "uigo");
  assert.ok(uigo);
  assert.equal(uigo.args[0].value, "search.iyu");
  assert.equal(uigo.enclosingMethod, "first");
});

test("与 Java 模块系统同名的标识符仍能解析", () => {
  const source = `import java.io.File;

public boolean ix_moveTo(File from, File to) {
	String text = "to with uses";
	return from.renameTo(to);
}
`;
  const parsed = parseMjava("indexer", source);
  assert.equal(parsed.hasSyntaxErrors, false);
  assert.deepEqual(
    parsed.methods[0]?.params.map((param) => param.name),
    ["from", "to"],
  );
});

test("方法、参数、返回类型都映射回原文件行列", () => {
  const parsed = parseMjava("home", FIXTURE);
  const index = new LineIndex(FIXTURE);
  const build = parsed.methods.find((method) => method.name === "build");
  assert.ok(build);
  assert.equal(build.returnType, "View");
  assert.equal(build.visibility, "public");
  assert.deepEqual(
    build.params.map((param) => [param.name, param.type]),
    [
      ["name", "String"],
      ["count", "int"],
    ],
  );
  assert.deepEqual(build.nameRange.start, { line: 16, character: 12 });
  const methodText = FIXTURE.slice(
    index.offsetAt(build.range.start),
    index.offsetAt(build.range.end),
  );
  assert.equal(methodText.startsWith("public View build(String name, int count)"), true);
  assert.equal(methodText.endsWith("}"), true);

  const names = parsed.methods.find((method) => method.name === "names");
  assert.ok(names);
  assert.equal(names.visibility, "private");
  assert.equal(names.returnType, "ArrayList<String>");
});
