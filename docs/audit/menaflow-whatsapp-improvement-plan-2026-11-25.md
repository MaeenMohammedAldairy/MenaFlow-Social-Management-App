# خطة التحسين والتطوير لمسار واتساب — MenaFlow

**التاريخ:** 2026-11-25 · **الفرع:** `arena/da6815f3-menaflow-social-management-app`  
**مرجع التشخيص:** `docs/audit/menaflow-whatsapp-path-audit-2026-11-25.md`  
**الطبيعة:** مقترح تنفيذي **للعرض والموافقة فقط** — لم يُعدَّل كود ولم تُنفَّذ ترحيلات.

---

## 0. المبادئ الحاكمة لهذه الخطة

1. **إصلاح جذري أصغر تغيير ممكن** (`AGENTS.md`): أعيد استخدام الجداول والسياسات والعمال الموجودة قبل إضافة أي بنية جديدة.
2. **لا مسار موازٍ:** أي منطق يحتاجه كلٌّ من الزر والعامل يُستخرج إلى دالة مشتركة، ولا يُنسخ.
3. **السلامة قبل الذكاء:** أي حذف لجلسة Evolution يمرّ بالقواعد الحذرة الحالية (prefix، غير محمولة، رقم مطابق، حد 5/تشغيل) — لا استثناءات.
4. **كل تحسين له مقياس نجاح وقابلية إيقاف** عبر متغير بيئة، حتى يمكن إرجاعه فورًا.
5. **لا بيانات شخصية في السجلات الجديدة:** معرّفات مشفّرة/HMAC فقط، كما هو معمول به في `mena_inbound_webhook_events`.

**البنود الوحيدة التي تضيف بنية جديدة (تحتاج موافقتك صراحةً):**
- جدول `mena_whatsapp_opt_outs` (المرحلة 2) — لا يوجد مكان اليوم يحفظ "طلب التوقف".
- عاملان دوريان: تنظيف الجلسات اليتيمى والمزامنة المجدولة (المرحلة 1 و3) — لا يوجد عامل يستدعي المنطق الحالي.

---

## 1. الأهداف ومؤشرات النجاح القابلة للقياس

| # | الهدف | المؤشر الحالي | المستهدف بعد التنفيذ | نافذة القياس |
|---|---|---|---|---|
| G1 | استقبال الرسائل المباشرة | 0 رسالة، 388 رفض/7 أيام | ≥ 1 رسالة تجريبية محفوظة، `< 1%` رفض `UNKNOWN_INSTANCE` | 24 ساعة |
| G2 | إزالة الجلسات اليتيمى | يدوية فقط، واحدة ما زالت نشطة | لا مثيل `menaflow-*` غير محمول يرسل لأكثر من 15 دقيقة | مستمر |
| G3 | الرد الآلي والطلبات | 0 أحداث | رد واحد على الأقل + مسودة طلب عند كتابة "أريد طلب..." | اختبار حي |
| G4 | احترام الإيقاف | يعمل على الرسالة الحالية فقط | 100% من الرسائل اللاحقة بعد `stop` لا تُرد آليًا | اختبار + استعلام |
| G5 | المزامنة | يدوية بالكامل | تشغيل مجدول ينتهي `complete/partial` خلال 10 دقائق | يوميًا |
| G6 | المحتوى/المنتجات | 46 وظيفة `pending`، 0 منشور | إما تشغيل العامل أو واجهة تقول صراحة "يدوي" | بعد قرارك |
| G7 | الوسائط | 6 منتهية، 4 معلّقة | كل حالة معلّقة إما `stored` أو سبب نهائي ظاهر | 48 ساعة |
| G8 | الجودة | — | `pnpm typecheck` + `pnpm lint` + `pnpm test` ناجحة، ترحيل مطبَّق بـ dry-run | كل مرحلة |

---

## 2. خارطة العمل الإجمالية

