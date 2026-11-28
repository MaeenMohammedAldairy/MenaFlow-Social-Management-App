# تجميع رسائل واتساب في حزم — المرحلة ١ و٢ (قراءة فقط)

**التاريخ:** 2026-11-28 · **الفرع:** `arena/e1bfd860-menaflow-social-management-app` · **المشروع:** `qznbujvanjvkfxpehcbq`

**قاعدة البيانات:** لا شيء نُفِّذ. كل استعلام في هذا التقرير `SELECT` فقط.
**السلوك في الإنتاج:** لم يتغيّر. لا Legacy عُدِّل، ولا worker أُوقف، ولا Gemini نُودي، ولا رسالة واتساب أُرسلت.

---

## ١) المسار الحالي من الرسالة إلى Gemini

| # | الخطوة | الملف والسطر | ما تفعله فعليًا |
|---|---|---|---|
| ١ | Evolution API يدفع الحدث | `routes/whatsapp-sync.ts:685` | `POST /social/whatsapp/webhook`، يتحقق من `x-evolution-api-key`، ثم `claimWebhookEvent` بالـ idempotency |
| ٢ | معالجة الحدث | `lib/whatsapp-sync.ts:2096` `processWebhookEvent` | يتعرّف على `MESSAGES_UPSERT / MESSAGES_SET / MESSAGES_UPDATE` فقط (`:2566-2572`) |
| ٣ | حفظ الرسالة | `lib/whatsapp-sync.ts:344` `persistImportedMessage` | upsert على `(owner, instance, group_id, remote_message_id)`، ويكتب `media_available`، `media_download_status='pending'` إن وُجدت وسائط (`:530`) |
| ٤ | ربط ألبوم واتساب | `lib/whatsapp-message-scope.ts:107` + `lib/whatsapp-albums.ts:94` | يقرأ `messageAssociation{associationType:1}` → `mediaGroupId` + `mediaGroupExpectedCount`؛ `mediaGroupIndex = association.messageIndex ?? null` |
| ٥ | الوسائط | `lib/whatsapp-media-download.ts:992` | worker كل ٣ ثوانٍ (`app-workers.ts:215`) ينزّل `pending` ويكتب `stored / failed` |
| ٦ | التجميع القديم (Legacy) | `lib/whatsapp-association-suggestions.ts` | بناء «run» على ١٠ دقائق (`:180`)، ثم `canJoinActive` (`:423-426`)، ثم auto-accept كل ٦٠ ثانية (`lib/whatsapp-association-auto-accept.ts:38`) |
| ٧ | عضوية الحزمة تُقرأ عند القراءة | `lib/whatsapp-content-associations.ts:131` | `getWhatsAppContentBundle` يحسب المكوّنات المتصلة في كل مرة |
| ٨ | مفاتيح التجميع | `lib/whatsapp-content-association-logic.ts:68` | `whatsappProductExtractionGroupKey` يعيد توليد مفتاح sha256 لكل إجابة |
| ٩ | صفّ الانتظار | `lib/whatsapp-product-extraction.ts:488` `queueUnprocessedWhatsAppProductMessages` | يُدرج jobs بمفتاح `sha256(workspace:messageId)` (`:142`) |
| ١٠ | بوّابة الوسائط | `lib/whatsapp-product-extraction.ts:410` `hasCompleteWhatsAppProductMedia` | يشترط `expectedCount <= mediaRows.length` لكل الصفوف `stored` |
| ١١ | الاستخراج | `lib/whatsapp-product-extraction.ts:1065` → `lib/product-extraction.ts:671` | `extractWhatsAppProductCandidates` → `lib/ai-provider.ts:320` `callGeminiModel` |

---

## ٢) تدقيق الإشارات

