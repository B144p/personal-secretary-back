-- AlterTable
ALTER TABLE "user" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "ai_setting" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "model_plan_generation" TEXT NOT NULL DEFAULT 'gpt-5',
    "model_regeneration" TEXT NOT NULL DEFAULT 'gpt-5',
    "model_scheduling" TEXT NOT NULL DEFAULT 'gpt-5-nano',

    CONSTRAINT "ai_setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_setting_user_id_key" ON "ai_setting"("user_id");

-- AddForeignKey
ALTER TABLE "ai_setting" ADD CONSTRAINT "ai_setting_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
