export type ChatMessage = {role: 'system' | 'user' | 'assistant'; content: string};

export const llmConfig = {
  baseUrl: (process.env.A2UI_LLM_BASE ?? 'http://127.0.0.1:8000').replace(/\/+$/, ''),
  model: process.env.A2UI_LLM_MODEL ?? 'qwen3.5:4b',
  timeoutMs: Number(process.env.A2UI_LLM_TIMEOUT_MS ?? 180_000),
};

export type ChatResult = {
  content: string;
  usage?: Record<string, number>;
  ms: number;
};

export async function chatCompletion(
  messages: ChatMessage[],
  options: {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    jsonMode?: boolean;
  } = {},
): Promise<ChatResult> {
  const started = Date.now();
  const signals = [AbortSignal.timeout(llmConfig.timeoutMs)];
  if (options.signal) signals.push(options.signal);

  const response = await fetch(`${llmConfig.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: llmConfig.model,
      messages,
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 2048,
      response_format:
        options.jsonMode === false ? undefined : {type: 'json_object'},
      stream: false,
    }),
    signal: AbortSignal.any(signals),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`模型服务返回 ${response.status}: ${detail}`);
  }

  const data = (await response.json()) as {
    choices?: {message?: {content?: string; reasoning_content?: string}}[];
    usage?: Record<string, number>;
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new Error('模型返回了空内容');

  return {content, usage: data.usage, ms: Date.now() - started};
}

export function parseModelOutput(text: string): {
  value: unknown;
  warnings: string[];
  lineCount: number;
} {
  const warnings: string[] = [];
  let body = text.trim();
  const fenced = body.match(/```(?:json|jsonl)?\s*([\s\S]*?)```/i);
  if (fenced) body = fenced[1].trim();

  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      return {value: JSON.parse(body), warnings, lineCount: 1};
    } catch {
      // Fall through to line-by-line parsing.
    }
  }

  const objects: unknown[] = [];
  const lines = body.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    let line = rawLine.trim();
    if (!line) return;
    line = line.replace(/^(?:[-*]\s+|\d+[.)]\s+)/, '');
    const start = line.indexOf('{');
    const end = line.lastIndexOf('}');
    if (start < 0 || end <= start) {
      warnings.push(`第 ${index + 1} 行没有 JSON 对象，已跳过`);
      return;
    }
    line = line.slice(start, end + 1);

    const attempts = [
      line,
      line.replace(/,\s*([}\]])/g, '$1'),
      line.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"'),
    ];
    for (const candidate of attempts) {
      try {
        objects.push(JSON.parse(candidate));
        if (candidate !== line) {
          warnings.push(`第 ${index + 1} 行已自动修复引号/尾逗号`);
        }
        return;
      } catch {
        // Try the next repair.
      }
    }
    warnings.push(`第 ${index + 1} 行不是合法 JSON，已跳过`);
  });

  if (objects.length === 0) {
    throw new Error('模型输出中没有可解析的组件行');
  }
  return {
    value: {components: objects},
    warnings,
    lineCount: objects.length,
  };
}

export async function checkModel(): Promise<{
  ok: boolean;
  model: string;
  models?: string[];
  error?: string;
}> {
  try {
    const response = await fetch(`${llmConfig.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as {data?: {id: string}[]};
    const models = (data.data ?? []).map(item => item.id);
    return {ok: models.includes(llmConfig.model), model: llmConfig.model, models};
  } catch (error) {
    return {
      ok: false,
      model: llmConfig.model,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
