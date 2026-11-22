# وثيقة تصميم: الخطط والاستحقاقات والاشتراكات

**الحالة:** مقترح للمراجعة قبل التنفيذ · **التاريخ:** 2026-11-22 · **النطاق:** `artifacts/api-server`, `lib/db`, `artifacts/menaflow-mobile`, `artifacts/owner-console`
**الغرض:** تثبيت الأساس المعماري للخطط والاشتراكات قبل إضافة أي ميزة أخرى أو بوابة دفع.

---

## 1. الهدف

تحويل نظام الاشتراكات من «أعمدة موزّعة + حسابات ضمنية» إلى **ثلاثة كيانات صريحة**، بنقطة قرار واحدة، وآلة حالات مُقيَّدة، وسجل استخدام يمكن تدقيقه وإعادة حسابه.

### داخل النطاق
- نموذج البيانات المستهدف ومسار الترحيل إليه.
- حلّ الاستحقاق (من يُسمح له بماذا) ودورة الحصة.
- آلة حالات الاشتراك وكاتبها الوحيد.
- سجل الاستخدام (ledger) والعدّادات المشتقة.
- عقد الأخطاء وعقد الـAPI.
- الثوابت القابلة للاختبار، والرصد.

### خارج النطاق (صريحًا)
- اختيار مزوّد الدفع وتنفيذ الدفع/الفواتير/الضرائب.
- المقاعد والأدوار وتعدد المساحات.
- أي بيانات أو حسابات اختبارية.

---

## 2. المصطلحات

| المصطلح | المعنى |
| --- | --- |
| **Plan** | سياسة: مجموعة حدود (`postsCreated`, `aiGenerations`, `channels`) وسعر معلن. |
| **Subscription** | علاقة: أي خطة تسري، بأي حالة، وأي فترة، وأي مرجع لدى المزوّد. |
| **Entitlement** | النتيجة المحسوبة: `{ planId, limits, status, periodStart, periodEnd }` في لحظة زمنية. |
| **Meter** | عدّاد استهلاك: `postsCreated` أو `aiGenerations`. |
| **UsageEvent** | حدث استهلاك واحد غير قابل للتعديل، بمفتاح idempotency. |
| **Period** | الفترة التي تُحسب فيها الحصة؛ تُشتق من دورة الفوترة، أو الشهر الميلادي لغير المشتركين. |

---

## 3. القرارات المعمارية

### ADR-1 — فصل الخطة عن الاشتراك عن الاستخدام
**السياق:** اليوم `mena_workspace_subscriptions` تحمل الخطة والحالة والتجربة والفترة، والاستخدام في جدول آخر، وحساب «الخطة الفعلية» يحدث عند كل قراءة.
**القرار:** الخطة كتالوج في الكود (نسخة مع الكود)، الاشتراك صف حالة، الاستخدام سجل أحداث.
**الأثر:** يمكن تغيير السياسة بلا لمس بيانات الاشتراك، وإعادة حساب الحصص من السجل، وفصل منطق الفوترة عن منطق المنتج.

### ADR-2 — الاستحقاق دالة نقية + نقطة تحقق واحدة
**السياق:** أربع نقاط فرض اليوم: `callMeteredAiProvider` في ٤ مسارات (وتسويق واتساب خارجها)، حد المنشورات في مُشغّل قاعدة بيانات، حد القنوات في `routes/social.ts` و`routes/meta.ts`.
**القرار:** وحدة `lib/entitlements.ts` بواجهة واحدة:

```ts
resolveEntitlements(state: SubscriptionState, now: Date): Entitlements   // نقية
loadEntitlements(workspaceId: string): Promise<Entitlements>             // من قاعدة البيانات ثم النقية
assertCan(entitlements: Entitlements, gate: Gate): void                  // يرمي QuotaError مصنّفًا
consume(workspaceId, meter, input): Promise<ConsumptionResult>            // الكتابة الوحيدة للاستهلاك
```

