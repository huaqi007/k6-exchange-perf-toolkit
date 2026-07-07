// CI Mock API Server — 最小化实现，无需 npm install
// 启动: node scripts/mock-server.js
const http = require('http');

const PORT = 8080;

function randomPrice(base) {
  return Math.round(base * (0.98 + Math.random() * 0.04) * 100) / 100;
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  // GET /api/v1/health
  if (req.method === 'GET' && req.url === '/api/v1/health') {
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  // GET /api/v1/ticker/:symbol
  if (req.method === 'GET' && req.url.startsWith('/api/v1/ticker/')) {
    const symbol = req.url.split('/').pop();
    res.writeHead(200);
    return res.end(JSON.stringify({
      symbol,
      price: randomPrice(65000),
      timestamp: Date.now(),
    }));
  }

  // POST /api/v1/order
  if (req.method === 'POST' && req.url === '/api/v1/order') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      // 模拟 5% 随机 500 错误（测试重试和错误率指标）
      if (Math.random() < 0.05) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: 'Internal server error' }));
      }
      try {
        const order = JSON.parse(body);
        res.writeHead(200);
        res.end(JSON.stringify({
          orderId: `order-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          symbol: order.symbol || 'BTC-USDT',
          status: 'NEW',
          filledQty: 0,
        }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ code: 'INVALID_JSON' }));
      }
    });
    return;
  }

  // 其他路径 → 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock API running on http://0.0.0.0:${PORT}`);
});
