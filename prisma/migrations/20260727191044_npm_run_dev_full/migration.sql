-- CreateTable
CREATE TABLE "FaceEmbedding" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "visitorId" INTEGER,
    "vector" DOUBLE PRECISION[],
    "model_version" TEXT NOT NULL,
    "quality_score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceEnrollmentPhoto" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "visitorId" INTEGER,
    "photo_path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceEnrollmentPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FaceEmbedding_userId_idx" ON "FaceEmbedding"("userId");

-- CreateIndex
CREATE INDEX "FaceEmbedding_visitorId_idx" ON "FaceEmbedding"("visitorId");

-- CreateIndex
CREATE INDEX "FaceEnrollmentPhoto_userId_idx" ON "FaceEnrollmentPhoto"("userId");

-- CreateIndex
CREATE INDEX "FaceEnrollmentPhoto_visitorId_idx" ON "FaceEnrollmentPhoto"("visitorId");

-- AddForeignKey
ALTER TABLE "FaceEmbedding" ADD CONSTRAINT "FaceEmbedding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceEmbedding" ADD CONSTRAINT "FaceEmbedding_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceEnrollmentPhoto" ADD CONSTRAINT "FaceEnrollmentPhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceEnrollmentPhoto" ADD CONSTRAINT "FaceEnrollmentPhoto_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
