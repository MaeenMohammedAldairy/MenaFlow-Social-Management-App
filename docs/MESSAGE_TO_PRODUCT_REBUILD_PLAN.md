# خطة إعادة بناء نظام «الرسائل ← المنتجات» (Message → Product Intake)

**الحالة:** خطة تنفيذية، نُفذت الدفعات 1–5 منها فعلياً على هذا الفرع (انظر القسم 20). ما زال التحويل التدريجي بناءً على ملاحظات التاجر هو الخطوة المتبقية.
**الفرع:** `arena/fdec5353-menaflow-social-management-app`
**المبني عليها:** التدقيق الوارد في المحادثة + الوضع الفعلي للكود والـ schema بتاريخ 2026-11-24.
**القرار الأساسي:** إعادة بناء **وحدة الاستخراج والمراجعة** داخل MenaFlow بنفس الـ stack الحالي، مع الحفاظ على التكامل القائم مع النشر والردود والطلبات، ومنع أي إنشاء/تفعيل/نشر آلي لمنتج لم يوقّعه التاجر.

---

## 0. المبادئ غير القابلة للتفاوض (Invariants)

1. **لا يصبح الاقتراح منتجاً نشطاً إلا بفعل تاجر صريح:** حفظ بالحالة `active` + `verifiedAt` + مستخدم مُعرَّف.
2. **كل حقل مستخرج يجب أن يكون له دليل نصي حرفي** من الرسالة المصدر، أو يُوسَم `unverified` ويُطلب إدخاله يدوياً.
3. **كلام العميل في مجموعة واتساب ليس مصدراً موثوقاً للكتالوج.** يُعرض كـ«إشارة» لا كـ«حقيقة».
4. **كل رسالة/ويب هوك/idempotency key تُعالج مرة واحدة بالضبط** على مستوى قاعدة البيانات، لا بالذاكرة ولا بالـ logs.
5. **كل تغيير في منتج له سجل غير قابل للتعديل** (`before`/`after`/`actor`/`source`).
6. **العزل بين workspaces إلزامي في كل طبقة:** RLS + `workspace_id` في كل استعلام + فحص صلاحية الدور في المسارات.
7. **الفشل شفاف:** أي رسالة لا تُستخرج يجب أن تظهر للمستخدم بسبب واضح وزر إجراء واضح، لا تختفي.
8. **لا نكسر الواجهة الخارجية الحالية** أثناء الانتقال: نفس مسارات الـ API، نفس أسماء الحقول المستهلكة في التطبيق، ثم نضيف الإصدارات الجديدة تدريجياً.

---

## 1. الحالية مقابل المستهدفة (باختصار)

| البند | الحالي | المستهدف |
|---|---|---|
| مصدر المنتجات | مجموعات واتساب المختارة فقط + منشورات | نفس المصادر + تصنيف صريح لمنشئ الرسالة (تاجر/عميل/غير معروف) |
| الاستخراج | prompt عربي صارم، دليل حرفي، ثقة يصرّح بها النموذج | prompt مُصدَّر، JSON Schema مُلزِم، ثقة **محسوبة في الخادم**، إسناد دليل لكل عنصر |
| تعدد المنتجات | حتى 30 عنصراً في الـ prompt لكن `assignedIds` تمنع shared source | عناصر متعددة من رسالة واحدة مع `evidence` مستقل لكل عنصر |
| التطابق | اسم طبيعي + SKU فقط | `normalized_name` + aliases + SKU + عتبات + قرار تاجر إلزامي |
| التحديث | غير موجود | اقتراح تحديث مع diff وسجل تغييرات |
| إعادة المعالجة | غير موجودة؛ زر موصوف في الواجهة وغير موجود فعلياً | `reprocess` بإصدار جديد مع حفظ الإصدار القديم |
| الوسائط المتأخرة | لا تُلحق بالمنتج بعد إنشائه | حدث `media.ready` يربط الوسائط بالاقتراح/المنتج |
| المراقبة | طابور في الواجهة + logs | أحداث منتج + مؤشرات في التقارير |
| الصلاحية | عضوية workspace تكفي في مسارات المنتجات | فحص `owner/admin` صريح |

---

## 2. المعمارية المستهدفة

```text
Evolution webhook ──► verify secret ──► webhook_event(idempotent)
        │                                   │
        ▼                                   ▼
messages + media queue ──► group/association policy ──► extraction job (versioned)
                                                             │
                                                             ▼
                                                   AI adapter (OpenAI→Gemini)
                                                             │
                                              normalization + validation + guards
                                                             │
                                                             ▼
                                          suggestion(s) + evidence + computed confidence
                                                             │
                                                             ▼
                                          matcher (find candidate product / none)
                                                             │
                          ┌──────────────────────────────────┴──────────────────────┐
                          ▼                                                         ▼
             review UI (create / update / dismiss)                         audit log
                          │
              ┌───────────┴────────────┐
              ▼                        ▼
        product draft            product change proposal
              │                        │
              ▼                        ▼
     merchant saves active  ◄─── merchant approves diff
              │
              ├──► publication jobs ──► posts ──► Meta
              ├──► auto-reply knowledge (active + verified only)
              └──► order intake snapshot (active + verified + price/currency)
```

### الطبقات والملفات المسؤولة (ضمن الـ stack الحالي)

| الطبقة | التقنية | الملفات المرجعية |
|---|---|---|
| API | Express 5 + Zod | `artifacts/api-server/src/app.ts`, `routes/product-extractions.ts`, `routes/product-management.ts` |
| البيانات | Drizzle ORM + Supabase Postgres (`pg`) | `lib/db/src/schema/products.ts`, `social.ts`, `inbound-webhook.ts` |
| المهام | `startAppWorkerLoop` داخل `artifacts/api-server/src/worker.ts` | `lib/app-workers.ts` (`product-extraction`, `product-extraction-queue`) |
| الذكاء الاصطناعي | `callMeteredAiProvider` + OpenAI/Gemini | `lib/product-extraction.ts`, `ai-provider-fallback.ts`, `extraction-quota-policy.ts` |
| الوسائط | Supabase Storage + signed URLs | `lib/whatsapp-media-download.ts`, `routes/product-media.ts` |
| الواجهة | Expo Router 58 + React Query + RN | `app/(tabs)/products.tsx`, `components/products/ProductCatalogScreen.tsx`, `components/sources/SourcesScreen.tsx` |
| المصادقة | Clerk + `requestOwnerId` / `requireWorkspace` | `lib/workspace-context.ts`, `lib/owner-access.ts`, `lib/workspace-middleware.ts` |
| النشر | `mena_product_publication_jobs` | `lib/product-publishing.ts`, `routes/product-publishing.ts` |

