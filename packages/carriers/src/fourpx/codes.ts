import type { Stage, Status } from "@handoff/domain";

/**
 * 4PX Open Platform business link codes (`businessLinkCode`), from 4PX's official table of 429
 * codes: https://open.4px.com/v2/help/customdata?ids=help-data,21
 *
 * The codes marked 【关键轨迹】 (key event) in that table are the milestones below. The second
 * letter is the leg of the journey: L pickup, F trucking, C 4PX warehouse, Q export customs,
 * M linehaul and air, I import customs, D destination delivery, O last-mile carrier, S signed,
 * R returns, Y closed. Most codes are failure reasons, so they are grouped by family.
 */
const MILESTONES: Record<string, Stage> = {
  FPX_L_RPIF: "LABEL_CREATED", // Shipment information received
  FPX_L_SC: "PICKED_UP", // Successful collection
  FPX_C_SPLS: "PICKED_UP", // 【关键轨迹】 Inbound at the 4PX warehouse
  FPX_C_AAF: "PICKED_UP", // 【关键轨迹】 Arrived at facility and weighed
  FPX_M_DFOA: "DEPARTED_ORIGIN", // 【关键轨迹】 Flight departed
  FPX_M_ATA: "ARRIVED_DESTINATION", // 【关键轨迹】 Landed at the destination airport
  FPX_I_RCUK: "CUSTOMS_CLEARED", // 【关键轨迹】 Released from customs (data clearance)
  FPX_I_CPC: "CUSTOMS_CLEARED", // Clearance completed (physical clearance)
  FPX_D_STPP: "HANDED_OFF", // 【关键轨迹】 交邮: customs broker handed it to the last-mile carrier
  FPX_O_RR: "LAST_MILE_ACCEPTED", // 【关键轨迹】 Last-mile carrier received the shipment
  FPX_D_SD: "OUT_FOR_DELIVERY", // 【关键轨迹】 Last-mile delivery started
  FPX_D_OFD: "OUT_FOR_DELIVERY",
  FPX_D_ODBP: "OUT_FOR_DELIVERY",
  FPX_D_DSRT: "OUT_FOR_DELIVERY",
  FPX_D_FAD: "OUT_FOR_DELIVERY", // 开始首次派送: first delivery attempt under way
  FPX_D_ATDE: "OUT_FOR_DELIVERY", // 尝试派送: attempting delivery (not a failure)
  FPX_D_PR: "OUT_FOR_DELIVERY", // Being redelivered
  FPX_D_CZCP: "OUT_FOR_DELIVERY", // Redelivery started
  FPX_S_OK: "DELIVERED", // 【关键轨迹】
  FPX_S_OKCC: "DELIVERED", // 【关键轨迹】 Collected from a pickup point
};

/** Normal progress that marks no milestone: trucks, sorting, customs paperwork, transfers. */
const PROGRESS = new Set([
  "FPX_L_CR",
  "FPX_F_VD",
  "FPX_F_VA",
  "FPX_C_ADFF",
  "FPX_Q_UEPC",
  "FPX_Q_AAEC",
  "FPX_Q_ECI",
  "FPX_Q_ECC",
  "FPX_Q_DFEC",
  "FPX_M_GXLS",
  "FPX_M_PT",
  "FPX_M_HA",
  "FPX_M_PPRL",
  "FPX_M_LDTP",
  "FPX_M_IT",
  "FPX_M_ATP",
  "FPX_M_AWP",
  "FPX_M_CRSD",
  // PTCW's English says "Released by custom house", but the Chinese is "taken to the bonded
  // warehouse": the parcel is entering customs, not leaving it.
  "FPX_I_PTCW",
  "FPX_I_PTCO",
  "FPX_I_CP",
  "FPX_I_NI",
  "FPX_I_CC",
  "FPX_I_UCC",
  "FPX_I_DDAP",
  "FPX_I_II",
  "FPX_I_ICI",
  "FPX_I_CPCM",
  "FPX_I_RDBV",
  "FPX_O_NM",
  "FPX_O_DW",
  "FPX_O_IRO",
  "FPX_O_IRD",
  "FPX_O_IR",
  "FPX_O_RC",
  "FPX_D_DFD",
  "FPX_D_AAD",
  "FPX_D_DOV",
  "FPX_D_AOV",
  "FPX_D_HQ",
  "FPX_D_TRAA",
  "FPX_D_SP",
]);

const group = (stage: Stage, codes: string[]) => codes.map((code) => [code, stage] as const);

