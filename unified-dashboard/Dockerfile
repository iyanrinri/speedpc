FROM node:20-bookworm

# Install build tools, python, and dd/udev for disk benchmarking
RUN apt-get update && apt-get install -y \
    coreutils udev build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Force build from source so sqlite3 and drivelist compile against the container's GLIBC (fixes GLIBC_2.38 not found)
RUN npm install --build-from-source sqlite3 drivelist
RUN npm install

COPY . .

EXPOSE 8081

CMD ["node", "server.js"]
