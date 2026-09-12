require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const crypto = require('crypto');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);


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

function requireAuth(req, res, next) {

    const token = getSessionToken(req);

    if (!loginSessions.has(token)) {
        return res.status(401).json({
            message: 'Unauthorized'
        });
    }

    next();
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
    res.setHeader('Set-Cookie', `tester_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`);
    res.json({ authenticated: true });
});

app.post('/api/logout', (req, res) => {
    const token = getSessionToken(req);
    if (token) loginSessions.delete(token);
    res.setHeader('Set-Cookie', 'tester_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ authenticated: false });
});

function getIssuePriority(row) {

  const text = 
  `${row.state_long || ""} ${row.raw_title || ""}`.toUpperCase();

  if (text.includes("YIELD ISSUE")) return 1;
  if (text.includes("CONTACT ISSUE")) return 2;
  if (text.includes("RKGU FAIL")) return 3;
  if (text.includes("SYSTEM PROBLEM") ||
  text.includes("SYSTEM ISSUE")) return 4;
  if (text.includes("HANDLER PROBLEM")) return 5;
  if (text.includes("QUALIFICATION FAIL DFL")) return 6;
  if (text.includes("HW CHECKER")) return 7;
  if (text.includes("QA FAIL")) return 8;

  const state = (row.state_short || "").toUpperCase();

  if (state === "SETUP") return 20;
  if (state === "UMAINT") return 21;
  if (state === "PMCAL") return 22;
  if (state === "LOT") return 23;
  if (state === "PRODN") return 24;
  if (state === "ENGG") return 25;

  return 999;
}
function extractDurationSeconds(rawTitle = "") {

  const text = rawTitle.toUpperCase();

  const match = text.match(
    /DURATION\s*:\s*([\d.]+)\s*(DAYS?|HRS?|HOURS?|MINS?|MINUTES?|SECS?|SECONDS?)/i
  );

  if (!match) return 0;

  const value = parseFloat(match[1]);

  if (Number.isNaN(value)) return 0;

  const unit = match[2];

  if (unit.startsWith("DAY"))
    return value * 86400;

  if (unit.startsWith("HR") || unit.startsWith("HOUR"))
    return value * 3600;

  if (unit.startsWith("MIN"))
    return value * 60;

  return value;
}
app.post('/api/statusphere-latest', async (req, res) => {

    try {

        const { ids } = req.body;

        const { data, error } = await supabase
            .from('statusphere_equipment_latest')
            .select(`
                equipment_id,
                state_short,
                state_long,
                raw_title,
                checked_at,
                href
            `)
            .in('equipment_id', ids);

        if (error) throw error;

        // res.json(data);
        data.sort((a, b) => {

        const pa = getIssuePriority(a);
        const pb = getIssuePriority(b);

        if (pa !== pb) {
            return pa - pb;
        }

        const da = extractDurationSeconds(a.raw_title);

        const db = extractDurationSeconds(b.raw_title);
        return db - da;

        });

    res.json(data);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            message: err.message
        });
    }
});

app.post('/api/calibration-plans',
async (req,res)=>{

    const { ids } = req.body;

    const { data, error } = await supabase
      .from('calibration_plans')
      .select('identification, cal_schedule, pm_schedule')
      .in('identification', ids);

    if(error){
        return res.status(500).json(error);
    }

    res.json(data);
});

app.get(
  '/api/last-sync',
  async (req,res)=>{

    const { data, error } = await supabase
      .from('statusphere_equipment')
      .select('checked_at')
      .order('checked_at',{ ascending:false })
      .limit(1);

    if(error){
      return res.status(500).json(error);
    }

    res.json(data?.[0] ?? null);

});

app.get(
 '/api/statusphere-equipment',
 async(req,res)=>{
    const { data, error } = await supabase
    .from('statusphere_equipment')
    .select('checked_at')
    .order('checked_at', { ascending:false })
    .limit(1);
    if(error){
        return res.status(500).json(error);
    }
res.json(data); 
});

app.post(
    '/api/statusphere-newscrape',
    async(req,res)=>{
        const { ids } = req.body;
        const { data, error } = await supabase
        .from('statusphere_equipment')
        .select('checked_at')
        .in('equipment_id', ids)
        .order('checked_at', { ascending: false})
        .limit(1);
        if (error){
            return res.status(500).json(error);
        }
        res.json(data);
    });

