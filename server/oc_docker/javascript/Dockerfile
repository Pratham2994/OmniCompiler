FROM node:20-slim

# Environment setup
ENV NODE_PATH=/usr/local/lib/node_modules
ENV DEBIAN_FRONTEND=noninteractive

# Install useful global npm packages (safe + lightweight)
# Each library chosen for pure JS implementation and no system deps.
RUN npm install -g \
    lodash \
    dayjs \
    uuid \
    chalk \
    readline-sync \
    esbuild \
    mathjs \
    big.js \
    decimal.js \
    validator \
    slugify \
    he \
    nanoid \
    json5 \
    dotenv \
    ramda \
    async \
    console-table-printer \
    cli-progress \
    lz-string \
    chance \
    crypto-js

# Add the prompt shim for browser-like input
COPY prompt-shim.js /opt/prompt-shim.js
ENV NODE_OPTIONS="--require /opt/prompt-shim.js"

# Lock down the container user and workspace
RUN useradd -m runner
WORKDIR /work
USER runner