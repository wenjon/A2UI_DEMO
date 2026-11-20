import type {IncomingMessage, ServerResponse} from 'node:http';
import type {Plugin} from 'vite';
import {generateUi, type GenerateMode} from './generate.ts';
import {getHmiRegistry, registryPath} from './hmi-registry.ts';
import {checkModel, llmConfig} from './llm.ts';

const MAX_BODY_BYTES = 64 * 1024;

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

export function a2uiLlmPlugin(): Plugin {
  return {
    name: 'a2ui-llm',
    configureServer(server) {
      server.middlewares.use('/api/health', async (request, response) => {
        if (!request.url || request.url.startsWith('/')) {
          const status = await checkModel();
          sendJson(response, 200, {
            ...status,
            baseUrl: llmConfig.baseUrl,
            timeoutMs: llmConfig.timeoutMs,
          });
          return;
        }
        sendJson(response, 404, {error: 'not found'});
      });

      server.middlewares.use('/api/generate', async (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, 405, {error: '只支持 POST'});
          return;
        }
        try {
          const body = JSON.parse(await readBody(request)) as {
            prompt?: unknown;
            mode?: unknown;
          };
          if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
            sendJson(response, 400, {error: 'prompt 不能为空'});
            return;
          }
          if (body.prompt.length > 2000) {
            sendJson(response, 400, {error: 'prompt 太长（最多 2000 字符）'});
            return;
          }
          const mode: GenerateMode =
            body.mode === 'json' ? 'json' : body.mode === 'hmi' ? 'hmi' : 'blocks';
          const result = await generateUi(body.prompt, mode);
          sendJson(response, 200, result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(response, 502, {
            error: message,
            hint: `确认 flm serve ${llmConfig.model} 正在 ${llmConfig.baseUrl} 运行`,
          });
        }
      });

      // The asset registry the generator and the renderer both read.
      server.middlewares.use('/api/hmi/assets', (request, response) => {
        const registry = getHmiRegistry();
        sendJson(response, 200, {
          registryPath,
          loaded: registry.loaded,
          catalogId: registry.catalogId,
          design: registry.design,
          groups: registry.groups,
          assets: registry.assets.map(asset => ({
            key: asset.key,
            name: asset.name,
            group: asset.group,
            kind: asset.kind,
            variant: asset.variant,
            src: asset.src,
            rect: asset.rect,
            bleed: asset.bleed,
            text: asset.text,
          })),
        });
      });
    },
  };
}
