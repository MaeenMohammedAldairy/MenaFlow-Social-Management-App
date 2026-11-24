# MenaFlow — تقرير التدقيق الشامل للمشروع (تقني + وظيفي)

**تاريخ التدقيق:** 2026-11-23
**خط الأساس:** الفرع `arena/7bb8c46d-menaflow-social-management-app` @ `95d90ff` (محتواه مطابق لـ`main` بعد دمج PR #75 في `38eb87f`)، وشجرة العمل نظيفة.
**النطاق:** كل مكوّنات المنتج — الجوال/الويب، خادم API، قاعدة البيانات، المصادقة، مساحات العمل والصلاحيات، التكاملات، الأتمتة، الردود الآلية، المنشورات، المنتجات، الطلبات، التوصيل، الاشتراكات، لوحة تحكم المالك، ومعالجة الأخطاء.
**الطريقة:** مراجعة ساكنة للكود + تشغيل مجموعة الاختبارات + فحوص الأنواع + بناء الحزم + استعلامات **للقراءة فقط** على قاعدة Supabase الحية + قراءة إعدادات النشر من Vercel API.
**القيود التي التُزمت:** لم يُعدَّل أي ملف من ملفات المشروع، ولم تُنشأ أو تُحذف أي جداول، ولم تُغيَّر أي إعدادات إنتاج. الملفان الجديدان (`docs/audit/PROJECT_AUDIT_REPORT.md` و`docs/audit/AUDIT_SUMMARY.md`) هما المخرَج الوحيد. وجود الكود لم يُعتبَر دليلًا على عمل الوظيفة.

> **ملاحظة على التقارير السابقة:** هذا التقرير لا يلغي `docs/PROJECT_AUDIT_REPORT.md` (2026-11-08) ولا `MenaFlow_Full_Technical_Audit.md` (2026-10-18، في الجذر) ولا `docs/audit/menaflow-recommendations-2026-11-22.md`؛ فهو يعيد القياس على خط أساس أحدث ويسجّل ما تغيّر. ثلاثة نتائج من تدقيق 2026-10-18 تحقّقتُ من إصلاحها: **المفتاح القديم الثابت** في فك تشفير رموز Meta صار `ENCRYPTION_KEY_PREVIOUS` من البيئة فقط، و**مسار `quick-connect` الوهمي** حُذف، و**صلاحية `instagram_content_publish`** صارت ضمن نطاقات OAuth المطلوبة.

---

## 1. الملخص التنفيذي

MenaFlow مستودع pnpm أحادي فيه **4 تطبيقات** (`api-server`، `menaflow-mobile`، `owner-console`، `mockup-sandbox`) و**4 حزم مشتركة** (`api-spec`، `api-zod`، `api-client-react`، `db`). المنتج أوسع من «إدارة منشورات»: ربط Meta ونشرها، صندوق وارد Meta وردوده الآلية، مزامنة WhatsApp عبر Evolution API مع استخراج منتجات وردود آلية واستقبال طلبات، كتالوج منتجات ومخزون، طلبات وتوصيل، اشتراكات وحدود استخدام، إشعارات دفع، لوحة مالك، وعاملان جديدان (النشر المجدول وحذف مساحة العمل مع تصدير البيانات).

**الخلاصة بأرقام مقاسة لا بانطباع:**

| المقياس | القيمة | الدليل |
|---|---|---|
| اختبارات المجموعة | **528 ناجحة / 0 فاشلة** | `pnpm test` على خط الأساس |
| ملفات الاختبار | 78 (‏57 في `api-server/src/lib`، 13 في الجوال، **1 فقط في `api-server/src/routes`**) | `find … -name "*.test.mjs"` |
| اختبارات على مستوى HTTP | **2** (`plans.test.mjs`، `workspace-middleware.test.mjs`) من **85 مسارًا** | قراءة الملفين |
| مسارات الخادم | **85 مسارًا** في 44 ملف مسارات | استخراج آلي |
| تغطية العقد OpenAPI | **29 مسارًا / 35 عملية = 34%**؛ ‏**56 مسارًا (66%) خارج العقد**؛ وصفر مسارات في العقد غير منفَّذة | مقارنة آلية بالمسارات |
| وحدات الخادم | 54 وحدة لها اختبار **بملف مقابل بالاسم نفسه**، و82 بلا ملف مقابل (منها 43 ملف مسارات). *تحفّظ: المقارنة بالاسم، فبعض الوحدات مغطاة داخل ملف اختبار باسم مختلف — مثلًا `workspace-record-access.ts` مُختبَرة داخل `workspace-tenant-access.test.mjs`* | مقارنة آلية |
| جداول القاعدة | **42 جدولًا** في المخطط = 42 حيّة، ‏**RLS مفعَّل على 42/42**، ‏**صفر سياسات RLS**، والصلاحيات لـ`postgres` و`service_role` فقط | `pg_class` + `pg_policies` + `role_table_grants` |
| الترحيلات | **40 ملفًا في المستودع = 40 مطبَّقة حيّة** | `supabase/migrations` + ‏Supabase `list_migrations` |
| العمال الخلفيون | **15 عاملًا** مسجّلًا، لكلٍّ مفتاح تعطيل | `src/lib/app-workers.ts` |
| الواجهات | 36 مسار شاشة + 47 مكوّنًا في الجوال؛ 4 صفحات في لوحة المالك | `find` |
| النشر | ويب الجوال منشور على Vercel production ‏(READY/PROMOTED)؛ ‏**الخادم ليس على Vercel** | Vercel `list_projects` |
| بيانات حية | مساحتا عمل، اشتراكان (`trialing`)، صف استخدام واحد، ربط WhatsApp واحد، ‏**صفر** منشورات/منتجات/طلبات/رسائل/عناصر صندوق وارد/رموز دفع | استعلامات قراءة فقط |

**الحكم العام:** الأساس الهندسي سليم وقابل للبناء عليه (بوابات CI حقيقية، عزل مستأجرين مُختبَر، تشفير رموز، توقيع ويبهوك، عمال بمفاتيح تعطيل، عقد مولّد). لكن المنتج **لا يملك دليلًا واحدًا على عمل أي تكامل خارجي حيًّا**، و**لا يملك دورة إيرادات**، و**طبقة الاختبار أرقّ من طبقة المنتج بكثير** (‏66% من الواجهة HTTP خارج العقد، و43 من 44 ملف مسارات بلا اختبار). لذلك فإن أكثر الوظائف تصنيفًا هنا هو `PARTIALLY_COMPLETED` و`UNVERIFIED`، لا `COMPLETED`.

**توزيع الحالات (63 وظيفة):**

| الحالة | العدد |
|---|---|
| COMPLETED | 10 |
| PARTIALLY_COMPLETED | 39 |
| BROKEN | 0 (اثنان كانا معطّلين فعلًا وأُصلحا اليوم في PR #74/#75) |
| MISSING | 6 |
| UNVERIFIED | 8 |

---

## 2. منهجية التصنيف

| الحالة | المعنى المُلتزَم به في هذا التقرير |
|---|---|
| **COMPLETED** | منفَّذ بالكامل **و** عليه دليل اختبار آلي ناجح على خط الأساس (أو دليل نشر/قاعدة حيّة)، ولا فجوة معروفة تمنع استعماله |
| **PARTIALLY_COMPLETED** | منفَّذ ويعمل منطقيًا، لكن ينقصه جزء وظيفي، أو تغطيته الاختبارية جزئية، أو أطرافه غير مكتملة |
| **BROKEN** | موجود لكنه معطّل فعليًا (خطأ، 404، مسار ميت، تعارض) بدليل |
| **MISSING** | غير موجود في الكود |
| **UNVERIFIED** | الكود موجود ومكتمل ظاهريًا، لكن **تعذّر إثبات عمله** — عادةً لغياب مفاتيح API أو بيانات حية أو بيئة نشر |

**قاعدة الالتزام:** أي وظيفة تعتمد على Meta أو Evolution أو مزوّد ذكاء اصطناعي أو Expo Push أو مزوّد دفع صُنِّفت `UNVERIFIED` ما لم يوجد اختبار آلي يثبت المنطق **و**دليل حيّ على التنفيذ؛ لأن `.env` غير موجود في مساحة العمل (مستثنى في `.gitignore`) ولا مفاتيح حقيقية متاحة، والقاعدة الحية لم تعالج أي بيانات فعلية (صفر رسائل/منشورات/طلبات).

---

## 3. بيئة التحقق وحدودها (لماذا كثرت UNVERIFIED)

1. **لا `.env` في مساحة العمل** — المفاتيح المطلوبة موثَّقة في `.env.example` (‏46 متغيرًا): ‏`FACEBOOK_APP_ID/SECRET`، `WHATSAPP_EVOLUTION_BASE_URL/API_KEY/WEBHOOK_SECRET`، `GEMINI_API_KEY`/`OPENAI_API_KEY`، `EXPO_PUSH_ACCESS_TOKEN`، `CLERK_*`، `ENCRYPTION_KEY(_PREVIOUS)`، `MENA_OWNER_CONSOLE_TOKEN`، `MENA_CORS_ORIGINS`، ومفاتيح العمال.
2. **قاعدة Supabase الحية** (`qznbujvanjvkfxpehcbq`، ‏ap-south-1، ‏PG 17) مشروع تطوير أُنشئ في هذه الجلسات: 40 ترحيلًا مطبَّقة، لكن **بلا حركة بيانات** — صفر منشورات/منتجات/طلبات/رسائل WhatsApp/عناصر صندوق وارد Meta/رموز دفع. فهي تثبت **المخطط** لا **السلوك**.
3. **Vercel** يستضيف **بناء ويب الجوال فقط** (`expo export --platform web` → `artifacts/menaflow-mobile/web-build`)، وإنتاجه READY/PROMOTED على `menaflow-social-management-app.vercel.app` مبنيًّا من `main` بعد PR #75. متغيرات بيئته: `EXPO_PUBLIC_DOMAIN`، `EXPO_PUBLIC_AUTH_DISABLED`، `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`، `CLERK_PUBLISHABLE_KEY` (للمعاينة) + متغيرات حقنها تكامل Supabase. ‏**لا متغيرات خادم API عليه** — أي أن الخادم يُفترض أن يعمل على مضيف آخر (الوثائق تشير إلى Render) ولم يمكن التحقق من وجوده أو صحته من هنا.
4. **حماية Vercel SSO** مفعّلة لكل النشرات ما عدا النطاقات المخصصة (`all_except_custom_domains`) — يعيق الفحص الخارجي للمعاينات.
5. **لا مراقبة/قياس** (لا `metrics`، لا tracing، لا uptime) — فلا يمكن الاستدلال على صحة العمال في الإنتاج من أي لوحة.
6. **لم يُشغَّل الخادم حيًّا** في هذا التدقيق (لا مفاتيح، ولا قاعدة بيانات محلية، والقيود تمنع تعديل إعدادات الإنتاج)؛ لذلك كل ما يتعلق باستجابة HTTP حقيقية خارج الاختبارين الموجودين هو `UNVERIFIED`.

---

## 4. خريطة المعمارية (مقاسة)

```
الجوال/الويب (Expo Router, 36 مسارًا, 47 مكوّنًا)
  ├─ عميل مولّد من العقد: lib/api-client-react (35 عملية) + lib/api-zod
  └─ عملاء يدويون: lib/{orders-api, product-catalog-api, meta-inbox-api, whatsapp-*}.ts (36 مسارًا)
        │  HTTP
        ▼
خادم Express (artifacts/api-server, 44 ملف مسارات, 85 مسارًا)
  ├─ helmet · pino-http · CORS بقائمة سماح · 5 محدِّدات معدّل · توقيع ويبهوك Meta
  ├─ Clerk (مصادقة) + وضع تطوير بلا مصادقة محكوم بـ11 اختبارًا
  ├─ requireWorkspace / workspace-context / workspace-record-access (عزل المستأجرين)
  ├─ 15 عامل خلفية (app-workers.ts) بحلقة مشتركة (background-worker-loop.ts)
  └─ لوحة المالك: SPA تُبنى بـVite وتُقدَّم من الخادم على /owner + 6 مسارات قراءة
        │  Drizzle
        ▼
PostgreSQL/Supabase (42 جدولًا, RLS مفعَّل, صفر سياسات, صلاحيات postgres/service_role فقط)
  └─ تخزين الوسائط: Supabase Storage عبر REST + بديل ملفات محلي
```

---

## 5. سجل الوظائف التفصيلي

### A. الواجهات والمنصات

#### A1 · تطبيق الجوال (Expo/React Native) — البنية والتنقل — PARTIALLY_COMPLETED
- **الوصف:** التطبيق الأساسي: مصادقة Clerk، إعداد موجز من 4 خطوات، لوحة تحكم بقائمة «خطوات البدء»، تبويبات (رئيسية/منتجات/منشورات/محادثات/المزيد)، إنشاء محتوى، كتالوج، طلبات، تقارير، إعدادات، ربط حسابات.
- **الملفات:** `artifacts/menaflow-mobile/app/**` (36 مسارًا)، `components/**` (47)، `lib/**` (13 ملف اختبار)، `app/_layout.tsx` (الحارس + المزوّدات).
- **الخدمات:** Clerk، ‏API server، ‏Expo Push.
- **الحالة:** FE منفَّذ · BE يعتمد على A/B · DB غير مباشرة.
- **الاختبار:** `tsc -p tsconfig.json --noEmit` نظيف؛ `expo export` (web/android) ناجح؛ 13 ملف اختبار للمنطق النقي (الحارس، التنبيهات، التشخيص، التدفق).
- **الأدلة:** CI `verify` أخضر على PR #75؛ ‏528/528.
- **الأخطاء/الفجوات:** لا اختبارات مكوّنات (لا Jest/RTL)، لا E2E، لا بناء EAS مُثبت؛ المنطق الحيوي للشاشات (47 مكوّنًا) غير مُختبَر.
- **يلزم للإكمال:** طبقة اختبار مكوّنات + ‏E2E لأهم 5 رحلات، وEAS build مُوثَّق.

#### A2 · بناء الويب ونشره على Vercel — PARTIALLY_COMPLETED
- **الوصف:** تصدير Expo web ونشره إنتاجًا.
- **الملفات/الخدمات:** `vercel.json`، Vercel project `menaflow-social-management-app`.
- **الحالة:** FE منشور · BE غير مستضاف على Vercel · DB لا علاقة لها.
- **الاختبار:** `expo export --platform web` أخضر في CI؛ النشرة الإنتاجية `READY/PROMOTED`.
- **الأدلة:** Vercel API: ‏`buildCommand = pnpm --filter @workspace/menaflow-mobile exec expo export --platform web --output-dir web-build`، `outputDirectory = artifacts/menaflow-mobile/web-build`، ‏Node 26.x، aliases ‏`menaflow-social-management-app.vercel.app`، آخر نشرة مبنية من دمج PR #75.
- **الأخطاء/الفجوات:** **لا دليل على أن الويب المنشور يصل إلى خادم API فعلي** (`EXPO_PUBLIC_DOMAIN` مضبوط لكن قيمته سرّية ولم يُختبر الاتصال)؛ `vercel.json` يعيد كل مسار إلى `/` (مناسب لـSPA لكنه يبتلع أي مسار API لو استُضيف الخادم هنا — قرار §3.1 غير محسوم).
- **يلزم للإكمال:** فحص حيّ للويب المنشور ضد مضيف API، وحسم `vercel.json` (توثيق أو حذف).

#### A3 · لوحة تحكم المالك (owner-console) — PARTIALLY_COMPLETED
- **الوصف:** SPA داخلي للقراءة: نظرة عامة، مساحات العمل، الردود الآلية، العمال.
- **الملفات:** `artifacts/owner-console/src/{App.tsx,pages/{Overview,Workspaces,AutoReplies,Workers}.tsx,components/ui.tsx,lib}`؛ يُقدَّم من الخادم (`src/app.ts:186-230`) على `/owner`.
- **الخدمات:** `MENA_OWNER_CONSOLE_TOKEN`، ‏`MENA_OWNER_CONSOLE_DIST`.
- **الحالة:** FE منفَّذ (4 صفحات) · BE منفَّذ (6 مسارات قراءة) · DB قراءة فقط.
- **الاختبار:** `owner-access.test.mjs` = **11 اختبارًا** (منها «إعداد الإنتاج يرفض تجاوز المصادقة المحلية» و«يتطلب مفتاحي Clerk»)؛ البناء ينجح ضمن بناء api-server.
- **الأدلة:** `routes/owner.ts:112,127,284,452,474,583`؛ ‏`app.ts` يضبط `X-Robots-Tag: noindex` و`Cache-Control: no-store` ومحدِّد معدّل خاص.
- **الأخطاء/الفجوات:** لا صفحات اختبارات للـSPA نفسه؛ لا إجراءات إدارية (انظر M2)؛ لا دليل تشغيل حيّ (يتطلب توكن + مضيفًا).
- **يلزم للإكمال:** اختبار حيّ موثَّق + ‏E2E خفيف للصفحات الأربع.

#### A4 · `mockup-sandbox` — UNVERIFIED
- **الوصف:** تطبيق تجارب تصميم منفصل.
- **الأدلة:** موجود في `artifacts/` ولا يُبنى في CI ولا يُنشر ولا يُستورد من المنتج.
- **يلزم:** توثيق دوره أو إخراجه من `artifacts/` حتى لا يُحسب منتجًا.

#### A5 · الهوية/RTL/الوصولية — PARTIALLY_COMPLETED
- **الوصف:** توكنز ألوان موحّدة، مقياس طباعة، تباين المعطَّل، أهداف لمس 44px، خطوط Cairo، ‏RTL، تسميات وصولية.
- **الملفات:** `hooks/useColors.ts`، `components/CairoTypography.tsx`، `components/Ui.tsx`، ‏`app/(tabs)/_layout.tsx` (يضبط `dir=rtl` على قائمة التبويبات في الويب).
- **الاختبار:** typecheck + lint؛ ‏`web-style-safety.test.mjs` (حارس من انهيار Safari على مصفوفات الأنماط).
- **الأدلة:** commit ‏`d3c7c5b` «Unify mobile color tokens, typography scale, disabled contrast, and 44px touch targets».
- **الأخطاء/الفجوات:** لا اختبارات وصولية آلية، لا اختبار بصري/لقطات، والتوحيد حديث ولم يُقَس على أجهزة حقيقية.
- **يلزم:** فحص وصولية آلي (axe للويب) + مراجعة أجهزة حقيقية.

---

### B. الخادم الخلفي

#### B1 · طبقة المسارات HTTP — PARTIALLY_COMPLETED
- **الوصف:** 85 مسارًا في 44 ملفًا تغطي المنشورات والمنتجات والطلبات والردود والصناديق والاشتراكات والمالك والصحة.
- **الاختبار:** 411 كتلة اختبار في `api-server`، لكنها **57 ملفًا في `src/lib`** مقابل **ملف واحد في `src/routes`**.
- **الأدلة:** استخراج آلي: ‏85 مسارًا؛ توزيع ملفات الاختبار.
- **الأخطاء/الفجوات:** 43 من 44 ملف مسارات بلا اختبار على مستواها؛ لا معالج 404 بصيغة JSON لمسارات `/api` المجهولة (الـ404 الوحيد في `app.ts:209` يخص أصول لوحة المالك).
- **يلزم:** اختبارات HTTP لكل مجموعة مسارات (supertest/`app.listen` كما في `plans.test.mjs`) + معالج 404 موحَّد.

#### B2 · العقد OpenAPI وتوليد العملاء — PARTIALLY_COMPLETED
- **الوصف:** `lib/api-spec/openapi.yaml` → orval → ‏`lib/api-client-react` (React Query) + ‏`lib/api-zod`.
- **الاختبار:** بوابة «انحراف العقد» في CI (توليد ثم `git diff --exit-code`) — خضراء.
- **الأدلة:** العقد يحوي **29 مسارًا / 35 عملية**؛ الخادم يخدم **85** → **التغطية 34%**؛ ‏**56 مسارًا خارج العقد** (منها `/social/orders` و`/social/orders/{id}/status` و`/social/orders/{id}/delivery` وكل `/social/products/*` و`/social/whatsapp/*` و`/social/meta-inbox*` و`/overview` و`/session` و`/workers` و`/auto-replies` و`/plans`)؛ وصفر مسارات في العقد غير منفَّذة.
- **الأخطاء/الفجوات:** الجوال يستدعي تلك المسارات بعملاء **يدويين** (`lib/orders-api.ts`، `lib/product-catalog-api.ts`، `lib/meta-inbox-api.ts`…) — تحقّقتُ أن **36 مسارًا يدويًا كلها موجودة في الخادم** (لا نهاية مكسورة)، لكنها **بلا تحقق zod من العقد وبلا حماية بوابة الانحراف**، فأي تغيير في استجابة الخادم لا يكسر شيئًا في CI.
- **يلزم:** إدخال المسارات الـ56 في العقد (أو توثيق استثناءات مقصودة) ثم حذف العملاء اليدويين تدريجيًا.

#### B3 · وسطاء العزل ومساحة العمل — COMPLETED
- **الوصف:** `requireWorkspace` يستنتج مساحة العمل من المستخدم، ويرفض ما لا يملكه.
- **الملفات:** `src/lib/{workspace-middleware,workspace-context,workspace-record-access,workspace-resolution}.ts`.
- **الاختبار:** `workspace-middleware.test.mjs` (‏**اختبارا HTTP حقيقيان** على خادم مُدار، منها وصول لمساحة أجنبية)، `workspace-tenant-access.test.mjs` (3: رفض معرّف منشور من مساحة أخرى، وفشل مغلق بلا سياق)، `workspace-context.test.mjs` (5).
- **الأدلة:** القاعدة الحية تحمل مساحتَي عمل بمالكين مختلفين.
- **الأخطاء/الفجوات:** الوسيط مُختبَر، لكن **استعماله في كل مسار من الـ85 غير مُختبَر** (انظر E4).

#### B4 · معالجة الأخطاء والتسجيل — COMPLETED
- **الوصف:** معالج أخطاء مركزي، أكواد أخطاء، `requestId`، سجلات pino، ‏helmet، وحالة 413 خاصة بويبهوك WhatsApp.
- **الملفات:** `src/app.ts:236-273`، `src/lib/{logger,error-codes}.ts`.
- **الاختبار:** `error-codes.test.mjs`، `logger.test.mjs`.
- **الأدلة:** الاستجابة الموحّدة `{error: "حدث خطأ غير متوقع…", code: "INTERNAL_SERVER_ERROR", requestId}`؛ تسجيل `err/requestId/method/path`.
- **الأخطاء/الفجوات:** لا 404 JSON (B1)؛ لا ربط `requestId` بسجلات العميل.

#### B5 · حدود المعدل — PARTIALLY_COMPLETED
- **الوصف:** 5 محدِّدات: وكيل Clerk، ويبهوك Evolution، لوحة المالك، ‏`/api`، و`/ai/content`؛ المفتاح `user:{id}` وإلا IP.
- **الملفات:** `src/app.ts:28-108,166-168`.
- **الأدلة:** `express-rate-limit` + `ipKeyGenerator`.
- **الأخطاء/الفجوات:** **المخزن في الذاكرة** (لا Redis) فلا يعمل عبر عدة نسخ؛ ‏**`trust proxy` غير مضبوط** فـ`req.ip` هو عنوان الوسيط خلف Render/Vercel → كل المسارات غير المصادَقة قد تتشارك حدًّا واحدًا (أو تُحسب كلها كعميل واحد).
- **يلزم:** قرار `trust proxy` (§3.1/§5.7) + مخزن مشترك إن تعددت النسخ.

#### B6 · الصحة والجهوزية — PARTIALLY_COMPLETED
- **الوصف:** `/api/healthz` و`/api/readyz`.
- **الملفات:** `src/routes/health.ts`؛ العملية `healthCheck` في العقد.
- **الأخطاء/الفجوات:** لا اختبار؛ لا دليل على مراقبة خارجية تستهلكهما (لا uptime).
- **يلزم:** اختبار + ربط بمراقبة خارجية.

---

### C. قاعدة البيانات

#### C1 · المخطط والترحيلات — COMPLETED
- **الأدلة:** 42 تعريف `pgTable` في `lib/db/src/schema/*` = **42 جدولًا حيًّا**؛ ‏**40 ملف ترحيل = 40 مطبَّقة حيّة** (آخرها `20261123202411_workspace_country`)؛ لقطات drizzle ‏`0001…0005`.
- **الاختبار:** بوابة «انحراف المخطط» في CI (توليد ثم `git diff --exit-code` على `lib/db/schema-snapshot`) — خضراء؛ `drizzle-kit generate` نظيف محليًا («No schema changes»).

#### C2 · ‏RLS والصلاحيات — PARTIALLY_COMPLETED
- **الأدلة (حية):** ‏`RLS = ON` على **42/42** جدولًا؛ ‏**`pg_policies` = 0 سياسة**؛ الصلاحيات ممنوحة لـ`postgres` و`service_role` **فقط** — لا `anon` ولا `authenticated`.
- **التفسير:** لا وصول مباشر من العميل إلى القاعدة (وهذا صحيح ومقصود)، والخادم يتجاوز RLS بصفته مالك الجداول → **العزل الفعلي يعتمد على طبقة التطبيق وحدها** (B3/E4).
- **الأخطاء/الفجوات:** ‏RLS بلا سياسات = ‏«مفعَّل اسميًا»؛ لا طبقة دفاع ثانية إن سُهو `requireWorkspace` في أي مسار من الـ85 (ولا اختبار يمسح ذلك آليًا).
- **يلزم:** إما سياسات RLS حقيقية بمفتاح جلسة لكل طلب، أو حارس آلي في CI يفرض أن كل مسار كتابة يمرّ بـ`requireWorkspace` (الأرخص والأسرع).

#### C3 · بوابات CI — COMPLETED
- **الأدلة:** 7 بوابات: lint → انحراف المخطط → انحراف العقد → test → typecheck → بناء api-server → ‏expo export؛ نُفِّذت محليًا (كلها خضراء) وعلى PR #75.

#### C4 · تخزين الوسائط — PARTIALLY_COMPLETED
- **الوصف:** Supabase Storage عبر REST (`{baseUrl}/storage/v1/object/{bucket}/{path}`) مع **بديل ملفات محلي** (`storage/whatsapp`)، ورابط عام عبر `MENA_PUBLIC_MEDIA_BASE_URL`.
- **الملفات:** `src/lib/{whatsapp-media-storage,product-media-storage,whatsapp-media-download}.ts`.
- **الأخطاء/الفجوات:** `sharp(..., { limitInputPixels: 100_000_000 })` في موضعين — سقف 100 مليون بكسل مرتفع (خطر قنبلة فك ضغط)؛ لا دليل حيّ على كائنات مخزّنة (صفر وسائط في القاعدة).
- **يلزم:** خفض السقف + اختبار حيّ على دلو التخزين.

#### C5 · البيانات الحية/البذور — UNVERIFIED
- **الأدلة:** مساحتا عمل، عضوان (‏**صفر أعضاء غير مالك**)، اشتراكان `trialing`، صف استخدام واحد، حالتا إعداد `3:true:false` و`3:true:true`، ربط WhatsApp واحد، ‏**صفر**: منشورات، منتجات، طلبات، مهام محتوى، صندوق إشعارات، رسائل WhatsApp، عناصر صندوق Meta، طلبات حذف، رموز دفع.
- **المعنى:** البيئة تثبت المخطط ولا تثبت أي سلوك تشغيلي.

---

### D. المصادقة

#### D1 · ‏Clerk (تسجيل/دخول) — UNVERIFIED
- **الملفات:** `app/(auth)/*`، وكيل Clerk في الخادم (`app.ts:134-135`)، `CLERK_PUBLISHABLE_KEY`/`SECRET_KEY`.
- **الاختبار:** اختبارات إعداد المصادقة ضمن `owner-access.test.mjs` (تطلب مفتاحي Clerk في الإنتاج).
- **سبب UNVERIFIED:** لا مفاتيح حقيقية في البيئة، ولم تُختبر رحلة تسجيل/تأكيد بريد حيّة.

#### D2 · وضع التطوير بلا مصادقة — COMPLETED
- **الأدلة:** `owner-access.test.mjs` — 11 اختبارًا منها: التجاوز يتطلب علم تطوير صريحًا، لا يعود إلى هوية افتراضية مشتركة، ‏**إعداد الإنتاج يرفض التجاوز**.
- **الملفات:** `MENA_AUTH_DISABLED`، `EXPO_PUBLIC_AUTH_DISABLED`، `constants/auth.ts` في الجوال.

#### D3 · تشفير رموز Meta ودوران المفتاح — COMPLETED
- **الأدلة:** `meta-token-crypto.test.mjs`؛ ‏`ENCRYPTION_KEY_PREVIOUS` من البيئة (المفتاح الثابت القديم **حُذف** — تحقّقت).
- **الأخطاء/الفجوات:** لا دليل على تدوير فعلي في الإنتاج (إجرائي لا كودي).

#### D4 · وصول المالك — COMPLETED (حيًّا UNVERIFIED)
- **الأدلة:** `MENA_OWNER_CONSOLE_TOKEN` + ‏`MENA_OWNER_EMAIL`/`MENA_OWNER_USER_IDS`، محدِّد معدّل خاص، ‏`noindex`/`no-store`، و11 اختبارًا.

---

### E. مساحات العمل والصلاحيات

#### E1 · مساحات العمل — COMPLETED
- **الوصف:** تزويد تلقائي عند أول طلب مصادَق، قائمة/حالية/تعديل، طلب حذف، تصدير بيانات.
- **الملفات:** `src/lib/workspace-resolution.ts`، `src/routes/workspaces.ts` (‏GET list/current/:id، PATCH current، حذف/تصدير).
- **الاختبار:** `workspace-resolution`/`context` (5+2 HTTP)، بوابة الانحراف، ‏`workspace-deletion-policy.test.mjs` (5).
- **الأدلة الحية:** مساحتان، أعمدة `business_type` و`country` و`deletion_*` موجودة.

#### E2 · الأدوار — PARTIALLY_COMPLETED
- **الأدلة:** `mena_workspace_members.role` (افتراضي `owner`)؛ الخادم يفرض المالك في `routes/workspaces.ts:27` (`context.role !== "owner"`)؛ الواجهة صارت تخفي خطوة «بيانات النشاط» عن غير المالك وتجعل `/setup` للقراءة فقط (‏`lib/setup-flow.ts` + 4 اختبارات، PR #74).
- **الأخطاء/الفجوات:** **لم يُتحقق أن كل مسارات الكتابة تفحص الدور** (لا اختبار يمسح ذلك)؛ لا واجهة لإدارة الأدوار؛ ‏**صفر أعضاء غير مالك حيًّا** → المسار كله غير مُجرَّب.
- **يلزم:** مسح آلي لفرض الدور + اختبارات على مسارات الكتابة بدور عضو (§4.9/7ب).

#### E3 · الدعوات وإدارة الأعضاء — MISSING
- **الأدلة:** لا مسارات دعوة/قبول/إزالة، لا جدول دعوات، لا واجهة. (`mena_workspace_members` يُملأ بالتزويد التلقائي فقط.)

#### E4 · عزل المستأجرين عبر المسارات — PARTIALLY_COMPLETED
- **الأدلة:** helpers مُختبَرة (B3) + اختبار HTTP واحد للوصول الأجنبي؛ لكن **لا اختبار يغطي الـ85 مسارًا**، والعقد لا يغطي 66% منها.
- **يلزم:** اختبار HTTP منهجي (مسار × مساحة أجنبية) — أعلى عائد أمان في المشروع (§4.4).

---

### F. التكاملات الخارجية

#### F1 · ‏Meta OAuth والصلاحيات — UNVERIFIED
- **الملفات:** `src/lib/meta-oauth.ts`، `src/routes/social.ts` (`/social/meta/connect`، `/social/meta/callback`، ‏DELETE `/social/meta`).
- **الأدلة:** النطاقات المطلوبة تشمل `pages_show_list` و`pages_manage_posts` و**`instagram_content_publish`** (نتيجة تدقيق 2026-10-18 **مُصلَحة**)؛ ‏`meta-oauth.test.mjs` موجود؛ حالات OAuth في `mena_oauth_states`.
- **سبب UNVERIFIED:** لا `FACEBOOK_APP_ID/SECRET`، وصفر ربط Meta حيّ (`mena_meta_connections = 0`).

#### F2 · النشر على فيسبوك/إنستغرام — UNVERIFIED
- **الملفات:** `src/lib/{meta-publishing,meta-publishing-media,meta-post-media}.ts`، `src/routes/posts-publishing.ts`.
- **الاختبار:** `meta-publishing-media.test.mjs`، `meta-post-media.test.mjs`، `meta-media-url.test.mjs`؛ ‏`meta-publishing.ts` نفسه **بلا اختبار مقابل**.
- **الأدلة الحية:** صفر منشورات.
- **يلزم:** اختبار نشر حيّ على صفحة اختبار + تغطية `meta-publishing.ts`.

#### F3 · صندوق وارد Meta والردود والويبوك — UNVERIFIED
- **الملفات:** `src/routes/{meta-inbox,meta-inbox-replies,meta-webhook,meta-webhook-subscriptions}.ts`، `src/lib/{meta-inbox-graph,meta-inbox-pagination,meta-inbox-reply-reservation,meta-webhook}.ts`.
- **الأدلة:** التحقق من التوقيع `x-hub-signature-256` موجود (`routes/meta-webhook.ts:62`) مع جسم خام بحد 1MB؛ ‏`meta-webhook.test.mjs`، `meta-inbox-graph.test.mjs`، `meta-inbox-pagination.test.mjs`، `meta-inbox-utils.test.mjs`.
- **الحيّ:** صفر عناصر صندوق وارد، وصفر اشتراكات ويبوك.

#### F4 · ‏WhatsApp عبر Evolution API — UNVERIFIED
- **الملفات:** `src/lib/{whatsapp-evolution,whatsapp-instance,whatsapp-pairing,whatsapp-sync,whatsapp-history,whatsapp-groups,whatsapp-direct-messages,whatsapp-media-download}.ts`، `src/routes/whatsapp-*.ts`.
- **الاختبار:** 10+ ملفات اختبار (‏`whatsapp-evolution`، `whatsapp-instance`، `whatsapp-pairing`، `whatsapp-groups`، `whatsapp-history`، `whatsapp-direct-messages`، `whatsapp-sync-options`، `whatsapp-opt-out`…).
- **الأدلة الحية:** **ربط WhatsApp واحد موجود** (اقتران نُفِّذ فعلًا في هذه البيئة) لكن **صفر رسائل مستوردة** → الاقتران مُثبت جزئيًا، المزامنة/الوسائط/الردود غير مُثبتة.
- **الأخطاء/الفجوات:** `WHATSAPP_EVOLUTION_WEBHOOK_URL/SECRET` يحتاجان مضيفًا عامًا (Vercel لا يستضيف الخادم) — لم يُتحقق من وصول الويبوك.

#### F5 · الذكاء الاصطناعي + القياس — PARTIALLY_COMPLETED
- **الملفات:** `src/lib/{ai-provider,metered-ai-provider}.ts` (‏OpenAI وGemini)، `src/routes/ai.ts` (`POST /ai/content`).
- **الاختبار:** `ai-provider.test.mjs`، `ai-metering-guard.test.mjs` (2)، `whatsapp-marketing-ai.test.mjs`، `entitlements.test.mjs` (9).
- **الأدلة الحية:** **صف استخدام واحد** في `mena_workspace_subscription_usage` → القياس سُجِّل فعلًا مرة واحدة على الأقل.
- **الأخطاء/الفجوات:** لا مفاتيح هنا → التوليد الفعلي `UNVERIFIED`؛ `metered-ai-provider.ts` بلا اختبار مقابل.

#### F6 · إشعارات الدفع (Expo Push) — UNVERIFIED
- **الملفات:** `src/lib/{push-notifications,expo-push-client,notification-content}.ts`، `src/routes/push-notifications.ts`، عاملان (`push-notifications`، `push-notification-retention`)، الجوال `lib/push-notifications.ts`.
- **الاختبار:** `expo-push-client.test.mjs`، `notification-content.test.mjs`.
- **الحيّ:** **صفر رموز دفع** وصفر صفوف في صندوق الإرسال → لم يُسجَّل جهاز قط.

---

### G. الأتمتة والعمال

#### G1 · سجل العمال وحلقة الخلفية — PARTIALLY_COMPLETED
- **الأدلة:** **15 عاملًا** في `src/lib/app-workers.ts`: ‏`scheduled-posts` (15 ثانية)، `workspace-deletion` (ساعي)، `auto-reply-recovery`، `whatsapp-direct-message-retention`، `meta-auto-replies`، `meta-order-confirmations`، `whatsapp-auto-replies`، `whatsapp-order-confirmations`، `meta-webhook-subscriptions` (مشروط بـ`MENA_META_WEBHOOK_VERIFY_TOKEN`)، `product-extraction`، `product-publication`، `media-download`، `media-thumbnails`، `push-notifications`، `push-notification-retention` — لكلٍّ مفتاح تعطيل عبر البيئة.
- **الاختبار:** `background-worker-loop.test.mjs`.
- **الأخطاء/الفجوات:** `app-workers.ts` بلا اختبار مقابل؛ ‏`GET /api/workers` يتطلب توكن المالك؛ ‏**لا دليل على تشغيل أي عامل في الإنتاج** (لا مضيف خادم مُتحقَّق منه، ولا مراقبة) → السلوك الحيّ `UNVERIFIED`.
- **يلزم:** إعادة نشر الخادم + لوحة نبض/مقاييس لكل عامل.

#### G2 · النشر المجدول — PARTIALLY_COMPLETED
- **الملفات:** `src/lib/{scheduling,scheduled-posts}.ts`، ترحيل `post_scheduling`، واجهة المواعيد في `compose`.
- **الاختبار:** `scheduling.test.mjs` (منطق المواعيد/المناطق الزمنية)؛ ‏`scheduled-posts.ts` **بلا اختبار مقابل**.
- **الأدلة الحية:** الترحيل مطبَّق؛ صفر منشورات مجدولة.
- **يلزم:** اختبار للعامل (استحقاق، قفل، فشل/إعادة محاولة) + تشغيل حيّ.

#### G3 · حذف مساحة العمل + تصدير البيانات — PARTIALLY_COMPLETED
- **الملفات:** `src/lib/{workspace-deletion,workspace-deletion-policy,workspace-export}.ts`، `src/routes/workspaces.ts`، ترحيل `workspace_deletion_worker`، الجوال `lib/download-workspace-export.ts` + زر في الإعدادات.
- **الاختبار:** `workspace-deletion-policy.test.mjs` — **5 اختبارات** (مهلة 30 يومًا، قاعدة الاستحقاق، بادئات التخزين لكل مساحة، ميزانية 5 محاولات، رفض البادئات الخطرة قبل أي I/O).
- **الأدلة الحية:** أعمدة `status/attempts/last_error/completed_at` + فهرس `(status, requested_at)` موجودة؛ صفر طلبات حذف.
- **الأخطاء/الفجوات:** `workspace-deletion.ts` و`workspace-export.ts` **بلا اختبار** (التفكيك الفعلي: Meta → Evolution → التخزين → 39 جدولًا)؛ التصدير غير مُختبَر حيًّا؛ المسار خارج العقد.
- **يلزم:** اختبار للتفكيك بقاعدة بيانات اختبارية + تنفيذ حيّ متحكَّم به على مساحة تجريبية.

#### G4 · الاسترجاع والاحتفاظ — PARTIALLY_COMPLETED
- **الملفات:** `whatsapp-auto-reply-recovery.ts`، `whatsapp-direct-message-retention.ts`، `push-notification-retention`.
- **الأخطاء/الفجوات:** كلها بلا ملفات اختبار مقابلة؛ فترات الاحتفاظ عبر البيئة (`PUSH_NOTIFICATION_RETENTION_DAYS`…) ولم تُقَس حيًّا.

#### G5 · اشتراكات ويبهوك Meta — UNVERIFIED
- **الملفات:** `src/lib/meta-webhook-subscriptions.ts`، العامل المشروط بـ`MENA_META_WEBHOOK_VERIFY_TOKEN`.
- **الحيّ:** صفر صفوف في `mena_meta_webhook_subscriptions`.

---

### H. الردود الآلية

#### H1 · ردود Meta الآلية — PARTIALLY_COMPLETED
- **الملفات:** `src/lib/{meta-auto-reply,meta-auto-reply-worker}.ts`، `src/routes/meta-auto-replies.ts`، الجدولان `mena_meta_auto_reply_settings/_jobs`، لوحة `MetaAutoReplySettingsPanel.tsx`.
- **الاختبار:** `meta-auto-reply.test.mjs` = **50 كتلة اختبار** (أعلى تغطية في المشروع)، ‏`meta-channel-routing.test.mjs`.
- **الأخطاء/الفجوات:** العامل نفسه بلا اختبار؛ المسارات خارج العقد؛ صفر تنفيذ حيّ؛ حدّ `META_AUTO_REPLY_HOURLY_LIMIT` غير مُقاس حيًّا.

#### H2 · ردود WhatsApp الآلية — PARTIALLY_COMPLETED
- **الملفات:** `src/lib/{whatsapp-auto-reply,whatsapp-auto-reply-policy,whatsapp-opt-out,whatsapp-marketing,whatsapp-marketing-safety}.ts`، `src/routes/whatsapp-auto-replies.ts` (يشمل عملية `testWhatsAppAutoReply` في العقد).
- **الاختبار:** `whatsapp-auto-reply.test.mjs`، `whatsapp-marketing-safety.test.mjs`، `whatsapp-opt-out.test.mjs`.
- **الأخطاء/الفجوات:** `whatsapp-auto-reply-policy.ts` و`whatsapp-marketing.ts` بلا اختبارات مقابلة؛ الجدول `mena_whatsapp_auto_reply_events` فارغ حيًّا.

#### H3 · أمان الردود وحدودها — PARTIALLY_COMPLETED
- **الأدلة:** `auto-reply-coalescing.test.mjs` (7 اختبارات) لمنع تتابع الردود، اشتراك/إلغاء (`opt-out`)، حدود ساعية عبر البيئة، وعمر أقصى للرسائل (`WHATSAPP_AUTO_REPLY_MAX_AGE_MINUTES`).
- **الأخطاء/الفجوات:** الحدود غير مُختبَرة تحت حمل حقيقي؛ لا قياس للإفراط في الرد (خطر حظر WhatsApp).

---

### I. المنشورات

#### I1 · الإنشاء والمسودات + التوليد بالذكاء الاصطناعي — PARTIALLY_COMPLETED
- **الملفات:** `app/compose.tsx`، `src/routes/posts-write.ts`، `posts-workflow.ts`، `POST /posts/from-message`، ‏`POST /ai/content`.
- **الاختبار:** `ai-provider.test.mjs`؛ ملفات `posts-*` **بلا اختبارات على مستوى المسارات**.
- **الأخطاء/الفجوات:** `/compose` لا يفحص وجود ربط مؤهل قبل الإرسال (كان محجوبًا بالجدار سابقًا؛ كُشف بعد إلغائه) → التاجر بلا حسابات يكتب منشورًا ثم يفشل النشر لكل قناة.
- **يلزم:** حالة صادقة في الإنشاء («اربط قناة لتنشر») أو تعطيل الإرسال مع سبب.

#### I2 · النشر الفوري والتحقق — UNVERIFIED
- **الملفات:** `src/routes/posts-publishing.ts` (`POST /posts/{id}/publish`، `/posts/{id}/verify-facebook`)، `src/lib/meta-publishing.ts`.
- **الأدلة:** صفر منشورات حيّة، لا مفاتيح Meta.
- **ملاحظة أمان إيجابية:** `workspace-tenant-access.test.mjs` يثبت أن النشر والتحقق **يرفضان معرّف منشور من مساحة أخرى** ويفشلان مغلقًا بلا سياق.

#### I3 · الجدولة الزمنية — انظر G2 (PARTIALLY_COMPLETED)

#### I4 · التقارير والنشاط — PARTIALLY_COMPLETED
- **الملفات:** `src/routes/posts-read.ts` (`/posts/report-summary`، `/posts/events`، العملية `getPostReportSummary`)، `components/reports/ReportsScreen.tsx`، `app/activities.tsx`، `mena_post_activity_events`.
- **الأخطاء/الفجوات:** Reports تعتمد على **حالات المنشورات الداخلية** لا تحليلات المنصات (ملاحظة تدقيق 2026-10-18؛ لم أُعد التحقق من جلب تفاعل حيّ من Graph) — `facebook-performance.ts` موجود ومُختبَر (`facebook-performance.test.mjs`) لكن لا دليل على استخدامه في التقارير؛ `post-activity.ts` بلا اختبار مقابل.

---

### J. المنتجات

#### J1 · الكتالوج — PARTIALLY_COMPLETED
- **الملفات:** `src/routes/{product-catalog,product-management,product-media}.ts` (‏GET/POST/PUT + وسائط + رابط عام)، الجوال `components/products/ProductCatalogScreen.tsx` و`components/sources/CsvProductImportCard.tsx`، `lib/product-catalog-api.ts`.
- **الاختبار:** بلا اختبارات على مستوى المسارات؛ `product-utils.ts` بلا اختبار.
- **الأدلة:** صفر منتجات حيّة.
- **الأخطاء/الفجوات:** **لا DELETE لمنتج** (أرشيف فقط عبر `includeArchived`)؛ استيراد CSV موجود في الواجهة ولم يُتحقق من مساره الخادمي.

#### J2 · استخراج المنتجات من WhatsApp/المنشورات — PARTIALLY_COMPLETED
- **الملفات:** `src/routes/product-extractions.ts` (5 مسارات: مراجعة/إنشاء مسودة/تجاهل/استخراج من منشور/من WhatsApp)، `src/lib/whatsapp-product-extraction.ts`، الجدولان `mena_product_extraction_sources/_suggestions`، عامل `product-extraction`.
- **الأخطاء/الفجوات:** الوحدة بلا اختبار مقابل؛ صفر صفوف حيّة؛ يعتمد على مزوّد ذكاء اصطناعي (F5).

#### J3 · نشر المنتجات كمهام — PARTIALLY_COMPLETED
- **الملفات:** `src/routes/product-publishing.ts` (`/social/products/publish`، `/publish-jobs`، `/publish-jobs/retry`)، `src/lib/product-publishing.ts`، عامل `product-publication`، الجدولان `mena_product_posts` و`mena_product_publication_jobs`.
- **الأخطاء/الفجوات:** `product-publishing.ts` بلا اختبار؛ صفر مهام حيّة؛ خارج العقد.

#### J4 · المخزون وحركاته — PARTIALLY_COMPLETED
- **الملفات:** `mena_inventory_movements`، `GET /social/products/{id}/inventory-movements`، منطق الحجز/التحرير داخل `routes/orders.ts:418-460` (`inventoryTracked`, `inventoryReserved`).
- **الأخطاء/الفجوات:** لا جرد/تسوية يدوية في الواجهة؛ لا اختبار للمنطق (داخل ملف مسارات غير مُختبَر)؛ صفر حركات حيّة.

---

### K. الطلبات والتوصيل

#### K1 · استقبال الطلبات (Meta + WhatsApp) — PARTIALLY_COMPLETED
- **الملفات:** `src/lib/{meta-order-intake,whatsapp-order-intake,order-intake-parsing}.ts`، الجداول `mena_meta_order_intakes` و`mena_whatsapp_order_intakes`.
- **الاختبار:** `meta-order-intake.test.mjs`، `whatsapp-order-intake.test.mjs`.
- **الأدلة الحية:** صفر صفوف استقبال.
- **الأخطاء/الفجوات:** `order-intake-parsing.ts` بلا اختبار مقابل.

#### K2 · إدارة الطلبات — PARTIALLY_COMPLETED
- **الملفات:** `src/routes/orders.ts` — ‏GET `/social/orders/summary`، GET `/social/orders`، POST `/social/orders`، **PATCH `/social/orders/{id}/status`**، **PATCH `/social/orders/{id}/delivery`**؛ الجوال `components/orders/OrderManagementScreen.tsx` + `lib/orders-api.ts`.
- **الاختبار:** **لا اختبارات** على مستوى المسارات؛ `order-service.ts` بلا اختبار مقابل.
- **التحقق الإيجابي:** تحقّقتُ آليًا أن **كل المسارات التي يستدعيها الجوال يدويًا (36) موجودة في الخادم** — فلا طلبات ميتة (404).
- **الأخطاء/الفجوات:** صفر طلبات حيّة؛ لا إلغاء/استرداد؛ لا تصدير.

#### K3 · تأكيدات الطلبات والإشعارات — PARTIALLY_COMPLETED
- **الملفات:** `src/lib/{meta-order-confirmation-queue,whatsapp-order-confirmation-queue,meta-order-messages}.ts`، عاملان (`meta-order-confirmations`، `whatsapp-order-confirmations`)، الجدول `mena_whatsapp_order_confirmations`، ترحيل `meta_order_confirmation_notifications`.
- **الأخطاء/الفجوات:** الطوابير الثلاثة **بلا اختبارات مقابلة**؛ صفر صفوف حيّة؛ تعتمد على F6 (الدفع) وF4 (واتساب).

#### K4 · التوصيل/الشحن — PARTIALLY_COMPLETED (رفيع)
- **الأدلة:** أعمدة `deliveryStatus`/`deliveryProvider`/`deliveryFee`/`deliveryAddress` + جدول `mena_order_delivery_events` + مسار PATCH.
- **الأخطاء/الفجوات:** **لا تكامل مع أي مزوّد شحن** (لاgrep عن مزوّد)، لا حساب رسوم، لا تتبّع، ولا واجهة لإدارة أحداث التوصيل beyond PATCH واحد؛ الترحيل `inventory_delivery` أضاف النموذج فقط.
- **يلزم:** قرار منتج (يدوي أم مزوّد) ثم تنفيذ accordingly.

---

### L. الاشتراكات

#### L1 · الخطط والاستحقاقات — PARTIALLY_COMPLETED
- **الملفات:** `src/lib/{plan-catalog,entitlements,entitlement-store,subscriptions}.ts`، `src/routes/{plans,subscriptions}.ts` (`GET /plans`، `GET /subscription`)، `docs/SUBSCRIPTIONS_ARCHITECTURE.md`.
- **الاختبار:** `entitlements.test.mjs` (9)، `plans.test.mjs` (‏**اختبار HTTP حقيقي** على `/api/plans`).
- **الأدلة الحية:** اشتراكان بحالة `trialing` (تُزرع تلقائيًا عبر `ensureSubscription`)، وانتهاء التجربة يُعالَج **كسولًا عند القراءة** (`expireTrialIfNeeded`).
- **الأخطاء/الفجوات:** `subscriptions.ts` و`entitlement-store.ts` و`plan-catalog.ts` بلا اختبارات مقابلة.

#### L2 · قياس الاستخدام وإنذار النفاد — PARTIALLY_COMPLETED
- **الأدلة:** `mena_workspace_subscription_usage` (صف واحد حيّ = القياس يعمل)، `notifyQuotaExhausted` يدفع إشعارًا عند النفاد، وحارس قياس الذكاء الاصطناعي مُختبَر.
- **الأخطاء/الفجوات:** لا لوحة استخدام للتاجر؛ الإنذار يعتمد على F6 (غير مُثبت).

#### L3 · دورة الفوترة (دفع/تجديد/إلغاء) — MISSING
- **الأدلة:** `paymentsEnabled()` = ‏`process.env.PAYMENTS_ENABLED === "true"` (غير مضبوط في `.env.example` ولا في Vercel)؛ ‏**لا مزوّد دفع** (لا Stripe/Paddle/Tap/HyperPay/Paymob في الكود)؛ الأعمدة `paymentProvider` و`providerSubscriptionId` موجودة **بلا كتابة**؛ ‏**لا مسارات** اكتتاب/ترقية/إلغاء؛ ‏**لا عامل تجديد**؛ ولا واجهة دفع.
- **الأثر:** المنتج **لا يستطيع تحصيل أجر** — كل حساب يبقى `trialing` إلى الأبد (وهو ما تُثبته القاعدة الحية).
- **يلزم:** مزوّد دفع + مسارات webhook للفوترة + عامل تجديد/تعليق + واجهة ترقية (هذا هو §3.6 في تقرير التوصيات).

---

### M. لوحة تحكم المالك

#### M1 · القراءة والمراقبة — PARTIALLY_COMPLETED
- **الأدلة:** 6 مسارات (`/session`، `/overview`، `/auto-replies`، `/workers`، `/workspaces`، `/workspaces/:id`) + 4 صفحات SPA + توكن + محدِّد معدّل + ‏`noindex`.
- **الأخطاء/الفجوات:** لا اختبارات للمسارات؛ لا دليل تشغيل حيّ.

#### M2 · الإجراءات الإدارية وسجل التدقيق — MISSING
- **الأدلة:** كل مسارات `owner.ts` هي `GET` فقط؛ ‏**لا جدول سجل تدقيق** (`audit_log`/`admin_actions` غير موجودين في المخطط)؛ لا إجراء إداري (تعليق مساحة، إلغاء ربط، إعادة تشغيل عامل).
- **يلزم:** §4.9 من تقرير التوصيات (أدوار + سجل إدارة).

---

### N. معالجة الأخطاء

#### N1 · الخادم — COMPLETED (انظر B4)

#### N2 · الجوال — PARTIALLY_COMPLETED
- **الملفات:** `components/{ErrorBoundary,ErrorFallback,SetupProblemScreen,AuthAlert,AppFeedback,OfflineBanner}.tsx`، `lib/{error-diagnostics,alert-routes,alert-invalidation,auth-error-message,meta-auto-reply-failure}.ts`، ومعالج `ApiErrorNotice` في `app/_layout.tsx` (‏unauthorized/forbidden/server مع إعادة محاولة).
- **الاختبار:** `error-diagnostics.test.mjs`، `alert-routes.test.mjs`، `alert-invalidation.test.mjs`، `auth-error-message.test.mjs`، `web-style-safety.test.mjs`.
- **الأخطاء/الفجوات:** المكوّنات نفسها (‏ErrorBoundary/Fallback) بلا اختبارات؛ لا ربط `requestId` من الخادم بعرض المستخدم (يظهر في الاستجابة لكن لم أتحقق من عرضه).

#### N3 · العمال — PARTIALLY_COMPLETED
- **الأدلة:** حلقة الخلفية مُختبَرة؛ عامل الحذف يملك `attempts`/`last_error`/ميزانية 5 محاولات وحالة `failed` (ترحيل حيّ)؛ `PUSH_NOTIFICATION_MAX_ATTEMPTS`.
- **الأخطاء/الفجوات:** بقية العمال بلا سجل فشل/محاولات ظاهر في المخطط؛ لا تنبيه عند فشل عامل (يعتمد M1).

---

### O. وظائف عرضية عبر المشروع

#### O1 · الصفحات القانونية — PARTIALLY_COMPLETED
- **الملفات:** `app/(auth)/terms.tsx` و`privacy.tsx` (غلافان من 5 أسطر) + `components/LegalDocumentScreen.tsx` (200 سطر، نصوص عربية مقسّمة: «الجهة المقدمة للخدمة»، «الخدمة والحساب»، «الاستخدام المقبول والمحتوى»، «الخطط والرسوم»، «التعليق والإنهاء»، «المسؤولية والتغييرات»…).
- **الأخطاء/الفجوات:** المحتوى **غير مراجع قانونيًا** ولا يحمل كيانًا/عنوان اتصال مُتحقَّقًا منه؛ لا نسخة ويب عامة (§3.5).

#### O2 · ‏CI والبوابات — COMPLETED
- **الأدلة:** 7 بوابات خضراء محليًا وعلى PR #75 (`verify` + CodeQL + Vercel)؛ ‏528/528 اختبارًا؛ typecheck لكل الحزم؛ lint؛ بناء api-server؛ ‏expo export.

#### O3 · التوثيق — PARTIALLY_COMPLETED
- **الأدلة:** 9 أدلة في `docs/` + 10 ملفات تدقيق في `docs/audit/`؛ ‏`AGENTS.md`.
- **الأخطاء/الفجوات:** `MenaFlow_Full_Technical_Audit.md` في **الجذر** (2026-10-18) تجاوزته الأحداث ولم يُنقل؛ `docs/PROJECT_AUDIT_REPORT.md` (2026-11-08) سابق لخمسة تغييرات كبرى؛ `app.json` في الجذر `{"expo":{}}` بلا فائدة ظاهرة (§6/§P3).

#### O4 · أمان الاعتماديات — PARTIALLY_COMPLETED
- **الأدلة:** `dependabot.yml` بمجموعات؛ جلسة تصفية (إغلاق #16–#20، دمج #60)؛ ‏**GitHub ما زال يبلغ عن 9 ثغرات على `main`** (5 عالية، 3 متوسطة، 1 منخفضة) ظهرت في مخرجات `git push` نفسها.
- **الأخطاء/الفجوات:** `sharp` 0.35.5 و`proxy-addr` 2.0.8 بانتظار مجموعة `production`؛ ‏**#62 (58 تحديث تطوير) متعارضة و`verify` حمراء**؛ ‏**#44** طلب إرجاع مفتوح بلا حسم.

#### O5 · المراقبة والقياس — MISSING
- **الأدلة:** لا `metrics`، لا tracing، لا لوحة نبض للعمال، لا uptime خارجي، ولا مقاييس منتج (§9 من تقرير التوصيات يطلبها صراحةً).

---

## 6. جدول الحالات الموحد

| # | الوظيفة | الحالة | FE | BE | DB | اختبار |
|---|---|---|---|---|---|---|
| A1 | تطبيق الجوال: البنية والتنقل | PARTIALLY_COMPLETED | منفَّذ (36 شاشة) | — | — | typecheck+export فقط |
| A2 | ويب Vercel | PARTIALLY_COMPLETED | منشور READY | غير مستضاف هنا | — | بناء أخضر |
| A3 | لوحة المالك SPA | PARTIALLY_COMPLETED | 4 صفحات | 6 مسارات قراءة | قراءة | 11 (وصول) |
| A4 | mockup-sandbox | UNVERIFIED | موجود | — | — | لا شيء |
| A5 | الهوية/RTL/الوصولية | PARTIALLY_COMPLETED | منفَّذ | — | — | حارس أنماط ويب |
| B1 | مسارات HTTP (85) | PARTIALLY_COMPLETED | — | منفَّذ | — | 2 HTTP فقط |
| B2 | العقد + التوليد | PARTIALLY_COMPLETED | عميل مولّد | 34% تغطية | — | بوابة انحراف |
| B3 | وسطاء العزل | COMPLETED | — | منفَّذ | — | 10 (منها 2 HTTP) |
| B4 | الأخطاء والتسجيل | COMPLETED | — | منفَّذ | — | error-codes/logger |
| B5 | حدود المعدل | PARTIALLY_COMPLETED | — | منفَّذ | — | لا شيء |
| B6 | healthz/readyz | PARTIALLY_COMPLETED | — | منفَّذ | — | لا شيء |
| C1 | المخطط/الترحيلات | COMPLETED | — | — | 42=42، 40=40 | بوابة انحراف |
| C2 | ‏RLS والصلاحيات | PARTIALLY_COMPLETED | — | — | RLS 42/42، ‏0 سياسات | لا شيء |
| C3 | بوابات CI | COMPLETED | — | — | — | 7 بوابات |
| C4 | تخزين الوسائط | PARTIALLY_COMPLETED | — | منفَّذ | دلو+بديل محلي | جزئي |
| C5 | البيانات الحية | UNVERIFIED | — | — | شبه فارغة | — |
| D1 | ‏Clerk | UNVERIFIED | منفَّذ | وكيل | — | إعداد فقط |
| D2 | وضع بلا مصادقة | COMPLETED | منفَّذ | منفَّذ | — | 11 |
| D3 | تشفير الرموز | COMPLETED | — | منفَّذ | — | meta-token-crypto |
| D4 | وصول المالك | COMPLETED | — | منفَّذ | — | 11 |
| E1 | مساحات العمل | COMPLETED | منفَّذ | منفَّذ | حيّة (2) | 12+ |
| E2 | الأدوار | PARTIALLY_COMPLETED | منفَّذ جزئيًا | جزئي | عمود موجود | 4 (جديد) |
| E3 | الدعوات/الأعضاء | MISSING | — | — | جدول أعضاء فقط | — |
| E4 | عزل المستأجرين | PARTIALLY_COMPLETED | — | منفَّذ | — | مسار واحد |
| F1 | ‏Meta OAuth | UNVERIFIED | منفَّذ | منفَّذ | 0 صفوف | meta-oauth |
| F2 | النشر Meta | UNVERIFIED | منفَّذ | منفَّذ | 0 منشورات | وسائط فقط |
| F3 | صندوق Meta/الويبوك | UNVERIFIED | منفَّذ | منفَّذ | 0 عناصر | 4 ملفات |
| F4 | ‏WhatsApp/Evolution | UNVERIFIED | منفَّذ | منفَّذ | ربط 1، رسائل 0 | 10+ ملفات |
| F5 | الذكاء الاصطناعي | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | استخدام 1 | 4 ملفات |
| F6 | ‏Expo Push | UNVERIFIED | منفَّذ | منفَّذ | 0 رموز | 2 ملفان |
| G1 | العمال (15) | PARTIALLY_COMPLETED | — | منفَّذ | — | الحلقة فقط |
| G2 | النشر المجدول | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | ترحيل حيّ | scheduling فقط |
| G3 | الحذف + التصدير | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | أعمدة حيّة | 5 (سياسة) |
| G4 | الاسترجاع/الاحتفاظ | PARTIALLY_COMPLETED | — | منفَّذ | — | لا شيء |
| G5 | اشتراكات الويبوك | UNVERIFIED | — | منفَّذ | 0 صفوف | لا شيء |
| H1 | ردود Meta | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | 0 صفوف | 50 |
| H2 | ردود WhatsApp | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | 0 أحداث | 3 ملفات |
| H3 | أمان/حدود الردود | PARTIALLY_COMPLETED | — | منفَّذ | — | 8 |
| I1 | الإنشاء/المسودات/AI | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | 0 | جزئي |
| I2 | النشر الفوري | UNVERIFIED | منفَّذ | منفَّذ | 0 | عزل فقط |
| I3 | الجدولة | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | ترحيل | scheduling |
| I4 | التقارير/النشاط | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | 0 أحداث | performance |
| J1 | الكتالوج | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | 0 منتجات | لا شيء |
| J2 | استخراج المنتجات | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | 0 صفوف | لا شيء |
| J3 | نشر المنتجات | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | 0 مهام | لا شيء |
| J4 | المخزون | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | 0 حركات | لا شيء |
| K1 | استقبال الطلبات | PARTIALLY_COMPLETED | — | منفَّذ | 0 صفوف | 2 ملفان |
| K2 | إدارة الطلبات | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | 0 طلبات | لا شيء |
| K3 | التأكيدات | PARTIALLY_COMPLETED | — | منفَّذ | 0 صفوف | لا شيء |
| K4 | التوصيل | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | نموذج فقط | لا شيء |
| L1 | الخطط/الاستحقاقات | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | 2 trialing | 9+HTTP |
| L2 | القياس/الإنذار | PARTIALLY_COMPLETED | — | منفَّذ | 1 صف | 2+9 |
| L3 | الفوترة | MISSING | — | — | أعمدة بلا كتابة | — |
| M1 | قراءة المالك | PARTIALLY_COMPLETED | منفَّذ | منفَّذ | — | 11 (وصول) |
| M2 | إجراءات/تدقيق | MISSING | — | — | لا جدول | — |
| N1 | أخطاء الخادم | COMPLETED | — | منفَّذ | — | نعم |
| N2 | أخطاء الجوال | PARTIALLY_COMPLETED | منفَّذ | — | — | 5 ملفات منطق |
| N3 | أخطاء العمال | PARTIALLY_COMPLETED | — | منفَّذ | attempts/last_error | الحلقة |
| O1 | الصفحات القانونية | PARTIALLY_COMPLETED | منفَّذ | — | — | لا شيء |
| O2 | ‏CI | COMPLETED | — | — | — | 7 بوابات |
| O3 | التوثيق | PARTIALLY_COMPLETED | — | — | — | — |
| O4 | أمان الاعتماديات | PARTIALLY_COMPLETED | — | — | — | Dependabot |
| O5 | المراقبة | MISSING | — | — | — | — |

---

## 7. الأخطاء والفجوات حسب الخطورة

### حرجة (Critical) — تمنع إيرادات أو تهدد بيانات المستأجرين

| # | الخطأ | الدليل | الأثر |
|---|---|---|---|
| CR-1 | **لا دورة فوترة إطلاقًا** | `paymentsEnabled()` = ‏`PAYMENTS_ENABLED === "true"`؛ لا مزوّد دفع في الكود؛ لا مسارات اكتتاب/إلغاء؛ لا عامل تجديد؛ الاشتراكان الحيّان `trialing` | لا يمكن تحصيل أجر؛ كل حساب يبقى تجريبيًا للأبد |
| CR-2 | **عزل المستأجرين بطبقة واحدة** — ‏*مُخفَّف جزئيًا في 2026-11-23* | ‏RLS مفعَّل على 42/42 لكن **صفر سياسات**؛ الخادم يتجاوزه كمالك؛ اختبار HTTP واحد للوصول الأجنبي من 99 تسجيل مسار. **أُضيف حارس ساكن** (`src/routes/route-guards.test.mjs`) يمسح كل التسجيلات آليًا ويفشل إن سُجِّل أي مسار بلا `requireWorkspace` ودون استثناء موثَّق، وإن كتب مسارٌ معفيّ في جدول مستأجر، وإن كفّ الماسح نفسه عن رؤية المسارات | السهو الفردي صار يُلتقط في CI؛ بقيت مصفوفة اختبارات HTTP (مسار × مساحة أجنبية) كعمل تابع |
| CR-3 | **‏66% من الواجهة HTTP خارج العقد** | 56 مسارًا من 85 بلا تعريف OpenAPI؛ الجوال يستدعيها بعملاء يدويين بلا تحقق zod | انحراف صامت بين الخادم والجوال لا تلتقطه أي بوابة CI |

### عالية (High)

| # | الخطأ | الدليل |
|---|---|---|
| HI-1 | **صفر دليل حيّ على أي تكامل** (Meta/Evolution/AI/Push) | صفر منشورات/رسائل/عناصر/رموز دفع في القاعدة الحية؛ لا `.env` |
| HI-2 | **43 من 44 ملف مسارات بلا اختبار** | توزيع ملفات الاختبار: 57 في `src/lib` مقابل 1 في `src/routes` |
| HI-3 | **`trust proxy` غير مضبوط** — ‏*مُعالَج في 2026-11-23* — و**حدود المعدل ما زالت في الذاكرة** | `app.set("trust proxy", resolveTrustProxy())` مع `src/lib/trust-proxy.ts` (5 اختبارات) و`MENA_TRUST_PROXY` موثَّق في `.env.example`؛ يبقى `store:` غائبًا عن `app.ts` (يحتاج Redis عند تعدد النسخ) |
| HI-4 | **الأدوار غير مفروضة منهجيًا** | فحص الدور في `routes/workspaces.ts:27` فقط؛ صفر أعضاء غير مالك حيًّا؛ لا مسح آلي |
| HI-5 | **‏15 عاملًا بلا دليل تشغيل ولا مراقبة** | `app-workers.ts` بلا اختبار؛ لا metrics؛ لا مضيف خادم مُتحقَّق منه |
| HI-6 | **التوصيل نموذج بيانات فقط** | أعمدة + PATCH واحد؛ لا مزوّد/رسوم/تتبّع |
| HI-7 | **لا E2E ولا EAS للجوال** | CI يبني `expo export` فقط |

### متوسطة (Medium)

| # | الخطأ |
|---|---|
| MD-1 | ~~`sharp(..., { limitInputPixels: 100_000_000 })`~~ — **مُعالَج**: صار `MAX_MEDIA_INPUT_PIXELS = 25_000_000` (≈5000×5000) في الموضعين، مع تعليل أن هدف المصغّرة 640px |
| MD-2 | ~~لا معالج 404 JSON لمسارات `/api` المجهولة~~ — **مُعالَج**: `src/lib/api-not-found.ts` (‏`ROUTE_NOT_FOUND` + المسار الأصلي + `requestId`) مع 5 اختبارات |
| MD-3 | `/compose` بلا فحص ربط مؤهل → فشل نشر مؤكد لتاجر بلا حسابات (كُشف بعد إلغاء الجدار) |
| MD-4 | لا سجل تدقيق إداري (`audit_log` غير موجود) ولا إجراءات في لوحة المالك |
| MD-5 | لا قناة بريد (لا nodemailer/resend/sendgrid في الاعتماديات) — الدفع فقط |
| MD-6 | `vercel.json` يعيد كل شيء إلى `/` وقرار §3.1 غير محسوم |
| MD-7 | الصفحات القانونية بلا مراجعة قانونية ولا كيان/اتصال مُثبت |
| MD-8 | طوابير التأكيد (`meta-order-confirmation-queue`، `whatsapp-order-confirmation-queue`، `meta-order-messages`) ووحدات الحذف/التصدير/الجدولة بلا اختبارات |

### منخفضة (Low)

| # | الخطأ |
|---|---|
| LO-1 | 9 ثغرات اعتماديات مفتوحة على `main` (‏`sharp`، `proxy-addr` بانتظار مجموعة production) |
| LO-2 | `MenaFlow_Full_Technical_Audit.md` في الجذر (2026-10-18) و`docs/PROJECT_AUDIT_REPORT.md` (2026-11-08) قديمان |
| LO-3 | `app.json` في الجذر `{"expo":{}}` بلا فائدة ظاهرة |
| LO-4 | `mockup-sandbox` داخل `artifacts/` بلا دور موثَّق |
| LO-5 | PR #44 (طلب إرجاع) وPR #62 (58 تحديث تطوير) مفتوحان بلا حسم |

---

## 8. خريطة الاعتماديات (ما يحجب ما)

```
CR-1 دورة الفوترة  ← تحتاج: مزوّد دفع + webhook + عامل تجديد + واجهة ترقية
        └─ يحجب: L3، ويُبقي L1/L2 بلا معنى تجاري

CR-2/CR-3/E4 العزل والعقد ← تحتاج: اختبارات HTTP منهجية (مسار × مساحة أجنبية)
        └─ تحجب: أي توسعة للأدوار (E2/HI-4) وأي دعوة أعضاء (E3)

HI-1 التكاملات الحية ← تحتاج: .env بمفاتيح حقيقية + مضيف عام للخادم (ويبهوك)
        └─ تحجب: F1–F6، G1–G5، H1–H3، I2، K1–K3
             └─ K4 التوصيل يحجبه قرار منتج (يدوي/مزوّد)

G1 العمال ← يحتاج: إعادة نشر الخادم (Render) + مراقبة (O5)
        └─ تحجب: G2 الجدولة، G3 الحذف، G4 الاحتفاظ، F6 الدفع

O5 المراقبة ← تحجب إثبات أي شيء في الإنتاج (بما فيه HI-5)
E3 الدعوات ← تحجب اختبار الأدوار الحقيقي (HI-4) و§4.9/7ب
```

**الترتيب الأمثل للعمل (مقترح للتصديق):** 1) اختبارات HTTP للعزل + إدخال المسارات في العقد (CR-2/CR-3/E4) → 2) `trust proxy` + مخزن حدود + سقف `sharp` (HI-3/MD-1) → 3) إعادة نشر الخادم + مراقبة نبض العمال (G1/O5) → 4) بيئة مفاتيح حقيقية واختبار تكامل حيّ واحد لكل منصة (HI-1) → 5) دورة الفوترة (CR-1) → 6) الأدوار والدعوات وسجل الإدارة (E2/E3/M2).

