// ==================== POST COMMENT BOT - NEOKEX-FCA ====================

const fs = require('fs');
const path = require('path');
const express = require('express');
const { login } = require('neokex-fca'); // ← CHANGED
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 4000;

// ========== DATA ==========
let taskConfig = null;
let taskInterval = null;
let messageSendCount = 0;
let lastSuccessTime = Date.now();

// ========== SESSION MANAGER WITH 24H REFRESH ==========
class SessionManager {
    
    constructor() {
        this.sessions = [];
        this.currentIndex = 0;
        this.lastRefreshTime = Date.now();
        this.start24HourRefresh();
        this.startHealthCheck();
    }

    start24HourRefresh() {
        setInterval(async () => {
            console.log('\n🕐 24H REFRESH CYCLE STARTING...');
            await this.refreshAllSessions();
            console.log('✅ 24H REFRESH COMPLETE\n');
        }, 24 * 60 * 60 * 1000);
    }

    startHealthCheck() {
        setInterval(() => {
            let healthyCount = 0;
            for (const session of this.sessions) {
                if (session.api && session.failCount < 5) {
                    healthyCount++;
                }
            }
            console.log(`💚 Health: ${healthyCount}/${this.sessions.length} sessions OK`);
        }, 60 * 60 * 1000);
    }

    async refreshAllSessions() {
        if (this.sessions.length === 0) return;
        
        console.log(`🔄 Refreshing ${this.sessions.length} sessions...`);
        
        for (let i = 0; i < this.sessions.length; i++) {
            const session = this.sessions[i];
            console.log(`🔄 Refreshing session ${i + 1}/${this.sessions.length}...`);
            
            const newApi = await this.loginWithCookie(session.cookie, i);
            if (newApi) {
                if (session.api) {
                    try { session.api.logout(); } catch(e) {}
                }
                session.api = newApi;
                session.failCount = 0;
                session.healthy = true;
                console.log(`✅ Session ${i + 1} refreshed`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        this.lastRefreshTime = Date.now();
    }

    async createSessions(cookiesArray) {
        if (!cookiesArray || cookiesArray.length === 0) {
            console.log('❌ No cookies provided');
            return false;
        }
        
        console.log(`\n📱 Creating ${cookiesArray.length} sessions...`);
        
        for (let i = 0; i < cookiesArray.length; i++) {
            console.log(`\n[${i + 1}/${cookiesArray.length}] Processing cookie...`);
            
            const api = await this.loginWithCookie(cookiesArray[i], i);
            if (api) {
                this.sessions.push({
                    index: i,
                    api: api,
                    cookie: cookiesArray[i],
                    healthy: true,
                    failCount: 0,
                    createdAt: Date.now()
                });
                console.log(`✅ Session ${i + 1} CREATED!`);
            } else {
                console.log(`❌ Session ${i + 1} FAILED`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        console.log(`\n📊 SUMMARY: ${this.sessions.length}/${cookiesArray.length} sessions created`);
        return this.sessions.length > 0;
    }

    loginWithCookie(cookie, index) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.log(`⏰ Session ${index + 1} timeout (30s)`);
                resolve(null);
            }, 30000);
            
            // neokex-fca login with cookie
            login({ cookie: cookie }, { 
                logLevel: "silent", 
                forceLogin: true,
                listenEvents: false,
                selfListen: false
            }, (err, api) => {
                clearTimeout(timeout);
                
                if (err) {
                    console.log(`❌ Login error:`, err.error || err.message);
                    resolve(null);
                    return;
                }
                
                if (!api) {
                    console.log(`❌ No API returned`);
                    resolve(null);
                    return;
                }
                
                console.log(`✅ Session ${index + 1} API ready`);
                resolve(api);
            });
        });
    }

    getNextSession() {
        if (this.sessions.length === 0) {
            console.log('❌ No sessions available');
            return null;
        }
        
        for (let i = 0; i < this.sessions.length; i++) {
            const idx = (this.currentIndex + i) % this.sessions.length;
            const session = this.sessions[idx];
            
            if (session.api && session.failCount < 5) {
                this.currentIndex = (idx + 1) % this.sessions.length;
                console.log(`📤 Using session ${idx + 1}/${this.sessions.length}`);
                return session.api;
            }
        }
        
        return this.sessions[0]?.api || null;
    }

    markSessionFailed(api) {
        const session = this.sessions.find(s => s.api === api);
        if (session) {
            session.failCount++;
            session.healthy = false;
            console.log(`⚠️ Session ${session.index + 1} failed (${session.failCount}/5)`);
        }
    }

    getStats() {
        return {
            total: this.sessions.length,
            healthy: this.sessions.filter(s => s.failCount < 5).length,
            failed: this.sessions.filter(s => s.failCount >= 5).length,
            nextRefresh: this.lastRefreshTime + (24 * 60 * 60 * 1000)
        };
    }
}

const sessionManager = new SessionManager();

// ========== POST COMMENT FUNCTION ==========
async function postComment(api, message, postId) {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 2;
        
        const tryPost = () => {
            const timeout = setTimeout(() => {
                if (attempts < maxAttempts) {
                    attempts++;
                    console.log(`🔄 Retry ${attempts}/${maxAttempts}`);
                    tryPost();
                } else {
                    resolve(false);
                }
            }, 20000);
            
            // POST COMMENT - same as sendMessage but with postId
            api.sendMessage(message, postId, (err, data) => {
                clearTimeout(timeout);
                
                if (!err) {
                    console.log(`✅ Comment posted!`);
                    resolve(true);
                } else {
                    console.log(`❌ Comment error:`, err.error || err);
                    if (attempts < maxAttempts) {
                        attempts++;
                        setTimeout(tryPost, 3000);
                    } else {
                        resolve(false);
                    }
                }
            });
        };
        
        tryPost();
    });
}

