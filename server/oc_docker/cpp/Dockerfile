# server/docker/Dockerfile.cpp
FROM debian:stable-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      g++ g++-12 make cmake ca-certificates \
      gdb python3 python3-venv \
      libstdc++-12-dev && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m runner

# Ensure `python` is available (shim uses python)
RUN ln -s /usr/bin/python3 /usr/bin/python

# The GDB pretty-printers part has been removed as requested.

ENV PYTHONUNBUFFERED=1

WORKDIR /work
USER runner

# cd to docker folder
# build command: docker build -t omni-runner:cpp ./cpp/

# eg run command: docker run --rm -it --network none --cpus 1 --memory 512m --pids-limit 256 -v .\test_code\:/work:rw -w /work omni-runner:cpp /bin/sh -lc 'g++ -O2 filename.cpp -o app && ./app'