| المرحلة | المدة | الأولوية | يضيف بنية؟ | الأثر |
|---|---|---|---|---|
| 0 — إصلاح تشغيلي فوري | 1–2 ساعة | P0 | لا | يعيد الصندوق للعمل اليوم |
| 1 — تنظيف اليتيمى تلقائيًا + مراقبة | 1–2 يوم | P0 | عامل واحد | يمنع تكرار المشكلة |
| 2 — إيقاف دائم (opt-out) | 1 يوم | P1 | جدول واحد | امتثال وحماية عميل |
| 3 — مزامنة مجدولة صحيحة | 1–2 يوم | P1 | عامل واحد + دالة مشتركة | يغلق فجوة "تلقائي" |
| 4 — قرار المحتوى والمنتجات | نصف يوم + قرار | P1 | لا | يزيل غموض الـ46 وظيفة |
| 5 — تحصين ومراقبة | 1 يوم | P2 | لا (قرار Redis لاحقًا) | يقلل المفاجآت |
| 6 — تحقق شامل واستلام | نصف يوم | — | لا | إثبات أن المسار يعمل |

**الإجمالي المتوقع:** 5–7 أيام عمل، منها يومان مرتبطان بقرارات منتج منك.

---

## 3. المرحلة 0 — إصلاح تشغيلي فوري (بدون كود)

**الهدف:** إعادة تدفق الأحداث قبل أي تطوير.

1. افتح شاشة **إعدادات الردود** → اضغط **«إعادة تسجيل الويب هوك»** للمساحة المتصلة (`menaflow-3c247db8a54d`).
2. اقرأ رسالة النتيجة: يجب أن تتضمن أن `menaflow-a898bc54ab23` **حُذف** (و`menaflow-2227c2a9e5a1` إن كان ما زال موجودًا). إن ظهر `CLAIMED_BY_WORKSPACE`، افصل واتساب من المساحة الأخرى أولًا — لا تُحذف جلسة تملكها مساحة حية.
3. أرسل رسالة من هاتف عميل إلى رقم الاتصال، ثم تحقق:
   - `mena_whatsapp_direct_messages` فيه صف `direction='inbound'` جديد.
   - `mena_inbound_webhook_events` آخر حدث `WHATSAPP_WEBHOOK_PROCESSED` وليس `UNKNOWN_INSTANCE`.
   - إن كان الرد الآلي مفعّلًا: صف `mena_whatsapp_auto_reply_events` بحالة `sent/queued`.
4. جرّب "أريد طلبًا..." للتحقق من `mena_whatsapp_order_intakes` ومسودة الطلب.
5. من شاشة المصادر: شغّل **مزامنة الآن** مع `includeHistory=false` (= إيقاف "رسائل سابقة") للتأكد أن المؤشر يعمل.
6. راجع `GET /api/readyz` وتأكد أن `workers` لا يحتوي `stale=true` أو `consecutiveErrors` متصاعدًا.

**التراجع:** حذف جلسة اليتيم مقصود (لا تملكها مساحة). إن حدث خطأ، أعد الربط من شاشة المصادر؛ لا توجد بيانات عميل في تلك الجلسة because رفضت كل أحداثها.

---

## 4. المرحلة 1 — منع تكرار الجلسة اليتيمى وجعلها مرئية

### 4.1 تشغيل تنظيف دوري بإعادة استخدام المنطق الحالي

**الملفات:** `artifacts/api-server/src/lib/whatsapp-orphan-instance-sweep.ts`, `artifacts/api-server/src/lib/app-workers.ts`.

- توسيع نوع `OrphanSweepTrigger` إلى `"scheduled"` (تبقى قواعد `planOrphanInstanceCleanup` كما هي دون تعديل).
- أضف دالة `sweepAllWhatsAppOrphans()`:
  - تأخذ قفل استشاري عام `pg_advisory_xact_lock(hashtextextended('menaflow:whatsapp-orphan-sweep',0))` حتى لا تعمل نسختان في وقت واحد.
  - تختار اتصالًا واحدًا بحالة `connected` كـ `workspaceId/keepInstanceName` للسياق فقط.
  - تستدعي `sweepOrphanWhatsAppInstances({ ..., phoneNumber: null, trigger: "scheduled" })`. **عدم تمرير رقم الهاتف مقصود**: الجلسات اليتيمى قد تحمل أي رقم، واسمها الحتمي يثبت أنها لتاجر محذوف؛ تمرير رقم التاجر الحالي كان سيتخطّاها بسبب `PHONE_NUMBER_MISMATCH`.
  - تُسجّل ملخصًا واحدًا: عدد المحذوف/المتخطّي/الفاشل وأسباب التخطي.
