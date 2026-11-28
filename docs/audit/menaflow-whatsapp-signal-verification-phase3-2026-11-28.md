# Phase 3 — Signal Verification Audit

**التاريخ:** 2026-11-28 · **الفرع:** `arena/e1bfd860-menaflow-social-management-app`
**المشروع:** `qznbujvanjvkfxpehcbq` · **النطاق المقيس:** ١٢٢ رسالة، ٧٧ صف وسائط، ١١ ألبومًا، ١ مساحة عمل، ١ مجموعة، ١ مثيل.
**كل استعلام في هذه المرحلة `SELECT` فقط. لم يُعدَّل أي ملف إنتاجي، ولم تُنفَّذ migration، ولم يُنشأ أي Job/Suggestion/Bundle.**

---

## 1. Executive Summary

الهدف كان إثبات الإشارات، لا إصلاحها. النتيجة في سطر واحد: **الإشارة القوية الوحيدة المتاحة والموثوقة هي `media_group_id` (ألبوم). كل ما بُني حولها في المرحلة ٢ يحتاج تصحيحًا، وإشارتان أساسيتان في تصميم المحرّك غير موجودتين في البيانات إطلاقًا.**

أهم ست نتائج، وكلها بأدلة صفوف:

1. **`reply_to` = ٠/١٢٢، و`media_group_index` = ٠/١٢٢، و`media_index` = ٠/٧٧.** أي أن قاعدة `REPLY` في المحرّك ميتة، ولا يوجد أي ترتيب داخلي محفوظ لصور الألبوم. `RAW` payloads المحفوظة لا تحتوي `stanzaId` ولا `quotedMessage` ولا `participant` ولا `messageIndex` (١٠/١٠ صفوف).
2. **`expected_count` لا يعني ما افترضته المرحلة ٢.** في ٨ ألبومات من ١١ `expected == عدد الصور` (الحاوية غير محسوبة)، وفي ألبومين `expected == الصور + ١`، وفي ألبومين لا يطابق أيًّا منهما. صيغة «اطرح الحاويات» خاطئة في العموم.
3. **`mena_product_extraction_sources` ليس سجلًّا لعضوية Legacy.** الصفوف تُكتب من `candidate.sourceMessageIds` التي **يعيدها النموذج**، لا من الرسائل التي قرأها المسار. الدليل: نص Drain `ACB1DD62` أنتج اقتراحًا صحيحًا (اسم «مسحوق سحري…») لكن له **٠ صفوف مصدر**، لأن النموذج أعاد معرّف صورة أخرى. هذا يُبطل استخدام الجدول كـ«حقيقة Legacy» في مقارنة المرحلة ٢.
4. **ادّعاء المرحلة ٢ بأن «نص السعر لم يُدرَج في الطابور» غير صحيح.** `AC72828E` أُنشئ له Job، ونجح استخراجه (`EXTRACTION_SUCCEEDED`, `candidateCount: 1`, 00:33)، ومع ذلك لا يوجد له صف مصدر — للسبب نفسه في البند ٣.
5. **خلل حقيقي ومُثبَت في المحرّك الجديد: تجميع زائد.** نصّان لمنتجين مختلفين + صورتان، كلها داخل ٣٠ ثانية ⇒ **حزمة واحدة تجمع المنتجين** (بل ثلاثة منتجات في حزمة واحدة في اختبار ثالث). السبب: عنقود الوسائط لا يتوقف عند نص.
6. **حاوية الألبوم ليست رسالة وسائط:** ١١/١١ حاوية لها `media_available=false` و`media_rows=0`، و`media_group_expected_count` موجودة على الحاوية فقط.

**القرار في البند ١٧:** `READY WITH CONDITIONS`، وليس `BLOCKED`، لأن الإشارة الوحيدة القوية (الألبوم) مفهومة بالكامل ويمكن البناء عليها الآن — بشرط تنفيذ الشروط الثمانية المرتّبة.

---

## 2. Actual Message Flow

الخريطة الفعلية، لا المفترضة:

```
Evolution API
  └─ POST /social/whatsapp/webhook            routes/whatsapp-sync.ts:685
       ├─ verifyWhatsAppWebhookSecret           :686
       ├─ evolutionWebhookEventKey + claimWebhookEvent (idempotency)  :704-712
       └─ processWebhookEvent                   lib/whatsapp-sync.ts:2096
            ├─ eventName ∈ {MESSAGES_UPSERT, MESSAGES_SET, MESSAGES_UPDATE}   :2566-2572
            ├─ MESSAGES_UPDATE بلا محتوى ⇒ تجاهل  :2573-2576
            └─ persistImportedMessage(payload={...eventPayload, ...candidateRecord, key, source})  :2583
                 ├─ connection + ownerId                       :357-371
                 ├─ remoteJid normalization + group check      :373-395
                 ├─ remoteMessageId = key.id ?? payload.id     :397-405
                 ├─ textBody = extractWhatsAppTextFromMessage  :407-409   (lib/whatsapp-message-scope.ts)
                 ├─ mediaItems = extractMediaItemsFromMessage  :410-413   (يدعم albumMessage.messages)
                 ├─ albumAssociation = extractWhatsAppAlbumAssociation(payload)  :428
                 │     └─ walkRecords → messageAssociation.associationType==1
                 │        → { parentMessageId, parentRemoteJid, messageIndex }   scope:100-128
                 ├─ advertisedMediaCount = extractWhatsAppMediaGroupExpectedCount(payload)  :485
                 │     └─ messageAssociation.expectedImageCount+expectedVideoCount
                 │        أو albumMessage.expectedImageCount/VideoCount أو albumMessage.messages.length
                 ├─ albumSource = resolveWhatsAppAlbumSource    :490  (lib/whatsapp-albums.ts:93-121)
                 │     └─ mediaGroupId = album:sha256(owner,instance,groupJid,parentId)
                 │        mediaGroupExpectedCount = mediaItemCount>1 ? max(count,advertised) : advertised
                 │        mediaGroupIndex = association.messageIndex ?? null   ← هنا يُفقد دائمًا
                 ├─ replyToRemoteId = payload.replyTo ?? contextInfo?.stanzaId  :588-593
                 ├─ upsert (owner,instance,group_id,remote_id)  :679-760
                 │     └─ mediaGroupExpectedCount = greatest(existing, new)  :714-718
                 ├─ sourceMediaPayload = mediaItems.map(...)    :535-552  (يحفظ sourceMessage الكامل!)
                 └─ albumAssociation ⇒ تحديث الأب بـ mediaGroupId   :756+
  └─ media-download worker (كل ٣ ثوانٍ)          lib/app-workers.ts:215 → whatsapp-media-download.ts:992
       └─ rows في mena_whatsapp_message_media، media_index يأتي من sourceMediaPayload[i].mediaIndex
  └─ Legacy: association suggestions             lib/whatsapp-association-suggestions.ts
       └─ auto-accept كل ٦٠ ثانية               lib/whatsapp-association-auto-accept.ts:38
  └─ auto-queue (كل ٦٠ ثانية)                    whatsapp-product-extraction.ts:1881
       └─ queueUnprocessedWhatsAppProductMessages :488
  └─ extraction worker (كل ٣ ثوانٍ)              whatsapp-product-extraction.ts:2037
       ├─ getWhatsAppContentBundle                whatsapp-content-associations.ts:131
       ├─ hasCompleteWhatsAppProductMedia         whatsapp-product-extraction.ts:410
       ├─ groupKey = whatsappProductExtractionGroupKey  content-association-logic.ts:68
       └─ extractWhatsAppProductCandidates → callGeminiModel   product-extraction.ts:671 / ai-provider.ts:320
```

