# DermaScan ML service — FastAPI + PyTorch (CPU).
FROM python:3.12-slim

WORKDIR /app

# System deps for Pillow/numpy wheels are bundled; keep image lean.
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt ./
# CPU-only torch first (from the PyTorch CPU index), then the rest.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision \
 && pip install -r requirements.txt

COPY app.py ./
COPY models/ ./models/
COPY static/ ./static/

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
