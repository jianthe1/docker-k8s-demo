const express = require('express');
const redis = require('redis');
const os = require('os');

const app = express();
const port = 3000;

// Middleware to read form data from the voting buttons
app.use(express.urlencoded({ extended: true }));

// Connect to the Redis Pod
const client = redis.createClient({
    url: 'redis://redis:6379'
});

client.on('error', (err) => console.log('Redis Client Error', err));
client.connect().then(() => console.log('Connected to Redis!'));

// --- THE MAIN WEBPAGE ---
app.get('/', async (req, res) => {
    // 1. Defeat the Browser Cache permanently
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    
    // 2. Fetch the current votes from Redis
    let cats = await client.hGet('votes', 'cats') || 0;
    let dogs = await client.hGet('votes', 'dogs') || 0;
    
    // Convert text to numbers, default to 0
    cats = parseInt(cats);
    dogs = parseInt(dogs);
    const totalVotes = cats + dogs;
    
    // Calculate percentages for the UI
    const catPercent = totalVotes === 0 ? 50 : Math.round((cats / totalVotes) * 100);
    const dogPercent = totalVotes === 0 ? 50 : Math.round((dogs / totalVotes) * 100);
    
    // 3. Get the Kubernetes Pod ID
    const podName = os.hostname();
    
    // 4. Send the beautiful UI
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>K8s Live Voting Demo</title>
        <style>
            body {
                background-color: #0f172a;
                color: #f8fafc;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
            }
            .card {
                background: #1e293b;
                padding: 40px;
                border-radius: 20px;
                box-shadow: 0 15px 35px rgba(0,0,0,0.5);
                text-align: center;
                max-width: 500px;
                width: 90%;
                border: 1px solid #334155;
            }
            h1 { color: #38bdf8; margin-top: 0; }
            .subtitle { color: #94a3b8; margin-bottom: 30px; }
            
            /* The Voting Area */
            .voting-area {
                display: flex;
                justify-content: space-between;
                gap: 20px;
                margin-bottom: 30px;
            }
            .vote-btn {
                flex: 1;
                padding: 20px;
                font-size: 1.5rem;
                font-weight: bold;
                border: none;
                border-radius: 12px;
                cursor: pointer;
                transition: transform 0.1s, filter 0.2s;
                color: white;
            }
            .vote-btn:hover { filter: brightness(1.2); transform: scale(1.05); }
            .vote-btn:active { transform: scale(0.95); }
            .btn-cats { background: #8b5cf6; }
            .btn-dogs { background: #f59e0b; }
            
            /* The Results Bar */
            .results-container {
                background: #334155;
                height: 30px;
                border-radius: 15px;
                display: flex;
                overflow: hidden;
                margin-bottom: 10px;
            }
            .bar-cats { background: #8b5cf6; width: ${catPercent}%; transition: width 0.5s ease; }
            .bar-dogs { background: #f59e0b; width: ${dogPercent}%; transition: width 0.5s ease; }
            
            .stats {
                display: flex;
                justify-content: space-between;
                font-size: 0.9rem;
                color: #cbd5e1;
                margin-bottom: 30px;
            }
            
            /* K8s Info Box */
            .k8s-info {
                background: #020617;
                padding: 15px;
                border-radius: 10px;
                border-left: 4px solid #10b981;
                font-family: monospace;
                font-size: 0.9rem;
                color: #a7f3d0;
            }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>Cats vs. Dogs</h1>
            <p class="subtitle">Live Kubernetes State Management Demo</p>
            
            <form action="/vote" method="POST" class="voting-area">
                <button type="submit" name="choice" value="cats" class="vote-btn btn-cats">🐱 Cats</button>
                <button type="submit" name="choice" value="dogs" class="vote-btn btn-dogs">🐶 Dogs</button>
            </form>
            
            <div class="results-container">
                <div class="bar-cats"></div>
                <div class="bar-dogs"></div>
            </div>
            
            <div class="stats">
                <span>Cats: ${cats} (${catPercent}%)</span>
                <span>Total Votes: ${totalVotes}</span>
                <span>Dogs: ${dogs} (${dogPercent}%)</span>
            </div>
            
            <div class="k8s-info">
                Request processed by Pod:<br>
                <strong style="color: #34d399; font-size: 1.1rem;">${podName}</strong>
            </div>
        </div>
    </body>
    </html>
    `;
    
    res.send(html);
});

// --- THE VOTING LOGIC ---
app.post('/vote', async (req, res) => {
    const choice = req.body.choice; // 'cats' or 'dogs'
    
    // If they voted correctly, increment that specific counter in the Redis Hash
    if (choice === 'cats' || choice === 'dogs') {
        await client.hIncrBy('votes', choice, 1);
    }
    
    // Instantly refresh the page to show the new results
    res.redirect('/');
});

// --- KUBERNETES HEALTH CHECKS ---
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/readyz', (req, res) => res.status(200).send('OK'));

app.listen(port, () => {
    console.log("Voting App listening on port" +port);
});
