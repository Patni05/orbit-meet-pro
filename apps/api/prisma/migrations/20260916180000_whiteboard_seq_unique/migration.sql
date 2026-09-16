-- Two people drawing at the same instant must not land on the same sequence
-- number. Allocating it with a read-then-write is a race; this constraint makes
-- the database reject the loser so the service can retry with the next value.
CREATE UNIQUE INDEX "WhiteboardStroke_meetingId_seq_key"
  ON "WhiteboardStroke"("meetingId", "seq");
