/**
 * Maps the free-text carrier names found in exports to Carrier codes.
 * Anything not listed becomes an upper-case slug and is tracked as a manual-check carrier.
 */
const ALIASES: Record<string, string> = {
  "4px": "4PX",
  "4px express": "4PX",
  "4px worldwide": "4PX",
  "4px worldwide express": "4PX",
  sagawa: "SAGAWA",
  "sagawa express": "SAGAWA",
  佐川: "SAGAWA",
  佐川急便: "SAGAWA",
  yamato: "YAMATO",
  "yamato transport": "YAMATO",
  ヤマト運輸: "YAMATO",
  "japan post": "JAPANPOST",
  日本郵便: "JAPANPOST",
  dhl: "DHL",
  "dhl express": "DHL",
};

export function carrierCodeFor(name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    ALIASES[key] ??
    key
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
  );
}
