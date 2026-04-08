const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeEpPublicationNumber,
  createEpoXmlCandidates,
  buildProxyUrls,
  extractApplicationNumberFromXml,
  hasApplicationNumberTerritory
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
