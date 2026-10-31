import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseJavaFile } from "../../src/core/java/java-class-parser.js";
import { javaClassHover, javaMethodHover } from "../../src/core/java/java-hover.js";
import { IAPP_STUB_FQCN, IAPP_STUB_SOURCE } from "../../src/core/java/iapp-stubs.js";
import { JavaSourceRepository } from "../../src/core/java/java-repository.js";
import { JavaTypeResolver } from "../../src/core/java/java-resolver.js";

const androidRoot = path.resolve(__dirname, "../../../test/fixtures/android-sources");
const fixtureText = fs.readFileSync(path.join(androidRoot, "android/widget/TextView.java"), "utf8");

test("5.2 源码解析：package、import、继承、方法、字段、javadoc", () => {
  const file = parseJavaFile("TextView.java", fixtureText);
  assert.equal(file.packageName, "android.widget");
  assert.deepEqual(
    file.imports.map((item) => item.name),
    ["android.content.Context", "android.view.View"],
  );
  const textView = file.classes[0];
  assert.equal(textView.name, "TextView");
  assert.equal(textView.superClass, "View");
  assert.match(textView.javadoc ?? "", /displays text/);
  assert.deepEqual(
    textView.methods.map((method) => `${method.name}/${method.params.length}`),
    ["TextView/1", "getText/0", "setText/1", "setText/1"],
  );
  assert.equal(textView.methods[0].isConstructor, true);
  assert.equal(textView.methods[1].javadoc?.includes("text displayed"), true);
  assert.equal(textView.fields[0].name, "mText");
  assert.equal(textView.fields[0].type, "CharSequence");
});

test("5.1 多源码集：Android 夹具目录 + JDK src.zip", async () => {
  const jdkHome = process.env.IAPP_JDK_HOME;
  const repository = await JavaSourceRepository.create({
    jdkHome,
    androidSources: androidRoot,
  });
  const android = repository.resolveClassLocation("android.widget.TextView");
  assert.ok(android);
  assert.equal(android.kind, "dir");
  const textView = await repository.getClassContext("android.widget.TextView");
  assert.ok(textView);
  assert.equal(textView.class.superClass, "View");

  if (jdkHome && fs.existsSync(path.join(jdkHome, "lib", "src.zip"))) {
    const arrayList = repository.resolveClassLocation("java.util.ArrayList");
    assert.ok(arrayList);
    assert.equal(arrayList.kind, "zip");
    const context = await repository.getClassContext("java.util.ArrayList");
    assert.ok(context);
    assert.ok(context.class.methods.some((method) => method.name === "add"));
    const string = await repository.getClassContext("java.lang.String");
    assert.ok(string);
    assert.ok(string.class.nested.some((nested) => nested.name === "CaseInsensitiveComparator"));
  }
  repository.dispose();
});

test("5.3 继承解析：TextView.getId 落到 View.getId", async () => {
  const repository = await JavaSourceRepository.create({ androidSources: androidRoot });
  const resolver = new JavaTypeResolver(repository);
  const matches = await resolver.findMethods("android.widget.TextView", "getId");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].context.class.fqcn, "android.view.View");
  assert.equal(matches[0].method.name, "getId");

  const fromInterface = await resolver.findMethods(
    "android.widget.TextView",
    "requestLayout",
  );
  assert.equal(fromInterface.length, 1);
  assert.equal(fromInterface[0].context.class.fqcn, "android.view.ViewParent");
  repository.dispose();
});

test("Java 注释：方法上方的 // 与 /** */ 都可用", () => {
  const file = parseJavaFile(
    "Doc.java",
    `package demo;

// 类的行注释
public class Doc {
	/** 文档注释 */
	public void a() {
	}

	// 方法行注释
	// 第二行
	public int b() {
		return 0;
	}
}
`,
  );
  const cls = file.classes[0];
  assert.equal(cls.javadoc, "类的行注释");
  assert.equal(cls.methods[0].javadoc, "文档注释");
  assert.equal(cls.methods[1].javadoc, "方法行注释\n第二行");
  const hover = javaMethodHover({ context: { file, class: cls }, method: cls.methods[1] });
  assert.equal(hover.javadoc, "方法行注释\n第二行");
});

test("5.7 Java Hover：javadoc 摘要与源码缺失降级", async () => {
  const repository = await JavaSourceRepository.create({ androidSources: androidRoot });
  const resolver = new JavaTypeResolver(repository);
  const matches = await resolver.findMethods("android.widget.TextView", "getText");
  assert.equal(matches.length, 1);
  const hover = javaMethodHover(matches[0]);
  assert.equal(hover.signature, "CharSequence TextView.getText()");
  assert.match(hover.javadoc ?? "", /text displayed/);
  assert.deepEqual(hover.details, ["声明于 `android.widget.TextView`", "继承 `View`"]);

  const context = await repository.getClassContext("android.widget.TextView");
  assert.ok(context);
  const classHover = javaClassHover(context);
  assert.match(classHover.signature, /class android\.widget\.TextView extends View/);
  repository.dispose();

  const empty = await JavaSourceRepository.create({});
  assert.equal(await empty.getClassContext("android.widget.TextView"), undefined);
  empty.dispose();
});

test("5.8 i stub：Aid_javaCode 与 activity", async () => {
  const repository = await JavaSourceRepository.create({ androidSources: androidRoot });
  repository.addMemorySource(IAPP_STUB_FQCN, IAPP_STUB_SOURCE);
  const resolver = new JavaTypeResolver(repository);

  const stub = await repository.getClassContext(IAPP_STUB_FQCN);
  assert.ok(stub);
  assert.ok(stub.class.methods.some((method) => method.name === "fn"));
  const shared = await resolver.findMethods(IAPP_STUB_FQCN, "sss", 2);
  assert.equal(shared.length, 1);
  assert.deepEqual(
    shared[0].method.params.map((param) => param.type),
    ["String", "Object"],
  );
  assert.match(javaMethodHover(shared[0]).javadoc ?? "", /跨 call/);

  const activity = await repository.getClassContext("android.app.Activity");
  assert.ok(activity);
  const finish = await resolver.findMethods("android.app.Activity", "finish", 0);
  assert.equal(finish.length, 1);
  repository.dispose();
});

test("5.4 重载：setText 返回全部候选", async () => {
  const repository = await JavaSourceRepository.create({ androidSources: androidRoot });
  const resolver = new JavaTypeResolver(repository);
  const matches = await resolver.findMethods("android.widget.TextView", "setText", 1);
  assert.equal(matches.length, 2);
  assert.deepEqual(
    matches.map((match) => match.method.params[0].type).sort(),
    ["CharSequence", "int"],
  );
  assert.equal(matches[0].context.class.fqcn, matches[1].context.class.fqcn);
  repository.dispose();
});
