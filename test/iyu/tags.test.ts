import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findIyuTagDoc,
  scanIyuTags,
  tagAtOffset,
  tagCompletionAt,
} from "../../src/core/iyu/tags.js";

const SOURCE = `<View id="1" did="0" type="FrameLayout">
<ppt>text=Hi</ppt>
<event></event>
</View>
<UIEventset><eventItme type="loading">
call(null, "mjava", "<Fake2>")
</eventItme></UIEventset>
<!-- <Fake> -->
`;

test("标签扫描：标签、属性，跳过字符串与注释", () => {
  const tags = scanIyuTags(SOURCE);
  assert.deepEqual(
    tags.map((tag) => `${tag.closing ? "/" : ""}${tag.name}`),
    [
      "View",
      "ppt",
      "/ppt",
      "event",
      "/event",
      "/View",
      "UIEventset",
      "eventItme",
      "/eventItme",
      "/UIEventset",
    ],
  );
  const view = tags[0];
  assert.deepEqual(
    view.attributes.map((attribute) => `${attribute.name}=${attribute.value}`),
    ["id=1", "did=0", "type=FrameLayout"],
  );
  const item = tags.find((tag) => tag.name === "eventItme");
  assert.equal(item?.attributes[0].value, "loading");
});

test("标签与属性定位", () => {
  const viewOffset = SOURCE.indexOf("View") + 1;
  const viewHit = tagAtOffset(SOURCE, viewOffset);
  assert.equal(viewHit?.doc?.name, "View");

  const idOffset = SOURCE.indexOf("id=") + 1;
  const idHit = tagAtOffset(SOURCE, idOffset);
  assert.equal(idHit?.attribute?.name, "id");
  assert.match(idHit?.doc?.attributes.find((item) => item.name === "id")?.summary ?? "", /控件标识/);

  const closingOffset = SOURCE.indexOf("/View") + 2;
  assert.equal(tagAtOffset(SOURCE, closingOffset)?.doc?.name, "View");
});

test("补全上下文：标签、闭合标签、属性", () => {
  assert.deepEqual(tagCompletionAt("<", 1), { kind: "tag", prefix: "" });
  assert.deepEqual(tagCompletionAt("<Vi", 3), { kind: "tag", prefix: "Vi" });
  assert.deepEqual(tagCompletionAt("</", 2), { kind: "closing", prefix: "" });
  assert.deepEqual(tagCompletionAt("</Vie", 5), { kind: "closing", prefix: "Vie" });
  assert.deepEqual(tagCompletionAt("<View ", 6), {
    kind: "attribute",
    prefix: "",
    tagName: "View",
    existingAttributes: [],
  });
  assert.deepEqual(tagCompletionAt("<View i", 7), {
    kind: "attribute",
    prefix: "i",
    tagName: "View",
    existingAttributes: [],
  });
  assert.deepEqual(tagCompletionAt('<View id="1" ', 13), {
    kind: "attribute",
    prefix: "",
    tagName: "View",
    existingAttributes: ["id"],
  });
  assert.deepEqual(tagCompletionAt("<eventItme ", 12), {
    kind: "attribute",
    prefix: "",
    tagName: "eventItme",
    existingAttributes: [],
  });
  assert.equal(tagCompletionAt("call(", 5), undefined);
});

test("标签文档内容", () => {
  assert.equal(findIyuTagDoc("eventItme")?.attributes[0].name, "type");
  assert.deepEqual(findIyuTagDoc("View")?.attributes.map((item) => item.name), [
    "id",
    "did",
    "type",
  ]);
  assert.deepEqual(findIyuTagDoc("UIEventset")?.children, ["eventItme"]);
  assert.match(findIyuTagDoc("ppt")?.details.join(" ") ?? "", /不能有空格/);
});
