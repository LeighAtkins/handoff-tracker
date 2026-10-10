-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "stuckResolvedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TrackingEvent" ALTER COLUMN "normalisedStatus" DROP NOT NULL;
