import { PrismaClient } from '@prisma/client';
import { generatePat, hashPat } from '../src/common/auth/pat';

const prisma = new PrismaClient();

async function main() {
  const [email, name] = process.argv.slice(2).map((a) => a.trim());
  if (!email || !name) {
    console.error('Usage: npm run create-pat -- <email> <token-name>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  const token = generatePat();
  await prisma.personalAccessToken.create({
    data: { user_id: user.id, name, token_hash: hashPat(token) },
  });

  console.log(`Token "${name}" created for ${email}.`);
  console.log('Copy it now — it is not stored and cannot be shown again:\n');
  console.log(token);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
