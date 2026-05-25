CREATE UNIQUE INDEX "one_scheduled_plan_per_user" ON "plan"(user_id) WHERE status = 'SCHEDULED';
