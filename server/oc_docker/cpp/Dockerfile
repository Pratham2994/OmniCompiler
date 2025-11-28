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

# Enable libstdc++ pretty-printers for nicer STL display in gdb
RUN printf "python\nimport sys\nsys.path.insert(0, '/usr/share/gcc-12/python')\ntry:\n    from libstdcxx.v6.printers import register_libstdcxx_printers\n    register_libstdcxx_printers(None)\nexcept Exception as e:\n    print('libstdc++ printers not loaded:', e)\nend\n" > /home/runner/.gdbinit && \
    chown runner:runner /home/runner/.gdbinit

ENV PYTHONUNBUFFERED=1

WORKDIR /work
USER runner

# cd to docker folder
# build command: docker build -t omni-runner:cpp ./cpp/

# eg run command: docker run --rm -it --network none --cpus 1 --memory 512m --pids-limit 256 -v .\test_code\:/work:rw -w /work omni-runner:cpp /bin/sh -lc 'g++ -O2 filename.cpp -o app && ./app'
