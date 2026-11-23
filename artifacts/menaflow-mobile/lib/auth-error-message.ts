const clerkErrorMessages: Record<string, string> = {
  form_password_incorrect: 'كلمة المرور غير صحيحة. تحقق منها ثم حاول مرة أخرى.',
  form_identifier_not_found: 'لم نعثر على حساب بهذا البريد الإلكتروني. تحقق من البريد أو أنشئ حساباً جديداً.',
  form_identifier_exists: 'البريد الإلكتروني أو اسم المستخدم مستخدم بالفعل. جرّب اسم مستخدم آخر، أو سجّل الدخول إذا كان البريد مرتبطاً بحسابك.',
  form_identifier_exists__email_address: 'هذا البريد الإلكتروني مرتبط بحساب بالفعل. جرّب تسجيل الدخول.',
  form_identifier_exists__username: 'اسم المستخدم مستخدم بالفعل. اختر اسماً آخر.',
  form_identifier_exists__phone_number: 'رقم الهاتف مرتبط بحساب بالفعل. جرّب تسجيل الدخول.',
  form_email_address_exists: 'هذا البريد الإلكتروني مرتبط بحساب بالفعل. جرّب تسجيل الدخول.',
  form_identifier_invalid: 'تحقق من البريد الإلكتروني أو رقم الهاتف ثم حاول مجدداً.',
  form_code_incorrect: 'رمز التحقق غير صحيح. راجعه ثم حاول مرة أخرى.',
  form_code_expired: 'انتهت صلاحية رمز التحقق. اطلب رمزاً جديداً.',
  form_password_validation_failed: 'كلمة المرور لا تستوفي متطلبات الأمان. اختر كلمة مرور أخرى.',
  verification_expired: 'انتهت صلاحية رمز التحقق. اطلب رمزاً جديداً.',
  verification_attempt_exceeded: 'تجاوزت عدد محاولات التحقق. اطلب رمزاً جديداً وحاول لاحقاً.',
  form_password_length_too_short: 'كلمة المرور قصيرة جداً. استخدم كلمة مرور أطول.',
  form_password_pwned: 'كلمة المرور هذه غير آمنة. اختر كلمة مرور مختلفة.',
  form_password_not_strong_enough: 'كلمة المرور ضعيفة. اختر كلمة مرور أقوى.',
  form_password_size_in_bytes_exceeded: 'كلمة المرور طويلة جداً. استخدم كلمة مرور أقصر.',
  form_param_format_invalid: 'تحقق من تنسيق البريد الإلكتروني وأعد المحاولة.',
  form_email_address_invalid: 'عنوان البريد الإلكتروني غير صالح. أدخل بريداً إلكترونياً صحيحاً.',
  form_phone_number_invalid: 'رقم الهاتف غير صالح. أدخل رقمًا صحيحًا مع مفتاح الدولة.',
  form_username_exists: 'اسم المستخدم مستخدم بالفعل. اختر اسماً آخر.',
  form_username_invalid_character: 'اسم المستخدم يحتوي على رموز غير مسموح بها.',
  too_many_requests: 'حاولت عدة مرات خلال وقت قصير. انتظر قليلاً ثم حاول مجدداً.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getAuthErrorMessage(error: unknown, fallback: string): string {
  const errors = isRecord(error) && Array.isArray(error.errors) ? error.errors : [error];

  for (const item of errors) {
    if (!isRecord(item) || typeof item.code !== 'string') continue;
    if (item.code === 'form_identifier_exists' && isRecord(item.meta)) {
      // Clerk returns the field as meta.paramName; raw API errors may use
      // param_name. Do not assume a duplicate identifier is always an email.
      const field = item.meta.paramName ?? item.meta.param_name;
      if (field === 'username') return clerkErrorMessages.form_identifier_exists__username;
      if (field === 'email_address' || field === 'emailAddress') return clerkErrorMessages.form_identifier_exists__email_address;
      if (field === 'phone_number' || field === 'phoneNumber') return clerkErrorMessages.form_identifier_exists__phone_number;
    }
    const message = clerkErrorMessages[item.code];
    if (message) return message;
  }

  if (error instanceof Error && /network|fetch|offline|internet|timeout/i.test(error.message)) {
    return 'تعذر الاتصال بالخدمة. تحقق من اتصالك بالإنترنت ثم حاول مرة أخرى.';
  }

  return fallback;
}
