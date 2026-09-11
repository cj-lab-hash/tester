require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const loginSessions = new Set();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
function getSessionToken(req) {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(/(?:^|;\s*)tester_session=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

app.get('/api/auth-status', (req, res) => {
    res.json({ authenticated: loginSessions.has(getSessionToken(req)) });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    const expectedUsername = process.env.LOGIN_USERNAME;
    const expectedPassword = process.env.LOGIN_PASSWORD;

    if (!expectedUsername || !expectedPassword) {
        return res.status(500).json({ message: 'Login credentials are not configured on the server.' });
    }

    if (username !== expectedUsername || password !== expectedPassword) {
        return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    loginSessions.add(token);
    res.setHeader('Set-Cookie', `tester_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
    res.json({ authenticated: true });
});

app.post('/api/logout', (req, res) => {
    const token = getSessionToken(req);
    if (token) loginSessions.delete(token);
    res.setHeader('Set-Cookie', 'tester_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ authenticated: false });
});

app.get('/api/config', (req, res) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        return res.status(500).json({ message: 'Supabase client configuration is missing' });
    }

    res.json({ supabaseUrl, supabaseAnonKey });
});


app.post("/api/save", async (req, res) => {
    const { index, value } = req.body;
    
    try {
        await pool.query(
            `
            INSERT INTO data (cell_index, value)
            VALUES ($1, $2) 
            ON CONFLICT (cell_index)
            DO UPDATE SET 
            value = EXCLUDED.value, 
            updated_at = now()
            `,
            [index, value]
        );
        res.json({ message: 'Data saved successfully!' });
    } catch (err) {
        console.error('Error saving data:', err);
        res.status(500).json({ message: 'Error saving data' });
    }
});


    app.get('/api/data', async (req, res) => {
        try {
            console.log('Fetching data from database...');
            const result = await pool.query(
            "SELECT cell_index, value FROM data"
        );
       
    const formatted ={};
    result.rows.forEach(row => {
        formatted[`cell${row.cell_index}`] = row.value;
    });
    res.json(formatted);
} catch (err) {
    console.error('Error fetching data:', err);
    res.status(500).json({ message: 'Database Error' });
}
});



// Start the server on port 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
