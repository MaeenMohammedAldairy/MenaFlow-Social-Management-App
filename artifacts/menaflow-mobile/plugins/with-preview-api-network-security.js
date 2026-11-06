const fs = require("node:fs/promises");
const path = require("node:path");
const {
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");

function isPrivateNetworkHost(hostname) {
  if (["localhost", "127.0.0.1", "10.0.2.2"].includes(hostname)) return true;

  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

module.exports = function withPreviewApiNetworkSecurity(config) {
  if (process.env.EAS_BUILD_PROFILE !== "preview") return config;

  const configuredDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (!configuredDomain) {
    throw new Error("Preview builds require EXPO_PUBLIC_DOMAIN.");
  }

  const apiUrl = new URL(
    /^https?:\/\//i.test(configuredDomain)
      ? configuredDomain
      : `https://${configuredDomain}`,
  );
  if (apiUrl.protocol !== "http:") return config;
  if (!isPrivateNetworkHost(apiUrl.hostname)) {
    throw new Error(
      "Preview HTTP APIs must use a loopback or private-network address.",
    );
  }

  config = withAndroidManifest(config, (androidConfig) => {
    const application = androidConfig.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error("Android application manifest is missing.");
    }

    application.$ = application.$ || {};
    application.$["android:networkSecurityConfig"] =
      "@xml/network_security_config";
    application.$["android:usesCleartextTraffic"] = "false";
    return androidConfig;
  });

  return withDangerousMod(config, [
    "android",
    async (androidConfig) => {
      const resourceDirectory = path.join(
        androidConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml",
      );
      await fs.mkdir(resourceDirectory, { recursive: true });
      await fs.writeFile(
        path.join(resourceDirectory, "network_security_config.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">${apiUrl.hostname}</domain>
  </domain-config>
</network-security-config>
`,
      );
      return androidConfig;
    },
  ]);
};