**قاعدة حدود:** لا يُسمح باستدعاء `callAiProvider` إلا داخل `metered-ai-provider.ts`، ولا باستدعاء `consume` إلا من الخدمة.
**الأثر:** تغيير حدّ واحد يحدث في مكان واحد، وتصبح الحصص قابلة للاختبار بجدول حالات.

### ADR-3 — آلة حالات صريحة وكاتب واحد
**السياق:** `status` يُكتب مرة عند الإنشاء؛ `trialing → free` يحدث ضمنيًا في `effectivePlanId`؛ `past_due` و`canceled` حالتان ميتتان.
**القرار:** انتقالات مسموحة فقط، وكلمة مرور واحدة: `applySubscriptionTransition()`؛ لا `UPDATE` على الاشتراك من أي مكان آخر.
**الأثر:** كل تغيير خطة/حالة له سجل ومنع للحالات المستحيلة.

### ADR-4 — الاستخدام سجل أحداث، والعدّادات عرض مشتق
**السياق:** عدّادان فقط؛ لا نعرف مصدر الاستهلاك، والمسودات تُحتسب، والحذف لا يُرجع، وإعادة المحاولة قد تُحتسب مرتين.
**القرار:** `mena_usage_events` (append-only) بمفتاح `idempotency_key` فريد، والعدّاد الحالي يبقى **ذاكرة عرض** تُحدَّث في نفس المعاملة ويمكن إعادة بنائها.
**الأثر:** إصلاح أي انحراف بضربة واحدة، وتفصيل «كم استهلكت الردود الآلية مقابل توليد المحتوى»، ومنع الاحتساب المزدوج.

### ADR-5 — دورة الحصة = دورة الفوترة
**السياق:** المفتاح `YYYY-MM` (شهر ميلادي UTC) بغض النظر عن بداية الاشتراك.
**القرار:** للمشترك النشط: `periodKey` مشتق من `current_period_start`؛ وللمجاني/التجربة: الشهر الميلادي UTC.
**الأثر:** لا تُصفَّر حصة عميل دفع في منتصف دورته.

### ADR-6 — تصنيف الأخطاء عقد مشترك
**القرار:** أربع فئات فقط، لكل خطأ فئة واحدة، وهي التي تحدد السلوك في الخادم والعرض في التطبيق:
| الفئة | المعنى | السلوك |
| --- | --- | --- |
| `retryable` | عطل عابر (شبكة، 5xx، مهلة) | إعادة محاولة مع تراجع زمني |
| `user_action` | يحتاج تدخل المستخدم (حصة، خطة، صلاحية ربط) | لا إعادة؛ عرض سبب + إجراء مقترح |
| `config` | خطأ تكوين (مفتاح ناقص، موديل غير موجود) | لا إعادة؛ تنبيه للمالك |
| `unknown_outcome` | أُرسل الطلب ولا نعرف النتيجة | **يُمنع** الإعادة تلقائيًا |

### ADR-7 — العقد المُدار
**السياق:** `lib/api-spec/openapi.yaml` يغطي ٢٥ مسارًا، والواقع ~٨٦، وأنواع وارد Meta مكتوبة يدويًا في التطبيق.
**القرار:** كل مسار جديد يدخل العقد قبل التنفيذ؛ الأنواع تُولَّد لا تُكتب يدويًا. تُطوى الأنواع اليدوية تدريجيًا، ويُمنع إضافة نوع يدوي جديد لنفس الاستجابة.

### ADR-8 — لا استدعاء مزوّد خارج البوابة
**القرار:** أي استدعاء لمزوّد خارجي (AI، Meta، Evolution) يمر عبر وحدة بوابة واحدة لكل مزوّد تحمل: العدّاد، الزمن، المهلة، تصنيف الخطأ، ومنع الإرسال المزدوج.
**الأثر:** سياسة واحدة قابلة للتغيير (حدود المعدل، الحصص، الإعادة) بدل تكرارها في كل مسار.

---

## 4. نموذج البيانات المستهدف

### 4.1 الكتالوج (كود لا جدول)
`artifacts/api-server/src/lib/plan-catalog.ts` — مصدر وحدة واحدة، يُصدَّر للـAPI وللواجهة عبر `/api/plans`.

