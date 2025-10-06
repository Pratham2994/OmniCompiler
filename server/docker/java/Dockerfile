# server/docker/Dockerfile.java
FROM eclipse-temurin:21-jdk-jammy

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

# ---- Safe, commonly useful libraries (standalone jars) ----
# Versions chosen for stability; adjust as you prefer.
ENV LIB_DIR=/opt/java-libs
RUN mkdir -p $LIB_DIR && \
    set -eux; \
    curl -fsSL -o $LIB_DIR/gson-2.10.1.jar \
      https://repo1.maven.org/maven2/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar; \
    curl -fsSL -o $LIB_DIR/picocli-4.7.6.jar \
      https://repo1.maven.org/maven2/info/picocli/picocli/4.7.6/picocli-4.7.6.jar; \
    curl -fsSL -o $LIB_DIR/jline-3.25.1.jar \
      https://repo1.maven.org/maven2/org/jline/jline/3.25.1/jline-3.25.1.jar; \
    curl -fsSL -o $LIB_DIR/jansi-2.4.1.jar \
      https://repo1.maven.org/maven2/org/fusesource/jansi/jansi/2.4.1/jansi-2.4.1.jar; \
    curl -fsSL -o $LIB_DIR/commons-lang3-3.14.0.jar \
      https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.14.0/commons-lang3-3.14.0.jar; \
    curl -fsSL -o $LIB_DIR/commons-io-2.15.1.jar \
      https://repo1.maven.org/maven2/commons-io/commons-io/2.15.1/commons-io-2.15.1.jar; \
    curl -fsSL -o $LIB_DIR/commons-math3-3.6.1.jar \
      https://repo1.maven.org/maven2/org/apache/commons/commons-math3/3.6.1/commons-math3-3.6.1.jar; \
    curl -fsSL -o $LIB_DIR/opencsv-5.9.jar \
      https://repo1.maven.org/maven2/com/opencsv/opencsv/5.9/opencsv-5.9.jar

# Put all JARs on the default classpath for convenience
ENV CLASSPATH=${LIB_DIR}/*:.

# Non-root user & workspace
RUN useradd -m runner
WORKDIR /work
USER runner

# Example:
# docker build -t omni-runner:java -f server/docker/Dockerfile.java server/docker
# docker run --rm -it -v "$PWD/test_code:/work" omni-runner:java bash
# javac Main.java && java Main
