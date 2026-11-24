/**
 * The dashboard hero: what the merchant is told to do next, and the one button that
 * does it.
 *
 * This was a nine-branch `let` chain in the middle of a 1,839-line screen, where
 * the order of the branches *is* the product decision — "a Meta account lost its
 * authorisation" outranks "WhatsApp is mid-handshake", which outranks "you have no
 * posts yet". None of that ordering was testable, and a branch added in the wrong
 * place silently changes what every merchant sees on their home screen.
 *
 * The function returns words and an *action descriptor*, never a handler: the screen
 * owns navigation and query refetching, and a pure module that closed over them
 * could not be tested in plain Node.
 *
 * Pure and free of React Native on purpose, in the style of
 * `lib/onboarding-guard.ts`.
 */

/** What the primary button does; the screen maps it onto a handler. */
export type HeroAction =
  | "create-content"
  | "retry-connections"
  | "reauthorize-meta"
  | "manage-whatsapp"
  | "reconnect-whatsapp"
  | "link-account"
  | "open-post-queue";

/** Icon names, kept narrow so this module needs no component import. */
export type HeroIcon = "plus" | "refresh-cw" | "link-2" | "settings" | "file-text";

export type HeroButton = {
  label: string;
  icon: HeroIcon;
  action: HeroAction;
  /** Set for `reauthorize-meta`: which platform lost its authorisation. */
  platform?: "facebook" | "instagram";
  /** Set for `open-post-queue`: which slice of the post list to open. */
  postStatus?: string;
  disabled: boolean;
};

export type HomeHeroInput = {
  /** The connections query has not answered for the first time. */
  connectionsLoading: boolean;
  /** It answered before and is now failing. */
  connectionsUnavailable: boolean;
  /** A hero retry is already in flight. */
  retryingConnections: boolean;
  /** Any connections fetch is in flight. */
  connectionsFetching: boolean;
  accountNeedingReauthorization: {
    platform: "facebook" | "instagram";
    name: string;
  } | null;
  whatsappConnecting: boolean;
  whatsappUnavailable: boolean;
  whatsappNeedsReconnection: boolean;
  hasAnyConnection: boolean;
  /** The post store has loaded this workspace's cache and synced. */
  postsReady: boolean;
  postCount: number;
  /** From `pickPendingPost`: the post worth pointing at, if any. */
  pendingPostStatus: string | null;
};

export type HomeHero = {
  eyebrow: string;
  title: string;
  body: string;
  primary: HeroButton;
};

const CREATE_CONTENT: HeroButton = {
  label: "إنشاء محتوى",
  icon: "plus",
  action: "create-content",
  disabled: false,
};

