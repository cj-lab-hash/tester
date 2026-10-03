require('dotenv').config();
const bcrypt = require('bcrypt');
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const crypto = require('crypto');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { log } = require('console');
const { arrayBuffer } = require('stream/consumers');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);
// console.log(
//     process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0,20)
// );
const supabaseTester = supabase.schema('tester');
const SHARED_KEY = process.env.SHARED_KEY;

const sessionTIMEOUT = 12 * 60 * 60 * 1000;
const COOKIE_OPTIONS = 'HttpOnly; Secure; SameSite=Lax; Path=/';
const app = express();
// const loginSessions = new Set();
// const loginSessions = new Map();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// setInterval(() => {
//     const now = Date.now();
//     for (const [token, session] of loginSessions.entries()) {
//         if (session.expiresAt < now) {
//             loginSessions.delete(token);

//         }
//     }
// }, 60 * 1000);
setInterval(async () => {
    try {
        await supabase
            .from('login_sessions')
            .delete()
            .lt('expires_at', Date.now());

        await supabase
            .from('active_visitors')
            .delete()
            .lt('last_seen', Date.now() - (3 * 60 * 1000));

    } catch (err) {
        console.error('Cleanup error:', err);
    }
}, 60 * 1000);



function getSessionToken(req) {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(/(?:^|;\s*)tester_session=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}
function getGuestId(req) {
    const cookies = req.headers.cookie || '';

    const match = cookies.match(
        /(?:^|;\s*)guest_id=([^;]+)/
    );

    return match
        ? decodeURIComponent(match[1])
        : null;
}
async function requireAuth(req, res, next) {

    const token = getSessionToken(req);

    if (!token) {
        return res.status(401).json({
            message: 'Unauthorized'
        });
    }

    const { data: session, error } = await supabase
        .from('login_sessions')
        .select('*')
        .eq('token', token)
        .maybeSingle();
    if (error) {
            console.error(error);
             
            return res.status(500).json({
            message: 'Authentication failed'
            });
    }
    if (!session) {
        return res.status(401).json({
            message: 'Unauthorized'
        });
    }

    if (session.expires_at < Date.now()) {

        await supabase
            .from('login_sessions')
            .delete()
            .eq('token', token);

        return res.status(401).json({
            message: 'Session expired'
        });
    }

    req.session = session;

    next();
}


const APP_VERSION = process.env.RENDER_GIT_COMMIT || 'dev';

app.get('/api/version', (req, res) => {
    res.json({ version: APP_VERSION });
});


// app.get('/api/auth-status', (req, res) => {
//     res.json({ authenticated: loginSessions.has(getSessionToken(req)) });
// });
app.get('/api/auth-status', async (req, res) => {

    const token = getSessionToken(req);
    
    if (!token) {

        res.setHeader(
            'Set-Cookie',
            `tester_session=; ${COOKIE_OPTIONS}; Max-Age=0`
        );

        return res.json({
            authenticated: false
        });
    }
  

    const { data: session, error } = await supabase
    .from('login_sessions')
    .select('*')
    .eq('token', token)
    .maybeSingle();



if (error) {
    console.error(error);

    return res.status(500).json({
        authenticated: false
        });
    }
    

    if (!session) {

        res.setHeader(
            'Set-Cookie',
            `tester_session=; ${COOKIE_OPTIONS}; Max-Age=0`
        );

        return res.json({
            authenticated: false
        });
    }

    if (session.expires_at < Date.now()) {

        await supabase
            .from('login_sessions')
            .delete()
            .eq('token', token);

        res.setHeader(
            'Set-Cookie',
            `tester_session=; ${COOKIE_OPTIONS}; Max-Age=0`
        );

        return res.json({
            authenticated: false
        });
    }

    await supabase
        .from('login_sessions')
        .update({
            expires_at:
                Date.now() + sessionTIMEOUT
        })
        .eq('token', token);

        res.json({
        authenticated: true,
        comments: session.comments,
        username: session.username,
        name: session.full_name,
        role: session.role
    });

});

app.get('/api/dashboard-data', async (req, res) => {
    try {

        const [
            latestResult,
            plansResult,
            // systemResult
            wsResult
        ] = await Promise.all([

            supabase
                .from('statusphere_equipment_latest')
                .select(`
                    equipment_id,
                    state_short,
                    state_long,
                    raw_title,
                    checked_at,
                    href
                `),

            supabase
                .from('calibration_plans')
                .select(`
                    identification,
                    cal_schedule,
                    pm_schedule
                `),

            supabase
                .from('ws_equipment_latest')
                .select(`
                    equipment_id,
                    state_short,
                    state_long,
                    raw_title,
                    checked_at,
                    href
                `)
                

        ]);

        if (latestResult.error) throw latestResult.error;
        if (plansResult.error) throw plansResult.error;
        // if (systemResult.error) throw systemResult.error;
        if (wsResult.error) throw wsResult.error;

        const rows = latestResult.data || [];
        const wsRows = wsResult.data || [];
        const filteredRows = rows.filter(r => {
        const state = (r.state_short || "").toUpperCase();

        const text =
                `${r.state_long || ""} ${r.raw_title || ""}`
                    .toUpperCase();

                return !(
                    state === "ENGG" &&
                    text.includes("YIELD ISSUE_ENG")
                );
                });
        const dashboard = {

            ACT: sortDashboardRows(filteredRows.filter(r =>
                /^(TERCAT|QUARTET|DUO|SZ)/i.test(
                    r.equipment_id
                )
            )
            ),

            UFLEX: sortDashboardRows(filteredRows.filter(r =>
                /^MICROFLEX/i.test(r.equipment_id) ||
                /^TERFLEX/i.test(r.equipment_id) ||
                /IFLEX/i.test(r.equipment_id) ||
                /NIGP4/i.test(r.equipment_id)
            )
        ),

            EAGLE: sortDashboardRows(filteredRows.filter(r =>
                /^EAGLE88/i.test(
                    r.equipment_id
                )
            )
        ),

            MAV: sortDashboardRows(filteredRows.filter(r =>
                /^MAV/i.test(r.equipment_id) ||
                /^TERMAG/i.test(r.equipment_id)
            )
        ),

            TMT: sortDashboardRows(filteredRows.filter(r =>
                /^ASL1K/i.test(r.equipment_id) ||
                /^ASL4K/i.test(r.equipment_id)
            )
        ),

            LEGACY: sortDashboardRows(filteredRows.filter(r =>
                /^KTS/i.test(r.equipment_id) ||
                /^STS50/i.test(r.equipment_id) ||
                /^MPS/i.test(r.equipment_id) ||
                /^NOISE/i.test(r.equipment_id) ||
                /^SC212/i.test(r.equipment_id) ||
                /^TERA360Z/i.test(r.equipment_id)
            )
        ),

            SPEA: sortDashboardRows(filteredRows.filter(r =>
                /^DOT400/i.test(
                    r.equipment_id
                )
            )
        ),

            LTXMX: sortDashboardRows(filteredRows.filter(r =>
                /^LTXMX/i.test(
                    r.equipment_id
                )
            )
        ),

            LTX: sortDashboardRows(filteredRows.filter(r =>
                /^LTX0/i.test(
                    r.equipment_id
                )
            )
        ),

            ARK: sortDashboardRows(filteredRows.filter(r =>
                /^KVDM2/i.test(r.equipment_id) ||
                /^ASL3K/i.test(r.equipment_id) ||
                /^RFX/i.test(r.equipment_id)
            )
        ),
            WS:sortDashboardRows(wsRows),

            SYSTEM: filteredRows.filter(r => {
                const text =
                    `${r.state_long || ""} ${r.raw_title || ""}`
                    .toUpperCase();

                return (
                    text.includes("SYSTEM PROBLEM") ||
                    text.includes("SYSTEM ISSUE")
                );
                }),

            plans: plansResult.data || []
        };

        res.json(dashboard);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            message: err.message
        });

    }
});