- سجّل عاملًا جديدًا في `app-workers.ts`:
  - الاسم `whatsapp-orphan-sweep`، الفترة 15 دقيقة، `enabled: process.env.WHATSAPP_ORPHAN_SWEEP_ENABLED !== "false"`.
  - حيث `run: sweepAllWhatsAppOrphans`.
  - لا يُكرر منطق الحذف؛ يستدعي الدالة الحالية فقط.

**لماذا لا نحذف تلقائيًا عند كل ويب هوك مرفوض؟** لأن المهاجم/المزوّد قد يغرق السجل بأسماء عشوائية. نحن نستخدم السجل كـ **مُحفّز** لا كمصدر أوامر (انظر أدناه)، والقفل+القواعد+الحد 5 تكفي.

### 4.2 مُحفّز من سجل الرفض (دائم، بلا حالة جديدة)

داخل `sweepAllWhatsAppOrphans()` قبل التنفيذ، استعلام خفيف على `mena_inbound_webhook_events`:

```sql
select count(*) from public.mena_inbound_webhook_events
where platform = 'whatsapp'
  and event = 'WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE'
  and created_at > now() - interval '15 minutes';
```

- إن كان العدد 0 ولم مرّ وقت `WHATSAPP_ORPHAN_SWEEP_MIN_INTERVAL_MS` (افتراضي 30 دقيقة) → تخطي.
- إن كان > 0 → تنفيذ فوري. هكذا يصبح التعافي أسرع من 15 دقيقة دون أن يتأثر بCopy متعدد العمليات.
- لا حاجة إلى جدول جديد: السجل موجود أصلًا ويُطهَّر تلقائيًا بعد 7 أيام.

### 4.3 الظهور للمشغّل والتاجر

- في `artifacts/api-server/src/routes/owner.ts` (قسم Overview)، أضف استعلام تجميعي واحدًا على `mena_inbound_webhook_events` لآخر 24 ساعة مجمّعًا بـ `event`، و premiersه في الاستجابة كـ `webhookEvents24h`.
- في `artifacts/owner-console/src/lib/types.ts` و`pages/Overview.tsx`، أضف بطاقة: **«ويب هوك واتساب مرفوض»** تعرض عدد `UNKNOWN_INSTANCE` مع تلميح "جلسة يتيمة — أعد التسجيل/افحص التنظيف".
- في `app/whatsapp-setup.tsx`، أضفfactًا واحدًا إلى `inboundFacts`: عدد رفوض آخر 24 ساعة، إن كان > 0 فقط (لا ضجيج عند الصفر).
- `/api/readyz` سيعرض العامل الجديد تلقائيًا عبر `backgroundWorkerSnapshots()`.

### 4.4 التحقق والاستلام

- اختبار وحدة جديد للدالة النقية التي تقرر "هل نُنفّذ؟" من (عدد الرفض، آخر تشغيل، الفاصل الأدنى) — ملف جديد `whatsapp-orphan-sweep-policy.test.mjs`.
- اختبار existing `whatsapp-orphan-instance-policy.test.mjs` يجب أن يمر بلا تعديل (القواعد لم تتغير).
- معيار القبول: بعد حقن حدث `UNKNOWN_INSTANCE` في بيئة اختبار، يظهر حذف الجلسة خلال دورة عامل واحدة، ولا يُحذف مثيل `'menaflow-*'` محمول أو غير تابع للبادئة.
- التراجع: `WHATSAPP_ORPHAN_SWEEP_ENABLED=false`.

---

## 5. المرحلة 2 — جعل "طلب التوقف" دائمًا

