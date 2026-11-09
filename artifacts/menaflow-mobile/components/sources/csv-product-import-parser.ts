import type { ProductInput } from "../../lib/product-catalog-api";

export type ImportRow = {
  rowNumber: number;
  product: ProductInput;
  error?: string;
};

const MAX_PRODUCTS = 200;

function parseRecords(content: string): string[][] {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  let commas = 0;
  let semicolons = 0;
  let inFirstLineQuotes = false;
  for (let index = 0; index < firstLine.length; index += 1) {
    const character = firstLine[index];
    if (character === '"') {
      if (inFirstLineQuotes && firstLine[index + 1] === '"') {
        index += 1;
      } else {
        inFirstLineQuotes = !inFirstLineQuotes;
      }
    } else if (!inFirstLineQuotes && character === ",") {
      commas += 1;
    } else if (!inFirstLineQuotes && character === ";") {
      semicolons += 1;
    }
  }
  const delimiter = semicolons > commas ? ";" : ",";
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (inQuotes) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
        afterQuote = true;
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote) {
      if (character === delimiter) {
        record.push(field);
        field = "";
        afterQuote = false;
      } else if (character === "\n" || character === "\r") {
        record.push(field);
        records.push(record);
        record = [];
        field = "";
        afterQuote = false;
        if (character === "\r" && content[index + 1] === "\n") index += 1;
      } else if (character.trim()) {
        throw new Error("تنسيق CSV غير صالح: يوجد نص بعد علامة الاقتباس.");
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) {
        throw new Error("تنسيق CSV غير صالح: علامة اقتباس في موضع غير متوقع.");
      }
      inQuotes = true;
    } else if (character === delimiter) {
      record.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      if (character === "\r" && content[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error("تنسيق CSV غير صالح: يوجد حقل غير مكتمل.");
  if (field || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records.filter((row) => row.some((value) => value.trim()));
}

function normalizedHeader(value: string): string {
  const header = value.trim().replace(/^\uFEFF/, "").toLowerCase();
  const aliases: Record<string, string> = {
    sku: "sku",
    "رمز المنتج": "sku",
    "رقم المنتج": "sku",
    name: "name",
    "اسم المنتج": "name",
    الاسم: "name",
    description: "description",
    الوصف: "description",
    price: "price",
    السعر: "price",
    currency: "currency",
    العملة: "currency",
    availability: "availability",
    التوفر: "availability",
    aliases: "aliases",
    "الأسماء البديلة": "aliases",
  };
  return aliases[header] ?? header;
}

function parseAvailability(value: string): ProductInput["availability"] | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "غير محدد") {
    return "unknown";
  }
  if (normalized === "in_stock" || normalized === "متوفر") return "in_stock";
  if (
    normalized === "out_of_stock" ||
    normalized === "غير متوفر" ||
    normalized === "نفد"
  ) {
    return "out_of_stock";
  }
  if (
    normalized === "preorder" ||
    normalized === "طلب مسبق" ||
    normalized === "متاح للطلب المسبق"
  ) {
    return "preorder";
  }
  return null;
}

export function parseProductRows(content: string): ImportRow[] {
  const records = parseRecords(content);
  const headers = records[0]?.map(normalizedHeader);
  if (!headers?.includes("name")) {
    throw new Error("يجب أن يحتوي الصف الأول على عمود name أو اسم المنتج.");
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error("توجد أعمدة مكررة في الصف الأول من الملف.");
  }
  if (records.length < 2) {
    throw new Error("لا يحتوي الملف على صفوف منتجات.");
  }
  if (records.length - 1 > MAX_PRODUCTS) {
    throw new Error(`الحد الأقصى للاستيراد هو ${MAX_PRODUCTS} منتجًا في الملف.`);
  }

  const rows: ImportRow[] = records.slice(1).map((cells, index) => {
    const values = Object.fromEntries(
      headers.map((header, cellIndex) => [header, cells[cellIndex]?.trim() ?? ""]),
    );
    const name = values.name ?? "";
    const sku = values.sku || null;
    const price = values.price || null;
    const currency = values.currency?.toUpperCase() || null;
    const availability = parseAvailability(values.availability ?? "");
    let error: string | undefined;
    if (!name) {
      error = "اسم المنتج مطلوب.";
    } else if (name.length > 200) {
      error = "اسم المنتج أطول من الحد المسموح.";
    } else if (sku && sku.length > 100) {
      error = "رمز المنتج أطول من الحد المسموح.";
    } else if (cells.length > headers.length) {
      error = "عدد الخانات في الصف أكبر من عدد الأعمدة.";
    } else if (values.description && values.description.length > 3000) {
      error = "الوصف أطول من الحد المسموح.";
    } else if (
      (values.aliases ?? "")
        .split(/[|؛;]/)
        .filter((alias) => alias.trim()).length > 20
    ) {
      error = "لا يمكن إضافة أكثر من 20 اسمًا بديلًا.";
    } else if (
      (values.aliases ?? "")
        .split(/[|؛;]/)
        .some((alias) => alias.trim().length > 80)
    ) {
      error = "يجب ألا يتجاوز الاسم البديل 80 حرفًا.";
    } else if (
      price &&
      (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(price) || !currency)
    ) {
      error = "السعر يجب أن يكون رقمًا صالحًا، مع تحديد العملة.";
    } else if (currency && !/^[A-Z]{3}$/.test(currency)) {
      error = "العملة يجب أن تكون رمزًا من 3 أحرف مثل SAR أو USD.";
    } else if (!availability) {
      error = "قيمة التوفر غير معروفة.";
    }

    return {
      rowNumber: index + 2,
      product: {
        sku,
        name,
        aliases: (values.aliases ?? "")
          .split(/[|؛;]/)
          .map((alias) => alias.trim())
          .filter(Boolean),
        description: values.description ?? "",
        price,
        currency,
        availability: availability ?? "unknown",
        status: "draft",
        mediaUrls: [],
      },
      error,
    };
  });

  const seenSkus = new Set<string>();
  for (const row of rows) {
    const sku = row.product.sku;
    if (!sku || row.error) continue;
    if (seenSkus.has(sku)) row.error = "رمز المنتج مكرر في الملف.";
    else seenSkus.add(sku);
  }
  return rows;
}
