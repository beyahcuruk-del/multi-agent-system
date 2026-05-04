/**
 * Trading Terminal Routes — Full Feature
 * Dashboard, Markets, Trade, Portfolio, Signals
 */

const express = require('express');
const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'AI-Trading-Terminal/1.0' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function callMiMo(mimoClient, messages, maxTokens = 4096) {
  const body = JSON.stringify({
    model: mimoClient.defaultModel,
    messages,
    temperature: 0.3,
    max_tokens: maxTokens
  });
  const url = new URL(`${mimoClient.baseUrl}/chat/completions`);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const req = lib.request({
      hostname: url.hostname, port: url.port || (isHttps ? 443 : 80),
      path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mimoClient.apiKey}`, 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed.choices?.[0]?.message?.content || '');
        } catch (e) { reject(new Error('Parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

function createTradingRoutes(mimoClient) {
  const router = express.Router();

  // Cache
  let coinsCache = null;
  let coinsCacheTime = 0;
  let globalCache = null;
  let globalCacheTime = 0;
  const CACHE_TTL = 30000;

  // ===== MARKETS =====
  router.get('/api/coins', async (req, res) => {
    try {
      if (coinsCache && Date.now() - coinsCacheTime < CACHE_TTL) return res.json(coinsCache);
      const data = await fetchJSON('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=1h,24h,7d');
      coinsCache = data;
      coinsCacheTime = Date.now();
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ===== GLOBAL STATS =====
  router.get('/api/global', async (req, res) => {
    try {
      if (globalCache && Date.now() - globalCacheTime < CACHE_TTL) return res.json(globalCache);
      const data = await fetchJSON('https://api.coingecko.com/api/v3/global');
      globalCache = data;
      globalCacheTime = Date.now();
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ===== COIN DETAILS =====
  router.get('/api/coins/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const days = req.query.days || '7';
      const [details, chart] = await Promise.all([
        fetchJSON(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`),
        fetchJSON(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`)
      ]);
      res.json({
        id: details.id, symbol: details.symbol, name: details.name,
        image: details.image?.large, market_cap_rank: details.market_cap_rank,
        current_price: details.market_data?.current_price?.usd,
        market_cap: details.market_data?.market_cap?.usd,
        total_volume: details.market_data?.total_volume?.usd,
        high_24h: details.market_data?.high_24h?.usd,
        low_24h: details.market_data?.low_24h?.usd,
        price_change_24h: details.market_data?.price_change_24h,
        price_change_percentage_24h: details.market_data?.price_change_percentage_24h,
        price_change_percentage_7d: details.market_data?.price_change_percentage_7d,
        price_change_percentage_30d: details.market_data?.price_change_percentage_30d,
        ath: details.market_data?.ath?.usd,
        ath_change_percentage: details.market_data?.ath_change_percentage?.usd,
        atl: details.market_data?.atl?.usd,
        circulating_supply: details.market_data?.circulating_supply,
        total_supply: details.market_data?.total_supply,
        max_supply: details.market_data?.max_supply,
        description: details.description?.en?.replace(/<[^>]*>/g, '').substring(0, 500),
        chart: chart.prices || []
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ===== TRENDING =====
  router.get('/api/trending', async (req, res) => {
    try {
      const data = await fetchJSON('https://api.coingecko.com/api/v3/search/trending');
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ===== AI ANALYSIS =====
  router.post('/api/analyze', async (req, res) => {
    const { coin, price, change24h, change7d, marketCap, volume, high24h, low24h } = req.body;
    if (!coin) return res.status(400).json({ error: 'Missing coin data' });

    const systemPrompt = `You are an expert crypto trading analyst with 10+ years of experience. Analyze the given coin data and provide a detailed trading analysis.

Format your response EXACTLY like this:

**Market Sentiment:** [Bullish/Bearish/Neutral]

**Key Levels:**
- Support: $X, $X
- Resistance: $X, $X

**Technical Analysis:**
[2-3 sentences about price action, trend, volume]

**Short-term Outlook (1-7 days):**
[What to expect]

**Risk Assessment:** [Low/Medium/High]

**Trading Signal:** [Strong Buy/Buy/Hold/Sell/Strong Sell]

**Entry Zone:** $X - $X
**Stop Loss:** $X
**Take Profit:** $X, $X

Be specific with numbers. Use the price data provided to calculate levels.`;

    try {
      const analysis = await callMiMo(mimoClient, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze ${coin}:\n- Price: $${price}\n- 24h Change: ${change24h}%\n- 7d Change: ${change7d}%\n- Market Cap: $${marketCap}\n- 24h Volume: $${volume}\n- 24h High: $${high24h}\n- 24h Low: $${low24h}` }
      ]);
      res.json({ analysis });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ===== AI SIGNALS =====
  router.post('/api/signals', async (req, res) => {
    const { coins: coinsData } = req.body;
    if (!coinsData) return res.status(400).json({ error: 'Missing coins data' });

    const systemPrompt = `You are a crypto analyst. Given coin prices, output a JSON array of trading signals. Format: [{"coin":"Name","signal":"Buy/Sell","reason":"brief reason","confidence":"High/Medium/Low","target":"$price"}]. Output ONLY the JSON array.`;

    const summary = coinsData.slice(0, 10).map(c =>
      `${c.name}: $${c.current_price} (${c.price_change_percentage_24h?.toFixed(1)}% 24h)`
    ).join('\n');

    try {
      const result = await callMiMo(mimoClient, [
        { role: 'user', content: systemPrompt + '\n\nCoins:\n' + summary }
      ], 1024);

      let signals;
      try {
        const jsonStr = result.trim().startsWith('[') ? result.trim() : result.match(/\[[\s\S]*\]/)?.[0] || '[]';
        signals = JSON.parse(jsonStr);
      } catch { signals = [{ coin: 'Market', signal: 'Hold', reason: result.substring(0, 200), confidence: 'Medium', target: '—' }]; }
      res.json({ signals });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ===== MEME COIN SIGNALS (DexScreener) =====
  router.post('/api/meme-signals', async (req, res) => {
    try {
      // Fetch trending tokens from DexScreener
      const dexRes = await fetch('https://api.dexscreener.com/token-boosts/top/v1', {
        headers: { 'Accept': 'application/json' }
      });
      let trending = [];
      if (dexRes.ok) {
        const boostData = await dexRes.json();
        // Get top 10 boosted tokens
        const tokenAddresses = (boostData || []).slice(0, 10).map(t => t.tokenAddress);
        
        // Fetch details for each
        for (const addr of tokenAddresses.slice(0, 6)) {
          try {
            const detailRes = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${addr}`);
            if (detailRes.ok) {
              const detail = await detailRes.json();
              const pair = Array.isArray(detail) ? detail[0] : detail;
              if (pair && pair.priceChange) {
                trending.push({
                  name: pair.baseToken?.name || 'Unknown',
                  symbol: pair.baseToken?.symbol || '???',
                  price: pair.priceUsd || '0',
                  change5m: pair.priceChange?.m5 || 0,
                  change1h: pair.priceChange?.h1 || 0,
                  change6h: pair.priceChange?.h6 || 0,
                  change24h: pair.priceChange?.h24 || 0,
                  volume24h: pair.volume?.h24 || 0,
                  liquidity: pair.liquidity?.usd || 0,
                  fdv: pair.fdv || 0,
                  dex: pair.dexId || 'unknown',
                  pairAddress: pair.pairAddress || '',
                  chainId: pair.chainId || 'solana'
                });
              }
            }
          } catch {}
        }
      }

      // If DexScreener boost API fails, fallback to search trending
      if (trending.length === 0) {
        const searchRes = await fetch('https://api.dexscreener.com/latest/dex/search?q=solana%20meme');
        if (searchRes.ok) {
          const data = await searchRes.json();
          trending = (data.pairs || []).slice(0, 8).map(p => ({
            name: p.baseToken?.name || 'Unknown',
            symbol: p.baseToken?.symbol || '???',
            price: p.priceUsd || '0',
            change5m: p.priceChange?.m5 || 0,
            change1h: p.priceChange?.h1 || 0,
            change6h: p.priceChange?.h6 || 0,
            change24h: p.priceChange?.h24 || 0,
            volume24h: p.volume?.h24 || 0,
            liquidity: p.liquidity?.usd || 0,
            fdv: p.fdv || 0,
            dex: p.dexId || 'unknown',
            pairAddress: p.pairAddress || '',
            chainId: p.chainId || 'solana'
          }));
        }
      }

      if (trending.length === 0) {
        return res.json({ signals: [], memeCoins: [] });
      }

      // Format for AI
      const summary = trending.map(c =>
        `${c.symbol} (${c.name}): $${c.price} | 5m: ${c.change5m}% | 1h: ${c.change1h}% | 6h: ${c.change6h}% | 24h: ${c.change24h}% | Vol24h: $${(c.volume24h/1000).toFixed(0)}k | Liq: $${(c.liquidity/1000).toFixed(0)}k | FDV: $${(c.fdv/1000000).toFixed(1)}M`
      ).join('\n');

      const systemPrompt = `You are a meme coin trading analyst on Solana DEX. Given trending meme coin data from DexScreener, output a JSON array of trading signals. Consider volume spikes, price momentum, liquidity safety, and FDV.

Rules:
- If liquidity < $50k, mark as "Risky" with low confidence
- If volume24h is very high relative to FDV, it's a momentum play
- Strong 5m/1h changes = short-term momentum
- Be cautious with low liquidity coins

Format: [{"coin":"SYMBOL","signal":"Buy/Sell/Hold/Risky","reason":"brief reason (1-2 sentences)","confidence":"High/Medium/Low","target":"$price or N/A"}]

Output ONLY the JSON array.`;

      const result = await callMiMo(mimoClient, [
        { role: 'user', content: systemPrompt + '\n\nTrending Meme Coins:\n' + summary }
      ], 2048);

      let signals;
      try {
        const jsonStr = result.trim().startsWith('[') ? result.trim() : result.match(/\[[\s\S]*\]/)?.[0] || '[]';
        signals = JSON.parse(jsonStr);
      } catch {
        signals = [{ coin: 'Market', signal: 'Hold', reason: result.substring(0, 200), confidence: 'Medium', target: '—' }];
      }

      res.json({ signals, memeCoins: trending });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ===== CHAT =====
  router.post('/api/chat', async (req, res) => {
    const { messages } = req.body;
    if (!messages) return res.status(400).json({ error: 'Missing messages' });
    try {
      const content = await callMiMo(mimoClient, [
        { role: 'system', content: 'You are a crypto trading assistant. Be concise and helpful. Give practical trading advice with specific price levels when possible.' },
        ...messages.slice(-10)
      ]);
      res.json({ content });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
}

module.exports = createTradingRoutes;
