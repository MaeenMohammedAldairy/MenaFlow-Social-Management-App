# المرحلة ٤ — إصلاح الإشارة والتحقق للقراءة فقط

**التاريخ:** ٢٠٢٦-١١-٢٨ · **الفرع:** `arena/e1bfd860-menaflow-social-management-app` · **الأساس:** `a725571` · **آخر التزام قبل العمل:** `96dad3e`
**نطاق مُعتمد:** R-1 … R-6 فقط. R-7/R-8/R-9 **لم تُنفَّذ** ولم يثبت لزومها للتحقق.
**لم يُنفَّذ:** أي migration، أي كتابة على قاعدة البيانات، أي تغيير على Evolution أو الـwebhook (خارج إضافة محلّل R-3) أو الـworkers أو Gemini أو Legacy أو متغيرات البيئة أو النشر.

---

## ١. Files Inspected

كل ملف أدناه قُرئ **قبل** أي تعديل، ولم يُعتمد على تقرير المرحلة ٣ في وصف أي سلوك.

| # | الملف | ما قُرئ فيه | لماذا يهم هنا |
|---|---|---|---|
| ١ | `artifacts/api-server/src/lib/whatsapp-bundle-engine.ts` | ١–١٤٠ (الأنواع)، ١٦٨–٢٦٠ (المساعدات)، ٣٢٤–٣٧٥ (draft)، ٣٩١–٥٣٠ (counts/readiness)، ٥٤٠–٦٠٠ (finalise)، ٦٢٠–٩٣٠ (القواعد ١–٤ب) | المحرّك هو موقع R-1/R-2/R-6 |
| ٢ | `artifacts/api-server/src/lib/whatsapp-message-scope.ts` | ٨٦–١٣٠ (`WhatsAppAlbumAssociation`, `messageIndex`)، ١٣٠–٢٤٠ (المحلّلات) | موقع R-3 |
| ٣ | `artifacts/api-server/src/lib/whatsapp-sync.ts` | ٣٦–٤٥ (الاستيرادات)، ٤٦٠–٤٨٠ (`persistImportedMessage`)، ٥٦٠–٦٠٠ (صف الرسالة)، ٧٠٠–٧٤٠ (الـupsert) | **الملف الإنتاجي الوحيد** الذي تغيّر |
| ٤ | `artifacts/api-server/src/lib/whatsapp-albums.ts` | ٩٠–١٤٠ (`resolveWhatsAppAlbumSource`)، ١٥٦–٢٠٠ (`whatsappAlbumCompletionState`) | مصدر `media_group_index` و`expected`، ومقارنة Legacy |
| ٥ | `artifacts/api-server/src/lib/whatsapp-product-extraction.ts` | ١٧٠–٢٣٠، ٤١٠–٤٥٠، ٥٤٠–٥٨٠، ٨٤٠–٩٠٠، ٩٦٠–١١٥٠، ١٤٤٠–١٧٢٠ | R-4: أين تُكتب المصادر، وأين يُقرأ `expected` |
| ٦ | `artifacts/api-server/src/lib/product-source-media.ts` | ٢٥–٧٠، ٩٥–١٣٠ | R-5: ترتيب الوسائط |
| ٧ | `artifacts/api-server/src/lib/product-vision-extraction.ts` | ٦٠–١١٥ | R-5: اختيار ٣ صور بالترتيب |
| ٨ | `artifacts/api-server/src/lib/product-extraction.ts` | ٢٣٠–٣٠٠، ٤٤٠–٥٣٥ | `sourceMessageIds` = ما قاله النموذج، `productExtractionSourceKey` |
| ٩ | `artifacts/api-server/src/lib/whatsapp-marketing.ts` | ٢٢٦–٣٦٠، ٥٢٠–٥٤٨، ٨٥٢–٨٦٦ | R-5: ترتيب صور المنشور، `expectedCount` و`sourceMediaComplete` |
| ١٠ | `artifacts/api-server/src/lib/whatsapp-marketing-drafts.ts` | ١٤–٦٥، ٩٨–١٥٢ | R-5: `messageOrder`/`sourceMedia` |
| ١١ | `artifacts/api-server/src/lib/whatsapp-media-download.ts` | ٣٤٠–٣٨٠ | R-5: أول من يكتب `media_index` |
| ١٢ | `artifacts/api-server/src/lib/whatsapp-content-associations.ts` | ٨٩–١٦٠ | مصدر الحزم المقبولة (`getWhatsAppContentBundle`) |
| ١٣ | `artifacts/api-server/src/lib/whatsapp-content-association-logic.ts` | ٦٨–٩٠ | `whatsappProductExtractionGroupKey` (هوية المجموعة) |
| ١٤ | `artifacts/api-server/src/lib/whatsapp-bundle-shadow-cli.ts` | ١٠٠–١٨٠ | استعلام القراءة فقط الذي يقرأ كل الإشارات |
| ١٥ | `artifacts/api-server/src/lib/whatsapp-bundle-shadow-compare.ts` | كامل | مصفوفة المقارنة المستخدمة في المرحلة ١–٢ |
| ١٦ | `lib/db/src/schema/social.ts` | ٥٧٤–٧٤٠ | أعمدة الرسائل والوسائط (Drizzle = مرآة الـDDL) |
| ١٧ | `lib/db/src/schema/products.ts` | ٢٦٠–٤٤٠ | `source_key`, `group_key`, `mena_product_extraction_sources` |
| ١٨ | `supabase/migrations/20261019000000_initial_schema.sql` + `20261127000000_product_extraction_simplification.sql` | الأعمدة والمعرّفات | تأكيد الشكل الفعلي مقابل الـsnapshot |
| ١٩ | `.github/workflows/ci.yml` | ٢٢–٤٠ | بوابة انحراف المخطط: `lib/db/src/schema` + `supabase/migrations` يتحركان معًا |

