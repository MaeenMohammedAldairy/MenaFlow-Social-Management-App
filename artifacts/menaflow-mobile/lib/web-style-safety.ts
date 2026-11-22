/**
 * Web-only safety net for a React Native Web rendering hazard.
 *
 * When a component hands an *array* of styles to a real DOM node instead of
 * letting React Native Web flatten it, React writes the array indices ("0",
 * "1", …) onto the element's `CSSStyleDeclaration`. WebKit — Safari, and every
 * browser on iOS — refuses that assignment and throws:
 *
 *   Failed to set an indexed property [0] on 'CSSStyleDeclaration':
 *   Indexed property setter is not supported.
 *
 * That throw happens during React's commit phase, so the whole tree unmounts
 * and the crash screen appears (the `MF-XHKY2` report). Chromium ignores the
 * assignment silently, which is why the same build looks healthy in Chrome and
 * dies on Safari — and why the failure cannot be reproduced in a Chromium or
 * jsdom based harness.
 *
 * The guard below replaces those indexed setters with one that merges the
 * leaked style object into the element as real CSS declarations. A stray style
 * array therefore renders correctly instead of killing the app, and a console
 * warning still points at the component that leaked it, so the root cause can
 * be removed without shipping a second crash to users.
 */

const UNITLESS_PROPERTIES = new Set([
  'animationIterationCount',
  'aspectRatio',
  'borderImageOutset',
  'borderImageSlice',
  'borderImageWidth',
  'columnCount',
  'flex',
  'flexGrow',
  'flexShrink',
  'fontWeight',
  'gridArea',
  'gridColumn',
  'gridColumnEnd',
  'gridColumnStart',
  'gridRow',
  'gridRowEnd',
  'gridRowStart',
  'lineClamp',
  'lineHeight',
  'opacity',
  'order',
  'orphans',
  'scale',
  'tabSize',
  'widows',
  'zIndex',
  'zoom',
]);

export type StyleDeclarationWriter = {
  setProperty: (property: string, value: string) => void;
};

export type StyleDeclaration = [property: string, value: string];

function toKebabCase(property: string): string {
  if (property.startsWith('--')) return property;
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function toCssValue(property: string, value: unknown): string | null {
  if (value === null || value === undefined || value === false) return null;
  if (typeof value === 'number') {
    if (value === 0 || UNITLESS_PROPERTIES.has(property)) return String(value);
    return `${value}px`;
  }
  if (typeof value === 'string') {
    return value.trim() === '' ? null : value;
  }
  return null;
}

/**
 * Flattens any React Native style value (object, nested arrays, platform maps)
 * into a plain list of CSS declarations, in cascade order.
 */
export function styleDeclarations(
  value: unknown,
  declarations: StyleDeclaration[] = [],
): StyleDeclaration[] {
  if (value === null || value === undefined || value === false) {
    return declarations;
  }
  if (Array.isArray(value)) {
    for (const item of value) styleDeclarations(item, declarations);
    return declarations;
  }
  if (typeof value !== 'object') return declarations;
  for (const [property, rawValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (rawValue !== null && typeof rawValue === 'object') {
      // Nested array or a platform-specific style map: keep flattening.
      if (Array.isArray(rawValue)) {
        styleDeclarations(rawValue, declarations);
      }
      continue;
    }
    const cssValue = toCssValue(property, rawValue);
    if (cssValue !== null) {
      declarations.push([toKebabCase(property), cssValue]);
    }
  }
  return declarations;
}

/** Writes every declaration of a React Native style value onto a DOM style. */
export function applyStyleObject(
  target: StyleDeclarationWriter,
  value: unknown,
): number {
  const declarations = styleDeclarations(value);
  for (const [property, cssValue] of declarations) {
    try {
      target.setProperty(property, cssValue);
    } catch {
      // Invalid declaration for this engine; the rest still apply.
    }
  }
  return declarations.length;
}

/**
 * Replaces the numeric index setters of a `CSSStyleDeclaration` prototype with
 * setters that merge object values instead of throwing.
 *
 * Returns `true` when at least one index was guarded.
 */
export function installIndexedStyleGuard(
  prototype: object,
  onRepair?: (index: string, value: unknown) => void,
): boolean {
  let guarded = 0;
  for (let index = 0; index < 64; index += 1) {
    const property = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    const nativeSet = descriptor?.set;
    try {
      Object.defineProperty(prototype, property, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? false,
        get: descriptor?.get,
        set(this: StyleDeclarationWriter, value: unknown) {
          if (value !== null && typeof value === 'object') {
            applyStyleObject(this, value);
            onRepair?.(property, value);
            return;
          }
          if (nativeSet) {
            nativeSet.call(this, value);
            return;
          }
          // No native indexed setter in this engine: keep the element intact.
        },
      });
      guarded += 1;
    } catch {
      // Non-configurable in this engine — nothing to guard for this index.
    }
  }
  return guarded > 0;
}

let guardInstalled = false;

function reportingSite(): string {
  const stack = new Error('style array').stack ?? '';
  const line = stack
    .split('\n')
    .map((entry) => entry.trim())
    .find(
      (entry) =>
        entry.length > 0 &&
        !entry.startsWith('Error') &&
        !entry.includes('web-style-safety'),
    );
  return line ?? 'unknown';
}

/**
 * Installs the guard once, on web only. Safe to call from any module scope: it
 * does nothing during native rendering or server-side bundling.
 */
export function installWebStyleSafety(): void {
  if (guardInstalled) return;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const styleDeclaration =
    (window as unknown as { CSSStyleDeclaration?: { prototype?: object } })
      .CSSStyleDeclaration;
  const prototype = styleDeclaration?.prototype;
  if (!prototype) return;

  guardInstalled = true;
  const reported = new Set<string>();
  installIndexedStyleGuard(prototype, () => {
    const site = reportingSite();
    if (reported.has(site)) return;
    reported.add(site);
    console.warn(
      '[MenaFlow] A style array reached a DOM node; it was merged instead of throwing. Offender:',
      site,
    );
  });
}
