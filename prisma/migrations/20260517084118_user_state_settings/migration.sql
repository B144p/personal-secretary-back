-- AlterTable
ALTER TABLE "user_state" ADD COLUMN     "days_off" INTEGER[] DEFAULT ARRAY[0]::INTEGER[],
ADD COLUMN     "special_days" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "time_zone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
ADD COLUMN     "working_hours_end" TEXT NOT NULL DEFAULT '20:00',
ADD COLUMN     "working_hours_start" TEXT NOT NULL DEFAULT '10:00';
