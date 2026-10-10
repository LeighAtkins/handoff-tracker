import type { CarrierAdapter } from "./adapter";
import { createFakeAdapter, type FakeAdapterOptions } from "./fake";
import { createManualAdapter } from "./manual";

export const ADAPTER_NAMES = ["fake", "manual"] as const;
export type AdapterName = (typeof ADAPTER_NAMES)[number];

export interface AdapterOptions {
  fake?: FakeAdapterOptions;
}

/** Builds the adapter named in a Carrier row's `adapter` column. Unknown names fall back to manual. */
export function adapterFor(
  carrier: { code: string; adapter: string },
  options: AdapterOptions = {},
): CarrierAdapter {
  switch (carrier.adapter) {
    case "fake":
      return createFakeAdapter(carrier.code, options.fake);
    default:
      return createManualAdapter(carrier.code);
  }
}