**ملاحظة مسار مهمة:** `contextInfo` يُقرأ **من `payload` الجذر فقط** (`whatsapp-sync.ts:472`)، بينما في Evolution يكون `contextInfo` عادةً داخل `data.message.<type>Message.contextInfo`. هذا موضع الفقد المحتمل لـ`stanzaId` (البند ٤).

---

## 3. Raw Payload Findings

**هل الـRaw Payloads محفوظة؟** جزئيًا، وبشكل محدد:

- **لا يوجد جدول يخزّن الـenvelope الكامل.** `mena_inbound_webhook_events` (٩ أعمدة) يخزّن فقط `event`, `delivery_confirmed`, `instance_name`, و`context` وهو **بيانات توجيه بحتة**:

```json
{"eventName":"MESSAGES_UPSERT","workspaceId":"c1db…","instanceName":"menaflow-3c247d…","directIncoming":false,"autoReplyQueued":false}
```

  ⇒ `stanzaId` غير موجود في ٠/٣٠٢ حدث `WHATSAPP_WEBHOOK_PROCESSED` (وفُحص كذلك ٣٩١ حدث `UNKNOWN_INSTANCE`).
- **المصدر الحقيقي للـpayload هو `mena_whatsapp_messages.source_media_payload`** — ١٠ صفوف فقط، مصفوفة من عنصر واحد، وكل عنصر يحمل `sourceMessage` = الرسالة الكاملة (منزوعة البيانات المضمّنة عبر `stripInlineMediaData`, `whatsapp-sync.ts:551`).

**بصمة المفاتيح في الـ١٠ عيّنات (كلها `imageMessage`):**

| المجموعة | المفاتيح |
|---|---|
| `element` (المستوى الأعلى) | `caption, fileName, mimeType, mediaType, sizeBytes, mediaIndex, messageKey, sourceMessage` |
| `sourceMessage` | `imageMessage, messageContextInfo` |
| `imageMessage.contextInfo` | `mentionedJid[], groupMentions[], pairedMediaType, statusAttributions[]` |
| `messageContextInfo` | `threadId[], messageSecret, messageAssociation{associationType:1, parentMessageKey{id, fromMe, remoteJid}}` |

**عدّ الإشارات في الـ١٠ عيّنات (بحث نصي داخل الـjsonb):**

| إشارة | موجودة؟ |
|---|---|
| `messageAssociation` | **١٠/١٠** |
| `contextInfo` (متداخل) | ١٠/١٠ |
| `mentionedJid` / `groupMentions` / `pairedMediaType` / `statusAttributions` | ١٠/١٠ (كلها فارغة/صفريّة) |
| `messageSecret` / `threadId` | ١٠/١٠ (بلا قيمة ربط) |
| `stanzaId` | **٠/١٠** |
| `quotedMessage` | **٠/١٠** |
| `participant` | **٠/١٠** |
| `messageIndex` | **٠/١٠** |
| `expectedImageCount` | **٠/١٠** |
| `albumMessage` | **٠/١٠** |
| `isForwarded` | **٠/١٠** |

**حدود هذا الدليل — يجب قوله بصراحة:**

- العيّنات كلها **صور مفردة داخل ألبوم** ومصدرها `android` (استيراد تاريخي). لا تحتوي أي رسالة `reply`، ولا أي حاوية ألبوم، ولا أي صورة بلا ألبوم.
- لذلك: **لا يمكن** إثبات أن `stanzaId` لا يصل من Evolution أبدًا. المثبت هو: (أ) لا صف محفوظ يحمله، (ب) الـparser يقرأ `contextInfo` من الجذر فقط وهو مسار غير مطابق لشكل Evolution. أما «Evolution لا يرسله» فهي **UNVERIFIED**.
- أما `messageAssociation` **بلا `messageIndex`** فهو مثبت على ١٠/١٠، ويطابق ٠/١٢٢ في العمود.
- ملاحظة سياق: ٣٩١ حدث `WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE` مقابل ٣٠٢ `PROCESSED` — نسبة توجيه معطوب عالية تستحق مراجعة مستقلة.

---

## 4. reply_to Investigation

| Signal | Present in Payload | Parsed | Persisted | Coverage |
|---|---|---|---|---|
| `payload.replyTo` | **UNVERIFIED** (لا رسالة reply واحدة في الـcorpus) | نعم — `whatsapp-sync.ts:588-590` | لا | 0/122 |
| `payload.contextInfo.stanzaId` (جذر) | **UNVERIFIED** — غير موجود في ٠/١٠ عيّنة، و٠/٣٠٢ حدث ويب هوك | نعم — `:591-592` | لا | 0/122 |
| `contextInfo` داخل `message.<type>Message` | **موجود ١٠/١٠** لكن **بلا `stanzaId`** | **لا** — لا يوجد كود يقرأه | لا | 0/122 |
| `messageContextInfo.stanzaId` | ٠/١٠ | لا | لا | 0/122 |

**النتيجة:** ثلاث حقائق منفصلة يجمعها التشخيص عادةً، وهنا منفصلة:

1. **موضع القراءة مغلوط.** الكود يقرأ `asRecord(payload.contextInfo)` (`whatsapp-sync.ts:472`) و`payload.replyTo`. في الشكل المحفوظ فعليًا، الـ`contextInfo` يقع تحت `imageMessage.contextInfo`، والـ`messageContextInfo` بجواره — وليس على الجذر. أي أنه **حتى لو وصل `stanzaId`**، فإن `persistImportedMessage` لا ينظر إلى المكان الذي يستقر فيه. هذا مسار فقد مؤسَّس على الكود، لا على بيانات ناقصة.
2. **لا عيّنة تحمل `stanzaId`** في أي من المستويين (١٠ مصفوفة + ٣٠٢ حدث + ٣٩١ حدث توجيه).
3. **لا رسالة اقتباس واحدة في الـ١٢٢ رسالة** (٠/١٢٢ محفوظ)، فلا يمكن الحكم على التوفر الفعلي من Evolution.

**أثر ذلك على المحرّك:** قاعدة `REPLY` (`whatsapp-bundle-engine.ts:645-661`) لا يمكن أن تعمل: مدخلها `replyToRemoteId` وهو `null` دائمًا. الأسوأ أن القاعدة **لا تعمل حتى لو امتلأ الحقل** بالشكل الحالي — انظر البند ١٢ و`CASE 8`.

