-- CreateTable
CREATE TABLE "daily_feedback" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status_changes" JSONB NOT NULL,
    "context_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_event" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "google_event_id" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_feedback_plan_id_created_at_idx" ON "daily_feedback"("plan_id", "created_at");

-- AddForeignKey
ALTER TABLE "daily_feedback" ADD CONSTRAINT "daily_feedback_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_event" ADD CONSTRAINT "task_event_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index: only one active TaskEvent per task at any time
CREATE UNIQUE INDEX "task_event_task_id_active_unique" ON "task_event"("task_id") WHERE is_active = true;
