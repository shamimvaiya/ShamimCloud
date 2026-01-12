require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_API = "https://api.github.com";
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const BRANCH = process.env.GITHUB_BRANCH || 'main';

// 🔥 IMPORT STORAGE UTILITY 🔥
const storage = require('./storage');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const upload = multer({ storage: multer.memoryStorage() });
const getHeaders = () => ({ 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/vnd.github.v3+json' });

// --- HELPERS (Delegated to storage.js) ---
const fetchFile = storage.getFile;
const saveFile = storage.updateFile;

// 🔥 SMART GATEKEEPER (AUTO DOWNGRADE LOGIC) 🔥
function checkExpiry(user) {
    if (user.role === 'admin' || user.role === 'superadmin') return false; // 🔥 ADMIN EXEMPTION 🔥
    if (user.plan !== 'free' && user.expiryDate) {
        const now = new Date();
        const expiry = new Date(user.expiryDate);
        if (now > expiry) {
            user.plan = 'free';
            user.expiryDate = null; // Reset date
            return true; // Status changed
        }
    }
    return false; // No change
}

// --- AUTH ROUTES ---

// 1. REGISTER
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (username.toLowerCase() === process.env.ADMIN_USER.toLowerCase()) {
        return res.json({ success: false, message: 'This username is reserved!' });
    }

    let users = await fetchFile('database/users.json') || [];
    if (users.find(u => u.username === username || u.email === email)) return res.json({ success: false, message: 'User exists' });

    // Added expiryDate: null
    users.push({ id: Date.now(), username, email, password, plan: 'free', role: 'user', expiryDate: null });

    await saveFile('database/users.json', users, 'Register');

    res.json({ success: true, message: 'Registered successfully' });
});

// 2. LOGIN (With Auto Downgrade Check)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        return res.json({
            success: true,
            user: {
                username: 'Super Admin',
                email: 'admin@shamimcloud.com',
                role: 'admin',
                plan: 'vip'
            }
        });
    }

    let users = await fetchFile('database/users.json') || [];
    let user = users.find(u => u.username === username && u.password === password);

    if (user) {
        // 🔥 CHECK EXPIRY ON LOGIN 🔥
        if (checkExpiry(user)) {
            // If downgraded, save to DB
            await saveFile('database/users.json', users, `Auto Downgrade ${user.username}`);
        }
        res.json({ success: true, user });
    } else {
        res.json({ success: false, message: 'Invalid credentials' });
    }
});

// 3. GET USER (Fetch fresh data & Check Expiry)
app.get('/api/user', async (req, res) => {
    const { username } = req.query;
    if (!username) return res.json({ success: false, message: 'Username required' });

    let users = await fetchFile('database/users.json') || [];
    let user = users.find(u => u.username === username);

    if (user) {
        // 🔥 CHECK EXPIRY ON ANY FETCH 🔥
        if (checkExpiry(user)) {
            // If downgraded, save to DB
            await saveFile('database/users.json', users, `Auto Downgrade ${user.username}`);
        }
        res.json({ success: true, user });
    } else {
        res.json({ success: false, message: 'User not found' });
    }
});

// --- PROJECT MANAGER (Kept from Previous) ---
app.get('/api/project-details', async (req, res) => {
    const { username, project } = req.query;
    try {
        const path = `hosting/${project}`;
        const files = await storage.getFile(path);
        if (!files) throw new Error('Not found');
        res.json({ success: true, files: files, totalSize: files.reduce((acc, f) => acc + f.size, 0) });
    } catch (e) { res.status(404).json({ success: false }); }
});

