-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('DRAFT', 'RUNNING', 'ENDED');

-- CreateEnum
CREATE TYPE "QuizTimerMode" AS ENUM ('PER_QUESTION', 'TOTAL');

-- CreateEnum
CREATE TYPE "QuizFlow" AS ENUM ('ONE_AT_A_TIME', 'ALL_AT_ONCE');

-- CreateEnum
CREATE TYPE "QuizQuestionKind" AS ENUM ('SINGLE', 'MULTI', 'TRUE_FALSE');

-- CreateEnum
CREATE TYPE "QuizResultVisibility" AS ENUM ('LEADERBOARD_AND_ANSWERS', 'LEADERBOARD_ONLY', 'OWN_ONLY', 'HOST_ONLY');

-- CreateEnum
CREATE TYPE "QuizRevealMode" AS ENUM ('AFTER_EACH_QUESTION', 'AT_END', 'NEVER');

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "QuizStatus" NOT NULL DEFAULT 'DRAFT',
    "timerMode" "QuizTimerMode" NOT NULL DEFAULT 'TOTAL',
    "flow" "QuizFlow" NOT NULL DEFAULT 'ALL_AT_ONCE',
    "totalSeconds" INTEGER NOT NULL DEFAULT 300,
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT false,
    "shuffleOptions" BOOLEAN NOT NULL DEFAULT false,
    "negativeMarking" BOOLEAN NOT NULL DEFAULT false,
    "negativePoints" INTEGER NOT NULL DEFAULT 1,
    "allowLateJoin" BOOLEAN NOT NULL DEFAULT true,
    "allowAnswerChange" BOOLEAN NOT NULL DEFAULT false,
    "resultVisibility" "QuizResultVisibility" NOT NULL DEFAULT 'LEADERBOARD_AND_ANSWERS',
    "revealMode" "QuizRevealMode" NOT NULL DEFAULT 'AT_END',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "currentQuestionIndex" INTEGER NOT NULL DEFAULT 0,
    "currentQuestionEndsAt" TIMESTAMP(3),

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "QuizQuestionKind" NOT NULL DEFAULT 'SINGLE',
    "prompt" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 10,
    "seconds" INTEGER NOT NULL DEFAULT 30,
    "explanation" TEXT,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuizOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizParticipant" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "score" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "wrongCount" INTEGER NOT NULL DEFAULT 0,
    "unansweredCount" INTEGER NOT NULL DEFAULT 0,
    "timeTakenMs" INTEGER NOT NULL DEFAULT 0,
    "awayCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuizParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAnswer" (
    "id" TEXT NOT NULL,
    "quizParticipantId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "optionIds" TEXT[],
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "awarded" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuizAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quiz_meetingId_status_idx" ON "Quiz"("meetingId", "status");

-- CreateIndex
CREATE INDEX "QuizQuestion_quizId_position_idx" ON "QuizQuestion"("quizId", "position");

-- CreateIndex
CREATE INDEX "QuizOption_questionId_position_idx" ON "QuizOption"("questionId", "position");

-- CreateIndex
CREATE INDEX "QuizParticipant_quizId_score_idx" ON "QuizParticipant"("quizId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "QuizParticipant_quizId_participantId_key" ON "QuizParticipant"("quizId", "participantId");

-- CreateIndex
CREATE INDEX "QuizAnswer_questionId_idx" ON "QuizAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAnswer_quizParticipantId_questionId_key" ON "QuizAnswer"("quizParticipantId", "questionId");

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizOption" ADD CONSTRAINT "QuizOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizParticipant" ADD CONSTRAINT "QuizParticipant_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizParticipant" ADD CONSTRAINT "QuizParticipant_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MeetingParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAnswer" ADD CONSTRAINT "QuizAnswer_quizParticipantId_fkey" FOREIGN KEY ("quizParticipantId") REFERENCES "QuizParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAnswer" ADD CONSTRAINT "QuizAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
