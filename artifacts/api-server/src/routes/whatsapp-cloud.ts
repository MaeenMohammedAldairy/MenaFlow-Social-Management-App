import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  db,
  whatsappCloudConnections,
  whatsappCloudCredentials,
  whatsappCloudMessagingAccountPhoneNumbers,
  whatsappCloudMessagingAccounts,
  whatsappCloudPhoneNumbers,
} from "@workspace/db";
import { canManageMetaConnections } from "../lib/meta-oauth";
import {
  decryptMetaTokenForRotation,
  encryptMetaToken,
} from "../lib/meta-token-crypto";
import {
  requestWorkspaceContext,
  requestWorkspaceId,
  requireWorkspace,
} from "../lib/workspace-context";
import {
  inspectWhatsAppCloudAssets,
  parseWhatsAppCloudTestMessagingAccountIds,
  subscribeWhatsAppCloudApp,
  WhatsAppCloudMetaError,
  type WhatsAppCloudPhoneNumber,
} from "../lib/whatsapp-cloud-meta";

const router = Router();
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inputString(
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = body[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function connectionIdFromRequest(
  req: Request,
  res: Response,
): string | null {
  const connectionId = req.params.connectionId;
  if (typeof connectionId !== "string" || connectionId.length === 0) {
    res.status(400).json({
      error: "معرف اتصال WhatsApp Cloud غير صالح.",
      code: "INVALID_CONNECTION_ID",
    });
    return null;
  }
  return connectionId;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error.code === "23505" || error.code === "unique_violation")
  );
}

function canManageConnection(req: Request, res: Response): boolean {
  const context = requestWorkspaceContext(req);
  if (!context) {
    res.status(500).json({ error: "تعذر تحديد مساحة العمل." });
    return false;
  }
  if (!canManageMetaConnections(context.role)) {
    res.status(403).json({
      error: "يقتصر تعديل اتصالات Meta على مالك مساحة العمل.",
      code: "WORKSPACE_MANAGEMENT_REQUIRED",
    });
    return false;
  }
  return true;
}

function metaErrorResponse(res: Response, error: unknown): void {
  if (!(error instanceof WhatsAppCloudMetaError)) {
    res.status(502).json({
      error: "تعذر التحقق من حساب WhatsApp Cloud لدى Meta.",
      code: "META_UPSTREAM_FAILED",
    });
    return;
  }

  if (error.code === "META_CONFIGURATION_MISSING") {
    res.status(503).json({
      error: "إعداد إصدار Graph API غير صالح على الخادم.",
      code: error.code,
    });
    return;
  }
  if (error.code === "META_PERMISSION_MISSING") {
    res.status(422).json({
      error: "رمز الوصول لا يتضمن صلاحيات WhatsApp المطلوبة.",
      code: error.code,
    });
    return;
  }
  if (error.code === "META_ASSET_MISMATCH") {
    res.status(422).json({
      error: "رقم الهاتف المحدد غير مرتبط بحساب المراسلة.",
      code: error.code,
    });
    return;
  }
  if (error.code === "META_WEBHOOK_SUBSCRIPTION_FAILED") {
    res.status(error.httpStatus === 401 ? 422 : 502).json({
      error: error.httpStatus === 401
        ? "تعذر تفعيل Webhook لهذا الحساب. رمز الوصول غير صالح أو لا يملك الصلاحية المطلوبة."
        : "تم التحقق من الحساب، لكن تعذر تفعيل اشتراك Webhook لدى Meta.",
      code: error.code,
    });
    return;
  }
  if (error.httpStatus === 401) {
    res.status(422).json({
      error: "رمز الوصول غير صالح أو منتهي. تحقق منه في Meta ثم أعد المحاولة.",
      code: "META_TOKEN_INVALID",
    });
    return;
  }
  res.status(502).json({
    error: "تعذر التحقق من حساب WhatsApp Cloud لدى Meta.",
    code: "META_UPSTREAM_FAILED",
  });
}

