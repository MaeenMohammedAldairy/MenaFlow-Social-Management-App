/**
 * Resolves Express's `trust proxy` setting from the environment.
 *
 * Why this exists: in production the process always sits behind a proxy
 * (Render/Vercel), so without `trust proxy` Express reports the *proxy's*
 * address as `req.ip`. Every rate limiter keyed on IP then pools all
 * unauthenticated traffic into a single bucket — one abusive client can lock
 * out every merchant on `/api/plans`, the OAuth callback and the webhooks, and
 * the limit itself is effectively global rather than per-client.
 *
 * Trusting a proxy that is not there is the mirror-image risk: a local client
 * could invent `X-Forwarded-For` and mint a fresh rate-limit key per request.
 * Hence the split default — one hop in production, nothing otherwise — and an
 * explicit override for deployments that sit behind more than one proxy.
 *
 * Only a *bounded* number of hops is ever trusted (`1..5`), never `true`,
 * because `true` trusts the whole chain and hands the client control of its own
 * apparent address.
 */
export type TrustProxySetting = boolean | number;

const MAX_TRUSTED_HOPS = 5;

export function resolveTrustProxy(
  env: NodeJS.ProcessEnv = process.env,
): TrustProxySetting {
  const raw = env.MENA_TRUST_PROXY?.trim();

  if (raw === undefined || raw === "") {
    return env.NODE_ENV === "production" ? 1 : false;
  }
  if (raw === "false" || raw === "off" || raw === "0") return false;
  if (raw === "true") return 1;

  const hops = Number(raw);
  if (Number.isInteger(hops) && hops >= 1 && hops <= MAX_TRUSTED_HOPS) {
    return hops;
  }

  // Fail fast rather than silently running with the wrong key: a typo here is
  // indistinguishable from "no rate limiting" once traffic arrives.
  throw new Error(
    `MENA_TRUST_PROXY must be "true"/"false" or an integer 1-${MAX_TRUSTED_HOPS} (hops), got "${raw}".`,
  );
}
