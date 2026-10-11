# ADR-0003: Tracking aggregator

- Status: **Proposed**. Ship24 is the provisional default until the trial below has been run with real API keys.
- Date: 2026-10-10

## Context

P2 rules out scraping carrier sites, so live tracking comes from a tracking aggregator. The question
that matters for Comfort Works is narrow: **after 4PX hands a parcel to Sagawa, does the
aggregator show the Sagawa leg, and how soon?** If it does not, the app is no better than
opening the 4PX site.

What NOMS shows about real shipments (read-only check of orders shipped to Japan, 2026-10-10):

- 4PX shipments are booked on channel `4px:S5058`. NOMS stores either a `4PX…CN` number or a
  12-digit number that may already be Sagawa's.
- A second route, `takesend:SAGAWA`, stores a 12-digit Sagawa number directly. For these the
  first Leg is effectively Sagawa, and the CSV import maps them that way.

## Options

|                           | Ship24                                                                                             | 17TRACK                                                                                                             | AfterShip                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Model                     | One call creates the tracker and returns results (`POST /public/v1/trackers/track`)                | Register once, then poll `gettrackinfo`; results arrive asynchronously                                              | Create a tracking once, then read it back                                           |
| Multi-carrier journeys    | Events carry `courierCode` and `eventTrackingNumber`, so the last-mile number can appear per event | Origin and destination carriers appear as separate `providers`; `misc_info.local_number` names the last-mile number | `last_mile` names the last-mile carrier and number (`next_couriers` before 2025-01) |
| Free tier (as documented) | 10 shipments a month; last-mile number detection on paid plans (from $39/month per 1,000)          | One-time 200 numbers for new accounts, then paid; 3 req/s                                                           | No free API tier (from about $59/month)                                             |

All three are implemented behind `CarrierAdapter` (`packages/carriers/src/aggregators`), with
responses validated by Zod. Each adapter keeps only the events belonging to the Leg's carrier
and reports a handoff when a later carrier appears.

### Update, 2026-10-11

A check of each provider's current documentation found three adapter bugs, now fixed: AfterShip's
handoff field is `last_mile` since API version 2025-01 (we read the removed `next_couriers`), 17TRACK
names the last-mile number in `misc_info.local_number` (we reported the original number), and
Ship24's event times without an offset are the carrier's local time (we read them as UTC). The
free-tier row above is corrected. 4PX's own API turned out to document the last-mile number
directly; [ADR-0004](0004-direct-4px-integration.md) proposes using it first, with the aggregators
as fallbacks. The trial below now includes 4PX when its keys are set (`pnpm trial:4px`).

## Trial

`pnpm trial:aggregators` runs the same 10 real numbers from NOMS (5 `4PX…CN`, 5 12-digit,
kept in the gitignored `data/trial-numbers.txt`) through every aggregator that has a key set. It scores:

- tracked at all
- Sagawa leg appeared
- next (Sagawa) tracking number given
- median hours from 4PX's last event to Sagawa's first
- share of messages our normaliser does not recognise yet

Results:

> _Not run yet. Needs SHIP24_API_KEY, SEVENTEEN_TRACK_API_KEY and AFTERSHIP_API_KEY (free tiers).
> Paste the printed summary table here and settle the decision._

## Decision (provisional)

Use **Ship24** until the trial says otherwise:

- Its one-call create-and-fetch model suits a polling worker. There is no separate registration
  step to track, and no wait before the first poll returns anything.
- Per-event `eventTrackingNumber` is the most direct way to learn Sagawa's number, which is
  exactly the gap this app exists to fill.

Switching later is a data change, not a code change: set `Carrier.adapter` to `17track` or
`aftership` for 4PX and SAGAWA.

## Consequences

- If no aggregator shows the Sagawa leg reliably (the plan's highest-likelihood risk), the
  manual adapter, manual handoffs and the "last checked" column keep the tool useful. The gap
  gets documented honestly here.
- Free tiers are small: the worker polls each Leg at most once per carrier interval (default
  4 hours) and pauses a carrier on 429.
- Response shapes come from public docs and are covered by mocked tests. The trial is the first
  check against reality, so expect small adapter fixes after it.
