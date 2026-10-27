const path = require("node:path");
const { spawn } = require("node:child_process");
const { readFileSync } = require("node:fs");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..", "..");
const candidateEnvFiles = [
  path.resolve(workspaceRoot, ".env"),
  path.resolve(workspaceRoot, "..", ".env"),
  path.resolve(workspaceRoot, "..", ".env2"),
];
for (const envFile of candidateEnvFiles) {
  try {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const expoCli = require.resolve("expo/bin/cli", { paths: [projectRoot] });
const env = {
  ...process.env,
  EXPO_PACKAGER_PROXY_URL: process.env.REPLIT_EXPO_DEV_DOMAIN
    ? `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`
    : "",
  EXPO_PUBLIC_DOMAIN:
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.EXPO_PUBLIC_DOMAIN ||
    "localhost:5000",
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:
    process.env.CLERK_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    "",
  EXPO_PUBLIC_REPL_ID:
    process.env.REPL_ID || process.env.EXPO_PUBLIC_REPL_ID || "",
  EXPO_PUBLIC_AUTH_DISABLED: process.env.EXPO_PUBLIC_AUTH_DISABLED || "false",
  REACT_NATIVE_PACKAGER_HOSTNAME:
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REACT_NATIVE_PACKAGER_HOSTNAME ||
    "localhost",
};

function run(script, args, onExit) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  });
  child.on("error", (error) => {
    console.error("Failed to start development command:", error);
    process.exitCode = 1;
  });
  child.on("exit", (code) => onExit(code ?? 1));
}

function startExpo() {
  run(
    expoCli,
    [
      "start",
      "--localhost",
      "--port",
      String(process.env.EXPO_PORT || 8081),
    ],
    (code) => {
      process.exitCode = code;
    },
  );
}

if (process.env.REPLIT_EXPO_SESSION_SECRET) {
  const createLaunchCli = require.resolve("create-launch/build/index.js", {
    paths: [projectRoot],
  });
  run(createLaunchCli, ["login", "--session", process.env.REPLIT_EXPO_SESSION_SECRET], (code) => {
    if (code !== 0) {
      console.warn(`create-launch login exited with code ${code}`);
    }
    startExpo();
  });
} else {
  startExpo();
}
