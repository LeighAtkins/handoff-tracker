-- AlterTable
ALTER TABLE "Carrier" ADD COLUMN     "pausedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Leg" ADD COLUMN     "lastCheckError" TEXT,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3);
