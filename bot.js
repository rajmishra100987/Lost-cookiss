// ==================== ULTIMATE FB BOT - SIMPLE & STABLE ====================
// SIRF EK BAAR LOGIN | NO HEALTH CHECK | NO getUserID
// JO TUMHARI SCRIPT THI, WAHI HAI (Sirf 24H refresh hata diya)

const fs = require('fs');
const path = require('path');
const express = require('express');
const wiegine = require('fca-mafiya');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 4000;

// ========== DATA ==========
let taskConfig = null;
let taskInterval = null;
let messageSendCount = 0;
let lastSuccessTime = Date.now();
let currentApi = null;

// ========== SESSION MANAGER - NO HEALTH CHECK ==========
class SessionManager {
    
    constructor() {
        this.api = null;
        this.cookie = null;
        this.failCount = 0;
    }

    // SIRF EK BAAR LOGIN
    async initialLogin(cookie) {
        console.log(`\n🔐 INITIAL LOGIN...`);
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.log(`⏰ Login timeout`);
                resolve(null);
            }, 30000);
            
            wiegine.login(cookie, { 
                logLevel: "silent", 
                forceLogin: true,
                selfListen: false
            }, (err, api) => {
                clearTimeout(timeout);
                
                if (err) {
                    console.log(`❌ Login failed:`, err.error || err.message);
                    resolve(null);
                    return;
                }
                
                if (!api) {
                    console.log(`❌ No API returned`);
                    resolve(null);
                    return;
                }
                
                this.api = api;
                this.cookie = cookie;
                console.log(`✅ Login successful!`);
                resolve(api);
            });
        });
    }

    getApi() {
        return this.api;
    }

    getStats() {
        return {
            loggedIn: !!this.api,
            failCount: this.failCount
        };
    }
}

const sessionManager = new SessionManager();

// ========== 15-DIGIT CHAT SUPPORT ==========
function is15DigitChat(threadID) {
    return /^\d{15}$/.test(String(threadID));
}

