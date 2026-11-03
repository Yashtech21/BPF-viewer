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
  /**
   * When the entity lists explicit <attribute>s, add these (e.g. the primary
   * id/name the grid needs) unless present. Works on the same parsed document.
   */
  addAttributes(names: string[]): IFetchInfo;
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
 * Parse FetchXML (once) and prepare it to run:
 * - validates it's well-formed with a root <fetch> and an <entity name="...">
 * - adds count="250" when neither `top` nor `count` is set
 * - `addAttributes` adds the primary id/name when explicit attributes are listed
 */
export function prepareFetch(xml: string, primaryAttributes: string[] = []): IFetchInfo {
  const doc = parseXml(xml);
  const root = doc?.documentElement;
  if (!doc || !root || root.nodeName !== 'fetch') {
    throw new FetchTemplateError("The FetchXML filter isn't valid: it must be a <fetch> document.", 'invalid');
  }
  const entity = Array.from(root.childNodes).find(n => n.nodeName === 'entity') as Element | undefined;
  const entityName = entity?.getAttribute('name')?.trim() ?? '';
  if (!entity || !/^[a-z_][a-z0-9_]*$/i.test(entityName)) {
    throw new FetchTemplateError('The FetchXML filter needs an <entity name="..."> element.', 'invalid');
  }

  if (!root.hasAttribute('top') && !root.hasAttribute('count')) {
    root.setAttribute('count', String(DEFAULT_FETCH_COUNT));
  }

  const info: IFetchInfo = {
    entityName: entityName.toLowerCase(),
    addAttributes(names: string[]) {
      const children = Array.from(entity.childNodes) as Element[];
      const hasAllAttributes = children.some(n => n.nodeName === 'all-attributes');
      const attributes = children.filter(n => n.nodeName === 'attribute').map(n => n.getAttribute('name')?.toLowerCase());
      if (!hasAllAttributes && attributes.length > 0) {
        for (const name of names) {
          if (name && !attributes.includes(name.toLowerCase())) {
            const attr = doc.createElement('attribute');
            attr.setAttribute('name', name);
            entity.insertBefore(attr, entity.firstChild);
            attributes.push(name.toLowerCase());
          }
        }
      }
      return info;
    },
    toString: () => new XMLSerializer().serializeToString(doc),
  };
  return primaryAttributes.length ? info.addAttributes(primaryAttributes) : info;
}

/** Parse XML; null when not well-formed */
function parseXml(xml: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
  } catch {
    return null;
  }
}

/** Condition operators that take a list of <value> elements */
const LIST_OPERATORS = new Set(['in', 'not-in', 'contain-values', 'not-contain-values']);

/**
 * Expand multi-valued placeholders (multi-select option sets) into <value>
 * elements, which list operators require:
 *   <condition operator="in" value="{x}"/>  ->  <condition operator="in"><value>1</value><value>2</value></condition>
 *   <value>{x}</value>                      ->  <value>1</value><value>2</value>
 * Other uses keep the comma-separated string. Values are escaped by the DOM.
 * Returns the template unchanged when it isn't well-formed (validation reports it later).
 */
export function expandListPlaceholders(template: string, lists: Record<string, string[]>): string {
  const names = Object.keys(lists).filter(n => lists[n].length > 0);
  if (names.length === 0) return template;
  const doc = parseXml(template);
  if (!doc) return template;

  const placeholderOf = (text: string | null) => {
    const m = /^\s*\{([A-Za-z_][A-Za-z0-9_]*)\}\s*$/.exec(text ?? '');
    const name = m?.[1].toLowerCase();
    return name && lists[name]?.length ? name : null;
  };
  let changed = false;

  for (const condition of Array.from(doc.getElementsByTagName('condition'))) {
    const name = placeholderOf(condition.getAttribute('value'));
    const operator = (condition.getAttribute('operator') ?? '').toLowerCase();
    if (!name || !LIST_OPERATORS.has(operator)) continue;
    condition.removeAttribute('value');
    for (const item of lists[name]) {
      const value = doc.createElement('value');
      value.textContent = item;
      condition.appendChild(value);
    }
    changed = true;
  }

  for (const valueEl of Array.from(doc.getElementsByTagName('value'))) {
    const name = placeholderOf(valueEl.textContent);
    if (!name || !valueEl.parentNode) continue;
    for (const item of lists[name]) {
      const copy = doc.createElement('value');
      copy.textContent = item;
      valueEl.parentNode.insertBefore(copy, valueEl);
    }
    valueEl.parentNode.removeChild(valueEl);
    changed = true;
  }

  return changed ? new XMLSerializer().serializeToString(doc) : template;
}
