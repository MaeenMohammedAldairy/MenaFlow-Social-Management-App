# تقرير فحص مسار واتساب بالكامل — MenaFlow

**التاريخ:** 2026-11-25 (القياسات الحية حتى ~19:30 UTC)  
**الفرع:** `arena/da6815f3-menaflow-social-management-app` (الأساس `5231214`)  
**الهدف:** فحص شامل ودقيق لمسار واتساب من الربط إلى الإرسال والاستقبال والمزامنة والتحويل إلى محتوى ومنتجات، مع حالة تشغيلية حقيقية.

---

## 0. ملخص تنفيذي — الحكم في فقرات

المسار **مكتمل هندسيًا في الكود** بشكل لافت: 26 نقطة HTTP، طبقة Evolution API، ويب هوك موقّع ومُخمّل ضد التكرار، هوية مجموعة داخلية تتعامل مع LID/المجتمعات، مزامنة تاريخ بحدود زمنية ونبض حي، وسائط مخزّنة في Supabase أو محليًا، صندوق وارد مشفّر، طابور ردود آلية بعقد إيجار ومحاولات، استقبال طلبات، واستخراج منتجات بالذكاء الاصطناعي. التغطية بين المسارات الحقيقية وOpenAPI ممتازة (25 من 26؛ الاستثناء هو ويب هوكEvolution نفسه، وهو خارج العقد عن قصد).

لكن **التشغيل الحي مكسور في نقطة واحدة حاسمة**: Evolution يرسل الأحداث إلى جلسة "يتيم" (orphan) لا يعرفها الخادم. في آخر 7 أيام: **409 حدث واتساب، منها 388 `WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE` (95%) رُفضت، و19 فقط عولجت**، وآخر رفض قبل دقائق من كتابة هذا التقرير. النتيجة العملية: **صفر رسائل مباشرة محفوظة، صفر أحداث رد آلي، صفر طلبات واتساب** رغم أن الاتصال الرسمي للمساحة متصل ويعمل. هذا هو السبب الجذري ل"صندوق الوارد فارغ" الآن.

ثمّة فجوة ثانية: **المزامنة التلقائية بالمعنى المجدول غير موجودة** — `autoSyncEnabled` يسمح بحفظ رسائل المجموعات القادمة عبر الويب هوك فقط؛ أما Historical Sync فلا ينطلق إلا بضغط "مزامنة الآن". وثالثة: **عامل إنشاء المحتوى من الرسائل معطّل افتراضيًا** (`WHATSAPP_MARKETING_WORKER_ENABLED=false`)، ولذلك كل وظائف المحتوى الـ46 لا تزال `pending` وصفر منشورات واتساب رغم 46 رسالة و40 اقتراح منتج.

---

## 1. منهجية الفحص ومصادره

| المصدر | ما فُحص | ملاحظة |
|---|---|---|
| الكود (`artifacts/api-server`, `artifacts/menaflow-mobile`, `lib/db`, `lib/api-spec`) | المسارات، الخدمات، العمال، المخطط، الواجهة | فحص ساكن كامل، دون تعديل ملف |
| Supabase (project `qznbujvanjvkfxpehcbq`) | سجل الترحيلات + استعلامات تجميعية **للقراءة فقط** | لا تعديل بيانات، لا أسرار، لا نصوص عملاء |
| Vercel | مشروع `menaflow-social-management-app` | هذا مشروع **واجهة Expo Web**؛ الخادم ليس مستضافًا عليه |
| اختبارات Node المحلية | 78 اختبارًا وحدةً مرتبطة بالمسار | نجحت؛ اختبار واحد لم يُحمّل لغياب `node_modules` |

**لم أختبره فعليًا:** الربط الحقيقي بهاتف، Evolution نفسه، إرسال رسالة فعلية، مفاتيح AI/Evolution، ولا مضيف API (عنوانه غير معلوم في المستودع أو Vercel). لذلك يُفرَّق أدناه بين "مُثبت بالكود" و"مُثبت حيًا".

---

## 2. خريطة المسار الكاملة