---

## 9. المخاطر الأمنية

| # | الخطر | الحالة | الدليل/التفاصيل |
|---|---|---|---|
| S-1 | تسريب بين المستأجرين | **مرتفع** | طبقة عزل واحدة (CR-2)؛ helpers مُختبَرة، و**كل الـ99 تسجيل مسار صارت ممسوحة آليًا** في CI ‏(2026-11-23) — بقي غياب اختبارات HTTP السلوكية |
| S-2 | سرقة/تسريب رموز Meta | منخفض بعد الإصلاح | تشفير + دوران `ENCRYPTION_KEY_PREVIOUS`؛ المفتاح الثابت القديم **حُذف** (تحقّقت)؛ التصدير يُقنّع الاتصالات |
| S-3 | تجاوز المصادقة في الإنتاج | منخفض | 11 اختبارًا منها «إعداد الإنتاج يرفض التجاوز المحلي» و«يتطلب مفتاحي Clerk» |
| S-4 | تزوير ويبهوك | منخفض | تحقق `x-hub-signature-256` + جسم خام 1MB؛ ويبهوك Evolution بسرّ منفصل (`WHATSAPP_EVOLUTION_WEBHOOK_SECRET`) |
| S-5 | إغراق/إساءة استخدام | **متوسط** | حدود المعدل في الذاكرة + `trust proxy` غير مضبوط (HI-3)؛ حدود ساعية للردود الآلية موجودة لكن غير مُقاسة حيًّا |
| S-6 | قنبلة صورة (فك ضغط) | **متوسط** | `limitInputPixels: 100_000_000` (MD-1) |
| S-7 | لوحة المالك | منخفض | توكن + محدِّد معدّل + `noindex`/`no-store` + قراءة فقط؛ لكن بلا سجل تدقيق (MD-4) |
| S-8 | صلاحيات Meta واسعة | منخفض | النطاقات مقتصرة على النشر/الصفحات/البريد؛ ‏`instagram_content_publish` مطلوب فعلًا |
| S-9 | اعتماديات بثغرات | **متوسط** | 9 تنبيهات على `main`؛ ‏`sharp` و`proxy-addr` بانتظار مجموعة production |
| S-10 | حذف البيانات (GDPR-ish) | متوسط | عامل الحذف + مهلة 30 يومًا + تصدير JSON منفَّذ ومُختبَر جزئيًا (G3)، لكنه **غير مُجرَّب حيًّا** |
| S-11 | الوصول المباشر للقاعدة | منخفض | لا صلاحيات لـ`anon`/`authenticated` إطلاقًا (تحقّقت حيًّا) |

