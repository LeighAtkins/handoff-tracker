# Demo script: Handoff Tracker for the 4PX API request

About 8 minutes. The goal is a yes to [docs/4px-api-request.md](4px-api-request.md).

## Before the meeting

```sh
colima start          # Mac with Colima (or start Docker Desktop / OrbStack)
pnpm demo             # fresh demo data, production build, worker loop, app on :3100
```

Open http://localhost:3100 and use the developer login as `admin@example.com`. `pnpm demo` reseeds
every time, so the "stuck" parcels are stuck again and the live demo parcels start empty; the
worker fills them in within a few seconds of starting. `SKIP_BUILD=1 pnpm demo` restarts faster.

All parcels are invented (`DEMO-` orders, `4PXDEMO` numbers). If the room prefers Japanese, switch
with 日本語 in the top right: every screen is translated.

## 1. The problem, in one screen (Overview, 2 min)

- **Need attention** tile: stuck parcels and open problems today, with the next step for each.
- **4PX → Sagawa handoff** tile: most parcels are scanned by Sagawa within half a day…
- …but the **wait for Sagawa's first scan** chart has a long tail: parcels that waited 2–3 days or
  more. "That tail is where parcels get lost between the two carriers, and today nobody sees it
  until a customer writes in."
- **Where the time goes**: median and 80th percentile per stage, China to the customer's door.

## 2. One stuck parcel (2 min)

Click a **Stuck after the handoff** row under _Needs someone today_.

- The red insight says what happened and what to do: "Sagawa has not scanned it since the handoff
  … Ask Sagawa where it is (tracking number …)".
- The milestones show 4PX's handover and the missing Sagawa scan, with the days waiting.
- The Sagawa number has a copy button and a link to Sagawa's site: no more two-site look-ups.

## 3. Any parcel, live (2 min)

Open **Track** and pick the sample **Stuck after the handoff**, then **Missed delivery**.

- Each 4PX scan shows 4PX's own status code. 4PX's wording for the handover is
  "In transit, it's progressing through delivery network"; the code `FPX_D_STPP` is what tells us
  it is the handover. This is what 4PX's API gives us directly.
- The box **What 4PX's own API adds** is the bridge to the ask.

With aggregator keys in `.env`, paste a real 4PX number from today's shipments instead. If it says
_Fetching the first results_ (17TRACK registers new numbers first), use **Check again** after a
minute, or fall back to the sample.

## 4. The ask (2 min)

Open **Data sources**.

- The comparison table: by hand today, with an aggregator, with 4PX's API.
- Cost: aggregator free tiers are 10–200 parcels; 4PX's tracking API is documented as free for 4PX
  customers.
- **How we get the keys** and **What to ask our 4PX account manager**: the exact request.
- After the keys arrive: `pnpm trial:4px` on 10 real parcels decides the switch (criteria in the
  request note).

## If something goes wrong

| Symptom                                 | Fix                                                           |
| --------------------------------------- | ------------------------------------------------------------- |
| "Docker is not running"                 | `colima start`, then `pnpm demo` again                        |
| Port 3100 in use                        | stop the other server (`pnpm dev`) first                      |
| Signed out after a restart              | expected: the demo uses a fresh session secret; sign in again |
| A real number shows _No tracking found_ | new labels can take a day to appear; use a sample instead     |
