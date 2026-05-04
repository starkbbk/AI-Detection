export default async function handler(req, res) {
  const { path } = req.query;
  const targetUrl = `https://api.decopy.ai${path}`;

  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1'
  ];

  const randomIp = () => Array.from({length: 4}, () => Math.floor(Math.random() * 256)).join('.');

  try {
    const options = {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Product-Serial': req.headers['product-serial'] || '',
        'Authorization': req.headers['authorization'] || '',
        'Origin': 'https://decopy.ai',
        'Referer': 'https://decopy.ai/',
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        'X-Forwarded-For': randomIp(),
        'X-Real-IP': randomIp(),
      }
    };

    if (req.method === 'POST') {
      options.body = req.body;
    }

    const response = await fetch(targetUrl, options);
    const data = await response.json();
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
