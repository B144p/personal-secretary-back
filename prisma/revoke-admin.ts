import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const emails = process.argv
    .slice(2)
    .map((e) => e.trim())
    .filter(Boolean);
  if (emails.length === 0) {
    console.error('Usage: npm run revoke-admin -- email1@x.com email2@x.com');
    process.exit(1);
  }

  for (const email of emails) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.warn(`User not found: ${email} — skipping.`);
      continue;
    }
    if (user.status !== 'ADMIN') {
      console.warn(
        `User is not an admin: ${email} (status: ${user.status}) — skipping.`,
      );
      continue;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'REJECTED' },
    });
    console.log(`Admin revoked: ${email} (status set to REJECTED)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