```
المستخدم (تطبيق Expo / ويب)
   │  ① ربط الهاتف          POST /social/whatsapp/connect
   │  ② اختيار المجموعات    GET/PUT /social/whatsapp/groups|group-selections
   │  ③ مزامنة السجل        POST /social/whatsapp/sync-now  + GET sync-status
   │  ④ صندوق خاص           GET direct-conversations|direct-messages / reply
   │  ⑤ إعدادات الرد        GET/PUT auto-reply-settings + POST auto-reply-test
   ▼
Express API (/api)  ──►  Evolution API v2 (مثيل لكل مساحة عمل)
   ▲                         │ ③ chat/findMessages (تاريخ)
   │ ② webhook موقّع          │ ④ chat/getBase64FromMediaMessage (وسائط)
   │   POST /social/whatsapp/webhook
   │                         ▼
   └──────── Supabase/Postgres (جلسات، مجموعات، رسائل، وسائط، طوابير)
                              │  عمال داخل عملية API (كل 1–60 ثانية)
                              ├─ media-download / thumbnails
                              ├─ whatsapp-auto-replies → AI → sendText
                              ├─ whatsapp-order-confirmations
                              ├─ product-extraction → اقتراحات منتجات → مراجعة → نشر
                              └─ whatsapp-marketing (معطّل افتراضيًا) → منشورات
```

---

## 3. الرحلة خطوة بخطوة

### 3.1 الربط وفك الربط — `routes/social.ts`

1. **بوابة الاشتراك:** `canConnectChannel(workspaceId, "whatsapp")` قبل أي عملية، ويُعاد فحصها بعد أخذ القفل (`social.ts:179,300`). رفض الخطة يُترجم إلى كود/رسالة عربية موحّدة.
2. **تحقق الرقم:** `[+\s().-]` تُزال، ثم نمط `^\+?[1-9]\d{7,14}$`؛ رقم Evolution يُخزَّن بدون `+`.
3. **قفل** `pg_advisory_lock` بمفتاح `menaflow:whatsapp-pairing:<workspaceId>` يمنع ربطًا متزامنًا لنفس المساحة.
4. **اسم_instance حتمي:** `menaflow-` + أول 12 حرفًا من `sha256(workspaceId)` (`lib/whatsapp-instance.ts`) — هذه هي القاعدة التي تجعل الجلسات اليتيمى قابلة للتشخيص.
5. **الفحص قبل الإنشاء:** إن كانت الحالة `open` → 409 "مربوط بالفعل"؛ إن كانت `404` من Evolution → يُعاد إنشاء المثيل؛ فحص الملكية `isExclusiveWhatsAppInstance` يمنع إعادة استخدام جلسة يملكها مالك آخر.
6. **الإنشاء:** `instance/create` بـ `integration: WHATSAPP-BAILEYS`, `qrcode: true`, `syncFullHistory: true`، ثم `webhook/set` بالأحداث الثلاثة `MESSAGES_UPSERT/UPDATE/DELETE` (`lib/whatsapp-evolution.ts:323`)، ثم `instance/connect?number=...` مع 3 محاولات لالتقاط pairingCode.
7. **تنظيف اليتامى:** `sweepOrphanWhatsAppInstances()` (`lib/whatsapp-orphan-instance-sweep.ts:75`) يُستدعى هنا وفي إعادة تسجيل الويب هوك فقط — انظر المخاطر.
8. **الفشل يتراجع:** حذف المثيل الذي أُنشئ + تعليم الصف `failed`، مع عدم إفشال العملية بسبب فشل التنظيف.
9. **التأكيد:** `GET /connection-status` يسأل Evolution مباشرة، ويُعيد تسجيل الويب هوك عند `open` ويحدّث `connectedAt`. **الفصل** `DELETE /social/whatsapp` يحذف مثيل Evolution ويُطفئ `autoSyncEnabled` و`autoReplyEnabled` معًا؛ `?cancelPairing=true` للتراجع أثناء الربط.

### 3.2 المجموعات والهوية — `routes/whatsapp-groups.ts`, `lib/whatsapp-group-identity*.ts`

