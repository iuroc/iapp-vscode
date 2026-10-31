import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { lintProject, LintOptions } from "../../src/core/diagnostics/lint.js";
import { loadProject } from "../../src/core/iapp/project.js";
import { IappDiagnostic } from "../../src/core/diagnostics/lint.js";

const DEFAULT_PAGE = `<View id="1" did="0" type="FrameLayout">
<ppt>width=-1
height=-1</ppt>
<event></event>
</View>
`;

function lintFiles(
  modules: Record<string, string>,
  pages: Record<string, string> = {},
  options: LintOptions = {},
): IappDiagnostic[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iapp-lint-"));
  try {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "mian.iyu"), pages.mian ?? DEFAULT_PAGE);
    for (const [name, text] of Object.entries(modules)) {
      fs.writeFileSync(path.join(dir, "src", `${name}.mjava`), text);
    }
    for (const [name, text] of Object.entries(pages)) {
      if (name !== "mian") {
        fs.writeFileSync(path.join(dir, "src", `${name}.iyu`), text);
      }
    }
    const model = loadProject(dir);
    return [...lintProject(model, options).values()].flat();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const FATAL = `public void bad() {
	final Object x = null;
	Runnable r = () -> { };
	void call(String... args) { }
	int big = 0xFFFFFFFF;
	Object o = new bsh.Interpreter();
	android.widget.TextView tv = null;
	Object q = new android.widget.TextView(activity);
	String s = "\\s";
}
`;

test("6.1 八条 mjava 致命写法", () => {
  const diagnostics = lintFiles({ bad: FATAL });
  const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
  for (const code of [
    "MJAVA-FINAL",
    "MJAVA-LAMBDA",
    "MJAVA-VARARGS",
    "MJAVA-HEX",
    "MJAVA-BSH",
    "MJAVA-FQN-TYPE",
    "MJAVA-FQN-NEW",
    "MJAVA-ESCAPE",
  ]) {
    assert.ok(codes.has(code), `缺少 ${code}`);
  }
  assert.ok(diagnostics.every((diagnostic) => diagnostic.severity === "error"));
});

test("6.2 未定义目标：i.fn、uigo、带前缀方法、iyu 入口", () => {
  const diagnostics = lintFiles(
    {
      home: `public void first() {
	i.fn("theme");
	i.uigo("nope.iyu");
	ui_missing();
}
`,
    },
    {
      mian: `<View id="1" did="0" type="FrameLayout">
<ppt>width=-1</ppt>
<event></event>
</View>
<UIEventset><eventItme type="loading">
call(null, "mjava", "home.frist")
</eventItme></UIEventset>
`,
    },
  );
  const codes = diagnostics.map((diagnostic) => diagnostic.code);
  assert.ok(codes.includes("IAPP-MISSING-MODULE"));
  assert.ok(codes.includes("IAPP-MISSING-PAGE"));
  assert.ok(codes.includes("IAPP-UNDEFINED-METHOD"));
  assert.ok(codes.includes("IAPP-MISSING-METHOD"));
});

test("6.3 先加载后调用：缺 i.fn 报警告，动态加载不报", () => {
  const diagnostics = lintFiles({
    a: `public void run() {
	i.fn("b");
	i.fn("c");
	fromB();
	unloadedCall();
	first(1);
}

public void first() {
}
`,
    b: `public void fromB() {
}

public void shared() {
}
`,
    c: `public void shared() {
}
`,
    d: `public void unloadedCall() {
}
`,
    dyn: `public void run(String name) {
	i.fn(name);
	unloadedCall();
}
`,
  });
  const loadWarnings = diagnostics.filter((diagnostic) => diagnostic.code === "IAPP-LOAD-ORDER");
  assert.equal(loadWarnings.length, 1);
  assert.equal(loadWarnings[0].filePath.endsWith("a.mjava"), true);
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "IAPP-ARITY"));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "IAPP-DUPLICATE-METHOD"));
  assert.equal(
    loadWarnings.some((diagnostic) => diagnostic.filePath.endsWith("dyn.mjava")),
    false,
  );
});

