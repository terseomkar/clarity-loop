# Production-style image for Clarity Loop. Usually run via docker-compose.yml.
# `.dockerignore` keeps `.env` (API key), `.venv/`, tests and docs out of the image.
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
