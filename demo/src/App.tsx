import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {A2uiSurface, MarkdownContext, type ReactCatalogComponent} from '@a2ui/react/v0_9';
import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {
  MessageProcessor,
  type ActionPayload,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {renderMarkdown} from '@a2ui/markdown-it';
import {hmiCatalog} from './hmi/hmi-catalog';
import {HMI_FIT} from './hmi/asset-registry';

type ExampleMeta = {file: string; name: string; description: string};
type GenerateMode = 'blocks' | 'json' | 'hmi';
type Attempt = {attempt: number; ms: number; ok: boolean; errors: string[]};
type GenerateResult = {
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
  attempts: Attempt[];
  warnings: string[];
  errors: string[];
  totalMs: number;
  usage?: Record<string, number>;
};
type ApiPayload = Partial<GenerateResult> & {error?: string; hint?: string};
type Health = {ok: boolean; model: string; baseUrl?: string; models?: string[]};

const QUICK_PROMPTS = [
  {
    label: '登录表单',
    text: '做一个邮箱和密码登录表单，带记住我和登录按钮',
  },
  {
    label: '商品卡片',
    text: '做一个无线降噪耳机商品卡片，价格 899 元，带评分和加入购物车按钮',
  },
  {
    label: '会议预约',
    text: '做一个会议预约表单：会议标题、日期、时间段、参与人，带确认按钮',
  },
  {
    label: '个人资料',
    text: '做一个个人资料编辑页：头像、姓名、邮箱、简介，带保存按钮',
  },
  {
    label: '系统设置',
    text: '做一个系统设置页：深色模式开关、语言选择、通知强度滑块、保存按钮',
  },
];

const QUICK_PROMPTS_HMI = [
  {
    label: '正常巡航',
    text: '车机导航中，时速 63，268 米后进入世纪大道西辅路，剩余 20 公里 36 分钟',
  },
  {
    label: '显示兴趣点',
    text: '车机地图上加一个停车场标记和一个商场标记，时速 45，1.2 公里后右转中山北路',
  },
  {
    label: '车控可点击',
    text: '车机界面，把音量、座椅加热和除霜图标做成可点击的控件，时速 52',
  },
  {
    label: '2D 平面地图',
    text: '2D 平面地图的车机界面，时速 42，800 米后左转人民路',
  },
  {
    label: '自定义文字',
    text: '车机界面，在地图上方写一行“前方施工，请减速”，时速 30',
  },
];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Cheap check on the outgoing messages: does this surface use the HMI catalog? */
function usesHmiComponents(messages: unknown): boolean {
  try {
    return JSON.stringify(messages ?? '').includes('"Hmi');
  } catch {
    return false;
  }
}

function usesFlatMap(messages: unknown): boolean {
  try {
    return JSON.stringify(messages ?? '').includes('"variant":"2d"');
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ 动作状态机 */

/** next_instruction 轮换的三条内置指引。 */
const NAV_STEPS = [
  {distance: '268 米后', label: '进入', road: '世纪大道西辅路'},
  {distance: '1.2 公里后', label: '右转', road: '中山北路'},
  {distance: '450 米后', label: '左转', road: '人民路'},
];

/** 数据模型里“22°”“2 档”这类字符串也能读出数字。 */
function intOf(value: unknown, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const digits = String(value ?? '').replace(/[^\d.-]/g, '');
  const parsed = digits ? Number.parseFloat(digits) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 热区自己 bind 的是哪条路径，写回就用那条，端上的高亮才会跟着变。 */
function boundPathOf(
  surface: SurfaceModel<ReactCatalogComponent>,
  componentId: string | undefined,
): string | undefined {
  if (!componentId) return undefined;
  const bind = surface.componentsModel.get(componentId)?.properties?.bind as
    | {path?: unknown}
    | undefined;
  return typeof bind?.path === 'string' && bind.path ? bind.path : undefined;
}

/**
 * 服务端（demo/server/hmi-composer.ts 等）发出来的动作名都在这里落到数据模型上：
 * 写 DataModel 就够了，绑定了这条路径的组件（bind / text / distance）会自动重渲染。
 */
export function applyHmiAction(
  processor: MessageProcessor<ReactCatalogComponent> | null,
  action: ActionPayload,
): void {
  const surface = processor?.getSurface(action.surfaceId);
  if (!surface) {
    console.log('[a2ui action]', action.name, '没有对应 surface');
    return;
  }
  const model = surface.dataModel;
  const context = action.context ?? {};
  const write = (path: string, value: unknown) => {
    model.set(path, value);
    console.log('[a2ui action]', action.name, path, value);
  };
  const statePath = (fallback: string) =>
    boundPathOf(surface, action.sourceComponentId) ?? fallback;

  switch (action.name) {
    case 'toggle_defrost':
    case 'toggle_heater': {
      const path = statePath(`/state/${action.name.slice('toggle_'.length)}`);
      write(path, !model.get(path));
      break;
    }
    case 'toggle_seat_heat': {
      const path = statePath(`/state/${context.side === 'passenger' ? 'seatPassenger' : 'seatDriver'}`);
      write(path, !model.get(path));
      break;
    }
    case 'cycle_fan_level': {
      const max = Math.max(1, intOf(context.max, 4));
      const next = (intOf(model.get('/climate/fan'), 0) % max) + 1;
      write('/climate/fan', `${next} 档`);
      break;
    }
    case 'raise_temp': {
      const path = `/climate/${context.side === 'passenger' ? 'passenger' : 'driver'}`;
      const next = clamp(intOf(model.get(path), 22) + intOf(context.delta, 1), 16, 30);
      write(path, `${next}°`);
      break;
    }
    case 'cycle_volume': {
      const max = Math.max(10, intOf(context.max, 100));
      const current = intOf(model.get('/media/volume'), 0);
      const next = current + 10 > max ? 10 : current + 10;
      write('/media/volume', next);
      write('/state/volume', next);
      break;
    }
    case 'toggle_route_pause': {
      const field = typeof context.field === 'string' && context.field ? context.field : '/route/action';
      const on = typeof context.on === 'string' ? context.on : '继续';
      const off = typeof context.off === 'string' ? context.off : '暂停';
      const pausePath = statePath('/state/routePause');
      const paused = Boolean(model.get(pausePath));
      write(pausePath, !paused);
      write(field, paused ? off : on);
      break;
    }
    case 'recenter_map': {
      write(statePath('/state/recenter_map'), true);
      break;
    }
    case 'zoom_in':
    case 'zoom_out': {
      const delta = intOf(context.delta, action.name === 'zoom_in' ? 1 : -1);
      const next = clamp(intOf(model.get('/map/zoom'), 12) + delta, 1, 20);
      write('/map/zoom', next);
      break;
    }
    case 'select_card':
    case 'select_poi': {
      const picked = context.card ?? context.id ?? action.sourceComponentId;
      write('/state/lastSelected', picked);
      break;
    }
    case 'next_instruction': {
      const step = (intOf(model.get('/state/step'), -1) + 1) % NAV_STEPS.length;
      const instruction = NAV_STEPS[step];
      write('/state/step', step);
      write('/nav/distance', instruction.distance);
      write('/nav/label', instruction.label);
      write('/nav/road', instruction.road);
      break;
    }
    case 'open_media':
    case 'open_phone':
    case 'exit_navigation': {
      write(statePath(`/state/${action.name}`), true);
      break;
    }
    default: {
      // 其它 toggle_*（比如以后新加的开关）一律翻转 /state/<名字>
      if (action.name.startsWith('toggle_')) {
        const path = statePath(`/state/${action.name.slice('toggle_'.length)}`);
        write(path, !model.get(path));
      } else {
        console.log('[a2ui action]', action.name, '没有内置状态机，只记录 action 本体');
      }
    }
  }
}

export function App() {
  const [examples, setExamples] = useState<ExampleMeta[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [actions, setActions] = useState<string[]>([]);
  const [raw, setRaw] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(QUICK_PROMPTS[0].text);
  const [mode, setMode] = useState<GenerateMode>('blocks');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GenerateResult | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [hmiScreen, setHmiScreen] = useState(false);
  const [flatMap, setFlatMap] = useState(false);
  const [wideOverride, setWideOverride] = useState<boolean | null>(null);
  const [showReference, setShowReference] = useState(false);

  const wide = HMI_FIT || (wideOverride ?? hmiScreen);

  const switchMode = useCallback((next: GenerateMode) => {
    setMode(next);
    const presets = [...QUICK_PROMPTS, ...QUICK_PROMPTS_HMI].map(item => item.text);
    if (presets.includes(prompt)) {
      setPrompt(next === 'hmi' ? QUICK_PROMPTS_HMI[0].text : QUICK_PROMPTS[0].text);
    }
  }, [prompt]);

  const processorRef = useRef<MessageProcessor<ReactCatalogComponent> | null>(null);

  const processor = useMemo(
    () => {
      const instance = new MessageProcessor<ReactCatalogComponent>(
        [basicCatalog, hmiCatalog],
        action => {
          setActions(prev => [JSON.stringify(action, null, 2), ...prev].slice(0, 8));
          // 车机全屏模式没有诊断面板，打到控制台方便 DevTools / adb logcat 观察
          console.log('[a2ui action]', action.name, action.sourceComponentId ?? '');
          applyHmiAction(processorRef.current, action);
        },
      );
      processorRef.current = instance;
      return instance;
    },
    [],
  );

  /** ?live=1 订阅控制台的 SSE；?console= 换地址（默认 127.0.0.1:8787）。 */
  const liveConfig = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const base = (params.get('console') ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
    return {enabled: params.get('live') === '1', base, url: `${base}/stream`};
  }, []);
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [liveError, setLiveError] = useState<string | null>(null);

  /** 把控制台推来的一条 v0.9 消息直接喂给现有 MessageProcessor。 */
  const ingest = useCallback(
    (payload: unknown) => {
      const list = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray((payload as {messages?: unknown[]}).messages)
          ? (payload as {messages: unknown[]}).messages
          : [payload];
      for (const item of list) {
        const created = (item as {createSurface?: {surfaceId?: unknown}} | null)?.createSurface;
        if (typeof created?.surfaceId === 'string' && processor.model.surfacesMap.has(created.surfaceId)) {
          // 控制台重发同一个 surface：先删再建，免得 createSurface 报重复
          processor.model.deleteSurface(created.surfaceId);
        }
      }
      try {
        processor.processMessages(payload as Parameters<typeof processor.processMessages>[0]);
        console.log('[a2ui live] 已应用', list.length, '条消息');
        setHmiScreen(usesHmiComponents(payload));
        setFlatMap(usesFlatMap(payload));
        setLiveError(null);
      } catch (e) {
        console.error('[a2ui live] 消息处理失败', e);
        setLiveError(messageOf(e));
      }
      setSurfaces(Array.from(processor.model.surfacesMap.values()));
    },
    [processor],
  );

  // Android WebView 里 EventSource 可用，所以用 SSE，不用 WebSocket。断线 3 秒后重连。
  useEffect(() => {
    if (!liveConfig.enabled) return;
    if (typeof EventSource === 'undefined') {
      setLiveStatus('closed');
      setLiveError('这个端上没有 EventSource');
      return;
    }
    let disposed = false;
    let source: EventSource | null = null;
    let retry: number | undefined;

    const connect = () => {
      if (disposed) return;
      source = new EventSource(liveConfig.url);
      source.onopen = () => {
        setLiveStatus('open');
        setLiveError(null);
        console.log('[a2ui live] 已连接', liveConfig.url);
      };
      source.onmessage = event => {
        const data = typeof event.data === 'string' ? event.data : '';
        if (!data) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          console.warn('[a2ui live] 收到非 JSON：', data.slice(0, 200));
          return;
        }
        ingest(parsed);
      };
      source.onerror = () => {
        source?.close();
        source = null;
        setLiveStatus('closed');
        if (disposed) return;
        console.warn('[a2ui live] 连接断开，3 秒后重连', liveConfig.url);
        retry = window.setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retry !== undefined) window.clearTimeout(retry);
      source?.close();
    };
  }, [ingest, liveConfig]);

  const [surfaces, setSurfaces] = useState<SurfaceModel<ReactCatalogComponent>[]>(() =>
    Array.from(processor.model.surfacesMap.values()),
  );

  useEffect(() => {
    const sync = () => setSurfaces(Array.from(processor.model.surfacesMap.values()));
    const created = processor.onSurfaceCreated(sync);
    const deleted = processor.onSurfaceDeleted(sync);
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
    };
  }, [processor]);

  const clearSurfaces = useCallback(() => {
    for (const id of Array.from(processor.model.surfacesMap.keys())) {
      processor.model.deleteSurface(id);
    }
    setSurfaces([]);
  }, [processor]);

  const refreshHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      const data = (await res.json()) as Health & {error?: string};
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setHealth(data);
      setHealthError(null);
    } catch (e) {
      setHealth(null);
      setHealthError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const load = useCallback(
    async (file: string) => {
      setError(null);
      setGenerateError(null);
      try {
        const res = await fetch(`examples/${file}`);
        if (!res.ok) throw new Error(`加载失败: ${res.status} ${res.statusText}`);
        const data = await res.json();
        clearSurfaces();
        setActions([]);
        setSelected(file);
        setGenerated(null);
        setRaw(JSON.stringify(data.messages, null, 2));
        processor.processMessages(data.messages);
        setSurfaces(Array.from(processor.model.surfacesMap.values()));
        setHmiScreen(usesHmiComponents(data.messages));
        setFlatMap(usesFlatMap(data.messages));
      } catch (e) {
        setError(messageOf(e));
      }
    },
    [clearSurfaces, processor],
  );

  const generate = useCallback(async () => {
    const text = prompt.trim();
    if (!text || generating) return;
    setGenerating(true);
    setGenerateError(null);
    setError(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json; charset=utf-8'},
        body: JSON.stringify({prompt: text, mode}),
      });
      const payload = (await res.json().catch(() => null)) as ApiPayload | null;
      if (!res.ok || !payload || !Array.isArray(payload.messages)) {
        const reason = payload?.error ?? `生成接口返回 HTTP ${res.status}`;
        throw new Error(payload?.hint ? `${reason}\n${payload.hint}` : reason);
      }
      const result = payload as GenerateResult;
      clearSurfaces();
      setActions([]);
      setSelected('');
      setGenerated(result);
      setRaw(JSON.stringify(result.messages, null, 2));
      processor.processMessages(
        result.messages as Parameters<typeof processor.processMessages>[0],
      );
      setSurfaces(Array.from(processor.model.surfacesMap.values()));
      setHmiScreen(usesHmiComponents(result.messages));
      setFlatMap(usesFlatMap(result.messages));
      if (!result.ok) {
        setGenerateError(result.errors.join('\n') || '生成结果没有通过校验，已显示回退界面。');
      }
    } catch (e) {
      setGenerateError(messageOf(e));
      void refreshHealth();
    } finally {
      setGenerating(false);
    }
  }, [clearSurfaces, generating, mode, processor, prompt, refreshHealth]);

  useEffect(() => {
    let cancelled = false;
    fetch('examples/manifest.json')
      .then(r => r.json())
      .then((list: ExampleMeta[]) => {
        if (cancelled) return;
        setExamples(list);
        if (liveConfig.enabled) {
          // 实时模式：画面等控制台推，不先加载示例，免得两个 surface 叠在一起
          console.log('[a2ui live] 实时模式，等待', liveConfig.url, '推送');
          return;
        }
        const fromUrl = new URLSearchParams(window.location.search).get('example');
        // ?fit=1 是车机全屏模式，没指定示例时默认用车机素材那份
        const initial =
          list.find(item => item.file === fromUrl) ??
          (HMI_FIT ? list.find(item => item.file === '42_hmi-cockpit-assets.json') : undefined) ??
          list[0];
        if (initial) void load(initial.file);
      })
      .catch(e => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [load, liveConfig]);

  const activeExample = examples.find(item => item.file === selected);
  const title = generated
    ? generated.ok
      ? '生成结果'
      : '生成结果（已回退）'
    : activeExample?.name ?? '加载中…';
  const subtitle = generated ? generated.request : activeExample?.description;
  const modeLabel =
    mode === 'blocks' ? '语义块' : mode === 'hmi' ? '车机 HMI' : '直出 JSON';
  const quickPrompts = mode === 'hmi' ? QUICK_PROMPTS_HMI : QUICK_PROMPTS;
  const referenceSrc = flatMap
    ? '/hmi/screens/hmi-2d-screen.svg'
    : '/hmi/screens/hmi-3d-screen.svg';

  return (
    <MarkdownContext.Provider value={renderMarkdown}>
      <div className={HMI_FIT ? 'app kiosk' : 'app'}>
        {liveConfig.enabled && (
          <div
            className={`live-chip ${liveStatus === 'open' ? 'open' : 'closed'}`}
            title={liveError ? `${liveConfig.url}\n${liveError}` : liveConfig.url}
          >
            <span className="live-dot" />
            实时流 {liveStatus === 'open' ? '已连接' : liveStatus === 'connecting' ? '连接中…' : '未连接'}
          </div>
        )}
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-title">A2UI</div>
            <div className="brand-sub">Basic Catalog Gallery · v0.9</div>
          </div>
          <div className="list">
            {examples.map(ex => (
              <button
                key={ex.file}
                className={ex.file === selected ? 'item active' : 'item'}
                onClick={() => void load(ex.file)}
                title={ex.description}
              >
                <span className="item-name">{ex.name}</span>
                <span className="item-file">{ex.file}</span>
              </button>
            ))}
          </div>
          <div className="sidebar-foot">
            <a href="https://a2ui.org" target="_blank" rel="noreferrer">
              a2ui.org
            </a>
            <span> · </span>
            <a href="https://github.com/google/a2ui" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
        </aside>

        <main className={wide ? 'main wide' : 'main'}>
          <header className="topbar">
            <div className="heading">
              <div className="title">{title}</div>
              <div className="subtitle">{subtitle}</div>
            </div>
            <div className="topbar-right">
              <span className="badge">
                catalogId: {hmiScreen ? 'hmi（1920×1200）' : 'basic'}
              </span>
              <button
                className={wide ? 'ghost active' : 'ghost'}
                onClick={() => setWideOverride(!wide)}
                aria-pressed={wide}
                title="宽屏预览：按 16:10 车机画面显示"
              >
                宽屏预览
              </button>
              {hmiScreen && (
                <button
                  className={showReference ? 'ghost active' : 'ghost'}
                  onClick={() => setShowReference(!showReference)}
                  aria-pressed={showReference}
                  title="叠上 Sketch 原稿导出，方便比对素材还原度"
                >
                  叠原稿
                </button>
              )}
              <button
                className={`health ${health?.ok ? 'ok' : health ? 'bad' : ''}`}
                onClick={() => void refreshHealth()}
                title={healthError ?? health?.baseUrl ?? '检查本地模型连接'}
              >
                <span className="health-dot" />
                {health?.ok ? health.model : healthError ? '模型未连接' : '检测中…'}
              </button>
            </div>
          </header>

          <section className="composer">
            <div className="composer-head">
              <div>
                <div className="composer-title">自然语言生成 A2UI</div>
                <div className="composer-hint">
                  小模型只写语义块，服务端编译、校验成 A2UI v0.9 JSON 后再渲染
                </div>
              </div>
              <div className="modes" role="group" aria-label="生成模式">
                <button
                  className={mode === 'blocks' ? 'mode-btn active' : 'mode-btn'}
                  aria-pressed={mode === 'blocks'}
                  onClick={() => switchMode('blocks')}
                >
                  语义块 <small>网页</small>
                </button>
                <button
                  className={mode === 'hmi' ? 'mode-btn active' : 'mode-btn'}
                  aria-pressed={mode === 'hmi'}
                  onClick={() => switchMode('hmi')}
                  title="车机横屏模式：模型只写导航/时速/兴趣点，服务端用素材库拼出 1920×1200 画面"
                >
                  车机 HMI <small>素材</small>
                </button>
                <button
                  className={mode === 'json' ? 'mode-btn active' : 'mode-btn'}
                  aria-pressed={mode === 'json'}
                  onClick={() => switchMode('json')}
                  title="让模型直接输出完整 A2UI JSON，4B 模型成功率较低，仅用于对比"
                >
                  直出 JSON <small>实验</small>
                </button>
              </div>
            </div>

            <textarea
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              onKeyDown={event => {
                if (
                  event.key === 'Enter' &&
                  (event.ctrlKey || event.metaKey) &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void generate();
                }
              }}
              rows={3}
              maxLength={2000}
              placeholder={
                mode === 'hmi'
                  ? '描述车机画面，例如：时速 45，1.2 公里后右转中山北路，加一个停车场标记'
                  : '描述你想要的界面，例如：做一个带邮箱、密码和登录按钮的登录页'
              }
              disabled={generating}
            />

            <div className="composer-foot">
              <div className="quick">
                {quickPrompts.map(item => (
                  <button
                    key={item.text}
                    className="quick-chip"
                    onClick={() => setPrompt(item.text)}
                    disabled={generating}
                    title={item.text}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                className="generate"
                onClick={() => void generate()}
                disabled={generating || !prompt.trim()}
                title="Ctrl + Enter"
              >
                {generating ? '本地模型推理中…' : `生成界面 · ${modeLabel}`}
              </button>
            </div>
          </section>

          {generating && (
            <div className="progress" aria-live="polite">
              <span className="spinner" />
              正在调用 qwen3.5:4b，首次生成通常需要几秒…
            </div>
          )}

          {generateError && <div className="error">{generateError}</div>}
          {error && <div className="error">{error}</div>}

          {generated && (
            <div className="run-summary" aria-live="polite">
              <span className={generated.ok ? 'pill pass' : 'pill fail'}>
                {generated.ok ? '校验通过' : '已回退'}
              </span>
              <span className="pill">
                {(generated.totalMs / 1000).toFixed(1)}s
              </span>
              <span className="pill">{generated.components.length} 个组件</span>
              <span className="pill">{generated.attempts.length} 次尝试</span>
              <span className="pill">{modeLabel}</span>
              {typeof generated.usage?.total_tokens === 'number' && (
                <span className="pill">{generated.usage.total_tokens} tokens</span>
              )}
              {generated.warnings.length > 0 && (
                <span className="pill warn">{generated.warnings.length} warnings</span>
              )}
            </div>
          )}

          <section className={wide ? 'preview wide' : 'preview'}>
            {surfaces.length === 0 && !error ? (
              <div className="empty">
                {generating
                  ? '正在等待模型生成…'
                  : liveConfig.enabled
                    ? `等待 ${liveConfig.url} 推送 A2UI 消息…`
                    : '等待 A2UI surface…'}
              </div>
            ) : (
              surfaces.map(surface => <A2uiSurface key={surface.id} surface={surface} />)
            )}
            {wide && hmiScreen && showReference && (
              <img className="ref-overlay" src={referenceSrc} alt="Sketch 原稿叠图" />
            )}
          </section>

          <section className="panels">
            {generated && (
              <details open>
                <summary>
                  模型输出
                  {generated.mode === 'json'
                    ? '（原始 JSON）'
                    : generated.mode === 'hmi'
                      ? '（车机界面块）'
                      : '（语义块脚本）'}
                </summary>
                <pre>{generated.script || '（空）'}</pre>
              </details>
            )}
            <details open>
              <summary>A2UI 消息 JSON</summary>
              <pre>{raw}</pre>
            </details>
            {generated && (
              <details>
                <summary>运行诊断（尝试、修复、token）</summary>
                <pre>
                  {JSON.stringify(
                    {
                      attempts: generated.attempts,
                      warnings: generated.warnings,
                      errors: generated.errors,
                      usage: generated.usage,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            )}
            <details>
              <summary>Action 回调（点击按钮后查看）</summary>
              <pre>{actions.length ? actions.join('\n---\n') : '暂无 action'}</pre>
            </details>
          </section>
        </main>
      </div>
    </MarkdownContext.Provider>
  );
}
