const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeEpPublicationNumber,
  createEpoXmlCandidates,
  buildProxyUrls,
  extractApplicationNumberFromXml,
  hasApplicationNumberTerritory,
  formatNumber,
  parseShortcut,
  buildSearchLink,
  groupSearchLinks
} = require("../app-logic.js");

test("normalizeEpPublicationNumber strips EP prefix and spaces", () => {
  assert.equal(normalizeEpPublicationNumber(" EP 1234567 "), "1234567");
  assert.equal(normalizeEpPublicationNumber("ep7654321"), "7654321");
  assert.equal(normalizeEpPublicationNumber(""), "");
});

test("createEpoXmlCandidates builds ordered candidate URLs", () => {
  const candidates = createEpoXmlCandidates("EP1234567");
  assert.equal(candidates[0], "https://data.epo.org/publication-server/rest/v1.2/patents/EP1234567/document.xml");
  assert.equal(candidates[1], "https://data.epo.org/publication-server/rest/v1.2/patents/EP1234567NWA1/document.xml");
  assert.ok(candidates.length >= 6);
});

test("buildProxyUrls returns all configured proxy routes", () => {
  const target = "https://data.epo.org/publication-server/rest/v1.2/patents/EP123/document.xml";
  const proxied = buildProxyUrls(target);
  assert.equal(proxied[0], target);
  assert.ok(proxied.length >= 3);
  assert.match(proxied[1], /^https:\/\/api\.allorigins\.win\/raw\?url=/);
  assert.match(proxied[2], /^https:\/\/r\.jina\.ai\/http:\/\/data\.epo\.org\//);
});

test("extractApplicationNumberFromXml prioritizes B210 then fallback doc-number", () => {
  const xmlWithB210 = `<?xml version="1.0"?><root><B210>09123456.7</B210></root>`;
  const xmlWithFallback = `<?xml version="1.0"?><root><application-reference><doc-number>10123456.2</doc-number></application-reference></root>`;

  assert.equal(extractApplicationNumberFromXml(xmlWithB210), "09123456.7");
  assert.equal(extractApplicationNumberFromXml(xmlWithFallback), "10123456.2");
  assert.equal(extractApplicationNumberFromXml("not xml"), "");
});

test("hasApplicationNumberTerritory returns true only when at least one territory needs app number", () => {
  const links = {
    DE: { requiredNumber: "EP Publication Number" },
    FR: { requiredNumber: "EP Application Number" }
  };
  assert.equal(hasApplicationNumberTerritory(links, ["DE"]), false);
  assert.equal(hasApplicationNumberTerritory(links, ["DE", "FR"]), true);
});

test("formatNumber applies known formats and passes unknown formats through", () => {
  assert.equal(formatNumber("EPXXXXXXXX_Y", "16789123.4"), "EP16789123.4");
  assert.equal(formatNumber("EPXXXXXXXX.Y", "16789123.4"), "EP16789123.4");
  assert.equal(formatNumber("EPXXXXXXXX", "16789123.4"), "EP16789123");
  assert.equal(formatNumber("EXXXXXXXXY", "16789123.4"), "E167891234");
  assert.equal(formatNumber("XXXXXXXXY", "16789123.4"), "167891234");
  assert.equal(formatNumber("XXXXXXX", "EP3234567"), "3234567");
  assert.equal(formatNumber("EPXXXXXXX", "EP3234567"), "EP3234567");
  assert.equal(formatNumber("SOMETHING_NEW", "12345"), "12345");
  assert.equal(formatNumber(null, "12345"), "12345");
  assert.equal(formatNumber("EPXXXXXXX", ""), "");
});

test("formatNumber cleans inputs and normalizes format keys", () => {
  // Stray EP prefix on an application number is stripped before formatting.
  assert.equal(formatNumber("EXXXXXXXXY", "EP16789123.4"), "E167891234");
  assert.equal(formatNumber("XXXXXXXX_Y", "ep16789123.4"), "16789123.4");
  // EPXXXXXXX is idempotent: adds EP only when missing.
  assert.equal(formatNumber("EPXXXXXXX", "3234567"), "EP3234567");
  assert.equal(formatNumber("EPXXXXXXX", "EP3234567"), "EP3234567");
  // Format keys are case/whitespace/dash-insensitive; XXXXXXXXX aliases XXXXXXXXY.
  assert.equal(formatNumber(" epxxxxxxx ", "3234567"), "EP3234567");
  assert.equal(formatNumber("XXXXXXXXX", "16789123.4"), "167891234");
});

test("parseShortcut handles EP-wide queries", () => {
  assert.deepEqual(parseShortcut("EP3234567"), { type: "ep-all", number: "EP3234567" });
  assert.deepEqual(parseShortcut("ep3234567"), { type: "ep-all", number: "EP3234567" });
  assert.deepEqual(parseShortcut("18752904.5"), { type: "ep-all", number: "18752904.5" });
  assert.deepEqual(parseShortcut("EP"), { type: "landing", territory: "EP", patentType: "ep" });
});

test("parseShortcut handles territory-specific queries", () => {
  assert.deepEqual(parseShortcut("DEEP3234567"), { type: "ep-one", territory: "DE", number: "EP3234567" });
  assert.deepEqual(parseShortcut("DE102016123456.7"), { type: "national", territory: "DE", number: "102016123456.7" });
  assert.deepEqual(parseShortcut("DE"), { type: "landing", territory: "DE", patentType: "national" });
  assert.deepEqual(parseShortcut("DEEP"), { type: "landing", territory: "DE", patentType: "ep" });
});

test("parseShortcut handles empty and invalid input", () => {
  assert.equal(parseShortcut(""), null);
  assert.equal(parseShortcut(null), null);
  assert.equal(parseShortcut("?!")?.type, "invalid");
});

test("buildSearchLink substitutes formatted numbers into templates", () => {
  const row = {
    patentType: "ep",
    linkTemplate: "https://example.org/register?n=%s",
    landingLink: null,
    requiredNumber: "EP Publication Number",
    format: "XXXXXXX"
  };
  const result = buildSearchLink(row, { publicationNumber: "EP3234567", applicationNumber: "16789123.4" });
  assert.deepEqual(result, { url: "https://example.org/register?n=3234567", kind: "direct" });
});

test("buildSearchLink uses the national number as entered for national rows", () => {
  const row = {
    patentType: "national",
    linkTemplate: "https://example.org/nat?n=%s",
    landingLink: null,
    requiredNumber: null,
    format: "XXXXXXXXY"
  };
  const result = buildSearchLink(row, { nationalNumber: "102016123456.7" });
  assert.deepEqual(result, { url: "https://example.org/nat?n=1020161234567", kind: "direct" });
});

test("buildSearchLink falls back to the landing link when the number is missing", () => {
  const row = {
    patentType: "ep",
    linkTemplate: "https://example.org/register?n=%s",
    landingLink: "https://example.org/search",
    requiredNumber: "EP Application Number",
    format: null
  };
  assert.deepEqual(
    buildSearchLink(row, { publicationNumber: "EP3234567", applicationNumber: "" }),
    { url: "https://example.org/search", kind: "landing" }
  );
  assert.deepEqual(
    buildSearchLink({ ...row, landingLink: null }, { publicationNumber: "EP3234567", applicationNumber: "" }),
    { url: null, kind: "missing-number" }
  );
  assert.deepEqual(
    buildSearchLink({ patentType: "ep", linkTemplate: null, landingLink: null }, {}),
    { url: null, kind: "none" }
  );
});

test("groupSearchLinks groups by territory and patent type, sorted by sort_order", () => {
  const grouped = groupSearchLinks([
    { id: 1, territory_code: "de", patent_type: "ep", link_template: "https://a/%s", sort_order: 0 },
    { id: 2, territory_code: "DE", patent_type: "national", label: "Espacenet", link_template: "https://c/%s", sort_order: 2 },
    { id: 3, territory_code: "DE", patent_type: "national", label: "DPMA", link_template: "https://b/%s", sort_order: 1 },
    { id: 4, territory_code: "", patent_type: "ep" }
  ]);

  assert.deepEqual(Object.keys(grouped), ["DE"]);
  assert.equal(grouped.DE.ep.length, 1);
  assert.equal(grouped.DE.national.length, 2);
  assert.equal(grouped.DE.national[0].label, "DPMA");
  assert.equal(grouped.DE.national[1].label, "Espacenet");
});

test("groupSearchLinks handles regional rows and orders patents before other right types", () => {
  const grouped = groupSearchLinks([
    { id: 1, territory_code: "EM", patent_type: "regional", right_type: "design", landing_link: "https://euipo.europa.eu/eSearch/" },
    { id: 2, territory_code: "DE", patent_type: "national", right_type: "utility_model", landing_link: "https://register.dpma.de/DPMAregister/pat/basis", sort_order: 0 },
    { id: 3, territory_code: "DE", patent_type: "national", right_type: "patent", landing_link: "https://register.dpma.de/DPMAregister/pat/basis", sort_order: 5 }
  ]);

  assert.equal(grouped.EM.regional.length, 1);
  assert.equal(grouped.EM.regional[0].rightType, "design");
  // Patent row sorts first despite its higher sort_order.
  assert.equal(grouped.DE.national[0].rightType, "patent");
  assert.equal(grouped.DE.national[1].rightType, "utility_model");
});
