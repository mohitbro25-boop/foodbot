const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const CHAT_ID_PATH = path.join(__dirname, 'target_chat.json');
const LOG_FILE_PATH = path.join(__dirname, 'bot_log.txt');

function log(msg) {
    const timestamp = new Date().toLocaleString();
    const formattedMsg = `[${timestamp}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE_PATH, formattedMsg, 'utf8');
    console.log(msg);
}

log('Starting bot initialization...');

// Store latest QR code for HTTP serving
let latestQR = null;

// HTTP server: serves QR code image at /qr, health check at /
const port = process.env.PORT || 8080;
const server = http.createServer(async (req, res) => {
    if (req.url === '/qr' && latestQR) {
        try {
            const imgData = await QRCode.toDataURL(latestQR, { width: 400, margin: 2 });
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html><html><head><title>WhatsApp QR Code</title><meta http-equiv="refresh" content="10"></head><body style="background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;color:white"><h2>Scan with WhatsApp → Linked Devices</h2><img src="${imgData}" style="border-radius:12px"/><p style="opacity:0.5">Page auto-refreshes every 10 seconds</p></body></html>`);
        } catch (e) {
            res.writeHead(500); res.end('QR generation error');
        }
    } else if (req.url === '/qr') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body style="background:#111;color:white;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif"><h2>Waiting for QR code... Refresh in a few seconds.</h2></body></html>');
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('WhatsApp Food Bot is running! Visit /qr to scan the QR code.');
    }
});
server.listen(port, () => {
    log(`HTTP server listening on port ${port} — visit /qr to scan WhatsApp QR`);
});

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let targetChatId = null;
if (fs.existsSync(CHAT_ID_PATH)) {
    try {
        const data = JSON.parse(fs.readFileSync(CHAT_ID_PATH, 'utf8'));
        targetChatId = data.chatId;
        log(`Loaded saved chat ID: ${targetChatId}`);
    } catch (e) {
        log(`Error loading target_chat.json: ${e.message}`);
    }
}

client.on('qr', (qr) => {
    latestQR = qr;
    log('New QR Code generated. Open your Railway public URL + /qr to scan it as an image.');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    log('WhatsApp Daily Food Submitter is online and ready!');
    
    if (targetChatId) {
        client.sendMessage(targetChatId, '🤖 Bot successfully restarted and is active. I will submit the food form daily at 12:00 PM (Monday-Saturday).')
            .catch(err => log(`Error sending startup message: ${err.message}`));
    }
    
    cron.schedule('0 12 * * 1-6', () => {
        log('Daily cron triggered at 12:00 PM.');
        runFoodScript((result) => {
            if (targetChatId) {
                client.sendMessage(targetChatId, `🔔 *Daily Auto-Submission Report*\n\n${result}`)
                    .catch(err => log(`Error sending cron report: ${err.message}`));
            } else {
                log('Daily submission ran, but no target chat ID is registered.');
            }
        });
    });
});

client.on('message_create', async (msg) => {
    try {
        const text = msg.body ? msg.body.trim().toLowerCase() : '';
        
        if (text === '!order' || text === '!food' || text === 'order food') {
            log(`Trigger message received from: ${msg.from} (Body: ${msg.body})`);
            targetChatId = msg.from;
            fs.writeFileSync(CHAT_ID_PATH, JSON.stringify({ chatId: targetChatId }, null, 2));
            
            await client.sendMessage(msg.from, '⏳ Commencing manual food order form submission...');
            
            runFoodScript(async (result) => {
                await client.sendMessage(msg.from, `✅ *Manual Submission Report*\n\n${result}`);
                log(`Report sent back to: ${msg.from}`);
            });
        } else if (text === '!status' || text === 'status') {
            log(`Status request from: ${msg.from}`);
            await client.sendMessage(msg.from, `🤖 Bot Status: ACTIVE\n⏰ Schedule: 12:00 PM (Mon-Sat)\n📁 target_chat: ${targetChatId ? 'Registered' : 'Not Registered'}`);
        }
    } catch (e) {
        log(`Error in message_create event handler: ${e.message}`);
    }
});

function runFoodScript(callback) {
    const scriptPath = path.join(__dirname, 'submit_food_browser.js');
    
    log(`Executing browser submission script: ${scriptPath}`);
    exec(`node "${scriptPath}"`, (error, stdout, stderr) => {
        let resultMsg = '';
        if (error) {
            resultMsg = `❌ Error: ${error.message}\n${stderr}`;
            log(`Script execution error: ${error.message}\n${stderr}`);
        } else if (stderr && !stdout) {
            resultMsg = `⚠️ Stderr: ${stderr}`;
            log(`Script stderr: ${stderr}`);
        } else {
            resultMsg = stdout.trim();
            log(`Script stdout: ${resultMsg}`);
        }
        callback(resultMsg);
    });
}

client.initialize().catch(err => log(`Client initialization error: ${err.message}`));