**تصنيف:** `MISSING` الآن، و`UNAVAILABLE` حتى يُصلح موضع القراءة — وكلاهما لا يبرر انتظارًا.

---

## 5. messageAssociation Investigation

سلسلة كل حقل من المصدر إلى المحرّك:

| الحقل | SOURCE | PARSER | PERSISTENCE | DB COLUMN | BUNDLE ENGINE |
|---|---|---|---|---|---|
| `messageAssociation` | Evolution (`messageContextInfo`) — **١٠/١٠ في العيّنات** | `extractWhatsAppAlbumAssociation` (`message-scope.ts:107-128`) عبر `walkRecords` | `albumAssociation` (`whatsapp-sync.ts:428`) | — (لا عمود) | — |
| `associationType` | Evolution = `1` | `isMediaAlbumAssociationType` (`:96-99`) | بوابة فقط | — | — |
| `parentMessageKey.id` | Evolution | `:114-115` | يُشتق منه `mediaGroupId` | `media_group_id` | `ALBUM` (المفتاح) |
| `messageIndex` | **غير موجود في Evolution** (٠/١٠) | يُقرأ لو وُجد (`:119-124`) | `albumSource.mediaGroupIndex` | `media_group_index` = **NULL في ١٢٢/١٢٢** | **لا يُستخدم** (كل الترتيب مبني على الوقت) |
| `mediaGroupId` | **مُشتق داخل MenaFlow** لا من Evolution | `whatsappAlbumId` = `album:sha256(owner,instance,groupJid,parentId)` (`whatsapp-albums.ts:67-79`) | `:572` | `media_group_id` (٦١ صفًا) | نعم |
| `mediaGroupExpectedCount` | Evolution أو الحاوية | `extractWhatsAppMediaGroupExpectedCount` (`message-scope.ts:440-484`) | `resolveWhatsAppAlbumSource` (`albums.ts:113-118`) ثم `greatest()` عند التحديث | `media_group_expected_count` (١١ صفًا) | نعم |
| `sourceMessage` / `messageKey` | Evolution | `mediaItems.map` (`whatsapp-sync.ts:535-552`) | `source_media_payload` | jsonb | لا (خارج المحرّك) |

**نقطتان حاسمتان:**

- `mediaGroupId` **ليس** معرّف Evolution. هو بصمة sha256 يشتقها MenaFlow من `parentMessageId`. لذلك هو مستقر ومتكرر الإنتاج — وهذا جيد — لكنه **ليس** إشارة مستقلة عن الرسالة الأب، وأي تغيير في `parentMessageId` يغيّر الهوية كليًا.
- `media_group_expected_count` يُكتب بـ`greatest(existing,new)` (`whatsapp-sync.ts:714-718`). هذا **يُضخّم** العدد ولا يصحّحه: صفّان مختلفان عن الحقيقة يبقيان على الأكبر. لذا كل قراءة لهذا العمود يجب أن تفترض أنه «حد أعلى معلن»، لا عددًا دقيقًا.

**الحالة الحقيقية للألبومات (١١ مجموعة):** كلها `protocol_association` عدا واحدة `provider_album_container` (`ACE5CCDE`). وفي كل الأحد عشر: **حاوية واحدة بالضبط**، `media_available=false`, `media_rows=0`.

---

## 6. Album Container Investigation

**هل الـ١٣ في `ACFEFACE` تعني ١٣ صورة، أو حاوية + ١٢ صورة، أو غير ذلك؟**

الدليل المتاح **لا يدعم أيًّا من التفسيرين كقاعدة عامة**. الجدول الكامل يبيّن أن العلاقة ليست ثابتة:

| album_id | container? | expected | children | stored | failed | pending | الفرضية |
|---|---|---|---|---|---|---|---|
| `album:5e793280bf47…` (ACFEFACE) | نعم | 13 | 12 | 12 | 0 | 0 | `EXP = CHILDREN + 1` |
| `album:427195ec7792…` | نعم | 8 | 7 | 7 | 0 | 0 | `EXP = CHILDREN + 1` |
| `album:0073aaeffed8…` | نعم | 4 | 4 | 0 | 4 | 0 | `EXP = CHILDREN` |
| `album:0e8f2e76f9e4…` | نعم | 5 | 5 | 5 | 0 | 0 | `EXP = CHILDREN` |
| `album:1a5f72c3283a…` | نعم | 4 | 4 | 4 | 0 | 0 | `EXP = CHILDREN` |
| `album:2157410a77ec…` | نعم | 3 | 3 | 3 | 0 | 0 | `EXP = CHILDREN` |
| `album:2c018b8143ee…` | نعم | 3 | 3 | 3 | 0 | 0 | `EXP = CHILDREN` |
| `album:50ee20428864…` | نعم | 6 | 6 | 6 | 0 | 0 | `EXP = CHILDREN` |
| `album:d8913d62db06…` | نعم | 4 | 4 | 0 | 4 | 0 | `EXP = CHILDREN` |
| `album:106c10e55fe0…` | نعم | 4 | 2 | 0 | 2 | 0 | **MISMATCH** (نقص ولا صور معلّقة) |
| `album:64ed7a888acd…` (ACE5CCDE) | نعم **provider** | 2 | 0 | 0 | 0 | 0 | **MISMATCH** (لم يُحفظ أي ابن) |

**النتيجة الصريحة:**

- **٨/١١: `expected == عدد الصور`** ⇒ الحاوية **غير** محسوبة داخل العدد.
- **٢/١١: `expected == الصور + ١`** ⇒ الحاوية محسوبة (أو صورة واحدة لم تُحفظ).
- **٢/١١: لا يطابق أيًّا منهما.**

⇒ **`effectiveExpectedCount = expected - containerCount` غير صحيح في العموم.** الصيغة الصحيحة الوحيدة المدعومة بالبيانات:

```
الحاوية لا تحمل وسائط  ⇒  children = الرسائل الفعلية
الشرط المقبول = children >= expected - 1   (تفاوت صفري/واحد)
والمتبقي (expected - children) يُسجَّل كـMEDIA_PARTIAL مع قيمته الحقيقية، لا يُطرح
```

**تصحيح مباشر على المرحلة ٢:** المحرّك يطرح الحاويات دائمًا (`whatsapp-bundle-engine.ts`, كتلة `containers`). في `5e793280` أعطى 12/12 وهو صحيح بالمصادفة؛ لكنه في `0073aaeffed8` و`d8913d62` وغيرها (حيث `expected == children`) كان سيطرح ١ فيُخبر أن الألبوم «اكتمل» وهو ناقص، أو يقلّل العدد المعلن. الطرح يجب أن يكون **تفاوتًا مسموحًا**، لا حسابًا.

**الحاوية نفسها:** لا تحمل وسائط ولا نصوصًا، `media_download_status='not_required'`. لذا وجودها في أي حزمة **لا يجوز أن يزيد** `mediaExpected` ولا يعامَل كعضو وسائط.

---

## 7. media_group_index Investigation

