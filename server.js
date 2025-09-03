const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

// Middleware to parse JSON
app.use(express.json());
app.use(cors());

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint to append data to the JSON file
app.post('/api/save', (req, res) => {
    const newData = req.body;

    // Check if the file exists
    if (fs.existsSync('data.json')) {
        // Read the current contents of the file
        fs.readFile('data.json', 'utf8', (err, data) => {
            if (err) {
                console.error('Error reading data:', err);
                return res.status(500).json({ message: 'Error reading data' });
            }
            let jsonData = JSON.parse(data);

            // Append the new data
            jsonData[`cell${newData.index}`] = newData.value;

            // Write the updated data back to the file
            fs.writeFile('data.json', JSON.stringify(jsonData), 'utf8', (err) => {
                if (err) {
                    console.error('Error saving data:', err);
                    return res.status(500).json({ message: 'Error saving data' });
                }
                res.json({ message: 'Data saved successfully!' });
            });
        });
    } else {
        // If the file doesn't exist, create a new one
        let jsonData = {};
        jsonData[`cell${newData.index}`] = newData.value;

        fs.writeFile('data.json', JSON.stringify(jsonData), 'utf8', (err) => {
            if (err) {
                console.error('Error saving data:', err);
                return res.status(500).json({ message: 'Error saving data' });
            }
            res.json({ message: 'Data saved successfully!' });
        });
    }
});

// Endpoint to load data from the JSON file
app.get('/api/data', (req, res) => {
    if (fs.existsSync('data.json')) {
        fs.readFile('data.json', 'utf8', (err, data) => {
            if (err) {
                console.error('Error reading data:', err);
                return res.status(500).json({ message: 'Error reading data' });
            }
            res.json(JSON.parse(data));
        });
    } else {
        res.json({});
    }
});

// Start the server on port 3000
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