**فحوص قاعدة البيانات (SELECT فقط، مشروع `qznbujvanjvkfxpehcbq`):** أعمدة `mena_whatsapp_messages` و`mena_whatsapp_message_media` و`mena_product_extraction_sources` و`mena_product_extraction_suggestions` و`mena_whatsapp_product_extraction_jobs`؛ عدّ `reply_to_remote_id`؛ توزيع `media_group_source`؛ توزيع `media_index`؛ تكرار `message_timestamp`؛ انعكاسات الترتيب؛ عدد مصادر كل اقتراح.

---

## ٢. Files Modified

خمسة ملفات، أربعة منها كود وواحد migration **غير منفَّذ**.

| الملف | الحالة | الدالة/الموضع | السلوك قبل | السبب | السلوك بعد |
|---|---|---|---|---|---|
| `whatsapp-bundle-engine.ts` | معدَّل | `isSameSender()` **جديد** ~٢٤٢ | المقارنة كانت `a.senderId === b.senderId` مباشرة في ٤ مواضع | R-6: `null === null` كانت تُنتج «نفس المرسل» | دالة واحدة تُشترط فيها قيمتان حاضرتان متساويتان؛ أي `null` على أي طرف ⇒ ليس نفس المرسل |
| `whatsapp-bundle-engine.ts` | معدَّل | `bundleMediaCounts()` ٣٩٢–٤٢٠ | `expected = max(promised − containers, mediaMembers)` | R-2: الطرح كان يُعيد كتابة الوعد ويُنتج `exp=3` لألبوم ٤ | `expected = advertised > 0 ? advertised : children`، ويُعاد `{expected, children, stored, pending, partialSeats, complete}` و`complete = children >= expected − 1` |
| `whatsapp-bundle-engine.ts` | معدَّل | `evaluateReadiness()` ٤٣٥–٥٣٥ | فرع الألبوم يقارن `stored >= expected` | R-2: ١٢ من ١٣ لم يكن يُغلق أبدًا | `counts.complete` للإغلاق، و`usable = stored >= max(0, expected−1)` لتمييز «مستلم لكن التنزيل فشل» (`MEDIA_PARTIAL`) عن «ناقص»، و`mediaPartialSeats` في كل مسار |
| `whatsapp-bundle-engine.ts` | معدَّل | `ShadowBundle` + `finalise()` ١٠٤، ٥٧٢ | لا وجود لحقل المقاعد | R-2: التقرير يحتاج رقمًا صريحًا | `mediaPartialSeats: number` |
| `whatsapp-bundle-engine.ts` | معدَّل | حلقة ٤ب ٧٦٦–٧٧٦ | `for…of` + `runLast`، والاستمرار بـ`sameScope + senderId + زمن` | R-1: نص بين صورتين لم يكن يقطع التشغيل إن كان الزمن قصيرًا | حلقة بفهرس + `previous = ordered[index−1]` + `noMessageBetween = previous.id === runLast.id` + `isSameSender` |
| `whatsapp-bundle-engine.ts` | معدَّل | اختيار النص المرجعي ٨٠٥–٨٧٠ | أي نص داخل النافذة يمكن أن يُسحب لحزمة صور، بما فيها حزمة حاوية فارغة | R-1/R-2: CASE 10 وCASE 19 | حارس `NO_MEDIA_TO_ANCHOR`، وكسر التعادل بالمسافة **لصورة واحدة فقط**، و`isSameSender` بدل مقارنة المرسل |
| `whatsapp-message-scope.ts` | معدَّل | `extractWhatsAppReplySignal()` **جديد** ~١٧٠ + أنواعه ١٣٠–١٥٠ | لا شيء (الدالة غير موجودة) | R-3 | قراءة `payload.replyTo` → `payload.contextInfo` → `message.*Message.contextInfo` → `message.messageContextInfo`؛ تُعيد `{replyToRemoteId, participant, hasQuotedMessage, source}` |
| `whatsapp-sync.ts` | معدَّل | `persistImportedMessage` ٤٧٠–٤٨٠ و٥٩٠–٥٩٦ | `const contextInfo = asRecord(payload.contextInfo)` ثم `payload.replyTo ?? contextInfo.stanzaId` | R-3: العنوان الوحيد المقروء كان جذر الظرف | `const replySignal = extractWhatsAppReplySignal(payload, message)` و`replyToRemoteId: replySignal.replyToRemoteId` — **لا تغيير في أي تجميع** |
| `whatsapp-bundle-shadow.test.mjs` | معدَّل | ٢٠ اختبارًا جديدًا (١٤– بلا ترقيم ثابت) | ٢٤ اختبارًا | R-1/R-2/R-3/R-6 | **٤٤ اختبارًا، ٤٤ ناجحًا** |
| `supabase/migrations/20261128010000_extraction_read_message_ids.sql` | **جديد، غير منفَّذ** | — | لا عمود | R-4 | `read_message_ids text[]` + قيد شكل + تعليق؛ **لم يُنفَّذ على أي قاعدة** |

