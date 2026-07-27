# One image, two possible processes: the Next.js web app or the LiveKit
# agent worker. Which one runs is decided by the CMD/start command the
# deploy target uses — see README.md's Deployment section.
#
# node:20-slim (Debian/glibc) rather than alpine: @livekit/rtc-node ships
# prebuilt native bindings that assume glibc, not musl.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/agent ./agent
COPY --from=build /app/lib ./lib
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.js ./next.config.js

EXPOSE 3000

# Default: the web app. Override the command to `npm run agent:start`
# for the worker process (Railway/Fly service config, or `docker run
# <image> npm run agent:start`).
CMD ["npm", "run", "start"]
