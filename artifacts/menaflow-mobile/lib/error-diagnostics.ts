/**
 * Turns a render error into something a user can report.
 *
 * Production builds hide the stack (and the console is not always reachable on a
 * phone), so the fallback screen shows a short stable code plus the original
 * message. The code is a hash of the error name and message: the same crash
 * always produces the same code, which makes "what did the screenshot say?"
 * enough to identify a report.
 */
export type ErrorDiagnostics = {
  code: string;
  name: string;
  message: string;
  stack: string;
};

function hash(value: string): string {
  let hashValue = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hashValue = ((hashValue * 33) ^ value.charCodeAt(index)) >>> 0;
  }
  return hashValue.toString(36).toUpperCase().padStart(5, "0").slice(0, 5);
}

export function describeError(error: unknown): ErrorDiagnostics {
  const isError = error instanceof Error;
  const name = isError && error.name ? error.name : "Error";
  const message =
    (isError ? error.message : String(error ?? "")).trim() ||
    "لم يرسل التطبيق أي رسالة مع الخطأ.";
  const stack = isError && error.stack ? error.stack : "";

  return {
    code: `MF-${hash(`${name}:${message}`)}`,
    name,
    message: message.length > 400 ? `${message.slice(0, 400)}…` : message,
    stack: stack.split("\n").slice(0, 10).join("\n"),
  };
}