**ملاحظات تحقّق على التعديلات:**
- `git diff --name-only` = الملفات الأربعة أعلاه فقط. لا ملف worker/gemini/evolution/webhook/app-workers بينها.
- `whatsapp-message-scope.ts`: لا يوجد **أي سطر محذوف** في الـdiff — الإضافة خالصة (`grep "^-"` فارغ).
- `whatsapp-sync.ts`: ١٦ سطرًا (+٨/−٨) كلها في نقطتي R-3، ولا سطر في أي مسار تجميع.
- المحرّك مستورد من ثلاثة ملفات فقط: `whatsapp-bundle-shadow-compare.ts`، `whatsapp-bundle-shadow-cli.ts`، `whatsapp-bundle-shadow.test.mjs`. ولا واحد منها يُستورد من `app-workers.ts` أو أي مسار إنتاجي؛ الوحيد الذي يُنفَّذ هو سكربت `package.json:18 shadow:bundles` يدويًا.

---

## ٣. R-1 — النص حدّ صلب

**ما نُفِّذ:** التشغيل المتصل للصور لا يستمر إلا إذا كان الجار المرتَّب السابق هو نفسه آخر عضو في التشغيل (`previous.id === runLast.id`). أي رسالة بينهما — نص، أو عضو ألبوم، أو صورة منتج آخر — تُغلق التشغيل. الزمن بقي **حدًّا مساعدًا وكاسر تعادل فقط**، ولم يُستخدم كدليل على أن صورتين لنفس المنتج.

**ما لم يُنفَّذ عن قصد:** لم أُلغِ قاعدة «النص يرتبط بالصور على الجانب الآخر» (CASE 1/2/3)، لأن إلغاءها كان سيُنتج تفكيكًا لم يعُد يخدم المنتج؛ الحدّ الصلب يخصّ التشغيل *بين* الصور، لا ربط النص بالمجموعة.

| الحالة | التركيب | قبل الإصلاح | بعد الإصلاح |
|---|---|---|---|
| A | `TA IA TB IB` | `TA+IA+IB` + `TB` منفردًا (خلط) | `TA+IA` و`TB+IB` |
| B | `TA IA IB TB` | `TA+IA+IB` + `TB` | `IA+IB` → `NEEDS_REVIEW` بمُرشَّحين، و`TA`/`TB` مستقلان |
| C | `IA TB IC` | لا شيء يمنع التشغيل | لا تجميع عبر `TB` إطلاقًا |
| D | منتج أ ثم منتج ب < ٣٠ ثانية | `TA+IA+IB` + `TB` | `TA+IA` و`TB+IB` — صفر دمج |
| E | ٣ منتجات داخل ٣٠ ثانية | `T1+I1+I2+I3` | لا حزمة تحمل أكثر من صورة واحدة؛ كل صورة مرة واحدة |

**الكلفة المعلنة (وليست عيبًا):** نصّ يقع بين السعر وصوره يفصل بينهما (حالة C). هذا **under-grouping** متعمّد: التحام صورة منتج بمنتج آخر أسوأ من تركها تنتظر نصًّا. الاختبار `CASE C` يقيس هذا الفصل صراحةً.

---

## ٤. R-2 — عدد الوسائط: `children >= expected − 1`

**ما نُفِّذ:**
1. لا وجود لـ`expected − containerCount` في الكود بعد الآن (حُذف بالكامل من `bundleMediaCounts`).
2. `expected` = ما أعلنه المزوّد حرفيًا، ولا يُعاد كتابته في أي مسار.
3. `complete = children >= expected − 1` (وإذا كان `expected = 0` فلا وعد يُنتظَر).
4. `mediaPartialSeats = max(0, expected − children)` يُسجَّل ويُعرض، ولا يُخصم من الوعد.
5. الحاوية تُستثنى من عدّ الأولاد (`hasMedia`)، فلا تُحتسب وسيطًا أبدًا.

**الأساس القياسي (مكرَّر للتدقيق):** على ١١ ألبومًا حقيقيًا: ٨ حالات `expected = children`، حالتان `expected = children + 1`، وحالة شاذة بالنقص. أي أن الإعلان **وعد بمقعد سماح واحد**، وليس `children + 1` كقاعدة.

| الحالة | `expected` | `children` | `partialSeats` | النتيجة | ملاحظة |
|---|---|---|---|---|---|
| ١٣ / ١٢ + حاوية | ١٣ | ١٢ | ١ | READY بلا سبب مراجعة | الوعد سليم، الفرق معروض لا مخفي |
| ٨ / ٧ + حاوية | ٨ | ٧ | ١ | READY بلا سبب مراجعة | — |
| ٤ / ٤ + حاوية | ٤ | ٤ | ٠ | READY | — |
| ٤ / ٢ | ٤ | ٢ | ٢ | READY + `MEDIA_PARTIAL` | **كان `exp=3`** — الوعد كان يُعاد كتابته |
| حاوية فقط، ٠ أولاد | ٢ | ٠ | ٢ | READY + `MEDIA_PARTIAL` | الحاوية ليست وسائط |
| نزّل فشل، الأولاد كلهم | ٢ | ٢ | ٠ | READY + `MEDIA_PARTIAL` | «وصل لكن لا صورة صالحة» ≠ «ناقص» (CASE 12 كان يفقد `MEDIA_PARTIAL`) |

**قرار صريح:** `mediaStored` يبقى «عدد الملفات المخزّنة»، و`children` هو «عدد الرسائل الحاملة للوسائط». الفصل بينهما هو ما منع اعتبار ألبوم فاشل التنزيل «مكتملًا» بصمت.

---

## ٥. R-3 — إشارة الردّ

**التقييم: `VERIFIED` للمحلّل · `UNVERIFIED` للإنتاج ⇒ الحالة النهائية: `REPLY SIGNAL STILL UNVERIFIED`.**

**١) المحلّل (`VERIFIED`، بأمثلة نصية لا بيانات اصطناعية في قاعدة البيانات):**

