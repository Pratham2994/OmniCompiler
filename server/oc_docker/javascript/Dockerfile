FROM node:20-slim


ENV NODE_PATH=/usr/local/lib/node_modules
ENV DEBIAN_FRONTEND=noninteractive



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
    ws \
    chance \
    crypto-js


COPY prompt-shim.js /opt/prompt-shim.js
ENV NODE_OPTIONS="--require /opt/prompt-shim.js"


RUN useradd -m runner
WORKDIR /work
USER runner
