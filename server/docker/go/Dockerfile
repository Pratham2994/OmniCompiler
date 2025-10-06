# server/docker/Dockerfile.go
FROM golang:1.22-alpine

# utilities for interactive runs: script (util-linux), stdbuf (coreutils), certs
RUN apk add --no-cache coreutils util-linux ca-certificates

# create non-root; Alpine uses adduser syntax
RUN adduser -D runner
WORKDIR /work
# Ensure Go is on PATH for login shells and provide fallbacks for direct invocation
# Alpine's /bin/sh -l resets PATH via /etc/profile, so we add a profile.d entry.
# Also add symlinks to /usr/bin for robustness.
RUN printf '%s\n' 'export PATH=/usr/local/go/bin:/go/bin:$PATH' > /etc/profile.d/golang.sh \
    && chmod 644 /etc/profile.d/golang.sh \
    && if [ -x /usr/local/go/bin/go ] && [ ! -e /usr/bin/go ]; then ln -s /usr/local/go/bin/go /usr/bin/go; fi \
    && if [ -x /usr/local/go/bin/gofmt ] && [ ! -e /usr/bin/gofmt ]; then ln -s /usr/local/go/bin/gofmt /usr/bin/gofmt; fi
USER runner

# cd to docker folder
# build command: docker build -t omni-runner:go ./go