- `GET /social/whatsapp/groups` يجلب `group/fetchAllGroups?getParticipants=false` ثم **يُحدّث دليل الهوية داخل معاملة مع قفل استشاري** (`reconcileWhatsAppGroupDirectory:28`). المجتمع وكل مجموعة إعلاناتابنة هويتان منفصلتان؛ `linkedParent` يبني علاقة الأب.
- الجداول: `mena_whatsapp_groups` (هوية داخلية) + `mena_whatsapp_group_jids` (خرائط JID، بما يشمل البديل LID). الرسائل تُخزَّن بـ `group_id` الداخلي مع حفظ `provider_remote_jid` و`provider_remote_jid_alt` كأثر مزوّد.
- اختيار المجموعات (`PUT /social/whatsapp/group-selections`) يتحقق أن كل JID موجود في الدليل وبنوع `announcement`، بحد أقصى 500، ثم يستبدل القائمة داخل معاملة. اختيار "مجتمع" يُوسَّع عند المزامنة إلى أبنائه (`resolveWhatsAppGroupSyncTargets`) وليس إلى JID المجتمع نفسه.
- أي اختيار قديم بلا `group_id` يُوقف المزامنة برسالة 409 واضحة بدل تخمين الهوية.

### 3.3 المزامنة — `routes/whatsapp-sync.ts`, `lib/whatsapp-sync.ts`

- `POST /social/whatsapp/sync-now` (`:62`): `includeHistory` افتراضيًا true، `historyLimit` بين 1 و10000 (افتراضي 500). يفحص مفاتيح المزامنة، يلغي التشغيلات القديمة، يبني الأهداف، يدّعي حالة `running` بـ `UPDATE … RETURNING` ذريًا، ثم يطلق `mapWithConcurrency` بحد افتراضي 3 (قابل للضبط 1–16) و**يرجع 202 فورًا**.
- `syncGroupHistory` (`:1043`): المؤشر = أحدث `message_timestamp` محفوظ (أو `last_cursor`)؛ صفحات `chat/findMessages` بحجم 100. إن تجاهل Evolution فلتر `remoteJid`، ينتقل إلى فحص صفحات محدود (50 صفحة) مع فحص كلا حقلي JID. ميزانية تشغيل 10 دقائق ونبض `updated_at` كل 60 ثانية يمنعان الإلغاء الخاطئ للتشغيل الحي. الحالات: `idle/running/complete/empty/partial/failed/cancelled`.
- `persistImportedMessage` (`:342`): تصفية حسب إعدادات النص/الصور/الفيديو، تحليل الألبوم (ربط بروتوكولي أو حاوية من المزوّد)، إزالة base64 من الحمولة، **upsert** بمفتاح (owner, instance, group, remoteMessageId) لا يُعطب الوسائط المخزّنة، وإنشاء وظائف `mena_content_jobs` و`mena_whatsapp_product_extraction_jobs` في نفس المعاملة.
- `GET /sync-status` و`PUT /sync-settings` يوفّران القيم الأربع: `autoSyncEnabled`, `syncMessagesEnabled`, `syncImagesEnabled`, `syncVideosEnabled`.
- **تنبيه مفاهيمي مهم:** `autoSyncEnabled` لا يُشغّل مجدولًا زمنيًا. البحث عن `syncGroupHistory` لا يُظهر سوى مستدعٍ واحد (سطح `sync-now`)؛ في `processWebhookEvent` يقرر فقط هل تُحفظ رسائل المجموعات القادمة من الويب هوك أم لا.

### 3.4 الويب هوك — `routes/whatsapp-sync.ts:672`, `lib/whatsapp-sync.ts:2062`

الترتيب الدقيق:

1. حدّ معدل 1200/دقيقة على `/api/social/whatsapp/webhook`، جسم JSON بحد 1MB، و413 مُترجَمة إلى `WHATSAPP_WEBHOOK_PAYLOAD_TOO_LARGE`.
2. تحقق ثابت الزمن من `x-evolution-api-key` مقابل `WHATSAPP_EVOLUTION_WEBHOOK_SECRET` (مرة في المسار ومرة في الخدمة)، ويُسجَّل الرفض حتى لو لم يُعرف workspace.
3. إلغاء مكرّرEvents عبر `claimWebhookEvent("evolution", key)`؛ الفشل يُحرِّر القفل عند الخطأ ويُجيب 500.
4. اسم الحدث: `MESSAGES_UPSERT/UPDATE/DELETE` فقط (`MESSAGES_SET` لا يُشترك فيه لحجم حمولته).
5. حلّ `instanceName` إلى صف اتصال **وحيد**؛ 0 → `UNKNOWN_INSTANCE`، >1 → `AMBIGUOUS_INSTANCE`، وكلاهما مُسجَّل في `mena_inbound_webhook_events`.
6. الرسائل المباشرة الواردة/الصادرة تُخزَّن مشفّرة AES-256-GCM (`meta-token-crypto.ts:14`) مع `remoteJidHash` HMAC بمفتاح workspace/instance/JID، ومدة بقاء 90 يومًا.
7. قرار الرد الآلي: كلمة إلغاء في **الرسالة نفسها** (`stop`/`إلغاء`/…) تمنع الرد؛ لا يوجد جدول suppression دائم (انظر المخاطر).
8. رسائل المجموعات تُحفظ فقط إذا `autoSyncEnabled` والمجموعة/أبها مختارة؛ `MESSAGES_DELETE` يُعلّم الحقل `deleted`؛ `MESSAGES_UPDATE` يُحدّث المحتوى.
9. كل قرار يُسجَّل باسم حدث ثابت في `mena_inbound_webhook_events` (الرفض دائمًا، والقبول بمعدل مرة/دقيقة لكل مفتاح؛ البقاء 7 أيام افتراضيًا).