test("6.5 iyu 入口实参个数与重名覆盖", () => {
  const diagnostics = lintFiles(
    {
      home: `public void key(String k, String v) {
}
`,
      a: `public void load() {
	i.fn("b");
	i.fn("c");
}
`,
      b: `public void shared() {
}
`,
      c: `public void shared() {
}
`,
    },
    {
      mian: `<View id="1" did="0" type="FrameLayout">
<ppt>width=-1</ppt>
<event></event>
</View>
<UIEventset><eventItme type="downkey">
call(null, "mjava", "home.key", st_kC)
</eventItme></UIEventset>
`,
    },
  );
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "IAPP-ARITY"));
  const duplicate = diagnostics.find(
    (diagnostic) => diagnostic.code === "IAPP-DUPLICATE-METHOD",
  );
  assert.ok(duplicate);
  assert.match(duplicate.filePath, /c\.mjava$/);
});

test("6.4 iyu 书写规则：白名单、行尾注释、ppt 空格、重复 id", () => {
  const diagnostics = lintFiles(
    { home: "public void first() {\n}\n" },
    {
      mian: `<View id="1" did="0" type="FrameLayout">
<ppt>width=-1
textsize = 20sp</ppt>
<event></event>
</View>
<View id="1" did="0" type="TextView">
<ppt>width=-2</ppt>
<event></event>
</View>
<UIEventset><eventItme type="loading">
// 注释
syso("x")
call(null, "mjava", "home.first") // 行尾
</eventItme></UIEventset>
`,
    },
  );
  const codes = diagnostics.map((diagnostic) => diagnostic.code);
  assert.ok(codes.includes("IYU-PPT-SPACES"));
  assert.ok(codes.includes("IYU-DUPLICATE-ID"));
  assert.ok(codes.includes("IYU-UNSUPPORTED-STATEMENT"));
  assert.ok(codes.includes("IYU-TRAILING-COMMENT"));
});

test("8.3 未解析的 Java 引用不报错", () => {
  const diagnostics = lintFiles({
    home: `import android.content.Context;
import android.widget.TextView;

public void first(TextView view) {
	view.setText("x");
	Context context = activity;
}
`,
  });
  assert.deepEqual(
    diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    [],
  );
});

test("17 iyu 标签诊断：未知标签、未知属性、缺 type", () => {
  const diagnostics = lintFiles(
    { home: "public void first() {\n}\n" },
    {
      mian: `<Vieww id="1">
<ppt>width=-1</ppt>
</Vieww>
<View id="1" idd="0" type="TextView">
<ppt>width=-1</ppt>
<event></event>
</View>
<UIEventset><eventItme>
call(null, "mjava", "home.first")
</eventItme></UIEventset>
`,
    },
  );
  const codes = diagnostics.map((diagnostic) => diagnostic.code);
  assert.ok(codes.includes("IYU-UNKNOWN-TAG"));
  assert.ok(codes.includes("IYU-UNKNOWN-ATTRIBUTE"));
  assert.ok(codes.includes("IYU-MISSING-EVENT-TYPE"));
});

test("6.6 行内抑制与规则开关", () => {
  const suppressed = lintFiles({
    bad: `public void bad() {
	final Object x = null; // noqa
	Runnable r = () -> { }; // noqa: MJAVA-LAMBDA
	int big = 0xFFFFFFFF;
}
`,
  });
  const codes = suppressed.map((diagnostic) => diagnostic.code);
  assert.equal(codes.includes("MJAVA-FINAL"), false);
  assert.equal(codes.includes("MJAVA-LAMBDA"), false);
  assert.equal(codes.includes("MJAVA-HEX"), true);

  const disabled = lintFiles({ bad: FATAL }, {}, { disabledRules: ["MJAVA-FINAL"] });
  assert.equal(
    disabled.some((diagnostic) => diagnostic.code === "MJAVA-FINAL"),
    false,
  );
});
