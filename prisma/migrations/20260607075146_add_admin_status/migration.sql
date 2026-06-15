-- AlterEnum
ALTER TYPE "e_user_status" ADD VALUE 'ADMIN';

-- AlterTable
ALTER TABLE "user" ALTER COLUMN "status" SET DEFAULT 'PENDING';