### 3.5 صندوق المحادثات المباشرة — `routes/whatsapp-direct-inbox.ts`

| المسار | الوظيفة |
|---|---|
| `GET /direct-conversations` | أحدث رسالة لكل محادثة من آخر 500 صف، بحد 100 محادثة، مع فتح آمن للصفوف غير القابلة لفك التشفير |
| `GET /direct-messages` | صفّMessages بـ cursor، وربط حالة الرد الآلي بكل رسالة |
| `POST /direct-messages/reply` | رد يدوي: يتطلب `clientRequestId` (16–100 حرف)، JID هاتفي، محادثة واردة حية؛ إدراج `sending` ثم إرسال؛ التعارض = `duplicate` أو 409 إن اختلف المحتوى |
| `POST /direct-messages/:id/confirm-not-sent` | تأكيد أن الإرسال غير المحسوم (`unknown`) لم يصل، قبل السماح بإعادة المحاولة |

الاستراتيجية هنا سليمة: لا إعادة إرسال تلقائية لرسالة نتيجتها غير مؤكدة، تجنّبًا لتكرار الإرسال للعميل.

### 3.6 الرد الآلي واستقبال الطلبات

- `whatsapp-auto-reply-settings` يتطلب اتصالًا `open`، مفتاح AI، و**اختبارًا ناجحًا بنفس الإعدادات** قبل التفعيل (`autoReplyTestedHash`)؛ الاختبار 5 مرات/دقيقة ولا يرسل للعميل.
- العامل يعمل كل ثانية (`app-workers.ts:137`)، يأخذ حدًا 5 أحداث/دورة بـ `FOR UPDATE SKIP LOCKED` وإيجار 60 ثانية، بحد 3 محاولات.
- قبل الإرسال يُعاد فحص التفعيل، وعمر الرسالة (12 ساعة افتراضيًا، حتى 7 أيام)، ووجود رسالة أحدث تنتظر، وحد 12 ردًا/ساعة/محادثة.
- **أولوية الطلب:** `processWhatsAppOrderIntake` يسبق AI؛ يجمع (منتج، كمية، اسم، هاتف، عنوان) في حالة `collecting`، ينشئ مسودة طلب `draft` عبر `createWorkspaceOrder`، ويسمح بالإلغاء، ويعتبر الجلسة قديمة بعد 14 يومًا.
- غير ذلك: AI يبني تعليماته من اللغة/النبرة/التعليمات + آخر 10 أدوار محادثة + منتج موثّق مطابق، مع **تنقيح أرقام الهواتف والأسماء والعناوين** قبل الإرسال للمزوّد. الفشل بسبب الحصة يُبقي الحدث `queued` ويؤجّل `next_run_at`؛ الفشل النهائي يُغلقه برمز سبب ظاهر في الصندوق.

### 3.7 الوسائط — `lib/whatsapp-media-download.ts`

`source_media_payload` يُخزّن أثناء الاستيراد بعد تجريد base64، ثم عامل كل 3 ثوانٍ (10 رسائل/دورة، 3 متوازية) يستدعي `chat/getBase64FromMediaMessage`، يتحقق من الحجم (20MB) وSHA-256 المعلن، يُعيد استخدام ملفات مطابقة داخل المساحة، ويخزّن في Supabase Storage (`whatsapp-media`) أو محليًا. السحب حتى 5 محاولات بتراجع 30ث→15د؛ **لكن رسالة أقدم من 21 يومًا تحصل على محاولة واحدة وتُسجَّل `WHATSAPP_MEDIA_EXPIRED_UPSTREAM`** بدل وعود كاذبة. الخدمة توفّر روابط موقّعة ساعة واحدة (`original` / `thumbnail` / `instagram-jpeg`) وصورًا مصغّرة WebP.