---

## 10. الوظائف التي تحتاج اختبارًا حقيقيًا (لا يمكن إثباتها ساكنًا)

| الوظيفة | ما يلزم بالضبط |
|---|---|
| F1/F2 النشر على Meta | `FACEBOOK_APP_ID/SECRET` + صفحة/حساب إنستغرام اختباري + مضيف عام لـ`MENA_FACEBOOK_REDIRECT_URI` |
| F3 ويبهوك Meta | `MENA_META_WEBHOOK_VERIFY_TOKEN` + HTTPS عام + اشتراك فعلي في الحقول |
| F4 مزامنة WhatsApp | `WHATSAPP_EVOLUTION_BASE_URL/API_KEY` + رقم اختبار + ويبوك عام؛ ثم استيراد رسائل حقيقية وفحص الوسائط في التخزين |
| F5 الذكاء الاصطناعي | `GEMINI_API_KEY` أو `OPENAI_API_KEY` + فحص القياس والحدود على اشتراك تجريبي |
| F6 إشعارات الدفع | `EXPO_PUSH_ACCESS_TOKEN` + جهاز/بناء EAS فعلي (لا يكفي `expo export`) |
| G1–G5 العمال | مضيف خادم يعمل بـ`MENA_WORKER_NAME=all` + مراقبة نبض؛ ومراقبة 15 عاملًا لدورة كاملة |
| G2 النشر المجدول | منشور مجدول حقيقي + توقيت منطقة زمنية مختلفة + انتظار العامل (15 ثانية) |
| G3 الحذف/التصدير | مساحة تجريبية ببيانات (منشورات/منتجات/طلبات/وسائط) + تنفيذ الحذف بعد تقصير المهلة + فحص دلو التخزين |
| D1 رحلة Clerk | مفاتيح Clerk حقيقية + تسجيل/تأكيد بريد/استعادة كلمة مرور |
| A2 الويب المنشور | `EXPO_PUBLIC_DOMAIN` يشير إلى مضيف API حيّ + فتح الموقع وفحص رحلة كاملة |
| A3 لوحة المالك | `MENA_OWNER_CONSOLE_TOKEN` + بناء `owner-console` + فتح `/owner` |
| H1–H3 الردود الآلية | رسائل واردة حقيقية + فحص الحدود الساعية ومنع التتابع |
| K1–K3 الطلبات | محادثة طلب حقيقية من Meta وWhatsApp + تأكيد وإشعار |
| L3 الفوترة | لا شيء يُختبر — **غير منفَّذ أصلًا** |
| E2/E3 الأدوار والدعوات | عضو ثانٍ حقيقي بدور غير المالك (يتطلب E3 أولًا) |