function phoneNumberResponse(
  number: Pick<
    typeof whatsappCloudPhoneNumbers.$inferSelect,
    | "id"
    | "metaPhoneNumberId"
    | "phoneNumber"
    | "verifiedName"
    | "codeVerificationStatus"
    | "registrationStatus"
    | "qualityRating"
    | "platformType"
  >,
) {
  return {
    id: number.id,
    metaPhoneNumberId: number.metaPhoneNumberId,
    phoneNumber: number.phoneNumber,
    verifiedName: number.verifiedName,
    codeVerificationStatus: number.codeVerificationStatus,
    registrationStatus: number.registrationStatus,
    qualityRating: number.qualityRating,
    platformType: number.platformType,
  };
}

async function updatePhoneNumber(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workspaceId: string,
  environment: "test" | "production",
  phone: WhatsAppCloudPhoneNumber,
  observedAt: Date,
): Promise<string> {
  const [existing] = await transaction
    .select()
    .from(whatsappCloudPhoneNumbers)
    .where(
      and(
        eq(whatsappCloudPhoneNumbers.environment, environment),
        eq(
          whatsappCloudPhoneNumbers.metaPhoneNumberId,
          phone.metaPhoneNumberId,
        ),
      ),
    )
    .limit(1);

  if (existing && existing.workspaceId !== workspaceId) {
    throw new WhatsAppCloudMetaError("META_ASSET_MISMATCH", 422);
  }

  const internalId = existing?.id ?? randomUUID();
  if (existing) {
    await transaction
      .update(whatsappCloudPhoneNumbers)
      .set({
        phoneNumber: phone.phoneNumber,
        verifiedName: phone.verifiedName,
        codeVerificationStatus: phone.codeVerificationStatus,
        qualityRating: phone.qualityRating,
        platformType: phone.platformType,
        observedAt,
        updatedAt: observedAt,
      })
      .where(
        and(
          eq(whatsappCloudPhoneNumbers.workspaceId, workspaceId),
          eq(whatsappCloudPhoneNumbers.id, existing.id),
        ),
      );
  } else {
    await transaction.insert(whatsappCloudPhoneNumbers).values({
      id: internalId,
      workspaceId,
      environment,
      metaPhoneNumberId: phone.metaPhoneNumberId,
      phoneNumber: phone.phoneNumber,
      verifiedName: phone.verifiedName,
      codeVerificationStatus: phone.codeVerificationStatus,
      qualityRating: phone.qualityRating,
      platformType: phone.platformType,
      observedAt,
      createdAt: observedAt,
      updatedAt: observedAt,
    });
  }
  return internalId;
}

