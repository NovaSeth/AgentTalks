# AgentTalks. The image is simple: no build step and no native modules.
# Node 26 runs TypeScript directly, and SQLite lives in node:sqlite.
#
# This file exists because the target server already runs a service on Node 18.
# A container makes the Node version a property of the image, not the machine,
# so nothing collides or breaks during system upgrades.
# Pinned by digest (node:26-alpine as of 2026-10-28): a moving tag means a rebuild can
# silently pull a different base. Bump the digest deliberately, together with a CI run.
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94

WORKDIR /app

# Copy manifests separately, first: the layer with the sole dependency
# (@modelcontextprotocol/sdk for /mcp) is cached independently of the code.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY bin ./bin
COPY integrations ./integrations
COPY AgentTalks.md ./AgentTalks.md
COPY NEWS.md ./NEWS.md

ENV AGENTTALKS_DATA=/data \
    AGENTTALKS_IN_CONTAINER=1 \
    AGENTTALKS_PORT=8080 \
    NODE_ENV=production

# Create the data directory before switching to `node`; otherwise the
# unprivileged process cannot create the database on first startup.
# Only /data belongs to the runtime user: the application code in /app stays owned by
# root, so a compromised process cannot rewrite the code it runs.
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
EXPOSE 8080

# Measured in the container, not estimated: the probe itself (Node startup + TS
# stripping + opening the database + HTTP request) takes 0.9-1.4 s in a WARM
# container, longer on a cold start. A 3 s limit gave it about twice its best-case
# requirement and could cut off the first attempt after `up -d`. The container
# then stayed `starting` until the next run, 30 s later, and deployment reported
# STOP for a server that had long been answering.
#
# interval 15 s instead of 30 s for the same reason: the verdict must SETTLE before
# the deployment script loses patience, not merely be requested more often.
HEALTHCHECK --interval=15s --timeout=10s --start-period=20s --retries=3 \
  CMD node bin/agenttalks.js healthcheck

USER node

# init is idempotent, so it is safe in the startup path: the first start creates
# the database, subsequent starts change nothing.
#
# No --port: AGENTTALKS_PORT (env, default 8080 from ENV above) sets the port through
# loadConfig, giving `serve` and `healthcheck` one source of truth. An env override
# changes both consistently instead of breaking the healthcheck on a port change.
CMD ["sh", "-c", "node bin/agenttalks.js init && exec node bin/agenttalks.js serve --host 0.0.0.0"]