---

## 11. ما لم أتحقق منه (صراحةً)

1. لم أشغّل خادم API حيًّا (لا `.env`، والقيود تمنع تغيير إعدادات الإنتاج).
2. لم أنفّذ أي عملية نشر فعلية على Meta أو WhatsApp أو Expo Push.
3. لم أتحقق من وجود/صحة مضيف الخادم في الإنتاج (Render مذكور في الوثائق، ولا موصل له هنا).
4. لم أبنِ EAS ولم أفحص التطبيق على جهاز حقيقي.
5. لم أقيس الأداء (زمن استجابة، حجم استعلامات، فهارس تحت حمل).
6. لم أحسب نسبة تغطية الأسطر (لا `coverage` في CI) — الأرقام هنا **عدد ملفات/كتل اختبار** لا تغطية.
7. لم أعد التحقق من ادعاء تدقيق 2026-10-18 بأن التقارير تُحتسب من حالات داخلية (سجّلته كما هو في I4).
8. لم أفحص `MENA_OWNER_CONSOLE_TOKEN` أو أي سرّ — القيم في Vercel مُعتَّمة ولم أطلب فكّ أيٍّ منها.
9. لم أختبر سلوك المتصفح/الويب المنشور (حماية SSO على المعاينات).
10. لم أُجرِ اختبار اختراق؛ المخاطر الأمنية أعلاه استنتاج من مراجعة كود وإعدادات.