### 3.8 من الرسالة إلى منشور/منتج

- فتح سجل المجموعة يُشغّل `autoAcceptWhatsAppSuggestions` للأزواج غير الغامضة (نص + وسائط) ويُضيف وظيفة محتوى إن لم تكن موجودة.
- `whatsapp-marketing.ts` يبني منشورًا reviewable مع انتظار زمني قصير لتجميع الألبوم، ويمنع النشر من grupo غير مختارة أو محذوفة.
- استخراج المنتجات (`whatsapp-product-extraction.ts`) يمرّ بحالات `received → waiting_media/waiting_association → extraction → persistence`، 3 وظائف/دورة كل 3 ثوانٍ، مع إيقاف مؤقت جماعي عند نفاد حصة AI، وربط الوسائط المتأخرة بالمسودة النهائية دون لمس تعديلات التاجر. الواجهات: `/social/products/whatsapp-extractions` و`create-draft/review/dismiss/restore/reprocess/propose-update`.

---

## 4. قاعدة البيانات والترحيلات

المخطط المطبَّق في Supabase هو **44 ترحيلًا مطابقًا تمامًا** لملفات `supabase/migrations/`، آخرها `20261125002000`. الجداول المحورية:

| الجدول | الغرض |
|---|---|
| `mena_whatsapp_connections` | جلسة واحدة لكل (مالك، مساحة)؛ مفاتيح المزامنة/الرد/المساحة/المثيل |
| `mena_whatsapp_groups`, `mena_whatsapp_group_jids`, `mena_whatsapp_group_selections` | هوية المجموعة ومرادفات JID والاختيار |
| `mena_whatsapp_messages`, `mena_whatsapp_message_media` | الرسائل والمرفقات وحالة التنزيل/Album |
| `mena_whatsapp_sync_states` | مؤشر كل مجموعة وعدّاداتها وحالتها |
| `mena_whatsapp_direct_messages`, `mena_whatsapp_auto_reply_events`, `mena_whatsapp_order_intakes` | الوارد الخاص، طابور الرد، حالة جمع بيانات الطلب |
| `mena_inbound_webhook_events` | سجل قرارات الاستقبال (7 أيام) |
| `mena_content_jobs`, `mena_whatsapp_product_extraction_jobs`, `mena_product_extraction_suggestions` | محتوى ومنتجات ناتجة |

ملاحظة تشغيلية: `ENCRYPTION_KEY` و`ENCRYPTION_KEY_PREVIOUS` ليسا مجرد إعداد راحة — تغييرهما بدون الاحتفاظ بالقديم يكسر فك تشفير محادثات الـ90 يومًا ومفاتيح البحث.

---

## 5. الإعدادات والنشر

- **إلزامي للخادم:** `DATABASE_URL`, Clerk, `ENCRYPTION_KEY`, `WHATSAPP_EVOLUTION_BASE_URL`, `WHATSAPP_EVOLUTION_API_KEY`, `WHATSAPP_EVOLUTION_WEBHOOK_SECRET` (مختلف عن مفتاح الإدارة في الإنتاج), `WHATSAPP_EVOLUTION_WEBHOOK_URL` (HTTPS عام), `SUPABASE_URL/SERVICE_ROLE_KEY` للوسائط، `MENA_PUBLIC_MEDIA_BASE_URL` للنشر على Meta.
- **اختيارية مؤثرة:** `WHATSAPP_SYNC_GROUP_CONCURRENCY` (3)، `WHATSAPP_SYNC_RUN_BUDGET_MS` (600000)، `WHATSAPP_SYNC_HEARTBEAT_MS` (60000)، `WHATSAPP_AUTO_REPLY_MAX_AGE_MINUTES` (720)، `WHATSAPP_AUTO_REPLY_HOURLY_LIMIT` (12)، `WHATSAPP_MARKETING_WORKER_ENABLED` (**false**)، `WHATSAPP_MEDIA_DOWNLOAD_INLINE_WORKER_ENABLED`.
- **Vercel:** المشروع يبني `@workspace/menaflow-mobile` لـ Expo Web فقط، والـ rewrite يعيد كل المسارات إلى `/` (تصرف SPA). **API ليس على Vercel**؛ لا يمكن التحقق من متغيراته أو مضيفه من هذا الحساب. لا تُستنتج سلامة الإعدادات من وجود المشروع على Vercel.
- القيم الحية للاتصال المتصل: `autoSync=true`, `syncMessages=true`, `syncImages=true`, `syncVideos=false`, `autoReply=true`.

