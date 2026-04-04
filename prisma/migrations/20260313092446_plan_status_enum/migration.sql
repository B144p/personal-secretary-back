/*
  Warnings:

  - Added the required column `status` to the `plan` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "EPlanStatus" AS ENUM ('DRAFT', 'READY', 'SCHEDULED', 'HOLD');

-- AlterTable
ALTER TABLE "plan" ADD COLUMN     "status" "EPlanStatus" NOT NULL;