**القياس:** `NULL` في **١٢٢/١٢٢**.

**Root Cause — أربع مراحل فُحصت واحدة واحدة:**

| المرحلة | النتيجة | الدليل |
|---|---|---|
| ١. Evolution يرسله؟ | **لا يوجد في أي payload متاح** | ٠/١٠ `messageIndex`؛ الـ`messageAssociation` المحفوظ = `{associationType, parentMessageKey}` فقط |
| ٢. Parser يقرأه؟ | **نعم، صحيح** | `whatsapp-message-scope.ts:119-124` يقرأ `messageAssociation.messageIndex` ويشترط عددًا صحيحًا ≥ ٠ |
| ٣. Persistence يحفظه؟ | نعم لو وُجد | `whatsapp-albums.ts:115` ثم `whatsapp-sync.ts:574` ثم `:718-720` |
| ٤. Association تحويه؟ | **لا** | كائن `WhatsAppAlbumAssociation` فيه `messageIndex` لكن المُنتِج الوحيد (Evolution) لا يملؤه |
| ٥. مشكلة عمود/migration؟ | **لا** | العمود `integer` موجود، وقيد الكتابة سليم |

⇒ **Root Cause: عدم وجود الإشارة في المصدر.** لا خطأ برمجي هنا.

**السبب البنيوي:** الألبوم في Evolution يُعبَّر عنه بـ`messageAssociation.associationType=1` + `parentMessageKey` فقط. لا يوجد `messageIndex` في هذا الشكل. ونتيجة ذلك الحاسمة:

- **`media_index` = ٠ في ٧٧/٧٧ صف وسائط.** أي أن كل صورة في كل ألبوم تحمل الفهرس نفسه.
- وبالتالي **لا يوجد ترتيب صور محفوظ على الإطلاق** — لا على مستوى الألبوم ولا داخل الرسالة.

**التصنيف:** `media_group_index` = **UNAVAILABLE**. وليس `OPTIONAL` بل `UNAVAILABLE` لأن أي منطق يعتمد عليه سيعمل على `null` دائمًا.

---

## 8. Media Ordering

**كيف تُرتَّب الصور فعليًا اليوم؟** ثلاثة مسارات مختلفة، بثلاثة معايير:

| المسار | الترتيب | الملف:السطر |
|---|---|---|
| بناء المسودة/النشر | `messageTimestamp`, ثم `createdAt` | `lib/whatsapp-marketing.ts:301-304, 236` |
| ثم إعادة ترتيب في الذاكرة | `mediaGroupIndex` إن وُجد، وإلا `messageTimestamp` | `whatsapp-marketing.ts:308-315` |
| مصادر المنتج (Vision) | `messageTimestamp`, `createdAt`, `mediaIndex`, `media.createdAt` | `lib/product-source-media.ts:122-127` |
| استخراج المنتج | `messageId`, `mediaIndex` | `whatsapp-product-extraction.ts:996-1001` |

بما أن `mediaGroupIndex` دائمًا `null` و`mediaIndex` دائمًا `0`، فالترتيب الفعلي = **`messageTimestamp` ثم `createdAt`** فقط.

**مثال حقيقي (وهو يثبت أن الترتيب الحالي مقبول لكن غير مضمون):** ألبوم `album:5e793280` (Massage Gun):

| rid | message_timestamp | created_at | media_index |
|---|---|---|---|
| ACFEFACE (حاوية) | 20:51:10.000 | 00:19:41.776 | — |
| AC72932B | 20:51:10.000 | 00:19:42.267 | 0 |
| ACA7D6DA | 20:51:11.000 | 00:19:43.632 | 0 |
| ACA67596 | 20:51:11.000 | 00:19:44.097 | 0 |
| AC0B4EA8 | 20:51:12.000 | 00:19:45.489 | 0 |
| AC4960DE | 20:51:12.000 | 00:19:48.085 | 0 |
| AC192812 | 20:51:12.000 | 00:19:48.532 | 0 |
| AC7B8A53 | 20:51:12.000 | 00:19:50.183 | 0 |

**هل `timestamp ≠ created_at` يمكن أن يُنتج ترتيبًا خاطئًا؟** نعم، والدليل ليس نظريًا:

- في هذا الألبوم نفسه، الصور الأربع الحاملة لـ`20:51:12` دخلت بترتيب `created_at` **مختلف** عن ترتيبها الأصلي المحتمل (AC0B4EA8 ثم AC4960DE ثم AC192812 ثم AC7B8A53)، وكلها `media_index=0`.
- دقة `message_timestamp` **ثانية واحدة**، فكل مجموعة من ٢–٤ صور تتشارك الطابع نفسه ⇒ الترتيب بينها يُحسم بـ`created_at` = **ترتيب وصول الطلبات إلى الخادم**، وهو اعتباطي (فرق ١٦ms بين صفّين في نفس الثانية).
- وعلى مستوى الألبومات: الفارق بين `message_timestamp` و`created_at` يبلغ **٣ أيام** (٢٠:٥١:١٠ لـ٢٦ نوفمبر vs ٠٠:١٩:٤١ لـ٢٧ نوفمبر)، و**١ يوم** لألبوم `AC6C3806`.

⇒ **لا يوجد ترتيب موثوق. الترتيب الحالي «مستقر» (deterministic) لكنه ليس «صحيحًا».** أي منطق يعتمد على أول/آخر صورة (مثل اختيار صورة الغلاف) يجب أن يتعامل مع هذا كقيد معروف.

---

## 9. Timestamp Analysis

الإجابة المطلوبة، واحدة واحدة:

| السؤال | الجواب | الدليل |
|---|---|---|
| هل يمكنه إنشاء Bundle وحده؟ | **لا** | حادثة `AC683CA0` (مكنسة) → `ACD54FE5` (مسدس تسليك) بفارق ثانية واحدة: منتجان مختلفان. ومثله `ACFDCC6E` → `AC67CBA2` بفارق ٠ ثانية. الوقت لا يحمل أي دلالة منتج |
| هل يمكنه كسر التعادل؟ | **نعم** | هو كاسر التعادل الوحيد المتاح فعليًا، لأن `media_group_index` غائب |
| هل يمكنه ترتيب الرسائل؟ | **نعم، بحدوده** | دقّته ثانية واحدة، فلا يفرّق داخل الثانية (البند ٨) |
| هل يحدد حدود نافذة؟ | **نعم، كقيد لا كدليل** | نافذة ٣٠ ثانية تمنع ربطًا بعيدًا، لكنها **لا تُنتج** ربطًا |

**اختبار المبدأ `TIME IS NOT A RELATION SIGNAL`:** يمرّ على البيانات، مع تحفّظ واحد مهم:

- ✅ صحيح: لا وجود لحالة يكون فيها الوقت وحده سببًا مشروعًا للدمج.
- ⚠️ لكن الاختبار كشف أن المحرّك **يستخدم الوقت لإنتاج علاقة بالوكالة**: مجموعة صور متتالية تُجمَّع في عنقود واحد اعتمادًا على `adjacencyMs` وحده، ثم يُطالب العنقود بنص. أي أن **الوقت ينتج الحزمة فعليًا** وإن كان ذلك عبر «عنقود» لا عبر «دمج». هذا هو مصدر الخلل في البند ١٢.