app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};



    const loginTime = new Date().toISOString();
    const loginDateObj = new Date(loginTime);
    const localTime = loginDateObj.toLocaleTimeString()
    const clientIp =
    req.headers['x-forwarded-for']
        ?.split(',')[0]
        .trim() ||
    req.socket.remoteAddress;

    const token = crypto.randomBytes(32).toString('hex');
    const { data: user } = await supabaseTester
    .from("user_accounts")
    .select("*")
    .eq("id_number", username)
    .maybeSingle();

    if (!user) {
        return res.status(401).json({
            message: "Invalid ID Number or Password"
        });
    }

    if (!user.approved) {
        return res.status(403).json({
            message: "Account is pending approval."
        });
    }
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
        return res.status(401).json({
            message: "Invalid ID Number or Password"
        });
    }

    const { data: employee } =await supabaseTester
    .from("employee_master")
    .select("*")
    .eq("id_number", username)
    .maybeSingle();

    const session = {
        username,
        name: employee?.full_name || username,
        role: user.role,
        // comments: user.role === "admin",
        comments: ["admin", "superuser"].includes(user.role),
        ip:clientIp,
        localTime,
        expiresAt: Date.now() + sessionTIMEOUT
    }
    
const { error: sessionError } = await supabase
    .from("login_sessions")
    .upsert({
        token,
        username,
        full_name: employee?.full_name,
        role: user.role,
        comments: ["admin", "superuser"].includes(user.role),
        ip: clientIp,
        local_time: localTime,
        expires_at: Date.now() + sessionTIMEOUT
    });

