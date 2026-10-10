-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'SHIPPED', 'IN_TRANSIT', 'HANDED_OFF', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'RETURNED');

-- CreateEnum
CREATE TYPE "HandoffSource" AS ENUM ('CARRIER_EVENT', 'MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('CARRIER', 'AGGREGATOR', 'MANUAL', 'FAKE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('VIEWER', 'OPERATOR', 'ADMIN');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceOrderNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "destinationCountry" TEXT NOT NULL,
    "destinationPostcode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "lastEventAt" TIMESTAMP(3),
    "stuckSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "overrideStatus" "ShipmentStatus",
    "overrideReason" TEXT,
    "overrideBy" TEXT,
    "overrideAt" TIMESTAMP(3),

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Leg" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "carrierCode" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Leg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Handoff" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "fromLegId" TEXT NOT NULL,
    "toLegId" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "source" "HandoffSource" NOT NULL,

    CONSTRAINT "Handoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL,
    "legId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "rawMessage" TEXT NOT NULL,
    "location" TEXT,
    "normalisedStatus" "ShipmentStatus" NOT NULL,
    "source" "EventSource" NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Carrier" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pollIntervalMinutes" INTEGER NOT NULL DEFAULT 240,

    CONSTRAINT "Carrier_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_sourceSystem_sourceOrderNumber_key" ON "Order"("sourceSystem", "sourceOrderNumber");

-- CreateIndex
CREATE INDEX "Shipment_status_idx" ON "Shipment"("status");

-- CreateIndex
CREATE INDEX "Shipment_stuckSince_idx" ON "Shipment"("stuckSince");

-- CreateIndex
CREATE INDEX "Leg_carrierCode_trackingNumber_idx" ON "Leg"("carrierCode", "trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Leg_shipmentId_sequence_key" ON "Leg"("shipmentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Handoff_fromLegId_key" ON "Handoff"("fromLegId");

-- CreateIndex
CREATE UNIQUE INDEX "Handoff_toLegId_key" ON "Handoff"("toLegId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingEvent_legId_occurredAt_rawMessage_key" ON "TrackingEvent"("legId", "occurredAt", "rawMessage");

-- CreateIndex
CREATE INDEX "AuditEntry_entityType_entityId_idx" ON "AuditEntry"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Leg" ADD CONSTRAINT "Leg_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Leg" ADD CONSTRAINT "Leg_carrierCode_fkey" FOREIGN KEY ("carrierCode") REFERENCES "Carrier"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_fromLegId_fkey" FOREIGN KEY ("fromLegId") REFERENCES "Leg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_toLegId_fkey" FOREIGN KEY ("toLegId") REFERENCES "Leg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_legId_fkey" FOREIGN KEY ("legId") REFERENCES "Leg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
