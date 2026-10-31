import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMjava } from "../../src/core/java/mjava-parser.js";
import { fileComment } from "../../src/core/model/file-comment.js";
import { moduleHover } from "../../src/core/navigation/resolver.js";

test("文件注释：连续 // 合并，空行截断", () => {
  assert.equal(
    fileComment("// 第一行\n// 第二行\n\nimport android.view.View;"),
    "第一行\n第二行",
  );
});

test("文件注释：空注释行不截断，空行后的第二段不合并", () => {
  assert.equal(fileComment("// 第一段\n//\n// 同段第二行\n"), "第一段\n\n同段第二行");
  assert.equal(fileComment("// 第一段\n\n// 第二段\npublic void first() {}"), "第一段");
});

test("文件注释：块注释与紧随的 // 行合并", () => {
  assert.equal(
    fileComment("/**\n * 文件说明\n */\n// 补充说明\n\nimport java.util.List;"),
    "文件说明\n\n补充说明",
  );
  assert.equal(fileComment("/* 单行文件说明 */\n\npublic void first() {}"), "单行文件说明");
});

test("文件注释：允许开头空行，没有注释返回 undefined", () => {
  assert.equal(fileComment("\n\n// 说明\n\nimport java.util.List;"), "说明");
  assert.equal(fileComment("import java.util.List;\n\n// 后面的注释"), undefined);
  assert.equal(fileComment(""), undefined);
});

test("文件注释接入 mjava 模型与模块 Hover", () => {
  const parsed = parseMjava(
    "mine",
    "// 我的 Tab：主题切换、阅读历史、关于。\n\nimport android.view.View;\n\npublic void first() {\n}\n",
  );
  assert.equal(parsed.documentation, "我的 Tab：主题切换、阅读历史、关于。");
  const hover = moduleHover({ name: "mine", filePath: "mine.mjava", parsed });
  assert.match(hover.javadoc ?? "", /我的 Tab/);
});
