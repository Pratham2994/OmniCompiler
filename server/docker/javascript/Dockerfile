# server/docker/javascript/Dockerfile
FROM node:20-slim

ENV NODE_PATH=/usr/local/lib/node_modules

# Small, reliable deps
RUN npm i -g lodash dayjs uuid chalk readline-sync

# Prompt shim baked in and auto-required
COPY prompt-shim.js /opt/prompt-shim.js
ENV NODE_OPTIONS="--require /opt/prompt-shim.js"

# Lock down a bit
RUN useradd -m runner
WORKDIR /work
USER runner