// app.get('/api/config', (req, res) => {
//     const supabaseUrl = process.env.SUPABASE_URL;
//     const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

//     if (!supabaseUrl || !supabaseAnonKey) {
//         return res.status(500).json({ message: 'Supabase client configuration is missing' });
//     }

//     res.json({ supabaseUrl, supabaseAnonKey });
// });
app.get(
    '/api/alerts',
    async (req, res) => {
        try {
            const { data: latestRows, error: latestErrors } =
            await supabase
            .from('statusphere_equipment')
            .select('checked_at')
            .order('checked_at', { ascending:false})
            .limit(1);
        
        if (latestErrors) throw latestErrors;
        const latestTs= latestRows?.[0]?.checked_at;
        
        if (!latestTs) {
            return res.json({
                latestTs:null,
                buckets:{}
            });
        }
        const { data: rows, error } =
        await supabase
        .from('statusphere_equipment')
        .select('equipment_id, state_long, raw_title, href')
        .eq('checked_at', latestTs);
        if (error) throw error;

        const buckets = {
            "CONTACT ISSUE": [],
            "YIELD ISSUE": [],
            "RKGU FAIL": [],
            "SYSTEM ISSUE": [],
            "QUALIFICATION FAILURE": [],
            "HW CHECKER ISSUE": [],
            "QA FAILURE": [],
            "HANDLER PROBLEM": [],
        };
        for (const r of rows || []) {
            const text = `${r.state_long || ""} ${r.raw_title || ""}`.toUpperCase();
            let issue = null;
            if (text.includes("YIELD ISSUE"))
                issue = "YIELD ISSUE";
            else if (text.includes("CONTACT ISSUE"))
                issue = "CONTACT ISSUE";
            else if (text.includes("RKGU FAIL"))
                issue = "RKGU FAIL";
            else if (text.includes("SYSTEM ISSUE") || text.includes("SYSTEM PROBLEM"))
                issue = "SYSTEM ISSUE";
            else if (text.includes("QUALIFICATION FAIL DFL"))
                issue = "QUALIFICATION FAILURE";
            else if (text.includes("HW CHECKER"))
                issue = "HW CHECKER ISSUE";
            else if (text.includes("QA FAIL"))
                issue = "QA FAILURE";
            else if (text.includes("HANDLER PROBLEM"))
                issue = "HANDLER PROBLEM";
            if (!issue) continue;
            buckets[issue].push({
                id:r.equipment_id,
                href:r.href
            });

        }
        res.json({
            latestTs,
            buckets
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            message:err.message
        });
    }
  }
);
app.post(
 '/api/pattern-search',
 async(req,res)=>{

   const { patterns, orderBy } = req.body;

   const orFilter =
      patterns
      .map(p => `equipment_id.ilike.${p}`)
      .join(",");

   const { data, error } =
   await supabase
     .from('statusphere_equipment_latest')
     .select(`
       equipment_id,
       state_short,
       state_long,
       raw_title,
       checked_at,
       href
     `)
     .or(orFilter)
     .order(orderBy || 'state_long');

   if(error){
      return res.status(500).json(error);
   }

//    res.json(data);
data.sort((a, b) => {

  const pa = getIssuePriority(a);
  const pb = getIssuePriority(b);

  if (pa !== pb) {
    return pa - pb;
  }

  const da = extractDurationSeconds(a.raw_title);

  const db = extractDurationSeconds(b.raw_title);

  return db - da;
});

res.json(data);

 });

app.post("/api/save",requireAuth, async (req, res) => {
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
    app.get(
 '/api/system-problems',
 async(req,res)=>{

   const { data, error } =
   await supabase
     .from('statusphere_equipment_latest')
     .select(`
        equipment_id,
        state_short,
        state_long,
        raw_title,
        checked_at,
        href
     `)
     .or(
      'state_long.ilike.%SYSTEM PROBLEM%,raw_title.ilike.%SYSTEM PROBLEM%'
     )
     .order('checked_at',{ascending:false});

   if(error){
      return res.status(500).json(error);
   }

   res.json(data);

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
