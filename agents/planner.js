/**
 * Planner Agent
 * Model: MiMo-V2.5-Pro
 * Breaks user goal into structured task list.
 */

const SYSTEM_PROMPT = `You are a Planner Agent. You MUST break the user's goal into a task list.

CRITICAL RULES:
- Output ONLY a valid JSON array. Nothing else.
- NO markdown, NO explanation, NO conversation, NO code fences.
- Start your response with [ and end with ]
- Each task: {"id": number, "task": string, "type": string}
- Types: coding, frontend, backend, api, data, content, research, testing, deployment
- Even for simple goals like "hi" or "hello", create at least 1 task.
- Max 15 tasks.

Example - for goal "say hello":
[{"id":1,"task":"Create a greeting response","type":"content"}]`;

class PlannerAgent {
  constructor(mimoClient) {
    this.client = mimoClient;
    this.model = 'mimo-v2.5-pro';
  }

  async plan(goal) {
    const response = await this.client.chat({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `Goal: ${goal}`,
      model: this.model,
      temperature: 0.2,
      maxTokens: 4096
    });

    let tasks;
    try {
      // Extract JSON from response (handle potential wrapping)
      const jsonStr = this._extractJSON(response.content);
      tasks = JSON.parse(jsonStr);
    } catch (e) {
      // Fallback: wrap goal into a single task
      console.warn('Planner JSON parse failed, using fallback:', e.message);
      tasks = [{ id: 1, task: goal, type: 'content' }];
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      // Fallback: wrap goal into a single task
      tasks = [{ id: 1, task: goal, type: 'content' }];
    }

    return {
      tasks,
      usage: response.usage,
      model: response.model
    };
  }

  _extractJSON(text) {
    // Try direct parse first
    const trimmed = text.trim();
    if (trimmed.startsWith('[')) return trimmed;

    // Try to find JSON block in markdown code fence
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return match[1].trim();

    // Try finding array in text
    const arrStart = trimmed.indexOf('[');
    const arrEnd = trimmed.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
      return trimmed.substring(arrStart, arrEnd + 1);
    }

    return trimmed;
  }
}

module.exports = PlannerAgent;
