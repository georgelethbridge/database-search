(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.EPTerritorySearch = factory();
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const DEFAULT_KIND_CODES = ["", "NWA1", "NWA2", "NWA8", "NWB1", "NWB2", "NWB8"];

  function normalizeEpPublicationNumber(epPubValue) {
    const cleaned = (epPubValue || "").toUpperCase().trim().replace(/\s+/g, "");
    if (!cleaned) return "";
    return cleaned.startsWith("EP") ? cleaned.substring(2) : cleaned;
  }

  function createEpoXmlCandidates(epPubValue, kindCodes = DEFAULT_KIND_CODES) {
    const normalized = normalizeEpPublicationNumber(epPubValue);
    if (!normalized) return [];

    return kindCodes.map((kindCode) => {
      const publicationId = "EP" + normalized + kindCode;
      return "https://data.epo.org/publication-server/rest/v1.2/patents/" + publicationId + "/document.xml";
    });
  }

  function buildProxyUrls(url) {
    return [
      url,
      "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
      "https://r.jina.ai/http://" + url.replace(/^https?:\/\//i, ""),
      "https://corsproxy.io/?" + encodeURIComponent(url)
    ];
  }

  function extractWithRegex(xmlText) {
    if (!xmlText || typeof xmlText !== "string") return "";
    const b210Match = xmlText.match(/<B210>\s*([^<]+?)\s*<\/B210>/i);
    if (b210Match?.[1]) return b210Match[1].trim();

    const appRefMatch = xmlText.match(/<application-reference[\s\S]*?<doc-number>\s*([^<]+?)\s*<\/doc-number>/i);
    if (appRefMatch?.[1]) return appRefMatch[1].trim();
    return "";
  }

  function extractApplicationNumberFromXml(xmlText) {
    if (!xmlText || typeof xmlText !== "string") return "";

    if (typeof DOMParser === "undefined") return extractWithRegex(xmlText);

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      if (xmlDoc.querySelector("parsererror")) return "";

      const b210 = xmlDoc.querySelector("B210");
      if (b210?.textContent?.trim()) return b210.textContent.trim();

      const appDocNumber = xmlDoc.querySelector("application-reference doc-number");
      if (appDocNumber?.textContent?.trim()) return appDocNumber.textContent.trim();

      return "";
    } catch {
      return extractWithRegex(xmlText);
    }
  }

  function hasApplicationNumberTerritory(territoryLinks, codes) {
    for (const code of codes) {
      if (territoryLinks[code]?.requiredNumber === "EP Application Number") return true;
    }
    return false;
  }

  return {
    DEFAULT_KIND_CODES,
    normalizeEpPublicationNumber,
    createEpoXmlCandidates,
    buildProxyUrls,
    extractApplicationNumberFromXml,
    hasApplicationNumberTerritory
  };
});
