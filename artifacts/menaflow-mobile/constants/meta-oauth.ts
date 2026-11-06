export function metaOAuthErrorMessage(reason?: string, detail?: string): string {
  switch (reason) {
    case "no_manageable_page":
      return detail
        ? `لم تُرجع Meta أي صفحة Facebook قابلة للإدارة. ${detail}`
        : "لم تُرجع Meta أي صفحة Facebook يمكنك إدارتها. تأكد من اختيار الحساب الذي يملك وصولاً إلى الصفحة، ثم أعد الربط. لا يلزم وجود حساب Instagram.";
    case "missing_pages_permission":
      return detail
        ? `لم تُمنح صلاحية عرض صفحات Facebook. ${detail}`
        : "لم تُمنح صلاحية pages_show_list لعرض صفحات Facebook. أعد الربط ووافق على هذه الصلاحية.";
    case "authorization_denied":
      return detail
        ? `لم تكتمل موافقة Meta على الصلاحيات المطلوبة. ${detail}`
        : "لم تكتمل موافقة Meta على الصلاحيات المطلوبة. أعد الربط ووافق على جميع الصلاحيات.";
    case "instagram_account_required":
      return detail ||
        "لم نعثر على حساب Instagram احترافي مرتبط بصفحة Facebook المختارة. حوّل الحساب إلى Business أو Creator واربطه بصفحة Facebook ثم أعد المحاولة.";
    case "instagram_permissions_missing":
      return detail ||
        "لم تُمنح صلاحيات Instagram المطلوبة. أعد الربط ووافق على صلاحيات إدارة Instagram.";
    case "invalid_page_token":
    case "expired_page_token":
    case "meta_verify_page_token":
      return detail
        ? detail
        : "تعذّر التحقق من رمز صفحة Meta. أعد ربط الحساب.";
    case "expired_state":
      return "انتهت صلاحية جلسة الربط. ابدأ الربط من جديد.";
    case "subscription_limit":
      return detail || "بلغت الحد الأقصى لقنوات خطتك الحالية. تظهر خيارات الترقية قريبًا.";
    case "connection_failed":
      return "تعذّر إكمال الاتصال بخدمات Meta. حاول مرة أخرى، وإذا استمرت المشكلة فتحقق من إعدادات التطبيق وعنوان العودة.";
    case "meta_graph_unreachable":
      return "تعذّر على خادم MenaFlow الوصول إلى Meta. تحقق من اتصال الإنترنت أو جدار الحماية على جهاز الخادم، ثم أعد المحاولة.";
    case "meta_exchange_short_token":
    case "meta_exchange_long_token":
      return "رفضت Meta تبادل رمز الدخول. تحقق من تطابق معرّف التطبيق والمفتاح السري، ومن تطابق عنوان العودة مع إعدادات تطبيق Meta.";
    case "meta_credentials_missing":
      return "إعداد تطبيق Meta غير مكتمل على الخادم. اضبط معرّف التطبيق والمفتاح السري ثم أعد المحاولة.";
    case "meta_list_pages":
      return detail
        ? `رفضت Meta طلب جلب صفحات Facebook: ${detail}`
        : "تعذّر تحميل صفحات Facebook من Meta. تحقق من صلاحيات pages_show_list وحاول مرة أخرى.";
    case "meta_selected_page":
      return detail
        ? `تعذّر التحقق من الصفحة التي منحتها Meta: ${detail}`
        : "تعذّر التحقق من الصفحة التي اخترتها في Meta. راجع صلاحيات الوصول إلى الصفحة وحاول مرة أخرى.";
    case "meta_list_permissions":
      return detail
        ? `تعذّر التحقق من صلاحيات Facebook لدى Meta: ${detail}`
        : "تعذّر التحقق من صلاحية pages_show_list لدى Meta. أعد الربط وحاول مرة أخرى.";
    default:
      return reason
        ? `تعذّر إكمال ربط Meta (${reason}).${detail ? ` ${detail}` : ""}`
        : detail || "تعذّر إكمال ربط Meta.";
  }
}
