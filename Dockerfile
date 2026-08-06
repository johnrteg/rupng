# Single, parameterized Dockerfile for every node service.
#   docker build --build-arg APP_NAME=auth --build-arg APP_PATH=core/auth -t rupapp-auth .
#
# APP_NAME = workspace package name (turbo filter, e.g. "auth")
# APP_PATH = path under /apps incl. domain group (e.g. "core/auth")
#
# Services are esbuild-bundled into a SELF-CONTAINED apps/<path>/bin/index.js (all @repo/*
# and app deps inlined), so the runtime image needs only: that bundle, the app's
# package.json (read at startup), and node_modules for the externalized ajv/ajv-formats.

# --- STAGE 1: Prune the workspace to just the target service -------------------
FROM node:22-alpine AS pruner
ARG APP_NAME
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune ${APP_NAME} --docker

# --- STAGE 2: Install + build (esbuild bundle), then drop dev deps -------------
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
RUN npx turbo run build --filter=${APP_NAME}

# The bundle is self-contained; strip dev tooling (esbuild/tsx/typescript/@types) from
# node_modules. ajv/ajv-formats are prod deps and remain (the bundle externalizes them).
RUN npm prune --omit=dev

# --- STAGE 3: Slim runtime -----------------------------------------------------
FROM node:22-alpine AS runner
ARG APP_PATH
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 fastify

# Normally: prod node_modules (for ajv), the app's package.json (loadPackageInfo reads it), and the
# bundle itself — no packages/ or app src, since every @repo/* import is inlined into the bundle by
# esbuild. The ONE exception: a runtime dynamic import with a NON-LITERAL specifier (e.g. media's
# optional `@remotion/*` + `@repo/studio-composition` Chromium render path) can't be statically
# inlined, so it resolves via node_modules at runtime — and since `@repo/*` packages are WORKSPACE
# SYMLINKS (node_modules/@repo/x -> ../../packages/x), that symlink is dangling unless packages/ is
# also copied. `turbo prune` already scoped packages/ to just this app's dependency graph, so this
# is small and safe to include for every service.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/${APP_PATH}/package.json ./apps/${APP_PATH}/package.json
COPY --from=builder /app/apps/${APP_PATH}/bin ./apps/${APP_PATH}/bin

# /app is root-owned from the COPY steps above; a service that writes under its own tree at runtime
# (e.g. media's Remotion render — webpack's bundle cache, and Chromium's one-time download, both
# default to a path under here) needs the non-root runtime user to actually own it.
RUN chown -R fastify:nodejs /app

USER fastify
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
ENV TARGET_APP=${APP_PATH}
# Run the self-contained, esbuild-bundled service on plain node (no tsx in production).
CMD ["sh", "-c", "node apps/${TARGET_APP}/bin/index.js"]
