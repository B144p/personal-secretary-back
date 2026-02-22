/*
  Warnings:

  - You are about to drop the column `createAt` on the `category_rule` table. All the data in the column will be lost.
  - You are about to drop the column `updateAt` on the `category_rule` table. All the data in the column will be lost.
  - You are about to drop the column `categoryRuleId` on the `category_rule_tag` table. All the data in the column will be lost.
  - You are about to drop the column `createAt` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `updateAt` on the `user` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[tag]` on the table `category_rule_tag` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `update_at` to the `category_rule` table without a default value. This is not possible if the table is not empty.
  - Added the required column `update_at` to the `category_rule_tag` table without a default value. This is not possible if the table is not empty.
  - Added the required column `update_at` to the `user` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "category_rule_tag" DROP CONSTRAINT "category_rule_tag_categoryRuleId_fkey";

-- AlterTable
ALTER TABLE "category_rule" DROP COLUMN "createAt",
DROP COLUMN "updateAt",
ADD COLUMN     "create_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "update_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "category_rule_tag" DROP COLUMN "categoryRuleId",
ADD COLUMN     "create_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "update_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "user" DROP COLUMN "createAt",
DROP COLUMN "updateAt",
ADD COLUMN     "create_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "update_at" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "category_rule_keyword_tag" (
    "tagId" TEXT NOT NULL,
    "categoryRuleId" TEXT NOT NULL,
    "create_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_rule_keyword_tag_pkey" PRIMARY KEY ("categoryRuleId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_rule_tag_tag_key" ON "category_rule_tag"("tag");

-- AddForeignKey
ALTER TABLE "category_rule_keyword_tag" ADD CONSTRAINT "category_rule_keyword_tag_categoryRuleId_fkey" FOREIGN KEY ("categoryRuleId") REFERENCES "category_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rule_keyword_tag" ADD CONSTRAINT "category_rule_keyword_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "category_rule_tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
