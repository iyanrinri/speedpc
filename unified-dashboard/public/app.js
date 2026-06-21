const socket = io();

// ==================== NAVIGATION LOGIC ====================
const navLinks = document.querySelectorAll('.nav-link');
const sections = document.querySelectorAll('.content-section');

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Remove active class from all links and sections
        navLinks.forEach(l => l.classList.remove('active'));
        sections.forEach(s => s.classList.remove('active'));
        
        // Add active class to clicked link and target section
        link.classList.add('active');
        const targetId = link.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');
    });
});

// Dynamically set Glances iframe URL via our internal proxy
const glancesFrame = document.getElementById('glances-frame');
glancesFrame.src = '/glances/';

// ==================== NETWORK CHART ====================
const ctx = document.getElementById('trafficChart').getContext('2d');
const trafficChart = new Chart(ctx, {
    type: 'line',
    data: {
        datasets: [
            {
                label: 'Download (RX)',
                borderColor: '#0ea5e9',
                backgroundColor: 'rgba(14, 165, 233, 0.1)',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                fill: true,
                tension: 0.4,
                data: []
            },
            {
                label: 'Upload (TX)',
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                fill: true,
                tension: 0.4,
                data: []
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
            mode: 'index',
            intersect: false,
        },
        plugins: {
            legend: {
                labels: { color: '#f8fafc' }
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                callbacks: {
                    label: function(context) {
                        var val = context.parsed.y || 0;
                        function getFormatted(v, isBytes) {
                            if (v <= 0) return isBytes ? '0.00 Byte' : '0.00 bit';
                            var k = isBytes ? 1024 : 1000;
                            var sizes = isBytes ? ['Byte', 'KByte', 'MByte', 'GByte', 'TByte'] : ['bit', 'Kbit', 'Mbit', 'Gbit', 'Tbit'];
                            var v2 = isBytes ? v : v * 8;
                            var i = Math.floor(Math.log(v2) / Math.log(k));
                            var safeIndex = Math.min(i, sizes.length - 1);
                            return (v2 / Math.pow(k, safeIndex)).toFixed(2) + ' ' + sizes[safeIndex];
                        }
                        return ' ' + context.dataset.label + ': ' + getFormatted(val, false) + ' (' + getFormatted(val, true) + ')';
                    }
                }
            }
        },
        scales: {
            x: {
                type: 'time',
                time: { 
                    tooltipFormat: 'HH:mm:ss',
                    displayFormats: {
                        millisecond: 'HH:mm:ss.SSS',
                        second: 'HH:mm:ss',
                        minute: 'HH:mm',
                        hour: 'HH:mm'
                    }
                },
                grid: { color: 'rgba(255,255,255,0.05)' },
                ticks: { 
                    color: '#94a3b8',
                    maxTicksLimit: 6
                }
            },
            y: {
                beginAtZero: true,
                grid: { color: 'rgba(255,255,255,0.05)' },
                ticks: {
                    color: '#94a3b8',
                    callback: function(value) {
                        return (value / (1024 * 1024)).toFixed(1) + ' MB/s';
                    }
                }
            }
        }
    }
});

let currentTimeWindow = 5 * 60 * 1000; // default 5 minutes

function formatSpeed(bytesPerSec) {
    if (bytesPerSec === 0) return '0 MB/s';
    const mbps = bytesPerSec / (1024 * 1024);
    return mbps.toFixed(2) + ' MB/s';
}

// Handle incoming historical data
socket.on('history-data', (data) => {
    // data.points format: { t, rx, tx, load_1, load_5, load_15 }
    trafficChart.data.datasets[0].data = [];
    trafficChart.data.datasets[1].data = [];
    
    data.points.forEach(pt => {
        const time = new Date(pt.t);
        trafficChart.data.datasets[0].data.push({ x: time, y: pt.rx });
        trafficChart.data.datasets[1].data.push({ x: time, y: pt.tx });
    });
    
    trafficChart.update('none');
});

// Handle live real-time data ticks
socket.on('traffic-data', (data) => {
    document.getElementById('rx-speed').textContent = formatSpeed(data.rx);
    document.getElementById('tx-speed').textContent = formatSpeed(data.tx);

    const now = new Date(data.timestamp);
    trafficChart.data.datasets[0].data.push({ x: now, y: data.rx });
    trafficChart.data.datasets[1].data.push({ x: now, y: data.tx });

    const cutoff = now.getTime() - currentTimeWindow;
    trafficChart.data.datasets.forEach(dataset => {
        dataset.data = dataset.data.filter(point => point.x.getTime() > cutoff);
    });

    trafficChart.update('none');
});

// Chart Filter Logic
const filterBtns = document.querySelectorAll('.filter-btn');
filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Update UI
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Calculate new time window
        const range = btn.getAttribute('data-range');
        let ms = 5 * 60 * 1000;
        if (range === '5m') ms = 5 * 60 * 1000;
        if (range === '15m') ms = 15 * 60 * 1000;
        if (range === '1h') ms = 60 * 60 * 1000;
        if (range === '6h') ms = 6 * 60 * 60 * 1000;
        if (range === '12h') ms = 12 * 60 * 60 * 1000;
        if (range === '24h') ms = 24 * 60 * 60 * 1000;
        
        currentTimeWindow = ms;
        
        // Request history from backend
        socket.emit('request-history', { rangeMs: ms, range: range });
    });
});

