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
 * WebKit implements those indices as if they were *own* properties of the
 * declaration, so patching `CSSStyleDeclaration.prototype` (which is what the
 * first attempt at this file did) never runs: the engine throws before any
 * JavaScript setter is consulted. What does work on every engine is wrapping the
 * `style` property itself: the getter returns a proxy that flattens a leaked
 * style object into real CSS declarations instead of letting the engine throw.
 *
 * The concrete producer of such an array in this app is `<Link asChild>`:
 * expo-router renders the child through Radix `Slot`, which merges props with
 * `{ ...slotProps.style, ...childProps.style }`. A child with `style={[a, b]}`
 * therefore becomes `{ 0: a, 1: b }`, and React writes `style["0"] = a`.
 * Chromium drops those declarations (the element silently loses its styles),
 * WebKit throws. Those call sites were flattened at the source; this guard
 * keeps the whole class of mistake non-fatal.
 *
 * The wrapper is only installed after a capability probe proves the engine is
 * affected, so Chromium, Firefox and native rendering pay nothing. A console
 * warning names the leaking call site once, so the root cause can still be
 * deleted later.
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

const INDEX_PATTERN = /^\d+$/;

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
    if (Array.isArray(rawValue)) {
      styleDeclarations(rawValue, declarations);
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

type StyleTarget = object & StyleDeclarationWriter;

/**
 * Replaces a `style` property getter so that every declaration React writes is
 * routed through a proxy. Writing an object to a numeric index (the signature of
 * a leaked style array) merges it as CSS instead of throwing.
 *
 * Returns `true` when the property could be guarded.
 */
export function guardStyleProperty(
  prototype: object,
  onRepair?: (index: string, value: unknown) => void,
): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'style');
  if (!descriptor || typeof descriptor.get !== 'function') return false;
  const nativeGet = descriptor.get;
  const proxies = new WeakMap<object, object>();

  try {
    Object.defineProperty(prototype, 'style', {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
      get(this: object) {
        const declaration = nativeGet.call(this) as StyleTarget | null;
        if (!declaration || typeof declaration !== 'object') return declaration;

        const cached = proxies.get(declaration);
        if (cached) return cached;

        const proxy = new Proxy(declaration, {
          get(target, property) {
            const value = Reflect.get(target, property, target);
            return typeof value === 'function'
              ? (value as (...args: unknown[]) => unknown).bind(target)
              : value;
          },
          set(target, property, value) {
            if (typeof property === 'string' && INDEX_PATTERN.test(property)) {
              applyStyleObject(target as StyleTarget, value);
              onRepair?.(property, value);
              return true;
            }
            return Reflect.set(target, property, value, target);
          },
        });
        proxies.set(declaration, proxy);
        return proxy;
      },
      set: descriptor.set,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * True only on engines that throw on an indexed style assignment — WebKit.
 * Everything else renders untouched.
 */
export function needsStyleGuard(documentRef: Document): boolean {
  try {
    const probe = documentRef.createElement('div');
    (probe.style as unknown as Record<string, unknown>)['0'] = {};
    return false;
  } catch {
    return true;
  }
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

type GuardTargets = {
  HTMLElement?: { prototype: object };
  SVGElement?: { prototype: object };
};

/**
 * Installs the guard once, on web only, and only where the engine needs it.
 * Safe to call from any module scope: it does nothing during native rendering
 * or server-side bundling.
 */
export function installWebStyleSafety(): void {
  if (guardInstalled) return;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  guardInstalled = true;

  if (!needsStyleGuard(document)) return;

  const reported = new Set<string>();
  const onRepair = (): void => {
    const site = reportingSite();
    if (reported.has(site)) return;
    reported.add(site);
    console.warn(
      '[MenaFlow] A style array reached a DOM node (usually <Link asChild> with an array or function style); it was merged instead of throwing. Offender:',
      site,
    );
  };

  const targets = window as unknown as GuardTargets;
  const prototypes = [
    targets.HTMLElement?.prototype,
    targets.SVGElement?.prototype,
  ];
  let guarded = 0;
  for (const prototype of prototypes) {
    if (!prototype) continue;
    if (guardStyleProperty(prototype, onRepair)) guarded += 1;
  }
  if (guarded === 0) {
    console.warn(
      '[MenaFlow] The indexed-style guard could not be installed on this engine.',
    );
  }
}
