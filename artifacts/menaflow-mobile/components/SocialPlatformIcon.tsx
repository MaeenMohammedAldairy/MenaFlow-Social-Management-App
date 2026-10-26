import React from "react";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
} from "react-native-svg";

type SocialPlatform = "facebook" | "instagram" | "whatsapp";

export function SocialPlatformIcon({
  platform,
  size = 28,
}: {
  platform: SocialPlatform;
  size?: number;
}) {
  if (platform === "facebook") {
    return (
      <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityLabel="Facebook">
        <Circle cx="16" cy="16" r="16" fill="#1877F2" />
        <Path
          d="M18.1 27V17.4h3.2l.48-3.74H18.1v-2.39c0-1.08.3-1.82 1.85-1.82h1.98V6.11A26.6 26.6 0 0 0 19.05 6c-2.85 0-4.8 1.74-4.8 4.93v2.73h-3.23v3.74h3.23V27h3.85Z"
          fill="#FFFFFF"
        />
      </Svg>
    );
  }

  if (platform === "instagram") {
    return (
      <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityLabel="Instagram">
        <Defs>
          <LinearGradient id="instagramGradient" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFB02E" />
            <Stop offset="0.48" stopColor="#F04A72" />
            <Stop offset="1" stopColor="#9B36C7" />
          </LinearGradient>
        </Defs>
        <Circle cx="16" cy="16" r="16" fill="url(#instagramGradient)" />
        <Path
          d="M11.1 8.5h9.8a3.6 3.6 0 0 1 3.6 3.6v7.8a3.6 3.6 0 0 1-3.6 3.6h-9.8a3.6 3.6 0 0 1-3.6-3.6v-7.8a3.6 3.6 0 0 1 3.6-3.6Z"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="2"
        />
        <Circle
          cx="16"
          cy="16"
          r="4.1"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="2"
        />
        <Circle cx="21.4" cy="10.8" r="1.2" fill="#FFFFFF" />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityLabel="WhatsApp">
      <Circle cx="16" cy="16" r="16" fill="#25D366" />
      <Path
        d="M8.1 24.2 9.3 20a10.1 10.1 0 1 1 3.8 3.6l-5 .6Z"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <Path
        d="M12.3 11.9c.3-.6.6-.6.9-.6h.6c.2 0 .4.1.5.4l.9 2.1c.1.3.1.5-.1.7l-.7.8c-.2.2-.2.4 0 .7.7 1.1 1.6 2 2.8 2.6.3.2.5.1.7-.1l.9-1.1c.2-.3.5-.3.8-.2l1.9.9c.3.1.4.3.4.5 0 .3-.2 1.4-.9 2-.7.6-1.6.8-2.6.5-1-.3-2.3-.8-3.9-2.2-1.9-1.6-3.1-3.6-3.4-4.7-.4-1.1 0-2 .4-2.5l.8-.8Z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}
