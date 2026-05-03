FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# 默认启动 FastAPI server；Telegram bot 通过 docker-compose command 覆盖
CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8000"]
