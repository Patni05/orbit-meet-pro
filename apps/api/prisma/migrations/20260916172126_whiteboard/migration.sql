-- CreateEnum
CREATE TYPE "WhiteboardMode" AS ENUM ('EVERYONE', 'HOSTS_ONLY', 'SELECTED');

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "whiteboardAllowed" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "whiteboardDenied" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "whiteboardMode" "WhiteboardMode" NOT NULL DEFAULT 'EVERYONE';

-- CreateTable
CREATE TABLE "WhiteboardStroke" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "authorIdentity" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "points" DOUBLE PRECISION[],
    "text" TEXT,
    "seq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhiteboardStroke_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhiteboardStroke_meetingId_seq_idx" ON "WhiteboardStroke"("meetingId", "seq");

-- AddForeignKey
ALTER TABLE "WhiteboardStroke" ADD CONSTRAINT "WhiteboardStroke_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
