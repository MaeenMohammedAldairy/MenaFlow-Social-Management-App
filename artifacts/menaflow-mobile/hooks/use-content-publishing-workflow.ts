import { verifyFacebookPostStatus } from "@workspace/api-client-react";
import { useState } from "react";
import { showAppNotice } from "@/components/AppFeedback";
import { publishReasonLabel } from "@/lib/content-utils";
import type { Channel, Post, PostStatus } from "@/context/StudioContext";

export type MetaChannel = Extract<Channel, "facebook" | "instagram">;
export type PublishOutcome = "success" | "partial" | "uncertain" | "failed";
export type PublishChannelResult = {
  channel: MetaChannel;
  status: string;
  url?: string | null;
  reason?: string;
};

export function useContentPublishingWorkflow({
  autoPublish,
  autoPublishChannels,
  updatePostStatus,
  refreshPosts,
  publishPost,
}: {
  autoPublish: boolean;
  autoPublishChannels: Channel[];
  updatePostStatus: (id: string, status: PostStatus) => Promise<void>;
  refreshPosts: () => Promise<void>;
  publishPost: (
    id: string,
    channels?: Channel[],
    retryUncertain?: boolean,
  ) => Promise<{
    results: Record<
      string,
      {
        status: string;
        url?: string | null;
        reason?: string;
      }
    >;
    post: Pick<Post, "error">;
  }>;
}) {
  const [publishDialogPostId, setPublishDialogPostId] = useState<string | null>(
    null,
  );
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [publishOutcome, setPublishOutcome] = useState<PublishOutcome | null>(
    null,
  );
  const [publishChannelResults, setPublishChannelResults] = useState<
    PublishChannelResult[]
  >([]);
  const [selectedPublishChannels, setSelectedPublishChannels] = useState<
    MetaChannel[]
  >([]);
  const [retryChannels, setRetryChannels] = useState<MetaChannel[]>([]);
  const [retryConfirmationVisible, setRetryConfirmationVisible] =
    useState(false);
  const [verifyingPostId, setVerifyingPostId] = useState<string | null>(null);
  const [verificationFeedback, setVerificationFeedback] = useState<
    Record<string, string>
  >({});

  const onPublish = async (post: Post) => {
    setPublishMessage(null);
    setPublishOutcome(null);
    setPublishChannelResults([]);
    const channelResults = post.publishResults ?? {};
    const hasPriorSuccess = post.channels.some((channel) => {
      const result = channelResults[channel];
      return (
        result !== null &&
        typeof result === "object" &&
        "status" in result &&
        result.status === "published"
      );
    });
    const retryableChannels = hasPriorSuccess
      ? post.channels.filter((channel): channel is MetaChannel => {
          if (channel !== "facebook" && channel !== "instagram") return false;
          const result = channelResults[channel];
          return (
            !result ||
            typeof result !== "object" ||
            !("status" in result) ||
            result.status === "failed"
          );
        })
      : [];
    setSelectedPublishChannels(retryableChannels);
    setRetryChannels([]);
    setRetryConfirmationVisible(false);
    setPublishDialogPostId(post.id);
  };

  const togglePublishChannel = (channel: MetaChannel) => {
    setSelectedPublishChannels((current) =>
      current.includes(channel)
        ? current.filter((selected) => selected !== channel)
        : [...current, channel],
    );
  };

  const onApprove = async (post: Post) => {
    try {
      await updatePostStatus(post.id, "approved");
      await refreshPosts();
      showAppNotice({
        title: "تم اعتماد المنشور",
        message: autoPublish
          ? "تم اعتماد المنشور، وسيبدأ نشره على المنصات المختارة."
          : "حُفظ ضمن المنشورات المعتمدة، وسيُنشر عند تفعيل النشر التلقائي.",
        tone: "success",
      });
    } catch (error) {
      showAppNotice({
        title: "تعذر اعتماد المنشور",
        message:
          error instanceof Error
            ? error.message
            : "تحقق من النص والوسائط ثم أعد المحاولة.",
        tone: "error",
      });
    }
  };

  const onVerifyFacebookStatus = async (postId: string) => {
    setVerifyingPostId(postId);
    setVerificationFeedback((current) => ({ ...current, [postId]: "" }));
    try {
      const result = await verifyFacebookPostStatus(postId);
      await refreshPosts();
      const message =
        result.status === "found"
          ? "تأكدنا أن المنشور موجود على فيسبوك. تم تحديث حالته دون إعادة نشره."
          : result.status === "not-found"
            ? "لم يُعثر على المنشور في سجلات فيسبوك بعد فحص موجز الصفحة. لم تتم إعادة إرساله؛ يمكنك اختيار إعادة المحاولة يدويًا."
            : (publishReasonLabel(result.reason) ??
              "تعذّر التحقق من فيسبوك. لم تتم إعادة إرسال المنشور. تحقق من اتصال Meta وصلاحيات الصفحة ثم أعد الفحص.");
      setVerificationFeedback((current) => ({ ...current, [postId]: message }));
    } catch (error) {
      setVerificationFeedback((current) => ({
        ...current,
        [postId]:
          error instanceof Error
            ? publishReasonLabel(error.message) ??
              "تعذّر التحقق من حالة المنشور على فيسبوك."
            : "تعذّر التحقق من حالة المنشور على فيسبوك.",
      }));
    } finally {
      setVerifyingPostId(null);
    }
  };

  const publishAndShowResult = async (
    postId: string,
    channels: MetaChannel[],
    retryUncertain = false,
  ) => {
    setPublishing(true);
    setPublishMessage(null);
    setPublishOutcome(null);
    setPublishChannelResults([]);
    setRetryChannels([]);
    setRetryConfirmationVisible(false);
    try {
      const result = await publishPost(postId, channels, retryUncertain);
      const uncertainChannels = Object.entries(result.results)
        .filter(([, value]) => value.status === "unknown")
        .map(([platform]) => platform)
        .filter(
          (platform): platform is MetaChannel =>
            platform === "facebook" || platform === "instagram",
        );
      setRetryChannels(uncertainChannels);
      const results = Object.entries(result.results)
        .filter(
          ([platform]) => platform === "facebook" || platform === "instagram",
        )
        .map(([platform, value]) => ({
          channel: platform as MetaChannel,
          status: value.status,
          url: value.url,
          reason: value.reason,
        }));
      setPublishChannelResults(results);
      const channelResults = Object.values(result.results);
      const publishedCount = channelResults.filter(
        (value) => value.status === "published",
      ).length;
      setPublishOutcome(
        uncertainChannels.length > 0
          ? "uncertain"
          : channelResults.length > 0 &&
              publishedCount === channelResults.length
            ? "success"
            : publishedCount > 0
              ? "partial"
              : "failed",
      );
      setPublishMessage(
        results.length === 0
          ? (publishReasonLabel(result.post.error) ??
            "لم يُرجع الخادم تفاصيل عن نتيجة النشر.")
          : null,
      );
    } catch (error) {
      setPublishOutcome("failed");
      setPublishChannelResults([]);
      setPublishMessage(
        error instanceof Error
          ? publishReasonLabel(error.message) ??
            "تعذر النشر. تحقق من اتصال Meta وصلاحيات النشر."
          : "تعذر النشر. تحقق من اتصال Meta وصلاحيات النشر.",
      );
    } finally {
      setPublishing(false);
    }
  };

  return {
    publishDialogPostId,
    setPublishDialogPostId,
    publishing,
    publishMessage,
    setPublishMessage,
    publishOutcome,
    setPublishOutcome,
    publishChannelResults,
    setPublishChannelResults,
    selectedPublishChannels,
    setSelectedPublishChannels,
    retryChannels,
    setRetryChannels,
    retryConfirmationVisible,
    setRetryConfirmationVisible,
    verifyingPostId,
    verificationFeedback,
    onPublish,
    togglePublishChannel,
    onApprove,
    onVerifyFacebookStatus,
    publishAndShowResult,
  };
}
