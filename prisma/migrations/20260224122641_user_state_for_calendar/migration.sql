-- CreateTable
CREATE TABLE "user_state" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "last_calendar_sync" TIMESTAMP(3),

    CONSTRAINT "user_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_state_userId_key" ON "user_state"("userId");

-- AddForeignKey
ALTER TABLE "user_state" ADD CONSTRAINT "user_state_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