**الخلاصة:** الوقت `OPTIONAL` وبدوره الحالي (حدّ أعلى للجوار + كاسر تعادل) مقبول، **بشرط** ألّا يكون هو الفاصل الوحيد بين منتجين — وهو ليس كذلك حاليًا.

---

## 10. Sender / Group Scope

القياسات:

| الحقل | الواقع |
|---|---|
| `sender_id` | ١٢٠/١٢٢ غير فارغ. القيمتان الفارغتان (`A5F2E70D`, `A5B91936`, مصدرهما `android`) لها `sender_name = "41678413008949"` وهو ليس رقم هاتف — معرّف جهاز داخل المجموعة |
| `from_me` | ٨٦ `true` (التاجر) / ٣٦ `false` — أي أن متجرًا واحدًا يبثّ |
| `sender_name` | متاح (pushName) |
| `participant` | **لا يوجد في أي payload متاح** (٠/١٠)، ولا عمود له |
| `group_jid` / `group_id` | كل الصفوف: مجموعة واحدة، مساحة عمل واحدة، مثيل واحد |
| `workspace_id` | ١ |

**كيف يُحدَّد المُرسِل:** `resolveMessageSenderId` (`lib/whatsapp-marketing-safety.ts:27-36`): `fromMe && businessPhone ⇒ businessPhone`, ثم `participant`, ثم `sender`, وإلا `null`.

**هل يمكن أن يختلط A بـB داخل نفس المجموعة؟** **نعم، نظريًا ومقياسيًا**: `sender_id` واحد فقط (`+967777187184`) لكل الرسائل غير الفارغة، لكن الصفّين الاثنين بـ`sender_id=null` يفتحان ثقبًا: مقارنة `runLast.senderId === message.senderId` تصبح `null === null` ⇒ **تطابق** بين مرسلَين مختلفين مجهولَين. المحرّك يعتمد على هذا الشرط في `whatsapp-bundle-engine.ts:730`. في هذه المساحة لا يوجد ضرر (كل الرسائل من متجر واحد)، لكنه **عيب في التصميم** يظهر في أول مجموعة عملاء حقيقية.

**هل يمكن أن تختلط مساحتا عمل؟** **لا.** `sameScope` (`:222-231`) يشترط تساوي `workspaceId` و`ownerId` و`instanceName` و`groupId` و`groupJid`. هذا الفحص سليم ومُختبَر (`CASE 14`).

**الـscope الصحيح للحزمة:** `(workspaceId, ownerId, instanceName, groupJid, groupId)` — وهو ما يطبّقه المحرّك فعلًا. **إضافة مطلوبة:** `senderId` يجب أن يكون شرطًا **إلزاميًا غير قابل للتجاوز** عند وجوده، وألّا يُعتبر `null == null` تطابقًا.

---

## 11. Additional Signals

إشارات موجودة في الـpayload/الكود ولم تُستخدم في المحرّك، مع تقييم قوتها:

| # | الإشارة | المكان | القوة | ملاحظة |
|---|---|---|---|---|
| ١ | `messageAssociation.associationType = 1` | `messageContextInfo` | **STRONG** | هو الأساس الحالي؛ هو ما يعرّف الألبوم |
| ٢ | `parentMessageKey.id` (+`fromMe` +`remoteJid`) | نفس المصدر | **STRONG** | `remoteJid` هنا يُستخدم كفحص نطاق (`whatsapp-sync.ts:478-483`) — إشارة أمان مهمة |
| ٣ | `messageType` (`albumMessage` / `imageMessage` / `conversation`) | `payload.messageType` | **MEDIUM** | يفصل الحاوية عن الابن، لكنه مُشتق أحيانًا داخل المنصة (`:434-444`) |
| ٤ | `albumMessage.expectedImageCount` / `expectedVideoCount` / `messages[]` | `message-scope.ts:470-481` | **MEDIUM** | غير موجود في عيّناتنا (٠/١٠) لكنه مسار parser صريح |
| ٥ | `fromMe` | `key.fromMe` | **MEDIUM** | يحدد «التاجر» ويكفي وحده لـ`senderRole` |
| ٦ | `sender_name` (pushName) | `payload.pushName` | **WEAK** | للعرض فقط |
| ٧ | `source` (`webhook` vs `android`) | عمود | **MEDIUM** | ٧٦/٤٦: مفيد لتفسير نقص الإشارات — الاستيراد التاريخي يفتقد `reply_to` و`messageIndex` |
| ٨ | `pairedMediaType` | `imageMessage.contextInfo` | **WEAK/UNSAFE** | قيمته ٠ دائمًا؛ لا دلالة ربط مثبتة |
| ٩ | `threadId`, `messageSecret` | `messageContextInfo` | **UNSAFE** | تشفير/خيوط، ليست أدلة منتج |
| ١٠ | `mentionedJid`, `groupMentions`, `statusAttributions` | `imageMessage.contextInfo` | **UNSAFE** | فارغة دائمًا هنا |
| ١١ | `mediaKeyTimestamp` | داخل `imageMessage` | **UNSAFE** | طابع مفتاح التشفير، لا وقت رسالة |
| ١٢ | `caption` (الصورة) | عمود + payload | **MEDIUM** | إشارة نصية موثوقة؛ المحرّك يستخدمها فعليًا (`isClaimableText`) |
| ١٣ | `source_media_payload[].messageKey` | jsonb | **MEDIUM** | يربط الوسائط برسالتها بدقة أعلى من `media_index` |

**لا توجد إشارة «اقتباس» أو «إعادة توجيه» أو «رد» في أي payload متاح.** أي تصميم يعتمد عليها اليوم يعتمد على شيء غير موجود.

---

## 12. Bundle Engine Compatibility

مراجعة `whatsapp-bundle-engine.ts` مقابل ما ثبت:

**أ) ترتيب القواعد:** `ALBUM → REPLY → EXPLICIT → CLUSTER_TEXT → SINGLETON`

- `ALBUM` أولًا: **صحيح**، وهي الإشارة الوحيدة القوية.
- `REPLY` ثانيًا: **ترتيب سليم لكن القاعدة ميتة** — مدخلها `null` في ١٢٢/١٢٢. والأسوأ: القاعدة تعمل فقط إن كان الأب **قد دخل حزمة سابقة** (`:651-654: if (!parentDraft) continue;`). فأي رد على صورة غير مُعنونة لا يلتحق بشيء. مثبت في `CASE 8`: `R` بقي `single`.
- `EXPLICIT`: لا منتج يُنتجه (`explicitProductRef` غير مملوء من أي مصدر) — **قاعدة معطّلة بأمان**، لكن يجب توثيقها كذلك.
- `CLUSTER_TEXT`: **هي مصدر الخطر**.

