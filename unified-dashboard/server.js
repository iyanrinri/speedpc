const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const chokidar = require('chokidar');
const drivelist = require('drivelist');
const { exec } = require('child_process');
const util = require('util');
const os = require('os');
const db = require('./db');

const execAsync = util.promisify(exec);

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Use port 8081 to avoid conflicts with existing services
const PORT = process.env.PORT || 8081;
const CACHE_FILE = path.join(__dirname, 'usb-cache.json');

app.use(express.static('public'));

// ==================== USB SPEED MONITORING ====================
let usbStatus = [];
let isTesting = false;

function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Error loading cache:', e);
    }
    return {};
}

function saveCache(cache) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e) {
        console.error('Error saving cache:', e);
    }
}

async function testDriveSpeed(mountPath, device) {
    const testFileSize = 50 * 1024 * 1024; // 50MB
    const tempFile = path.join(mountPath, 'speedtest.tmp');
    let writeSpeed = 0;
    let readSpeed = 0;

    if (process.platform === 'linux') {
        try {
            const command = `dd if=${device}1 of=/dev/null bs=10M count=10 iflag=direct`;
            console.log(`Testing read speed on block device ${device} using ${command}...`);
            const { stderr } = await execAsync(command);
            const speedMatch = stderr.match(/,\s*([0-9.]+)\s*(MB\/s|GB\/s|kB\/s|B\/s)/i);
            if (speedMatch) {
                let speedVal = parseFloat(speedMatch[1]);
                const unit = speedMatch[2].toUpperCase();
                if (unit === 'GB/S') speedVal *= 1024;
                if (unit === 'KB/S') speedVal /= 1024;
                if (unit === 'B/S') speedVal /= (1024 * 1024);
                readSpeed = speedVal;
            } else {
                console.log("Could not parse dd output:", stderr);
            }
        } catch (e) {
            console.error(`dd read test failed on ${device}:`, e.message);
        }
    }

    try {
        const buffer = crypto.randomBytes(testFileSize);
        const startWrite = process.hrtime.bigint();
        fs.writeFileSync(tempFile, buffer);
        const endWrite = process.hrtime.bigint();
        const writeTimeSec = Number(endWrite - startWrite) / 1e9;
        writeSpeed = (testFileSize / 1024 / 1024) / writeTimeSec;

        if (process.platform !== 'linux') {
            const startRead = process.hrtime.bigint();
            fs.readFileSync(tempFile);
            const endRead = process.hrtime.bigint();
            const readTimeSec = Number(endRead - startRead) / 1e9;
            readSpeed = (testFileSize / 1024 / 1024) / readTimeSec;
        }
    } catch (e) {
        console.error(`Failed to test write speed on ${mountPath}:`, e.message);
    } finally {
        if (fs.existsSync(tempFile)) {
            try {
                fs.unlinkSync(tempFile);
            } catch (e) { }
        }
    }

    return {
        writeSpeed: writeSpeed.toFixed(2),
        readSpeed: readSpeed.toFixed(2)
    };
}

async function updateUsbStatus(forceTest = false) {
    if (isTesting) return;
    isTesting = true;

    const cache = loadCache();
    let hasChanges = false;

    io.emit('testing', true);

    try {
        const drives = await drivelist.list();
        const externalDrives = drives.filter(d => d.isUSB || d.isRemovable);
        const drivesToTest = externalDrives.filter(d => d.mountpoints && d.mountpoints.length > 0);

        const totalDrives = drivesToTest.length;
        let completedDrives = 0;

        io.emit('testing_progress', { completed: completedDrives, total: totalDrives });
        const newStatus = [];

        for (const drive of drivesToTest) {
            const mountPath = drive.mountpoints[0].path;
            const device = drive.device;
            const label = path.basename(mountPath);
            const capacity = (drive.size / (1024 * 1024 * 1024)).toFixed(2);
            const name = drive.description || 'USB Drive';
            let speeds;

            if (!forceTest && cache[mountPath]) {
                console.log(`Using cached speed for ${mountPath}`);
                speeds = cache[mountPath].speeds;
            } else {
                console.log(`Testing speed for ${mountPath} (${device})...`);
                speeds = await testDriveSpeed(mountPath, device);
                cache[mountPath] = {
                    speeds,
                    lastTested: new Date().toISOString()
                };
                hasChanges = true;
            }

            newStatus.push({
                name, label, mountPath,
                capacity: `${capacity} GB`,
                writeSpeed: speeds.writeSpeed,
                readSpeed: speeds.readSpeed,
                lastUpdated: cache[mountPath].lastTested
            });

            completedDrives++;
            io.emit('testing_progress', { completed: completedDrives, total: totalDrives });
            io.emit('usbStatus', newStatus);
        }

        const currentMountPaths = newStatus.map(d => d.mountPath);
        for (const cachedPath of Object.keys(cache)) {
            if (!currentMountPaths.includes(cachedPath)) {
                console.log(`USB unmounted, removing from cache: ${cachedPath}`);
                delete cache[cachedPath];
                hasChanges = true;
            }
        }

        if (hasChanges) saveCache(cache);
        usbStatus = newStatus;
        console.log('USB speed test completed.');
    } catch (e) {
        console.error('Error updating USB status:', e);
    } finally {
        isTesting = false;
        io.emit('testing', false);
    }
}

