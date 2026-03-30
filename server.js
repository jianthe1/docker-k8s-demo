const express = require('express');
const redis = require('redis');
const app = express();
const client = redis.createClient({ url: process.env.REDIS_URL });

client.connect().catch(console.error);

app.get('/', async (req, res) => {
    const count = await client.incr('visits');
    res.send(`Hello! This page has been viewed ${count} times.`);
});

app.listen(3000, () => console.log('Server running on port 3000'));