### 5.1 الترحيل (جديد، إضافي فقط)

ملف: `supabase/migrations/20261126000000_whatsapp_opt_outs.sql`

```sql
CREATE TABLE public.mena_whatsapp_opt_outs (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  instance_name text NOT NULL,
  remote_jid_hash text NOT NULL CHECK (remote_jid_hash ~ '^[0-9a-f]{64}$'),
  reason text NOT NULL DEFAULT 'CUSTOMER_REQUEST',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT mena_whatsapp_opt_outs_connection_fk
    FOREIGN KEY (workspace_id, instance_name)
    REFERENCES public.mena_whatsapp_connections (workspace_id, instance_name)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX mena_whatsapp_opt_outs_conversation_key
  ON public.mena_whatsapp_opt_outs (workspace_id, instance_name, remote_jid_hash);

CREATE INDEX mena_whatsapp_opt_outs_expiry_idx
  ON public.mena_whatsapp_opt_outs (expires_at);

ALTER TABLE public.mena_whatsapp_opt_outs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_whatsapp_opt_outs FROM anon, authenticated;
```

**الخطوات المرافقة إلزامية:** أضف الجدول إلى `lib/db/src/schema/social.ts`، ثم `pnpm --filter @workspace/db run generate` وإرسال الـ snapshot المولَّد، ثم `db push --dry-run --linked` قبل التطبيق. لا `drizzle-kit push` على قاعدة مشتركة.

### 5.2 المنطق

- في `lib/whatsapp-direct-messages.ts`: دوال نقية/صغيرة `whatsappOptOutKey(workspaceId, instance, jid)` = نفس `whatsappDirectConversationKeys()[0]` (إعادة استخدام، لا خوارزمية جديدة).
- في `lib/whatsapp-opt-out.ts`: توسيع مجموعة العبارات بصيغ آمنة فقط (`stop please`, `توقف عن الرسائل`, `لا ترسلوا لي`) مع اختبارات تمنع تطابق عبارات مثل ".stopped" أو نص منتج يحتوي "إلغاء".
- عند وصول رسالة واردة في `processWebhookEvent`:
  - إن كانت نصها طلب إيقاف → `insert ... onConflictDoUpdate` في الجدول الجديد + تسجيل حدث `WHATSAPP_OPT_OUT_RECORDED` + إشعار للتاجر بمعرّف المحادثة فقط.
  - قبل creation of auto-reply event: استعلام `exists` على الجدول؛ إن وُجد → تخطي مع سبب `WHATSAPP_CUSTOMER_OPTED_OUT` (يُسجَّل كـ skip لا كرفض ويب هوك).
- في `processWhatsAppAutoReplyAsync` (قبل التوليد وقبل الإرسال): إعادة الفحص نفسه — دفاع في العمق لأن الرسالة قد كانت قديمة عند الاصطفاف.
- في `processWhatsAppOrderIntake`: تخطي استقبال الطلبات الآلي لنفس المحادثة، لأنه شكل من الرد الآلي.

**قرار منتج مطروح:** الرد **اليدوي** من التاجر يبقى مسموحًا، ويظهر في الواجهة شارة «العميل طلب التوقف — الرد اليدوي فقط». إن أردت منع اليدوي أيضًا، أغيّر شرطًا واحدًا في `routes/whatsapp-direct-inbox.ts:312` وأضيف اختبارًا.

### 5.3 التحقق

- `whatsapp-opt-out.test.mjs` existing + اختبارات للعبارات الجديدة.
- اختبار تكامل: رسالة `stop` ثم رسالة سؤال → صفر أحداث رد جديدة، وصف opt-out واحد.
- استعلام استلام:
```sql
select remote_jid_hash, reason, created_at
from public.mena_whatsapp_opt_outs
where workspace_id = '<workspace>';
```

---

## 6. المرحلة 3 — مزامنة مجدولة صحيحة (بلا مفاجآت)

### 6.1 إصلاح خلل كامن أولًا

في `lib/whatsapp-sync.ts` → `syncGroupHistory`:

