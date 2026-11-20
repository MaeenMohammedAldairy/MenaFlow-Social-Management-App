/**
 * Ready-to-import CSV template for the product catalog.
 *
 * The BOM keeps Arabic headers readable in Excel, and the two sample rows show
 * the expected formats (quoted text, decimal price with a currency, Arabic
 * availability value, and pipe-separated aliases).
 */
export const PRODUCT_CSV_TEMPLATE = `\uFEFFالاسم,رمز المنتج,الوصف,السعر,العملة,التوفر,الأسماء البديلة
"عباية كلاسيكية سوداء",AB-001,"عباية قطنية بياقة كلاسيكية",149.00,SAR,متوفر,عباية|عباية سوداء
"حقيبة يد جلدية",BG-014,"حقيبة جلد صناعي بمساحة داخلية واسعة",89.50,SAR,غير متوفر,حقيبة|حقيبة جلد
`;

export const PRODUCT_CSV_TEMPLATE_FILENAME = "menaflow-products-template.csv";
