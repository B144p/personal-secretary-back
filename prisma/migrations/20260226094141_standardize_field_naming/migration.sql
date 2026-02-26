-- RenameColumn
ALTER TABLE "category_rule_keyword_tag"
RENAME COLUMN "categoryRuleId" TO "category_rule_id";

-- RenameColumn
ALTER TABLE "category_rule_keyword_tag"
RENAME COLUMN "tagId" TO "tag_id";

-- RenameColumn
ALTER TABLE "user"
RENAME COLUMN "avartarUrl" TO "avartar_url";

-- RenameColumn
ALTER TABLE "user_state"
RENAME COLUMN "userId" TO "user_id";

-- RenameIndex
ALTER INDEX "user_state_userId_key"
RENAME TO "user_state_user_id_key";

-- RenameForeignKey
ALTER TABLE "category_rule_keyword_tag"
RENAME CONSTRAINT "category_rule_keyword_tag_categoryRuleId_fkey" TO "category_rule_keyword_tag_category_rule_id_fkey";

-- RenameForeignKey
ALTER TABLE "category_rule_keyword_tag"
RENAME CONSTRAINT "category_rule_keyword_tag_tagId_fkey" TO "category_rule_keyword_tag_tag_id_fkey";

-- RenameForeignKey
ALTER TABLE "user_state"
RENAME CONSTRAINT "user_state_userId_fkey" TO "user_state_user_id_fkey";

