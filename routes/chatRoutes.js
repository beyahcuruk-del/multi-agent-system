/**
 * Chat Routes — Single Agent
 * POST /chat — Conversational chat
 * POST /run — Goal execution (plan + execute in one agent)
 */

const express = require('express');

const CHAT_SYSTEM = `You are a helpful AI assistant. Be concise, clear, and direct. Answer the user's questions accurately. When writing code, use proper formatting with code blocks. Keep responses focused and practical.`;

const AGENT_SYSTEM = `You are a powerful AI agent. When given a goal, you MUST:

1. PLAN: Break the goal into clear, actionable tasks (max 10)
2. EXECUTE: Work through each task and produce concrete results

Output format — return a SINGLE valid JSON object:
{
  "plan": [
    {"id": 1, "task": "description", "type": "coding|research|content|data|api|design"}
  ],
  "results": [
    {"id": 1, "task": "description", "output": "detailed result with code/data/content", "status": "completed"}
  ],
  "summary": "Brief overall summary of what was accomplished"
}

RULES:
- Be thorough in execution — provide actual code, data, or content, not placeholders
- For coding tasks: write complete, working code with file paths
- For research: provide specific findings with sources
- For content: produce the full content
- If a task can't be fully completed, explain what's missing and why
- Output ONLY the JSON object, no markdown wrapping, no extra text`;

function createChatRoutes(mimoClient) {
  const router = express.Router();

  const https = require('https');
  const http = require('http');

  function callMiMo(messages, maxTokens = 4096) {
    const body = JSON.stringify({
      model: mimoClient.defaultModel,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens
    });

    const url = new URL(`${mimoClient.baseUrl}/chat/completions`);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const req = lib.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${mimoClient.apiKey}`,
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) reject(new Error(parsed.error.message || 'API error'));
            else resolve({
              content: parsed.choices?.[0]?.message?.content || '',
              model: parsed.model,
              usage: parsed.usage
            });
          } catch (e) {
            reject(new Error('Failed to parse API response'));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });
  }

  function extractJSON(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) return trimmed;
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return match[1].trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) return trimmed.substring(start, end + 1);
    return trimmed;
  }

  /**
   * POST /chat — Simple conversation
   */
  router.post('/chat', async (req, res) => {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Missing messages array' });
    }

    try {
      const result = await callMiMo([
        { role: 'system', content: CHAT_SYSTEM },
        ...messages.slice(-20)
      ]);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /run — Agent execution (plan + execute)
   * Body: { goal: string }
   * Returns: { plan, results, summary, raw }
   */
  router.post('/run', async (req, res) => {
    const { goal } = req.body;
    if (!goal) return res.status(400).json({ error: 'Missing goal' });

    try {
      const result = await callMiMo([
        { role: 'system', content: AGENT_SYSTEM },
        { role: 'user', content: `Goal: ${goal}` }
      ], 8192);

      // Try to parse structured response
      let parsed;
      try {
        const jsonStr = extractJSON(result.content);
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        // If can't parse, return raw
        parsed = {
          plan: [{ id: 1, task: goal, type: 'general' }],
          results: [{ id: 1, task: goal, output: result.content, status: 'completed' }],
          summary: 'Agent produced unstructured output'
        };
      }

      res.json({
        ...parsed,
        model: result.model,
        usage: result.usage
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /status
   */
  router.get('/status', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  return router;
}

module.exports = createChatRoutes;
