-- DropForeignKey
ALTER TABLE "category_rule_keyword_tag" DROP CONSTRAINT "category_rule_keyword_tag_categoryRuleId_fkey";

-- DropForeignKey
ALTER TABLE "category_rule_keyword_tag" DROP CONSTRAINT "category_rule_keyword_tag_tagId_fkey";

-- AddForeignKey
ALTER TABLE "category_rule_keyword_tag" ADD CONSTRAINT "category_rule_keyword_tag_categoryRuleId_fkey" FOREIGN KEY ("categoryRuleId") REFERENCES "category_rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rule_keyword_tag" ADD CONSTRAINT "category_rule_keyword_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "category_rule_tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
