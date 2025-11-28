
FROM debian:stable-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      g++ g++-12 make cmake ca-certificates \
      gdb python3 python3-venv \
      libstdc++-12-dev && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m runner


RUN ln -s /usr/bin/python3 /usr/bin/python



ENV PYTHONUNBUFFERED=1

WORKDIR /work
USER runner