function sendTo15DigitChat(api, message, threadID, callback, retryAttempt = 0) {
    const max15DigitRetries = 5;
    
    try {
        api.sendMessage({ body: message }, threadID, (err) => {
            if (err) {
                const numericThreadID = parseInt(threadID);
                api.sendMessage(message, numericThreadID, (err2) => {
                    if (err2) {
                        if (retryAttempt < max15DigitRetries) {
                            setTimeout(() => {
                                sendTo15DigitChat(api, message, threadID, callback, retryAttempt + 1);
                            }, 3000);
                        } else {
                            callback(err2);
                        }
                    } else {
                        callback(null);
                    }
                });
            } else {
                callback(null);
            }
        });
    } catch (error) {
        if (retryAttempt < max15DigitRetries) {
            setTimeout(() => {
                sendTo15DigitChat(api, message, threadID, callback, retryAttempt + 1);
            }, 3000);
        } else {
            callback(error);
        }
    }
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

// ========== MESSAGE SENDER ==========
class MessageSender {
    
    async sendMessage(finalMessage, threadID) {
        const api = sessionManager.getApi();
        if (!api) {
            console.log(`❌ No API available`);
            return false;
        }
        
        return new Promise((resolve) => {
            const is15Digit = is15DigitChat(threadID);
            let attempts = 0;
            const maxAttempts = 2;
            
            const trySend = () => {
                const timeout = setTimeout(() => {
                    if (attempts < maxAttempts) {
                        attempts++;
                        console.log(`🔄 Retry ${attempts}/${maxAttempts}`);
                        trySend();
                    } else {
                        resolve(false);
                    }
                }, 20000);
                
                const callback = (err) => {
                    clearTimeout(timeout);
                    if (!err) {
                        messageSendCount++;
                        lastSuccessTime = Date.now();
                        resolve(true);
                    } else {
                        if (attempts < maxAttempts) {
                            attempts++;
                            setTimeout(trySend, 3000);
                        } else {
                            resolve(false);
                        }
                    }
                };
                
                if (is15Digit) {
                    sendTo15DigitChat(api, finalMessage, threadID, callback);
                } else {
                    api.sendMessage(finalMessage, threadID, callback);
                }
            };
            
            trySend();
        });
    }
}

const messageSender = new MessageSender();

// ========== TASK RUNNER ==========
async function startTask() {
    const fileData = readAllFiles();
    if (!fileData) {
        console.log('❌ Failed to read files');
        return false;
    }
    
    const { cookies, delay, convoId, hatersname, lastname, messages } = fileData;
    
    // Pehli valid cookie se login
    let selectedCookie = null;
    for (const cookie of cookies) {
        console.log(`\n🔐 Trying login...`);
        const api = await sessionManager.initialLogin(cookie);
        if (api) {
            selectedCookie = cookie;
            console.log(`✅ Login successful!`);
            break;
        }
    }
    
    if (!selectedCookie) {
        console.log('❌ No valid cookie found');
        return false;
    }
    
    taskConfig = {
        convoId,
        messages,
        hatersname,
        lastname,
        delay,
        currentMessageIndex: 0,
        loopCount: 0,
        totalSent: 0,
        running: true
    };
    
    if (taskInterval) {
        clearInterval(taskInterval);
    }
    
    taskInterval = setInterval(async () => {
        await sendOneMessage();
    }, delay * 1000);
    
    console.log(`\n🚀 TASK STARTED!`);
    console.log(`⏱️ Delay: ${delay}s`);
    console.log(`💬 Messages: ${taskConfig.messages.length}`);
    console.log(`👥 Names: ${taskConfig.hatersname.length} + ${taskConfig.lastname.length}`);
    
    return true;
}

async function sendOneMessage() {
    if (!taskConfig || !taskConfig.running) return;
    
    try {
        const messages = taskConfig.messages;
        if (messages.length === 0) return;
        
        const message = messages[taskConfig.currentMessageIndex];
        const hatersName = taskConfig.hatersname[Math.floor(Math.random() * taskConfig.hatersname.length)] || '';
        const lastName = taskConfig.lastname[Math.floor(Math.random() * taskConfig.lastname.length)] || '';
        const finalMessage = `${hatersName} ${message} ${lastName}`.trim();
        
        const success = await messageSender.sendMessage(finalMessage, taskConfig.convoId);
        
        if (success) {
            taskConfig.totalSent++;
            taskConfig.currentMessageIndex = (taskConfig.currentMessageIndex + 1) % messages.length;
            
            if (taskConfig.currentMessageIndex === 0) {
                taskConfig.loopCount++;
                console.log(`🔄 Loop #${taskConfig.loopCount} completed (${taskConfig.totalSent} total messages)`);
            }
            
            console.log(`✅ [${taskConfig.totalSent}] Message sent`);
        } else {
            console.log(`❌ Message failed`);
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

function readConvo() {
    const convoPath = path.join(__dirname, 'convo.txt');
    if (!fs.existsSync(convoPath)) return null;
    return fs.readFileSync(convoPath, 'utf8').trim();
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
    const convoId = readConvo();
    const hatersname = readHatersName();
    const lastname = readLastname();
    const messages = readMessages();
    
    if (!cookies) { console.log('❌ cookies.txt missing'); return null; }
    if (!delay) { console.log('❌ time.txt missing'); return null; }
    if (!convoId) { console.log('❌ convo.txt missing'); return null; }
    if (!hatersname || hatersname.length === 0) { console.log('❌ hatersname.txt missing'); return null; }
    if (!lastname || lastname.length === 0) { console.log('❌ lastname.txt missing'); return null; }
    if (!messages || messages.length === 0) { console.log('❌ File.txt missing'); return null; }
    
    return { cookies, delay, convoId, hatersname, lastname, messages };
}

function watchFiles() {
    const files = ['cookies.txt', 'time.txt', 'convo.txt', 'hatersname.txt', 'lastname.txt', 'File.txt'];
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
    taskConfig = null;
    await startTask();
}

// ========== EXPRESS SERVER ==========
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        messagesSent: taskConfig?.totalSent || 0,
        loops: taskConfig?.loopCount || 0
    });
});

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>FB BOT</title>
                <meta http-equiv="refresh" content="30">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body {
                        font-family: 'Courier New', monospace;
                        background: linear-gradient(135deg, #0a0e27 0%, #1a1a3e 100%);
                        color: #00ff88;
                        padding: 20px;
                        text-align: center;
                    }
                    .container {
                        max-width: 500px;
                        margin: 0 auto;
                        background: rgba(0,0,0,0.7);
                        border-radius: 20px;
                        padding: 20px;
                        border: 1px solid #00ff88;
                    }
                    h1 { color: #00ff88; text-shadow: 0 0 10px #00ff88; }
                    .status { font-size: 24px; margin: 20px 0; }
                    .online { color: #00ff88; animation: pulse 1s infinite; }
                    @keyframes pulse {
                        0% { opacity: 1; }
                        50% { opacity: 0.5; }
                        100% { opacity: 1; }
                    }
                    .stats {
                        text-align: left;
                        background: #000;
                        padding: 15px;
                        border-radius: 10px;
                        margin: 15px 0;
                    }
                    .stat-item { margin: 8px 0; font-family: monospace; }
                    .green { color: #00ff88; }
                    .footer {
                        margin-top: 20px;
                        font-size: 11px;
                        color: #666;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🤖 FB BOT</h1>
                    <h2>SIMPLE & STABLE</h2>
                    
                    <div class="status">
                        <span class="online">● ONLINE</span>
                    </div>
                    
                    <div class="stats">
                        <div class="stat-item">📊 STATISTICS</div>
                        <div class="stat-item">├─ Messages Sent: ${taskConfig?.totalSent || 0}</div>
                        <div class="stat-item">└─ Loops: ${taskConfig?.loopCount || 0}</div>
                    </div>
                    
                    <div class="stats">
                        <div class="stat-item">⏱️ SYSTEM</div>
                        <div class="stat-item">├─ Uptime: ${formatUptime(Math.floor(process.uptime()))}</div>
                        <div class="stat-item">└─ Status: Running</div>
                    </div>
                    
                    <div class="footer">
                        SINGLE LOGIN | NO EXTRA API CALLS | STABLE
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
    ws.send(JSON.stringify({ type: 'connected', message: 'Bot is alive' }));
});

// ========== START ==========
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔥 ULTIMATE FB BOT - SIMPLE & STABLE`);
    console.log(`${'='.repeat(60)}`);
    console.log(`🌐 Web UI: http://localhost:${PORT}`);
    console.log(`💚 Health: http://localhost:${PORT}/health`);
    console.log(`${'='.repeat(60)}`);
    console.log(`\n✅ FEATURES:`);
    console.log(`   ✅ SINGLE LOGIN (Ek baar)`);
    console.log(`   ✅ NO extra API calls`);
    console.log(`   ✅ NO getUserID health check`);
    console.log(`   ✅ NO session refresh (cookie valid rahegi)`);
    console.log(`   ✅ Simple & Stable`);
    console.log(`${'='.repeat(60)}\n`);
    
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