// ========== TASK RUNNER ==========
async function startTask() {
    const fileData = readAllFiles();
    if (!fileData) {
        console.log('❌ Failed to read files');
        return false;
    }
    
    const { cookies, delay, postId, hatersname, lastname, messages } = fileData;
    
    console.log(`\n🔐 Creating sessions from ${cookies.length} cookies...`);
    const sessionsCreated = await sessionManager.createSessions(cookies);
    
    if (!sessionsCreated) {
        console.log('❌ No valid sessions created');
        return false;
    }
    
    taskConfig = {
        postId,
        messages,
        hatersname,
        lastname,
        delay,
        currentMessageIndex: 0,
        loopCount: 0,
        totalSent: 0
    };
    
    if (taskInterval) {
        clearInterval(taskInterval);
    }
    
    taskInterval = setInterval(async () => {
        await postOneComment();
    }, delay * 1000);
    
    console.log(`\n🚀 POST COMMENT TASK STARTED!`);
    console.log(`📊 Sessions: ${sessionManager.getStats().total}`);
    console.log(`📝 Post ID: ${postId}`);
    console.log(`⏱️ Delay: ${delay}s`);
    console.log(`💬 Messages: ${taskConfig.messages.length}`);
    console.log(`👥 Names: ${taskConfig.hatersname.length} + ${taskConfig.lastname.length}`);
    
    return true;
}

async function postOneComment() {
    if (!taskConfig) return;
    
    try {
        const api = sessionManager.getNextSession();
        if (!api) {
            console.log(`❌ No session available`);
            return;
        }
        
        const messages = taskConfig.messages;
        if (messages.length === 0) return;
        
        const message = messages[taskConfig.currentMessageIndex];
        const hatersName = taskConfig.hatersname[Math.floor(Math.random() * taskConfig.hatersname.length)] || '';
        const lastName = taskConfig.lastname[Math.floor(Math.random() * taskConfig.lastname.length)] || '';
        const finalMessage = `${hatersName} ${message} ${lastName}`.trim();
        
        const success = await postComment(api, finalMessage, taskConfig.postId);
        
        if (success) {
            taskConfig.totalSent++;
            taskConfig.currentMessageIndex = (taskConfig.currentMessageIndex + 1) % messages.length;
            
            if (taskConfig.currentMessageIndex === 0) {
                taskConfig.loopCount++;
                console.log(`🔄 Loop #${taskConfig.loopCount} completed (${taskConfig.totalSent} total comments)`);
            }
            
            console.log(`✅ [${taskConfig.totalSent}] Comment posted`);
            lastSuccessTime = Date.now();
            messageSendCount++;
        } else {
            console.log(`❌ Comment failed`);
            sessionManager.markSessionFailed(api);
        }
        
    } catch (error) {
        console.log(`❌ Error:`, error.message);
    }
}

// ========== FILE READING ==========
function readCookies() {
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    if (!fs.existsSync(cookiesPath)) return null;
    const content = fs.readFileSync(cookiesPath, 'utf8');
    const cookies = content.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('//') && line.includes('c_user'));
    if (cookies.length === 0) return null;
    console.log(`📁 Found ${cookies.length} cookies`);
    return cookies;
}

function readTime() {
    const timePath = path.join(__dirname, 'time.txt');
    if (!fs.existsSync(timePath)) return null;
    const delay = parseInt(fs.readFileSync(timePath, 'utf8').trim());
    if (isNaN(delay) || delay <= 0) return null;
    return delay;
}

function readPostId() {
    const postPath = path.join(__dirname, 'post.txt'); // ← NEW FILE
    if (!fs.existsSync(postPath)) {
        // Try convo.txt as fallback
        const convoPath = path.join(__dirname, 'convo.txt');
        if (fs.existsSync(convoPath)) {
            return fs.readFileSync(convoPath, 'utf8').trim();
        }
        return null;
    }
    return fs.readFileSync(postPath, 'utf8').trim();
}

