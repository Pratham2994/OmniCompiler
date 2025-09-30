# server/docker/Dockerfile.python
FROM python:3.12-slim

ENV PIP_NO_CACHE_DIR=1
RUN useradd -m runner && \
    apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# curated safe/common scientific libs (no net/ML/GUI stacks)
RUN pip install --no-cache-dir \
      "numpy==1.*" \
      "pandas==2.*" \
      "sympy==1.*" \
      "networkx==3.*"

WORKDIR /work
USER runner

# cd to docker folder
# build command: docker build -t omni-runner:python ./python

# eg run command: docker run --rm -it --network none --cpus 1 --memory 512m --pids-limit 256 -v .\test_code\:/work:ro -w /work omni-runner:python python filename.py 