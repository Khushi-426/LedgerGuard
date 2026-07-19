FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5001
# If model.joblib isn't present (dataset not trained yet), the app still
# boots and serves a clear 503 on /predict rather than crashing the container.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5001"]