---

## 6. الحالة الحية المقاسة (قراءة فقط، 2026-11-25)

| القياس | القيمة | الدلالة |
|---|---|---|
| اتصالات واتساب | 2 (1 `connected`, 1 `disconnected`) | مساحة ثانية/مكررة محفوظة |
| أحداث ويب هوك واتساب / 7 أيام | 409 | 388 `UNKNOWN_INSTANCE` + 19 `PROCESSED` |
| جلسات اليتامى المرفوضة | `menaflow-2227c2a9e5a1` (210)، `menaflow-a898bc54ab23` (178، **آخرها 19:29 اليوم**) | كلها `matches=0`, `workspace_id=null`، أي Evolution ما زال يرسل إليها |
| رسائل مباشرة محفوظة | **0** | متسقة مع رفض أغلب الأحداث |
| أحداث رد آلي | **0** | لا ردود ولا طلبات واتساب حتى الآن |
| رسائل مجموعة محفوظة | 46 (كلها `source=android`) | مزامنة سابقة نجحت عبر المسار الصحيح |
| حالة المزامنة | 1 `complete` | لا يوجد تشغيل جارٍ |
| وظائف المحتوى | 46 `pending` | عامل المحتوى معطّل افتراضيًا |
| منشورات واتساب | **0** (من أصل 3 منشورات) | نفس السبب |
| وسائط | 8 `stored`، 6 `WHATSAPP_MEDIA_EXPIRED_UPSTREAM`، 4 `pending` بخطأ Evolution |بعضها محفوظ وبعضها انتهت صلاحيته لدى WhatsApp |
| استخراج المنتجات | 40 `complete`، 1 `waiting_media`، 1 `waiting_association`، 4 مكتملة بـ `PRODUCT_TEXT_REQUIRED` | 40 اقتراحًا، 4 منتجات، 5 قرارات ارتباط، 0 منشور |
| الترحيلات | 44/44 مطبَّقة | لا انحراف مخطط |

---

## 7. الملاحظات والمخاطر (مرتبة بالأولوية)

### P0 — جلسة اليتيم تحتكر مجرى الأحداث
**الدليل:** 388 رفضًا من 409 خلال 7 أيام، آخرها قبل دقائق، مقابل 19 حدثًا مقبولًا فقط؛ `mena_whatsapp_direct_messages=0`.  
**السبب الجذري:** Evolution يرسل أحداث الهاتف إلى مثيل `menaflow-a898bc54ab23` الذي لا يملكه أي صف اتصال. الويب هوك ممسوح ضد الاسم في `processWebhookEvent:2143` فيُرفض. وظيفة التنظيف موجودة لكنها **لا تعمل تلقائيًا**: لا يوجد عامل يستدعي `sweepOrphanWhatsAppInstances()`؛ الاستدعاء الوحيد داخل `POST /social/whatsapp/connect` و`POST /social/whatsapp/reconfigure-webhook`. أي أن التعافي يتطلب تدخلًا يدويًا (زر "إعادة تسجيل الويب هوك")، ولم يحدث بما يكفي لتنظيف الجلسة النشطة.  
**الأثر:** صندوق الوارد فارغ، لا ردود آلية، لا طلبات، ولا إشعارات للعميل — رغم أن المزامنة والاتصال يبدوان سليمين.

### P0/P1 — لا تنبيه عند رفض جماعي
سجل الرفض يُحفظ ويُعرض على شاشة الردود، لكن لا عامل ولا فحص `/readyz` ولا إشعار يراقب نسبة `UNKNOWN_INSTANCE`. التاجر يكتشف المشكلة فقط عندما يسأل "لماذا لا تصلني الرسائل؟".

