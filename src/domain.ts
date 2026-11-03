import definition from "./checklist.json";
export type Language = "en" | "ar";
export type Role = "administrator" | "supervisor" | "driver";
export type Result = "pass" | "fail" | "na";
export interface Answer {
  item_no: number;
  result: Result | "";
  comment: string;
  photos: string[];
}
export const checklist = definition.items;
export const checks = checklist.filter((i) => i.kind === "check");
export function blankAnswers(): Answer[] {
  return checks.map((i) => ({
    item_no: i.source_row,
    result: "",
    comment: "",
    photos: [],
  }));
}
export function validateAnswers(answers: Answer[]): boolean {
  return (
    answers.length === 27 &&
    new Set(answers.map((a) => a.item_no)).size === 27 &&
    answers.every(
      (a) =>
        Number.isInteger(a.item_no) &&
        a.item_no >= 1 &&
        a.item_no <= 27 &&
        ["pass", "fail", "na"].includes(a.result) &&
        (a.result === "pass" || a.comment.trim().length > 0),
    )
  );
}
export function operationalDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Muscat",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function safeCell(value: unknown) {
  const s = String(value ?? "");
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
export function vehicleFromQr(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.origin !== location.origin || u.pathname !== location.pathname)
      return null;
    const id = u.searchParams.get("vehicle");
    return id && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}
