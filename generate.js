const DAILY_LIMIT = 3; // ek user din mein 3 baar generate kar sakta hai
const store = new Map(); // in-memory (Vercel mein reset hota hai, kafi hai abuse ke liye)

function getIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    'unknown'
  );
}

function getRateKey(ip) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${ip}__${today}`;
}

export default async function handler(req, res) {
  // CORS — sab origins allow (apni domain restrict kar sakte ho baad mein)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const ip = getIP(req);
  const key = getRateKey(ip);
  const count = store.get(key) || 0;

  if (count >= DAILY_LIMIT) {
    return res.status(429).json({
      error: `Daily limit reached. You can generate ${DAILY_LIMIT} plans per day. Come back tomorrow!`
    });
  }

  // Request body validate karo
  const { destination, origin, duration, budget, travelers, style, season, interests } = req.body || {};

  if (!destination || !budget) {
    return res.status(400).json({ error: 'Destination and budget are required.' });
  }

  // Prompt
  const prompt = `You are an expert travel planner. Create a detailed and practical trip plan.

Destination: ${destination}
Origin: ${origin || 'not specified'}
Duration: ${duration || 5} days
Total Budget: $${budget} USD for ${travelers || 2} traveler(s)
Travel style: ${style || 'mid-range comfort'}
Travel month: ${season || 'not specified'}
Special interests: ${interests || 'none'}

Respond ONLY with a valid JSON object. No markdown, no backticks, no text before or after. Use exactly this structure:
{
  "tripTitle": "Catchy trip name",
  "summary": "2-3 sentence engaging overview",
  "days": [
    {
      "day": 1,
      "title": "Short day title",
      "morning": "Detailed morning plan with specific places",
      "afternoon": "Detailed afternoon plan with specific places",
      "evening": "Detailed evening plan",
      "accommodation": "Recommended area or hotel type",
      "meals": "Specific food recommendations"
    }
  ],
  "budget": {
    "flights": 0,
    "accommodation": 0,
    "food": 0,
    "activities": 0,
    "transport": 0,
    "misc": 0,
    "total": 0,
    "perPerson": 0,
    "currency": "USD"
  },
  "packingList": {
    "documents": ["item"],
    "clothing": ["item"],
    "toiletries": ["item"],
    "electronics": ["item"],
    "misc": ["item"]
  },
  "tips": ["tip1", "tip2", "tip3", "tip4", "tip5", "tip6"]
}`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 4000,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!groqRes.ok) {
      const errData = await groqRes.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Groq API error: ${groqRes.status}`);
    }

    const data = await groqRes.json();
    let text = data.choices[0].message.content.trim();
    text = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

    const parsed = JSON.parse(text);

    // Rate limit count update karo (sirf successful requests pe)
    store.set(key, count + 1);

    return res.status(200).json({
      success: true,
      plan: parsed,
      remaining: DAILY_LIMIT - (count + 1)
    });

  } catch (err) {
    console.error('Generate error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to generate plan. Please try again.' });
  }
}