**لا نغيّر إطار العمل، لا نضيف ORM آخر، لا نضيف مزوّد سحابة جديد.**

---

## 3. نموذج البيانات المستهدف

### 3.1 الجداولالمحافظ عليها مع تعديلات

| الجدول | التعديل المطلوب |
|---|---|
| `mena_products` | إضافة `normalized_name`، `source_trust`، `last_extraction_suggestion_id`، `updated_by`، `updated_reason`. الإبقاء على `status = draft|active|archived` كما هو. |
| `mena_product_extraction_suggestions` | إضافة `version`، `previous_suggestion_id`، `sender_role` (`merchant|customer|unknown`)، `match_strategy`، `matched_product_id`، `match_score`، `extraction_input_hash`، `ruleset_version`، `model_version`. إزالة الاعتماد على `sourceKey` الوحيد كمانع لإعادة المعالجة. |
| `mena_product_extraction_sources` | إضافة `evidence_spans` (JSONB) و`item_index` لدعم أكثر من منتج من رسالة واحدة. |
| `mena_whatsapp_product_extraction_jobs` | إضافة `ruleset_version`، `dedupe_key`، `idempotency_key`، `last_attempt_at`، `dead_letter_at`. |
| `mena_product_publication_jobs` | لا تغيير في الحالة؛ إضافة فحص `active + verifiedAt` في الخادم قبل الإدراج. |

### 3.2 جداول جديدة (بحد أدنى)

| الجدول | الغرض | الحقول الأساسية |
|---|---|---|
| `mena_product_changes` | سجل تغييرات غير قابل للتعديل | `id`, `workspace_id`, `product_id`, `field`, `before_value`, `after_value`, `actor_id`, `source_type` (`manual|extraction|order|publication`), `source_id`, `created_at` |
| `mena_product_change_proposals` | مقترح تحديث ينتظر الموافقة | `id`, `workspace_id`, `product_id`, `suggestion_id`, `diff` JSONB, `status` (`proposed|accepted|rejected|expired`), `decided_by`, `decided_at` |
| `mena_product_match_candidates` | شفافية التطابق | `suggestion_id`, `product_id`, `score`, `reasons` JSONB, `decision` |
| `mena_product_extraction_events` | أحداث دورة الحياة للمراقبة | `workspace_id`, `job_id`, `suggestion_id`, `event`, `context`, `created_at` |
| `mena_webhook_idempotency` | منع المعالجة المزدوجة | `provider`, `event_key`, `workspace_id`, `created_at` مع `UNIQUE(provider,event_key)` |

### 3.3 القيود والفهارس الإلزامية

- `UNIQUE(workspace_id, normalized_name)` **مشروطاً** بـ `source_trust = 'merchant'` فقط بعد موافقة التاجر؛ لا نمنع الأسماء المتشابهة للمنتجات المختلفة فعلياً.
- `UNIQUE(workspace_id, product_id, version)` في جدول التغييرات.
- `UNIQUE(workspace_id, suggestion_id, version)` في الاقتراحات.
- `UNIQUE(provider, event_key)` في idempotency.
- فهرس `(workspace_id, status, next_run_at)` لكل طابور.
- فهرس `(workspace_id, normalized_name)` وGIN على `aliases` للتطابق المرن.
- **FK مركّب** `(workspace_id, product_id)` في كل جدول جديد — نفس نمط `mena_inventory_movements`.
- **RLS** على كل الجداول الجديدة بسياسة `workspace_id = current_workspace()`، مع `REVOKE` من role العام كما هو معمول به في المشاريع السابقة.
- `check` على `sender_role` و`match_strategy` و`source_trust` و`status`.

### 3.4 آلة الحالات

**حالة المهمة (job):**

```text
pending → processing → complete
   │            │           │
   │            │           └─► review (اقتراح بانتظار قرار)
   │            └─► waiting_media / waiting_association → pending
   └─► failed → dead_letter (بعد N محاولات)
```

**حالة الاقتراح:**

```text
detected → classified(not_product) → archived
         ├─► review ──┬─► draft_created ─► product draft ─► active (بقرار تاجر)
         │            ├─► update_proposed ─► accepted / rejected
         │            ├─► possible_duplicate ─► merged / override_confirmed
         │            └─► dismissed
         └─► superseded (عند إعادة المعالجة)
```

**حالة المنتج (لا تتغير):** `draft | active | archived`. نرفض إضافة حالات جديدة حتى لا نكسر الردود والطلبات والنشر.

**قاعدة ذهبية:** أي انتقال إلى `active` يضبط `verified_at = now()` و`updated_by` ويسجّل `mena_product_changes`.

---

## 4. طبقة الاستقبال (Ingestion)

### 4.1 الويب هوك

1. التحقق من `WHATSAPP_EVOLUTION_WEBHOOK_SECRET` بـ `timingSafeEqual` **قبل أي قراءة للـ payload**.
2. استخراج `event_key` = `instanceName + remoteMessageId + messageType` (أو `messageKey` من Evolution عند توفره).
3. إدراج في `mena_webhook_idempotency` داخل `INSERT ... ON CONFLICT DO NOTHING`؛ إذا `rowCount = 0` → `200 OK` بدون أثر جانبي.
4. تسجيل `mena_inbound_webhook_events` بالحالة (`RECEIVED|REJECTED_SECRET|DUPLICATE|QUEUED`) بدون نص الرسالة.
5. حفظ الرسالة في `mena_whatsapp_messages` بالفهارس الفريدة الحالية.
6. جدولة مهمة استخراج **فقط** إذا كانت المجموعة في قائمة المجموعات المختارة للمساحة.

### 4.2 تصنيف مصدر الرسالة (جديد، حاسم)

| الحالة | المصدر | المعاملة |
|---|---|---|
| `merchant` | `fromMe = true` أو مرسل مطابق لحساب التاجر المرتبط | اقتراح موثوق؛ يمكن أن يصل إلى `active` بعد حفظ التاجر |
| `customer` | أي مرسل آخر في المجموعة | يُعرض كـ«إشارة من عميل»؛ لا يمكن تفعيله مباشرة؛ يتطلب تأكيد كل حقل يدوياً |
| `unknown` | غياب بيانات المرسل | يُعامل كـ `customer` تحفظاً |

