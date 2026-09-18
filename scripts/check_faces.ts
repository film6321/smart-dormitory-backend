import { prisma } from '../src/database/db';

async function main() {
  const users = await prisma.user.findMany({
    include: {
      tenant: true,
      faceEnrollmentPhotos: true,
      faceEmbeddings: true,
    }
  });

  console.log('=== ALL USERS ===');
  users.forEach(u => {
    console.log({
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      tenantName: u.tenant?.fullName,
      photosCount: u.faceEnrollmentPhotos.length,
      embeddingsCount: u.faceEmbeddings.length
    });
  });

  const photos = await prisma.faceEnrollmentPhoto.findMany({
    include: { user: { include: { tenant: true } }, visitor: true }
  });
  console.log('\n=== ALL FACE ENROLLMENT PHOTOS ===');
  photos.forEach(p => {
    console.log({
      id: p.id,
      userId: p.userId,
      visitorId: p.visitorId,
      username: p.user?.username,
      tenantName: p.user?.tenant?.fullName,
      role: p.user?.role,
      photoPath: p.photoPath,
      createdAt: p.createdAt
    });
  });

  const embeddings = await prisma.faceEmbedding.findMany({
    include: { user: { include: { tenant: true } }, visitor: true }
  });
  console.log('\n=== ALL FACE EMBEDDINGS ===');
  embeddings.forEach(e => {
    console.log({
      id: e.id,
      userId: e.userId,
      visitorId: e.visitorId,
      username: e.user?.username,
      tenantName: e.user?.tenant?.fullName,
      role: e.user?.role,
      modelVersion: e.modelVersion,
      createdAt: e.createdAt
    });
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