**ب) هل توجد قاعدة تعتمد على إشارة غير متاحة؟** نعم، اثنتان:
- `REPLY` ← `replyToRemoteId` (٠/١٢٢).
- ضمنيًا، `mediaGroupIndex` مُعلن في نوع الرسالة لكنه غير مستخدم؛ أي استخدام مستقبلي له سيعمل على `null`.

**ج) هل تجمع Product A + Product B في حزمة واحدة؟** **نعم — أُثبت.** ثلاث حالات:

| الحالة | النتيجة المرصودة | السبب |
|---|---|---|
| `CASE 6` (نص+صورة A، ثم نص+صورة B بعد ١٠ ثوانٍ) | `adjacent[TA + IA + IB]` + `single[TB]` — **صورتان لمنتجين في حزمة واحدة** | العنقود يُبنى على `adjacencyMs` **قبل** أن يُنظر إلى النصوص، ثم يأخذ النص الأقرب فقط |
| ٣ منتجات في ٣٠ ثانية | `adjacent[T1 + I1 + I2 + I3]` + `single[T2]` + `single[T3]` — **٣ منتجات في حزمة واحدة** | نفس السبب: حلقة بناء العنقود (`:734-755`) لا تنظر إلى الرسائل النصية بين الصور |
| `CASE 10` (حاوية ألبوم بلا صور + نص لمنتج آخر) | `album[AC + T]` — نص منتج آخر يدخل حزمة ألبوم فارغ | `isClaimableText` يمنع الصور المُعلَّقة، لا النصوص المجاورة |

**د) هل تجمع نصوصًا متعددة؟** لا (`:759+`، نص واحد لكل عنقود) — وهذا سليم.
**هـ) صور مع captions؟** لا تُخطَف (`isClaimableText`, `:229`) — سليم، ومُختبَر (`CASE 4`).
**و) ألبومات متتالية؟** `CASE 5` سليم: حزمتان منفصلتان.
**ز) مرسلون مختلفون / مجموعات مختلفة؟** `CASE 13` و`CASE 14` سليمان — باستثناء ثقب `null == null` في البند ١٠.
**ح) حسابات الألبوم:** كتلة طرح الحاويات **غير صحيحة في العموم** (البند ٦): تعطي 12/12 صحيحًا في `5e793280` بالمصادفة، لكنها تُنقص العدّ في ٨ ألبومات أخرى.

**الخلاصة:** المحرّك **آمن على مستوى المنتج الواحد ومع الألبومات**، و**غير آمن على مستوى تتابع منتجات بلا ألبوم**. وهذا بالضبط النمط الذي أنتجه Legacy في `AC683CA0`/`ACD54FE5`/`ACFDCC6E` — أي أن المحرّك الجديد كان سيكرّر الخطأ نفسه.

---

## 13. Critical Test Cases

شُغِّلت على المحرّك **دون أي تعديل**، عبر سائق معزول يستورد الدالة فقط (`/tmp/p3/cases.mjs`).

| # | الحالة | Expected Bundle | Observed Signals | Engine Decision | Confidence | Risk |
|---|---|---|---|---|---|---|
| 1 | Text → Album | حزمة واحدة | نص + حاوية + صورتان | ✅ `album[AC+T+A1+A2]` READY | عالية | لا |
| 2 | Album → Text | حزمة واحدة | نفسها بترتيب معكوس | ✅ `album[AC+A1+A2+T]` READY | عالية | لا |
| 3 | Text → ٣ صور بلا album | حزمة واحدة | نص + ٣ صور ≤ ٣٠ث | ✅ `adjacent[T+I1+I2+I3]` | متوسطة | لا |
| 4 | Image caption + صور أخرى | صورة التعليق وحدها، والصور الأخرى مع نص إن وُجد | تعليق + صورتان | ⚠️ `single[C1]` + `adjacent[P2+P3] NEEDS_TEXT` | متوسطة | مقبول (under-grouping) |
| 5 | Album A → Album B | حزمتان | ألبومان مختلفان | ✅ حزمتان | عالية | لا |
| 6 | Product A → Product B < ٣٠ث | **حزمتان** | نص A + صورة A + نص B + صورة B | ❌ **`adjacent[TA+IA+IB]` + `single[TB]`** | منخفضة | **حرج: دمج منتجين** |
| 7 | Product A → Product B بعد دقيقتين | حزمتان | الفارق يكسر العنقود | ✅ حزمتان | عالية | لا |
| 8 | Reply to previous product | ردّ ملتحق بالمنتج الأب | `replyToRemoteId` مُعبَّأ صناعيًا | ❌ `single[R]` — القاعدة لا تعمل | منخفضة | **حرج: القاعدة ميتة** |
| 9 | Two competing text candidates | NEEDS_REVIEW بلا اختيار | حزمة بين نصّين | ✅ `album[AC+A1+A2] NEEDS_REVIEW / MULTIPLE_TEXT_CANDIDATES` | عالية | لا (مطلوب) |
| 10 | Album container بلا media | حزمة ألبوم وحدها | حاوية (٠ صور) + نص منتج آخر | ⚠️ `album[AC+T]` — التصق نص لا يخصّه (بعد تعديل نافذة النص انفصلا) | منخفضة | متوسط: التصاق عرض بنص غريب |
| 11 | Pending media | COLLECTING | `pending` | ✅ `COLLECTING / MEDIA_PENDING` مع النص محفوظ | عالية | لا |
| 12 | Failed media | READY مع MEDIA_PARTIAL | ٢ failed | ✅ `READY / MEDIA_PARTIAL` | عالية | لا |
| 13 | Different senders | لا دمج | مرسلان | ✅ لا دمج (لكن `null==null` ثقب) | متوسطة | متوسط |
| 14 | Different groups | لا دمج | مجموعتان | ✅ لا دمج | عالية | لا |
| 15 | Same product متباعد ٢س | صورتان لا تُقرن بلا دليل | صورتان + نص قبل ساعتين | ⚠️ `adjacent[T1+I1]` + `COLLECTING[I2] NEEDS_TEXT` | متوسطة | مقبول |

**إحصاء:** ٨ سليمة، ٤ مقبولة (under-grouping/انتظار)، **٣ بها خلل**: حالتان حرجتان (٦، ٨) وواحدة متوسطة (١٠).

**اختبار السباق (من المرحلة ٢، أُعيد تأكيده):** صورة `pending` + نص متأخر ⇒ الحزمة `COLLECTING` والنص **محفوظ داخلها**. Legacy لا يخسر النص بهذا الشكل (النص يُستورد كرسالة مستقلة ويُقترح)، والخسارة الحقيقية تحدث في طبقة المصادر لا في الاستيراد (البند ٥).

---

## 14. Root Causes

مرتّبة بحسب أثرها، كل واحدة بدليلها وحدود يقينها:

**RC-1 — عنقود الوسائط يُبنى بلا نظر إلى النصوص (خلل في المحرّك الجديد).**
`whatsapp-bundle-engine.ts:734-755`: حلقة بناء العنقود تفحص `isUnlabelledMedia` وتجاوز الجوار فقط. رسالة نصية بين صورتين لا توقف العنقود. النتيجة: حقن منتجين/ثلاثة في عنقود واحد ثم منح النص الأقرب للعنقود كله (`:759+`).
*الدليل:* `CASE 6` → `adjacent[TA+IA+IB]`، وحالة الثلاثة منتجات → `adjacent[T1+I1+I2+I3]`.
*الأثر:* انتهاك المبدأ المعلن «prefer under-grouping» في المحرّك نفسه.

**RC-2 — موضع قراءة `contextInfo` لا يطابق شكل Evolution.**
`whatsapp-sync.ts:472` يقرأ `payload.contextInfo`، و`:588-593` يقرأ `payload.replyTo`. الشكل المحفوظ يضع `contextInfo` تحت `<type>Message` والارتباط تحت `messageContextInfo`. لا يوجد أي كود يفلطحهما.
*الدليل:* ١٠/١٠ عيّنات؛ `stanzaId` مفقود في ٠/١٠ مصفوفة و٠/٣٠٢ حدث ويب هوك.
*الأثر:* `reply_to` = ٠/١٢٢ وقاعدة `REPLY` ميتة. **حدود اليقين:** أن Evolution يرسل `stanzaId` فعلًا = `UNVERIFIED` (لا رسالة رد واحدة في الـcorpus).

**RC-3 — `mena_product_extraction_sources` يكتب معرّفات يعيدها النموذج، لا التي قُرئت.**
`whatsapp-product-extraction.ts:1709-1715` يحفظ الصفوف من `candidate.sourceMessageIds`.
*الدليل:* نص Drain `ACB1DD62` نجح استخراجه وأنتج اقتراحًا بالاسم الصحيح، لكن له ٠ صفوف مصدر؛ وصفوف المصدر ذهبت إلى `AC0232BE` لأن النموذج أعاد معرّف الصورة. ونظيره `AC72828E`.
*الأثر:* **مقارنة المرحلة ٢ مبنية على أساس غير موثوق**؛ ادّعاء «Legacy لا يُدرج نص السعر» غير صحيح.

**RC-4 — الحاوية تُحسب في العدّ أحيانًا ولا تُحسب أحيانًا.**
`resolveWhatsAppAlbumSource` (`whatsapp-albums.ts:113-118`) يأخذ `max(mediaItemCount, advertised)`، و`greatest()` عند التحديث (`whatsapp-sync.ts:714-718`) يرفع ولا يصحّح.
*الدليل:* ٨ ألبومات `EXP=children`، ٢ `EXP=children+1`، ٢ mismatch.
*الأثر:* أي شرط مساواة دقيقة (`expected <= rows`) إما لا يتحقق أبدًا أو يتحقق خطأً. ويشمل ذلك الطرح الذي أضفته في المرحلة ٢.

**RC-5 — لا ترتيب محفوظ للصور.**
`media_group_index` غائب من المصدر (`message-scope.ts:119-124` يقرأه، لكن Evolution لا يرسله) و`media_index` = ٠ في ٧٧/٧٧.
*الأثر:* أي منطق «الصورة الأولى» يعمل على ترتيب وصول الخادم. **غير قابل للإصلاح بالكود وحده** — يحتاج قرار تصميم (البند ١٥).

**RC-6 — ثقب `senderId = null`.**
`resolveMessageSenderId` يعيد `null` بلا بديل (`whatsapp-marketing-safety.ts:35`)، والمحرّك يقارن بالتساوي (`whatsapp-bundle-engine.ts:730`).
*الدليل:* صفّان بـ`sender_id=null` في البيانات الحقيقية (`A5F2E70D`, `A5B91936`).
*الأثر:* `null == null` قد يجمع مرسلَين مختلفين في مجموعة متعددة التجّار.

**RC-7 — تعريف النوع من `group_key` القديم.**
مفاتيح Legacy القديمة بلا بادئة (`0bef4438…`)، والجديدة `bundle:`/`album:`/`message:`.
*الأثر:* أي `split_part(group_key,':',1)` يقرأ الهاش كنوع. أُصلح في `whatsapp-bundle-shadow-cli.ts` أثناء المرحلة ٢، لكن أي كود آخر يفعلها سيخطئ.

---

## 15. Required Changes — NOT IMPLEMENTED

**لم يُنفَّذ أي منها.** كل بند يذكر الموضع والتعديل المقترح فقط، بانتظار موافقة صريحة.

| # | التعديل | الموضع | الأولوية |
|---|---|---|---|
| R-1 | **جعل النص حاجزًا لعنقود الوسائط:** عند بناء run، إذا وُجدت رسالة نصية بين `runLast` والرسالة الحالية ⇒ أغلق العنقود وابدأ غيره. النص لا يُطالب به العنقودان | `whatsapp-bundle-engine.ts:734-755` | **P0** |
| R-2 | **استبدال طرح الحاويات بتفاوت:** `complete = children >= expected - 1`، وتخزين `expected` كما هو مع `mediaPartialSeats = max(0, expected - children)` | `whatsapp-bundle-engine.ts` (كتلة `counts`) | **P0** |
| R-3 | **قراءة `contextInfo` من الموضع الصحيح:** البحث المتداخل عن `stanzaId`/`participant`/`quotedMessage` داخل `message.<type>Message.contextInfo` و`messageContextInfo` بدل الجذر فقط، مع `walkRecords` الموجود | `whatsapp-sync.ts:472, 588-593` | **P0** |
| R-4 | **عدم استخدام `mena_product_extraction_sources` كحقيقة عضوية:** تسجيل `sourceMessageIds` التي **قرأها** المسار في عمود مستقل، أو الاعتماد على `group_key` فقط | `whatsapp-product-extraction.ts:1709-1715` | **P1** |
| R-5 | **حسم ترتيب الصور:** بما أن `media_group_index` غير متاح، إمّا حفظ ترتيب الوصول بشكل صريح (`received_sequence`) أو إسقاط أي منطق يعتمد على أول/آخر صورة | قرار تصميم + `whatsapp-sync.ts` | **P1** |
| R-6 | **إغلاق ثقب `senderId=null`:** `null` لا يُطابق `null`؛ استخدم `sender_name` أو `remoteMessageId` كبديل، أو امنع الدمج | `whatsapp-bundle-engine.ts:730` | **P1** |
| R-7 | **تعديل `greatest()` على `expected`:** استبداله بقيمة موثوقة من المصدر بدل «الأكبر المعلن» | `whatsapp-sync.ts:714-718` | **P2** |
| R-8 | **تسجيل `reply_to` في الاستيراد التاريخي:** تمييز `source='android'` كي تعرف التقارير أن غياب الإشارة متوقع هناك | `whatsapp-sync.ts` (منطق `source`) | **P2** |
| R-9 | **تخزين الـenvelope الخام** (مُقتطعًا) لرسائل العيّنة، لتمكين تحقق مستقبلي من `stanzaId` بلا افتراض | `persistImportedMessage` | **P2** |