export function homeHero(input: HomeHeroInput): HomeHero {
  // 1. Nothing is known yet. The default button stays: creating content does not
  //    depend on a connection being verified, and a disabled button here would read
  //    as "you may not publish" rather than "we are still checking".
  if (input.connectionsLoading) {
    return {
      eyebrow: "جارٍ التحقق",
      title: "نجهز مساحة عملك",
      body: "نتحقق من حالة حساباتك.",
      primary: CREATE_CONTENT,
    };
  }

  // 2. The check failed. Everything below depends on its answer, so retrying
  //    outranks every suggestion the hero could otherwise make.
  if (input.connectionsUnavailable) {
    return {
      eyebrow: "حالة الحسابات",
      title: "تعذر التحقق",
      body: "تحقق من الإنترنت ثم أعد المحاولة.",
      primary: {
        label: input.retryingConnections ? "جارٍ التحقق…" : "إعادة المحاولة",
        icon: "refresh-cw",
        action: "retry-connections",
        disabled: input.retryingConnections || input.connectionsFetching,
      },
    };
  }

  // 3. A linked account lost its authorisation: publishing to it is already broken,
  //    which outranks connecting something new or writing a post.
  if (input.accountNeedingReauthorization) {
    const { platform, name } = input.accountNeedingReauthorization;
    return {
      eyebrow: "إجراء مطلوب",
      title: `أعد تفويض حساب ${name}`,
      body: "أعد التفويض لاستعادة النشر والتحقق من صلاحيات الحساب.",
      primary: {
        label: "إعادة التفويض",
        icon: "refresh-cw",
        action: "reauthorize-meta",
        platform,
        disabled: false,
      },
    };
  }

  // 4. WhatsApp is mid-handshake: the only useful action is to go and look at it.
  if (input.whatsappConnecting) {
    return {
      eyebrow: "جارٍ الاتصال",
      title: "واتساب قيد الاتصال",
      body: "جارٍ استعادة الاتصال بواتساب.",
      primary: {
        label: "متابعة إعداد واتساب",
        icon: "link-2",
        action: "manage-whatsapp",
        disabled: false,
      },
    };
  }

  // 5. WhatsApp is saved but not working. "Unavailable" (the provider's instance
  //    cannot be reached) is a different problem from "needs reconnecting" (the
  //    session is gone), and gets different words and a different destination.
  if (input.whatsappUnavailable || input.whatsappNeedsReconnection) {
    const unavailable = input.whatsappUnavailable;
    return {
      eyebrow: unavailable ? "واتساب غير متاح" : "إجراء مطلوب",
      title: unavailable
        ? "تعذر الوصول إلى خدمة واتساب"
        : "أعد اتصال واتساب",
      body: unavailable
        ? "تحقق من إعدادات واتساب."
        : "أعد اتصال واتساب لمتابعة النشر.",
      primary: {
        label: unavailable ? "إدارة واتساب" : "إعادة الاتصال",
        icon: unavailable ? "settings" : "refresh-cw",
        action: unavailable ? "manage-whatsapp" : "reconnect-whatsapp",
        disabled: false,
      },
    };
  }

  // 6. Nothing is linked at all: this is the merchant's first real step.
  if (!input.hasAnyConnection) {
    return {
      eyebrow: "ابدأ من هنا",
      title: "اربط حسابًا للنشر",
      body: "اربط حسابًا لتبدأ النشر من لوحة التحكم.",
      primary: {
        label: "ربط حساب",
        icon: "link-2",
        action: "link-account",
        disabled: false,
      },
    };
  }

  // 7. Accounts are fine but the post list has not loaded. Claiming "you have no
  //    posts" here would be a statement about data the app has not seen yet.
  if (!input.postsReady) {
    return {
      eyebrow: "حساباتك متصلة",
      title: "جارٍ تحميل محتواك",
      body: "نحمّل بيانات مساحة العمل.",
      primary: CREATE_CONTENT,
    };
  }

  // 8. Ready and empty: the first post is the next step.
  if (input.postCount === 0) {
    return {
      eyebrow: "حساباتك جاهزة",
      title: "أنشئ أول منشور",
      body: "ابدأ بكتابة محتواك الأول.",
      primary: {
        label: "إنشاء أول منشور",
        icon: "plus",
        action: "create-content",
        disabled: false,
      },
    };
  }

  // 9. Something is waiting on them: a failure first, then a review, then a draft.
  if (input.pendingPostStatus) {
    const status = input.pendingPostStatus;
    const failed = status === "failed";
    const review = status === "review";
    return {
      eyebrow: "متابعة المحتوى",
      title: failed
        ? "منشور تعذّر نشره"
        : review
          ? "منشور بانتظار المراجعة"
          : "لديك مسودة للمتابعة",
      body: failed
        ? "راجع تفاصيل المنشور لمعرفة سبب تعذر النشر."
        : review
          ? "أكمل مراجعة المنشور قبل نشره."
          : "تابع تحرير المسودة.",
      primary: {
        label: failed
          ? "مراجعة المنشور"
          : review
            ? "مراجعة المنشورات"
            : "متابعة المسودات",
        icon: "file-text",
        action: "open-post-queue",
        postStatus: status,
        disabled: false,
      },
    };
  }

  // 10. Everything is fine and nothing is waiting.
  return {
    eyebrow: "مساحة عملك",
    title: "حساباتك جاهزة للنشر",
    body: "حساباتك متصلة وجاهزة للنشر.",
    primary: CREATE_CONTENT,
  };
}
