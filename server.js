const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const redis = require('redis');
const os = require('os');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = 3000;

// --- POSTGRES SETUP ---
const dbPool = new Pool({
    // Using environment variables or defaulting to 'db' (K8s service name)
    host: process.env.PGHOST || 'db',
    user: process.env.PGUSER || 'postgres',
    database: process.env.PGDATABASE || 'postgres', 
    password: process.env.PGPASSWORD || 'postgres',
    port: 5432,
});

async function getTrueScores() {
    try {
        const result = await dbPool.query('SELECT vote, count(*) as count FROM votes GROUP BY vote');
        let scores = { cats: 0, dogs: 0 };
        result.rows.forEach(row => {
            if (row.vote === 'a') scores.cats = parseInt(row.count);
            if (row.vote === 'b') scores.dogs = parseInt(row.count);
        });
        return scores;
    } catch (err) {
        console.error("Postgres query failed:", err);
        return { cats: 0, dogs: 0 };
    }
}

// --- REDIS PUB/SUB SETUP ---
// FIX: Using process.env.REDIS_URL to ensure we don't connect to localhost (::1)
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

const pubClient = redis.createClient({ url: redisUrl });
const subClient = pubClient.duplicate();

// Error listeners to prevent the app from crashing on connection drops
pubClient.on('error', (err) => console.error('Redis Pub Error:', err));
subClient.on('error', (err) => console.error('Redis Sub Error:', err));

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
    console.log('Connected to Redis at: ' + redisUrl);
    
    subClient.subscribe('vote-channel', async (message) => {
        const trueScores = await getTrueScores();
        io.emit('update-votes', trueScores);
    });
}).catch(err => {
    console.error("Critical: Could not connect to Redis!", err);
});

// --- THE MAIN WEBPAGE ---
app.get('/', (req, res) => {
    const podName = os.hostname();
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>K8s Live Voting Demo 2.0</title>
        <style>
            body { background-color: #0f172a; color: #f8fafc; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 40px; border-radius: 20px; box-shadow: 0 15px 35px rgba(0,0,0,0.5); text-align: center; width: 90%; max-width: 500px; border: 1px solid #334155; }
            h1 { color: #38bdf8; margin-top: 0; }
            .subtitle { color: #94a3b8; margin-bottom: 30px; }
            .voting-area { display: flex; gap: 20px; margin-bottom: 30px; }
            .vote-btn { flex: 1; padding: 20px; font-size: 1.5rem; font-weight: bold; border: none; border-radius: 12px; cursor: pointer; transition: transform 0.1s; color: white; }
            .vote-btn:hover { filter: brightness(1.2); transform: scale(1.05); }
            .btn-cats { background: #8b5cf6; }
            .btn-dogs { background: #f59e0b; }
            .results-container { background: #334155; height: 30px; border-radius: 15px; display: flex; overflow: hidden; margin-bottom: 10px; }
            .bar-cats { background: #8b5cf6; width: 50%; transition: width 0.3s; }
            .bar-dogs { background: #f59e0b; width: 50%; transition: width 0.3s; }
            .stats { display: flex; justify-content: space-between; font-size: 0.9rem; color: #cbd5e1; margin-bottom: 30px; }
            .k8s-info { background: #020617; padding: 15px; border-radius: 10px; border-left: 4px solid #10b981; font-family: monospace; font-size: 0.9rem; color: #a7f3d0; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>Cats vs. Dogs</h1>
            <p class="subtitle">Live WebSocket Sync (Zero Page Reloads)</p>
            <div class="voting-area">
                <button onclick="castVote('cats')" class="vote-btn btn-cats">🐱 Cats</button>
                <button onclick="castVote('dogs')" class="vote-btn btn-dogs">🐶 Dogs</button>
            </div>
            <div class="results-container">
                <div id="bar-cats" class="bar-cats"></div>
                <div id="bar-dogs" class="bar-dogs"></div>
            </div>
            <div class="stats">
                <span id="text-cats">Cats: 0</span>
                <span id="text-total">Total: 0</span>
                <span id="text-dogs">Dogs: 0</span>
            </div>
            <div class="k8s-info">Pod: <strong>${podName}</strong></div>
        </div>
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io({ transports: ['websocket'] });
            function castVote(choice) { socket.emit('cast-vote', choice); }
            socket.on('update-votes', (data) => {
                const total = data.cats + data.dogs;
                const catP = total === 0 ? 50 : Math.round((data.cats/total)*100);
                const dogP = total === 0 ? 50 : Math.round((data.dogs/total)*100);
                document.getElementById('bar-cats').style.width = catP + '%';
                document.getElementById('bar-dogs').style.width = dogP + '%';
                document.getElementById('text-cats').innerText = 'Cats: ' + data.cats;
                document.getElementById('text-dogs').innerText = 'Dogs: ' + data.dogs;
                document.getElementById('text-total').innerText = 'Total: ' + total;
            });
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// --- WEBSOCKET LOGIC ---
io.on('connection', async (socket) => {
    const initialScores = await getTrueScores();
    socket.emit('update-votes', initialScores);

    socket.on('cast-vote', async (choice) => {
        if (choice === 'cats' || choice === 'dogs') {
            const voteValue = choice === 'cats' ? 'a' : 'b';
            const randomId = choice + '-' + Math.random().toString(36).substring(2, 9);
            try {
                await dbPool.query('INSERT INTO votes (id, vote) VALUES ($1, $2)', [randomId, voteValue]);
                pubClient.publish('vote-channel', 'ding!');
            } catch (err) {
                console.error("Failed to save vote:", err);
            }
        }
    });
});

// --- HEALTH PROBES ---
app.get('/health', (req, res) => res.status(200).send("Healthy"));
app.get('/readyz', (req, res) => res.status(200).send("Ready"));

server.listen(port, () => console.log("Real-Time App listening on port " + port));