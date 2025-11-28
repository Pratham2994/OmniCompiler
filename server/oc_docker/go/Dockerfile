
FROM golang:1.22-alpine


RUN apk add --no-cache coreutils util-linux ca-certificates delve


RUN adduser -D runner
WORKDIR /work



RUN printf '%s\n' 'export PATH=/usr/local/go/bin:/go/bin:$PATH' > /etc/profile.d/golang.sh \
    && chmod 644 /etc/profile.d/golang.sh \
    && if [ -x /usr/local/go/bin/go ] && [ ! -e /usr/bin/go ]; then ln -s /usr/local/go/bin/go /usr/bin/go; fi \
    && if [ -x /usr/local/go/bin/gofmt ] && [ ! -e /usr/bin/gofmt ]; then ln -s /usr/local/go/bin/gofmt /usr/bin/gofmt; fi
USER runner



