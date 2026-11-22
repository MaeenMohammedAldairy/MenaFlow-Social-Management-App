import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

// Crawlers need a fully qualified image URL, so the origin is configurable.
// Falls back to a relative path, which still resolves for the page itself.
const siteUrl =
  process.env.EXPO_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ?? "";

// Point this at a 1200x630 share card once one exists; until then the app icon
// is the only stable image in the bundle.
const shareImageUrl =
  process.env.EXPO_PUBLIC_OG_IMAGE_URL?.trim() ||
  `${siteUrl}/assets/images/icon.png`;

const pageTitle =
  "MenaFlow — محتوى ومحادثات وطلبات متجرك في مساحة عربية واحدة";
const pageDescription =
  "رتّب منشورات فيسبوك وإنستغرام، تابع رسائل واتساب، وأدر المنتجات والطلبات من مساحة عمل واحدة. ابدأ بالخطة المجانية.";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="MenaFlow" />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:image" content={shareImageUrl} />
        <meta property="og:locale" content="ar_AR" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
        <meta name="theme-color" content="#087F68" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

// Matches the app palettes in constants/colors.ts so the first paint does not
// flash a white page under the dark scheme.
const responsiveBackground = `
body { background-color: #F5F7F6; }
@media (prefers-color-scheme: dark) { body { background-color: #0D1722; } }
/* Chrome paints autofilled fields with its own background, which showed up as a
   white block over the dark auth card. The auth screens pin color-scheme on the
   document, so the engine follows our palette; these rules keep the text and the
   caret readable either way. */
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus,
textarea:-webkit-autofill {
  -webkit-text-fill-color: inherit !important;
  caret-color: auto !important;
  transition: background-color 9999s ease-out 0s;
}
`;