يُخزَّن `sender_role` في الاقتراح ويُعرض في البطاقة والـ API.

### 4.3 دورة الوسائط

- `media.downloading → ready | failed | expired`.
- `expired` ⇒ استبعاد الوسيط مع إبقاء النص، ورسالة واضحة في الواجهة.
- عند `ready` بعد إنشاء الاقتراح/المنتج: حدث `media.ready` يضيف URL إلى `suggestion.sources` و`product.mediaUrls` (بعد موافقة التاجر إذا كان المنتج نشطاً).
- لا تُعتبر الوسائط وحدها كافية للاستخراج: صورة بلا نص تُسجَّل كـ `no_text` وتظهر في شريط الطابور.

### 4.4 الربط (association)

- استخدام `mediaGroupId` + القواعد الحالية في `source-message-groups.ts` و`whatsapp-association-suggestions.ts`.
- قرار التاجر (`accepted/rejected`) يُسجَّل كحدث ويغيّر حالة المهمة من `waiting_association` إلى `pending`.
- أي ربط تلقائي يجب أن يكون **أحادي المعنى فقط**؛ الغموض ⇒ سؤال التاجر.

---

## 5. طبقة الاستخراج (AI)

### 5.1 العقد (Contract)

**المدخل:** صورة مجمّعة من الرسائل المسموح لها فقط + `sender_role` + `workspaceCountry` + `ruleset_version`. لا تُرسل معرّفات قاعدة البيانات ولا أرقام هواتف العملاء للنموذج (تُستبدل بـ `src_1`, `src_2`).

**المخرج (JSON Schema صارم):**

```json
{
  "items": [{
    "item_index": 0,
    "source_ids": ["src_1"],
    "classification": "product|not_product",
    "data": { "name": null, "sku": null, "aliases": [], "description": null,
              "price": null, "currency": null, "availability": null },
    "evidence": { "name": "نص حرفي من المصدر", "price": "..." },
    "evidence_spans": { "name": { "source_id": "src_1", "start": 0, "end": 12 } },
    "self_confidence": 0.0
  }],
  "rejections": [{ "source_id": "src_2", "reason": "not_a_product" }]
}
```

### 5.2 الضوابط بعد الاستخراج (كلها في الخادم)

| الضابط | القاعدة |
|---|---|
| الدليل الحرفي | `evidence[field]` يجب أن يكون substring من نص المصدر بعد NFKC وتوحيد المسافات؛ وإلا يُسجَّل الحقل `null` |
| السعر | رقم واحد فقط في نفس المصدر؛ أكثر من سعر ⇒ `price_conflict`، لا اختيار عشوائي |
| العملة | `resolveCurrencyFromEvidence` صارم؛ يسمح بالدولة فقط عند غموض صريح ويوسم `currency_derived_from_country = true` |
| الأسماء البديلة | مقبولة فقط إذا ارتبطت بدليل هوية الاسم الأساسي |
| SKU | يُولَّد `MF-<hash>` عند غيابه ويوسم `generated_sku = true` |
| التوفر | لا يستنتج من «متوفر؟»؛ يطلب دليل صريح أو `unknown` |
| الثقة | `computed_confidence = f(حقول مكتملة، دليل صالح، تعدد مصادر، تعارضات، sender_role)`؛ `self_confidence` يُخزَّن للمراقبة فقط ولا يُستخدم للقرار |
| العتبة | `>= 0.85` + لا تعارضات ⇒ يمكن اقتراح مسودة؛ أقل ⇒ مراجعة إلزامية |
| الهلوسة | أي حقل بلا دليل يُحذف ولا يُعرض كبيانات منتج؛ يُعرض كـ«ناقص — أدخله يدوياً» |
| الرؤية | تبقى الرؤية اختيارية (opt-in) (`ENABLE_PRODUCT_EXTRACTION_VISION`)؛ أي نتيجة vision ⇒ مراجعة بشرية إلزامية |
| المزوّد | OpenAI أولاً ثم Gemini عند فشل التحليل (لا عند quota)؛ تسجيل `model_version` في الاقتراح |
| الحصة | فصل `quota_exhausted` عن `provider_error`؛ الأول يوقف مؤقتاً ويُستأنف، الثاني يعيد المحاولة بـ backoff |

### 5.3 إعادة المعالجة

- `input_hash = sha256(رسائل المصدر + قواعد الاستخراج + إصدار النموذج)`.
- طلب `reprocess` ينشئ مهمة جديدة بـ `ruleset_version` أعلى والاقتراح القديم يصير `superseded` (لا يُحذف).
- واجهة المقارنة تعرض «النسخة 1» و«النسخة 2» جنباً إلى جنب.

---

## 6. التطابق ومنع التكرار

### 6.1 خوارزمية الترتيب

1. **حظر صارم:** SKU متطابق داخل المساحة ⇒ `exact_sku` (لا يسمح بإنشاء منتج جديد؛ فقط «تحديث منتج»).
2. `normalized_name` متطابق ⇒ `exact_name`.
3. تطابق اسم مع `aliases` ⇒ `alias_match`.
4. تشابه رمزي (token overlap + Levenshtein على الحروف العربية الموحّدة) بعتبة `>= 0.82` ⇒ `fuzzy_candidate`.
5. إذا لم يتطابق شيء ⇒ `new_product`.

النتيجة تُخزَّن في `mena_product_match_candidates` مع `score` و`reasons`.

### 6.2 سلوك الواجهة حسب النتيجة

| النتيجة | ما يظهر | المسموح |
|---|---|---|
| `exact_sku` | «هذا SKU موجود بالفعل: <المنتج>» | تحديث المنتج فقط |
| `exact_name` / `alias_match` | بطاقة مقارنة | تحديث أو «إنشاء منتج مختلف فعلاً» مع سبب إلزامي |
| `fuzzy_candidate` | «أقرب منتج موجود» | اختر: تحديث / إنشاء جديد / استبعاد |
| `new_product` | إنشاء مسودة عادية | إنشاء مسودة |

**إلغاء الثغرة الحالية:** في `possible_duplicate` يُستبدل زر «إنشاء مسودة» بـ «مقارنة واختيار»؛ أي تجاوز يتطلب `override_reason` ويُسجَّل في `mena_product_changes`. الخادم يرفض طلب إنشاء إذا كان `matched_product_id` موجوداً و`override_reason` فارغاً.

---

