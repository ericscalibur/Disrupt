const express = require('express');
const app = express();
const PORT = 3001;

app.get('/', (req, res) => res.send('Test successful'));
app.get('/transactions', (req, res) => res.json({test: "works"}));

app.listen(PORT, () => console.log(`Test server running on port ${PORT}`));