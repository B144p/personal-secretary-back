# ---------------- Base node image ----------------
FROM node:20-alpine AS base
# openssl is required by Prisma's query engine on Alpine (musl)
RUN apk add --no-cache openssl
RUN npm i -g pnpm

# ---------------- Dependencies stage ----------------
FROM base AS dependencies

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------- Build stage ----------------
FROM base AS build
WORKDIR /app
COPY . .
COPY --from=dependencies /app/node_modules ./node_modules
RUN pnpm exec prisma generate
RUN pnpm build

# delete unnecessary package
RUN pnpm prune --prod

# ---------------- Final deploy image ----------------
FROM base AS deploy
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist/ ./dist/
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000
CMD [ "node", "dist/main.js" ]
