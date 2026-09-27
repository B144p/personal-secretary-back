import { createHash, randomBytes } from 'crypto';

// Personal access tokens: `psk_` + 32 random bytes (base64url). Only the
// sha256 hash is stored — the token is high-entropy, so a slow hash (bcrypt)
// buys nothing, and a fast one keeps lookup a single indexed query.
export const PAT_PREFIX = 'psk_';

export const generatePat = () =>
  `${PAT_PREFIX}${randomBytes(32).toString('base64url')}`;

export const hashPat = (token: string) =>
  createHash('sha256').update(token).digest('hex');

// Returns the raw token from `Authorization: Bearer psk_…`, or null when the
// header is absent or carries something other than a PAT.
export const extractPat = (authorization: string | undefined) => {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.startsWith(PAT_PREFIX) ? token : null;
};
