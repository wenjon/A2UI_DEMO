import {compileBlocks, parseBlocks} from './blocks.ts';
import {chatCompletion, llmConfig, parseModelOutput, type ChatMessage} from './llm.ts';
import {
  compileHmiBlocks,
  fallbackHmiComponents,
  hmiSurfaceId,
  parseHmiBlocks,
  variantFromRequest,
} from './hmi-blocks.ts';
import {
  buildBlockRepairPrompt,
  buildBlockSystemPrompt,
  buildBlockUserPrompt,
  buildHmiRepairPrompt,
  buildHmiSystemPrompt,
  buildHmiUserPrompt,
  buildJsonRepairPrompt,
  buildJsonSystemPrompt,
  buildJsonUserPrompt,
} from './prompt.ts';
import {normalizeComponents, toMessages} from './validate.ts';

export type GenerateMode = 'blocks' | 'json' | 'hmi';

export type GenerateResult = {
  ok: boolean;
  mode: GenerateMode;
  surfaceId: string;
  model: string;
  request: string;
  messages: unknown[];
  components: Record<string, unknown>[];
  data?: Record<string, unknown>;
  script: string;
  raw: string;
  attempts: {attempt: number; ms: number; ok: boolean; errors: string[]}[];
  warnings: string[];
  errors: string[];
  totalMs: number;
  usage?: Record<string, number>;
};

function fallbackComponents(errors: string[]): Record<string, unknown>[] {
  const reason = (errors[0] ?? '未知错误').slice(0, 300);
  return [
    {id: 'root', component: 'Card', child: 'col'},
    {
      id: 'col',
      component: 'Column',
      children: ['title', 'reason', 'hint'],
      align: 'stretch',
    },
    {id: 'title', component: 'Text', text: '没能生成有效界面', variant: 'h3'},
    {id: 'reason', component: 'Text', text: reason, variant: 'caption'},
    {
      id: 'hint',
      component: 'Text',
      text: '可以换个说法再试，或切换到“直出 JSON”查看模型原始输出。',
      variant: 'caption',
    },
  ];
}

function uniqueWarnings(list: string[]): string[] {
  return [...new Set(list)];
}

