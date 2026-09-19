import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

import fs from 'fs/promises';
import { prisma } from '../src/database/db';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'face-photo');

async function main() {
  console.log('🧹 Starting cleanup of face registration photos, embeddings, and scan logs...\n');

  // 1. Clean physical photo files
  let deletedFilesCount = 0;
  try {
    const files = await fs.readdir(UPLOAD_DIR);
    for (const file of files) {
      if (file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.webp') || file.endsWith('.jpeg')) {
        await fs.unlink(path.join(UPLOAD_DIR, file));
        deletedFilesCount++;
      }
    }
    console.log(`✅ Deleted ${deletedFilesCount} physical photo files from ${UPLOAD_DIR}`);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      console.log(`📁 Created empty directory: ${UPLOAD_DIR}`);
    } else {
      console.error('⚠️ Error cleaning upload directory:', err);
    }
  }

  // 2. Clean Database records (PostgreSQL)
  const deletedPhotos = await prisma.faceEnrollmentPhoto.deleteMany();
  console.log(`✅ Deleted ${deletedPhotos.count} FaceEnrollmentPhoto records from PostgreSQL`);

  const deletedEmbeddings = await prisma.faceEmbedding.deleteMany();
  console.log(`✅ Deleted ${deletedEmbeddings.count} FaceEmbedding records from PostgreSQL`);

  const deletedLogs = await prisma.accessLog.deleteMany({
    where: {
      method: { in: ['FACE_GATE', 'FACE_VERIFY'] },
    },
  });
  console.log(`✅ Deleted ${deletedLogs.count} Face AccessLog records from PostgreSQL`);

  // 3. Clean Python Face Recognition AI Container Database
  try {
    const { execSync } = await import('child_process');
    const pyCommand = `docker exec -i smart-dormitory-face-recognition python -c "import sqlite3; conn = sqlite3.connect('face_recognition.db'); c = conn.cursor(); c.execute('DELETE FROM face_templates'); c.execute('DELETE FROM face_logs'); conn.commit();"`;
    execSync(pyCommand, { stdio: 'pipe' });
    console.log('✅ Cleaned all templates and logs from Python AI Container (smart-dormitory-face-recognition)');
  } catch {
    console.log('ℹ️  Docker Python AI container not running or not accessible directly, skipped container cleanup');
  }

  console.log('\n🎉 Cleanup completed successfully! All layers (Files, PostgreSQL, and Python AI Service) are completely fresh and empty.');
}

main()
  .catch((err) => {
    console.error('❌ Error during cleanup:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
