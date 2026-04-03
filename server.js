const express = require('express');
const redis = require('redis');
const app = express();
const client = redis.createClient({ url: process.env.REDIS_URL });

client.connect().catch(console.error);

app.get('/', async (req, res) => {
    const count = await client.incr('visits');
    res.send(`WELCOME TO VERSION 1.0! This page has been viewed ${count} times.`);
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/readyz', (req, res) => {
  res.status(200).send('OK');
});

app.listen(3000, () => console.log('Server running on port 3000'));
