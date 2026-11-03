/**
 * FetchXML template for form subgrids
 *
 * The control can be given a FetchXML template with placeholders like
 * {new_recruitsource}, {ownerid}, {createdby} and {id}. On a form subgrid,
 * placeholders are filled from the form's record and the query replaces the
 * subgrid's own rows. Everything here is pure (no Dataverse calls).
 */

/** Matches {logicalname}; GUIDs in braces ({0000-...}) don't match because of the hyphens */
const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Placeholder that stands for the form record's own id */
export const ID_PLACEHOLDER = 'id';

/** Row cap added when the template sets neither `top` nor `count` */
export const DEFAULT_FETCH_COUNT = 250;

/** Distinct placeholder names in the template, lower-cased, in first-seen order */
export function extractPlaceholders(template: string): string[] {
  const names: string[] = [];
  const re = new RegExp(PLACEHOLDER_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    const name = match[1].toLowerCase();
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Escape a value for use inside an XML attribute or text node */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** FetchXML text for a raw Dataverse value (lookup GUID, option value, boolean, date, text) */
export function toFetchValue(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'boolean') return raw ? '1' : '0';
  if (raw instanceof Date) return raw.toISOString();
  if (Array.isArray(raw)) {
    const parts = raw.map(toFetchValue).filter((v): v is string => v !== null);
    return parts.length ? parts.join(',') : null;
  }
  if (typeof raw === 'object') {
    const ref = raw as { id?: unknown; Id?: unknown };
    const id = ref.id ?? ref.Id;
    if (typeof id === 'string') return id.replace(/[{}]/g, '');
    if (id && typeof (id as { guid?: unknown }).guid === 'string') return (id as { guid: string }).guid;
    return null;
  }
  return String(raw);
}

/**
 * Replace every {placeholder} with its XML-escaped value.
 * Placeholders without a value are returned in `missing` (and left as-is).
 */
export function applyPlaceholders(
  template: string,
  values: Record<string, string | null | undefined>
): { xml: string; missing: string[] } {
  const missing: string[] = [];
  const xml = template.replace(PLACEHOLDER_RE, (whole, rawName: string) => {
    const name = rawName.toLowerCase();
    const value = values[name];
    if (value === null || value === undefined || value === '') {
      if (!missing.includes(name)) missing.push(name);
      return whole;
    }
    return escapeXml(value);
  });
  return { xml, missing };
}

export interface IFetchInfo {
  /** Logical name of the root <entity> */
  entityName: string;
  /** Serialize the (possibly adjusted) document back to FetchXML */
  toString(): string;
}

export class FetchTemplateError extends Error {
  constructor(message: string, public readonly kind: 'invalid' | 'missing-values' | 'read-failed', public readonly fields: string[] = []) {
    super(message);
    this.name = 'FetchTemplateError';
  }
}

/**
 * Parse FetchXML and prepare it to run:
 * - validates it's well-formed with a root <fetch> and an <entity name="...">
 * - when the entity lists explicit <attribute>s, adds the primary id/name
 *   attributes the grid needs (if missing)
 * - adds count="250" when neither `top` nor `count` is set
 */
export function prepareFetch(xml: string, primaryAttributes: string[] = []): IFetchInfo {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    throw new FetchTemplateError("The FetchXML filter isn't valid XML.", 'invalid');
  }
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName('parsererror').length > 0 || root.nodeName !== 'fetch') {
    throw new FetchTemplateError("The FetchXML filter isn't valid: it must be a <fetch> document.", 'invalid');
  }
  const entity = Array.from(root.childNodes).find(n => n.nodeName === 'entity') as Element | undefined;
  const entityName = entity?.getAttribute('name')?.trim() ?? '';
  if (!entity || !/^[a-z_][a-z0-9_]*$/i.test(entityName)) {
    throw new FetchTemplateError('The FetchXML filter needs an <entity name="..."> element.', 'invalid');
  }

  const children = Array.from(entity.childNodes) as Element[];
  const hasAllAttributes = children.some(n => n.nodeName === 'all-attributes');
  const attributes = children.filter(n => n.nodeName === 'attribute').map(n => n.getAttribute('name')?.toLowerCase());
  if (!hasAllAttributes && attributes.length > 0) {
    for (const name of primaryAttributes) {
      if (name && !attributes.includes(name.toLowerCase())) {
        const attr = doc.createElement('attribute');
        attr.setAttribute('name', name);
        entity.insertBefore(attr, entity.firstChild);
      }
    }
  }

  if (!root.hasAttribute('top') && !root.hasAttribute('count')) {
    root.setAttribute('count', String(DEFAULT_FETCH_COUNT));
  }

  return {
    entityName: entityName.toLowerCase(),
    toString: () => new XMLSerializer().serializeToString(doc),
  };
}
