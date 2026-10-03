-- AlterEnum
ALTER TYPE "ETaskStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "plan" ADD COLUMN     "import_key" TEXT;

-- AlterTable
ALTER TABLE "task" ADD COLUMN     "status_note" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "plan_user_id_import_key_key" ON "plan"("user_id", "import_key");