### P1 — الخروج من opt-out غير دائم
`isWhatsAppOptOutMessage` يُفحص على الرسالة الحالية فقط، ولا تُخزَّن حالة "هذا العميل طلب التوقف". بعد رسالة `stop`، أي رسالة لاحقة من الرقم نفسه ستحصل على رد آلي جديد. خطر امتثال/تجربة عميل.

### P1 — "المزامنة التلقائية" ليست مجدولة
المزامنة التاريخية تحتاج ضغط زر. الحالة `autoSyncEnabled` تعني فقط "احفظ رسائل المجموعة التي جاءت عبر الويب هوك". لا عامل `whatsapp-history-sync` في `app-workers.ts`.

### P1 — وظائف المحتوى المتوقفة
46 وظيفة `pending` وصفر منشورات واتساب لأن `WHATSAPP_MARKETING_WORKER_ENABLED=false` افتراضيًا. هذا قرار منتج مقصود ("التحويل اليدوي متاح افتراضيًا")، لكنه يعني أن تدفق "رسالة → منشور" لا يعمل تلقائيًا في هذا النشر. يجب توضيح ذلك للمستخدم أو تشغيل العامل إذا كان مطلوبًا.

### P1 — وسائط معلّقة/منتهية
6 عناصر انتهت صلاحيتها فعليًا لدى WhatsApp (>21 يومًا) و4 لا تزال `pending` بعد فشل Evolution. وظيفة استخراج واحدة `waiting_media`. الواجهة تشرح للمستخدم أن الوسائط انتهت، لكن لا توجد إعادة فحص دورية للـ4 المعلّقة غير تكرار العامل.

### P2 — عمل الخلفية داخل_process غير durable
`sync-now` يُطلق `void mapWithConcurrency(...)` ويُجيب 202؛ طوابير الرد/الاستخراج تعتمد على حلقات في عملية API. على مضيف طويل (كما هو مفترض) يعمل ذلك؛ على Vercel/Serverless سيُجمَّد التنفيذ بعد الرد. إعادة التشغيل تُترك حالات `running` حتى يلغيها فحص الـ10 دقائق (نبض الحماية موجود).

### P2 — حدود وحجم
جسم الويب هوك 1MB (مبرر: استبعاد `MESSAGES_SET`)، حتى 500 مجموعة مختارة، 3-16 مجموعة متوازية، 10000 رسالة تاريخ كحد أقصى لكل مجموعة/تشغيل. حدود المعدل في الذاكرة (1200/دقيقة للويب هوك، 300/دقيقة لبقية API لكل مستخدم/IP) لا تُشارك بين عدة replicas.

### P2 — تغيير الإعدادات أثناء التشغيل
`autoReplyTestedHash` يُطلب عند **تفعيل** الردود فقط؛ تغيير اللغة/النبرة/التعليمات أثناء كون الردود مفعّلة لا يُبطل الاختبار ولا يطلب اختبارًا جديدًا في المسار.

---

## 8. ما يعمل بشكل جيد (مُثبت بالكود أو حيًا)

- عزل workspace صارم في كل مسارات واتساب، وفحص آلي `route-guards.test.mjs` يمنع انحرافه.
- فصل مفتاح webhook عن مفتاح Evolution الإدارة، مع رفض الإعداد غير الآمن في الإنتاج.
- هوية مجموعة داخلية تتعامل مع LID/المجتمعات دون تخمين، مع مسار ترحيل مراجَعة لا يُعيد كتابة البيانات القديمة.
- تشفير نصوص/JIDs المحادثات، HMAC للبحث، انتهاء 90 يومًا، وعدم إعادة إرسال رسالة غير مؤكدة.
- حدود صريحة على كل حلقة طويلة: ميزانية زمنية، نبض حي، صفحات قصوى، إعادة محاولة محسوبة.
- سجل تشخيص يُفرّق بين "لم يتصل المزوّد" و"اتصل ورفضناه" و"اتصل ولم ينتج عملًا" — وهو الذي كشف المشكلة الحية.
- 25/26 مسار واتساب موثّقة في OpenAPI (الاستثناء: ويب هوك المزوّد).
- 78 اختبار وحدة مرتبطة نجحت محليًا (16 + 62)؛ تغطية السياسات النقية جيدة. لم أُشغّل اختبارات المسارات المتصلة بقاعدة البيانات لغياب التبعيات المثبّتة في هذه البيئة.

