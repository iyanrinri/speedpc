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
        plugins: {
            legend: {
                labels: { color: '#f8fafc' }
            }
        },
        scales: {
            x: {
                type: 'time',
                time: { tooltipFormat: 'HH:mm:ss' },
                grid: { color: 'rgba(255,255,255,0.05)' },
                ticks: { color: '#94a3b8' }
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

function formatSpeed(bytesPerSec) {
    if (bytesPerSec === 0) return '0 MB/s';
    const mbps = bytesPerSec / (1024 * 1024);
    return mbps.toFixed(2) + ' MB/s';
}

socket.on('traffic-data', (data) => {
    document.getElementById('rx-speed').textContent = formatSpeed(data.rx);
    document.getElementById('tx-speed').textContent = formatSpeed(data.tx);

    const now = new Date(data.timestamp);
    trafficChart.data.datasets[0].data.push({ x: now, y: data.rx });
    trafficChart.data.datasets[1].data.push({ x: now, y: data.tx });

    const timeWindow = 60 * 1000; // 1 minute
    const cutoff = now.getTime() - timeWindow;
    trafficChart.data.datasets.forEach(dataset => {
        dataset.data = dataset.data.filter(point => point.x.getTime() > cutoff);
    });

    trafficChart.update('none');
});

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
                    <i class="fa-solid fa-usb"></i>
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