| المدخل | `replyToRemoteId` | `participant` | `hasQuotedMessage` | `source` |
|---|---|---|---|---|
| `message.imageMessage.contextInfo.stanzaId` | `ACFF586F7372CE2E5E24BB9B24A2F9FA` | `967777187184@s.whatsapp.net` | true | `message.contextInfo` |
| `message.imageMessage.contextInfo` بلا stanzaId | null | null | false | null |
| جذر `payload.contextInfo` | `ACROOT` | null | false | `payload.contextInfo` |
| جذر `payload.replyTo` | `ACREPLY` | null | false | `payload.replyTo` |
| `message.messageContextInfo` | `ACMCTX` | null | false | `message.messageContextInfo` |
| حقل شبيه (`mediaKey` بقيمة تشبه المعرّف) | null | null | false | null |

القراءة **بقائمة عناوين ثابتة وقائمة حقول ثابتة** (`stanzaId`, `stanzaID`, `quotedMessageId`, `replyToId` / `participant`, `participantPn`, `senderJid`)، ولا بحث بالشكل في أي مكان. `quotedMessage` يُسجَّل كإشارة وجود فقط، ولا يُقرأ منه أي محتوى.

**٢) الإنتاج (`UNVERIFIED`):**

```sql
select count(*) total, count(reply_to_remote_id) reply_set,
       count(*) filter (where coalesce(reply_to_remote_id,'') <> '') reply_nonempty,
       max(created_at) newest
from public.mena_whatsapp_messages;
-- total 122 | reply_set 0 | reply_nonempty 0 | newest 2026-11-28 17:45:03.445498+00
```

**القراءة: ٠ من ١٢٢، قبل التعديل وبعده، ولا صف جديد واحد بعد التعديل.** لا يوجد أي دليل إنتاجي على أن `stanzaId` يصل من Evolution أصلًا، ولا على أن العنوان الجديد يقرأه عند الوصول. لذلك:

> **لا أستطيع أن أعلن نجاح R-3 في الإنتاج. نجاح الاختبارات الوحدوية يثبت أن المحلّل يعمل على الشكل المتوقّع، ولا يثبت أن الشكل المتوقّع يصل.**

**الشرط المتبقّي للتحقق (لم يُنفَّذ لأنه يحتاج رسالة حقيقية):** أول رسالة ردّ حقيقية في مجموعة مراقَبة، ثم إعادة الاستعلام نفسه وطلب `reply_set >= 1` مع `source` مسجّل. لا backfill، ولا تعديل صفوف قديمة، ولا بيانات مصطنعة — كما طُلب.

---

## ٦. R-4 — فصل «ما قُرئ» عن «ما ادّعاه النموذج»

**`Migration: PREPARED` · `Migration execution: MUST BE NO`**

**التصميم (لم يُنفَّذ في الكود عن قصد):** العمود `mena_product_extraction_suggestions.read_message_ids text[]` منفصل تمامًا عن `source_key`. العلاقة بينهما:

| | `source_key` | `read_message_ids` |
|---|---|---|
| المعنى | بصمة sha256 لما **قال النموذج** إنه استخدمه | ما **مرّره العامل** إلى النموذج |
| الشكل الحالي | `text NOT NULL`، hash | عمود جديد `text[]`، يقبل NULL |
| يُعاد تفسيره؟ | **لا** | لا ينطبق |
| يُعاد حسابه من الآخر؟ | لا | لا |

**لماذا يلزم (قياس لا افتراض):** لكل اقتراح، آخر مصدر مسجَّل هو ما في `candidate.sourceMessageIds`. القياس على ١٧ اقتراحًا من نوع `album:`: **١١ اقتراحًا سجّلت مصدرًا واحدًا فقط** في مجموعة تحمل ٧–٨ رسائل (٦ حالات: ٨ أعضاء / مصدر ١، و٥ حالات: ٧ أعضاء / مصدر ١)، مقابل حالتين سجّلتا كل الأعضاء (٤/٤ و٥/٥). أي أن الاستخراج **نجح** وبقي **بلا سجل لما قُرئ** — وهذا هو RC-3 نفسه، لا استنتاجًا جديدًا.

**حدود الملف المُعدّ:** إضافة عمود + قيد شكل (لا سلسلة فارغة، ولا NULL داخل المصفوفة) + تعليق + استعلامات تحقق للقراءة فقط. **لا** تعديل على `mena_product_extraction_sources`، **لا** backfill، **لا** فهرس، **لا** تغيير في `source_key` أو في سلوك أي استخراج.

**قيد تنفيذ مكتوب داخل الملف:** عند الموافقة: SQL أولًا، ثم عمود Drizzle في `lib/db/src/schema/products.ts` ثم `pnpm --filter @workspace/db run generate` — لأن بوابة الانحراف في CI (`.github/workflows/ci.yml:29-37`) تفشل إن تحرّك أحدهما وحده.

**تحقّق التنفيذ:** الملف `supabase/migrations/20261128010000_extraction_read_message_ids.sql` جديد وغير متتبَّع في git سابقًا، ولم يُشغَّل بأي أداة. أي قراءة لاحقة لجداول `supabase_migrations` ستُظهر غياب الإصدار `20261128010000`.

---

## ٧. R-5 — جرد ترتيب الصور

**قياس مرجعي أولًا (هو أساس كل حكم أدناه):**