---

## 9. التوصيات بإجراءات محددة

1. **اليوم:** من شاشة الردود اضغط "إعادة تسجيل الويب هوك" للمساحة المتصلة، وتأكد أن رسالة `orphanCleanup` تقول إن `menaflow-a898bc54ab23` حُذف (أو اشرح سبب تخطيه). أرسل رسالة تجريبية وتأكد أن `mena_whatsapp_direct_messages` صار ينمو و`UNKNOWN_INSTANCE` توقف. لا تكتفِ بـ"تم تسجيل الويب هوك" بدون تنظيف الجلسة.
2. **بعدها مباشرة:** أضف عاملًا دوريًا يستدعي وظيفة التنظيف بنفس القواعد الحذرة، مع تنبيه عند ظهور `matches=0` متكرر؛ الهدف ألا يحتاج التاجر لمعرفة الاسم التقني.
3. **قرار منتج:** هل تريد تحويل رسائل المجموعات إلى منشورات تلقائيًا؟ إن نعم → فعّل `WHATSAPP_MARKETING_WORKER_ENABLED=true` وأعد تشغيل API؛ وإن لا → وضّح في الواجهة أن التحويل يدوي.
4. **الامتثال:** حوّل opt-out إلى حالة دائمة لكل محادثة تُفحص قبل كل رد آلي ويدوي، مع تاريخ وسبب.
5. **المزامنة:** إن كان متوقعًا سحب التاريخ تلقائيًا عند الربط، أضف عاملًا مجدولًا محدودًا بدل الاعتماد على الزر؛ إن كان مقصودًا يدويًا، اتركه كما هو لكن وثّقه بوضوح.
6. **المراقبة:** اجعل `/api/readyz` أو لوحة المالك تعرض عدّاد `UNKNOWN_INSTANCE` وآخر رفض، مع تنبيه إذا تجاوز عتبة (مثلاً 20 في ساعة).
7. **الوسائط:** أعد محاولة الـ4 عناصر `pending` بعد التأكد من صحة Evolution، واترك الـ6 المنتهية كحالة نهائية ظاهرة بدل وعود "أعد المحاولة لاحقًا".

---

## 10. ما لم أتحقق منه صراحةً

Evolution API نفسه وقوائم مثيلاته الحية · مفاتيح/أسرار الخادم الفعلية · مضيف API وصحته · إرسال رسالة فعلية إلى هاتف · الاختبارات المتصلة بـ DB (لا تبعيات مثبّتة) · أداء الفهارس تحت حمل · واجهة الويب المنشورة على Vercel (محمية بـ SSO).

---

### ملحق — أهم الملفات

| الملف | المسؤولية |
|---|---|
| `artifacts/api-server/src/routes/social.ts` | الربط/الفصل وحالة الاتصال واختيار المجموعات |
| `artifacts/api-server/src/routes/whatsapp-sync.ts` | مزامنة، إعدادات، إعادة ويب هوك، استقبالEvents |
| `artifacts/api-server/src/lib/whatsapp-sync.ts` | الاستيراد، المؤشرات، الويب هوك، طابور الردود |
| `artifacts/api-server/src/lib/whatsapp-evolution.ts` | كل اتصالات Evolution وتوقيع الويب هوك |
| `artifacts/api-server/src/lib/whatsapp-group-identity*.ts` | هوية المجموعة وتوسيع المجتمع |
| `artifacts/api-server/src/lib/whatsapp-media-download.ts` | تنزيل الوسائط وتخزينها وإعادة المحاولة |
| `artifacts/api-server/src/lib/whatsapp-direct-messages.ts` | تشفير المحادثات وانتهاءها |
| `artifacts/api-server/src/lib/whatsapp-order-intake.ts` | جمع بيانات الطلب وإنشاء المسودة |
| `artifacts/api-server/src/lib/app-workers.ts` | كل العمال وفتراتهم |
| `artifacts/menaflow-mobile/components/sources/*` و`app/whatsapp-setup.tsx` | الواجهة: الربط، المجموعات، المزامنة، التشخيص |
| `docs/INBOUND_DELIVERY_DIAGNOSTICS.md`, `docs/WHATSAPP_SYNC.md` | الوثائق المرجعية (تم التحقق من توافقها مع الكود) |
