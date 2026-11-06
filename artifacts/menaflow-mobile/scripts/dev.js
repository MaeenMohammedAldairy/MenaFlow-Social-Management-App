const path = require("node:path");
const { spawn } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { networkInterfaces } = require("node:os");

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
function isLoopbackDomain(domain) {
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(domain) ? domain : `http://${domain}`,
    );
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isPrivateIpv4(address) {
  const octets = address.split(".").map(Number);
  return (
    octets.length === 4 &&
    (octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168))
  );
}

function getLanAddress() {
  const candidates = Object.entries(networkInterfaces()).flatMap(
    ([name, addresses]) =>
      (addresses || [])
        .filter(
          (address) =>
            address.family === "IPv4" &&
            !address.internal &&
            isPrivateIpv4(address.address) &&
            !/virtual|vmware|vEthernet|wsl|docker|hyper-v|loopback|bluetooth/i.test(
              name,
            ),
        )
        .map((address) => ({
          address: address.address,
          priority: /wi-?fi|wlan|wireless/i.test(name)
            ? 0
            : /ethernet|^eth|^en\d/i.test(name)
              ? 1
              : 2,
        })),
  );
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates[0]?.address;
}

const configuredApiDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
const lanAddress = getLanAddress();
const apiDomain =
  configuredApiDomain && !isLoopbackDomain(configuredApiDomain)
    ? configuredApiDomain
    : lanAddress
      ? `http://${lanAddress}:5000`
      : null;
if (!apiDomain) {
  throw new Error(
    "Unable to determine this computer's LAN address. Set EXPO_PUBLIC_DOMAIN to its LAN URL, such as http://192.168.1.10:5000.",
  );
}

const env = {
  ...process.env,
  EXPO_PUBLIC_DOMAIN: apiDomain,
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:
    process.env.CLERK_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    "",
  EXPO_PUBLIC_AUTH_DISABLED: process.env.EXPO_PUBLIC_AUTH_DISABLED || "false",
};
console.log(`Using API at ${apiDomain}`);

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
      "--lan",
      "--port",
      String(process.env.EXPO_PORT || 8081),
    ],
    (code) => {
      process.exitCode = code;
    },
  );
}

startExpo();
