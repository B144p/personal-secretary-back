import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [email, name] = process.argv.slice(2).map((a) => a.trim());
  if (!email || !name) {
    console.error('Usage: npm run revoke-pat -- <email> <token-name>');
    process.exit(1);
  }

  const { count } = await prisma.personalAccessToken.updateMany({
    where: { name, revoked_at: null, user: { email } },
    data: { revoked_at: new Date() },
  });

  console.log(
    count > 0
      ? `Revoked ${count} token(s) named "${name}" for ${email}.`
      : `No active token named "${name}" for ${email}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
