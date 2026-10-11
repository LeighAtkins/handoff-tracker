-- CreateEnum
CREATE TYPE "LookupState" AS ENUM ('READY', 'PENDING', 'NOT_FOUND', 'ERROR');

-- CreateTable
CREATE TABLE "TrackingLookup" (
    "id" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "state" "LookupState" NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "lookedUpBy" TEXT NOT NULL,
    "lookedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLookup_trackingNumber_key" ON "TrackingLookup"("trackingNumber");

-- CreateIndex
CREATE INDEX "TrackingLookup_lookedUpAt_idx" ON "TrackingLookup"("lookedUpAt");