```ts
const persistedCursor = latestMessageCursor ?? persistedWhatsAppCursor(syncState.lastCursor);
const initialWindowMs = resolveWhatsAppInitialCatchUpMs(); // 24h، محصور 1h..7d
const syncStartedAt = persistedCursor
  ? persistedCursor
  : includeHistory
    ? new Date()
    : new Date(Date.now() - initialWindowMs);
```

**السبب:** اليوم، مجموعة بلا مؤشر و`includeHistory=false` تستخدم `now` كبداية، فيُصفّى كل التاريخ ولا يُستورد شيء. العامل المجدول سيعتمد على `includeHistory=false`، لذا يجب إصلاح هذا قبل تشغيله. أضف اختبارًا في `whatsapp-history.test.mjs` يثبت أن رسالة عمرها 3 ساعات تُستورد في التشغيل الأول.

### 6.2 دالة مشتركة للancer

استخرج من `routes/whatsapp-sync.ts:62` (POST sync-now) دالة:

```
startWhatsAppSyncForWorkspace(workspaceId, {
  includeHistory, historyLimit, respectAutoSync
}) → { status, groups, claimedGroupIds }
```

تحتوي على: فحص الاتصال، إعدادات المزامنة، `cancelStaleWhatsAppSyncs`، حلّ الهوية وتوسيع المجتمع، الادعاء الذري `UPDATE … WHERE status != 'running' RETURNING`، وإطلاق `syncGroupHistory` بـ `mapWithConcurrency`.  
المسار يستدعيها ويُبقي ردّ الـ202 كما هو؛ العامل يستدعيها بالخيارات `includeHistory:false, respectAutoSync:true`. **لا نسخ منطق.**

### 6.3 العامل

- الاسم `whatsapp-history-sync` في `app-workers.ts`، الفترة 30 دقيقة، `enabled: process.env.WHATSAPP_HISTORY_SYNC_WORKER_ENABLED !== "false"`.
- يقوم مرة واحدة لكل مساحة عمل:
  ```
  where connection.status='connected' && connection.autoSyncEnabled=true
  ```
  ثم يستدعي الدالة المشتركة. الحالات `running` تُتخطى تلقائيًا بالادعاء الذري.
- الحد الأقصى للعمل = `WHATSAPP_SYNC_RUN_BUDGET_MS` الحالي (10 دقائق) + نبض 60 ثانية + concurrency 3 — كلها موجودة، لا تُخترع حدود جديدة.
- أضف إلى `GET /sync-status` حقل `lastScheduledSyncAt` إن أردت إظهاره في لوحة المزامنة.

### 6.4 التحقق

- اختبارUnit للخيار الجديد (فارغ/قديم/مؤشر موجود).
- اختبار ادعاء: تشغيلان متزامنان → واحد فقط يحصل على `started` والآخر `already_running`.
- معيار القبول: تشغيل مجدول على مجموعة بها مؤشر ينتهي `complete` دون إعادة إدراج رسائل محفوظة (العدّاد `savedMessageCount` لا يتضاعف).
- التراجع: `WHATSAPP_HISTORY_SYNC_WORKER_ENABLED=false`.

---

## 7. المرحلة 4 — حسم مسار المحتوى والمنتجات

هذه مرحلة قرار لا اختراع كود:

| الخيار | الإجراء | الأثر المتوقع |
|---|---|---|
| **A — التحويل اليدوي (الوضع الحالي)** | أبقِ `WHATSAPP_MARKETING_WORKER_ENABLED=false`، وأضف نصًا ثابتًا في `WhatsAppSyncStatusPanel` ورسالة الحفظ في `SourcesScreen`: «التحويل إلى منشورات يتم يدويًا من سجل المجموعة» | تختفي الـ46 وظيفة `pending` من كونها لغزًا؛ تبقى طابورًا مقصودًا |
| **B — التحويل التلقائي** | اضبط `WHATSAPP_MARKETING_WORKER_ENABLED=true` في مضيف API وأعد التشغيل، ثم راقب `mena_content_jobs` و`mena_posts.source_type='whatsapp'` | تتحول الرسائل المؤهلة إلى مسودات مراجعة تلقائيًا |