---

## 16. Readiness Matrix

| Signal | Status | الدليل |
|---|---|---|
| `remote_message_id` | **VERIFIED** | ١٢٢/١٢٢، فريد داخل `(owner,instance,group)`, مستخدم في كل المعرّفات |
| `sender_id` | **PARTIAL** | ١٢٠/١٢٢؛ صفّان `null` و٤٦ صفًا من الاستيراد التاريخي |
| `participant` | **MISSING** | لا عمود، ولا وجود في ٠/١٠ payload، ولا حاجة له (كل الرسائل من التاجر) |
| `group_jid` | **VERIFIED** | ١٢٢/١٢٢ + `group_id` + فحص نطاق صريح |
| `timestamp` | **VERIFIED (كإشارة مساعدة)** | دقّته ثانية واحدة؛ يصلح كاسر تعادل وحدّ نافذة، لا كدليل ربط |
| `media_id` | **VERIFIED** | ٧٧ صفًا، `id` + `storage_path` + `download_status` موثوقة |
| `media_group_id` | **VERIFIED** | ٦١ صفًا، ١١ مجموعة، ثابت ومُشتق بشكل حتمي |
| `media_group_index` | **MISSING** | ٠/١٢٢؛ غائب من المصدر، والـparser سليم |
| `reply_to` | **MISSING** | ٠/١٢٢؛ وموضع القراءة مغلوط حتى لو وصل |
| `expected_media_count` | **PARTIAL** | موجود في ١١ صفًا لكن دلالته غير ثابتة (٨/١١ مطابقة، ٢ +١، ٢ شاذّة) |
| `album_container` | **VERIFIED** | ١١/١١ حاوية `media_available=false`, `media_rows=0`؛ سلوكها معروف تمامًا |

**قاعدة إضافية مُشتقّة من القياس:** `media_index` = **MISSING** (٠/٧٧) — يجب أن تُضاف إلى المصفوفة لأن الاعتماد عليه شائع في الكود (`product-source-media.ts:124`, `whatsapp-product-extraction.ts:998`).

---

## 17. Final Decision

# READY WITH CONDITIONS

**لماذا ليس BLOCKED:** الإشارة الجوهرية الوحيدة التي يحتاجها قرار التجميع — `media_group_id` مع `associationType=1` — مفهومة بالكامل، مثبتة على ١١ ألبومًا، وسلوك الحاوية معروف (لا وسائط). المحرّك يتعامل معها بشكل صحيح في الحالات ١، ٢، ٥، ٩، ١١، ١٢.

**لماذا ليس READY FOR IMPLEMENTATION:** ثلاثة عيوب مُثبتة بصفوف واختبارات: دمج منتجين في حزمة واحدة (RC-1)، قاعدة رد ميتة بسبب موضع قراءة مغلوط (RC-2)، وأساس مقارنة غير موثوق (RC-3).

**الشروط، بالترتيب الإلزامي:**

1. **R-1** — النص يصبح حاجزًا لعنقود الوسائط. بدونه لا يُسمح بتوصيل المحرّك بأي مسار: هو يكرّر خطأ Legacy الذي بُنيت المرحلة لتصحيحه.
2. **R-2** — إلغاء طرح الحاويات واعتماد `expected - 1` كتفاوت. بدونه كل أحكام «الاكتمال» غير صحيحة في ٨ من ١١ ألبومًا.
3. **R-3** — تصحيح موضع قراءة `contextInfo`. بدونه `reply_to` يبقى صفرًا إلى الأبد، وقاعدة `REPLY` يجب تعطيلها صراحةً لا تركها معلّقة.
4. **R-4** — تسجيل ما قُرئ فعلًا بدل ما أعاده النموذج. بدونه لا مقارنة Legacy/الجديد قابلة للاعتماد.
5. **R-5** — قرار صريح في ترتيب الصور (حفظه أو إسقاط الاعتماد عليه).
6. **R-6** — إغلاق `null == null` في مقارنة المرسل.
7. **R-7, R-8, R-9** — قبل أي قياس إنتاجي موسّع، لا قبله.

**بعد إنجاز ١–٤ يُعاد تشغيل:** ١٥ حالة الاختبار + تقرير الظل، ويجب أن تُظهر: صفر دمج منتجين، و`reply_to` قابل للقياس (لا صفرًا أعمى).

---

## 18. Exact Recommended Next Phase

**المرحلة المقترحة: `Phase 4 — Signal Repair, Read-Only Verification`**

نطاقها، بترتيب الشروط أعلاه، وبلا لمس Legacy:

1. **تنفيذ R-1 وR-2 وR-6 في `whatsapp-bundle-engine.ts` فقط** (ملف معزول، لا يستورده أي مسار إنتاجي) + توسيع `whatsapp-bundle-shadow.test.mjs` بالحالات ٦ و٨ و١٠ ومشتقاتها.
2. **تنفيذ R-3 في `persistImportedMessage`** — وهذه أول لمسة على ملف إنتاجي، ولذلك:
   - تُقتصر على **إضافة** استخراج متداخل لـ`stanzaId`/`participant`، بلا تغيير أي سلوك قائم؛
   - تُقاس نتيجتها بـ`SELECT count(*) FROM mena_whatsapp_messages WHERE reply_to_remote_id IS NOT NULL` **قبل** و**بعد** نافذة مراقبة حقيقية.
3. **تنفيذ R-4** كعمود إضافي (`read_message_ids`) لا كتغيير على `source_key`، مع migration **ملفًا غير منفَّذ** يُقدَّم للمراجعة أولًا.
4. **إعادة تشغيل تقرير الظل** على نافذة زمنية أوسع، بمقارنة مبنية على `group_key` لا على `sources`، وإصدار جدول فرق جديد.
5. **لا توصيل بالمحرّك، لا Gemini، لا كتابة صفوف حزم، لا إيقاف Legacy** — حتى موافقة صريحة منفصلة بعد نتائج البند ٤.

**ما لا تدخل فيه المرحلة القادمة:** أي تغيير على Evolution، أو الـwebhook، أو الـworkers، أو متغيرات البيئة، أو النشر.

---

### ملاحظة أخيرة على المرحلة ٢

هذا التقرير يصحّح ثلاث نتائج سابقة، وأذكرها صراحةً كي لا تُستخدم لاحقًا:

- «Legacy يجمع الصور ويتجاهل نص السعر» → **غير دقيق**: النص استُخرج بنجاح (`candidateCount: 1`)، والخلل في طبقة تسجيل المصادر (RC-3).
- «١٣ = حاوية + ١٢ صورة» → **ليست قاعدة**؛ تصحّ في ألبومين فقط من ١١.
- «المحرّك لا يدمج منتجين» → **غير صحيح**؛ يدمجهما عند تتابعهما داخل ٣٠ ثانية (RC-1).

هذه المرحلة لم تُصلح شيئًا. الملفات الإنتاجية كما هي، والقاعدة بلا أي تغيير.
