import { describe, expect, it } from "vitest";
import { fedExEmailTime, fedExTrackRequestBody, parseFedExTrackEmail } from "./email";

/** FedEx's real reply (2026-10-26), trimmed to a few scans per parcel. */
const reply = `--------------------------------------------------------------------------------
  This tracking update has been requested by:

  Track shipments summary results:
--------------------------------------------------------------------------------

  Tracking number Status Date/Time Destination
  879041083962 Out for deliveryOct 26, 2026 7:52 AM RENNES, 35, FR
  879098990096 On the way Oct 26, 2026 6:05 AM ENZESFELD-LINDABRUNN, NO, AT
  878914048770 Returning to FedEx facilityOct 26, 2026 9:48 AM L HAY-LES-ROSES, 94, FR

  Track shipments detailed results:
--------------------------------------------------------------------------------

  Ship date :Oct 22, 2026

  Destination :RENNES, 35, FR

  Scheduled delivery :10/26/2026 8:00 pm

  Service type :FedEx International Connect Plus-Deliver Weekday

  Standard transit date :10/23/2026 by 8:00 pm

--------------------------------------------------------------------------------
  Tracking results as of Oct 26, 2026 8:53a GMT
--------------------------------------------------------------------------------

  Date/Time Activity/Location
  Oct 26, 2026 7:52 AM On FedEx vehicle for delivery
                                       ST JACQUES DE LA LANDE FR
  Oct 22, 2026 5:09 PM Picked up
                                       SHENZHEN CN
  Oct 22, 2026 2:58 AM Shipment information sent to FedEx

--------------------------------------------------------------------------------

  Ship date :Oct 23, 2026

  Destination :ENZESFELD-LINDABRUNN, NO, AT

  Scheduled delivery :10/29/2026 8:00 pm

  Service type :FedEx International Connect Plus-Deliver WeekdayIndirect Signature Required

--------------------------------------------------------------------------------
  Tracking results as of Oct 26, 2026 8:53a GMT
--------------------------------------------------------------------------------

  Date/Time Activity/Location
  Oct 26, 2026 6:05 AM Arrived at FedEx hub
                                       GRACE-HOLLOGNE BE
  Oct 23, 2026 5:21 PM Picked up
                                       SHENZHEN CN

--------------------------------------------------------------------------------

  Ship date :Oct 20, 2026

  Destination :L HAY-LES-ROSES, 94, FR

  Scheduled delivery :10/27/2026 8:00 pm

  Service type :FedEx International Connect Plus-Deliver WeekdayResidential Delivery

--------------------------------------------------------------------------------
  Tracking results as of Oct 26, 2026 8:53a GMT
--------------------------------------------------------------------------------

  Date/Time Activity/Location
  Oct 26, 2026 9:48 AM Delivery exception
                                       WISSOUS FR
  Oct 23, 2026 6:05 PM Delivery option requested

  Oct 23, 2026 9:11 AM Delivery exception
                                       WISSOUS FR

--------------------------------------------------------------------------------
  Summary results

  INVALID
  Please check the following numbers and resubmit.
  Caution! This email originated outside of FedEx.
--------------------------------------------------------------------------------
`;

describe("parseFedExTrackEmail", () => {
  const { parcels, invalid } = parseFedExTrackEmail(reply);

  it("reads every parcel's summary, even where FedEx runs the status into the date", () => {
    expect(parcels.map((p) => [p.trackingNumber, p.status, p.statusTime, p.destination])).toEqual([
      ["879041083962", "Out for delivery", "Oct 26, 2026 7:52 AM", "RENNES, 35, FR"],
      ["879098990096", "On the way", "Oct 26, 2026 6:05 AM", "ENZESFELD-LINDABRUNN, NO, AT"],
      [
        "878914048770",
        "Returning to FedEx facility",
        "Oct 26, 2026 9:48 AM",
        "L HAY-LES-ROSES, 94, FR",
      ],
    ]);
    expect(invalid).toEqual([]);
  });

  it("reads each parcel's scans oldest first, with their locations", () => {
    expect(parcels[0]!.scans).toEqual([
      {
        localTime: "Oct 22, 2026 2:58 AM",
        activity: "Shipment information sent to FedEx",
        location: null,
      },
      { localTime: "Oct 22, 2026 5:09 PM", activity: "Picked up", location: "SHENZHEN CN" },
      {
        localTime: "Oct 26, 2026 7:52 AM",
        activity: "On FedEx vehicle for delivery",
        location: "ST JACQUES DE LA LANDE FR",
      },
    ]);
    expect(parcels[2]!.scans.map((s) => [s.activity, s.location])).toEqual([
      ["Delivery exception", "WISSOUS FR"],
      ["Delivery option requested", null],
      ["Delivery exception", "WISSOUS FR"],
    ]);
  });

  it("reads the ship date, schedule and service, and only flags real deliveries", () => {
    expect(parcels[1]).toMatchObject({
      shipDate: "Oct 23, 2026",
      scheduledDelivery: "10/29/2026 8:00 pm",
      service: "FedEx International Connect Plus-Deliver WeekdayIndirect Signature Required",
      delivered: false,
    });
    const delivered = reply.replace("879098990096 On the way Oct", "879098990096 Delivered Oct");
    expect(parseFedExTrackEmail(delivered).parcels[1]!.delivered).toBe(true);
  });

  it("lists numbers FedEx does not know", () => {
    const withInvalid = reply.replace("  INVALID\n  Please", "  INVALID\n  123456789012\n  Please");
    expect(parseFedExTrackEmail(withInvalid).invalid).toEqual(["123456789012"]);
  });
});

describe("fedExEmailTime", () => {
  it("reads FedEx's 12-hour times", () => {
    expect(fedExEmailTime("Oct 26, 2026 7:52 AM")).toEqual(new Date("2026-10-26T07:52:00Z"));
    expect(fedExEmailTime("Oct 22, 2026 12:05 PM")).toEqual(new Date("2026-10-22T12:05:00Z"));
    expect(fedExEmailTime("Oct 22, 2026 12:05 AM")).toEqual(new Date("2026-10-22T00:05:00Z"));
    expect(fedExEmailTime("tomorrow")).toBeNull();
  });
});

describe("fedExTrackRequestBody", () => {
  it("puts one number per line and refuses more than 30", () => {
    expect(fedExTrackRequestBody(["1", "2"])).toBe("1\n2");
    expect(() => fedExTrackRequestBody(Array.from({ length: 31 }, String))).toThrow("at most 30");
  });
});
