-- CreateEnum
CREATE TYPE "e_user_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "status" "e_user_status" NOT NULL DEFAULT 'PENDING';

-- Backfill: all existing users were already using the app, so mark them APPROVED
UPDATE "user" SET status = 'APPROVED';
