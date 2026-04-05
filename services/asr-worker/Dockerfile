FROM python:3.10-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY services/asr-worker/requirements.txt services/asr-worker/requirements.txt
RUN pip install --no-cache-dir -r services/asr-worker/requirements.txt

COPY services/asr-worker/src services/asr-worker/src

CMD ["python3", "services/asr-worker/src/worker.py"]
