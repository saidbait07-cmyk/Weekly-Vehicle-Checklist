import test from "node:test";
import assert from "node:assert/strict";
import {
  blankAnswers,
  validateAnswers,
  checklist,
  operationalDay,
  safeCell,
} from "../src/domain";
import { labels } from "../src/i18n";
import { workbook } from "../src/export";
import { unzipSync, strFromU8 } from "fflate";
test("preserves 32 source rows, 27 checks and correct signoff kinds", () => {
  assert.equal(checklist.length, 32);
  assert.deepEqual(
    checklist.map((i) => i.source_row),
    Array.from({ length: 32 }, (_, i) => i + 1),
  );
  assert.deepEqual(
    checklist.slice(27).map((i) => i.kind),
    ["text", "signature", "date", "signature", "defect_log"],
  );
});
test("no pre-selected pass; all checks and failure/N/A comments are mandatory", () => {
  const a = blankAnswers();
  assert(a.every((x) => x.result === ""));
  assert.equal(validateAnswers(a), false);
  a.forEach((x) => (x.result = "pass"));
  assert(validateAnswers(a));
  a[2].result = "fail";
  assert(!validateAnswers(a));
  a[2].comment = "Mirror cracked";
  assert(validateAnswers(a));
  a[3].result = "na";
  assert(!validateAnswers(a));
  a[3].comment = "Not fitted";
  assert(validateAnswers(a));
  a[4].item_no = 3;
  assert(!validateAnswers(a));
});
test("operational date uses Muscat across UTC midnight", () => {
  assert.equal(operationalDay(new Date("2026-11-03T21:00:00Z")), "2026-11-04");
});
test("all UI keys have English and Arabic text", () => {
  for (const [k, v] of Object.entries(labels)) {
    assert.equal(v.length, 2, k);
    assert(v[0].trim(), k);
    assert(/[\u0600-\u06ff]/.test(v[1]), k);
  }
});
test("Excel export uses inline text and escapes untrusted content", () => {
  assert.equal(safeCell('=HYPERLINK("bad")'), '\'=HYPERLINK("bad")');
  const files = unzipSync(
    workbook([{ name: "<script>&", value: "=1+1", ar: "فحص" }]),
  );
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert(sheet.includes("&lt;script&gt;&amp;"));
  assert(!sheet.includes("<f>"));
  assert(sheet.includes("فحص"));
  assert(sheet.includes("&apos;=1+1"));
});
