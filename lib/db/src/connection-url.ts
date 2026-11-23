/**
 * Parses the database connection string at startup.
 *
 * Split out of `index.ts` because that module builds the connection pool on
 * import, which makes anything defined there untestable in isolation. This one
 * is pure: a string in, a `URL` or a readable error out.
 *
 * The error message is the point. `new URL()` on a connection string whose
 * password contains un-encoded special characters throws Node's bare
 * `ERR_INVALID_URL`, and — worse — Node's error object echoes the entire input,
 * so the raw `TypeError` printed the database password into the deployment log
 * the first time this happened (Render, 2026-11-23: a password containing `?`
 * terminated the URL's authority early, the parse failed, and the crash report
 * carried the credential). A misconfigured connection string must therefore fail
 * with guidance and without the secret.
 *
 * Why such strings fail at all: in a URL, the authority (user:password@host) ends
 * at the first `/`, `?` or `#`. A password containing one of those, un-encoded,
 * cuts the authority short, so the host never parses. Percent-encoding the
 * password (`encodeURIComponent`) when assembling the string is the fix; choosing
 * a password made of URL-safe characters avoids the question entirely.
 */
export function parseDatabaseUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(
      "DATABASE_URL is not a valid URL. If the password contains special " +
        "characters (?, #, /, :, [, ], @, …) they must be percent-encoded in the " +
        "connection string — assemble it with encodeURIComponent(password), or " +
        "use a URL-safe password. Also check the value was not pasted twice. " +
        "The invalid value is deliberately not included in this message because " +
        "it contains the database password.",
    );
  }
}