async function generateFromBlocks(
  request: string,
  started: number,
): Promise<GenerateResult> {
  const surfaceId = `gen-${Date.now().toString(36)}`;
  const messages: ChatMessage[] = [
    {role: 'system', content: buildBlockSystemPrompt()},
    {role: 'user', content: buildBlockUserPrompt(request)},
  ];
  const attempts: GenerateResult['attempts'] = [];
  const warnings: string[] = [];
  let lastRaw = '';
  let lastErrors: string[] = [];
  let usage: Record<string, number> | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let content = '';
    let ms = 0;
    try {
      const result = await chatCompletion(messages, {
        temperature: 0,
        maxTokens: 700,
        jsonMode: false,
      });
      content = result.content;
      ms = result.ms;
      usage = result.usage;
      lastRaw = content;

      const parsed = parseBlocks(content);
      warnings.push(...parsed.warnings);
      if (parsed.blocks.length === 0) {
        lastErrors = [
          '没有解析到任何界面块。',
          ...parsed.warnings.slice(0, 5),
        ];
        attempts.push({attempt, ms, ok: false, errors: lastErrors});
      } else {
        const compiled = compileBlocks(parsed.blocks, request, surfaceId);
        warnings.push(...compiled.warnings);
        const normalized = normalizeComponents(compiled.components);
        warnings.push(...normalized.warnings);
        lastErrors = normalized.errors;
        attempts.push({
          attempt,
          ms,
          ok: normalized.ok,
          errors: normalized.errors,
        });

        if (normalized.ok) {
          const resultMessages = toMessages(normalized.components, surfaceId);
          if (Object.keys(compiled.data).length) {
            resultMessages.push({
              version: 'v0.9',
              updateDataModel: {surfaceId, value: compiled.data},
            });
          }
          return {
            ok: true,
            mode: 'blocks',
            surfaceId,
            model: llmConfig.model,
            request,
            messages: resultMessages,
            components: normalized.components,
            data: compiled.data,
            script: content,
            raw: content,
            attempts,
            warnings: uniqueWarnings(warnings),
            errors: [],
            totalMs: Date.now() - started,
            usage,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastErrors = [message];
      attempts.push({attempt, ms, ok: false, errors: [message]});
      if (!content) lastRaw = lastRaw || `<调用失败：${message}>`;
    }

    if (attempt === 1) {
      messages.push({role: 'assistant', content: content || '(无输出)'});
      messages.push({
        role: 'user',
        content: buildBlockRepairPrompt(request, content, lastErrors.slice(0, 8)),
      });
    }
  }

  return {
    ok: false,
    mode: 'blocks',
    surfaceId,
    model: llmConfig.model,
    request,
    messages: toMessages(fallbackComponents(lastErrors), surfaceId),
    components: fallbackComponents(lastErrors),
    script: lastRaw,
    raw: lastRaw,
    attempts,
    warnings: uniqueWarnings(warnings),
    errors: lastErrors,
    totalMs: Date.now() - started,
    usage,
  };
}

async function generateFromJson(
  request: string,
  started: number,
): Promise<GenerateResult> {
  const surfaceId = `gen-${Date.now().toString(36)}`;
  const messages: ChatMessage[] = [
    {role: 'system', content: buildJsonSystemPrompt()},
    {role: 'user', content: buildJsonUserPrompt(request)},
  ];
  const attempts: GenerateResult['attempts'] = [];
  const warnings: string[] = [];
  let lastRaw = '';
  let lastErrors: string[] = [];
  let usage: Record<string, number> | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let content = '';
    let ms = 0;
    try {
      const result = await chatCompletion(messages, {
        temperature: 0,
        maxTokens: 1600,
      });
      content = result.content;
      ms = result.ms;
      usage = result.usage;
      lastRaw = content;

      const parsed = parseModelOutput(content);
      warnings.push(...parsed.warnings);
      const normalized = normalizeComponents(parsed.value);
      warnings.push(...normalized.warnings);
      lastErrors = normalized.errors;
      attempts.push({
        attempt,
        ms,
        ok: normalized.ok,
        errors: normalized.errors,
      });

      if (normalized.ok) {
        return {
          ok: true,
          mode: 'json',
          surfaceId,
          model: llmConfig.model,
          request,
          messages: toMessages(normalized.components, surfaceId),
          components: normalized.components,
          script: content,
          raw: content,
          attempts,
          warnings: uniqueWarnings(warnings),
          errors: [],
          totalMs: Date.now() - started,
          usage,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastErrors = [message];
      attempts.push({attempt, ms, ok: false, errors: [message]});
      if (!content) lastRaw = lastRaw || `<调用失败：${message}>`;
    }

    if (attempt === 1) {
      messages.push({role: 'assistant', content: content || '(无输出)'});
      messages.push({
        role: 'user',
        content: buildJsonRepairPrompt(request, content, lastErrors.slice(0, 8)),
      });
    }
  }

  return {
    ok: false,
    mode: 'json',
    surfaceId,
    model: llmConfig.model,
    request,
    messages: toMessages(fallbackComponents(lastErrors), surfaceId),
    components: fallbackComponents(lastErrors),
    script: lastRaw,
    raw: lastRaw,
    attempts,
    warnings: uniqueWarnings(warnings),
    errors: lastErrors,
    totalMs: Date.now() - started,
    usage,
  };
}

/**
 * Car-screen mode. The model only writes the parts that change; compileHmiBlocks
 * always produces the full 1920x1200 landscape composition from the asset
 * registry, and the fallback is a real car screen too, never a web form.
 */
async function generateFromHmi(
  request: string,
  started: number,
): Promise<GenerateResult> {
  const variant = variantFromRequest(request);
  const surfaceId = hmiSurfaceId();
  const messages: ChatMessage[] = [
    {role: 'system', content: buildHmiSystemPrompt(variant)},
    {role: 'user', content: buildHmiUserPrompt(request)},
  ];
  const attempts: GenerateResult['attempts'] = [];
  const warnings: string[] = [];
  let lastRaw = '';
  let lastErrors: string[] = [];
  let usage: Record<string, number> | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let content = '';
    let ms = 0;
    try {
      const result = await chatCompletion(messages, {
        temperature: 0,
        maxTokens: 600,
        jsonMode: false,
      });
      content = result.content;
      ms = result.ms;
      usage = result.usage;
      lastRaw = content;

      const parsed = parseHmiBlocks(content);
      warnings.push(...parsed.warnings);
      if (parsed.blocks.length === 0) {
        lastErrors = [
          '没有解析到任何车机界面块。',
          ...parsed.warnings.slice(0, 5),
        ];
        attempts.push({attempt, ms, ok: false, errors: lastErrors});
      } else {
        const compiled = compileHmiBlocks(parsed.blocks, request);
        warnings.push(...compiled.warnings);
        const normalized = normalizeComponents(compiled.components);
        warnings.push(...normalized.warnings);
        lastErrors = normalized.errors;
        attempts.push({
          attempt,
          ms,
          ok: normalized.ok,
          errors: normalized.errors,
        });

        if (normalized.ok) {
          const resultMessages = toMessages(normalized.components, surfaceId);
          if (Object.keys(compiled.data).length) {
            resultMessages.push({
              version: 'v0.9',
              updateDataModel: {surfaceId, value: compiled.data},
            });
          }
          return {
            ok: true,
            mode: 'hmi',
            surfaceId,
            model: llmConfig.model,
            request,
            messages: resultMessages,
            components: normalized.components,
            data: compiled.data,
            script: content,
            raw: content,
            attempts,
            warnings: uniqueWarnings(warnings),
            errors: [],
            totalMs: Date.now() - started,
            usage,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastErrors = [message];
      attempts.push({attempt, ms, ok: false, errors: [message]});
      if (!content) lastRaw = lastRaw || `<调用失败：${message}>`;
    }

    if (attempt === 1) {
      messages.push({role: 'assistant', content: content || '(无输出)'});
      messages.push({
        role: 'user',
        content: buildHmiRepairPrompt(request, content, lastErrors.slice(0, 8)),
      });
    }
  }

  const fallback = fallbackHmiComponents(request);
  const fallbackMessages = toMessages(fallback.components, surfaceId);
  fallbackMessages.push({
    version: 'v0.9',
    updateDataModel: {surfaceId, value: fallback.data},
  });

  return {
    ok: false,
    mode: 'hmi',
    surfaceId,
    model: llmConfig.model,
    request,
    messages: fallbackMessages,
    components: fallback.components,
    data: fallback.data,
    script: lastRaw,
    raw: lastRaw,
    attempts,
    warnings: uniqueWarnings(warnings),
    errors: lastErrors,
    totalMs: Date.now() - started,
    usage,
  };
}

export async function generateUi(
  request: string,
  mode: GenerateMode = 'blocks',
): Promise<GenerateResult> {
  const started = Date.now();
  if (mode === 'json') return generateFromJson(request, started);
  if (mode === 'hmi') return generateFromHmi(request, started);
  return generateFromBlocks(request, started);
}
