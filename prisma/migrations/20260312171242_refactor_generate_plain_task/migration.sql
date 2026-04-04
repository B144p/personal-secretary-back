-- CreateEnum
CREATE TYPE "EPlanSourceType" AS ENUM ('GENERATE', 'CALENDAR');
CREATE TYPE "ETaskStatus" AS ENUM ('HOLD', 'PENDING', 'INPROGRESS', 'DONE');

-- RenameColumn
ALTER TABLE "plan" RENAME COLUMN "created_at" TO "create_at";
ALTER TABLE "task" RENAME COLUMN "created_at" TO "create_at";

-- AlterTable
ALTER TABLE "plan"
ADD COLUMN     "source_id" TEXT,
ADD COLUMN     "source_type" "EPlanSourceType",
ADD COLUMN     "update_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "user_id" TEXT NOT NULL;

-- drop unused columns
ALTER TABLE "task"
DROP COLUMN "estimated_hours",
DROP COLUMN "priority";

-- AlterTable
ALTER TABLE "task"
ADD COLUMN     "update_at" TIMESTAMP(3) NOT NULL;

-- convert status type
ALTER TABLE "task"
ALTER COLUMN "status"
TYPE "ETaskStatus"
USING status::text::"ETaskStatus";

-- set default
ALTER TABLE "task" ALTER COLUMN "status" SET DEFAULT 'HOLD';

-- CreateIndex
CREATE UNIQUE INDEX "plan_user_id_key" ON "plan"("user_id");

-- AddForeignKey
ALTER TABLE "plan"
ADD CONSTRAINT "plan_user_id_fkey"
FOREIGN KEY ("user_id")
REFERENCES "user"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- ChangeBehavior
ALTER TABLE "user_state" DROP CONSTRAINT "user_state_user_id_fkey";
ALTER TABLE "user_state"
ADD CONSTRAINT "user_state_user_id_fkey"
FOREIGN KEY ("user_id")
REFERENCES "user"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
