-- CreateEnum
CREATE TYPE "EEventCategory" AS ENUM ('DEEP_WORK', 'MEETING', 'CHORE', 'HEALTH', 'PERSONAL', 'UNKNOWN');

-- CreateTable
CREATE TABLE "category_rule" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "category" "EEventCategory" NOT NULL DEFAULT 'UNKNOWN',
    "tags" TEXT[],
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updateAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_rule_pkey" PRIMARY KEY ("id")
);
