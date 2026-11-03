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
  const attributeType = toTypeName(attr.AttributeTypeName?.Value ?? attr.AttributeType ?? attr.Type);
  return { displayName: displayName || undefined, isSecured, ...(attributeType ? { attributeType } : {}) };
}

/** AttributeTypeCode numbers as returned by some hosts */
const TYPE_CODES: Record<number, string> = {
  0: 'Boolean', 1: 'Customer', 2: 'DateTime', 3: 'Decimal', 4: 'Double', 5: 'Integer', 6: 'Lookup',
  7: 'Memo', 8: 'Money', 9: 'Owner', 10: 'PartyList', 11: 'Picklist', 12: 'State', 13: 'Status',
  14: 'String', 15: 'Uniqueidentifier', 16: 'CalendarRules', 17: 'Virtual', 18: 'BigInt',
  19: 'ManagedProperty', 20: 'EntityName',
};

function toTypeName(value: unknown): string | undefined {
  if (typeof value === 'number') return TYPE_CODES[value];
  if (typeof value === 'string' && value) return value.replace(/Type$/, '');
  return undefined;
}

/** Lookup-like columns are selected as `_<name>_value` in the Web API */
export function isLookupType(attributeType: string | undefined): boolean {
  return /^(lookup|customer|owner)$/i.test(attributeType ?? '');
}
