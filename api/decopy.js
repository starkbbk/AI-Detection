export default async function handler(req, res) {
  const { path } = req.query;
  const targetUrl = `https://api.decopy.ai${path}`;

  try {
    const options = {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'],
        'Product-Serial': req.headers['product-serial'] || '',
        'Authorization': req.headers['authorization'] || '',
        'Origin': 'https://decopy.ai',
        'Referer': 'https://decopy.ai/',
      }
    };

    if (req.method === 'POST') {
      // For Vercel, we need to pass the body as a string or buffer
      options.body = req.body;
    }

    const response = await fetch(targetUrl, options);
    const data = await response.json();
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Product-Serial, Authorization');

    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
