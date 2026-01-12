const axios = require('axios');
require('dotenv').config();

const GITHUB_API = "https://api.github.com";
const STORAGE_REPO = process.env.STORAGE_REPO || 'Shamim-Cloud-Storage';
const USERNAME = process.env.GITHUB_USERNAME;
const TOKEN = process.env.GITHUB_TOKEN;
const REPO_FULL = `${USERNAME}/${STORAGE_REPO}`;

const getHeaders = () => ({
    'Authorization': `Bearer ${TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
});

// --- IN-MEMORY CACHE ---
let usersCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 60 * 1000; // 1 minute

// --- CONNECTION CHECK ---
(async () => {
    try {
        await axios.get(`${GITHUB_API}/repos/${REPO_FULL}`, { headers: getHeaders() });
        console.log(`[STORAGE] Connected to ${REPO_FULL} successfully.`);
    } catch (e) {
        console.error(`[STORAGE] CRITICAL ERROR: Could not connect to ${REPO_FULL}.`);
        console.error(`[STORAGE] Details: ${e.response?.status} - ${e.response?.statusText}`);
        console.error(`[STORAGE] Check your .env file (GITHUB_USERNAME, STORAGE_REPO, GITHUB_TOKEN).`);
    }
})();

async function getFile(path) {
    // Check Cache for users.json
    if (path === 'database/users.json' && usersCache && (Date.now() - lastCacheTime < CACHE_DURATION)) {
        console.log('[CACHE] Served users.json from cache');
        return usersCache;
    }

    try {
        const url = `${GITHUB_API}/repos/${REPO_FULL}/contents/${path}`;
        const res = await axios.get(url, { headers: getHeaders() });

        if (Array.isArray(res.data)) return res.data; // Directory listing

        const content = Buffer.from(res.data.content, 'base64').toString('utf-8');

        try {
            const json = JSON.parse(content);
            // Update Cache
            if (path === 'database/users.json') {
                usersCache = json;
                lastCacheTime = Date.now();
            }
            return json;
        } catch (err) {
            return content; // Return raw string if not JSON
        }

    } catch (e) {
        if (e.response && e.response.status === 404) return null;
        console.error(`[STORAGE] Error fetching ${path}:`, e.message);
        return null;
    }
}

async function updateFile(path, content, message) {
    try {
        // Get SHA if exists
        let sha = null;
        try {
            const res = await axios.get(`${GITHUB_API}/repos/${REPO_FULL}/contents/${path}`, { headers: getHeaders() });
            sha = res.data.sha;
        } catch (e) { /* File doesn't exist yet */ }

        const contentBase64 = Buffer.from(typeof content === 'string' ? content : JSON.stringify(content, null, 2)).toString('base64');

        await axios.put(`${GITHUB_API}/repos/${REPO_FULL}/contents/${path}`, {
            message: message,
            content: contentBase64,
            sha: sha
        }, { headers: getHeaders() });

        // Invalidate Cache if writing users
        if (path === 'database/users.json') {
            usersCache = null;
        }

        return true;
    } catch (e) {
        console.error(`[STORAGE] Error saving ${path}:`, e.message);
        return false;
    }
}

async function uploadProjectFiles(username, projectName, file) {
    const basePath = `hosting/${projectName}`;
    const fileName = file.originalname || 'index.html';
    const filePath = `${basePath}/${fileName}`;

    // Just strictly saving the file content
    try {
        let contentBase64 = file.buffer.toString('base64');
        let sha = null;
        try {
            const res = await axios.get(`${GITHUB_API}/repos/${REPO_FULL}/contents/${filePath}`, { headers: getHeaders() });
            sha = res.data.sha;
        } catch (e) { }

        await axios.put(`${GITHUB_API}/repos/${REPO_FULL}/contents/${filePath}`, {
            message: `Deploy ${projectName}`,
            content: contentBase64,
            sha: sha
        }, { headers: getHeaders() });

        return true;
    } catch (e) {
        console.error(`[STORAGE] Upload failed:`, e.message);
        return false;
    }
}

async function deleteFile(path, message) {
    try {
        let sha = null;
        try {
            const res = await axios.get(`${GITHUB_API}/repos/${REPO_FULL}/contents/${path}`, { headers: getHeaders() });
            sha = res.data.sha;
        } catch (e) { return true; } // Already gone

        await axios.delete(`${GITHUB_API}/repos/${REPO_FULL}/contents/${path}`, {
            headers: getHeaders(),
            data: { message: message, sha: sha }
        });
        return true;
    } catch (e) {
        console.error(`[STORAGE] Delete failed:`, e.message);
        return false;
    }
}

module.exports = { getFile, updateFile, uploadProjectFiles, deleteFile, STORAGE_REPO, USERNAME };
