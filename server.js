const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 1599;
const HOST = '0.0.0.0';
const BASE_DIR = __dirname;

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject'
};

const server = http.createServer((req, res) => {
    let filePath = path.join(BASE_DIR, req.url);

    // Handle directory requests by looking for index.html
    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }
    }

    // If index.html doesn't exist in subdirectory, serve root index.html
    if (!fs.existsSync(filePath)) {
        filePath = path.join(BASE_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'text/plain';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>404 - File Not Found</h1>');
            return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`\n✨ UX DEMO 服务器已启动!\n`);
    console.log(`📍 访问地址:`);
    console.log(`   http://10.5.0.4:${PORT}\n`);
    console.log(`按 Ctrl+C 停止服务器\n`);
});
