FROM python:3.14-alpine

# Install dependencies sistem yang dibutuhkan Glances (termasuk pid/process monitor)
RUN apk add --no-cache \
    gcc \
    musl-dev \
    linux-headers \
    lm-sensors \
    wireless-tools

# Buat virtual environment agar path-nya persis seperti bawaan lama
RUN python -m venv /venv
ENV PATH="/venv/bin:$PATH"

# Install Glances + seluruh plugin web
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir glances[action,browser,cloud,cpuinfo,docker,export,graph,ip,network,online,psutil,snmp,web]

EXPOSE 61208
EXPOSE 61209

# Default opsi kosong, nanti diisi lewat docker run -e GLANCES_OPT="..."
ENV GLANCES_OPT=""

# Menggunakan shell form agar variabel $GLANCES_OPT bisa dieksekusi dengan benar
CMD sh -c "glances $GLANCES_OPT"