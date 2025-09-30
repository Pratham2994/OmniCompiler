# server/docker/Dockerfile.node
FROM node:20-slim

ENV NODE_PATH=/usr/local/lib/node_modules
RUN npm i -g lodash dayjs uuid chalk

RUN useradd -m runner
WORKDIR /work
USER runner

# cd to docker folder
# build command: docker build -t omni-runner:node ./javascript