| القياس | النتيجة |
|---|---|
| `mena_whatsapp_message_media.media_index` | **٧٧/٧٧ = ٠**، و`max = 0` ⇒ لا يحمل أي معلومة ترتيب |
| `mena_whatsapp_messages.media_group_index` | **٠/١٢٢** ⇒ لا يحمل أي معلومة ترتيب |
| `media_group_expected_count` | ١١ صفًا فقط (١٠ `protocol_association` + ١ `provider_album_container`) |
| دقّة `message_timestamp` | ثانية واحدة، ٦٥ قيمة مختلفة لـ١٢٢ صفًا؛ **٢٤ دلوًا فيها تعادل** (٨١ صفًا)، أسوأ دلو **٦ صفوف** |
| `created_at` مقابل `message_timestamp` | ١٢٢ قيمة `created_at` مختلفة، لكن الإزاحة تصل إلى **−٢٥ يومًا** (استيراد تاريخي) ⇒ `created_at` هو زمن الإدخال لا زمن الاستلام |
| انعكاس الترتيب بين المفتاحين | **٩١ من ١٢٢ صفًا** لها رتبة مختلفة بين `message_timestamp` و`created_at`، أقصى انزياح ٤٥ مرتبة |
| رسائل تحمل أكثر من صورة | صفر — كل صورة في رسالة مستقلة (٧٧ رسالة × صورة واحدة) |

| # | الموضع | المفتاح | التصنيف | الأثر |
|---|---|---|---|---|
| ١ | `whatsapp-albums.ts:115` (`resolveWhatsAppAlbumSource`) | `media_group_index ← association.messageIndex` | **SAFE** | يكتب NULL دائمًا؛ لا مستهلك يعتمد عليه. القيمة تصل من المزوّد أو لا تصل |
| ٢ | `whatsapp-sync.ts:579, 720-722` | كتابة/`coalesce` للـindex | **SAFE** | لا يُنشئ ترتيبًا زائفًا لأنه لا يكتب شيئًا |
| ٣ | `whatsapp-bundle-engine.ts:69` | حقل `mediaGroupIndex` في واجهة الرسالة | **SAFE** | مُعلَن وغير مقروء في أي منطق |
| ٤ | `whatsapp-marketing.ts:308-315` | مُقارِن: index إن وُجد وإلا timestamp | **UNSAFE** | يوهم بوجود ترتيب صور؛ في الواقع يقع دائمًا على الزمن، فيختار `groupMessages[0]` كـ`sourceMessage` |
| ٥ | `whatsapp-media-download.ts:347-363` | يكتب `media_index` من `entry.mediaIndex` وإلا ٠ | **UNSAFE (كمفتاح ترتيب) / SAFE (كمفتاح صف)** | يفسّر لماذا كل الصفوف ٠؛ وهو جزء من الفهرس الفريد فلا يجوز لمسه في هذه المرحلة |
| ٦ | `product-source-media.ts:61` | `(mediaIndex ?? 0)` قبل `mediaCreatedAt` | **UNSAFE** | كسر تعادل ثابت = لا كسر تعادل |
| ٧ | `product-source-media.ts:120-124` | `ORDER BY timestamp, createdAt, mediaIndex, mediaCreatedAt` | **NEEDS DESIGN** | ترتيب رباعي مفتاحه الثالث ثابت؛ صحيح عرضًا، بلا معنى |
| ٨ | `product-vision-extraction.ts:111` | `sort(mediaIndex) → slice(0,3)` | **UNSAFE** | **يختار أي ٣ صور تُرسل للنموذج** بمفتاح ثابت ⇒ الاختيار صار فعليًا بالـ`id` |
| ٩ | `whatsapp-product-extraction.ts:997-998` | `ORDER BY messageId, mediaIndex` | **SAFE** | يُستخدم للعدّ (`stored`/`pending`) لا للعرض |
| ١٠ | `routes/product-extractions.ts:297-300` | `ORDER BY media.createdAt, mediaIndex` | **UNSAFE** | `created_at` هنا زمن التنزيل لا زمن الوصول ⇒ ترتيب صور البطاقة تابع لسرعة الشبكة |
| ١١ | `routes/whatsapp-messages.ts:396-399` | `timestamp, createdAt desc, id desc` | **SAFE** | عرض فقط، وحسم التعادل بالـ`id` حتمي |
| ١٢ | `whatsapp-bundle-engine.ts:177, 338-345` | `timeOf = messageTimestamp ?? createdAt` + كسر التعادل بالـ`id` | **SAFE** | حتمي، ولا يُدّعى ترتيب منتج |
| ١٣ | `whatsapp-bundle-engine.ts:573, 584` | `openedAt` / `addedAt` | **SAFE** | تصنيفات زمنية للعرض فقط |
| ١٤ | `whatsapp-marketing.ts:236, 302` | `ORDER BY timestamp, createdAt` | **NEEDS DESIGN** | هو ما يحدّد `groupMessages[0]` وبالتالي صورة الغلاف ضمنيًا |
| ١٥ | `whatsapp-marketing.ts:344-348` + `marketing-drafts.ts:17-31` | `messageOrder` من ترتيب الاستعلام ثم `mediaIndex` | **NEEDS DESIGN** | ترتيب صور المنشور الذي يراه التاجر |
| ١٦ | `meta-publishing.ts:566-569` | `mediaUrls[0]` صورة المنشور | **UNSAFE** | الغلاف = أول ما رتّبه استعلام غير مضمون |
| ١٧ | `whatsapp-association-auto-accept.ts:97` | `desc(timestamp)` + `limit` | **SAFE** | اختيار نافذة، لا ترتيب عرض |
| ١٨ | `whatsapp-product-extraction.ts:574, 696, 1140` · `routes/account-details.ts:533` · `routes/product-extractions.ts:279` | `ORDER BY timestamp` | **SAFE** | مسح نوافذ/قوائم |
| ١٩ | `menaflow-mobile/lib/source-message-groups.ts:190-194` | `mediaGroupIndex ?? MAX` ← timestamp ← mediaIndex | **UNSAFE** | واجهة تُظهر ترتيبًا لا وجود له |
| ٢٠ | `mena_whatsapp_messages.created_at` كمصدر «ترتيب وصول» | زمن الإدخال | **NEEDS DESIGN** | صحيح للاستيراد التدفّقي، خاطئ تمامًا للاستيراد التاريخي (−٢٥ يومًا) |