## 7. دورة حياة المنتج والتحديث

### 7.1 إنشاء

1. التاجر يضغط «حفظ المسودة» ⇒ `mena_products.status = draft`.
2. التاجر يراجع الحقول ويضغط «حفظ وتفعيل» ⇒ `status = active`, `verified_at = now()`.
3. يُسجَّل حدث `PRODUCT_ACTIVATED` مع `source_suggestion_id` و`actor_id`.

### 7.2 تحديث من رسالة

1. الاقتراح المطابق يولّد `mena_product_change_proposals.diff` مثل:

```json
{ "price": { "before": "120.00", "after": "135.00", "evidence": "135 ريال" },
  "availability": { "before": "unknown", "after": "in_stock", "evidence": "متوفر الآن" } }
```

2. البطاقة تعرض الفرق + الدليل + مصدر الرسالة.
3. التاجر يختار «تطبيق التغييرات» أو «رفض».
4. عند القبول: تحديث `mena_products`، إدراج صفوف `mena_product_changes`، و`suggestion.status = accepted_update`.
5. عند الرفض: `rejected_update` + سبب اختياري.
6. لا يُحدَّث product إذا كان `archived` دون إعادة تفعيل صريحة.

### 7.3 ما لا يدخل في التحديث التلقائي

- السعر若无 دليل صريح.
- العملة المستنتجة من الدولة تُعرض كتحذير وتطلب تأكيداً.
- أي حقل من رسالة `customer` يتطلب تأشيرة «أؤكد أن هذا صحيح».

---

## 8. واجهة برمجة التطبيقات (API)

> كل المسارات تحت `/api`، تتطلب `requireWorkspace`، وتتحقق من الدور `owner|admin` لعمليات التعديل. كل عملية كتابة تحمل `Idempotency-Key` اختيارياً ويُخزَّن.

|Method|Path|الغرض|الاستجابة|
|---|---|---|---|
|POST|`/api/whatsapp/product-extractions/analyze`|إضافة رسالة/مجموعة إلى الطابور|`{queued, deduped, quotaEstimate}`|
|GET|`/api/product-extractions?status=&classification=&senderRole=&cursor=`|قائمة الاقتراحات مع العدّاد|`{items, counts, pendingJobs, nextCursor}`|
|GET|`/api/product-extractions/:id`|التفاصيل + المصادر + الدليل + المرشحون|كامل الاقتراح|
|POST|`/api/product-extractions/:id/review`|تقييم حقل|`{field, correct}`|
|POST|`/api/product-extractions/:id/dismiss`|استبعاد مع سبب|`{status}`|
|POST|`/api/product-extractions/:id/create-draft`|إنشاء مسودة|`{productId}` + 409 إذا كان هناك تطابق غير مبرر|
|POST|`/api/product-extractions/:id/propose-update`|创建 مقترح تحديث|`{proposalId, diff}`|
|POST|`/api/product-change-proposals/:id/decide`|قبول/رفض التحديث|`{status, changedFields}`|
|POST|`/api/product-extractions/:id/reprocess`|إعادة تحليل بإصدار جديد|`{jobId, rulesetVersion}`|
|GET|`/api/products/:id/changes`|سجل التغييرات|`{changes}`|
|GET|`/api/product-extraction-metrics?from=&to=`|مؤشرات للوحة التقارير|`{queued, reviewed, conversion, failures}`|
|POST|`/api/webhooks/whatsapp/evolution`|استقبال Evolution|`200` دائماً بعد التحقق/idempotency|

**قواعد موحّدة:** Zod لكل مدخل؛ أخطاء عربية قابلة للعرض؛ لا تُرسل رسائل DB الخام للواجهة؛ `404` بدل `403` عند طلب وworkspace آخر لتجنب تسريب الوجود.

---

## 9. طبقة المهام (Workers)

|Worker|المسؤول|التكرار|السلوك عند الفشل|
|---|---|---|---|
|`product-extraction-queue`|مسح الرسائل المؤهلة وإنشاء jobs|كما هو (30ث تقريباً)|لا يُنشئ مهمة مكررة بفضل `dedupe_key`|
|`product-extraction`|تنفيذ الاستخراج والحفظ|كما هو|backoff تصاعدي؛ بعد N ⇒ `dead_letter` + حدث مرئي|
|`media-download`|تنزيل الوسائط|كما هو|`failed/expired` مع وسم في الواجهة|
|`media-relink` (جديد)|ربط الوسائط المتأخرة بالاقتراحات/المنتجات|60ث|عملية آمنة لإعادة التشغيل|
|`publication`|نشر المنتجات المعتمدة|كما هو|فحص `active + verifiedAt` قبل الإدراج|
|`metrics-rollup` (جديد)|تجميع مؤشرات الاستخراج|ساعة| idempotent باليوم/الساعة|

**قواعد عامة:** قفل على مستوى الصف عبر `status = processing + next_run_at`؛ مهلة للعامل المعلّق (`stale processing` ⇒ إعادة جدولة)؛ حد أقصى للمحاولات؛ لا يوجد `setTimeout` داخل الـ worker بدل من قائمة انتظار.

---

## 10. الواجهة (الشاشات)

### 10.1 «المزيد ← القنوات ← واتساب ← المصادر»

- اختيار المجموعات، مزامنة السجل، فتح نافذة رسائل المجموعة.
- في بطاقة الرسالة: وسم **«من التاجر» / «من عميل»**، حالات الوسائط، أزرار «تأكيد الربط/رفض»، وزر **«إضافة إلى مراجعة المنتجات»**.
- زر **«إعادة التحليل»** يظهر للرسائل الفاشلة/القديمة (يصلح النص الخاطئ الحالي).

### 10.2 «المنتجات ← الاستخراج والمراجعة» (الشاشة الرئيسية)

- شريط حالة الطابور مع أرقام وأسباب وإجراءات (`waiting_media`, `waiting_association`, `failed`, `quota`, `no_text`).
- فلاتر: `بانتظار مراجعتك` / `تمت معالجتها` / `ليست منتجات` / `إشارات العملاء`.
- بطاقة الاقتراح تعرض:
  - `sender_role` بوضوح.
  - الحقول + الدليل + **الثقة المحسوبة** (لا ثقة النموذج الخام).
  - نص الرسالة المصدر + معاينة الوسائط.
  - تقييم حقل بـ«صحيح/غير صحيح».
  - منطقة «المنتج الأقرب» مع خيارات: تحديث / إنشاء مختلف / استبعاد.
  - أسباب استبعاد اختيارية.