```ts
export const PLAN_CATALOG = {
  free:    { name: "مجاني", priceUsd: 0,  limits: { postsCreated: 10,  aiGenerations: 10,  channels: 2 } },
  starter: { name: "بداية", priceUsd: 9,  limits: { postsCreated: 100, aiGenerations: 100, channels: 3 } },
  growth:  { name: "نمو",   priceUsd: 29, limits: { postsCreated: 500, aiGenerations: 500, channels: 3 } },
} as const;
export const TRIAL_PLAN = "growth";
export const TRIAL_DAYS = 7;
```

> سبب بقاء الكتالوج في الكود: الحدود والأسعار سياسة مرتّبة بترتيب النشر، ولا حاجة لتحريرها وقت التشغيل. إن ظهرت الحاجة لاحقًا، تُضاف `mena_plan_overrides` كطبقة فوقه لا كبديل.

### 4.2 توسعة جدول الاشتراك

```sql
ALTER TABLE mena_workspace_subscriptions
  ADD COLUMN cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN version integer NOT NULL DEFAULT 1,           -- تحكم تفاؤلي بالتزامن
  ADD COLUMN trial_started_at timestamptz;                  -- لتثبيت مدة التجربة
```

**قواعد ثابتة:**
- صف واحد لكل مساحة (فريد موجود).
- `plan_id` داخل الكتالوج.
- للمشترك النشط: `current_period_start` و`current_period_end` **غير فارغين دائمًا**.
- كل `UPDATE` يزيد `version` ويشترط القيمة السابقة.

### 4.3 سجل أحداث دورة الحياة

```sql
CREATE TABLE mena_subscription_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES mena_workspaces(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'trial_started','trial_expired','activated','plan_changed',
    'past_due','recovered','canceled','reactivated','provider_synced'
  )),
  from_plan text, to_plan text, from_status text, to_status text,
  actor text NOT NULL CHECK (actor IN ('system','owner','provider')),
  actor_id text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mena_subscription_events_workspace_idx
  ON mena_subscription_events (workspace_id, created_at DESC);
```

هذا الجدول هو **سجل التدقيق** لعمليات الخطط: يغلق حاجة «تغيير الخطة بلا أثر» بدل بناء لوحة كتابة بلا تاريخ.

### 4.4 سجل الاستخدام

```sql
CREATE TABLE mena_usage_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES mena_workspaces(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  meter text NOT NULL CHECK (meter IN ('aiGenerations','postsCreated')),
  feature text NOT NULL,                -- 'auto_reply','content','extraction','marketing',...
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  idempotency_key text NOT NULL,
  source_ref text,                      -- معرّف العملية: post id / job id / request id
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key)
);
CREATE INDEX mena_usage_events_workspace_period_idx
  ON mena_usage_events (workspace_id, period_key, meter);
```

**العدّاد يبقى** `mena_workspace_subscription_usage` كذاكرة عرض:
- يُكتب في **نفس معاملة** الحدث.
- يمكن إعادة بنائه: `INSERT ... SELECT count(*) FROM mena_usage_events GROUP BY ...`.
- لا مصدر حقيقة إلا السجل.

### 4.5 الكاتب الوحيد لعدّاد المنشورات
**اليوم:** مُشغّل `mena_posts_subscription_limit` يرفع العدّاد.
**القرار:** المُشغّل يصبح **حارسًا فقط** (يرفض التجاوز بالاعتماد على العدّاد)، والخدمة تكتب العدّاد والحدث في معاملة واحدة. يبقى الحارس لمنع أي إدخال يتجاوز الخدمة، ويصبح هناك كاتب واحد.

---

## 5. آلة الحالات

```
            ┌────────────── trial_expired ──────────────┐
            │                                           ▼
 (creation) trialing ── activate ──► active ──► past_due ──► canceled
                                      │  ▲        │            ▲
                           plan_change│  │recovered│           │cancel
                                      │  └─────────┘           │
                                      └──────── cancel ────────┘
                                            (cancel_at_period_end)
```

