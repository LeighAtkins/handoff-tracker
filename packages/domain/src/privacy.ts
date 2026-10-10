/**
 * Customer details are masked wherever they are shown, unless someone deliberately reveals them
 * (which is audited). Masks keep enough shape to tell two customers apart at a glance.
 */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const [first, ...rest] = [...part];
      return first ? first + "•".repeat(Math.max(rest.length, 1)) : "";
    })
    .join(" ");
}

/** Keeps the first block of a postcode (enough to see the region) and hides the rest. */
export function maskPostcode(postcode: string): string {
  const trimmed = postcode.trim();
  const [head, ...tail] = trimmed.split(/([-\s])/);
  if (tail.length)
    return (
      head + tail.map((part) => (/[-\s]/.test(part) ? part : "•".repeat(part.length))).join("")
    );
  const keep = Math.min(3, Math.floor(trimmed.length / 2));
  return trimmed.slice(0, keep) + "•".repeat(trimmed.length - keep);
}