### التوصية

**التوصية: (B) الآن — «ترتيب الصور غير مضمون» وإزالة أي منطق يعتمد على أول/آخر صورة. و(A) مؤجّلة.**

**الأسباب:**
1. **لا توجد إشارة ترتيب لتحفظها.** `media_index` = ٠ في ٧٧/٧٧، و`media_group_index` = ٠ في ١٢٢/١٢٢، و`message_timestamp` بدقة ثانية مع ٢٤ دلوًا متعادلًا (حتى ٦ صفوف). أي «حفظ» قبل وجود الإشارة سيكون تخزينًا لثابت.
2. **`created_at` ليس زمن وصول.** إزاحة −٢٥ يومًا تعني أن ترتيب «أول صورة» يتغيّر جذريًا بين رسالة حيّة ورسالة مستوردة.
3. **الكلفة صغيرة ومحصورة:** إزالة `mediaUrls[0]` كغلاف، وإسقاط «أول/آخر وسيط» من اختيار الرؤية (`product-vision-extraction.ts:111`)، وجعل ترتيب العرض حتميًا بالـ`id`. لا تغيير على أي مفتاح تخزين ولا على أي فهرس.
4. **(A) لاحقًا لا الآن:** `received_sequence` عمود إضافي يحتاج migration + كتابة في المسار الحيّ + backfill مستحيل للصفوف القديمة (لا يُعرف ترتيبها). هذا قرار منتج، لا إصلاح خطأ، وليس داخل المرحلة ٤.

**ما لم يُغيَّر هنا:** صفر تغيير في ترتيب الإنتاج. لا حقل جديد، لا `orderBy` معدَّل، لا migration.

---

## ٨. R-6 — `null` ليس مرسلًا

**ما نُفِّذ:** دالة واحدة `isSameSender(a, b)` تُشترط فيها: `typeof senderId === "string"` و`length > 0` للطرفين، ثم التساوي. استُخدمت في المواضع الأربعة التي كانت تقارن `senderId` مباشرة (استمرار التشغيل، مُرشَّح النص، `nearestBefore`، `nearestAfter`).

| الحالة | النتيجة |
|---|---|
| `null` مقابل `null` | **NOT SAME SENDER** — لا دمج |
| `"967…"` مقابل `null` | **NOT SAME SENDER** |
| `null` مقابل `"967…"` | **NOT SAME SENDER** |
| `""` مقابل `""` | **NOT SAME SENDER** (سلسلة فارغة ليست هوية) |
| `"967…"` مقابل `"967…"` | **SAME SENDER** |

**لا يُستخدم `sender_name` كهوية**، ولا `remote_message_id`، ولا أي بديل: الغياب يعني «غير معروف»، و«غير معروف» يعني عدم الدمج. هذا هو القرار الأكثر تحفّظًا وهو المتوافق مع «تفضيل النقص على الزيادة».

**الأساس الإنتاجي:** ٢ من ١٢٢ صفًا تحمل `sender_id = NULL` (`count(sender_id) = 120`). قبل الإصلاح كان CASE 16 يدمج صورتين لمرسلين مجهولين مختلفين في حزمة واحدة `exp=2`؛ بعده صار حزمتين مستقلتين.

---

## ٩. Phase 3 Regression Matrix

**كيف نُفِّذت:** برنامج واحد (`/tmp/p4/cases.mjs`، ٢٣ حالة) يستورد المحرّك كما هو، ويُشغَّل مرتين: على `a725571` (قبل) وعلى شجرة العمل (بعد). المخرجات الكاملة: `/tmp/p4/before.txt` و`/tmp/p4/after4.txt`.