| من | إلى | المُشغِّل | الشروط | الآثار |
| --- | --- | --- | --- | --- |
| `trialing` | `active` | provider / owner | دفعة ناجحة أو منح صريح | تعبئة الفترة من المزوّد |
| `trialing` | `free` (status=`active`, plan=`free`) | نظام | `trial_ends_at <= now` | حدث `trial_expired` |
| `active` | `past_due` | provider | فشل تحصيل | مهلة سماح محددة في السياسة |
| `past_due` | `active` | provider | تحصيل ناجح | حدث `recovered` |
| `active`/`past_due` | `canceled` | owner / provider | طلب إلغاء أو انتهاء السماح | `cancel_at_period_end` أو إلغاء فوري حسب الطلب |
| `canceled` | `active` | owner | إعادة تفعيل قبل نهاية الفترة | حدث `reactivated` |

**ضوابط:**
- كل انتقال يمر عبر `applySubscriptionTransition(workspaceId, target, { actor, reason, period? })` داخل معاملة.
- الانتقالات غير المذكورة تُرفض برمز `SUBSCRIPTION_TRANSITION_INVALID`.
- كل انتقال يكتب صفًا في `mena_subscription_events` قبل الإرجاع.

---

## 6. حلّ الاستحقاق

```ts
type SubscriptionState = {
  planId: PlanId; status: SubscriptionStatus;
  trialStartedAt: Date | null; trialEndsAt: Date | null;
  currentPeriodStart: Date | null; currentPeriodEnd: Date | null;
};

function resolveEntitlements(state, now): Entitlements {
  // 1) تجربة سارية: حدود TRIAL_PLAN
  // 2) نشط: حدود plan_id، والفترة من current_period_*
  // 3) past_due: حدود plan_id لكن مع علامة grace: السماح بالقراءة والنشر المجدول، ومنع الإنفاق الجديد (سياسة)
  // 4) ملغى/منتهي: حدود free، والفترة شهر ميلادي UTC
}
```

**جدول الحالات الذي يجب أن يُختبر حرفيًا:** (trialing ساري / trialing منتهٍ / active / past_due داخل السماح / past_due بعد السماح / canceled قبل نهاية الفترة / canceled بعدها / صف مفقود ⇒ مجاني).

**صف مفقود:** `loadEntitlements` تُنشئ صفًا مجانيًا وتُكمل (`subscription.self_healed`) بدل رمي `WORKSPACE_SUBSCRIPTION_MISSING` الذي يُسقط الطلب بـ500 اليوم.

---

## 7. دورة الحصة

| الحالة | `periodKey` | بداية/نهاية الفترة |
| --- | --- | --- |
| مشترك نشط | من `current_period_start` بصيغة `YYYY-MM-DD` | من المزوّد |
| تجربة | `trial:<تاريخ البداية>` | من `trial_started_at` |
| مجاني/ملغى | `YYYY-MM` (UTC) | الشهر الميلادي |

- الوقت دائمًا UTC، ويُحقن `now` كوسيط (لا `Date.now()` داخل الدوال النقية) ليكون السلوك قابلًا للاختبار.
- الاستهلاك يستخدم `SELECT ... FOR UPDATE` على صف العدّاد (كما في `consumeSubscriptionUsage` اليوم).
- الاسترداد عند فشل المزوّد يبقى سلوكًا افتراضيًا (`releaseSubscriptionUsage`)، ويُسجَّل بحدث `quantity = -1` في السجل.
- **لوحة المالك** اليوم تحسب المفتاح بنفسها (`ownerUsagePeriodKey` في `lib/owner-console.ts`)؛ من المرحلة (ب) تقرأ الفترة من حلّ الاستحقاق نفسه، فلا يوجد حسابان للفترة في المشروع.

---

## 8. الأخطاء والأكواد

- وحدة واحدة `lib/error-codes.ts`: `code → { class, httpStatus, userMessageKey }`.
- الخادم يستخدم **الفئة** لاتخاذ القرار، لا نص الرسالة.
- التطبيق يستخدم **مفتاح الرسالة**، فلا تُترجم النصوص لكل شاشة.
- لا يُعاد نص مزوّد خام إلى العميل أبدًا؛ يُسجَّل في `pino` فقط.