| Signal | موجود؟ | المصدر | محفوظ؟ | مشكلة؟ |
|---|---|---|---|---|
| Remote message ID | نعم | `payload.key.id` → `remote_message_id` | نعم | لا. لكنه ليس فريدًا عالميًا: القيد هو `(owner, instance, group, remote_id)` |
| Sender | جزئي | `sender_id` / `sender_name` | نعم | لا يوجد `participant` من `contextInfo` في أي صف |
| Group JID | نعم | `group_jid` + `group_id` | نعم | يحتاج الاثنان معًا لتحديد النطاق |
| Timestamp | نعم | `message_timestamp` | نعم | **الخطر:** صفوف الألبوم تُحفظ متأخرة ساعات (زمن الرسالة 20:51:12، `created_at` 00:19:48) |
| Media IDs | نعم | `mena_whatsapp_message_media.id` | نعم | ٧٧ صفًا: ٦٧ `stored`، ٦ `failed`، ٤ `pending` |
| media_group_id | نعم | `resolveWhatsAppAlbumSource` | نعم | موجود للألبومات فقط؛ **`media_group_id` = NULL لحالة Drain Powder بثلاث صور** |
| media_group_source | نعم | `media_group_source` | نعم | قيد CHECK يسمح بقيمتين فقط: `protocol_association` / `provider_album_container` |
| media_group_index | نعم (عمود) | `mediaGroupIndex` | **لا** | **`media_group_index` = NULL في 1٢٢/1٢٢ صفًا.** الترتيب داخل الألبوم غير محفوظ |
| reply_to | نعم (عمود) | `reply_to_remote_id` | **لا** | **0/122.** `contextInfo.stanzaId` لا يُرسَل، فلا يوجد أي اقتباس محفوظ |
| media download status | نعم | `mena_whatsapp_message_media.download_status` | نعم | ٦ فشل دائم؛ لا شيء يعيدها للمحاولة إلا «إعادة التصدير» اليدوي |
| expected media count | جزئي | `media_group_expected_count` | نعم | **يشمل حاوية الألبوم نفسها**: `ACFEFACE` يعلن 13 والصورة 12، فيستحيل أن يتحقق الشرط `expected <= rows` |
| association metadata | جزئي | `source_media_payload` (10 صفوف فقط) | جزئي | الحقل يحمل `messageKey/sourceMessage/caption/mediaIndex/mimeType` ولا يحمل `messageAssociation` |

**خلاصة التدقيق:** إشارتان تحملان الوزن كله في التصميم الجديد — `reply_to` و`media_group_index` — غير موجودتين فعليًا في البيانات. لذلك بُني المحرّك على ما هو موجود (ألبوم + نص + جوار زمني كفاصل فقط) لا على ما هو مفترض.

---

## ٣) قواعد محرّك الحزم الجديد

الملف: `artifacts/api-server/src/lib/whatsapp-bundle-engine.ts` (دالة نقية، لا DB ولا شبكة).

**المبدأ المعكوس عن التصميم السابق:** أولًا تُجمع الوسائط في عناقيد، ثم يُطالب كل عنقود بنص واحد على الأكثر، وكل ما تبقّى يصبح عنصرًا مستقلًا. `resolveBundleKey(message) → قرار دائم` استُبدل بحالة قابلة للجمع (`COLLECTING → READY`).

**الترتيب الإلزامي للقواعد (أول قاعدة تفوز):**

| # | القاعدة | الدليل | الحالة |
|---|---|---|---|
| ١ | `ALBUM` | `media_group_id` مؤكد (`protocol_association` أو `provider_album_container`) | `READY` بعد `albumSettleMs` = ٦٠ ثانية، ومعها `MEDIA_PARTIAL` إن بقي نقص |
| ٢ | `REPLY` | `reply_to_remote_id` يشير إلى عضو داخل النافذة | غير قابل للاختبار الآن: 0/122 |
| ٣ | `EXPLICIT` | إشارة صريحة داخل النص | محجوز، لا يُنتج اليوم |
| ٤ | `CLUSTER_TEXT` | نص واحد مجاور لعنقود وسائط، ولا نص آخر أقرب منه | يربط النص بالعنقود في أي اتجاه (نص→صور أو صور→نص) |
| ٥ | `SINGLETON` | لا دليل | لا يُرسَل للاستخراج من تلقاء نفسه |

**حدود الجوار:** `adjacencyMs = 30s` تُستخدم **ككاسر تعادل فقط**. الزمن لا يدمج شيئًا بمفرده — وهذا هو الفرق الجوهري عن `WHATSAPP_PRODUCT_BUNDLE_WINDOW_MS = 10 * 60_000` في Legacy (`whatsapp-association-suggestions.ts:180`).

**بوّابات الدمج (`checkMergeGuard`, `:286`):**

- `PRODUCT_TOKEN_CONFLICT` — رموز منتج متعارضة بلا تقاطع.
- `DIFFERENT_ALBUMS` — ألبومان مختلفان.
- `COMPETING_EVIDENCE` — طرفان لكل منهما دليل قوي.
- وإضافة مقصودة: **صورة تحمل تعليقًا خاصًا لا تُخطَف كنص مرساة** (`isClaimableText`, `:229`)، وإلا انتقلت صورها إلى منتج آخر — وهذا هو الدمج الزائد بعينه.

