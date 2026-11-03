import {
  extractPlaceholders,
  applyPlaceholders,
  escapeXml,
  toFetchValue,
  prepareFetch,
  FetchTemplateError,
  DEFAULT_FETCH_COUNT,
  expandListPlaceholders,
} from '../../utils/fetchTemplate';

const SAME_SOURCE = `<fetch>
  <entity name="opportunity">
    <filter>
      <condition attribute="new_recruitsource" operator="eq" value="{new_recruitsource}" />
      <condition attribute="opportunityid" operator="ne" value="{id}" />
    </filter>
  </entity>
</fetch>`;

const TOP5 = `<fetch top="5">
  <entity name="opportunity">
    <attribute name="name" />
    <attribute name="createdon" />
    <order attribute="createdon" descending="true" />
    <filter><condition attribute="ownerid" operator="eq" value="{ownerid}" /></filter>
  </entity>
</fetch>`;

describe('extractPlaceholders', () => {
  it('finds distinct placeholders in order, case-insensitively', () => {
    expect(extractPlaceholders(SAME_SOURCE)).toEqual(['new_recruitsource', 'id']);
    expect(extractPlaceholders('{OwnerId} {ownerid} {createdby}')).toEqual(['ownerid', 'createdby']);
  });

  it('ignores GUIDs in braces and non-identifier braces', () => {
    expect(extractPlaceholders('value="{00000000-0000-0000-0000-000000000001}" {1abc} { spaced }')).toEqual([]);
  });
});

describe('applyPlaceholders', () => {
  it('replaces placeholders with XML-escaped values', () => {
    const { xml, missing } = applyPlaceholders(SAME_SOURCE, { new_recruitsource: '100000001', id: 'abc' });
    expect(missing).toEqual([]);
    expect(xml).toContain('value="100000001"');
    expect(xml).toContain('value="abc"');
    expect(applyPlaceholders('<c value="{name}"/>', { name: 'A "quoted" <b> & \'x\'' }).xml).toBe(
      '<c value="A &quot;quoted&quot; &lt;b&gt; &amp; &apos;x&apos;"/>'
    );
  });

  it('reports placeholders without a value and leaves them untouched', () => {
    const { xml, missing } = applyPlaceholders(SAME_SOURCE, { id: 'abc', new_recruitsource: null });
    expect(missing).toEqual(['new_recruitsource']);
    expect(xml).toContain('{new_recruitsource}');
  });

  it('cannot be used to inject XML', () => {
    const { xml } = applyPlaceholders(SAME_SOURCE, { new_recruitsource: '1"/><condition attribute="x" operator="not-null', id: 'a' });
    expect(() => prepareFetch(xml)).not.toThrow();
    expect(xml.match(/<condition/g)).toHaveLength(2);
  });
});

describe('toFetchValue', () => {
  it('converts raw Dataverse values', () => {
    expect(toFetchValue(100000001)).toBe('100000001');
    expect(toFetchValue(true)).toBe('1');
    expect(toFetchValue(false)).toBe('0');
    expect(toFetchValue('00000000-0000-0000-0000-000000000001')).toBe('00000000-0000-0000-0000-000000000001');
    expect(toFetchValue({ id: '{ABC}' })).toBe('ABC');
    expect(toFetchValue({ id: { guid: 'abc' } })).toBe('abc');
    expect(toFetchValue([1, 2])).toBe('1,2');
    expect(toFetchValue(new Date('2026-10-03T00:00:00Z'))).toBe('2026-10-03T00:00:00.000Z');
    expect(toFetchValue(null)).toBeNull();
    expect(toFetchValue('')).toBeNull();
    expect(escapeXml('a&b')).toBe('a&amp;b');
  });
});

describe('prepareFetch', () => {
  it('returns the entity and caps rows when neither top nor count is set', () => {
    const prepared = prepareFetch(SAME_SOURCE.replace('{new_recruitsource}', '1').replace('{id}', 'a'));
    expect(prepared.entityName).toBe('opportunity');
    expect(prepared.toString()).toContain(`count="${DEFAULT_FETCH_COUNT}"`);
  });

  it('keeps top and adds the primary id/name when explicit attributes are listed', () => {
    const out = prepareFetch(TOP5.replace('{ownerid}', 'u'), ['opportunityid', 'name']).toString();
    expect(out).toContain('top="5"');
    expect(out).not.toContain('count=');
    expect(out).toContain('<attribute name="opportunityid"');
    expect(out.match(/<attribute name="name"/g)).toHaveLength(1); // not duplicated
  });

  it('does not add attributes when the entity returns all of them', () => {
    expect(prepareFetch('<fetch><entity name="opportunity"><all-attributes/></entity></fetch>', ['opportunityid']).toString()).not.toContain(
      'name="opportunityid"'
    );
  });

  it.each([
    ['not xml at all', '<fetch><entity'],
    ['wrong root', '<query><entity name="x"/></query>'],
    ['no entity', '<fetch><filter/></fetch>'],
    ['bad entity name', '<fetch><entity name="x y"/></fetch>'],
  ])('rejects invalid FetchXML (%s)', (_label, xml) => {
    expect(() => prepareFetch(xml)).toThrow(FetchTemplateError);
  });
});

describe('expandListPlaceholders', () => {
  it('turns a list placeholder in a list-operator condition into <value> elements', () => {
    const out = expandListPlaceholders('<fetch><entity name="o"><filter><condition attribute="s" operator="in" value="{s}"/></filter></entity></fetch>', { s: ['1', '2'] });
    expect(out).toContain('<condition attribute="s" operator="in"><value>1</value><value>2</value></condition>');
  });

  it('repeats a <value>{x}</value> element per item and escapes values', () => {
    const out = expandListPlaceholders('<fetch><entity name="o"><filter><condition attribute="s" operator="not-in"><value>{s}</value></condition></filter></entity></fetch>', { s: ['a&b', '2'] });
    expect(out).toContain('<value>a&amp;b</value><value>2</value>');
  });

  it('leaves single-value operators, unknown placeholders and invalid XML alone', () => {
    const eq = '<fetch><entity name="o"><filter><condition attribute="s" operator="eq" value="{s}"/></filter></entity></fetch>';
    expect(expandListPlaceholders(eq, { s: ['1', '2'] })).toBe(eq);
    expect(expandListPlaceholders(eq, {})).toBe(eq);
    expect(expandListPlaceholders('<fetch', { s: ['1'] })).toBe('<fetch');
  });
});

describe('prepareFetch parses once', () => {
  it('adds attributes to the same document via addAttributes', () => {
    const fetch = prepareFetch('<fetch><entity name="opportunity"><attribute name="createdon"/></entity></fetch>');
    expect(fetch.entityName).toBe('opportunity');
    const out = fetch.addAttributes(['opportunityid', 'name']).toString();
    expect(out).toContain('<attribute name="opportunityid"');
    expect(out).toContain('<attribute name="name"');
    expect(out).toContain('count="250"');
  });
});