أمثلة على الأكواد الجديدة الملزمة:
`SUBSCRIPTION_TRANSITION_INVALID`, `SUBSCRIPTION_LIMIT_REACHED:<meter>`, `SUBSCRIPTION_CONFIGURATION_MISSING`, `ENTITLEMENT_DENIED:<gate>`, `USAGE_EVENT_DUPLICATE`.

---

## 9. الواجهة البرمجية

| المسار | الطريقة | الوصف | حالة |
| --- | --- | --- | --- |
| `/api/plans` | GET | الكتالوج العام (بلا مصادقة) — مصدر نصوص التسويق أيضًا | جديد |
| `/api/subscription` | GET | الحالة والاستحقاقات والاستخدام والفترة القادمة | موجود، يُوسَّع |
| `/api/subscription/usage` | GET | تفصيل الاستهلاك حسب الميزة خلال الفترة | جديد |
| `/api/subscription/change` | POST | تغيير خطة فوري (مالك المنصة فقط، وفي غياب الدفع: بصلاحية صريحة) | جديد |
| `/api/subscription/cancel` · `/resume` | POST | إلغاء/إعادة تفعيل | مؤجّل حتى وجود مزوّد |
| `/api/subscription/checkout` · `/invoices` | — | يُصمَّم مع المزوّد | مؤجّل |

**قاعدة:** كل هذه المسارات تُدخل `lib/api-spec/openapi.yaml` أولًا (ADR-7).

---

## 10. الثوابت (تُختبر لا تُوثَّق فقط)

1. كل مساحة لها صف اشتراك واحد، ويُنشأ تلقائيًا إن غاب.
2. `plan_id` داخل الكتالوج، و`status` داخل الحالات.
3. كل مشترك نشط له `current_period_start` و`current_period_end`.
4. كل `UPDATE` على الاشتراك يمر عبر `applySubscriptionTransition` ويزيد `version`.
5. كل حدث استخدام له `idempotency_key`، والتكرار لا يرفع العدّاد.
6. مجموع العدّاد = `sum(quantity)` في السجل لنفس الفترة (قابل لإعادة الحساب والتحقق).
7. لا استدعاء لمزوّد AI خارج `metered-ai-provider.ts` (اختبار حارس على الشجرة).
8. لا استدعاء لـ`consume` خارج `entitlements.ts`.
9. كل مسار في `openapi.yaml` موجود فعلًا، وكل مسار جديد يدخل العقد (اختبار تكافؤ).

---

## 11. الأمان والخصوصية

- **لا بيانات بطاقات** تُخزَّن أو تصل الخادم؛ يتم التوجيه إلى صفحة المزوّد، وما يُخزَّن هو `provider_subscription_id` فقط.
- `payment_provider` و`provider_subscription_id` غير سرّيين بحد ذاتها، لكنهما يُقرآن فقط في مسارات المالك.
- الاستخدام يُخزَّن بمعرّفات ومراجع لا بنصوص العملاء.
- حذف مساحة عمل: يستهلك `mena_workspace_deletion_requests` (موجود بلا مسار) بمهلة معلنة، ويحذف السجلات تتابعيًا عبر `ON DELETE CASCADE`.
- تصدير البيانات: مسار واحد يعيد JSON منظمًا (اشتراك، استخدام، أحداث) بلا أسرار.

---

## 12. الرصد والتشغيل

- أحداث `pino` ثابتة الأسماء: `subscription.transition`, `subscription.self_healed`, `usage.consumed`, `usage.duplicate_ignored`, `entitlement.denied`.
- لوحة المالك تُضيف: عدد المساحات في كل حالة، تجارب ستنتهي خلال ٧ أيام، مساحات تجاوزت ٨٠٪، تغييرات خطط آخر ٣٠ يومًا (من سجل الأحداث).
- `/readyz` لا يتغير؛ تُضاف مهمة انتقال الحالات إلى حلقة العمّال وتسجّل نفسها كعامل `subscription-lifecycle`.

---

## 13. مسار الترحيل (آمن وقابل للتراجع)

