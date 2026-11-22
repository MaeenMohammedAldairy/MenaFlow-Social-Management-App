import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/worker.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });
}

// The owner console is served by this process (see `src/app.ts`), so it has to be
// built together with the API. Hosts that build only this package (Render runs
// `pnpm --filter @workspace/api-server build`) would otherwise ship without it
// and `/owner` would answer 503. A failure here never fails the API build: the
// API keeps working and `/owner` explains how to build the console.
function buildOwnerConsole() {
  if (process.env.MENA_SKIP_OWNER_CONSOLE_BUILD === "1") {
    console.log("[owner-console] skipped by MENA_SKIP_OWNER_CONSOLE_BUILD");
    return;
  }

  const consoleDir = path.resolve(artifactDir, "../owner-console");
  if (!existsSync(path.resolve(consoleDir, "package.json"))) {
    console.log("[owner-console] package not present, skipped");
    return;
  }

  const strategies = [
    {
      label: "package script",
      command: "pnpm",
      args: ["--filter", "@workspace/owner-console", "run", "build"],
      cwd: path.resolve(artifactDir, "../.."),
    },
    {
      label: "vite directly",
      command: process.execPath,
      args: [path.resolve(consoleDir, "node_modules/vite/bin/vite.js"), "build"],
      cwd: consoleDir,
    },
  ];

  for (const strategy of strategies) {
    try {
      execFileSync(strategy.command, strategy.args, {
        cwd: strategy.cwd,
        stdio: "inherit",
      });
      console.log(`[owner-console] built via ${strategy.label}`);
      return;
    } catch (error) {
      console.warn(
        `[owner-console] ${strategy.label} failed: ${error?.message ?? error}`,
      );
    }
  }

  console.warn(
    "[owner-console] not built; /owner answers 503 until the console is built",
  );
}

buildAll()
  .then(buildOwnerConsole)
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
