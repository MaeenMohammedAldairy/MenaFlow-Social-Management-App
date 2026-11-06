import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const envFile of [
  path.join(workspaceRoot, ".env"),
  path.join(workspaceRoot, ".env2"),
  path.join(workspaceRoot, "artifacts", "api-server", ".env"),
]) {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const port = Number(process.env.PORT || 5000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

const tunnel = spawn(
  "cloudflared",
  ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"],
  { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"] },
);

let api;
let app;
let stopping = false;

function stopChildren() {
  if (stopping) return;
  stopping = true;
  api?.kill();
  app?.kill();
  tunnel.kill();
}

process.once("SIGINT", stopChildren);
process.once("SIGTERM", stopChildren);

function waitForTunnelUrl() {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => finish(new Error(
      "Timed out waiting for Cloudflare Tunnel. Check your network and cloudflared installation.",
    )), 90_000);

    function finish(error, url) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(url);
    }

    function onData(chunk, destination) {
      const text = chunk.toString();
      destination.write(text);
      output = `${output}${text}`.slice(-20_000);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
      if (match) finish(null, match[0]);
    }

    tunnel.stdout.on("data", (chunk) => onData(chunk, process.stdout));
    tunnel.stderr.on("data", (chunk) => onData(chunk, process.stderr));
    tunnel.once("error", (error) => {
      finish(new Error(`Unable to start cloudflared: ${error.message}`));
    });
    tunnel.once("exit", (code, signal) => {
      finish(new Error(
        `cloudflared exited before creating a tunnel (code ${code ?? "none"}, signal ${signal ?? "none"}).`,
      ));
    });
  });
}

try {
  const publicBaseUrl = await waitForTunnelUrl();
  if (stopping) process.exit(0);

  console.log(`\nInstagram media URL: ${publicBaseUrl}`);
  console.log("Starting the API and Expo app with this temporary public HTTPS address. Keep this terminal open.\n");

  api = spawn(
    "pnpm",
    ["--filter", "@workspace/api-server", "run", "dev"],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        MENA_PUBLIC_MEDIA_BASE_URL: publicBaseUrl,
        EXPO_PUBLIC_DOMAIN: publicBaseUrl,
      },
      shell: process.platform === "win32",
      stdio: "inherit",
    },
  );

  app = spawn(
    "pnpm",
    ["--filter", "@workspace/menaflow-mobile", "run", "dev"],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        EXPO_PUBLIC_DOMAIN: publicBaseUrl,
        MENA_PUBLIC_MEDIA_BASE_URL: publicBaseUrl,
      },
      shell: process.platform === "win32",
      stdio: "inherit",
    },
  );

  tunnel.once("exit", (code, signal) => {
    if (stopping) return;
    console.error(`Cloudflare Tunnel stopped (code ${code ?? "none"}, signal ${signal ?? "none"}).`);
    process.exitCode = 1;
    stopChildren();
  });
  api.once("error", (error) => {
    console.error(`Unable to start the API server: ${error.message}`);
    process.exitCode = 1;
    stopChildren();
  });
  app.once("error", (error) => {
    console.error(`Unable to start the Expo app: ${error.message}`);
    process.exitCode = 1;
    stopChildren();
  });
  function stopServices(code, signal) {
    if (stopping) return;
    stopping = true;
    app?.kill();
    api?.kill();
    tunnel.kill();
    process.exitCode = code ?? (signal ? 1 : 0);
  }
  api.once("exit", stopServices);
  app.once("exit", stopServices);
} catch (error) {
  stopChildren();
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