- لا يظهر زر «إنشاء مسودة» في حالة التطابق إلا بسبب مبرر.

### 10.3 محرر المنتج

- حقول موجودة + `normalized_name` (تلقائي)، `source_trust`، «آخر تحقق».
- تبويب **«سجل التغييرات»** يعرض `before → after` مع المصدر والوقت والمستخدم.
- الحالة: `مسودة / معتمد للرد الآلي / مؤرشف`. الحفظ بـ `active` = اعتماد صريح.
- نافذة **«مراجعة النشر»** تبقى كما هي مع فحص إضافي في الخادم.

### 10.4 التكاملات الظاهرة

|الشاشة|ما يتغير|
|---|---|
|المحادثات / إعدادات الرد الآلي|تستخدم فقط `active + verified`؛ لا استخراج من الرسائل الخاصة|
|المزيد ← الطلبات|شروط المنتج الجاهز للطلب نفسها + منع المنتجات ذات `source_trust = customer` غير المؤكدة|
|المزيد ← التقارير|بطاقات جديدة: تمت معالجتها، بانتظار المراجعة، نسبة التحويل، فشل الاستخراج، متوسط زمن المراجعة|
|سجل الأنشطة|أحداث: اقتراح جديد / تحديث مقبول / رفض / إعادة معالجة|

### 10.5 إرشادات الواجهة

- كل حالة فارغة تقول **ماذا حدث وماذا أفعل الآن**.
- كل إجراء مدمر (استبعاد، تجاوز التطابق) له تأكيد.
- `accessibilityLabel` و`accessibilityRole` لكل زر جديد، ونصوص عربية واضحة، لا أرقام إنجليزية مجردة.
- لا تظهر رسالة تشير إلى زر غير موجود.

---

## 11. التكامل مع باقي النظام

|النظام|القاعدة|
|---|---|
|المنشورات/Nشر|منتج `active + verified + حقول كافية` فقط؛ `mena_product_posts` تبقى الربط|
|الردود التلقائية|`active + verified` فقط؛ المنتجات غير الموثوقة لا تدخل قاعدة الرد الآلي|
|الطلبات|snapshot الاسم/SKU/السعر كما هو؛ لا تقرأ سجل التغييرات عند إنشاء الطلب|
|المخزون|`mena_inventory_movements` مستقل عن `mena_product_changes`؛ لا خلط|
|Meta webhook|لا يبقى مسار استخراج؛ يُسجَّل كـ `not_product_source` فقط|
|الرسائل الخاصة|لا تُستخرج؛ تشفير/ inbox فقط|

---

## 12. المراقبة والAudit

### الأحداث الإلزامية

`EXTRACTION_QUEUED`, `EXTRACTION_STARTED`, `EXTRACTION_SUCCEEDED`, `EXTRACTION_FAILED`, `EXTRACTION_REPROCESSED`, `SUGGESTION_REVIEWED`, `DUPLICATE_OVERRIDDEN`, `PROPOSAL_CREATED`, `PROPOSAL_ACCEPTED`, `PRODUCT_ACTIVATED`, `MEDIA_RELINKED`, `WEBHOOK_REJECTED_SECRET`, `WEBHOOK_DUPLICATE`.

### المؤشرات

|المؤشر|التعريف|
|---|---|
|`extraction_success_rate`|`complete / (complete + failed)` لآخر 7 أيام|
|`review_latency_hours`|من `detected` إلى أول قرار|
|`draft_conversion_rate`|`draft_created / suggestions product`|
|`activation_rate`|`active / draft_created`|
|`override_count`|عدد تجاوزات التطابق (يجب أن يكون صفراً تقريباً)|
|`customer_signal_count`|اقتراحات من عملاء لم تُؤكد|

### الاحتفاظ

- أحداث الاستخراج: 90 يوماً.
- webhook events: كما هو (أيام قليلة) بدون نص.
- سجل تغييرات المنتج: طوال عمر المنتج.

---

## 13. الأمان والامتثال

- `WHATSAPP_EVOLUTION_WEBHOOK_SECRET` إلزامي في الإنتاج ومختلف عن مفتاح الإدارة (موجود حالياً — يُبقى).
- إضافة `AI_EXTRACTION_OPENAI_MODEL` / `AI_EXTRACTION_GEMINI_MODEL` إلى `.env.example`.
- فحص دور `owner/admin` في **كل** مسارات إنشاء/تعديل/حذف المنتج والاقتراحات.
- لا تُرسل أرقام هواتف/aactual user IDs إلى مزوّد الذكاء الاصطناعي.
- تقييد حجم الـ prompt وعدد الرسائل لكل دفعة (نفس سقف 30 عنصراً).
- تدوير المفاتيح دون إيقاف الاستخراج: `callMeteredAiProvider` يدعم fallback بالفعل.
- اختبار اختراق بسيط: webhook بسر خاطئ، workspace آخر، SKU مكرر، اقتراح من عميل ⇒ كلها مرفوضة.

---

## 14. خطة الانتقال (Migration & Cutover)

> لا نحذف الجداول القديمة ولا نعيد بناء قاعدة البيانات من الصفر. نبني المسار الجديد بجانب القديم ثم نُحوّل القراءة.

|المرحلة|الإجراء|التراجع|
|---|---|---|
|0|نسخة احتياطية كاملة + تثبيت `feature_flag: new_product_intake = false`|إيقافFLAG|
|1|تطبيق migrations الجديدة (إضافة أعمدة + جداول + فهارس + RLS) فقط|down migration|
|2|Backfill: `normalized_name`، `sender_role = unknown` للاقتراحات القديمة، `version = 1`|script idempotent|
|3|تشغيل المسار الجديد في **shadow mode**: ينشئ اقتراحات ولا يظهرها للمستخدم|إيقاف worker جديد|
|4|مقارنة 7 أيام: ناتج قديم مقابل جديد على نفس الرسائل|تقرير اختلافات|
|5|تحويل الواجهة إلى المسار الجديد Flag=true|Flag=false فوراً|
|6| cleanup: إزالة الحقول المهجورة بعد 30 يوماً|لا حذف قبل انقضاء المهلة|

**قاعدة التحويل:** لا تُحذف أي بيانات مستخدم أثناء النقل؛ الاقتراحات القديمة تبقى `superseded` وليس `deleted`.

---

## 15. استراتيجية الاختبار

