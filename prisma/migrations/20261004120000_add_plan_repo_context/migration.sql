-- AlterTable
ALTER TABLE "plan" ADD COLUMN     "branch" TEXT,
ADD COLUMN     "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "parent_plan_id" TEXT,
ADD COLUMN     "repo_key" TEXT;

-- CreateIndex
CREATE INDEX "plan_user_id_repo_key_idx" ON "plan"("user_id", "repo_key");

-- AddForeignKey
ALTER TABLE "plan" ADD CONSTRAINT "plan_parent_plan_id_fkey" FOREIGN KEY ("parent_plan_id") REFERENCES "plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: existing plans get their last update as last activity.
UPDATE "plan" SET "last_activity_at" = "update_at";

-- Backfill: Claude Code plans stored the origin URL (or repo path) in source_id.
-- Same normalization as src/plan/repo-key.ts: scp-style and URL remotes become host/owner/repo.
UPDATE "plan"
SET "repo_key" = COALESCE(NULLIF(regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace("source_id", '^[a-z+]+://([^@/]+@)?', ''),
    '^[^@/]+@([^:/]+):', '\1/'),
  '\.git/?$', ''),
'/+$', ''), ''), "source_id")
WHERE "source_type" = 'CLAUDE_CODE' AND "source_id" IS NOT NULL;
