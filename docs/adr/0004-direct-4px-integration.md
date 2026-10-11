# ADR-0004: Track 4PX parcels through 4PX's own API

- Status: **Proposed**. The client is built and tested against 4PX's documented format; it becomes
  the default once we have keys and the trial below confirms the unverified points.
- Date: 2026-10-11

## Context

ADR-0003 chose a tracking aggregator because 4PX's own API needs keys we did not have. Two things
have changed since:

1. **The aggregators are weaker than ADR-0003 assumed.** Checked against each provider's current
   documentation (October 2026):
   - AfterShip has no free API tier (Premium from about $59/month). Its handoff field changed in
     API version 2025-01 (`next_couriers` became `last_mile`), so our adapter never saw a handoff.
     Fixed in this change.
   - Ship24's free plan is 10 parcels a month; detecting the last-mile number is listed as a paid
     feature. Its event times without an offset are the carrier's local time, which our adapter
     read as UTC (8-9 hours off for the handoff gap). Fixed in this change.
   - 17TRACK gives new accounts 200 numbers once, then it is paid. It names the last-mile number in
     `misc_info.local_number`, which our adapter ignored. Fixed in this change.
   - None of them can be relied on to show Sagawa's number early: it depends on detection rules
     they do not publish.
2. **4PX documents what we need.** `tr.order.tracking.get` on the 4PX Open Platform returns every
   4PX scan with an official status code (`businessLinkCode`, 429 codes, 12 marked as key
   milestones), plus `serverName` and `serverNum`: the last-mile carrier and its tracking number.
   That number is exactly what staff copy from 4PX's website today.

Sources: 4PX API detail page https://open.4px.com/apiInfo/detail?id=25, status code table
https://open.4px.com/v2/help/customdata?ids=help-data,21, merchant guide
https://open.4px.com/v2/help/point?ids=help-point,business; aggregator documentation as linked in
ADR-0003.

## Decision

Add 4PX's own API as the first source, keep the aggregators as fallbacks, and judge both on the same
real numbers before switching the worker over.

- `packages/carriers/src/fourpx` is a direct client: request signing (MD5 over the sorted system
  parameters, the exact JSON body and the app secret, as in 4PX's merchant guide; the guide's worked
  example is a unit test), response validation with Zod, and a classification of all 429 codes
  into journey stages and statuses (`codes.ts`, checked against the full official table).
- **A handoff needs evidence.** 4PX can assign the last-mile number when the order is created, long
  before the handover. The client reports a handoff only once a handover-or-later code exists
  (`FPX_D_STPP`, `FPX_O_RR`, delivery codes); before that the number is shown as "planned".
- **Live lookups** (`/track`) ask 4PX first when keys are set, then Ship24, 17TRACK and AfterShip,
  and store the answer for 15 minutes so reloads cost nothing. Sample numbers (`4PXDEMO1xxx`)
  replay invented journeys written with real 4PX codes, so the page can be shown without keys; they
  never answer for real numbers.
- **Journey stages** (`packages/domain/src/journey.ts`) are computed from any source the same way:
  milestones, the time each segment took, the handoff gap, typical times learnt from our own
  delivered parcels, an estimate from those typical times (plain medians, in line with ADR-0001's
  "no ML"), and insights phrased as next steps.
- The worker keeps using whatever `Carrier.adapter` says. Switching 4PX polling to the direct API is
  a data change: `UPDATE "Carrier" SET adapter = '4px' WHERE code = '4PX';`.

## Trial

With keys in `.env`, `pnpm trial:4px` runs the numbers in `data/trial-numbers.txt` through 4PX and
every configured aggregator and prints one comparison table (ADR-0003's columns). It settles the
points the documentation leaves open:

- whether `serverName`/`serverNum` are filled for our Japan channel (S5058), and from when;
- the time zone of `occurDatetime` when `timeZone` is empty (the client assumes China time);
- whether 4PX relays Sagawa's own scans (`FPX_O_RR`, `FPX_D_SD`, `FPX_S_OK`) for our parcels;
- whether a merchant key covers all our parcels (if they are booked under another company's 4PX
  account, access goes through 4PX's partner OAuth route instead).

## Consequences

- No third party sits between us and 4PX, and no aggregator quota limits how many parcels we can
  follow. Sagawa's own scans still need Sagawa's site or an aggregator unless 4PX relays them.
- The keys are secrets: `.env` locally, the Kubernetes Secret or `.env.prod` in deployment, never
  the repo or the database. The web container now also needs them, for live lookups.
- If 4PX changes its codes, unknown codes are stored, shown and reported as "unrecognised", exactly
  like unknown carrier messages (ADR-0002), and the code table gets a new entry.
