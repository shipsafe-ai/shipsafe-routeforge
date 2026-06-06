FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    "google-adk==2.1.0" \
    "google-genai>=1.16.0" \
    "google-cloud-secret-manager==2.22.0" \
    "fastapi>=0.111.0" \
    "uvicorn[standard]>=0.29.0" \
    "httpx>=0.27.0" \
    "structlog>=24.1.0" \
    "arize-phoenix-otel==0.16.1" \
    "openinference-instrumentation-google-adk==0.1.15" \
    "opentelemetry-exporter-otlp-proto-http>=1.24.0"

RUN pip install --no-cache-dir --no-deps \
    "git+https://github.com/shipsafe-ai/shipsafe-shared.git@v0.1.0"

COPY agent/ agent/
COPY fixtures/ fixtures/

EXPOSE 8080

CMD ["python", "-m", "uvicorn", "agent.webhooks:app", "--host", "0.0.0.0", "--port", "8080"]