// Request initial data on load
socket.emit('request-history', { rangeMs: currentTimeWindow, range: '5m' });

// ==================== USB DEVICES ====================
const usbListEl = document.getElementById('usb-list');
const testingIndicator = document.getElementById('usb-testing-indicator');
const progressEl = document.getElementById('usb-progress');
const refreshBtn = document.getElementById('refresh-usb');
const searchInput = document.getElementById('searchInput');

let allDrives = [];

function renderUsbList(drives) {
    if (!drives || drives.length === 0) {
        usbListEl.innerHTML = '<div class="placeholder-text">No USB devices detected.</div>';
        return;
    }

    let fastDrives = [];
    let normalDrives = [];
    let slowDrives = [];

    drives.forEach(drive => {
        let speed = parseFloat(drive.readSpeed) || 0;
        let cardHtml = `
            <div class="usb-card">
                <div class="usb-header">
                    <i class="fa-brands fa-usb"></i>
                    <div>
                        <div class="usb-name" title="${drive.label}">${drive.label || 'Unnamed USB'}</div>
                    </div>
                </div>
                <div class="usb-details">
                    <div class="speed-indicator ${speed >= 60 ? 'fast' : (speed >= 20 ? 'normal' : 'slow')}">
                        <span>Read Speed</span>
                        <strong>${drive.readSpeed} MB/s</strong>
                    </div>
                </div>
            </div>
        `;

        if (speed >= 60) {
            fastDrives.push(cardHtml);
        } else if (speed >= 20) {
            normalDrives.push(cardHtml);
        } else {
            slowDrives.push(cardHtml);
        }
    });

    let html = '';
    
    if (fastDrives.length > 0) {
        html += `<h3 class="speed-category fast-cat"><i class="fa-solid fa-rocket"></i> Fast Drives (60+ MB/s)</h3><div class="usb-grid">${fastDrives.join('')}</div>`;
    }
    if (normalDrives.length > 0) {
        html += `<h3 class="speed-category normal-cat"><i class="fa-solid fa-bolt"></i> Normal Drives (20-59 MB/s)</h3><div class="usb-grid">${normalDrives.join('')}</div>`;
    }
    if (slowDrives.length > 0) {
        html += `<h3 class="speed-category slow-cat"><i class="fa-solid fa-triangle-exclamation"></i> Slow Drives (< 20 MB/s)</h3><div class="usb-grid">${slowDrives.join('')}</div>`;
    }

    usbListEl.innerHTML = html;
}

function filterAndRender() {
    const query = searchInput.value.toLowerCase();
    const filtered = allDrives.filter(d => 
        (d.name && d.name.toLowerCase().includes(query)) || 
        (d.label && d.label.toLowerCase().includes(query))
    );
    renderUsbList(filtered);
}

socket.on('usbStatus', (data) => {
    allDrives = data;
    filterAndRender();
});

searchInput.addEventListener('input', () => {
    filterAndRender();
});

socket.on('testing', (isTesting) => {
    if (isTesting) {
        testingIndicator.classList.remove('hidden');
        refreshBtn.disabled = true;
        refreshBtn.style.opacity = '0.5';
    } else {
        testingIndicator.classList.add('hidden');
        refreshBtn.disabled = false;
        refreshBtn.style.opacity = '1';
    }
});

socket.on('testing_progress', (data) => {
    progressEl.textContent = `(${data.completed}/${data.total})`;
});

refreshBtn.addEventListener('click', () => {
    socket.emit('requestRefresh');
});
