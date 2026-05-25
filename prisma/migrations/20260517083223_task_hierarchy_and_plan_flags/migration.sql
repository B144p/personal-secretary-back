/*
  Warnings:

  - The values [INPROGRESS] on the enum `ETaskStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `avartar_url` on the `user` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "EPlanStatus" ADD VALUE 'DONE';

-- AlterEnum
BEGIN;
CREATE TYPE "ETaskStatus_new" AS ENUM ('HOLD', 'PENDING', 'IN_PROGRESS', 'DONE');
ALTER TABLE "public"."task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "task" ALTER COLUMN "status" TYPE "ETaskStatus_new" USING ("status"::text::"ETaskStatus_new");
ALTER TYPE "ETaskStatus" RENAME TO "ETaskStatus_old";
ALTER TYPE "ETaskStatus_new" RENAME TO "ETaskStatus";
DROP TYPE "public"."ETaskStatus_old";
ALTER TABLE "task" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
ALTER TABLE "plan" ADD COLUMN     "is_paused" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "task" ADD COLUMN     "depth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "estimated_minutes" INTEGER,
ADD COLUMN     "parent_task_id" TEXT,
ADD COLUMN     "sequence_order" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "user" DROP COLUMN "avartar_url",
ADD COLUMN     "avatar_url" TEXT;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