**الوسائط والاستخراج (لا كود جديد):**
- الـ6 عناصر `WHATSAPP_MEDIA_EXPIRED_UPSTREAM` حالة نهائية صحيحة؛ اتركها واعرض رسالة "أعد إرسال الصورة" (موجودة أصلًا في الواجهة).
- الـ4 عناصر `pending` يعالجها عامل التنزيل الحالي تلقائيًا؛ لا تتدخل إلا إن بقيت بعد 24 ساعة.
- وظيفة الاستخراج `waiting_media`: بعد اكتمال الوسائط استخدم زر **إعادة المعالجة** الموجود أصلًا في `ProductCatalogScreen.tsx:2066` (نقطة `POST /social/products/whatsapp-extractions/:id/reprocess`) — لا تحتاج واجهة جديدة.
- وظيفة `waiting_association`: تُحل بقرار الاقتران في سجل المجموعة؛ لا حاجة لأتمتة إضافية لأن الاقتران الغامض يجب أن يبقى بيد التاجر.

---

## 8. المرحلة 5 — تحصين ومراقبة (P2)

1. **حدود المعدل:** الحالية في الذاكرة (`app.ts`) وتعمل بشكل صحيح مع نسخة API واحدة. إن كان النشر سيتعدد replica، فعندها فقط يُقرر مزوّد مشترك (Redis/Upstash) — **لا أضيفه الآن** لأنه يتطلب اعتمادية جديدة وقرار تكلفة.
2. **تنبيهات:** اجعل مراقب الأمان يفحص `/api/readyz` (عمال `stale`) + بطاقة لوحة المالك الجديدة (رفوض الويب هوك). لا مزوّد تنبيه جديد.
3. **الويب هوك:** حجم 1MB واستبعاد `MESSAGES_SET` مقصودان — وثّقهما في `docs/PRODUCTION_DEPLOYMENT.md` بجوار متغيرات Evolution حتى لا يظن أحد أنهما خلل.
4. **تغيير الإعدادات أثناء التشغيل:** إن كان مطلوبًا منع تغيير تعليمات الرد دون اختبار جديد، عدّل `routes/whatsapp-auto-replies.ts:310`: امسح `autoReplyTestedHash` عند أي `settingsChanged` حتى لو `settings.enabled=true`. سطر واحد + اختبار.
5. **الوثائق:** حدّث `docs/WHATSAPP_SYNC.md` بفصل قصير: "المزامنة المجدولة"، و`docs/INBOUND_DELIVERY_DIAGNOSTICS.md` بـ "التنظيف الدوري"، و`.env.example` بالمتغيرات الجديدة: `WHATSAPP_ORPHAN_SWEEP_ENABLED`, `WHATSAPP_ORPHAN_SWEEP_MIN_INTERVAL_MS`, `WHATSAPP_INITIAL_CATCH_UP_HOURS`, `WHATSAPP_HISTORY_SYNC_WORKER_ENABLED`.

---

## 9. المرحلة 6 — خطة التحقق والاستلام الكاملة

### 9.1 مصفوفة الاختبار الحي (بعد كل مرحلة)

| الحالة | الخطوات | النتيجة المتوقعة |
|---|---|---|
| مسح الجلسة اليتيمى | حقن `UNKNOWN_INSTANCE` + تشغيل العامل | حذف خلال ≤15 دقيقة، لا حذف لمثيل محمول |
| رسالة مباشرة | إرسال من هاتف | صف `inbound` مشفّر + حدث `PROCESSED` |
| رد آلي | تفعيل بعد اختبار + رسالة سؤال | حدث `queued → sent`، رسالة `outbound` محفوظة |
| طلب | «أريد طلب 2 من ...» مع البيانات | `mena_whatsapp_order_intakes.status='created'` + مسودة طلب |
| إيقاف | `stop` ثم رسالة أخرى | صف opt-out واحد، صفر أحداث رد جديدة |
| مزامنة | تشغيل مجدول على مجموعة بمؤشر | `complete`، العدد لا يتضاعف، `partial` عند انتهاء الميزانية |
| وسائط | صورة حديثة + صورة عمرها 30 يومًا | الأولى `stored`، الثانية `WHATSAPP_MEDIA_EXPIRED_UPSTREAM` |
| منشور | قرار A أو B | إما لا وظيفة تلقائية + نص واضح، أو منشور `source_type=whatsapp` |
| عزل | استدعاء كل مسار بمساحة أخرى | 401/404، لا بيانات |

