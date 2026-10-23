FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    OAIU_DATA_DIR=/data
WORKDIR /app
COPY bot.py /app/bot.py
RUN mkdir -p /data
STOPSIGNAL SIGINT
CMD ["python", "-u", "bot.py"]