**هوية الحزمة:** `bundle:<fnv(workspace, instance, groupJid, anchorMessageId)>` حيث المرساة أقدم عضو. إعادة التخطيط على نافذة أكبر تُنتج نفس المعرّف — على عكس `whatsappProductExtractionGroupKey` الذي يولّد مفتاحًا جديدًا مع كل إجابة.

**التعقيد:** 12 عنقودًا لـ43 رسالة في زمن أقل من ثانية، وبلا أي استدعاء خارجي.

---

## ٤) جدول المقارنة الظلية (Shadow) على صفوف حقيقية

المصدر: `artifacts/api-server/src/lib/whatsapp-bundle-shadow.fixture.json` — ٤٣ رسالة حقيقية (معرّفاتها كما في الإنتاج) + عضوية Legacy الحقيقية المقروءة من `mena_product_extraction_suggestions/sources` (أحدث نسخة لكل `group_key`).

| Case | Legacy | New Bundle | Result | Reason |
|---|---|---|---|---|
| ١ Massage Gun — نص «السعر بعد التخفيض 9500 ريااال» + ألبوم 13 | مفتاح واحد `0d958cd8…` لـ13 رسالة (الحاوية + ١٢ صورة)، والنص `AC72828E` **بلا مفتاح** | ألبوم واحد، ١٤ عضوًا: النص + الحاوية + ١٢ صورة | `LEGACY_SPLIT` (للأعضاء) + `NO_MATCH` (للنص) | `LEGACY_SENT_FEWER_MESSAGES` / `LEGACY_HAS_NO_GROUP` |
| ٢ Drain Powder — ٣ صور بلا `media_group_id` | ٣ مفاتيح منفصلة، كل صورة وحدها | عنقود واحد: ٣ صور + النص `ACB1DD62` | `LEGACY_SPLIT` | `LEGACY_QUEUED_ONE_MESSAGE_ALONE` |
| ٣ NAVIFORCE | `0bef4438…` وحده، لا يلمس صور Drain | عنصر مستقل، لا يدخل حزمة Drain | `LEGACY_SPLIT` | لا دمج عبر الزمن |
| ٤ صورة → نص | الصورة لحالها | حزمة من عضوان | `LEGACY_SPLIT` | التناظر مع الحالة ٥ |
| ٥ نص → صورة | النص لحاله | نفس الحزمة | `LEGACY_SPLIT` | نفس النتيجة |
| ٦ صورة×٣ → نص | الصور متفرقة | حزمة من ٤ | `LEGACY_SPLIT` | العنقود يجمع ثم يُطالب بالنص |
| ٧ منتج A → منتج B (دقيقتان) | يفصل غالبًا بسبب تطابق الرموز | حزمتان منفصلتان | `MATCH`-سلوكيًا | الزمن وحده لا يدمج |
| ٨ رسالة عادية «السلام عليكم» | `message:915144bd…` | `single` / `NONE` | `MATCH` | لا تُرسَل للاستخراج |
| ألبوم ACE5CCDE (NAVIFORCE) يعلن صورتين ولم يصل شيء | محاولة استخراج انتهت `PRODUCT_TEXT_REQUIRED` | `READY` مع `MEDIA_PARTIAL`، 2 متوقعة / 0 مخزّنة | `NO_MATCH` | لا انتظار أبدي |
| ألبوم المكنسة `ACB52BB7` بين نصَّين | `album:4ba89c38…` = ٤ رسائل | `NEEDS_REVIEW` / `MULTIPLE_TEXT_CANDIDATES` | `NEEDS_REVIEW` | تُحفظ الصور، ولا يُختار نص بالتخمين |
| نسيج 17:44 (مكنسة + مسدس تسليك + ساعة حائط) | `bundle:a556eb70…` = ٤ رسائل **من ٣ منتجات** | ٤ عناصر مستقلة + حزمة صور بانتظار مراجعة | `LEGACY_MERGE` ×٤ | `LEGACY_ASSOCIATION_JOINED_EXTRA_MESSAGES` |
| «وصل وصل» (صورة بتعليق) + صورتان | `bundle:90630bd3…` = الصورة + صورة أخرى | صورة التعليق وحدها، والصورة الثانية مع النص المجاور | `LEGACY_MERGE` | الصورة ذات التعليق لا تُخطَف |
| الصوف 22:39 (نص + ٥ صور) ثم سوكاني 22:46 | `bundle:d459a5cc…` فيه نص الصوف + صورة واحدة + **نص سوكاني** | حزمتان: ٦ أعضاء، ثم ٦ أعضاء | `LEGACY_MERGE` + `LEGACY_SPLIT` | فصل منتجين، وجمع نص بصوره |

