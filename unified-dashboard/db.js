const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'traffic.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Gagal membuka database SQLite:', err.message);
    } else {
        console.log('💾 Hubungan ke SQLite database (traffic.db) berhasil dibuka.');
    }
});

// Enable WAL (Write-Ahead Logging) mode for optimized concurrent reads and writes
db.serialize(() => {
    db.run("PRAGMA journal_mode=WAL;");
    
    // Create Table for storing traffic and server load averages
    db.run(`
        CREATE TABLE IF NOT EXISTS traffic (
            t INTEGER PRIMARY KEY,
            rx REAL NOT NULL,
            tx REAL NOT NULL,
            load_1 REAL NOT NULL,
            load_5 REAL NOT NULL,
            load_15 REAL NOT NULL
        )
    `, (err) => {
        if (err) {
            console.error('❌ Gagal membuat tabel traffic:', err.message);
        } else {
            console.log('📊 Tabel traffic di SQLite siap digunakan.');
        }
    });
});

module.exports = {
    /**
     * Menyimpan data traffic dan load server ke database.
     */
    saveTraffic(t, rx, tx, load_1, load_5, load_15) {
        return new Promise((resolve, reject) => {
            const query = `INSERT OR REPLACE INTO traffic (t, rx, tx, load_1, load_5, load_15) VALUES (?, ?, ?, ?, ?, ?)`;
            db.run(query, [t, rx, tx, load_1, load_5, load_15], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
        });
    },

    /**
     * Mengambil riwayat data berdasarkan jangkauan waktu (milliseconds).
     */
    getHistory(rangeMs) {
        return new Promise((resolve, reject) => {
            const cutoff = Date.now() - rangeMs;
            const query = `SELECT t, rx, tx, load_1, load_5, load_15 FROM traffic WHERE t >= ? ORDER BY t ASC`;
            db.all(query, [cutoff], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    },

    /**
     * Menghapus riwayat data yang lebih tua dari 1 hari (24 jam) dan me-reclaim space.
     */
    pruneHistory() {
        return new Promise((resolve, reject) => {
            const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 jam dalam ms
            const query = `DELETE FROM traffic WHERE t < ?`;
            db.run(query, [cutoff], function(err) {
                if (err) {
                    reject(err);
                } else {
                    const deletedCount = this.changes;
                    if (deletedCount > 0) {
                        console.log(`🧹 Auto-Cleanup: Berhasil menghapus ${deletedCount} baris data lama (> 24 jam).`);
                        // Vacuum database to reclaim space
                        db.run("VACUUM", (err) => {
                            if (err) console.error("❌ Gagal melakukan VACUUM database:", err.message);
                            else console.log("📦 Database berhasil di-VACUUM.");
                        });
                    }
                    resolve(deletedCount);
                }
            });
        });
    },
    
    /**
     * Menutup koneksi database.
     */
    close() {
        return new Promise((resolve, reject) => {
            db.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
};
