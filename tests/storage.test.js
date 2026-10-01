import { test } from "node:test";
import assert from "node:assert/strict";
import { writeHistory, readHistory, historyKey } from "../src/storage.js";

test("oversized image records leave existing history intact; unsafe image URLs are not restored", (t) => {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key)
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  });
  const old = { id: "old", content: "previous", answer: "saved" };
  assert.deepEqual(
    writeHistory([{ id: "large", content: "", answer: "answer", images: ["x".repeat(1_500_001)] }, old]),
    [old]
  );
  values.set(
    historyKey,
    JSON.stringify([
      { ...old, images: ["https://example.com/tracker.png", "data:image/svg+xml;base64,PHN2Zz4="] }
    ])
  );
  assert.deepEqual(readHistory()[0].images, []);
});
