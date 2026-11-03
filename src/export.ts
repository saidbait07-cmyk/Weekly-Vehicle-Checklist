import { zipSync, strToU8 } from "fflate";
import { safeCell } from "./domain";
const xml = (v: unknown) =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
export function workbook(records: Record<string, unknown>[]): Uint8Array {
  const keys = Object.keys(records[0] || {});
  const rows = [
    keys,
    ...records.map((r) =>
      keys.map((k) =>
        safeCell(Array.isArray(r[k]) ? (r[k] as unknown[]).join("; ") : r[k]),
      ),
    ),
  ];
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, n) => `<row r="${n + 1}">${row.map((cell) => `<c t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const files: Record<string, string> = {
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="FleetGuard" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": sheet,
  };
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
    { level: 6 },
  );
}
export async function excel(
  records: Record<string, unknown>[],
  filename: string,
) {
  const bytes = workbook(records);
  const blob = new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename + ".xlsx";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
