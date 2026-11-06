import React from 'react';
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';

const fontByWeight: Record<string, string> = {
  '200': 'Cairo_200ExtraLight',
  '300': 'Cairo_300Light',
  '400': 'Cairo_400Regular',
  '500': 'Cairo_500Medium',
  '600': 'Cairo_600SemiBold',
  '700': 'Cairo_700Bold',
  '800': 'Cairo_800ExtraBold',
  '900': 'Cairo_900Black',
  bold: 'Cairo_700Bold',
  normal: 'Cairo_400Regular',
};

function cairoStyle(style: StyleProp<TextStyle>): TextStyle {
  const flattened = StyleSheet.flatten(style);
  const weight = flattened?.fontWeight ?? '400';
  const writingDirection = flattened?.writingDirection ?? 'rtl';
  return {
    fontFamily: flattened?.fontFamily ?? fontByWeight[String(weight)] ?? 'Cairo_400Regular',
    writingDirection,
    ...(flattened?.textAlign === 'left' && writingDirection !== 'ltr'
      ? { textAlign: 'right' as const }
      : {}),
  };
}

function cairoInputStyle(style: StyleProp<TextStyle>): TextStyle {
  const flattened = StyleSheet.flatten(style);
  const writingDirection = flattened?.writingDirection ?? 'rtl';
  const textAlign = flattened?.textAlign;
  return {
    ...cairoStyle(style),
    writingDirection,
    textAlign:
      textAlign === undefined || textAlign === 'auto'
        ? writingDirection === 'rtl'
          ? 'right'
          : 'left'
        : textAlign === 'left' && writingDirection === 'rtl'
          ? 'right'
          : textAlign,
  };
}

export const CairoText = React.forwardRef<
  React.ElementRef<typeof NativeText>,
  TextProps
>(
  ({ style, ...props }, ref) => (
    <NativeText ref={ref} {...props} style={[style, cairoStyle(style)]} />
  ),
);

export const CairoTextInput = React.forwardRef<
  React.ElementRef<typeof NativeTextInput>,
  TextInputProps
>(({ style, ...props }, ref) => (
  <NativeTextInput ref={ref} {...props} style={[style, cairoInputStyle(style)]} />
));
