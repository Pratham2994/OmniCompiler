# server/docker/Dockerfile.go
FROM golang:1.22-alpine

# create non-root; Alpine uses adduser syntax
RUN adduser -D runner
WORKDIR /work
USER runner

# cd to docker folder
# build command: docker build -t omni-runner:go ./go
