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
  takesend: "TAKESEND",
};

function slug(key: string): string {
  return key
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * NOMS records some couriers as "forwarder:channel", e.g. "4px:S5058" (a 4PX service code) or
 * "takesend:SAGAWA" (Takesend booking, Sagawa last mile and tracking number). A known carrier
 * after the colon wins; otherwise the part before it names the carrier.
 */
export function carrierCodeFor(name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  const alias = ALIASES[key];
  if (alias) return alias;
  const [forwarder, channel] = key.split(":").map((part) => part.trim());
  if (channel !== undefined && forwarder)
    return ALIASES[channel] ?? ALIASES[forwarder] ?? slug(forwarder);
  return slug(key);
}