| الخطوة | العمل | التراجع |
| --- | --- | --- |
| 1 | إضافة الأعمدة `cancel_at_period_end`, `version`, `trial_started_at` بقيم افتراضية | `DROP COLUMN` |
| 2 | إنشاء `mena_subscription_events` و`mena_usage_events` | `DROP TABLE` (لا يقرأ منهما شيء بعد) |
| 3 | تعبئة رجعية: حدث `trial_started` لكل مساحة تجريبية، و`current_period_*` = الشهر الحالي لغير المشتركين | حذف الصفوف المولّدة بوسم `metadata.backfill=true` |
| 4 | تعبئة رجعية للاستخدام: تحويل قيم العدّاد الحالية إلى حدث تجميعي واحد لكل (مساحة، فترة، مقياس) بمفتاح `backfill:<period>:<meter>` | حذف الأحداث الموسومة |
| 5 | تشغيل الخدمة الجديدة بوضع الكتابة المزدوجة: الحدث والعدّاد معًا (العدّاد يبقى مصدر الفرض أسبوعًا) | إيقاف الكتابة المزدوجة |
| 6 | تحويل الفرض إلى السجل + تحويل المُشغّل إلى حارس فقط | إعادة المُشغّل إلى وضعه الحالي |
| 7 | إزالة مسار العدّاد المباشر بعد التحقق من التعادل | — |

**معيار الانتقال بين الخطوتين ٥ و٦:** تطابق تام بين العدّاد ومجموع السجل على مدى ٧ أيام، وبلا أخطاء `USAGE_EVENT_DUPLICATE` غير مبرَّرة.

---

## 14. قرارات مفتوحة تحتاج حسمك

1. **سياسة `past_due`:** هل يبقى المنتج يعمل (قراءة + نشر مجدول) مع منع الإنفاق الجديد، أم يتوقف كل شيء؟ ومدة السماح؟
2. **المسودات:** تُحتسب من حصة المنشورات أم تُحتسب عند الجدولة/النشر فقط؟
3. **العملة والأسعار:** دولار فقط أم عرض بالريال؟ (لا يؤثر على النموذج، يؤثر على الكتالوج ونصوص العرض.)
4. **التخفيض:** هل تُفصل القنوات الزائدة أم تبقى مع منع الإضافة؟
5. **مدة الاحتفاظ بعد حذف المساحة:** ٣٠ يومًا؟ وهل النسخ الاحتياطية تُعالج بنفس المدة؟
6. **حدود التجربة:** هل تُمنح مرة واحدة لكل هوية أم لكل مساحة؟ (اليوم: مساحة واحدة لكل مستخدم، فالمسألة مؤجلة.)

---

## 15. المراحل ومعايير القبول

| المرحلة | المحتوى | معيار القبول |
| --- | --- | --- |
| **أ (بلا ترحيل)** | `plan-catalog`, `entitlements`, `error-codes`, self-heal، إغلاق ثغرة محاسبة التسويق، `/api/plans` | اختبارات جدول حالات الاستحقاق كلها تمر؛ لا استدعاء AI خارج البوابة؛ صف مفقود لا يُسقط الطلب |
| **ب (ترحيل واحد)** | الأعمدة + الجدولين + التعبئة الرجعية + آلة الحالات + دورة الفوترة + تحويل المُشغّل إلى حارس | الثوابت ١–٦ خضراء؛ تعادل العدّاد/السجل ٧ أيام؛ انتقالات مستحيلة مرفوضة |
| **ج** | العقد المُدار الكامل + لوحة المالك للحالات + تصميم الفواتير مع المزوّد | تكافؤ العقد مع المسارات؛ لا أنواع يدوية جديدة |

---

## 16. ملخص القرار في سطرين

**لا تُضِف ميزة جديدة قبل المرحلة (أ):** نقطة قرار واحدة، كتالوج واحد، أكواد واحدة.
**ولا تبدأ الدفع قبل المرحلة (ب):** لأن أي بوابة دفع ستُبنى فوق نموذج استخدام غير قابل للتدقيق، وستدفع ثمن إعادة كتابته بعد أول عميل.
