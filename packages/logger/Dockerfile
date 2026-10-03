# Builds the HCS logger alone. Build from the repository root:
#   docker build -f packages/logger/Dockerfile .
# Configure it with the variables in packages/logger/.env.example.

FROM node:22-slim AS build
WORKDIR /repo
# The lockfile covers every workspace, so install with the whole repository present.
COPY . .
# Husky's git hooks are for contributors, not images.
ENV HUSKY=0
RUN yarn install --immutable
RUN yarn workspace @sh/logger build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Dependencies install per workspace (nmHoistingLimits: workspaces), so the logger's own
# node_modules holds everything it needs at runtime.
COPY --from=build /repo/packages/logger/package.json ./
COPY --from=build /repo/packages/logger/node_modules ./node_modules
COPY --from=build /repo/packages/logger/dist ./dist
# Progress file. Optional to persist: on start the logger also reads the topic to see what it posted.
RUN mkdir -p /app/state && chown node:node /app/state
ENV LOGGER_STATE_FILE=/app/state/logger-state.json
USER node
CMD ["node", "dist/index.js"]
