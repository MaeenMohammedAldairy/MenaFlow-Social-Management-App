import { Router, type IRouter, type Request, type Response } from "express";
import { requestOwnerId } from "../lib/owner-access";
import {
  listPushTokens,
  registerPushToken,
  unregisterPushToken,
} from "../lib/push-notifications";
import { boundedString, recordOrEmpty } from "../lib/value-utils";

const router: IRouter = Router();

/**
 * Expo push tokens are 20+ characters and contain no whitespace. The bounds
 * exist to reject junk and to stop an oversized string from being stored; the
 * format itself is deliberately not pattern-matched, because hardcoding
 * `ExponentPushToken[...]` would break the day Expo changes its prefix.
 */
const MIN_TOKEN_LENGTH = 20;
const MAX_TOKEN_LENGTH = 200;
const MAX_DEVICE_ID_LENGTH = 200;

const PLATFORMS = ["ios", "android", "web"] as const;
type Platform = (typeof PLATFORMS)[number];

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

/**
 * These endpoints are authenticated by user, not by workspace: a token belongs
 * to a device, and the same device serves every workspace its owner belongs to.
 * Requiring a workspace would also block registration during onboarding, before
 * a workspace exists — exactly when the app is first installed.
 *
 * Registration succeeds even when `EXPO_PUSH_ACCESS_TOKEN` is not configured on
 * the server. Enqueueing is suppressed in that case, but recording devices costs
 * nothing and means alerts start flowing the moment the operator sets the token,
 * with no client update required.
 */
router.post("/notifications/push-token", async (req: Request, res: Response, next) => {
  try {
    const userId = requestOwnerId(req);
    if (!userId) {
      res.status(401).json({
        error: "سجّل الدخول أولاً.",
        code: "PUSH_TOKEN_UNAUTHENTICATED",
      });
      return;
    }

    const body = recordOrEmpty(req.body);
    const token = boundedString(body.token, MAX_TOKEN_LENGTH);
    if (!token || token.length < MIN_TOKEN_LENGTH || /\s/.test(token)) {
      res.status(400).json({
        error: `رمز الإشعارات غير صالح. يجب أن يكون بين ${MIN_TOKEN_LENGTH} و${MAX_TOKEN_LENGTH} حرفًا بلا مسافات.`,
        code: "PUSH_TOKEN_INVALID",
      });
      return;
    }

    const platform = boundedString(body.platform, 16);
    if (!platform || !isPlatform(platform)) {
      res.status(400).json({
        error: "منصّة الجهاز غير مدعومة. القيم المقبولة: ios أو android أو web.",
        code: "PUSH_TOKEN_PLATFORM_INVALID",
      });
      return;
    }

    const deviceId = boundedString(body.deviceId, MAX_DEVICE_ID_LENGTH);

    await registerPushToken({ userId, token, platform, deviceId });

    res.status(201).json({ registered: true, token });
  } catch (error) {
    next(error);
  }
});

router.get("/notifications/push-tokens", async (req: Request, res: Response, next) => {
  try {
    const userId = requestOwnerId(req);
    if (!userId) {
      res.status(401).json({
        error: "سجّل الدخول أولاً.",
        code: "PUSH_TOKEN_UNAUTHENTICATED",
      });
      return;
    }

    res.json({ tokens: await listPushTokens(userId) });
  } catch (error) {
    next(error);
  }
});

router.delete("/notifications/push-token", async (req: Request, res: Response, next) => {
  try {
    const userId = requestOwnerId(req);
    if (!userId) {
      res.status(401).json({
        error: "سجّل الدخول أولاً.",
        code: "PUSH_TOKEN_UNAUTHENTICATED",
      });
      return;
    }

    // Accepts the token in the body or the query string: not every HTTP client
    // sends a body with DELETE, and sign-out must not silently leave a device
    // registered to receive another merchant's alerts.
    const raw = recordOrEmpty(req.body).token ?? recordOrEmpty(req.query).token;
    const token = boundedString(raw, MAX_TOKEN_LENGTH);
    if (!token) {
      res.status(400).json({
        error: "أرسل رمز الإشعارات المراد إزالته.",
        code: "PUSH_TOKEN_INVALID",
      });
      return;
    }

    const { removed } = await unregisterPushToken(userId, token);
    res.json({ removed });
  } catch (error) {
    next(error);
  }
});

export default router;