app.post('/api/get-file-content', async (req, res) => {
    try {
        const pathParts = req.body.path.split('/');
        // If old path style detected sites/user/project/file, convert to hosting/project/file
        // But simpler: just trust storage.getFile if path is correct, or fix if known pattern
        // The frontend editor sends 'sites/user/project/file' likely.
        let realPath = req.body.path;
        if (realPath.startsWith('sites/')) {
            const parts = realPath.split('/');
            realPath = `hosting/${parts[2]}/${parts.slice(3).join('/')}`;
        }

        const content = await storage.getFile(realPath);
        if (!content) throw new Error("Not found");

        // Ensure content is string for editor
        const finalContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        res.json({ success: true, content: finalContent, sha: 'N/A' });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/update-file', async (req, res) => {
    try {
        let content = req.body.content;
        const pathParts = req.body.path.split('/');
        // Extract username from path: sites/USERNAME/project/file
        const username = pathParts[1];
        const fileName = pathParts[pathParts.length - 1];

        // 🔥 WATERMARK ENFORCEMENT ON EDITOR SAVE 🔥
        if (fileName === 'index.html' && username) {
            let users = await fetchFile('database/users.json') || [];
            const user = users.find(u => u.username === username);

            const watermark = `<div id="shamim-cloud-watermark" style="position:fixed; bottom:10px; right:10px; z-index:9999; background: linear-gradient(45deg, #6b21a8, #7c3aed); padding: 6px 12px; border-radius: 50px; font-family: sans-serif; font-size: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); pointer-events: auto; cursor: pointer; transition: transform 0.2s;">
          <a href="https://shamimcloud.vercel.app" target="_blank" style="text-decoration: none; color: white; display: flex; align-items: center; gap: 5px;">
            🚀 Powered by <b>ShamimCloud</b>
          </a>
        </div>`;

            if (user && user.plan === 'free') {
                // Remove existing legacy/duplicate strings to ensure clean state
                content = content.replace(/<div id="shamim-cloud-watermark".*?<\/div>/s, '');
                content = content.replace('Powered by Shamim Cloud', '');

                if (content.includes('</body>')) {
                    content = content.replace('</body>', `${watermark}\n</body>`);
                } else {
                    content += `\n${watermark}`;
                }
            } else {
                // Clean for Paid Users
                content = content.replace(/<div id="shamim-cloud-watermark".*?<\/div>/s, '');
                content = content.replace(/<div.*?Powered by Shamim Cloud.*?<\/div>/s, '');
            }
        }

        // Update logic for new path structure
        const realPath = `hosting/${pathParts[2]}/${fileName}`;
        // Previously sites/USER/PROJECT/file. pathParts[2] is PROJECT.

        await saveFile(realPath, content, 'Edit File');
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

// 🔥 MAINTENANCE / ARCHIVE LOGIC 🔥
app.post('/api/project-action', async (req, res) => {
    const { username, project, action } = req.body;
    const basePath = `hosting/${project}`;

    try {
        if (action === 'maintenance_on') {
            const idxContent = await storage.getFile(`${basePath}/index.html`);
            if (idxContent) {
                await saveFile(`${basePath}/index_bak.html`, idxContent, 'Backup Index');
            }

            const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Maintenance Mode | ${project}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;500;700&display=swap');
        body { margin: 0; padding: 0; font-family: 'Outfit', sans-serif; background-color: #030712; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; overflow: hidden; position: relative; }
        .glow { position: absolute; width: 600px; height: 600px; background: radial-gradient(circle, rgba(124, 58, 237, 0.15) 0%, transparent 70%); top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 0; }
        .card { position: relative; z-index: 10; background: rgba(30, 41, 59, 0.4); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.1); padding: 3rem; border-radius: 24px; text-align: center; max-width: 450px; width: 90%; }
        h1 { margin: 0; font-size: 1.8rem; font-weight: 700; color: #fff; }
        p { color: #94a3b8; font-size: 0.95rem; margin-top: 0.5rem; }
    </style>
</head>
<body>
    <div class="glow"></div>
    <div class="card">
        <h1>System Update</h1>
        <p>We are currently updating our server. We will be back shortly.</p>
    </div>
</body>
</html>`;
            await saveFile(`${basePath}/index.html`, htmlContent, 'Maintenance ON');

        } else if (action === 'maintenance_off') {
            const bakContent = await storage.getFile(`${basePath}/index_bak.html`);
            if (bakContent) {
                await saveFile(`${basePath}/index.html`, bakContent, 'Maintenance OFF');
                await storage.deleteFile(`${basePath}/index_bak.html`, 'Del Backup');
            }

        } else if (action === 'archive') {
            const idxContent = await storage.getFile(`${basePath}/index.html`);
            if (idxContent) {
                await saveFile(`${basePath}/index_old_backup.html`, idxContent, 'Backup for Archive');
            }

            const archivedHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Site Unavailable | Shamim Cloud</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        body { font-family: 'Outfit', sans-serif; background-color: #020617; color: white; }
    </style>
</head>
<body class="h-screen flex flex-col items-center justify-center relative overflow-hidden">
    <!-- Glow Effects -->
    <div class="absolute top-0 left-0 w-96 h-96 bg-indigo-600/20 blur-[100px] rounded-full -translate-x-1/2 -translate-y-1/2"></div>
    <div class="absolute bottom-0 right-0 w-96 h-96 bg-pink-600/20 blur-[100px] rounded-full translate-x-1/2 -translate-y-1/2"></div>

    <div class="z-10 text-center p-8 max-w-md w-full animate-bounce">
        <!-- Icon -->
        <div class="mb-6">
            <i class="fas fa-ghost text-6xl text-gray-600"></i>
        </div>
    </div>
        
    <div class="z-10 text-center p-8 max-w-md w-full">
        <h1 class="text-4xl font-bold mb-2 bg-gradient-to-r from-indigo-400 to-pink-400 bg-clip-text text-transparent">Site Unavailable</h1>
        <p class="text-gray-400 mb-8 leading-relaxed">The project you are looking for has been archived or removed by the owner.</p>

        <!-- Footer -->
        <div class="mt-8 pt-8 border-t border-gray-800">
            <p class="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Hosted by Shamim Cloud</p>
        </div>
    </div>
</body>
</html>`;
            await saveFile(`${basePath}/index.html`, archivedHTML, 'project_archived');
            await saveFile(`${basePath}/archived.html`, 'This project is archived.', 'Archive Marker');

        } else if (action === 'unarchive') {
            const backupContent = await storage.getFile(`${basePath}/index_old_backup.html`);
            if (!backupContent) return res.json({ success: false, message: 'Backup not found. Cannot restore.' });

            await saveFile(`${basePath}/index.html`, backupContent, 'Restore Project');
            await storage.deleteFile(`${basePath}/index_old_backup.html`, 'Cleanup Backup');
            await storage.deleteFile(`${basePath}/archived.html`, 'Cleanup Marker');
        }

        // 🔥 SYNC STATUS TO DATABASE (AFTER ACTION SUCCESS) 🔥
        try {
            let projects = await fetchFile('database/projects.json') || [];
            let pIndex = projects.findIndex(p => p.name === project && p.owner === username);

            if (pIndex === -1) {
                projects.push({ name: project, owner: username, status: 'active', created: new Date().toISOString() });
                pIndex = projects.length - 1;
            }

            if (action === 'archive') projects[pIndex].status = 'archived';
            if (action === 'unarchive') projects[pIndex].status = 'active';

            await saveFile('database/projects.json', projects, `Update Project ${project}`);
        } catch (err) { console.error("DB Sync Failed", err); }

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: e.message });
    }
});

// Delete Account
app.post('/api/delete-account', async (req, res) => {
    const { username, password } = req.body;
    try {
        let users = await fetchFile('database/users.json') || [];
        const userIndex = users.findIndex(u => u.username === username);

        if (userIndex === -1) return res.json({ success: false, message: 'User not found' });
        if (users[userIndex].password !== password) return res.json({ success: false, message: 'Incorrect password' });

        // Remove User
        users.splice(userIndex, 1);

        // Save DB
        await saveFile('database/users.json', users, `Delete User ${username}`);

        // Optional: Trigger background job to delete user files (not blocking response)
        // For now, we leave the files as "orphaned" or handle them in a separate cleanup task to prevent timeout.

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'Server error' });
    }
});

// Delete Project
app.post('/api/delete-project', async (req, res) => {
    const path = `hosting/${req.body.projectName}`;
    try {
        // storage.deleteFile works on single file, for directory we need recursive?
        // GitHub API can delete file. Deleting directory requires deleting all files.
        const files = await storage.getFile(path); // Returns array
        if (Array.isArray(files)) {
            for (const f of files) {
                await storage.deleteFile(f.path, 'Delete Project');
            }
        } else {
            await storage.deleteFile(path, 'Delete Project');
        }
        res.json({ success: true });
    } catch { res.json({ success: false }); }
});

// Standard Routes
app.get('/api/projects', async (req, res) => {
    try {
        const metadata = await fetchFile('database/projects.json') || [];
        const userProjects = metadata.filter(m => m.owner === req.query.username);

        const projects = userProjects.map(m => ({
            name: m.name,
            url: `https://${storage.USERNAME}.github.io/${storage.STORAGE_REPO}/hosting/${m.name}/index.html`,
            status: m.status,
            lastUpdated: m.created
        }));

        res.json({ success: true, projects });
    } catch {
        res.json({ success: true, projects: [] });
    }
});

app.post('/api/deploy', upload.single('file'), async (req, res) => {
    const { username, projectName, fileName } = req.body;
    let users = await fetchFile('database/users.json') || [];
    const user = users.find(u => u.username === username);

    if (!user) return res.json({ success: false, message: 'User not found' });

    // 0. UPLOAD SIZE CHECK (Hard Limit 25MB)
    if (req.file.buffer.length > 25 * 1024 * 1024) {
        return res.json({ success: false, message: 'File too large. Max limit is 25MB.' });
    }

    // 1. DYNAMIC DEPLOYMENT LIMIT CHECK
    // Skip for Admin
    if (user.role !== 'admin' && user.role !== 'superadmin') {
        const plans = await fetchFile('database/plans.json') || {
            free: { max_projects: 1 },
            pro: { max_projects: 10 },
            vip: { max_projects: -1 }
        };

        const planLimits = plans[user.plan] || plans['free'];
        const maxProjects = planLimits.max_projects;

        let projects = await fetchFile('database/projects.json') || [];
        const userProjects = projects.filter(p => p.owner === username);
        const existingProject = userProjects.find(p => p.name === projectName);

        // If New Project AND Limit Reached (and not Unlimited "-1")
        if (!existingProject && maxProjects !== -1 && userProjects.length >= maxProjects) {
            return res.json({ success: false, message: `Project limit reached (${maxProjects}). Upgrade plan for more.` });
        }
    }

    let contentBase64 = req.file.buffer.toString('base64');

    // 2. WATERMARK INJECTION (index.html only)
    if (fileName === 'index.html') {
        let content = req.file.buffer.toString('utf-8');
        const watermark = `<div id="shamim-cloud-watermark" style="position:fixed; bottom:10px; right:10px; z-index:9999; background: linear-gradient(45deg, #6b21a8, #7c3aed); padding: 6px 12px; border-radius: 50px; font-family: sans-serif; font-size: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); pointer-events: auto; cursor: pointer; transition: transform 0.2s;">
                                        <a href="https://shamimcloud.vercel.app" target="_blank" style="text-decoration: none; color: white; display: flex; align-items: center; gap: 5px;">
                                            🚀 Powered by <b>ShamimCloud</b>
                                        </a>
                                    </div>`;

        if (user.plan === 'free') {
            // Always ensure it's there for free users
            // Remove existing (if any old one exists) to prevent duplicates
            content = content.replace(/<div id="shamim-cloud-watermark".*?<\/div>/s, '');
            content = content.replace('Powered by Shamim Cloud', ''); // Legacy cleanup

            // Inject at end of body
            if (content.includes('</body>')) {
                content = content.replace('</body>', `${watermark}\n</body>`);
            } else {
                content += `\n${watermark}`;
            }
        } else {
            // Remove if exists
            content = content.replace(/<div id="shamim-cloud-watermark".*?<\/div>/s, '');
            content = content.replace(/<div.*?Powered by Shamim Cloud.*?<\/div>/s, '');
        }
        contentBase64 = Buffer.from(content).toString('base64');
    }

    const uploadSuccess = await storage.uploadProjectFiles(username, projectName, req.file);
    if (!uploadSuccess) return res.json({ success: false, message: 'Upload Failed' });

    // Ensure Project is in DB (Sync on Deploy to ensure Limit works effectively for next time)
    // This handles the "First Deploy" case registering the project 
    let projects = await fetchFile('database/projects.json') || [];
    let pIndex = projects.findIndex(p => p.name === projectName && p.owner === username);
    if (pIndex === -1) {
        projects.push({ name: projectName, owner: username, status: 'active', created: new Date().toISOString() });
        await saveFile('database/projects.json', projects, `Init Project ${projectName} `);
    }

    res.json({ success: true });
});

// --- ADMIN & PACKAGES ---

// 1. Get/Set Package Settings (Now PLANS)
app.get('/api/get-plans', async (req, res) => {
    const plans = await fetchFile('database/plans.json') || {
        free: { price: 0, duration: 365, storage: 100, max_projects: 1 },
        pro: { price: 10, duration: 30, storage: 512, max_projects: 10 },
        vip: { price: 25, duration: 30, storage: 2048, max_projects: -1 }
    };
    res.json({ success: true, plans });
});

app.post('/api/admin/update-plans', async (req, res) => {
    console.log("[ADMIN] Updating Plans:", req.body);
    await saveFile('database/plans.json', req.body, 'Update Plans');
    console.log("[ADMIN] Plans Updated Successfully");
    res.json({ success: true });
});

// 2. Update Plan (Manual Admin Override use Plans defaults if no date provided?)
// Keeping original route but adding plan check
app.post('/api/admin/update-plan', async (req, res) => {
    const { targetUsername, newPlan, expiryDate } = req.body;
    let users = await fetchFile('database/users.json') || [];
    const userIndex = users.findIndex(u => u.username === targetUsername);

    if (userIndex !== -1) {
        users[userIndex].plan = newPlan;

        if (newPlan === 'free') {
            users[userIndex].expiryDate = null;
        } else if (expiryDate) {
            users[userIndex].expiryDate = expiryDate; // Manual date
        } else {
            // Logic if auto-update needed? Admin usually sends specific date. 
            // We'll leave this as-is for manual edits, assuming admin sends date.
        }

        await saveFile('database/users.json', users, `Update ${targetUsername} `);
        res.json({ success: true, message: `Updated ${targetUsername} to ${newPlan} ` });
    } else { res.json({ success: false, message: 'User not found' }); }
});

// 3. Verify Payment (AUTO CALC DURATION FROM PLANS)
app.post('/api/admin/verify-payment', async (req, res) => {
    const { id, action, username, plan } = req.body; // Removed expiryDate form input dependency

    let payments = await fetchFile('database/payments.json') || [];
    let users = await fetchFile('database/users.json') || [];
    let plans = await fetchFile('database/plans.json') || {
        free: { price: 0, duration: 365 },
        pro: { price: 10, duration: 30 },
        vip: { price: 25, duration: 30 }
    };

    // Remove from pending
    payments = payments.filter(p => String(p.id) !== String(id));
    await saveFile('database/payments.json', payments, 'Process Pay');

    if (action === 'approve') {
        const uIdx = users.findIndex(u => u.username === username);
        if (uIdx !== -1) {
            // Determine Plan Key
            let planKey = 'pro';
            if (plan.toLowerCase().includes('vip')) planKey = 'vip';

            // Set Plan
            users[uIdx].plan = planKey;

            // Calculate Expiry Date based on Plan Duration
            const durationDays = plans[planKey]?.duration || 30;
            const newExpiry = new Date();
            newExpiry.setDate(newExpiry.getDate() + parseInt(durationDays));
            users[uIdx].expiryDate = newExpiry.toISOString();

            await saveFile('database/users.json', users, `Approved ${username} `);
            return res.json({ success: true, message: `Approved! ${durationDays} days added.` });
        }
    }
    res.json({ success: true, message: 'Rejected' });
});

// 4. DOWNLOAD ZIP (PRO Feature)
app.get('/api/download-zip', async (req, res) => {
    const { username, project } = req.query;
    if (!username || !project) return res.status(400).send('Missing parameters');

    // 1. Check User Plan
    let users = await fetchFile('database/users.json') || [];
    const user = users.find(u => u.username === username);

    if (!user) return res.status(404).send('User not found');
    if (user.plan === 'free') return res.status(403).send('Upgrade to PRO to download source code.');

    // 2. Fetch Files from GitHub
    try {
        const path = `hosting/${project}`;
        const files = await storage.getFile(path); // Returns array of file objects

        if (!files || !Array.isArray(files)) return res.status(404).send('Project not found or empty');

        // 3. Create ZIP Stream
        const archive = archiver('zip', { zlib: { level: 9 } });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${project}.zip"`);

        archive.pipe(res);

        // 4. Append Files
        for (const file of files) {
            if (file.type === 'file') {
                // Fetch content for each file
                const fileRes = await axios.get(file.download_url, { responseType: 'arraybuffer' });
                archive.append(fileRes.data, { name: file.name });
            }
        }

        await archive.finalize();
    } catch (e) {
        console.error(e);
        if (!res.headersSent) res.status(500).send('Error generating ZIP');
    }
});

// 5. EDITOR TRIAL LOGIC (FREE USER LIMITS)
app.get('/api/trial/status', async (req, res) => {
    const { username } = req.query;
    let users = await fetchFile('database/users.json') || [];
    const userIndex = users.findIndex(u => u.username === username);

    if (userIndex === -1) return res.json({ success: false });

    const user = users[userIndex];
    if (user.plan !== 'free') return res.json({ success: true, unlimited: true });

    // Initialize or Reset Trial if needed
    const now = Date.now();
    const lastReset = user.trialLastReset || 0;
    const oneDay = 24 * 60 * 60 * 1000;

    if (now - lastReset > oneDay) {
        // Reset Logic
        users[userIndex].trialLastReset = now;
        users[userIndex].trialSecondsRemaining = 3600; // 1 Hour

        users[userIndex].trialSecondsRemaining = 3600; // 1 Hour
        await saveFile('database/users.json', users, `Reset Trial ${username}`);

        return res.json({ success: true, remaining: 3600, reset: true });
    }

    res.json({ success: true, remaining: user.trialSecondsRemaining || 0 });
});

app.post('/api/trial/heartbeat', async (req, res) => {
    const { username, deductedSeconds } = req.body;
    let users = await fetchFile('database/users.json') || [];
    const userIndex = users.findIndex(u => u.username === username);

    if (userIndex !== -1 && users[userIndex].plan === 'free') {
        const current = users[userIndex].trialSecondsRemaining || 0;
        const newVal = Math.max(0, current - (deductedSeconds || 10)); // Default 10s heartbeat

        users[userIndex].trialSecondsRemaining = newVal;

        users[userIndex].trialSecondsRemaining = newVal;
        await saveFile('database/users.json', users, `Heartbeat ${username}`);

        res.json({ success: true, remaining: newVal });
    } else {
        res.json({ success: true });
    }
});

// --- OTHER ROUTES (Payment Methods, Users List, Pending Payments) ---

app.get('/api/payment-methods', async (req, res) => {
    const m = await fetchFile('database/settings.json');
    res.json({ success: true, methods: m || [] });
});

app.get('/api/admin/users', async (req, res) => res.json({ success: true, users: await fetchFile('database/users.json') || [] }));

app.post('/api/admin/add-payment', async (req, res) => {
    let methods = await fetchFile('database/settings.json') || [];
    methods.push({ id: Date.now(), provider: req.body.provider, number: req.body.number });
    await saveFile('database/settings.json', methods, 'Add Pay');
    res.json({ success: true, methods });
});

app.post('/api/admin/delete-payment', async (req, res) => {
    let methods = await fetchFile('database/settings.json') || [];
    methods = methods.filter(m => m.id !== req.body.id);
    await saveFile('database/settings.json', methods, 'Del Pay');
    res.json({ success: true, methods });
});

// Submit Payment
app.post('/api/submit-payment', async (req, res) => {
    const { username, method, number, trxId, amount, plan } = req.body;
    let payments = await fetchFile('database/payments.json') || [];

    if (payments.find(p => p.username === username)) {
        return res.json({ success: false, message: 'You already have a pending request.' });
    }

    payments.push({
        id: Date.now(),
        username, method, number, trxId, amount, plan,
        date: new Date().toISOString()
    });
    await saveFile('database/payments.json', payments, 'New Payment Req');

    res.json({ success: true, message: 'Payment submitted for verification!' });
});

app.get('/api/admin/pending-payments', async (req, res) => {
    const p = await fetchFile('database/payments.json') || [];
    res.json({ success: true, payments: p });
});

app.listen(PORT, async () => {
    console.log(`Engine running on ${PORT}`);

    // 🔥 SYNC CUSTOM 404 PAGE TO GITHUB ROOT 🔥
    try {
        const fs = require('fs');
        const path = require('path');
        const local404Path = path.join(__dirname, '../public/404.html');

        if (fs.existsSync(local404Path)) {
            console.log('[SYSTEM] Checking 404.html deployment...');
            const content = fs.readFileSync(local404Path, 'utf-8');

            // Always update to ensure latest version
            await saveFile('404.html', content, 'Deploy Custom 404');
            console.log('[SYSTEM] Custom 404.html synced!');
        }
    } catch (e) {
        console.error('[SYSTEM] Failed to sync 404.html:', e.message);
    }
});