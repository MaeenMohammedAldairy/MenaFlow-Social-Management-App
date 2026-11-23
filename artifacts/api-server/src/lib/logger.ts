import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Pino only serializes an Error under the `err` key by default, so a call like
 * `logger.error({ error }, "…")` would emit `{"error":{}}` and lose both the
 * message and the stack. These serializers keep the stack for the key names
 * this codebase actually uses, so converting a `console.error("…", error)` call
 * to the logger does not silently drop what an operator needs.
 */
export const serializeError = (value: unknown) => {
  if (!(value instanceof Error)) return value;
  return {
    type: value.name,
    message: value.message,
    stack: value.stack,
  };
};

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  serializers: {
    err: serializeError,
    error: serializeError,
    // Names used by specific catch blocks in whatsapp-sync and the worker loop.
    contextError: serializeError,
    productError: serializeError,
    unlockError: serializeError,
  },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
