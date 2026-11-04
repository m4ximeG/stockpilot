FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
RUN useradd -r -u 10001 -m stockpilot && mkdir -p /data && chown -R stockpilot:stockpilot /data
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py push_service.py backup_service.py gunicorn_conf.py ./
COPY static/ ./static/
# Vérifie pendant le build le même import que Gunicorn au démarrage.
# Utilise une base éphémère séparée : jamais le volume de production.
RUN STOCKPILOT_DATA_DIR=/tmp/stockpilot-docker-smoke \
    STOCKPILOT_ADMIN_PASSWORD=TestDockerBuildPassword2026 \
    python -c "import app; assert app.app.test_client().get('/healthz').status_code == 200" \
    && rm -rf /tmp/stockpilot-docker-smoke
# Cache the licensed storm photograph inside the image for stable NAS rendering.
# The app has a remote CSS fallback if the photo host is unavailable during build.
RUN python -c "import urllib.request; u='https://images.pexels.com/photos/39914828/pexels-photo-39914828/free-photo-of-stunning-thunderstorm-over-rural-wheat-field.png?auto=compress&dpr=1&w=2200'; r=urllib.request.Request(u, headers={'User-Agent':'Mozilla/5.0 StockPilot'}); data=urllib.request.urlopen(r,timeout=12).read(); assert len(data)>5000; open('/app/static/aurora-storm.jpg','wb').write(data)" || true
USER stockpilot
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=3)" || exit 1
CMD ["gunicorn", "--config", "gunicorn_conf.py", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "8", "--timeout", "60", "app:app"]
