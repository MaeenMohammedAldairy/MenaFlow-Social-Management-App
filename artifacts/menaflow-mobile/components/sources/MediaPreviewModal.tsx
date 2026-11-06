import React from "react";
import { Image, Modal, Pressable, StyleSheet } from "react-native";
import { mediaUrlForApp } from "@/lib/content-utils";

interface MediaPreviewModalProps {
  url: string | null;
  onClose: () => void;
}

export function MediaPreviewModal({ url, onClose }: MediaPreviewModalProps) {
  return (
    <Modal
      visible={url !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="إغلاق معاينة الصورة"
        onPress={onClose}
        style={styles.mediaPreviewOverlay}
      >
        {url ? (
          <Image
            source={{ uri: url ? mediaUrlForApp(url) : undefined }}
            style={styles.mediaPreviewFull}
            resizeMode="contain"
          />
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mediaPreviewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  mediaPreviewFull: {
    width: "100%",
    height: "100%",
  },
});
