import { useAuth } from "@clerk/expo";
import {
  BrandHeader,
  Page,
  PageTitle,
} from "@/components/Ui";
import { isLocalAuthDisabled } from "@/constants/auth";
import { MetaAutoReplySettingsPanel } from "@/components/inbox/MetaAutoReplySettingsPanel";

export default function ReplySettingsScreen() {
  if (isLocalAuthDisabled) {
    return <ReplySettingsContent userId={null} />;
  }
  return <AuthenticatedReplySettings />;
}

function AuthenticatedReplySettings() {
  const { userId } = useAuth();
  return <ReplySettingsContent userId={userId ?? null} />;
}

function ReplySettingsContent({ userId }: { userId: string | null }) {
  return (
    <Page>
      <BrandHeader />
      <PageTitle
        title="إعدادات الرد الآلي"
        subtitle="إعداد ردود قنوات Meta وواتساب من مكان واحد."
        back={{ href: "/(tabs)/inbox", label: "العودة إلى المحادثات" }}
      />
      <MetaAutoReplySettingsPanel userId={userId} />
    </Page>
  );
}