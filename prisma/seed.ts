import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.warn('ADMIN_EMAIL not set — skipping admin bootstrap.');
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!user) {
    console.warn(
      `Admin user not found (${adminEmail}) — log in first, then re-run the seed.`,
    );
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { status: 'APPROVED' },
  });
  console.log(`Admin approved: ${adminEmail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
