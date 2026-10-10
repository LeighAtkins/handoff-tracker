# ADR-0002: Status model and explicit handoffs

- Status: Accepted
- Date: 2026-10-10

## Context

A Shipment's journey crosses carriers. 4PX carries the parcel out of China, then hands it to
Sagawa, which gives it a new tracking number. Each carrier reports in its own words, and the two
histories overlap: Sagawa's first scans say "in transit" after 4PX has already said "handed over".

Staff need a single status they can trust, plus a reliable way to tell when a parcel has gone
quiet. The most common failure is a parcel that falls silent between two carriers.

## Decision

### One normalised status, derived from events

`Status` is one of PENDING, SHIPPED, IN_TRANSIT, HANDED_OFF, OUT_FOR_DELIVERY, DELIVERED,
EXCEPTION, RETURNED. Each TrackingEvent keeps its raw text plus a `normalisedStatus`, which the
Carriers context produces from a per-carrier mapping table. An unrecognised message gets
`null`: it is stored and shown, but it never changes status, and it can be re-normalised once
the mapping learns the message.

A Shipment's status is **derived** by replaying its events in time order through `transition`:

- Along the happy path, status only moves forward. A report that would move it backwards is
  recorded but ignored for status. This answers the question raised in PR #1: Sagawa's
  in-transit scans after a handoff normalise to `IN_TRANSIT` (which is what they mean for
  Sagawa), and the Shipment stays `HANDED_OFF` because that is further along.
- EXCEPTION and RETURNED can be reached from any non-terminal status.
- From EXCEPTION, any happy-path report resumes the journey (a customs hold that clears).
- DELIVERED and RETURNED are terminal.

Replaying the full history, instead of applying only the newest event, means late-arriving or
out-of-order events still produce the right answer. Histories are tens of events long, so
the cost does not matter.

A **manual override** (status + required reason + actor) replaces the derived status until it is
cleared. Overrides may move status in any direction, since correcting the carrier is their whole
purpose. Every override writes an AuditEntry.

### Handoffs are explicit entities, not inferred

A Handoff is a stored record connecting Leg n to Leg n+1, with a timestamp and a source
(CARRIER_EVENT, MANUAL, IMPORT). It is not worked out at read time from event text.

- Staff talk about "the handoff". It is the thing that goes wrong, so it deserves a name in the code.
- The new tracking number must be stored somewhere. It belongs to Leg n+1, and the Handoff
  is the record of how that Leg came to exist.
- Carriers rarely say "handed over" consistently. An operator who finds the Sagawa number in an
  email can record a MANUAL Handoff, and it carries the same weight as one detected from a
  carrier event.
- A recorded Handoff counts as a HANDED_OFF report at the moment it was detected, so status and
  stuck rules see it even if no carrier event said so.

### Stuck

A Shipment is stuck when it has had no new event for N days: 3 by default, and 5 straight after
a Handoff, until the receiving carrier reports its first event, because last-mile carriers often
lag. Terminal Shipments are never stuck. "Mark resolved" clears the flag until a new event starts
a fresh quiet period that runs past the threshold again.

## Consequences

- All status logic lives in `packages/domain` as pure functions over plain data. Persistence
  stores the effective status and `stuckSince` so lists can be filtered in SQL, and these are
  recomputed through the domain whenever a Shipment changes. The worker also recomputes them
  on a schedule, because time passing alone can make a Shipment stuck.
- If carriers ever report a genuine regression (e.g. "back in transit" after out-for-delivery),
  forward-only rules hide it from status, though not from the timeline. An operator override
  covers that rare case.
