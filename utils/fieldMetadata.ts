import type { IFieldInfo } from '../types';

/**
 * Read one attribute's display name and field-security flag from PCF entity
 * metadata. The shape differs between hosts (Collection with get(), a
 * _collection map, a plain object or an array), so every form is tolerated.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readAttributeInfo(metadata: any, field: string): IFieldInfo | null {
  const attrs = metadata?.Attributes;
  if (!attrs) return null;
  let attr =
    (typeof attrs.get === 'function' ? attrs.get(field) : undefined) ??
    attrs._collection?.[field] ??
    (Array.isArray(attrs)
      ? attrs.find((a: { LogicalName?: string }) => a?.LogicalName?.toLowerCase() === field)
      : attrs[field]);
  if (!attr) return null;
  attr = attr.attributeDescriptor ? { ...attr.attributeDescriptor, ...attr } : attr;

  const label = attr.DisplayName;
  const displayName =
    typeof label === 'string'
      ? label
      : label?.UserLocalizedLabel?.Label ?? label?.LocalizedLabels?.[0]?.Label;
  const isSecured = attr.IsSecured === true;
  return { displayName: displayName || undefined, isSecured };
}
