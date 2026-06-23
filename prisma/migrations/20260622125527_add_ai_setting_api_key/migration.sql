-- AlterTable
ALTER TABLE "ai_setting" ADD COLUMN     "api_key_encrypted" TEXT;

-- AlterTable
ALTER TABLE "user" ALTER COLUMN "status" SET DEFAULT 'PENDING';
