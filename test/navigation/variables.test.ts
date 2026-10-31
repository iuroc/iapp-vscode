import assert from "node:assert/strict";
import { test } from "node:test";
import { completeVariables } from "../../src/core/completion/mjava-completion.js";
import { parseMjava } from "../../src/core/java/mjava-parser.js";
import { LineIndex, SourcePosition } from "../../src/core/model/source.js";
import {
  findVariableReferences,
  variableAt,
  variableHover,
} from "../../src/core/navigation/variables.js";

const SOURCE = `public String title = "t";

public void first(String[] hints, int n) {
	int idx = 0;
	String body = "";
	body.addView(ui_text(hints[idx], 15, th_ink2()));
	idx = 1;
	for (String hint : hints) {
		i.syso(hint + title);
	}
	try {
	} catch (Exception e) {
		i.syso(e);
	}
	i.syso("idx hints"); // idx body
}
`;

const parsed = parseMjava("vars", SOURCE);
const method = parsed.methods[0];
const index = new LineIndex(SOURCE);
const projectModule = {
  name: "vars",
  filePath: "vars.mjava",
  parsed,
};

function positionOf(needle: string, from = 0): SourcePosition {
  const offset = SOURCE.indexOf(needle, from);
  assert.ok(offset >= 0, `找不到 ${needle}`);
  return index.positionAt(offset + 1);
}

test("变量定位：局部变量、形参、字段、循环与 catch 变量", () => {
  const hints = variableAt(parsed, "vars", positionOf("hints[idx]"));
  assert.equal(hints?.kind, "param");
  assert.equal(hints?.name, "hints");

  const idx = variableAt(parsed, "vars", positionOf("idx]"));
  assert.equal(idx?.kind, "local");
  assert.equal(idx?.type, "int");

  const body = variableAt(parsed, "vars", positionOf("body.addView"));
  assert.equal(body?.kind, "local");
  assert.equal(body?.type, "String");

  assert.equal(variableAt(parsed, "vars", positionOf("addView")), undefined);
  assert.equal(variableAt(parsed, "vars", positionOf("ui_text")), undefined);

  const field = variableAt(parsed, "vars", positionOf("title ="));
  assert.equal(field?.kind, "field");

  const loop = variableAt(parsed, "vars", positionOf("hint + title"));
  assert.equal(loop?.kind, "local");
  assert.equal(loop?.type, "String");

  const catchOffset = SOURCE.indexOf("i.syso(e);");
  const caught = variableAt(
    parsed,
    "vars",
    index.positionAt(catchOffset + "i.syso(".length),
  );
  assert.equal(caught?.kind, "local");
  assert.match(caught?.type ?? "", /Exception/);
});

test("变量引用：排除成员名、方法名、字符串与注释", () => {
  const idx = variableAt(parsed, "vars", positionOf("idx]"));
  assert.ok(idx);
  const idxRefs = findVariableReferences(projectModule, idx, true);
  assert.deepEqual(
    idxRefs.map((item) => item.range.start.line),
    [3, 5, 6],
  );

  const hints = variableAt(parsed, "vars", positionOf("hints[idx]"));
  assert.ok(hints);
  assert.deepEqual(
    findVariableReferences(projectModule, hints, true).map((item) => item.range.start.line),
    [2, 5, 7],
  );
  assert.deepEqual(
    findVariableReferences(projectModule, hints, false).map((item) => item.range.start.line),
    [5, 7],
  );

  const field = variableAt(parsed, "vars", positionOf("title ="));
  assert.ok(field);
  assert.deepEqual(
    findVariableReferences(projectModule, field, true).map((item) => item.range.start.line),
    [0, 8],
  );

  const loop = variableAt(parsed, "vars", positionOf("hint + title"));
  assert.ok(loop);
  assert.deepEqual(
    findVariableReferences(projectModule, loop, true).map((item) => item.range.start.line),
    [7, 8],
  );
});

test("变量 Hover 与补全", () => {
  const idx = variableAt(parsed, "vars", positionOf("idx]"));
  assert.ok(idx);
  assert.deepEqual(variableHover(idx), {
    signature: "int idx",
    details: ["局部变量", "声明于 `vars.first`"],
  });

  const beforeDeclaration = index.positionAt(SOURCE.indexOf("int idx"));
  const early = completeVariables(parsed, "vars", method, beforeDeclaration, "");
  const earlyNames = early.map((candidate) => candidate.label);
  assert.ok(earlyNames.includes("hints"));
  assert.ok(earlyNames.includes("n"));
  assert.ok(earlyNames.includes("title"));
  assert.equal(earlyNames.includes("idx"), false);

  const insideLoop = positionOf("hint + title");
  const loopCandidates = completeVariables(parsed, "vars", method, insideLoop, "hi");
  assert.deepEqual(
    loopCandidates.map((candidate) => candidate.label),
    ["hint", "hints"],
  );
});
