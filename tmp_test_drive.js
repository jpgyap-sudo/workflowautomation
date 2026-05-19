const http = require('http');
const data = JSON.stringify({
  file_type: 'test',
  original_filename: 'test-upload.txt',
  mime_type: 'text/plain',
  file_data: 'SGVsbG8gZnJvbSBBUEkgdGVzdA=='
});
const req = http.request({
  hostname: 'localhost',
  port: 8080,
  path: '/drive/upload',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log(body));
});
req.write(data);
req.end();