**إجمالي المقارنة (٤٣ صفًا):**

| MATCH | LEGACY_SPLIT | LEGACY_MERGE | SET_OVERLAP | NEEDS_REVIEW | NO_MATCH |
|---|---|---|---|---|---|
| 1 | 29 | 4 | 0 | 6 | 3 |

`LEGACY_SPLIT` هنا تعني حرفيًا: Legacy أرسل إلى النموذج رسائل أقلّ من العرض الحقيقي. `NO_MATCH` تعني: الرسالة لم تُدرَج في أي مجموعة Legacy إطلاقًا.

---

## ٥) النتائج الحرجة

1. **السعر يُفقد، لا الصور.** نص Massage Gun «السعر بعد التخفيض 9500 ريااال» (`AC72828E`) له **0 صفوف في `mena_product_extraction_sources`**، بينما الألبوم يحمل مفتاحًا واحدًا لـ١٣ رسالة. Legacy يجمع الصور ويترك النص — وهو عكس ما يفترضه التصميم.
2. **الصور تُفقد، لا السعر.** صور Drain Powder الثلاث لها ٣ مفاتيح مختلفة ونصّها `ACB1DD62` له **0 صفوف**. أي أن العرض ينقسم إلى ثلاث حالات استخراج لا تحتوي السعر.
3. **دمج منتجات مختلفة في حزمة واحدة مُرسلة فعلًا:** `bundle:a556eb70…` يضم «مكنسة غسيل السجاد» + «مسدس تسليك المجاري» + «ساعة الحائط» — ثلاثة منتجات في استدعاء واحد، وحالته `review`.
4. **حساب عدّاد الألبوم خاطئ بنيويًا:** `hasCompleteWhatsAppProductMedia` (`whatsapp-product-extraction.ts:461-486`) يقارن 13 صورة متوقّعة بـ12 صفًا موجودًا، لأن العدّاد يعلن الحاوية نفسها. النتيجة: بوّابة لا تتحقق أبدًا.
5. **`media_group_index` فارغ في كل الصفوف**، فلا يمكن ترتيب صور الألبوم؛ الترتيب الحالي يعتمد على `media_index` داخل الرسالة الواحدة فقط.
6. **`reply_to` غير محفوظ إطلاقًا (0/122)**، فقاعدة `REPLY` في المحرّك الجديد معطّلة عمليًا حتى يُحفظ `contextInfo.stanzaId`.
7. **تعريف النوع في عمود المفاتيح:** مفاتيح Legacy القديمة بلا بادئة (`0bef4438…`)، والمفاتيح الجديدة `bundle:` / `album:` / `message:`. أي مقارنة تعتمد على `split_part(group_key, ':', 1)` تقرأ المفتاح القديم على أنه نوعه — أُصلح في `whatsapp-bundle-shadow-cli.ts` بقراءة البادئة صراحة.

---

## ٦) خطر التجميع الزائد (Over-grouping)

| المصدر | الملف والسطر | الأثر المقيس |
|---|---|---|
| الانضمام بالزمن + وجود وسائط فقط | `whatsapp-association-suggestions.ts:423-426` (`continuation \|\| hasMedia`) | `bundle:a556eb70…` جمع ٣ منتجات |
| قبول تقاطع رمز واحد | `whatsapp-association-suggestions.ts:386-390` | اسم منتج مشترك يكفي للدمج |
| ألبوم معلن بلا أبناء | `ACE5CCDE` | يُحاول الاستخراج على صفر صور |
| نافذة ١٠ دقائق | `:180` | منتجان متتاليان داخل ١٠ دقائق قابلان للدمج |

**ما يفعله المحرّك الجديد:** يرفض الدمج عند تعارض الرموز أو اختلاف الألبوم أو وجود دليلين قويين، ويُبقي النص المشكوك فيه خارج العنقود ويسمّي المرشّحين (`MULTIPLE_TEXT_CANDIDATES`)، ويمنع خطف صورة تحمل تعليقها. الاختيار المُتعمَّد: **تفضيل التجميع الناقص على التجميع الزائد**.

---

## ٧) خطر التجميع الناقص (Under-grouping)