const osType = process.platform;
if (osType === 'darwin') {
    let timeout;
    chokidar.watch('/Volumes', { depth: 0, ignoreInitial: true }).on('all', (event, path) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => { updateUsbStatus(false); }, 1000);
    });
} else if (osType === 'linux') {
    let timeout;
    chokidar.watch(['/media', '/mnt'], { depth: 2, ignoreInitial: true }).on('all', (event, path) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => { updateUsbStatus(false); }, 1000);
    });
}


// ==================== NETWORK MONITORING ====================
function getNetworkTraffic(interfaceName) {
    try {
        const data = fs.readFileSync('/proc/net/dev', 'utf8');
        const lines = data.split('\n');
        for (let line of lines) {
            if (line.includes(interfaceName)) {
                const parts = line.trim().split(/\s+/);
                return {
                    rx: parseInt(parts[1]),
                    tx: parseInt(parts[9])
                };
            }
        }
    } catch (err) {
        console.error("Gagal membaca data network:", err);
    }
    return { rx: 0, tx: 0 };
}

const hasProcNetDev = fs.existsSync('/proc/net/dev');
const networkInterface = 'enp65s0f1'; // Ganti dengan nama interfacemu jika perlu

if (!hasProcNetDev) {
    console.log("ℹ️ '/proc/net/dev' tidak ditemukan. Mode simulasi aktif.");
} else {
    console.log(`🟢 Memonitor interface '${networkInterface}'.`);
}

let lastTraffic = hasProcNetDev ? getNetworkTraffic(networkInterface) : null;
let simTime = 0;
let tickCount = 0;

setInterval(() => {
    let rxSpeed = 0;
    let txSpeed = 0;

    if (hasProcNetDev) {
        const currentTraffic = getNetworkTraffic(networkInterface);
        rxSpeed = (currentTraffic.rx - lastTraffic.rx) / 2;
        txSpeed = (currentTraffic.tx - lastTraffic.tx) / 2;
        if (rxSpeed < 0) rxSpeed = 0;
        if (txSpeed < 0) txSpeed = 0;
        lastTraffic = currentTraffic;
    } else {
        simTime += 0.15;
        const baseRx = 45 * 1024 * 1024;
        const baseTx = 18 * 1024 * 1024;
        const cycleRx = Math.sin(simTime) * 30 * 1024 * 1024;
        const cycleTx = Math.cos(simTime * 0.7) * 10 * 1024 * 1024;
        const noiseRx = (Math.random() - 0.5) * 8 * 1024 * 1024;
        const noiseTx = (Math.random() - 0.5) * 4 * 1024 * 1024;
        rxSpeed = Math.max(1024, baseRx + cycleRx + noiseRx);
        txSpeed = Math.max(1024, baseTx + cycleTx + noiseTx);
    }

    const now = Date.now();
    const loadAvg = os.loadavg();

    db.saveTraffic(now, rxSpeed, txSpeed, loadAvg[0], loadAvg[1], loadAvg[2])
        .catch(err => console.error("❌ Gagal menyimpan traffic ke SQLite:", err.message));

    tickCount++;
    if (tickCount % 150 === 0) {
        db.pruneHistory()
            .catch(err => console.error("❌ Gagal membersihkan data lama:", err.message));
    }

    io.emit('traffic-data', {
        rx: rxSpeed,
        tx: txSpeed,
        timestamp: now,
        simulated: !hasProcNetDev,
        interface: hasProcNetDev ? networkInterface : 'Simulated',
        loadAvg: loadAvg
    });
}, 2000);


// ==================== SOCKET.IO AND SERVER START ====================
io.on('connection', (socket) => {
    console.log('👤 Client terhubung');

    // USB Events
    socket.emit('usbStatus', usbStatus);
    socket.emit('testing', isTesting);
    socket.on('requestRefresh', () => {
        console.log('Manual refresh requested by client');
        updateUsbStatus(true);
    });

    // Network Events
    socket.on('request-history', async (data) => {
        const rangeMs = data && data.rangeMs ? data.rangeMs : 5 * 60 * 1000;
        try {
            const points = await db.getHistory(rangeMs);
            socket.emit('history-data', { range: data.range || '5m', points: points });
        } catch (err) {
            console.error('❌ Gagal mengambil riwayat traffic:', err.message);
            socket.emit('history-data', { range: data.range || '5m', points: [] });
        }
    });

    socket.on('disconnect', () => {
        console.log('👤 Client terputus');
    });
});

// Initial USB test
updateUsbStatus(false);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Unified Dashboard berjalan di http://0.0.0.0:${PORT}`);
});
