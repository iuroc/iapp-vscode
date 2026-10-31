import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIyu } from "../../src/core/iyu/iyu-parser.js";

const FIXTURE = `<View id="1" did="0" type="FrameLayout">
<ppt>width=-1
height=-1
backgroundcolor=#F7F4EE</ppt>
<event></event>
</View>
<View id="2" did="1" type="TextView">
<ppt>width=-2
text=hi</ppt>
<event></event>
</View>
<UIEventset><eventItme type="loading">
call(null, "mjava", "home.first")
</eventItme><eventItme type="downkey">
call(null, "mjava", "reader.key", st_kC)
addv("ui", "col")
</eventItme></UIEventset>
`;

test("多个根 View 与 ppt 属性", () => {
  const page = parseIyu("mian", FIXTURE);
  assert.equal(page.views.length, 2);
  assert.deepEqual(
    page.views.map((view) => view.attributes.map((attribute) => `${attribute.name}=${attribute.value}`)),
    [
      ["id=1", "did=0", "type=FrameLayout"],
      ["id=2", "did=1", "type=TextView"],
    ],
  );
  assert.deepEqual(
    page.views[0].properties.map((property) => `${property.key}=${property.value}`),
    ["width=-1", "height=-1", "backgroundcolor=#F7F4EE"],
  );
  assert.equal(page.views[1].properties.length, 2);
  assert.equal(page.issues.length, 0);
});

test("eventItme 的 call/addv 与参数", () => {
  const page = parseIyu("mian", FIXTURE);
  assert.deepEqual(
    page.events.map((event) => event.type),
    ["loading", "downkey"],
  );
  const first = page.events[0].calls[0];
  assert.equal(first.name, "call");
  assert.deepEqual(
    first.args.map((argument) => [argument.raw, argument.value]),
    [
      ["null", undefined],
      ['"mjava"', "mjava"],
      ['"home.first"', "home.first"],
    ],
  );
  assert.deepEqual(
    page.events[1].calls.map((call) => call.name),
    ["call", "addv"],
  );
  assert.equal(page.events[1].calls[0].args[3].raw, "st_kC");
  assert.equal(page.events[1].calls[0].args[3].value, undefined);
});

test("注释里的标签与 call 不参与解析", () => {
  const source = `<!-- <View id="9" did="0" type="TextView"></View> -->
<View id="1" did="0" type="FrameLayout">
<event></event>
</View>
<UIEventset><eventItme type="loading">
// call(null, "mjava", "ghost.first")
call(null, "mjava", "home.first")
</eventItme></UIEventset>
`;
  const page = parseIyu("mian", source);
  assert.equal(page.views.length, 1);
  assert.equal(page.events.length, 1);
  assert.equal(page.events[0].calls.length, 1);
  assert.equal(page.events[0].calls[0].args[2].value, "home.first");
});

test("未闭合的 View 被记录为问题", () => {
  const page = parseIyu("broken", '<View id="1" did="0" type="FrameLayout">\n<ppt>width=-1</ppt>\n');
  assert.equal(page.views.length, 1);
  assert.equal(page.issues.length, 1);
  assert.match(page.issues[0].message, /未闭合/);
});