### وحدات (Unit)

- `normalizeProductExtractionResponse`: دليل حرفي، سعر متعدد، عملة غامضة، aliases، `assignedIds` الجديد، 30 عنصراً.
- `computedConfidence`: حالات الحد 0.85.
- `matchCandidate`: exact_sku / exact_name / alias / fuzzy / none.
- `senderRole`: fromMe / senderId / unknown.

### تكامل (Integration)

- webhook: سر خاطئ ⇒ 401 + حدث `REJECTED_SECRET`؛ تكرار نفس الـ key ⇒ أثر واحد.
- create-draft مع تطابق وبدون سبب ⇒ 409.
- propose-update ⇒ accept ⇒ `mena_products` + `mena_product_changes` بشكل متسق.
- reprocess ⇒ نسخة جديدة + القديمة `superseded`.
- media.ready متأخر ⇒ إلحاق بالمنتج.

### نهاية إلى نهاية (E2E)

1. ربط واتساب → اختيار مجموعة → مزامنة → رسالة من التاجر → اقتراح → حفظ مسودة → تفعيل → نشر → ظهور في الطلبات.
2. رسالة من عميل ⇒ وسم «غير موثوق» ⇒ لا يمكن تفعيلها بدون تأكيد.
3. رسالة فيها منتجان ⇒ بطاقتان بدليل مستقل.
4. رسالة فاشلة ⇒ إعادة تحليل ⇒ نسخة 2.
5. محاولة مستخدم من Workspace آخر ⇒ 404.

### معايير القبول

- `pnpm test` و`pnpm run typecheck` و`pnpm lint` نظيفة.
- صفر حالة يمكن فيها لاقتراح غير مؤكد أن يصبح `active` دون فعل تاجر.
- صفر منتج مكرر من `possible_duplicate` دون `override_reason`.
- كل حقل معروض في البطاقة له دليل أو وسم «أدخل يدوياً».

---

## 16. مراحل التنفيذ والتسليم

|المرحلة|المخرج|الأيام التقديرية (تقديرية)|
|---|---|---|
|1. الأساس الآمن|منع تجاوز التكرار + role checks + idempotency + سجل التغييرات + إصلاح نص الزر|3–5|
|2. الثقة والمصدر|`sender_role` + ثقة محسوبة + وسم rigid fields + اختبارات|4–6|
|3. التحديث والتعدد|`change_proposals` + مقارنة + multi-item + evidence spans|6–9|
|4. إعادة المعالجة والوسائط|`reprocess` + `media-relink` + dead letter|4–6|
|5. المراقبة والواجهة|مؤشرات التقارير + أحداث + بطاقات محسّنة + a11y|3–5|
|6. الانتقال|shadow mode → flag → cutover → توثيق|3–5|

**الإجمالي التقريبي:** 23–36 يوم عمل، قابلة للتقليص إذا نُفذت المراحل 1 و2 أولاً واعتمد الباقي على ملاحظات التاجر.

---

## 17. المخاطر

|الخطر|الاحتمال|التخفيف|
|---|---|---|
|يصبح النظام آلياً أكثر من اللازم|متوسط|حظر `active` إلا بфикации تاجر + اختبار E2E|
|تكرار المنتجات|مرتفع حالياً|exact SKU block + override_reason إلزامي|
|اعتبار كلام عملاء حقائق|مرتفع|`sender_role` + منع التفعيل المباشر|
|فشل مزوّد الذكاء الاصطناعي|متوسط|fallback + quota منفصل + dead letter مرئي|
|كسر الردود/الطلبات|متوسط|عدم تغيير `mena_products.status` أو شروط `verifiedAt`|
|هجرة data خاطئة|منخفض|shadow mode + backfill idempotent + rollback flag|
|تضخم الواجهة|متوسط|إضافة تبويب/بطاقة واحدة في كل مرحلة، لا إعادة تصميم شاملة|

---

## 18. قرارات تحتاج تأكيد التاجر قبل التنفيذ

1. هل يُسمح لرسائل العملاء في المجموعة بأن تُحوَّل إلى منتج بعد تأكيد حقل واحد، أم يجب منعها نهائياً؟
2. عند تطابق الاسم تماماً: هل نمنع إنشاء منتج جديد نهائياً، أم نسمح به بسبب مكتوب؟
3. هل العملة المستنتجة من بلد المساحة مقبولة بعد تأكيد التاجر، أم يجب إدخالها يدوياً دائماً؟
4. هل نريد متغيرات/ألوان/مقاسات في هذه المرحلة، أم نؤجلها لحالة استخدام حقيقية؟
5. هل تُعرض إشارات العملاء في تبويب منفصل أم داخل «بانتظار مراجعتك» بوسم مميز؟

**التوصية الافتراضية:** (1) منع حتى التأكيد، (2) منع مع سبب مُسجَّل، (3) تأكيد يدوي، (4) تأجيل، (5) تبويب منفصل.

---

## 19. ملاحظة ختامية

هذه الخطة تُعيد بناء **المنطقة المعنية فقط** من النظام: الاستقبال، التصنيف، الاستخراج، التطابق، المراجعة، التحديث، والمراقبة. لا تُعيد بناء MenaFlow بالكامل، وتحترم الـ stack والقيود الحالية. الهدف ليس «مزيد من الذكاء الاصطناعي»، بل **مسار قصير، مُثبت بالدليل، يُوقّعه التاجر، ولا يُفاجئ أحداً**.

---

## 20. حالة التنفيذ على هذا الفرع

نُفذت الأجزاء التالية فعلياً، مع اختبارات ونجاح `pnpm test` و`pnpm run typecheck` و`pnpm lint`:

| العنصر | مكانه |
|---|---|
| الأعمدة والجداول الجديدة وRLS والفهارس | `supabase/migrations/20261124020000_product_intake_rebuild.sql` + `lib/db/src/schema/products.ts` + `social.ts` |
| سياسات الثقة/Tطابق/الثقة المحسوبة/idempotency | `artifacts/api-server/src/lib/product-intake-policy.ts` + اختباراتها |
| تسجيل التغييرات والأحداث وصلاحية owner/admin | `artifacts/api-server/src/lib/product-intake-service.ts` |
| حفظ `from_me` ومنع تكرار الويب هوك مع تحرير القفل عند الفشل | `whatsapp-sync.ts` + `whatsapp-messages.ts` + `routes/whatsapp-sync.ts` |
| استخراج بإسناد مواضع، منتجات متعددة من رسالة، السلوك القديم لا يُحذف | `product-extraction.ts` + `whatsapp-product-extraction.ts` |
| منع تجاوز التطابق بدون سبب، مقترح تحديث، إعادة معالجة، سجل تغييرات، مقاييس | `routes/product-extractions.ts` |
| فحص SKU/اسم مطابق + سجل تغييرات عند التعديل اليدوي | `routes/product-management.ts` |
| إعادة ربط وسائط اكتمل تنزيلها بعد إنشاء المنتج | `relinkCompletedExtractionMedia` + worker `product-extraction-media-relink` |
| واجهة المراجعة: مصدر الرسالة، الثقة المحسوبة، الإصدار، مقارنة التطابق، إعادة التحليل، مقترح التحديث، سبب التجاوز، سجل التغييرات | `ProductCatalogScreen.tsx` + `use-product-editor-workflow.ts` + `product-catalog-api.ts` |
| وسم «من التاجر / إشارة من عميل» في نافذة مجموعة واتساب | `WhatsAppMessageGroupCard.tsx` + `source-message-groups.ts` |
| مؤشرات الاستخراج في التقارير | `ReportsScreen.tsx` |
| توثيق متغيري النموذج | `.env.example` |

### ما لم يُنفَّذ بعد (مقصود، ويعتمد على بيانات تشغيل حقيقية)

1. **الـ shadow mode / flag الإنتاجي**: الكود جاهز، لكن تفعيله على بيانات حقيقية يحتاج قرار تاجر ونافذة صيانة.
2. **Backfill مستقل للاقتراحات القديمة**: الـ migration يملأ `normalized_name` و`source_trust` بأمان، لكن إعادة تصنيف آلاف الاقتراحات القديمة حسب المرسل تتطلب سكربتاً منفذاً بعد توفر `from_me` في السجل التاريخي.
3. **متغيرات المنتج/الكمية المستخرجة**: أُجِّلت قصداً وفق التوصية الافتراضية في القسم 18.
4. **لوحة مؤشرات خارجية (Owner Console)**: المؤشرات متاحة عبر API && شاشة التقارير، ولم تُضف لوحة داخلية منفصلة.

---

## 21. تحسينات الواجهة والتجربة (الدفعة الكاملة)

نُفذت التوصيات ذات الأولوية P0/P1/P2 دون تغيير القرار الأساسي: الاقتراح يعتمد على موافقة بشرية، ولا يُفعّل منتج أو يُنشر تلقائياً من استخراج غير مؤكد.

| التحسين | مكانه |
|---|---|
| شاشة قرار مقترحات التحديث: عرض الفرق قبل/بعد والدليل، مع اعتماد أو رفض عبر `POST /social/products/change-proposals/:id/decide` | `ProductCatalogScreen.tsx` + `product-catalog-api.ts` |
| توسيع مرشحات الحالة لتشمل `update_proposed` و`accepted_update` و`rejected_update` و`superseded`، وإضافة مرشح «تحديثات المنتجات» | `product-extraction-list-policy.ts` + `ProductCatalogScreen.tsx` |
| مرشح مصدر الرسالة (التاجر/العميل/غير معروف) | `product-catalog-api.ts` + `routes/product-extractions.ts` + `ProductCatalogScreen.tsx` |
| أسباب ثقة مقروءة بدلاً من عرض درجة النموذج الخام، وإبراز مواضع الدليل في نص الرسالة | `product-intake-policy.ts` + `whatsapp-product-extraction.ts` + `ProductCatalogScreen.tsx` |
| بطاقة مقارنة سريعة للتطابق المحتمل، وإجراءات جماعية مع إشعار تراجع | `ProductCatalogScreen.tsx` + `AppFeedback.tsx` + مسار `restore` |
| معنونة موحّدة للحالات، حالات فراغ توضح الخطوة التالية، هيكل تحميل بدل نص انتظار، وأخطاء قابلة للإعادة | `ProductCatalogScreen.tsx` |
| شرح سبب تعطيل «إضافة إلى مراجعة المنتجات»، فلاتر سريعة في نافذة المجموعة، تمييز أقوى للوسائط المنتهية | `source-message-groups.ts` + `WhatsAppMessageGroupCard.tsx` + `WhatsAppGroupMessagesModal.tsx` |
| محرر من ثلاث خطوات، معاينة الفرق قبل التفعيل، حفظ محلي تلقائي، ورسالة واضحة عند نقص سبب التجاوز | `use-product-editor-workflow.ts` + `ProductCatalogScreen.tsx` |
| بطاقات مؤشرات قابلة للنقر، مسار تحويل، واتجاه سبعة أيام في التقارير | `ReportsScreen.tsx` + `routes/product-extractions.ts` |

تم استبعاد إعادة تصميم نظام التصميم بالكامل، والإشعارات الفورية لكل مقترح (الاكتفاء بالملخص اليومي)، وعرض ثقة النموذج الخام، وتطبيق التحديثات آلياً بعد الاعتماد.

---

## 22. جولة التبسيط الشاملة — 2026-11-27

نتيجة التدقيق التشغيلي (73 رسالة / 47 اقتراحاً / 0 اقتراح يحمل سعراً رغم أن 8 رسائل ذكرته). نُفِّذت الجولات 0–6 كلها على هذا الفرع:

| ما نُفِّذ | الملف | ملاحظة |
|---|---|---|
| هوية المجموعة قبل الاستخراج: حزمة → ألبوم → رسالة، scope كاملة، ثابتة عند نمو المجموعة | `whatsapp-content-association-logic.ts` (`whatsappProductExtractionGroupKey`) | العمود `group_key` + فهرس فريد `(workspace, group_key, version, item_index)` |
| طلب واحد للنص والصور معاً بدل طلبين كان الثاني يُمحي الأول فوقه | `product-extraction.ts` (`extractWhatsAppProductCandidates`) + `whatsapp-product-extraction.ts` (`collectStoredVisionImages`) | حُذف `extractProductCandidatesFromImages` ومسار الـ prompt المنفصل للصور |
| التحقق يحفظ القيمة الصحيحة بدل تصفيرها: `price_status` بحالاتها الأربع مع `raw_price_text` | `product-price-parsing.ts` (`resolveExtractedPrice`, `findPriceMentions`, `distinctCurrencyFamilies`) | «25 الف» و«1.500» و«45 ريــال» تُقرأ الآن؛ التعارض يبقى برقمه ويذهب للمراجعة |
| اقتراح واحد للمجموعة: سلسلة إصدارات، وإلغاء الاستبدال الصامت؛ الدمج صار كشف تعارض | `whatsapp-product-extraction.ts` (`extractionGroupCoverage`) + `product-extraction.ts` (`detectGroupDisagreement`) | بطاقة واحدة لكل منتج فعلي؛ ألبوم «3 صور = 3 منتجات» يبقى ثلاث بطاقات |
| أسباب شفافة لكل حالة نهائية + حفظ رد النموذج الخام + نسخة الـ prompt | `product-extraction-reasons.ts` + `product-extraction-prompt-version.ts` + أعمدة `reason_code`/`raw_extraction_response`/`prompt_version` | `updateJob` يرفض حالة نهائية بلا سبب؛ `SKIPPED_ALREADY_COVERED` هي جواب «أعدت المعالجة فلم يحدث شيء» |
| سباق الوسائط: إعادة الربط بجملة واحدة تقرأ الصف وقت التنفيذ، وحالة وسائط على كل اقتراح | `relinkCompletedExtractionMedia` + `product-extraction-media-policy.ts` (`decideWhatsAppExtractionMediaState`) | `media_state ∈ not_applicable/included/partial/pending/lost` مع جملتها العربية في `mediaStateMessage` |
| النموذج البنيوي للمنتج: features / specifications / accessories بكل عنصر موثّق باقتباس وموضع | `product-facts.ts` + أعمدة `mena_products` | قيمة بلا اقتباس تُبقى بـ`verified:false` بدل حذفها؛ من لا مصدر له يُرمى |
| قبول الربط يعيد تسليح المجموعة كلها، والقبول التلقائي صار في الطابور لا في GET | `whatsapp-product-group-reopen.ts` + `whatsapp-association-auto-accept.ts` | مع حارس «المجموعة قُرئت معاً فلا نُعيد دفع الثمن»، وإزالة استدعاء القبول من مسار القراءة |
| المنفَّذ (endpoint) صار صريحاً: 409 عند وظيفة حيّة، و`reopened/created/rulesetVersion` في الرد | `routes/product-extractions.ts` | كان `on conflict do nothing` يُجيب 202 ولا يعمل شيء |
| عدّادات الطابور والمقاييس: `failed` و`quotaPaused` و`noText` و`alreadyCovered`، وتوزيع الأسباب ونسخ الـ prompt | `routes/product-extractions.ts` (`/social/products/extraction-metrics`) | |
| قائمة المراجعة تُخفي `superseded` افتراضياً وتُظهره عند الطلب صراحةً | `product-extraction-list-policy.ts` | البطاقة المُستبدلة تاريخ لا عمل مراجعة |
| migration كامل التوسعة/الBACKFILL/الفهارس مع أسئلة تحقق بعد التطبيق — **مُطبَّق على القاعدة الحيّة** | `supabase/migrations/20261127000000_product_extraction_simplification.sql` + `docs/SUPABASE_DATABASE_SETUP.md` §5 | يوسّع قيد الحالة الضيّق الذي عطّل كل مسارات التصحيح، ويُعيد قيد سلسلة العناصر على `item_index` |

### ما تحقق به ذلك

`pnpm test` على المستودع: 1088 اختباراً، 1087 نجحت، واحد مُتجاهَل، وصفر فشل. `pnpm run typecheck` (بناء الـ libs كلهم + `api-server` + `menaflow-mobile` + `owner-console` + `mockup-sandbox` + `scripts`) يمرّ بالكامل. الاختبارات المضافة/المحدّثة في هذا الدور تحمل أسماء تقصّدناها لأن الأسماء هي الوصف: `keeps a number that is written but not quoted as a lead, not as a value`، `drops a price that appears nowhere in the source`، `reports several advertised prices as an ambiguity…`، `keeps the structured facts of an offer with the quote that proves them`، `the media state says what the photos did`، `a superseded version is history, not review work`، `a group already read together is not paid for twice`، `the group's photos ride in the same request as its text`.

### ما لم يُنفَّذ بعد

1. ~~**تنفيذ الـ migration على `qznbujvanjvkfxpehcbq`**~~ — نُفِّذ بتاريخ 2026-11-27 وسُجِّل في `supabase_migrations.schema_migrations` بالإصدار `20261127000000`، مع القياسات ودليل الكتابة (superseded/second item/reason code) في `docs/SUPABASE_DATABASE_SETUP.md` §5. القراءتك الحيّة للكتالوجات قبل التنفيذ غيّرت الملف نفسه مرّتين: `(workspace_id, source_key)` كان قيد `UNIQUE` لا فهرساً (فـ`DROP INDEX` كان سيفشل)، وفهرس السلسلة القديم `mena_product_extraction_version_key` كان فريداً على `(workspace, previous_suggestion_id, version)` أي صفاً واحداً لكل سلف — فثاني عنصر في مجموعة متعدّدة المنتجات كان سيُرفض بصمت؛ صار الفهرس على `(workspace, previous_suggestion_id, version, item_index)` ويربط كل عنصر بسلفه هو.
2. ~~**مسار UI للحقول الجديدة**~~ — نُفِّذ: الحقول كُتبت في `lib/api-spec/openapi.yaml` (مصدر الحقيقة الوحيد للعميل) ثم وُلِّد العميل بـ`pnpm --filter @workspace/api-spec run codegen`؛ لا يُحرَّر `lib/api-client-react/src/generated` يدوياً. النتيجة في `ProductCatalogScreen.tsx`: سطر `mediaStateMessage` على البطاقة، وسطور `features`/`specifications`/`accessories` مع تعليم قيمة بلا اقتباس («لم نجد لها اقتباسًا في الرسالة»)، و«حالة طابور الاستخراج» صارت تعرض `alreadyCovered`، ورسالة «إعادة التحليل» تُبنى من `{queued, reopened, created, workerEnabled}` بدل نجاح دائم. المنطق النقي في `lib/product-extraction-card-copy.ts` مع اختباره، وبابه `product-extraction-review-copy.test.mjs` الذي رفض فوراً حقلاً موثّقاً لا يرسله المسار.
3. **تجربة على بيانات حيّة**: لم تُستدعَ نماذج ذكاء اصطناعي ولم تُشغَّل وظائف الخادم أثناء هذا العمل؛ الأرقام المذكورة أعلاه من التدقيق السابق، وما تغيّر هو الكود والاختبارات.