console.log("SESSION ERROR:", sessionError);

if (sessionError) {
    return res.status(500).json({
        message: sessionError.message
    });
}
    res.setHeader(
        "Set-Cookie",
        `tester_session=${token}; ${COOKIE_OPTIONS}; Max-Age=43200`
    );
    res.json({
        authenticated: true,
        comments: session.comments
    });

    
    
});

app.get('/api/test-role', async (req,res) => {

    const result = await supabaseTester
        .from('employee_master')
        .select('*')
        .limit(1);

    // console.log(result);

    res.json(result);
});
app.post('/api/register', async (req, res) => {
    try {
        const {
            idNumber,
            password,
            confirmPassword
        } = req.body;
        if (
            !idNumber ||
            !password ||
            !confirmPassword
        ) {
            return res.status(404).json({
                message: "All fields are required."
            });
        }
        if (password !== confirmPassword) {
            return res.status(404).json({
                message: "Password not match."
            });
        }
        if (password.length < 8) {
            return res.status(404).json({
                message: "Password must containt at least 8 characters."
            });
        }

        const {
            data:employee,
            error: employeeError
        } = await supabaseTester
        .from("employee_master")
        .select("*")
        .eq("id_number", idNumber)
        .eq("active", true)
        .maybeSingle();

        // console.log("=== REGISTER ===");
        // console.log("idNumber =", idNumber);
        // console.log("employee =", employee);
        // console.log("employeeError =", employeeError);

        if (employeeError) {
            return res.status(500).json({
                message: employeeError.message
            });
        }

        if (!employee) {
            return res.status(403).json({
                message: "ID number is not authorized."
            });
        }   
 
        const passwordHash = await bcrypt.hash(
            password,
            10
        );
        const {
                data: existingUser,
                error: existingUserError
            } = await supabaseTester
            .from("user_accounts")
            .select("id_number")
            .eq("id_number", idNumber)
            .maybeSingle();

            // console.log("existingUser =", existingUser);
            // console.log("existingUserError =", existingUserError);
        
        if(existingUser) {
            return res.status(409).json({
                message: "Account already existed."
            });
        }

        const { error: insertError } =
            await supabaseTester
        .from("user_accounts")
        .insert({
            id_number: idNumber,
            password_hash: passwordHash,
            approved: true,
            role: employee.role || "user"
        });

        // console.log("insertError =", insertError);
        if (insertError) {
            // console.log("INSERT ERROR:");
            // console.log(insertError);

            return res.status(500).json({
                message: insertError.message
            });
        }

        return res.json({
            success: true,
            message: "Registration successful."
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            message: "Internal server error."
        });
    }
});