/** Problems that their family (below) would get wrong. */
const PROBLEMS: Record<string, Stage> = Object.fromEntries([
  ...group("RETURNING", [
    "FPX_C_RT",
    "FPX_Q_ECR",
    "FPX_M_ATR",
    "FPX_I_CR",
    "FPX_I_CFRT",
    "FPX_D_FDR",
    "FPX_D_SR",
    "FPX_D_ATLUS",
    "FPX_D_LNP",
    "FPX_D_ATLNP",
  ]),
  ...group("RETURNED", ["FPX_C_BTC", "FPX_M_PRTS", "FPX_R_RDOW"]),
  ...group("AWAITING_PICKUP", [
    "FPX_D_SASPS",
    "FPX_D_ACC",
    "FPX_D_ADWP",
    "FPX_D_AP",
    "FPX_D_PI",
    "FPX_D_FDWP",
    "FPX_D_POD",
  ]),
  ...group("ADDRESS_PROBLEM", [
    "FPX_D_DEFB",
    "FPX_D_FDIA",
    "FPX_D_DDIA",
    "FPX_D_DWMP",
    "FPX_D_DDA",
    "FPX_D_FID",
    "FPX_D_DDCM",
    "FPX_D_DDCA",
    "FPX_D_RCA",
    "FPX_D_SHOA",
  ]),
  ...group("DELIVERY_FAILED", ["FPX_D_DDRH", "FPX_D_DDCN"]),
  ...group("CUSTOMS_HOLD", ["FPX_M_HCSC"]),
  // Lost, damaged, seized, destroyed or on hold: nothing a redelivery would fix.
  ...group("EXCEPTION", [
    "FPX_D_DEFK",
    "FPX_D_FDPL",
    "FPX_D_CZPS",
    "FPX_D_DEFJ",
    "FPX_D_FDSD",
    "FPX_D_FPD",
    "FPX_D_FPS",
    "FPX_D_LMD",
    "FPX_D_DFSR",
    "FPX_D_DDES",
    "FPX_D_PC",
    "FPX_D_BI",
    "FPX_D_HG",
    "FPX_D_OCPT",
    "FPX_D_CBD",
    "FPX_D_ICPD",
    "FPX_D_DEFH",
    "FPX_D_DC",
    "FPX_D_CZKC",
    "FPX_D_VN",
    "FPX_D_RA",
    "FPX_D_SH",
    "FPX_D_SHND",
    "FPX_D_SHAP",
    "FPX_D_DDRC",
    "FPX_I_PDCC",
    "FPX_I_CSF",
    "FPX_I_HGXH",
    "FPX_I_CIC",
    "FPX_I_IRNP",
    "FPX_R_RPDF",
  ]),
]);

/** Families, checked in order once the explicit tables have had their say. */
const FAMILIES: [RegExp, Stage][] = [
  // Carrier delay notices: flights, weather, holidays, missed cycles.
  [/^FPX_(M_TD|M_FDD|M_SCTC|D_DD|D_TDS|L_DL|Q_ECCD|I_DELAY|I_CDSH)/, "DELAYED"],
  // Import and export customs: holds, inspections that failed, duties, declaration problems.
  [/^FPX_[IQ]_/, "CUSTOMS_HOLD"],
  // Destination delivery: almost all of the remaining D codes are reasons a delivery failed.
  [/^FPX_D_/, "DELIVERY_FAILED"],
  // Pickup, warehouse, airline and closure problems.
  [/^FPX_[LCMY]_/, "EXCEPTION"],
];

export type FourPxCode =
  { kind: "milestone" | "problem"; stage: Stage } | { kind: "progress" } | { kind: "unknown" };

const CODE = /^FPX_[A-Z]_[A-Z0-9]+$/;

export function isFourPxCode(rawStatus: string): boolean {
  return CODE.test(rawStatus.toUpperCase());
}

export function classifyFourPxCode(rawStatus: string): FourPxCode {
  const code = rawStatus.toUpperCase();
  const milestone = MILESTONES[code];
  if (milestone) return { kind: "milestone", stage: milestone };
  if (PROGRESS.has(code)) return { kind: "progress" };
  const problem = PROBLEMS[code] ?? FAMILIES.find(([family]) => family.test(code))?.[1];
  return problem ? { kind: "problem", stage: problem } : { kind: "unknown" };
}

const STAGE_STATUS: Record<Stage, Status> = {
  LABEL_CREATED: "PENDING",
  PICKED_UP: "SHIPPED",
  DEPARTED_ORIGIN: "IN_TRANSIT",
  ARRIVED_DESTINATION: "IN_TRANSIT",
  CUSTOMS_CLEARED: "IN_TRANSIT",
  HANDED_OFF: "HANDED_OFF",
  LAST_MILE_ACCEPTED: "HANDED_OFF",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  DELAYED: "IN_TRANSIT",
  CUSTOMS_HOLD: "EXCEPTION",
  DELIVERY_FAILED: "EXCEPTION",
  ADDRESS_PROBLEM: "EXCEPTION",
  AWAITING_PICKUP: "OUT_FOR_DELIVERY",
  RETURNING: "RETURNED",
  RETURNED: "RETURNED",
  EXCEPTION: "EXCEPTION",
};

/**
 * Stage for a 4PX code: undefined when it is not a 4PX code at all (so other rules may try),
 * null when it is one that marks no stage.
 */
export function fourPxStage(rawStatus: string): Stage | null | undefined {
  if (!isFourPxCode(rawStatus)) return undefined;
  const code = classifyFourPxCode(rawStatus);
  return code.kind === "milestone" || code.kind === "problem" ? code.stage : null;
}

/** Status for a 4PX code: undefined when it is not a 4PX code, null when 4PX added a new one. */
export function fourPxStatus(rawStatus: string): Status | null | undefined {
  if (!isFourPxCode(rawStatus)) return undefined;
  const code = classifyFourPxCode(rawStatus);
  if (code.kind === "progress") return "IN_TRANSIT";
  return code.kind === "unknown" ? null : STAGE_STATUS[code.stage];
}
