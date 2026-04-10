const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { exec } = require('child_process');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json());

// Đường dẫn tới thư mục chứa manager.sh
const BASE_PATH = '/home/pdl1host/webs';

// API thực thi lệnh an toàn
app.post('/api/execute', (req, res) => {
    const { action, folder, type, domain, port, endTime } = req.body;

    const folderSafe = folder.replace(/[^a-zA-Z0-9_-]/g, '');
    let command = '';

    if (action === 'deploy') {
        const val = type === 'preview' ? port : domain;
        command = `cd ${BASE_PATH} && ./manager.sh deploy ${folderSafe} ${type} ${val}`;
    } else if (action === 'offair') {
        command = `cd ${BASE_PATH} && ./manager.sh offair ${folderSafe} ${domain} ${endTime || 'undefined'}`;
    } else if (action === 'update') {
        command = `cd ${BASE_PATH} && ./manager.sh update ${folderSafe}`;
    } else {
        return res.status(400).json({ error: 'Action không hợp lệ' });
    }

    console.log(`Executing: ${command}`);

    // Thực thi lệnh shell
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error: ${error.message}`);
            return res.status(500).json({ 
                error: error.message, 
                stderr: stderr,
                stdout: stdout 
            });
        }
        res.json({ 
            message: 'Thành công', 
            stdout: stdout,
            stderr: stderr
        });
    });
});

// API kiểm tra trạng thái DNS (Cloudflare Proxy compatible)
app.get('/api/check-status', async (req, res) => {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ error: 'Domain missing' });

    try {
        // Sử dụng Google DNS API (HTTPS) để kiểm tra DNS
        const response = await fetch(`https://dns.google/resolve?name=${domain}&type=A`, {
            headers: { 'Accept': 'application/dns-json' }
        });
        const data = await response.json();
        
        // Kiểm tra xem có Answer không
        const hasAnswer = data.Status === 0 && data.Answer && data.Answer.length > 0;
        
        if (!hasAnswer) {
            return res.json({ status: 'offline', detail: 'No DNS records found' });
        }

        // Logic mới: Nếu có bất kỳ IP nào trả về (A record), coi như là Online
        res.json({ 
            status: 'online', 
            records: data.Answer,
            detail: 'DNS is resolving (Proxy compatible)' 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Dashboard Backend running at http://localhost:${PORT}`);
});