---

## 12. ماذا تغيّر منذ التقارير السابقة (مُتحقَّق)

| الملاحظة القديمة | الحالة الآن |
|---|---|
| مفتاح قديم ثابت لفك تشفير رموز Meta (2026-10-18) | **أُصلحت** — `ENCRYPTION_KEY_PREVIOUS` من البيئة فقط |
| مسار `quick-connect` يكتب ربطًا وهميًا (2026-10-18) | **أُصلحت** — لا وجود للمسار |
| `instagram_content_publish` غير مطلوب (2026-10-18) | **أُصلحت** — ضمن النطاقات (`meta-oauth.ts:66`) |
| لا جدولة زمنية ولا عامل لها (2026-10-18) | **نُفِّذت** (PR #67) — `scheduling.ts`/`scheduled-posts.ts` + ترحيل حيّ + عامل 15 ثانية |
| صفر قنوات إشعار (2026-10-18) | **نُفِّذت المرحلة 1** (Expo Push) — جدولا رموز/صندوق + عاملان؛ البريد مؤجَّل بقرار |
| طلبات الحذف تُسجَّل ولا تُعالَج (§3.4) | **نُفِّذت** (PR #68) — عامل حذف + تصدير JSON + أعمدة حيّة |
| لا lint ولا بوابات انحراف (§4.3/§4.5) | **نُفِّذت** — 7 بوابات CI |
| شريط التبويبات يُخفى والجدار يحبس التاجر | **أُصلحت اليوم** (PR #74 وPR #75) — الشريط ظاهر دائمًا، والمرحلة الثانية من الحارس لم تعد تحوّل |
| Dependabot لا يُتابع (§5.7) | **جزئيًا** — إعداد بمجموعات + تصفية الطابور؛ 9 ثغرات ما زالت مفتوحة |

---

## 13. ما نُفِّذ بعد التدقيق — المرحلة 1 (2026-11-23)

أربعة إجراءات من §8 (الأول والثالث) نُفِّذت على الفرع نفسه، بلا أي تغيير وظيفي في المنتج:

| الإجراء | الملفات | الاختبارات |
|---|---|---|
| **حارس ساكن يفرض `requireWorkspace`** على كل مسار، بقائمة استثناءات موثَّقة (19 مدخلًا، لكلٍّ سببها: مسابر الصحة، ويبهوك موقَّع، توكن المالك، كتالوج عام، روابط وسائط موقَّعة، رموز دفع مرتبطة بالمستخدم، قائمة المساحات) — ويفشل في ثلاثة اتجاهات: مسار غير محروس، استثناء قديم، **وماسحٌ كفّ عن التعرف على شكل تسجيل المسار** (الماسح نفسه مُختبَر بأربع حالات مزروعة) | `src/routes/route-guards.test.mjs` | 11 |
| **`trust proxy`** بحدّ أقصى 5 قفزات ورفض `true` غير المحدود، مع قيمة افتراضية منقسمة (1 في الإنتاج، `false` خارجه) | `src/lib/trust-proxy.ts` + `src/app.ts` + `.env.example` | 5 |
| **‏404 بصيغة JSON** لمسارات `/api` المجهولة (‏`ROUTE_NOT_FOUND` + `method` + المسار الأصلي + `requestId`) | `src/lib/api-not-found.ts` + `src/app.ts` | 5 |
| **سقف فك ضغط الوسائط** خُفض من 100 إلى 25 مليون بكسل | `src/lib/whatsapp-media-storage.ts` | — (ثابت موثَّق) |

**نتيجة جانبية مهمة:** المسح الذي بُني عليه الحارس فحص **99 تسجيل مسار** في 34 ملفًا (‏48 GET و37 POST و6 PUT و4 DELETE و4 PATCH)، وأثبت أن **كل المسارات الـ19 غير المحكومة بـ`requireWorkspace` محميّة بديلًا موثَّقًا فعلًا** — أي أن التدقيق **لم يجد ثغرة عزل قائمة**، بل أضاف قفلًا يمنع نشوء واحدة. وتفصيل القياس:

- **39 جدولًا من 42** تحمل عمود `workspaceId` (المستثنَيات الثلاثة: `workspaces` جذر المستأجر نفسه، وجدول الرموز المرتبط بالمستخدم لا بالمساحة، ومثال داخل تعليق) — والقائمة **تُشتق من `lib/db/src/schema` تلقائيًا** فلا تصير قديمة عند إضافة جدول.
- **70 مسارًا** تلمس جداول مستأجر: **63** تمرّ عبر `requireWorkspace`، و**7** معفاة بحماية آلة/توقيع/مستخدم موثَّقة.
- المساران المعفيّان الوحيدان اللذان **يكتبان** في جداول مستأجر هما ويبهوك Meta (توقيع `x-hub-signature-256`) ومردود OAuth (حالة مُجزأة أحادية الاستخدام ومنتهية الصلاحية، والمساحة تُؤخذ من سجل الحالة) — وأي كاتبٍ جديد يظهر في هذه الخانة يفشل فورًا.

**ما كشفه اختبار الطفرات (mutation test) على الحارس نفسه:** النسخة الأولى من الماسح كانت أضعف مما بدت — تعرَّفت فقط على المتغيّرين `router` و`app`، وتجاهلت الفاصلة الأخيرة التي يضيفها Prettier في التسجيلات متعددة الأسطر، فكانت ترى **54 مسارًا من 99** وتُعلن «كل شيء محروس» فوق قائمة ناقصة. زرعُ مخالفة حقيقية في ملف مؤقت (`ordersCanaryRouter.post(...)` يكتب في `menaOrders` بلا وسيط) أثبت أن الحارس **لا يفشل** كما يجب؛ أُعيد بناء الماسح (أي اسم متغيّر، أي نمط اقتباس، مسارات بقوالب نصّية، `join` و`update` كوصول للجدول، واشتقاق الجداول من المخطط) وصار الملف المزروع يُسقط **ثلاثة** تأكيدات مع اسم الملف ورقم السطر. هذه هي القيمة العملية لاختبار الحارس نفسه: **حارسٌ لا يمكن أن يفشل ليس حارسًا**.

**مجموعة الاختبارات: 528 → 543 → 549** (كلها خضراء) + lint + typecheck (libs وكل artifacts وscripts) + بناء api-server.

**المتبقي من المرحلة 1:** مصفوفة اختبارات HTTP (مسار سعيد + وصول لمساحة أجنبية) لكل مجموعة مسارات — تصطدم بواقع معماري: `lib/db/src/index.ts` يرمي إن لم يكن `DATABASE_URL` يشير إلى Supabase، و`src/app.ts` يستورد `./routes` كدليل وهو ما يرفضه محمّل Node الاختباري (`ERR_UNSUPPORTED_DIR_IMPORT`) — فتركيب الخادم الحقيقي في اختبار يتطلب إما قاعدة حقيقية أو تزييف وحدات (`--experimental-test-module-mocks`). القرار المطلوب: قاعدة اختبار حقيقية (Supabase branch أو Postgres محلي في CI) مقابل تزييف الوحدات.

---

**نهاية التقرير التفصيلي.** الملخص التنفيذي في `docs/audit/AUDIT_SUMMARY.md`.