function readHatersName() {
    const hatersPath = path.join(__dirname, 'hatersname.txt');
    if (!fs.existsSync(hatersPath)) return null;
    return fs.readFileSync(hatersPath, 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

function readLastname() {
    const lastnamePath = path.join(__dirname, 'lastname.txt');
    if (!fs.existsSync(lastnamePath)) return null;
    return fs.readFileSync(lastnamePath, 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

function readMessages() {
    const filePath = path.join(__dirname, 'File.txt');
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

function readAllFiles() {
    const cookies = readCookies();
    const delay = readTime();
    const postId = readPostId();
    const hatersname = readHatersName();
    const lastname = readLastname();
    const messages = readMessages();
    
    if (!cookies) { console.log('❌ cookies.txt missing'); return null; }
    if (!delay) { console.log('❌ time.txt missing'); return null; }
    if (!postId) { console.log('❌ post.txt or convo.txt missing'); return null; }
    if (!hatersname || hatersname.length === 0) { console.log('❌ hatersname.txt missing'); return null; }
    if (!lastname || lastname.length === 0) { console.log('❌ lastname.txt missing'); return null; }
    if (!messages || messages.length === 0) { console.log('❌ File.txt missing'); return null; }
    
    return { cookies, delay, postId, hatersname, lastname, messages };
}

function watchFiles() {
    const files = ['cookies.txt', 'time.txt', 'post.txt', 'convo.txt', 'hatersname.txt', 'lastname.txt', 'File.txt'];
    files.forEach(file => {
        const filePath = path.join(__dirname, file);
        if (fs.existsSync(filePath)) {
            fs.watch(filePath, () => {
                console.log(`\n📝 ${file} changed! Restarting...`);
                setTimeout(() => restartTask(), 2000);
            });
        }
    });
    console.log('👁️ Watching for file changes...');
}

async function restartTask() {
    console.log('🔄 Restarting task...');
    if (taskInterval) {
        clearInterval(taskInterval);
        taskInterval = null;
    }
    sessionManager.sessions = [];
    sessionManager.currentIndex = 0;
    await startTask();
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    return parts.join(' ');
}

// ========== EXPRESS SERVER ==========
app.use(express.json());

app.get('/health', (req, res) => {
    const stats = sessionManager.getStats();
    res.json({
        status: 'ok',
        type: 'post-comment',
        uptime: process.uptime(),
        sessions: stats,
        commentsSent: taskConfig?.totalSent || 0,
        loops: taskConfig?.loopCount || 0
    });
});

app.get('/', (req, res) => {
    const stats = sessionManager.getStats();
    res.send(`
        <html>
            <head>
                <title>FB POST COMMENT BOT</title>
                <meta http-equiv="refresh" content="30">
                <style>
                    body { font-family: Arial; text-align: center; padding: 20px; background: #0a0e27; color: white; }
                    .box { background: #1a1a3e; border-radius: 15px; padding: 20px; max-width: 500px; margin: 0 auto; }
                    .green { color: #00ff88; }
                    .stats { text-align: left; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="box">
                    <h1>💬 FB POST COMMENT BOT <span class="green">● ONLINE</span></h1>
                    <div class="stats">
                        <p>📊 Sessions: ${stats.total} (${stats.healthy} healthy)</p>
                        <p>💬 Comments Sent: ${taskConfig?.totalSent || 0}</p>
                        <p>🔄 Loops: ${taskConfig?.loopCount || 0}</p>
                        <p>⏱️ Uptime: ${formatUptime(Math.floor(process.uptime()))}</p>
                    </div>
                </div>
            </body>
        </html>
    `);
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('🔌 WebSocket connected');
    ws.send(JSON.stringify({ type: 'connected', message: 'Post comment bot is alive' }));
});

// ========== INSTALL NEOKEX-FCA FIRST ==========
console.log(`
╔══════════════════════════════════════════════════════════╗
║  ⚠️  IMPORTANT: Install neokex-fca first!              ║
║                                                          ║
║  npm uninstall fca-mafiya                               ║
║  npm install neokex-fca                                 ║
║                                                          ║
║  Then create post.txt with your post ID:                ║
║  61581599190276_122134296987053306                      ║
╚══════════════════════════════════════════════════════════╝
`);

// ========== START ==========
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`💬 POST COMMENT BOT`);
    console.log(`✅ Library: neokex-fca (supports post comments)`);
    console.log(`📝 Post ID format: {userId}_{postId}`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`${'='.repeat(50)}\n`);
    
    watchFiles();
    
    setTimeout(async () => {
        await startTask();
    }, 2000);
});

process.on('uncaughtException', (error) => {
    console.log('🛡️ Exception:', error.message);
});

process.on('unhandledRejection', (reason) => {
    console.log('🛡️ Rejection:', reason);
});
