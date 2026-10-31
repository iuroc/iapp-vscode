import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { JavaSourceRepository } from "../../src/core/java/java-repository.js";
import { JavaTypeResolver } from "../../src/core/java/java-resolver.js";
import { parseMjava } from "../../src/core/java/mjava-parser.js";
import { MjavaTypeInference } from "../../src/core/java/type-inference.js";

const androidRoot = path.resolve(__dirname, "../../../test/fixtures/android-sources");
const jdkHome = process.env.IAPP_JDK_HOME;
const hasJdk = Boolean(jdkHome && fs.existsSync(path.join(jdkHome, "lib", "src.zip")));

const SOURCE = `import android.view.View;
import android.widget.TextView;
import java.util.ArrayList;

public void test(TextView param, View[] views) {
	TextView tv = new TextView(activity);
	tv.setText("x");
	param.getText();
	((TextView) unknown).setText("y");
	new TextView(activity).setText("z");
	String s = "a" + 1;
	s.length();
	("a" + s).length();
	views[0].getId();
	activity.getResources().getString(0);
	ArrayList<String> list = new ArrayList<>();
	list.add("x");
	unknown.setText("nope");
	activity.finish();
	i.sss("k", 1);
}
`;

const parsed = parseMjava("infer", SOURCE);
const method = parsed.methods[0];

async function inference(): Promise<MjavaTypeInference> {
  const repository = await JavaSourceRepository.create({ jdkHome, androidSources: androidRoot });
  const { IAPP_STUB_FQCN, IAPP_STUB_SOURCE } = await import(
    "../../src/core/java/iapp-stubs.js"
  );
  repository.addMemorySource(IAPP_STUB_FQCN, IAPP_STUB_SOURCE);
  return new MjavaTypeInference(repository, new JavaTypeResolver(repository));
}

async function receiverType(
  engine: MjavaTypeInference,
  qualifier: string,
  callName: string,
): Promise<string | undefined> {
  const call = parsed.calls.find(
    (item) => item.name === callName && item.qualifier === qualifier,
  );
  assert.ok(call, `找不到调用 ${qualifier}.${callName}`);
  return engine.inferCallReceiver(call, { parsed, method });
}

test("5.5 局部变量、形参、new、强转", async () => {
  const engine = await inference();
  assert.equal(await receiverType(engine, "tv", "setText"), "android.widget.TextView");
  assert.equal(await receiverType(engine, "param", "getText"), "android.widget.TextView");
  assert.equal(
    await receiverType(engine, "((TextView) unknown)", "setText"),
    "android.widget.TextView",
  );
  assert.equal(
    await receiverType(engine, "new TextView(activity)", "setText"),
    "android.widget.TextView",
  );
  assert.equal(await receiverType(engine, "views[0]", "getId"), "android.view.View");
  assert.equal(await receiverType(engine, "list", "add"), "java.util.ArrayList");
});

test("5.5 方法返回类型与字符串拼接", { skip: !hasJdk }, async () => {
  const engine = await inference();
  assert.equal(
    await receiverType(engine, "activity.getResources()", "getString"),
    "android.content.res.Resources",
  );
  assert.equal(await receiverType(engine, "s", "length"), "java.lang.String");
  assert.equal(await receiverType(engine, '("a" + s)', "length"), "java.lang.String");
});

test("5.8 activity 与 i 固定类型", async () => {
  const engine = await inference();
  assert.equal(await receiverType(engine, "activity", "finish"), "android.app.Activity");
  assert.equal(await receiverType(engine, "i", "sss"), "com.iapp.app.Aid_javaCode");
});

test("5.5 推断不出时返回 unknown", async () => {
  const engine = await inference();
  assert.equal(await receiverType(engine, "unknown", "setText"), undefined);
});
