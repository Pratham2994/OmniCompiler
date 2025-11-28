

FROM python:3.12-slim

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    MPLCONFIGDIR=/tmp


RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      libxml2-dev libxslt1-dev \
      gcc g++ \
      && rm -rf /var/lib/apt/lists/*


RUN groupadd -g 1000 runner && useradd -m -u 1000 -g 1000 runner


RUN pip install --no-cache-dir \
    numpy==1.* pandas==2.* scipy==1.* sympy==1.* networkx==3.* \
    statsmodels==0.* scikit-learn==1.* joblib==1.* tqdm==4.* \
    python-dateutil==2.* pytz==2024.* lxml==5.* beautifulsoup4==4.* \
    typing-extensions dataclasses colorama==0.* tabulate==0.* rich==13.* \
    typer==0.* click==8.* ipython==8.* pdbpp==0.*


RUN pip install --no-cache-dir aiohttp==3.* httpx==0.* anyio==4.*

RUN pip install --no-cache-dir "debugpy>=1.8.1,<2.0"
RUN python -m pip uninstall -y dataclasses || true

WORKDIR /work
USER runner




