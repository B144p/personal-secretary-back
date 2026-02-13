/*
  Warnings:

  - You are about to drop the column `tags` on the `category_rule` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[keyword]` on the table `category_rule` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "category_rule" DROP COLUMN "tags";

-- CreateTable
CREATE TABLE "category_rule_tag" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "categoryRuleId" TEXT NOT NULL,

    CONSTRAINT "category_rule_tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_rule_keyword_key" ON "category_rule"("keyword");

-- AddForeignKey
ALTER TABLE "category_rule_tag" ADD CONSTRAINT "category_rule_tag_categoryRuleId_fkey" FOREIGN KEY ("categoryRuleId") REFERENCES "category_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
