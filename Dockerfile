# --- STAGE 1: Prune workspace ---
FROM node:22-alpine AS pruner
# Define the argument in every stage it is needed
ARG APP_NAME
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo
COPY . .
# Dynamically prune based on the passed argument
RUN turbo prune ${APP_NAME} --docker

# --- STAGE 2: Install dependencies & Build ---
FROM node:22-alpine AS builder
ARG APP_NAME
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV TURBO_TELEMETRY_DISABLED=1
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/package-lock.json ./package-lock.json
RUN npm ci

COPY --from=pruner /app/out/full/ .
# Dynamically build only the targeted application
RUN npx turbo run build --filter=${APP_NAME}

# --- STAGE 3: Production Runner ---
FROM node:22-alpine AS runner
# Re-declare the argument for the runtime environment paths
ARG APP_NAME
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 fastify
USER fastify

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
# Dynamically copy only the built application directory
COPY --from=builder /app/apps/${APP_NAME} ./apps/${APP_NAME}

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

# Save the build argument to an environment variable so the CMD string can read it
ENV TARGET_APP=${APP_NAME}
CMD ["sh", "-c", "npx tsx apps/${TARGET_APP}/src/index.ts"]
