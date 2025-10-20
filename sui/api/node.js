const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const url = require('url');

// ./sui/api/node.js

const PORT = process.env.PORT || 3000;
const DATA_DIR = '/app/data';

function sendJSON(res, statusCode, obj, extraHeaders = {}) {
    res.writeHead(statusCode, Object.assign({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    }, extraHeaders));
    res.end(JSON.stringify(obj));
}

// Funktio kaiken analytics-datan lukemiseksi
async function readAllAnalyticsData() {
    try {
        const files = await fs.readdir(DATA_DIR);
        const analyticsFiles = files.filter(file => file.startsWith('analytics-') && file.endsWith('.json'));
        
        let allLogins = [];
        let allClicks = [];

        // Lue kaikki analytics-tiedostot
        for (const file of analyticsFiles) {
            try {
                const filePath = path.join(DATA_DIR, file);
                const rawData = await fs.readFile(filePath, 'utf8');
                const data = JSON.parse(rawData) || [];
                
                // Erotellaan login ja click eventit
                const logins = data.filter(event => event.type === 'login');
                const clicks = data.filter(event => event.type === 'device_access');
                
                allLogins = [...allLogins, ...logins];
                allClicks = [...allClicks, ...clicks];
            } catch (error) {
                console.log(`Error reading file ${file}:`, error.message);
            }
        }

        return { logins: allLogins, clicks: allClicks };
    } catch (error) {
        // DATA_DIR ei välttämättä ole olemassa vielä
        return { logins: [], clicks: [] };
    }
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
        sendJSON(res, 204, {});
        return;
    }

    // GET /analytics - endpoint datan lukemiseen
    if (req.method === 'GET' && pathname === '/analytics') {
        try {
            const analyticsData = await readAllAnalyticsData();
            sendJSON(res, 200, analyticsData);
        } catch (error) {
            console.error('Error reading analytics data:', error);
            sendJSON(res, 500, { 
                status: 'error', 
                message: 'Failed to read analytics data' 
            });
        }
        return;
    }

    // GET / - tervehdys endpoint
    if (req.method === 'GET' && pathname === '/') {
        sendJSON(res, 200, { 
            status: 'success', 
            message: 'Analytics API is running',
            endpoints: {
                'GET /analytics': 'Get all analytics data',
                'POST /': 'Save analytics event'
            }
        });
        return;
    }

    // POST / - analytics-datan tallennus
    if (req.method === 'POST' && pathname === '/') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            let data;
            try {
                data = body ? JSON.parse(body) : {};
            } catch (err) {
                sendJSON(res, 400, { status: 'error', message: 'Invalid JSON' });
                return;
            }

            if (!data.timestamp) {
                data.timestamp = new Date().toISOString();
            }

            const dateStr = data.timestamp.split('T')[0]; // YYYY-MM-DD
            const filename = path.join(DATA_DIR, `analytics-${dateStr}.json`);

            try {
                await fs.mkdir(DATA_DIR, { recursive: true });

                let existing = [];
                try {
                    const raw = await fs.readFile(filename, 'utf8');
                    existing = JSON.parse(raw) || [];
                } catch (err) {
                    // file may not exist or be invalid -> start with empty array
                    existing = [];
                }

                existing.push(data);
                await fs.writeFile(filename, JSON.stringify(existing, null, 2), 'utf8');

                console.log(`Analytics event saved: ${data.type} from ${data.role}`);
                sendJSON(res, 200, { status: 'success' });
            } catch (err) {
                console.error('Save failed:', err);
                sendJSON(res, 500, { status: 'error', message: 'Save failed' });
            }
        });

        req.on('error', () => {
            sendJSON(res, 500, { status: 'error', message: 'Request error' });
        });
        return;
    }

    // 404 - Not Found
    sendJSON(res, 404, { status: 'error', message: 'Endpoint not found' });
});

server.listen(PORT, () => {
    console.log(`Analytics API listening on port ${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
    console.log('Available endpoints:');
    console.log('  GET  /analytics  - Get all analytics data');
    console.log('  POST /           - Save analytics event');
    console.log('  GET  /           - API status');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});