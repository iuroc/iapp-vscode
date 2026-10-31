import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import * as oniguruma from "vscode-oniguruma";
import * as vsctm from "vscode-textmate";

const projectRoot = path.resolve(__dirname, "../../..");

interface Token {
  text: string;
  scopes: string[];
}

let registry: vsctm.Registry;

before(async () => {
  const wasmPath = path.join(path.dirname(require.resolve("vscode-oniguruma")), "onig.wasm");
  await oniguruma.loadWASM(fs.readFileSync(wasmPath));
  registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (value) => new oniguruma.OnigString(value),
    }),
    loadGrammar: async (scopeName) => {
      const file =
        scopeName === "source.mjava"
          ? "syntaxes/mjava.tmLanguage.json"
          : "syntaxes/iyu.tmLanguage.json";
      const fullPath = path.join(projectRoot, file);
      return vsctm.parseRawGrammar(fs.readFileSync(fullPath, "utf8"), fullPath);
    },
  });
});

function tokenize(grammar: vsctm.IGrammar, lines: string[]): Token[][] {
  let ruleStack = vsctm.INITIAL;
  return lines.map((line) => {
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;
    return result.tokens.map((token) => ({
      text: line.slice(token.startIndex, token.endIndex),
      scopes: token.scopes,
    }));
  });
}

function hasScope(tokens: Token[], text: string, scope: string): boolean {
  return tokens.some(
    (token) =>
      token.text === text && token.scopes.some((item) => item === scope || item.startsWith(`${scope}.`)),
  );
}

test("mjava 语法：关键字、方法、类型、字符串、注释、数值", async () => {
  const grammar = await registry.loadGrammar("source.mjava");
  assert.ok(grammar);
  const lines = tokenize(grammar, [
    "import android.view.View;",
    "public View lib_page(String name) {",
    "\t// 注释",
    '\tString text = "hello" + 42;',
    "\treturn (View) new Object();",
    "}",
  ]);
  const flat = lines.flat();
  assert.ok(hasScope(flat, "import", "keyword.declaration.mjava"));
  assert.ok(hasScope(flat, "public", "storage.modifier.mjava"));
  assert.ok(hasScope(flat, "lib_page", "entity.name.function.mjava"));
  assert.ok(hasScope(flat, "String", "support.class.mjava"));
  assert.ok(hasScope(flat, "hello", "string.quoted.double.mjava"));
  assert.ok(hasScope(flat, "42", "constant.numeric.mjava"));
  assert.ok(
    flat.some(
      (token) =>
        token.text.includes("// 注释") &&
        token.scopes.some((scope) => scope.startsWith("comment.line.double-slash")),
    ),
  );
});

test("iyu 语法：标签、属性、ppt、事件与 call", async () => {
  const grammar = await registry.loadGrammar("source.iyu");
  assert.ok(grammar);
  const lines = tokenize(grammar, [
    '<View id="1" did="0" type="FrameLayout">',
    "<ppt>width=-1",
    "backgroundcolor=#F7F4EE</ppt>",
    '<UIEventset><eventItme type="loading">',
    'call(null, "mjava", "home.first")',
    "</eventItme></UIEventset>",
  ]);
  const flat = lines.flat();
  assert.ok(hasScope(flat, "View", "entity.name.tag.iyu"));
  assert.ok(hasScope(flat, "id", "entity.other.attribute-name.iyu"));
  assert.ok(hasScope(flat, '"1"', "string.quoted.double.iyu"));
  assert.ok(hasScope(flat, "width", "support.type.property-name.iyu"));
  assert.ok(hasScope(flat, "#F7F4EE", "constant.other.color.iyu"));
  assert.ok(hasScope(flat, "eventItme", "entity.name.tag.iyu"));
  assert.ok(hasScope(flat, "call", "support.function.iyu"));
  assert.ok(hasScope(flat, '"home.first"', "string.quoted.double.iyu"));
});
