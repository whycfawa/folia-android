// src/i18n/flattenLocale.ts

/**
 * Flattens a nested locale into dotted translation keys.
 *
 * The accumulator is mutated in place: rebuilding the whole object at every
 * leaf turned the startup pass into O(n²) work on low-end projectors.
 */
export function flattenLocale(
  locale: Record<string, unknown>,
  prefix = '',
  target: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(locale)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      flattenLocale(value as Record<string, unknown>, path, target);
    } else {
      target[path] = String(value);
    }
  }
  return target;
}
