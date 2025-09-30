# server/docker/Dockerfile.cpp
FROM debian:stable-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      g++ make cmake ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m runner
WORKDIR /work
USER runner

# cd to docker folder
# build command: docker build -t omni-runner:cpp ./cpp/

# eg run command: docker run --rm -it --network none --cpus 1 --memory 512m --pids-limit 256 -v .\test_code\:/work:rw -w /work omni-runner:cpp /bin/sh -lc 'g++ -O2 filename.cpp -o app && ./app'