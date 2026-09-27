-- AlterEnum
ALTER TYPE "EPlanSourceType" ADD VALUE 'CLAUDE_CODE';

-- AlterTable
ALTER TABLE "user" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "personal_access_token" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "create_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_access_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "personal_access_token_token_hash_key" ON "personal_access_token"("token_hash");

-- CreateIndex
CREATE INDEX "personal_access_token_user_id_idx" ON "personal_access_token"("user_id");

-- AddForeignKey
ALTER TABLE "personal_access_token" ADD CONSTRAINT "personal_access_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