app.post('/api/logout', async (req, res) => {
    const token = getSessionToken(req);
    
    if (token) {
        await supabase
            .from('login_sessions')
            .delete()
            .eq('token', token);
    }
    res.setHeader('Set-Cookie', `tester_session=; ${COOKIE_OPTIONS}; Max-Age=0`);
    res.json({ authenticated: false });
});
app.get('/api/active-user', requireAuth, async (req, res) => {

    const cutoff = Date.now() - (3 * 60 * 1000);
    // const token = getSessionToken(req);
    // const session = loginSessions.get(token);
    const session = req.session;

    if (session?.role !== 'admin') {
        return res.status(403).json({
            message: "Admin access required"
        });
    }
    const { data, error } = await supabase
        .from('active_visitors')
        .select('*')
        .gt('last_seen', cutoff);

    if (error) {
        return res.status(500).json(error);
    }

    res.json(data);
});
function sortDashboardRows(rows) {
  return [...rows].sort((a, b) => {

    const pa = getIssuePriority(a);
    const pb = getIssuePriority(b);

    if (pa !== pb) {
      return pa - pb;
    }

    const da = extractDurationSeconds(
      a.raw_title
    );

    const db = extractDurationSeconds(
      b.raw_title
    );

    return db - da;
  });
}
function getIssuePriority(row) {

  const text = 
  `${row.state_long || ""} ${row.raw_title || ""}`.toUpperCase();

  if (text.includes("YIELD ISSUE")) return 1;
  if (text.includes("CONTACT ISSUE")) return 2;
  if (text.includes("QUALIFICATION FAIL DFL")) return 3;
  if (text.includes("RKGU FAIL")) return 4;
  if (text.includes("QA FAIL")) return 5;
  if (text.includes("HANDLER PROBLEM")) return 6;
  if (text.includes("HW CHECKER")) return 7;
  if (text.includes("SYSTEM PROBLEM") ||
  text.includes("SYSTEM ISSUE")) return 8;


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
async function requireAdmin(
    req, res, next
){
    const token = getSessionToken(req);
    if(!token){
        return res
            .status(401)
            .json({
                message:'Unathorized'
            });
    }
    const { data:session } = await supabase
            .from('login_sessions')
            .select('*')
            .eq('token', token)
            .maybeSingle();
    if(!session) {
        return res.status(401).json({
            message: 'Session not found'
        });
    }
    if(session.role != 'admin') {
        return res.status(403).json({
            message: 'Admin access only'
        });
    }
    req.session = session;
    next();
}


app.post ('/api/comments/request', async (req,res) => {
    const {
        equipment_id,
        statusphere_url
    } = req.body;
    const { error } =
    await supabase
    .from('comment_requests')
    .upsert(
        {
            equipment_id,
            statusphere_url,
            status: "pending"
        },
        { 
            onConflict: 'equipment_id'
        }
    );
    if ( error ) {
        return res.status(500).json(error);
    }
    res.json({
        success: true
    });
});
app.delete ('/api/request-cleanup', async (req, res) => {
    try {
        const cutoff = new Date(
            Date.now() - 3 * 60 *1000
        ).toISOString();

        
    const { error } = await supabase
        .from('comment_requests')
        .delete()
        .in("status", ["completed", "failed"])
        .lt("created_at", cutoff);

        if (error) {
            console.error("Request cleanup error:", error);

        // return res.status(500).json({
        //     success: false,
        //     error: error.message
        // });
        }
    // console.log("Old processed requests cleaned");
    return res.json({
        success: true
        });
    } catch (error) {
    console.error("Request cleanup failed:", error);

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
    

const STATUSPHERE_BASE =
  'http://statusphere.maxim-ic.com/dp/';

app.get("/api/redirect/:equipmentId", async (req, res) => {
  const id = req.params.equipmentId;
  const token = getSessionToken(req);

    let session = null;

     if (token) {
        const { data } = await supabase
            .from('login_sessions')
            .select('*')
            .eq('token', token)
            .maybeSingle();

        session = data;
    }

  const timestamp = Math.trunc(Date.now() / 1000);
  const payload = `${timestamp}`;
  const signature = crypto.createHmac("sha256", SHARED_KEY).update(payload).digest("hex"); 
  const mode = req.query.mode || "statusphere";
  const ajaxUrl = `https://ajax-xt2d.onrender.com/?equipmentID=${encodeURIComponent(id)}&ts=${payload}&sig=${signature}`


    // console.log("========== REDIRECT ==========");
    // console.log("Equipment:", req.params.equipmentId);
    // console.log("Mode:", req.query.mode);
    // console.log("Token:", token);

    // console.log("Session:", session);

    // console.log("Role:", session?.role);
    // console.log("==============================");
    if (
        mode === "ajax" &&
        ["admin", "superuser"].includes(session?.role)
     ) {
    //     console.log("AJAX REDIRECT ALLOWED");
    // console.log("AJAX URL:", ajaxUrl);
    return res.redirect(ajaxUrl);
  }

//   console.log("STATUSPHERE REDIRECT");
  return res.redirect(
    `${STATUSPHERE_BASE}?q=br/equipment-hist/TEST&EQUIPMENT=${encodeURIComponent(id)}`
  );
   
});
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

//    data.forEach(row => {
//     const text = `${row.state_long || ""} ${row.raw_title || ""}`;
//     // if (text.toLocaleUpperCase().includes("YIELD")) {
//     //     console.log(
//     //         row.equipment_id,
//     //         row.state_short,
//     //         row.state_long
//     //     );
//     // }
//    });
const filteredData = data.filter(row => {
    const state = (row.state_short || "").toUpperCase();
    const text = `${row.state_long || ""} ${row.raw_title || ""}`.toUpperCase();

    return !(
        state === "ENGG" && text.includes("YIELD ISSUE_ENG")
    );
});

filteredData.sort((a, b) => {


  const pa = getIssuePriority(a);
  const pb = getIssuePriority(b);

  if (pa !== pb) {
    return pa - pb;
  }

  const da = extractDurationSeconds(a.raw_title);

  const db = extractDurationSeconds(b.raw_title);

  return db - da;
});

res.json(filteredData);

 });

app.post('/api/heartbeat', async (req, res) => {
// console.log("guestId:", getGuestId(req));
// console.log("body:", req.body);
    try {

        const guestId = getGuestId(req);

        if (!guestId) {
            return res.json({
                success: true,
                message: "No guest_id found"
            });
        }

        const token = getSessionToken(req);

        // const session =
        //     token && loginSessions.has(token)
        //         ? loginSessions.get(token)
        //         : null;
        let session = null;

        if (token) {
            const { data } = await supabase
                .from('login_sessions')
                .select('*')
                .eq('token', token)
                .maybeSingle();

            session = data;
        }

        const { data, error } = await supabase
            .from('active_visitors')
            .upsert({
                guest_id: guestId,
                username: session?.full_name || session?.username || null,
                last_seen: Date.now(),
                page: req.body.page || '/',
                view: req.body.view || null,
                authenticated: !!session,
                role: session?.role || 'guest'
            },
        {
            onConflict: 'guest_id'
        }
    )
            .select();

        if (error) {
            console.error('HEARTBEAT ERROR:', error);

            return res.status(500).json({
                success: false,
                error: error.message
            });
        }

        res.json({
            success: true
        });

    } catch (err) {

        console.error('HEARTBEAT EXCEPTION:', err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
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
            // console.log('Fetching data from database...');
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
//admin page
app.get('/admin', async (req, res) => {

    const token = getSessionToken(req);

    // console.log('TOKEN:', token);

    let session = null;

    if (token) {
        const { data } = await supabase
            .from('login_sessions')
            .select('*')
            .eq('token', token)
            .maybeSingle();

        session = data;
    }

    // console.log('SESSION:', session);
    // console.log('ROLE:', session?.role);

    if (
        !session ||
        session.role !== 'admin'
    ) {
        return res.status(403).send('Admin only');
    }

    res.sendFile(
        path.join(
            __dirname,
            'public',
            'admin.html'
        )
    );
});
app.get('/api/admin/visitors', requireAdmin, async (req, res) => {
    const { data, error } =
    await supabase
        .from('active_visitors')
        .select('*')
        .order('last_seen', {
            ascending:false
        });

    if (error) {
        return res.status(500).json(error);
    }
    res.json(data);
});

app.get('/api/admin/sessions', requireAdmin, async (req, res) => {
    const { data, error } = await supabase
    .from('login_sessions')
    .select('*');

if (error) {
    return res.status(500).json(error);
}
res.json(data);
});

app.get('/api/admin/users', requireAdmin,async (req, res) => {
    const { data: users, error } = await supabaseTester
        .from('user_accounts')
        .select('*');

    if (error) {
        return res.status(500).json(error);
    }
    const ids = users.map(u => u.id_number);

    const { data:employees } = await supabaseTester
                .from('employee_master')
                .select('id_number, full_name')
                .in('id_number', ids);

    const nameMap = new Map(
        (employees || []).map(e => [
            e.id_number,
            e.full_name
        ])
    );
    
    const result = users.map(u => ({
        ...u,
        full_name: nameMap.get(u.id_number) || 'UNKNOWN'
    }));
    res.json(result);
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    const visitors = await supabase
        .from('active_visitors')
        .select('*', {
            count: 'exact',
            head: true
        });

    const sessions = await supabase
        .from('login_sessions')
        .select('*', {
            count: 'exact',
            head: true
        });

    const users = await supabaseTester
        .from('user_accounts')
        .select('*', {
            count: 'exact',
            head: true
        });
        res.json({
            visitors: visitors.count || 0,
            sessions: sessions.count || 0,
            users: users.count || 0

        });
});

app.get(
  '/api/admin/health',
  requireAdmin,
  async (req, res) => {
    console.log('Using tester schema...');
    const result = await supabaseTester
        .from('sync_status')
        .select('*');
    console.log(result);
    
    const { data, error } =
      await supabaseTester
        .from('sync_status')
        .select('*');

    if (error) {
      return res.status(500).json(error);
    }

    const ft = data.find(x => x.service === 'FT');

    const ws = data.find(x => x.service === 'WS');

    res.json({ft: ft?.status || 'UNKNOWN',
             ws: ws?.status || 'UNKNOWN',

             ftLastRun: ft?.last_run || null,

             wsLastRun: ws?.last_run || null,

             ftVisitors: ft?.visitor_count || 0,

             wsVisitors: ws?.visitor_count || 0
    });

});

app.get('/api/admin/view-stats',requireAdmin, async(req,res)=>{

const cutoff =
Date.now() - 300000;

const { data } =
await supabase
.from('active_visitors')
.select('view')
.gt('last_seen',cutoff);

const counts = {};

for(const row of data){

counts[row.view] =
(counts[row.view] || 0) + 1;

}

res.json(counts);

});

app.delete('/api/admin/session/:token', requireAdmin, async(req,res)=>{

        const token =
        req.params.token;

        await supabase
        .from('login_sessions')
        .delete()
        .eq('token', token);

        res.json({
        success:true
        });

});





app.delete(
    '/api/admin/cleanup-visitors',
    requireAdmin,
    async(req,res)=>{

        const cutoff =
            Date.now() -
            (5 * 60 * 1000);

        const { data, error } =
            await supabase
                .from('active_visitors')
                .delete()
                .lt(
                    'last_seen',
                    cutoff
                )
                .select();

        if (error) {
            return res.status(500).json(error);
        }

        res.json({
            success:true,
            deleted:
                data?.length || 0
        });

});

app.get('/api/admin/view-distribution', requireAdmin, async (req, res) => {

    const cutoff =
        Date.now() - (5 * 60 * 1000);

    const { data, error } = await supabase
        .from('active_visitors')
        .select('view')
        .gt('last_seen', cutoff);

    if (error) {
        console.error(error);
        return res.status(500).json(error);
    }

    const counts = {};

    for (const row of data || []) {

        const view = row.view || 'UNKNOWN';

        counts[view] =
            (counts[view] || 0) + 1;
    }

    res.json(counts);

});


app.get('/api/admin/comment-request', requireAdmin, async (req, res) => {

    const { data, error } = await supabase
        .from('comment_requests')
        .select('*')
        .order('created_at', { ascending: false });

    if (error){
        return res.status(500)
                  .json(error);
    }
    res.json(data);
});

app.get('/api/admin/comment-stats', requireAdmin, async (req, res) => {

    const { data } = await supabase
        .from('comment_requests')
        .select('status');
    const stats = {
        pending:0,
        completed:0,
        failed:0
    };
    for(const ror of data || []){
        const status = row.status?.toLowerCase();
        if(stats[status] !== undefined){
            stats[status]++;
        }
    }
    res.json(stats);
});
// Start the server on port 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