| الحالة | السلوك الجديد | كلفته |
|---|---|---|
| نص في المنتصف بين عنقودين | `NEEDS_REVIEW`، ولا يُطالب أي طرف بالنص | حزمة تحتاج قرار بشري |
| ألبوم يعلن ٢ ولم يصل شيء | `READY` + `MEDIA_PARTIAL` | استخراج بلا صور، لكن بلا انتظار أبدي |
| وسائط `pending` | `COLLECTING` + `MEDIA_PENDING` | تأخير حتى ينزل الملف |
| صورة وحدها بلا نص | `COLLECTING` + `NEEDS_TEXT`، ثم مستقل | صورة لا تُستخرج تلقائيًا |
| `reply_to` مفقود | قاعدة `REPLY` لا تعمل | تُترك للحالات الأخرى |

الكلفة الحقيقية: ٦ صفوف من ٤٣ صارت `NEEDS_REVIEW` و٣ `NO_MATCH` في المقارنة. البديل (تخمين النص) هو ما أنتج `bundle:a556eb70…`.

---

## ٨) مسار الترحيل

**لم يُنفَّذ أي شيء من هذا المسار.**

الملف: `supabase/migrations/20261128000000_whatsapp_bundles_shadow.sql` — يحمل في أوله `-- >>> NOT EXECUTED. <<<`، ويُرتَّب بعد `20261127000000_product_extraction_simplification.sql`.

يُنشئ جدولين فقط:

- `mena_whatsapp_bundles` — `id text PK`, `status ∈ (COLLECTING, READY, NEEDS_REVIEW, PROCESSING, DONE, DISMISSED)`, `kind ∈ (album, reply, explicit, adjacent, single)`, `media_expected`, `media_stored`, `version`, `frozen_at`, `member_set_hash`. قيد `PROCESSING ⇒ frozen_at NOT NULL` يُثبّت لقطة التجميد المطلوبة في المرحلة القادمة.
- `mena_whatsapp_bundle_members` — `(bundle_id, message_id)` فريد، `role ∈ (media, text, both)`، `claim_reason` محدّد بـ٦ قيم.

**ما لا يفعله الملف عمدًا:** لا backfill، لا تعديل على `mena_product_extraction_*`، لا تغيير على `mena_whatsapp_messages` أو `mena_whatsapp_message_media`، لا trigger، لا function، لا cron، لا صلاحيات، لا RLS.

> **تصحيح جوهري أثناء المراجعة:** `mena_whatsapp_messages.id` من نوع `text` لا `uuid` (`lib/db/src/schema/social.ts:577`). كانت النسخة الأولى من الملف تستخدم `uuid` للمفاتيح الأجنبية، وهي كانت ستفشل عند التطبيق. صُحّحت إلى `text` **قبل** أي محاولة تنفيذ.

---

## ٩) الملفات التي تغيّرت

| الملف | النوع | السبب |
|---|---|---|
| `artifacts/api-server/src/lib/whatsapp-bundle-engine.ts` | **جديد** (876 سطرًا) | المحرّك النقي: عناقيد ← نص واحد، ٥ قواعد مرتّبة، بوّابات دمج، جهوزية قابلة للجمع، معرّف ثابت |
| `artifacts/api-server/src/lib/whatsapp-bundle-shadow-compare.ts` | **جديد** (189 سطرًا) | تصنيف Legacy مقابل الظل بالمكوّنات لا بالمعرّفات: MATCH / LEGACY_SPLIT / LEGACY_MERGE / SET_OVERLAP / NEEDS_REVIEW / NO_MATCH / MISSING_SIGNAL |
| `artifacts/api-server/src/lib/whatsapp-bundle-shadow-cli.ts` | **جديد** (269 سطرًا) | تقرير ظل من fixture أو من `SELECT` فقط؛ يطبع `wroteToDatabase:false, calledModel:false, createdJobs:0, createdSuggestions:0` |
| `artifacts/api-server/src/lib/whatsapp-bundle-shadow.fixture.json` | **جديد** | ٤٣ رسالة إنتاجية حقيقية + عضوية Legacy الحقيقية؛ مدخل الاختبارات |
| `artifacts/api-server/src/lib/whatsapp-bundle-shadow.test.mjs` | **جديد** (483 سطرًا) | ٢٤ اختبارًا: الحالات ١–٨، بوّابات الدمج، الجهوزية، سباق النص المتأخر، ثبات المعرّف |
| `supabase/migrations/20261128000000_whatsapp_bundles_shadow.sql` | **جديد، لم يُنفَّذ** | جدولا الحزم والانتماء فقط |
| `package.json` | **معدَّل** (سطر واحد) | إضافة `shadow:bundles` لتشغيل التقرير يدويًا |

