const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');


const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));


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