router.post(
  "/social/whatsapp-cloud/test-connections",
  requireWorkspace,
  async (req, res, next) => {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.MENA_WHATSAPP_CLOUD_TEST_ENABLED !== "true"
    ) {
      res.status(503).json({
        error: "إعداد اتصالات WhatsApp Cloud التجريبية غير مفعّل على الخادم.",
        code: "META_CONFIGURATION_MISSING",
      });
      return;
    }
    if (!canManageConnection(req, res)) return;
    const workspaceId = requestWorkspaceId(req);
    const context = requestWorkspaceContext(req);
    if (!context) {
      res.status(500).json({ error: "تعذر تحديد مساحة العمل." });
      return;
    }

    if (!isRecord(req.body)) {
      res.status(400).json({
        error: "أرسل بيانات حساب الاختبار بصيغة صحيحة.",
        code: "INVALID_TEST_CONNECTION_INPUT",
      });
      return;
    }

    const accessToken = inputString(req.body, "accessToken", 8192);
    const messagingAccountId = inputString(
      req.body,
      "messagingAccountId",
      128,
    );
    const phoneNumberId = inputString(req.body, "phoneNumberId", 128);
    if (
      !accessToken ||
      /\s/.test(accessToken) ||
      accessToken.length < 20 ||
      !messagingAccountId ||
      !EXTERNAL_ID_PATTERN.test(messagingAccountId) ||
      !phoneNumberId ||
      !EXTERNAL_ID_PATTERN.test(phoneNumberId)
    ) {
      res.status(400).json({
        error: "بيانات حساب الاختبار أو رمز الوصول غير صالحة.",
        code: "INVALID_TEST_CONNECTION_INPUT",
      });
      return;
    }

    const allowedTestMessagingAccountIds =
      parseWhatsAppCloudTestMessagingAccountIds(
        process.env.MENA_WHATSAPP_CLOUD_TEST_MESSAGING_ACCOUNT_IDS,
      );
    if (!allowedTestMessagingAccountIds) {
      res.status(503).json({
        error: "لم تُضبط حسابات WhatsApp التجريبية المسموح بها على الخادم.",
        code: "META_CONFIGURATION_MISSING",
      });
      return;
    }
    if (!allowedTestMessagingAccountIds.has(messagingAccountId)) {
      res.status(422).json({
        error: "حساب المراسلة المحدد غير مسجل كحساب اختبار لهذا التطبيق.",
        code: "TEST_ACCOUNT_NOT_ALLOWED",
      });
      return;
    }

    let encryptedAccessToken: string;
    try {
      encryptedAccessToken = encryptMetaToken(accessToken);
    } catch (error) {
      if (error instanceof Error && error.message === "MISSING_ENCRYPTION_KEY") {
        res.status(503).json({
          error: "تشفير بيانات Meta غير مهيأ على الخادم.",
          code: "META_CONFIGURATION_MISSING",
        });
        return;
      }
      next(error);
      return;
    }

    try {
      const inspection = await inspectWhatsAppCloudAssets(
        accessToken,
        messagingAccountId,
        phoneNumberId,
      );
      await subscribeWhatsAppCloudApp(accessToken, messagingAccountId);
      const now = new Date();
      const connectionId = randomUUID();
      const internalMessagingAccountId = randomUUID();

      await db.transaction(async (transaction) => {
        await transaction.insert(whatsappCloudConnections).values({
          id: connectionId,
          workspaceId,
          environment: "test",
          onboardingMethod: "developer_test",
          status: "connected",
          createdBy: context.userId,
          lastCheckedAt: now,
          lastCheckStatus: "passed",
          lastErrorCode: null,
          createdAt: now,
          updatedAt: now,
        });
        await transaction.insert(whatsappCloudCredentials).values({
          workspaceId,
          connectionId,
          encryptedAccessToken,
          accessTokenExpiresAt: null,
          grantedPermissions: inspection.grantedPermissions,
          permissionsCheckedAt: now,
          updatedAt: now,
        });
        await transaction.insert(whatsappCloudMessagingAccounts).values({
          id: internalMessagingAccountId,
          workspaceId,
          environment: "test",
          connectionId,
          whatsappAccountId: null,
          metaMessagingAccountId: inspection.messagingAccountId,
          displayName: null,
          observedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        for (const phone of inspection.phoneNumbers) {
          const internalPhoneNumberId = await updatePhoneNumber(
            transaction,
            workspaceId,
            "test",
            phone,
            now,
          );
          await transaction
            .insert(whatsappCloudMessagingAccountPhoneNumbers)
            .values({
              workspaceId,
              environment: "test",
              messagingAccountId: internalMessagingAccountId,
              phoneNumberId: internalPhoneNumberId,
              observedAt: now,
            });
        }
      });

      res.status(201).json({
        id: connectionId,
        environment: "test",
        status: "connected",
        checkedAt: now.toISOString(),
        messagingAccount: {
          id: internalMessagingAccountId,
          metaMessagingAccountId: inspection.messagingAccountId,
          displayName: null,
          phoneNumbers: inspection.phoneNumbers.map((phone) => ({
            metaPhoneNumberId: phone.metaPhoneNumberId,
            phoneNumber: phone.phoneNumber,
            verifiedName: phone.verifiedName,
            codeVerificationStatus: phone.codeVerificationStatus,
            qualityRating: phone.qualityRating,
            platformType: phone.platformType,
          })),
        },
      });
    } catch (error) {
      if (error instanceof WhatsAppCloudMetaError) {
        metaErrorResponse(res, error);
        return;
      }
      if (isUniqueViolation(error)) {
        res.status(409).json({
          error: "حساب أو رقم Meta مرتبط بالفعل بمساحة عمل أخرى.",
          code: "EXTERNAL_ACCOUNT_ALREADY_LINKED",
        });
        return;
      }
      next(error);
    }
  },
);

router.get(
  "/social/whatsapp-cloud/connections",
  requireWorkspace,
  async (req, res, next) => {
    const workspaceId = requestWorkspaceId(req);
    try {
      const connections = await db
        .select()
        .from(whatsappCloudConnections)
        .where(eq(whatsappCloudConnections.workspaceId, workspaceId));
      const ids = connections.map((connection) => connection.id);
      const messagingAccounts = ids.length
        ? await db
            .select()
            .from(whatsappCloudMessagingAccounts)
            .where(
              and(
                eq(whatsappCloudMessagingAccounts.workspaceId, workspaceId),
                inArray(whatsappCloudMessagingAccounts.connectionId, ids),
              ),
            )
        : [];
      const messagingIds = messagingAccounts.map((account) => account.id);
      const phoneRows = messagingIds.length
        ? await db
            .select({
              messagingAccountId:
                whatsappCloudMessagingAccountPhoneNumbers.messagingAccountId,
              id: whatsappCloudPhoneNumbers.id,
              metaPhoneNumberId:
                whatsappCloudPhoneNumbers.metaPhoneNumberId,
              phoneNumber: whatsappCloudPhoneNumbers.phoneNumber,
              verifiedName: whatsappCloudPhoneNumbers.verifiedName,
              codeVerificationStatus:
                whatsappCloudPhoneNumbers.codeVerificationStatus,
              registrationStatus: whatsappCloudPhoneNumbers.registrationStatus,
              qualityRating: whatsappCloudPhoneNumbers.qualityRating,
              platformType: whatsappCloudPhoneNumbers.platformType,
            })
            .from(whatsappCloudMessagingAccountPhoneNumbers)
            .innerJoin(
              whatsappCloudPhoneNumbers,
              and(
                eq(
                  whatsappCloudPhoneNumbers.workspaceId,
                  whatsappCloudMessagingAccountPhoneNumbers.workspaceId,
                ),
                eq(
                  whatsappCloudPhoneNumbers.environment,
                  whatsappCloudMessagingAccountPhoneNumbers.environment,
                ),
                eq(
                  whatsappCloudPhoneNumbers.id,
                  whatsappCloudMessagingAccountPhoneNumbers.phoneNumberId,
                ),
              ),
            )
            .where(
              and(
                eq(
                  whatsappCloudMessagingAccountPhoneNumbers.workspaceId,
                  workspaceId,
                ),
                inArray(
                  whatsappCloudMessagingAccountPhoneNumbers.messagingAccountId,
                  messagingIds,
                ),
              ),
            )
        : [];
      const numbersByMessagingAccount = new Map<string, typeof phoneRows>();
      for (const phone of phoneRows) {
        const current =
          numbersByMessagingAccount.get(phone.messagingAccountId) ?? [];
        current.push(phone);
        numbersByMessagingAccount.set(phone.messagingAccountId, current);
      }

      res.json({
        connections: connections.map((connection) => ({
          id: connection.id,
          environment: connection.environment,
          onboardingMethod: connection.onboardingMethod,
          status: connection.status,
          lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null,
          lastCheckStatus: connection.lastCheckStatus,
          lastErrorCode: connection.lastErrorCode,
          createdAt: connection.createdAt.toISOString(),
          messagingAccounts: messagingAccounts
            .filter((account) => account.connectionId === connection.id)
            .map((account) => ({
              id: account.id,
              metaMessagingAccountId: account.metaMessagingAccountId,
              displayName: account.displayName,
              phoneNumbers: (
                numbersByMessagingAccount.get(account.id) ?? []
              ).map((phone) => ({
                id: phone.id,
                metaPhoneNumberId: phone.metaPhoneNumberId,
                phoneNumber: phone.phoneNumber,
                verifiedName: phone.verifiedName,
                codeVerificationStatus: phone.codeVerificationStatus,
                registrationStatus: phone.registrationStatus,
                qualityRating: phone.qualityRating,
                platformType: phone.platformType,
              })),
            })),
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/social/whatsapp-cloud/connections/:connectionId",
  requireWorkspace,
  async (req, res, next) => {
    const connectionId = connectionIdFromRequest(req, res);
    if (!connectionId) return;
    const workspaceId = requestWorkspaceId(req);
    try {
      const [connection] = await db
        .select()
        .from(whatsappCloudConnections)
        .where(
          and(
            eq(whatsappCloudConnections.workspaceId, workspaceId),
            eq(whatsappCloudConnections.id, connectionId),
          ),
        )
        .limit(1);
      if (!connection) {
        res.status(404).json({
          error: "اتصال WhatsApp Cloud غير موجود.",
          code: "CONNECTION_NOT_FOUND",
        });
        return;
      }
      res.json({
        id: connection.id,
        environment: connection.environment,
        onboardingMethod: connection.onboardingMethod,
        status: connection.status,
        lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null,
        lastCheckStatus: connection.lastCheckStatus,
        lastErrorCode: connection.lastErrorCode,
        createdAt: connection.createdAt.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/social/whatsapp-cloud/connections/:connectionId/phone-numbers",
  requireWorkspace,
  async (req, res, next) => {
    const connectionId = connectionIdFromRequest(req, res);
    if (!connectionId) return;
    const workspaceId = requestWorkspaceId(req);
    try {
      const [connection] = await db
        .select({ id: whatsappCloudConnections.id })
        .from(whatsappCloudConnections)
        .where(
          and(
            eq(whatsappCloudConnections.workspaceId, workspaceId),
            eq(whatsappCloudConnections.id, connectionId),
          ),
        )
        .limit(1);
      if (!connection) {
        res.status(404).json({
          error: "اتصال WhatsApp Cloud غير موجود.",
          code: "CONNECTION_NOT_FOUND",
        });
        return;
      }
      const messagingAccounts = await db
        .select({ id: whatsappCloudMessagingAccounts.id })
        .from(whatsappCloudMessagingAccounts)
        .where(
          and(
            eq(whatsappCloudMessagingAccounts.workspaceId, workspaceId),
            eq(
              whatsappCloudMessagingAccounts.connectionId,
              connectionId,
            ),
          ),
        );
      const messagingIds = messagingAccounts.map((account) => account.id);
      const numbers = messagingIds.length
        ? await db
            .select({
              messagingAccountId:
                whatsappCloudMessagingAccountPhoneNumbers.messagingAccountId,
              id: whatsappCloudPhoneNumbers.id,
              metaPhoneNumberId:
                whatsappCloudPhoneNumbers.metaPhoneNumberId,
              phoneNumber: whatsappCloudPhoneNumbers.phoneNumber,
              verifiedName: whatsappCloudPhoneNumbers.verifiedName,
              codeVerificationStatus:
                whatsappCloudPhoneNumbers.codeVerificationStatus,
              registrationStatus: whatsappCloudPhoneNumbers.registrationStatus,
              qualityRating: whatsappCloudPhoneNumbers.qualityRating,
              platformType: whatsappCloudPhoneNumbers.platformType,
            })
            .from(whatsappCloudMessagingAccountPhoneNumbers)
            .innerJoin(
              whatsappCloudPhoneNumbers,
              and(
                eq(
                  whatsappCloudPhoneNumbers.workspaceId,
                  whatsappCloudMessagingAccountPhoneNumbers.workspaceId,
                ),
                eq(
                  whatsappCloudPhoneNumbers.environment,
                  whatsappCloudMessagingAccountPhoneNumbers.environment,
                ),
                eq(
                  whatsappCloudPhoneNumbers.id,
                  whatsappCloudMessagingAccountPhoneNumbers.phoneNumberId,
                ),
              ),
            )
            .where(
              and(
                eq(
                  whatsappCloudMessagingAccountPhoneNumbers.workspaceId,
                  workspaceId,
                ),
                inArray(
                  whatsappCloudMessagingAccountPhoneNumbers.messagingAccountId,
                  messagingIds,
                ),
              ),
            )
        : [];
      res.json({ phoneNumbers: numbers.map(phoneNumberResponse) });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/social/whatsapp-cloud/connections/:connectionId/test",
  requireWorkspace,
  async (req, res, next) => {
    const connectionId = connectionIdFromRequest(req, res);
    if (!connectionId) return;
    const workspaceId = requestWorkspaceId(req);
    try {
      const [connection] = await db
        .select()
        .from(whatsappCloudConnections)
        .where(
          and(
            eq(whatsappCloudConnections.workspaceId, workspaceId),
            eq(whatsappCloudConnections.id, connectionId),
          ),
        )
        .limit(1);
      if (!connection) {
        res.status(404).json({
          error: "اتصال WhatsApp Cloud غير موجود.",
          code: "CONNECTION_NOT_FOUND",
        });
        return;
      }

      const [credential] = await db
        .select()
        .from(whatsappCloudCredentials)
        .where(
          and(
            eq(whatsappCloudCredentials.workspaceId, workspaceId),
            eq(
              whatsappCloudCredentials.connectionId,
              connection.id,
            ),
          ),
        )
        .limit(1);
      if (!credential) {
        res.status(409).json({
          error: "لا يحتوي الاتصال على اعتماد صالح للاختبار.",
          code: "CREDENTIAL_NOT_FOUND",
        });
        return;
      }

      const messagingAccounts = await db
        .select()
        .from(whatsappCloudMessagingAccounts)
        .where(
          and(
            eq(whatsappCloudMessagingAccounts.workspaceId, workspaceId),
            eq(
              whatsappCloudMessagingAccounts.connectionId,
              connection.id,
            ),
          ),
        );
      if (messagingAccounts.length === 0) {
        res.status(409).json({
          error: "لا يحتوي الاتصال على حساب مراسلة للاختبار.",
          code: "MESSAGING_ACCOUNT_NOT_FOUND",
        });
        return;
      }

      const token = decryptMetaTokenForRotation(
        credential.encryptedAccessToken,
      );
      if (token.rotatedCiphertext) {
        await db
          .update(whatsappCloudCredentials)
          .set({
            encryptedAccessToken: token.rotatedCiphertext,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(whatsappCloudCredentials.workspaceId, workspaceId),
              eq(
                whatsappCloudCredentials.connectionId,
                connection.id,
              ),
              eq(
                whatsappCloudCredentials.encryptedAccessToken,
                credential.encryptedAccessToken,
              ),
            ),
          );
      }

      const results = [];
      for (const account of messagingAccounts) {
        const [linkedPhone] = await db
          .select({
            metaPhoneNumberId:
              whatsappCloudPhoneNumbers.metaPhoneNumberId,
          })
          .from(whatsappCloudMessagingAccountPhoneNumbers)
          .innerJoin(
            whatsappCloudPhoneNumbers,
            and(
              eq(
                whatsappCloudPhoneNumbers.workspaceId,
                whatsappCloudMessagingAccountPhoneNumbers.workspaceId,
              ),
              eq(
                whatsappCloudPhoneNumbers.environment,
                whatsappCloudMessagingAccountPhoneNumbers.environment,
              ),
              eq(
                whatsappCloudPhoneNumbers.id,
                whatsappCloudMessagingAccountPhoneNumbers.phoneNumberId,
              ),
            ),
          )
          .where(
            and(
              eq(
                whatsappCloudMessagingAccountPhoneNumbers.workspaceId,
                workspaceId,
              ),
              eq(
                whatsappCloudMessagingAccountPhoneNumbers.messagingAccountId,
                account.id,
              ),
            ),
          )
          .limit(1);
        if (!linkedPhone) {
          throw new WhatsAppCloudMetaError("META_ASSET_MISMATCH", 422);
        }
        const inspection = await inspectWhatsAppCloudAssets(
          token.accessToken,
          account.metaMessagingAccountId,
          linkedPhone.metaPhoneNumberId,
        );
        await subscribeWhatsAppCloudApp(
          token.accessToken,
          account.metaMessagingAccountId,
        );
        results.push({
          metaMessagingAccountId: inspection.messagingAccountId,
          phoneNumbers: inspection.phoneNumbers.map((phone) => ({
            metaPhoneNumberId: phone.metaPhoneNumberId,
            phoneNumber: phone.phoneNumber,
            verifiedName: phone.verifiedName,
            codeVerificationStatus: phone.codeVerificationStatus,
            qualityRating: phone.qualityRating,
            platformType: phone.platformType,
          })),
          grantedPermissions: inspection.grantedPermissions,
        });
      }

      const now = new Date();
      await db
        .update(whatsappCloudConnections)
        .set({
          status: "connected",
          lastCheckedAt: now,
          lastCheckStatus: "passed",
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(whatsappCloudConnections.workspaceId, workspaceId),
            eq(whatsappCloudConnections.id, connection.id),
          ),
        );
      await db
        .update(whatsappCloudCredentials)
        .set({
          grantedPermissions: results.flatMap(
            (result) => result.grantedPermissions,
          ),
          permissionsCheckedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(whatsappCloudCredentials.workspaceId, workspaceId),
            eq(whatsappCloudCredentials.connectionId, connection.id),
          ),
        );

      res.json({
        id: connection.id,
        status: "connected",
        checkedAt: now.toISOString(),
        messagingAccounts: results,
      });
    } catch (error) {
      if (error instanceof WhatsAppCloudMetaError) {
        const now = new Date();
        await db
          .update(whatsappCloudConnections)
          .set({
            status:
              error.httpStatus === 401 ||
              error.code === "META_PERMISSION_MISSING"
                ? "reauthorization_required"
                : "connected",
            lastCheckedAt: now,
            lastCheckStatus: "failed",
            lastErrorCode: error.code,
            updatedAt: now,
          })
          .where(
            and(
              eq(whatsappCloudConnections.workspaceId, workspaceId),
              eq(whatsappCloudConnections.id, connectionId),
            ),
          );
        metaErrorResponse(res, error);
        return;
      }
      next(error);
    }
  },
);

router.delete(
  "/social/whatsapp-cloud/connections/:connectionId",
  requireWorkspace,
  async (req, res, next) => {
    if (!canManageConnection(req, res)) return;
    const connectionId = connectionIdFromRequest(req, res);
    if (!connectionId) return;
    const workspaceId = requestWorkspaceId(req);
    try {
      const disconnected = await db.transaction(async (transaction) => {
        const linkedPhoneNumbers = await transaction
          .select({
            id: whatsappCloudMessagingAccountPhoneNumbers.phoneNumberId,
          })
          .from(whatsappCloudMessagingAccountPhoneNumbers)
          .innerJoin(
            whatsappCloudMessagingAccounts,
            and(
              eq(
                whatsappCloudMessagingAccounts.workspaceId,
                whatsappCloudMessagingAccountPhoneNumbers.workspaceId,
              ),
              eq(
                whatsappCloudMessagingAccounts.environment,
                whatsappCloudMessagingAccountPhoneNumbers.environment,
              ),
              eq(
                whatsappCloudMessagingAccounts.id,
                whatsappCloudMessagingAccountPhoneNumbers.messagingAccountId,
              ),
            ),
          )
          .where(
            and(
              eq(whatsappCloudMessagingAccounts.workspaceId, workspaceId),
              eq(whatsappCloudMessagingAccounts.connectionId, connectionId),
            ),
          );
        const phoneNumberIds = [
          ...new Set(linkedPhoneNumbers.map(({ id }) => id)),
        ];
        const deleted = await transaction
          .delete(whatsappCloudConnections)
          .where(
            and(
              eq(whatsappCloudConnections.workspaceId, workspaceId),
              eq(whatsappCloudConnections.id, connectionId),
            ),
          )
          .returning({ id: whatsappCloudConnections.id });
        if (!deleted[0]) return false;

        if (phoneNumberIds.length > 0) {
          const stillLinkedPhoneNumbers = await transaction
            .select({
              id: whatsappCloudMessagingAccountPhoneNumbers.phoneNumberId,
            })
            .from(whatsappCloudMessagingAccountPhoneNumbers)
            .where(
              and(
                eq(
                  whatsappCloudMessagingAccountPhoneNumbers.workspaceId,
                  workspaceId,
                ),
                inArray(
                  whatsappCloudMessagingAccountPhoneNumbers.phoneNumberId,
                  phoneNumberIds,
                ),
              ),
            );
          const stillLinkedIds = new Set(
            stillLinkedPhoneNumbers.map(({ id }) => id),
          );
          const unlinkedPhoneNumberIds = phoneNumberIds.filter(
            (id) => !stillLinkedIds.has(id),
          );
          if (unlinkedPhoneNumberIds.length > 0) {
            await transaction
              .delete(whatsappCloudPhoneNumbers)
              .where(
                and(
                  eq(whatsappCloudPhoneNumbers.workspaceId, workspaceId),
                  inArray(
                    whatsappCloudPhoneNumbers.id,
                    unlinkedPhoneNumberIds,
                  ),
                ),
              );
          }
        }
        return true;
      });
      if (!disconnected) {
        res.status(404).json({
          error: "اتصال WhatsApp Cloud غير موجود.",
          code: "CONNECTION_NOT_FOUND",
        });
        return;
      }
      res.json({
        disconnected: true,
        externalRevocation: "not_requested",
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