### 9.2 أوامر التحقق (في بيئة بها pnpm)

```bash
pnpm typecheck
pnpm lint
pnpm test
node --experimental-strip-types --test \
  artifacts/api-server/src/lib/whatsapp-orphan-instance-policy.test.mjs \
  artifacts/api-server/src/lib/whatsapp-sync-options.test.mjs \
  artifacts/api-server/src/lib/whatsapp-opt-out.test.mjs \
  artifacts/api-server/src/lib/whatsapp-media-expiry-policy.test.mjs \
  artifacts/api-server/src/lib/whatsapp-history.test.mjs

# الترحيل
supabase link --project-ref <ref>
supabase db push --dry-run --linked
supabase db push --linked
pnpm --filter @workspace/db run generate   # قبل الإرسال، للـ snapshot
```

---

## 10. المخاطر والتراجع

| المرحلة | الخطر | الضمانة | التراجع |
|---|---|---|---|
| 0 | حذف جلسة يملكها تاجر آخر | القواعد الحالية تمنع المحمولة | إعادة الربط من الواجهة |
| 1 | حذف جماعي بسبب قائمة Evolution خاطئة | بادئة `menaflow-` + غير محمول + حد 5 + قفل عام | `WHATSAPP_ORPHAN_SWEEP_ENABLED=false` |
| 2 | كسر فك تشفير/البحث | الجدول يستخدم نفس HMAC، لا مفتاحًا جديدًا | الترحيل إضافي؛ `DROP TABLE` فقط في بيئة غير إنتاجية |
| 3 | ضغط على Evolution | `includeHistory=false`، ميزانية 10 دقائق، concurrency 3 | `WHATSAPP_HISTORY_SYNC_WORKER_ENABLED=false` |
| 4 | تدفق منشورات غير مرغوب | القرار بيدك قبل التفعيل | إعادة المتغير إلى `false` |
| 5 | تعقيد غير مبرر | مؤجَّل حتى تعدد Replicas | لا شيء منفَّذ |

---

## 11. الجدول الزمني المختصر

```
اليوم 0      إصلاح تشغيلي + إرسال رسالة تحقق              (1–2 ساعة)
اليوم 1      عامل التنظيف + بطاقة الرفض + اختبارات         (P0)
اليوم 2      ترحيل opt-out + الحماية في 3 نقاط + اختبارات   (P1)
اليوم 3      إصلاح المؤشر + الدالة المشتركة + عامل المزامنة (P1)
اليوم 4      قرار المحتوى + توثيق الإعدادات + مراقبة       (نصف يوم)
اليوم 5      تحقق شامل + استلام                            (نصف يوم)
```

---

## 12. ما أحتاج قرارك فيه قبل التنفيذ

1. **المحتوى:** A (يدوي، الوضع الحالي) أم B (تشغيل `WHATSAPP_MARKETING_WORKER_ENABLED=true`)؟
2. **الإيقاف:** يمنع الردود **الآلية فقط** (مقترحي) أم كل الردود بما اليدوي؟
3. **المزامنة:** تُشغَّل مجدولة كل 30 دقيقة (مقترحي) أم تبقى يدوية؟
4. **تغيير الإعدادات أثناء التشغيل:** هل نطلب اختبارًا جديدًا عند تعديل التعليمات والردود مفعّلة؟ (سطر واحد).

بعد إجابتك، أنفّذ المرحلة 0 فورًا، ثم أبدأ بالمرحلة 1 وأرسل لك نتيجة كل مرحلة مع أوامر التحقق قبل الانتقال للتالية.
