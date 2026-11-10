import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { confirmDiscardChanges } from "@/components/Ui";
import {
  createExtractionProductDraft,
  createCatalogProduct,
  updateCatalogProduct,
  uploadProductMedia,
  type ImportedMetaPost,
  type CatalogProduct,
  type ProductInput,
  type ProductExtractionSuggestion,
} from "@/lib/product-catalog-api";
import { normalizeArabicDigits } from "@/lib/formatting";

export type ProductDraft = ProductInput;

export type EditorState = {
  id: string | null;
  value: ProductDraft;
  mediaPreviews: CatalogProduct["mediaPreviews"];
  importedFromPost?: boolean;
  extractionSuggestionId?: string;
  sourceContext?: string[];
  importedMetaPost?: ImportedMetaPost;
};

export const emptyDraft: ProductDraft = {
  sku: null,
  name: "",
  aliases: [],
  description: "",
  price: null,
  currency: null,
  availability: "unknown",
  status: "draft",
  mediaUrls: [],
  inventoryTracked: false,
  stockOnHand: 0,
  lowStockThreshold: 0,
  inventoryReason: "",
};

export function draftFromProduct(product: CatalogProduct): ProductDraft {
  return {
    sku: product.sku,
    name: product.name,
    aliases: product.aliases,
    description: product.description,
    price: normalizeProductPriceInput(product.price),
    currency: product.currency,
    availability: product.availability,
    status: product.status,
    mediaUrls: product.mediaUrls,
    inventoryTracked: product.inventoryTracked,
    stockOnHand: product.stockOnHand,
    lowStockThreshold: product.lowStockThreshold,
    inventoryReason: "",
  };
}

export function draftFromExtraction(
  suggestion: ProductExtractionSuggestion,
): ProductDraft {
  const { extractedData } = suggestion;
  const hasPriceAndCurrency = Boolean(
    extractedData.price && extractedData.currency,
  );
  return {
    sku: extractedData.sku,
    name: extractedData.name ?? "",
    aliases: extractedData.aliases,
    description: extractedData.description ?? "",
    price: hasPriceAndCurrency ? extractedData.price : null,
    currency: hasPriceAndCurrency ? extractedData.currency : null,
    availability: extractedData.availability ?? "unknown",
    status: "draft",
    mediaUrls: [],
  };
}

function normalizeProductPriceInput(price: string | null): string | null {
  if (price === null) return null;
  const normalizedPrice = normalizeArabicDigits(price).replace(/٬/g, "");
  const [integer, fraction] = normalizedPrice.split(".");
  const normalizedFraction = fraction?.replace(/0+$/, "");
  return normalizedFraction ? `${integer}.${normalizedFraction}` : integer;
}

export function useProductEditorWorkflow({
  catalogKey,
  refresh,
  setError,
}: {
  catalogKey: readonly unknown[];
  refresh: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorBaseline, setEditorBaseline] = useState<string | null>(null);
  const [mediaUploading, setMediaUploading] = useState(false);

  const editorSnapshot = (value: EditorState) =>
    JSON.stringify({ value: value.value, mediaPreviews: value.mediaPreviews });
  const openEditor = (value: EditorState) => {
    setEditorBaseline(editorSnapshot(value));
    setEditor(value);
  };
  const closeEditor = () => {
    setEditor(null);
    setEditorBaseline(null);
  };
  const save = useMutation({
    mutationFn: (state: EditorState) =>
      state.id
        ? updateCatalogProduct({ id: state.id, product: state.value })
        : state.extractionSuggestionId
          ? createExtractionProductDraft(
              state.extractionSuggestionId,
              state.value,
            )
          : createCatalogProduct(state.value, state.importedMetaPost),
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "تعذر حفظ المنتج."),
  });
  const requestEditorClose = () => {
    if (!editor || save.isPending || mediaUploading) return;
    if (editorBaseline === editorSnapshot(editor)) {
      closeEditor();
      return;
    }
    confirmDiscardChanges(closeEditor);
  };

  useEffect(() => {
    if (!editor) setError("");
  }, [editor, setError]);

  const updateDraft = (changes: Partial<ProductDraft>) => {
    setEditor((current) =>
      current
        ? { ...current, value: { ...current.value, ...changes } }
        : current,
    );
  };

  const removeProductMedia = (mediaId: string) => {
    setEditor((current) =>
      current
        ? {
            ...current,
            value: {
              ...current.value,
              mediaUrls: current.value.mediaUrls.filter(
                (url) => url !== mediaId,
              ),
            },
            mediaPreviews: current.mediaPreviews.filter(
              (media) => media.id !== mediaId,
            ),
          }
        : current,
    );
  };

  const addProductMedia = async () => {
    if (!editor || mediaUploading) return;
    setError("");
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsMultipleSelection: true,
        quality: 0.9,
      });
      if (selection.canceled) return;
      const availableSlots = 20 - editor.value.mediaUrls.length;
      if (availableSlots <= 0) {
        setError("يمكن إرفاق 20 وسيطًا كحد أقصى للمنتج.");
        return;
      }
      if (selection.assets.length > availableSlots) {
        setError(
          `يمكن إضافة ${availableSlots} وسيطًا إضافيًا فقط؛ الحد الأقصى 20.`,
        );
      }
      setMediaUploading(true);
      for (const asset of selection.assets.slice(0, availableSlots)) {
        if (asset.fileSize && asset.fileSize > 20 * 1024 * 1024) {
          setError("حجم كل ملف يجب ألا يتجاوز 20 ميغابايت.");
          continue;
        }
        if (!asset.mimeType) {
          setError("تعذّر تحديد نوع أحد الملفات المختارة.");
          continue;
        }
        const uploaded = await uploadProductMedia({
          uri: asset.uri,
          mimeType: asset.mimeType,
        });
        const mediaPreview = uploaded.mediaPreview;
        if (!mediaPreview) {
          throw new Error("تم رفع الوسيط لكن تعذّر إنشاء معاينته.");
        }
        setEditor((current) =>
          current
            ? {
                ...current,
                value: {
                  ...current.value,
                  mediaUrls: [...current.value.mediaUrls, uploaded.id],
                },
                mediaPreviews: [...current.mediaPreviews, mediaPreview],
              }
            : current,
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذّر رفع الوسائط المحددة.",
      );
    } finally {
      setMediaUploading(false);
    }
  };

  const saveProduct = async () => {
    if (!editor || save.isPending || mediaUploading) return;
    try {
      const savedProduct = await save.mutateAsync(editor);
      queryClient.setQueryData<CatalogProduct[]>(catalogKey, (current) =>
        current?.map((product) =>
          product.id === savedProduct.id ? savedProduct : product,
        ),
      );
      closeEditor();
      setError("");
      void refresh().catch((cause) =>
        setError(
          cause instanceof Error
            ? `تم الحفظ، لكن تعذر تحديث القائمة: ${cause.message}`
            : "تم الحفظ، لكن تعذر تحديث القائمة.",
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ المنتج.");
    }
  };

  return {
    editor,
    setEditor,
    save,
    mediaUploading,
    openEditor,
    closeEditor,
    requestEditorClose,
    updateDraft,
    removeProductMedia,
    addProductMedia,
    saveProduct,
  };
}