| CASE | المتوقع | الفعلي بعد | النتيجة |
|---|---|---|---|
| ١ — نص ← ألبوم | حزمة واحدة | `READY album[AC+T+A1+A2]` exp=2 | ✅ |
| ٢ — ألبوم ← نص | حزمة واحدة | `READY album[AC+A1+A2+T]` | ✅ |
| ٣ — نص ← ٣ صور | حزمة من ٤ | `READY adjacent[T+I1+I2+I3]` exp=3 | ✅ |
| ٤ — صورة بتعليق + صور | الصورة ذات التعليق منفصلة | `single[C1]` + `COLLECTING[P2+P3] NEEDS_TEXT` | ✅ |
| ٥ — ألبوم ← ألبوم | حزمتان | `album[A0+A1]` + `album[B0+B1]` | ✅ |
| **٦** — منتج أ ← منتج ب < ٣٠ث | **حزمتان، صفر خلط** | `TA+IA` و`TB+IB` | ✅ **كان فاشلًا** (`TA+IA+IB` + `TB`) |
| ٧ — منتجان > دقيقتين | حزمتان | `TA+IA` و`TB+IB` | ✅ |
| ٨ — ردّ على منتج سابق | الردّ يلتحق بالأصل | `TSRC+ISRC` + `R` مستقل | ✅ (سلوك القاعدة ٢ كما هو قبل وبعد) |
| ٩ — مرشّحا نص | `NEEDS_REVIEW` | `NEEDS_REVIEW album[MULTIPLE_TEXT_CANDIDATES]` + نصّان مستقلان | ✅ |
| **١٠** — حاوية فارغة + نص غير متعلق | **لا حزمة واحدة** | `album[AC] MEDIA_PARTIAL seats=2` + `single[T]` | ✅ **كان فاشلًا** (`AC+T`) |
| ١١ — وسائط معلّقة | `COLLECTING` والنص محفوظ | `COLLECTING[I+T] MEDIA_PENDING` | ✅ |
| ١٢ — وسائط فاشلة | `READY` + `MEDIA_PARTIAL` | `READY album MEDIA_PARTIAL` | ✅ **كان يفقد السبب** |
| ١٣ — مرسلون مختلفون | لا دمج | `COLLECTING[I]` + `single[T]` | ✅ |
| ١٤ — مجموعات مختلفة | لا دمج | `COLLECTING[I]` + `single[T]` | ✅ |
| ١٥ — نفس المنتج متباعدًا | `I2` لا تُدمج | `T1+I1` + `COLLECTING[I2]` | ✅ |
| **١٦** — مرسلون مجهولون | **لا دمج** | `COLLECTING[I1]` + `COLLECTING[I2]` | ✅ **كان فاشلًا** (`I1+I2`) |
| **١٧** — نص A صورة A نص B صورة B | A ≠ B | `TA+IA` و`TB+IB` | ✅ **كان فاشلًا** (`TA+IA+IB`) |
| **١٨** — نص A صورة A صورة B نص B | لا استيعاب صامت | `NEEDS_REVIEW[IA+IB] MULTIPLE_TEXT_CANDIDATES` + `TA`/`TB` | ✅ **كان يُستوعب صامتًا** |
| **١٩** — ٣ منتجات < ٣٠ث | لا حزمة تجمع الثلاثة | كل صورة في حزمة ≤ صورة واحدة، وكل صورة مرة واحدة | ✅ **كان فاشلًا** (`T1+I1+I2+I3`) |
| ٢٠ — ٤/٤ + حاوية | مكتمل | `exp=4 st=4 seats=0` READY | ✅ |
| ٢١ — ٨/٧ + حاوية | مكتمل | `exp=8 st=7 seats=1` READY | ✅ **كان `exp=7`** (إعادة كتابة الوعد) |
| ٢٢ — ٤/٢ | `MEDIA_PARTIAL` | `exp=4 st=2 seats=2 MEDIA_PARTIAL` | ✅ **كان `exp=3`** |
| ٢٣ — حاوية فقط | الحاوية ليست وسائط | `exp=2 st=0 seats=2 MEDIA_PARTIAL` | ✅ |
| ٢٤ — R-3 stanzaId متداخل | يُقرأ | `ACFF586F…`, `participant`، `source=message.contextInfo` | ✅ |
| ٢٥ — R-3 سياق بلا stanzaId | لا شيء | كل الحقول null | ✅ |

**ملاحظة صريحة:** الحالات ١–٥ و٧–٩ و١١–١٥ بقيت **متطابقة حرفيًا** قبل/بعد (الفرق الوحيد هو إضافة عمود `seats` في مخرَج التشخيص). أي أن الإصلاح غيّر الحالات المعطوبة فقط، ولم يمسّ ما كان صحيحًا.

**حزمة الاختبارات:** `whatsapp-bundle-shadow.test.mjs` — **٤٤ اختبارًا، ٤٤ ناجحًا، ٠ فاشل**.
**تحقّق النوع:** `tsc --strict` على الملفات المعدّلة نظيف. (بقية أخطاء `tsc` في هذا الصندوق مصدرها غياب `node_modules` — `drizzle-orm`, `@workspace/db`, `pino`, `express` — وهي موجودة قبل التعديل بنفس الأعداد.)

---

## ١٠. Production Safety

| البيان | الجواب | الدليل |
|---|---|---|
| تغيّر سلوك الـwebhook | **نعم — إضافة محلّل R-3 فقط** | `whatsapp-sync.ts` diff = ١٦ سطرًا في نقطتَي R-3، بلا سطر في أي مسار تجميع أو توجيه |
| تغيّر مسار Legacy أو association أو auto-accept | **لا** | لا ملف من هذه الملفات في `git diff --name-only` |
| تغيّر المحرّك المستخدم في الإنتاج | **لا** | المحرّك مستورد من ٣ ملفات: shadow-compare/cli/test، ولا واحد منها في `app-workers.ts` |
| بدأ أي worker باستخدام المحرّك | **لا** | `grep shadow app-workers.ts` = صفر |
| تغيّر في `queueUnprocessedWhatsAppProductMessages` | **لا** | لم يُلمس |
| تغيّر في Gemini أو الاستخراج أو إنشاء الاقتراحات/الحزم/المنتجات | **لا** | لم تُلمس أي من هذه الملفات |
| تغيّر في Evolution | **لا** | — |
| تغيّر في متغيرات البيئة | **لا** | لا `.env` ولا قراءة جديدة لأي متغير |
| تغيّر في النشر أو CI | **لا** | `.github/workflows` و`vercel.json` كما هي |
| تنفيذ migration | **لا** | `20261128010000_extraction_read_message_ids.sql` ملف نصي غير منفَّذ |
| تعديل بيانات إنتاجية | **لا** | كل استعلامات هذه المرحلة `SELECT` فقط |
| إرسال رسالة واتساب | **لا** | — |
| إيقاف Legacy | **لا** | ما زال هو المسار الوحيد العامل |
| كتابة صفوف حزم في قاعدة البيانات | **لا** | جدولا الحزم من المرحلة ٢ لم يُنشآ |

---

## ١١. Remaining Risks