**ما لم يُمَس:** أي ملف في Legacy، أي worker، `autoAcceptWhatsAppAssociationsForWorkspace`، تمريرة الـ٦٠ ثانية، Evolution، الـwebhook، `lib/ai-provider.ts`.

**التحقق المنفَّذ:**
- `node --experimental-strip-types --test …shadow.test.mjs` → **24/24 pass**.
- `tsc --noEmit --strict` على الملفات الثلاثة → **نظيف**.
- `pnpm shadow:bundles --fixture …` → يعمل، تقرير كامل.

---

## ١٠) لا تغييرات في قاعدة البيانات

**لم يُنفَّذ أي أمر كتابة.** لا `CREATE`، لا `ALTER`، لا `INSERT/UPDATE/DELETE/UPSERT`، لا backfill، لا صف ظل واحد.

- كل استعلام في هذه الجلسة كان `SELECT`، ونتائجه مسجّلة أعلاه.
- ملف الترحيل موجود كملف فقط، ولم يُطبَّق على `qznbujvanjvkfxpehcbq` ولا على أي نسخة محلية.
- `supabase_migrations.schema_migrations` لم يتغيّر؛ آخر إصدار مسجّل يبقى `20261127000000`.
- `shadow:bundles` لا يكتب: مسار القاعدة يفتح `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` ثم `BEGIN` ثم `ROLLBACK`.
  **عيب أُصلح:** النسخة الأولى كانت تنفّذ `SET TRANSACTION READ ONLY` خارج كتلة معاملة — وهي جملة يرفضها PostgreSQL بالرمز `25P01`، أي أن الضمان كان شكليًا والتقرير كان سيفشل قبل قراءة صف واحد.

---

## ١١) لا تغيير في سلوك الإنتاج

- لم يُعدَّل أي ملف يُستورَد من التطبيق أو من الـworker. الملفات الجديدة **لا يستوردها أي شيء** — لا route، ولا `app-workers.ts`، ولا `index.ts`.
- لا ميزة خلف علم (flag) ولا بدون علم: الملفات معزولة تمامًا.
- `package.json` أضاف سكربتًا لا ينفّذه أحد تلقائيًا.
- لم يُودَع أي شيء على Vercel، ولم يُغيَّر متغيّر بيئة.
- Legacy يعمل اليوم كما عمل أمس: ١٢٢ job، ٩٩ suggestion، ٢٢ association — كلها كما قِيست قبل هذا العمل.

---

## ١٢) التوصية النهائية

# READY FOR NEXT PHASE — مع شرطين مكتوبين لا مؤجّلين

**لماذا جاهز:** المحرّك يجتاز الحالات الإلزامية الثماني على صفوف إنتاجية حقيقية، ولا يدمج منتجين، ولا يعتمد على الزمن وحده، ولا يفقد النص المتأخر. التقرير الظلي يُنتج فرقًا قابلًا للتفسير لكل صف (٤٣ صفًا: ٢٩ انقسام Legacy، ٤ دمج زائد، ٦ تحتاج مراجعة، ٣ بلا مجموعة، ١ مطابق). لم تُلمس قاعدة البيانات ولا Legacy ولا Gemini.

**الشرطان قبل أي كتابة فعلية:**

1. **`reply_to` غير محفوظ (0/122)** — قاعدة `REPLY` في التصميم لا يمكن اختبارها. المطلوب في المرحلة القادمة: حفظ `contextInfo.stanzaId` في `persistImportedMessage` وإعادة قياس التغطية قبل الاعتماد على القاعدة.
2. **عدّاد الألبوم يعلن الحاوية** — `media_group_expected_count = 13` مقابل ١٢ صورة. المحرّك الجديد يطرح الحاويات ويعطي 12/12، لكن `hasCompleteWhatsAppProductMedia` القديم يظل عالقًا. أي ربط بين النظامين لاحقًا يجب أن يمرّ عبر العدّاد المصحّح لا القديم.

**ما لا يُفعل في المرحلة القادمة أيضًا:** لا تفعيل للمحرّك على المسار الحقيقي، ولا كتابة صفوف، ولا استدعاء Gemini، ولا إيقاف Legacy — حتى يُقرَّر ذلك صراحةً.
