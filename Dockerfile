FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
RUN useradd -r -u 10001 -m stockpilot && mkdir -p /data && chown -R stockpilot:stockpilot /data
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY static/ ./static/
# Cache the licensed storm photograph inside the image for stable NAS rendering.
# The app has a remote CSS fallback if the photo host is unavailable during build.
RUN python -c "import urllib.request; u='https://images.pexels.com/photos/39914828/pexels-photo-39914828.jpeg?auto=compress&cs=tinysrgb&w=2200'; r=urllib.request.Request(u, headers={'User-Agent':'Mozilla/5.0 StockPilot'}); data=urllib.request.urlopen(r,timeout=12).read(); assert len(data)>5000; open('/app/static/aurora-storm.jpg','wb').write(data)" || true
USER stockpilot
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=3)" || exit 1
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "8", "--timeout", "60", "app:app"]
