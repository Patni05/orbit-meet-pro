-- CreateEnum
CREATE TYPE "PresenceCheckState" AS ENUM ('NOT_ASKED', 'ALLOWED', 'DENIED', 'REQUESTED', 'CONFIRMED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "cameraLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cohostsManageTodos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hostOnlyExit" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "micLocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MeetingParticipant" ADD COLUMN     "presenceCheck" "PresenceCheckState" NOT NULL DEFAULT 'NOT_ASKED',
ADD COLUMN     "presenceCheckedAt" TIMESTAMP(3),
ADD COLUMN     "presenceRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Recording" ADD COLUMN     "audioOnly" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "mimeType" TEXT;

-- CreateTable
CREATE TABLE "MeetingTodo" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingTodo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingTodo_meetingId_position_idx" ON "MeetingTodo"("meetingId", "position");

-- AddForeignKey
ALTER TABLE "MeetingTodo" ADD CONSTRAINT "MeetingTodo_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

