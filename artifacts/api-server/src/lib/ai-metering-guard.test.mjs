import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowedDirectly = new Set([
  // The provider itself defines the low-level call.
  join(sourceRoot, "lib", "ai-provider.ts"),
  // The metered wrapper is the only sanctioned way to reach the provider.
  join(sourceRoot, "lib", "metered-ai-provider.ts"),
]);

function sourceFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const providerImport =
  /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']*ai-provider(?:\.ts)?["']/g;

function importsProviderDirectly(text) {
  for (const match of text.matchAll(providerImport)) {
    const names = match[1].split(",").map((name) => name.trim());
    if (names.some((name) => name === "callAiProvider")) return true;
  }
  return false;
}

test("every AI call is metered: callAiProvider is imported only by the wrapper", () => {
  const violations = [];

  for (const file of sourceFiles(sourceRoot)) {
    if (allowedDirectly.has(file)) continue;
    if (!importsProviderDirectly(readFileSync(file, "utf8"))) continue;
    violations.push(relative(sourceRoot, file));
  }

  assert.deepEqual(
    violations,
    [],
    `These files must call callMeteredAiProvider instead of callAiProvider: ${violations.join(", ")}`,
  );
});

test("the metered wrapper is what consumes workspace AI quota", () => {
  const wrapper = readFileSync(
    join(sourceRoot, "lib", "metered-ai-provider.ts"),
    "utf8",
  );

  assert.match(wrapper, /consumeSubscriptionUsage\(workspaceId, "aiGenerations"\)/);
  assert.match(wrapper, /releaseSubscriptionUsage\(/);
});
