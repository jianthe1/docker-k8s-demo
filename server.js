const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const redis = require('redis');
const os = require('os');
const { Pool } = require('pg'); // <-- NEW: The Postgres Library

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = 3000;

// --- POSTGRES SETUP (The Source of Truth) ---
const dbPool = new Pool({
    host: process.env.PGHOST || 'db',             // K8s service name
    user: process.env.PGUSER || 'postgres',
    database: process.env.PGDATABASE || 'votedb', // Our rigged database
    password: process.env.PGPASSWORD || '',
    port: 5432,
});

// Helper function: Always query Postgres for the real score
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

// --- REDIS PUB/SUB SETUP (The Doorbell) ---
const pubClient = redis.createClient({ url: 'redis://redis-service:6379' });
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
    console.log('Connected to Redis Pub/Sub!');
    
    // Listen for the doorbell: When ANY pod shouts, we query Postgres and update the UI
    subClient.subscribe('vote-channel', async (message) => {
        // 1. Ignore whatever the Redis message says.
        // 2. Ask Postgres for the permanent truth.
        const trueScores = await getTrueScores();
        // 3. Push the real data to all connected browsers.
        io.emit('update-votes', trueScores);
    });
});

// --- THE MAIN WEBPAGE ---
app.get('/', (req, res) => {
    const podName = os.hostname();
    
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>K8s Live Voting Demo</title>
        <style>
            body { background-color: #0f172a; color: #f8fafc; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 40px; border-radius: 20px; box-shadow: 0 15px 35px rgba(0,0,0,0.5); text-align: center; width: 90%; max-width: 500px; border: 1px solid #334155; }
            h1 { color: #38bdf8; margin-top: 0; }
            .subtitle { color: #94a3b8; margin-bottom: 30px; }
            .voting-area { display: flex; gap: 20px; margin-bottom: 30px; }
            .vote-btn { flex: 1; padding: 20px; font-size: 1.5rem; font-weight: bold; border: none; border-radius: 12px; cursor: pointer; transition: transform 0.1s; color: white; }
            .vote-btn:hover { filter: brightness(1.2); transform: scale(1.05); }
            .vote-btn:active { transform: scale(0.95); }
            .btn-cats { background: #8b5cf6; }
            .btn-dogs { background: #f59e0b; }
            .results-container { background: #334155; height: 30px; border-radius: 15px; display: flex; overflow: hidden; margin-bottom: 10px; }
            .bar-cats { background: #8b5cf6; width: 50%; transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
            .bar-dogs { background: #f59e0b; width: 50%; transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
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
                <span id="text-cats">Cats: 0 (50%)</span>
                <span id="text-total">Total: 0</span>
                <span id="text-dogs">Dogs: 0 (50%)</span>
            </div>
            
            <div class="k8s-info">
                Connected via WebSocket to Pod:<br>
                <strong style="color: #34d399; font-size: 1.1rem;">${podName}</strong>
            </div>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io({ transports: ['websocket'] }); // Force WebSockets immediately

            function castVote(choice) {
                socket.emit('cast-vote', choice);
            }

            socket.on('update-votes', (data) => {
                const total = data.cats + data.dogs;
                const catPercent = total === 0 ? 50 : Math.round((data.cats / total) * 100);
                const dogPercent = total === 0 ? 50 : Math.round((data.dogs / total) * 100);

                document.getElementById('bar-cats').style.width = catPercent + '%';
                document.getElementById('bar-dogs').style.width = dogPercent + '%';

                document.getElementById('text-cats').innerText = \`Cats: \${data.cats} (\${catPercent}%)\`;
                document.getElementById('text-dogs').innerText = \`Dogs: \${data.dogs} (\${dogPercent}%)\`;
                document.getElementById('text-total').innerText = \`Total: \${total}\`;
            });
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// --- WEBSOCKET LOGIC ---
io.on('connection', async (socket) => {
    // 1. When a user connects, send them the true score from Postgres immediately
    const initialScores = await getTrueScores();
    socket.emit('update-votes', initialScores);

    // 2. When this user clicks a vote button
    socket.on('cast-vote', async (choice) => {
        if (choice === 'cats' || choice === 'dogs') {
            const voteValue = choice === 'cats' ? 'a' : 'b';
            const randomId = choice + '-' + Math.random().toString(36).substring(2, 9);
            
            try {
                // Instantly save the vote directly into Postgres
                await dbPool.query('INSERT INTO votes (id, vote) VALUES ($1, $2)', [randomId, voteValue]);
                
                // Ring the Redis doorbell ("ding!") so all pods know the DB has changed
                pubClient.publish('vote-channel', 'ding!');
            } catch (err) {
                console.error("Failed to save vote to Postgres:", err);
            }
        }
    });
});

// --- HEALTH CHECKS ---
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/readyz', (req, res) => res.status(200).send('OK'));

server.listen(port, () => console.log("Real-Time App listening on port " + port));