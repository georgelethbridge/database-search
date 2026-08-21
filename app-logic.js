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

  // ---------------------------------------------------------------
  // Number formatters. Keys match the `format` column in Supabase.
  // Application numbers arrive as "16789123.4"; publication numbers as "EP3234567".
  // Inputs are cleaned defensively (case, whitespace, stray EP prefixes) so a
  // resolved number like "EP16789123.4" still formats correctly.
  // ---------------------------------------------------------------
  function cleanNumber(number) {
    return String(number || "").toUpperCase().trim();
  }

  function stripEpPrefix(number) {
    return cleanNumber(number).replace(/^EP/, "");
  }

  function stripCheckDigit(number) {
    return number.split(".")[0];
  }

  const FORMATTERS = {
    "EPXXXXXXXX_Y": (n) => "EP" + stripEpPrefix(n),
    "EPXXXXXXXX.Y": (n) => "EP" + stripEpPrefix(n),
    "XXXXXXXX_Y": (n) => stripEpPrefix(n),
    "XXXXXXXXY": (n) => stripEpPrefix(n).replace(".", ""),
    "XXXXXXXXX": (n) => stripEpPrefix(n).replace(".", ""),
    "EPXXXXXXXX": (n) => "EP" + stripCheckDigit(stripEpPrefix(n)),
    "EXXXXXXXX": (n) => "E" + stripCheckDigit(stripEpPrefix(n)),
    "EXXXXXXXXY": (n) => "E" + stripEpPrefix(n).replace(".", ""),
    "XXXXXXX": (n) => stripEpPrefix(n),
    "EPXXXXXXX": (n) => {
      const cleaned = cleanNumber(n);
      return cleaned.startsWith("EP") ? cleaned : "EP" + cleaned;
    }
  };

  function normalizeFormatKey(format) {
    return String(format || "").trim().replace(/[\s-]+/g, "_").toUpperCase();
  }

  function formatNumber(format, number) {
    if (!number) return "";
    const fn = FORMATTERS[normalizeFormatKey(format)];
    return typeof fn === "function" ? fn(number) : number;
  }

  // ---------------------------------------------------------------
  // Emoji flag for a territory code. Non-country office codes either map to
  // the EU flag or have no flag at all (Unicode has none for them).
  // ---------------------------------------------------------------
  const FLAG_OVERRIDES = { EP: "\u{1F1EA}\u{1F1FA}", UP: "\u{1F1EA}\u{1F1FA}", EM: "\u{1F1EA}\u{1F1FA}" };
  const NO_FLAG_CODES = ["OA", "AP", "EA", "GC", "XK"];

  function territoryFlag(code) {
    const c = (code || "").toUpperCase().trim();
    if (!/^[A-Z]{2}$/.test(c)) return "";
    if (FLAG_OVERRIDES[c]) return FLAG_OVERRIDES[c];
    if (NO_FLAG_CODES.includes(c)) return "";
    return String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65, 0x1F1E6 + c.charCodeAt(1) - 65);
  }

  // ---------------------------------------------------------------
  // Shortcut grammar for ?QUERY urls.
  //   ?EP3234567        -> { type: "ep-all", number: "EP3234567" }
  //   ?18752904.5       -> { type: "ep-all", number: "18752904.5" }
  //   ?DEEP3234567      -> { type: "ep-one", territory: "DE", number: "EP3234567" }
  //   ?DE102016123456.7 -> { type: "national", territory: "DE", number: "102016123456.7" }
  //   ?DE               -> { type: "landing", territory: "DE", patentType: "national" }
  //   ?DEEP             -> { type: "landing", territory: "DE", patentType: "ep" }
  //   ?EP               -> { type: "landing", territory: "EP", patentType: "ep" }
  // ---------------------------------------------------------------
  function parseShortcut(rawQuery) {
    const q = (rawQuery || "").toUpperCase().trim().replace(/\s+/g, "");
    if (!q) return null;

    if (/^[A-Z]{2}/.test(q)) {
      const territory = q.substring(0, 2);
      const rest = q.substring(2);

      if (territory === "EP") {
        if (!rest) return { type: "landing", territory: "EP", patentType: "ep" };
        return { type: "ep-all", number: q };
      }

      if (!rest) return { type: "landing", territory, patentType: "national" };
      if (rest === "EP") return { type: "landing", territory, patentType: "ep" };
      if (rest.startsWith("EP")) return { type: "ep-one", territory, number: rest };
      return { type: "national", territory, number: rest };
    }

    if (/^\d/.test(q)) return { type: "ep-all", number: q };
    return { type: "invalid", raw: q };
  }

  // ---------------------------------------------------------------
  // Build the final URL for one search_links row.
  // context: { publicationNumber, applicationNumber, nationalNumber }
  // Returns { url, kind } where kind is "direct" | "landing" | "missing-number" | "none".
  // ---------------------------------------------------------------
  function buildSearchLink(row, context) {
    if (!row) return { url: null, kind: "none" };

    let rawNumber = "";
    if (row.patentType === "national") {
      rawNumber = (context.nationalNumber || "").trim();
    } else if (row.requiredNumber === "EP Application Number") {
      rawNumber = context.applicationNumber || "";
    } else if (row.requiredNumber === "EP Publication Number") {
      rawNumber = context.publicationNumber || "";
    }

    if (row.linkTemplate && rawNumber) {
      const formatted = formatNumber(row.format, rawNumber);
      return { url: row.linkTemplate.replace("%s", encodeURIComponent(formatted)), kind: "direct" };
    }
    if (row.landingLink) {
      return { url: row.landingLink, kind: "landing" };
    }
    if (row.linkTemplate) {
      return { url: null, kind: "missing-number" };
    }
    return { url: null, kind: "none" };
  }

  // Group raw Supabase rows into { CODE: { ep: [rows], national: [rows], regional: [rows] } },
  // each list sorted patents-first, then by sort_order, then label.
  const RIGHT_TYPE_ORDER = { patent: 0, utility_model: 1, design: 2 };

  function groupSearchLinks(rows) {
    const grouped = {};
    for (const raw of rows || []) {
      const code = (raw.territory_code || "").toUpperCase().trim();
      if (!code) continue;

      const patentType = raw.patent_type === "national" ? "national"
        : raw.patent_type === "regional" ? "regional"
        : "ep";

      const row = {
        id: raw.id,
        territoryCode: code,
        patentType,
        rightType: RIGHT_TYPE_ORDER[raw.right_type] !== undefined ? raw.right_type : "patent",
        label: raw.label || null,
        linkTemplate: raw.link_template || null,
        landingLink: raw.landing_link || null,
        requiredNumber: raw.required_number || null,
        format: raw.format || null,
        sortOrder: Number.isFinite(raw.sort_order) ? raw.sort_order : 0
      };

      if (!grouped[code]) grouped[code] = { ep: [], national: [], regional: [] };
      grouped[code][patentType].push(row);
    }

    const bySort = (a, b) =>
      (RIGHT_TYPE_ORDER[a.rightType] - RIGHT_TYPE_ORDER[b.rightType]) ||
      (a.sortOrder - b.sortOrder) ||
      (a.label || "").localeCompare(b.label || "");
    for (const code of Object.keys(grouped)) {
      grouped[code].ep.sort(bySort);
      grouped[code].national.sort(bySort);
      grouped[code].regional.sort(bySort);
    }
    return grouped;
  }

  return {
    DEFAULT_KIND_CODES,
    FORMATTERS,
    normalizeEpPublicationNumber,
    createEpoXmlCandidates,
    buildProxyUrls,
    extractApplicationNumberFromXml,
    hasApplicationNumberTerritory,
    formatNumber,
    parseShortcut,
    buildSearchLink,
    groupSearchLinks,
    territoryFlag
  };
});
