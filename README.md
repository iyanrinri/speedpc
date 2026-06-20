# SpeedPC Unified Dashboard

SpeedPC is a comprehensive system monitoring tool designed to provide real-time insights into your machine's hardware, network, and external drives through a single, beautifully designed unified web dashboard.

## Features

1. **🏠 Unified Single-Page Application (SPA)**
   - Smooth navigation between tools without reloading the page.
   - Modern dark-mode aesthetics with glassmorphism UI.

2. **🌐 Network Traffic Monitor**
   - Real-time download (RX) and upload (TX) speed tracking.
   - Historical bandwidth charting powered by `Chart.js`.
   - Data stored persistently in SQLite to monitor traffic over 48 hours.

3. **💾 USB Speed Monitor**
   - Live polling for connected USB drives and removable media.
   - Automated Read/Write speed benchmarking (using `dd` and raw file writing).
   - Caches benchmarking results to prevent excessive wear on flash storage.

4. **🖥️ Deep System Stats (Glances)**
   - Embeds a powerful system monitor using [Glances](https://nicolargo.github.io/glances/).
   - Monitors CPU usage, RAM footprint, Disk I/O, process lists, and sensors.

## Architecture

The project is structured into containerized microservices:
- **`unified-dashboard/`**: A Node.js backend (Express + Socket.io) that runs both the Network and USB monitoring logic concurrently.
- **`glances/`**: A Python-based system monitor packed into a Docker container exposing a REST API and Web UI on port `61208`.
- **`docker-compose.yml`**: Automates bringing up the entire stack with necessary host volume mounts for accurate hardware polling.

## Installation & Usage

You need [Docker](https://www.docker.com/) and Docker Compose installed.

### 1. Build and Run
Because the Node.js application interacts directly with raw host hardware (like `/dev` for USB speed tests and `/proc/net/dev` for bandwidth tracking), the container needs to run in privileged mode and host network mode.

Run the following command from the root `speedpc` directory:
```bash
docker compose up -d --build
```
> **Note**: The build process compiles native C++ bindings (`sqlite3` and `drivelist`) from source to ensure complete compatibility with the container OS.

### 2. Access the Dashboard
Once the containers are running, open your web browser and navigate to:
```
http://localhost:8081
```

*(Optional) You can also access the standalone Glances interface directly at `http://localhost:61208`.*

## Troubleshooting

- **Segmentation Fault / GLIBC Error**: If the Node.js container crashes continuously, ensure you build with `--no-cache`. The `.dockerignore` prevents copying incompatible native `node_modules` from your host to the container.
- **Glances Not Loading**: If the System Monitor tab shows an empty frame, ensure the `speedpc_glances` container is running without errors in `docker ps`.