1. **R-3 في الإنتاج ما زالت صفرًا (الخطر الأكبر).** ٠/١٢٢. المحلّل مقيس، والوصول غير مقيس. أي قرار لاحق مبني على «الردّ يربط الحزمة» هو قرار بلا دليل. **مطلوب:** رسالة ردّ حقيقية واحدة، ثم إعادة الاستعلام.
2. **R-4 لم يُطبَّق، فكل اقتراح جديد يفقد سجل ما قُرئ.** القياس الحالي (١١ مجموعة ألبوم بسجل مصدر واحد من ٧–٨) سيستمر ويتكرر مع كل ألبوم. الأثر: أي مقارنة Legacy/الجديد على المصادر تبقى غير قابلة للاعتماد.
3. **`greatest()` على `expected` (R-7) ما زال قائمًا** في `whatsapp-sync.ts:714-718`. مع القاعدة الجديدة (`>= expected − 1`) فإن upsert يرفع الوعد يمكن أن **يقلب ألبومًا مكتملًا إلى ناقص**. لم أُصلحه لأنه خارج النطاق، لكنه الآن أخطر مما كان: سابقًا كان الطرح يُمتصّ جزءًا من الخطأ.
4. **قاعدة R-2 تعني أن `expected` يمكن أن يكذب إلى الأبد.** ألبوم أعلن ١٣ ووصل ١٢ سيُظهر `seats=1` مكتملًا. هذا مقصود (الوعد لا يُعاد كتابته) لكنه يفرض على الواجهة أن تعرض «مقعد غير مستخدم» لا «ناقص» — وإلا ظهر نقص دائم وهمي.
5. **R-1 يكلّف under-grouping.** نص بين السعر والصور يفصلهما. مقصود، لكنه يعني أن منتجًا حقيقيًا قد يبقى نصًّا وصورًا منفصلين في الأيام الأولى قبل أن يعتاد التاجر على النمط.
6. **ترتيب الصور غير مضمون في ٦ مواضع `UNSAFE` وفي ٤ مواضع `NEEDS DESIGN`** (القسم ٧). أخطرها `product-vision-extraction.ts:111` (اختيار ٣ صور للنموذج) و`meta-publishing.ts:566` (صورة الغلاف) و`routes/product-extractions.ts:297` (ترتيب البطاقة). أي تقييم جودة يقرأ هذه المواضع اليوم يقرأ ترتيبًا غير موجود.
7. **صفر اختبارات تشغيلية على بيانات حيّة.** كل ما سبق مقيس على fixtures و٢٣ حالة محلية. لم يُشغَّل `shadow:bundles` على نافذة إنتاجية في هذه المرحلة (بسبب البند ٢).
8. **بيئة الصندوق ناقصة التبعيات:** ٦ ملفات اختبار في المستودع لا تُقلع هنا (`pino`/`node_modules` غائبة) — منها `whatsapp-product-bundling.test.mjs` و`whatsapp-direct-media.test.mjs`. هذه أعطال بيئة سابقة للتعديل، ولا علاقة لها بتغييرات هذه المرحلة، لكنها تعني أن CI هو الحكم النهائي لا هذا الصندوق.

---

## ١٢. Final Decision

**`READY FOR NEXT READ-ONLY VALIDATION`**

**لماذا ليس أعلى من ذلك:**
- **ليس `READY FOR PRODUCTION`** بحال: R-3 ما زالت `REPLY SIGNAL STILL UNVERIFIED` على ١٢٢ صفًا، ولم يُطبَّق R-4، ولم يُحسم R-5، ولم يُشغَّل المحرّك على بيانات إنتاجية.
- **ليس `READY FOR CONTROLLED SHADOW TEST`** لأن شرطَي الدخول ناقصان: (أ) إشارة ردّ مقيسة في الإنتاج، (ب) قرار ترتيب الصور (B) مُعتمد لأن المقارنة نفسها تعتمد عليه في موضع واحد على الأقل.
- **ليس `BLOCKED`** لأن كل ما كان مطلوبًا إصلاحه في نطاق R-1/R-2/R-6 **أُصلح وأُثبت**: الحالات ٦ و١٠ و١٦ و١٧ و١٨ و١٩ لم تعد تُنتج الدمج الخاطئ، وحساب الوسائط لم يعد يطرح الحاوية، و`null` لم يعد مرسلًا، والحالات الصحيحة لم تتغيّر.

**الخطوة التالية المقترحة (بموافقة صريحة منفصلة، للقراءة فقط):**
1. انتظار رسالة ردّ حقيقية واحدة ⇒ إعادة `count(reply_to_remote_id)` وتطلب `>= 1`. إن ظلّ صفرًا فالسؤال الحقيقي هو: **هل يرسل Evolution `contextInfo` أصلًا؟** — وهذا يُحسم من ظرف خام لا من كود.
2. اعتماد قرار R-5 **(B)** نصًّا، ثم إزالة اعتماد «أول/آخر صورة» في المواضع الستة `UNSAFE` — كتغيير منفصل مُصرَّح به.
3. مراجعة migration R-4 والموافقة على تطبيقه أو تأجيله. **التنفيذ يبقى `MUST BE NO` حتى تلك الموافقة.**
4. بعد ١–٣: إعادة تشغيل `shadow:bundles` على نافذة أوسع وإصدار جدول فروق Legacy/الجديد — وأولئك هم شرط دخول `CONTROLLED SHADOW TEST`.

**الخلاصة في سطر واحد:** المحرّك المعزول صار صحيحًا في الحالات السبع التي كانت معطوبة، وأُثبت ذلك بـ٤٤ اختبارًا و٢٣ حالة مقارنة قبل/بعد؛ لكن **إشارة الردّ في الإنتاج ما زالت غير موجودة (٠/١٢٢)، ومصدر «ما قُرئ» ما زال غائبًا من قاعدة البيانات** — وهذان هما ما يمنعان أي خطوة بعد التحقق.
