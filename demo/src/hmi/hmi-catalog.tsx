import {createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createComponentImplementation} from '@a2ui/react/v0_9';
import {
  ActionSchema,
  Catalog,
  type ComponentApi,
  ChildListSchema,
  DynamicBooleanSchema,
  DynamicNumberSchema,
  DynamicStringSchema,
} from '@a2ui/web_core/v0_9';
import {basicCatalog, BASIC_FUNCTIONS} from '@a2ui/web_core/v0_9/basic_catalog';
import z from 'zod';
import './hmi.css';
import {
  HMI_FIT,
  hmiAssetBox,
  hmiAssetEntry,
  hmiAssetsOfGroup,
  hmiFrameBox,
  hmiPlateStyle,
  type HmiAssetEntry,
} from './asset-registry';

export const HMI_CATALOG_ID = 'https://luckplusone.cfifa.com/a2ui/hmi/catalog.json';

const ASSET = '/hmi';
const CN_FONT = '"Hanyi Alibaba-PuHuiTi", "PingFang SC", "Microsoft YaHei", sans-serif';
const NUM_FONT = '"Bahnschrift", "DIN Alternate", "Helvetica Neue", Arial, sans-serif';

type Variant = '3d' | '2d';
const VariantContext = createContext<Variant>('3d');
const useVariant = () => useContext(VariantContext);

// Paint order for the map overlays: route under POIs, POIs under the location marks.
function kindRank(entry: HmiAssetEntry): number {
  if (entry.kind === 'route') return 0;
  if (entry.kind === 'poi') return 1;
  if (entry.kind === 'marker') return 2;
  return 3;
}

/* ---------------------------------------------------------------- screen */

const hmiScreenApi = {
  name: 'HmiScreen',
  schema: z.object({
    variant: z.enum(['3d', '2d']).optional(),
    children: ChildListSchema.optional(),
    hiddenAssets: z.array(z.string()).optional(),
    /** 按需覆盖物：有它时地图层只画点名的 key，没有时照旧画该 variant 的全部 map 素材。 */
    mapAssets: z.array(z.string()).optional(),
    /** 服务端部件级组装的元数据，端上不用，但要能被 schema 接受。 */
    slots: z.array(z.string()).optional(),
    assembly: z.enum(['composed', 'panel']).optional(),
  }),
} satisfies ComponentApi;

const HmiScreen = createComponentImplementation(hmiScreenApi, ({props, buildChild}) => {
  const variant: Variant = props.variant === '2d' ? '2d' : '3d';
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      if (HMI_FIT) {
        setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1200));
        return;
      }
      setScale(el.clientWidth / 1920);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const children = (props.children ?? []) as unknown as string[];
  const background = hmiAssetEntry(variant === '3d' ? 'map-city-3d' : 'map-flat-2d');
  // Registry-driven overlays: every map asset of this variant lands at its
  // Sketch canvasRect, so newly exported POIs or routes show up on their own.
  // hiddenAssets drops the ones a block has re-placed elsewhere.
  const hidden = new Set((props.hiddenAssets ?? []).map(String));
  // 按需覆盖物开关：服务端发了 mapAssets 就只画点名的 key（按注册表顺序），
  // 没发就维持原行为——画该 variant 的全部 map 素材。hiddenAssets 两种情况都生效。
  const requested = props.mapAssets ? (props.mapAssets as unknown as unknown[]).map(String) : null;
  let layers: HmiAssetEntry[] = hmiAssetsOfGroup('map', variant);
  if (requested) {
    const allowed = new Set(requested);
    const picked = new Map<string, HmiAssetEntry>();
    for (const entry of layers) {
      if (allowed.has(entry.key)) picked.set(entry.key, entry);
    }
    // 点名的 key 不在该 variant 的 map 组里时，仍按注册表把它放回自己的位置。
    for (const key of requested) {
      if (picked.has(key)) continue;
      const entry = hmiAssetEntry(key);
      if (entry) picked.set(entry.key, entry);
    }
    layers = [...picked.values()];
  }
  layers = layers
    .filter(entry => !hidden.has(entry.key))
    .sort((a, b) => kindRank(a) - kindRank(b));

  return (
    <div
      className={`hmi-viewport${HMI_FIT ? ' fit' : ''}`}
      ref={host}
      style={HMI_FIT ? {width: 1920 * scale, height: 1200 * scale} : {height: 1200 * scale}}
    >
      <div className="hmi-stage" style={{transform: `scale(${scale})`}}>
        <img
          className="hmi-map"
          src={background?.src ?? `${ASSET}/backgrounds/${variant === '3d' ? 'map-city-3d' : 'map-flat-2d'}.svg`}
          style={
            background
              ? {
                  left: background.rect.x,
                  top: background.rect.y,
                  width: background.rect.width,
                  height: background.rect.height,
                }
              : variant === '2d'
                ? {left: -216, top: -221, width: 2302, height: 1592}
                : undefined
          }
          alt=""
        />
        {layers.map(entry => {
          const box = hmiAssetBox(entry);
          return (
            <img
              key={entry.key}
              className="hmi-layer"
              src={entry.src}
              style={{left: box.left, top: box.top, width: box.width, height: box.height}}
              alt=""
            />
          );
        })}
        <VariantContext.Provider value={variant}>
          {children.map(id => (
            <FragmentNode key={id}>{buildChild(id)}</FragmentNode>
          ))}
        </VariantContext.Provider>
      </div>
    </div>
  );
});

function FragmentNode({children}: {children: ReactNode}) {
  return <>{children}</>;
}

/* ------------------------------------------------------- nav instruction */

const navApi = {
  name: 'HmiNavInstruction',
  schema: z.object({
    distance: DynamicStringSchema.optional(),
    road: DynamicStringSchema.optional(),
    label: DynamicStringSchema.optional(),
    variant: z.enum(['3d', '2d']).optional(),
  }),
} satisfies ComponentApi;

const HmiNavInstruction = createComponentImplementation(navApi, ({props}) => {
  const variant = useVariant();
  const distance = String(props.distance ?? '268 米后');
  const road = String(props.road ?? '世纪大道西辅路');
  const label = String(props.label ?? '进入');
  // Sketch stores "268 米后" as one text layer with runs: 50px number, 24px unit.
  const parsed = /^\s*([\d.,]+)\s*(.*)$/.exec(distance);
  const amount = parsed?.[1] ?? distance;
  const unit = parsed?.[2] ?? '';

  const frame = hmiAssetEntry(`nav-instruction-card-${variant}`);
  const plate = hmiAssetEntry(`nav-instruction-card-${variant}-plate`);

  return (
    <div
      className={`hmi-abs hmi-panel ${variant === '3d' ? 'hmi-nav-3d' : 'hmi-nav-2d'}`}
      style={frame ? hmiFrameBox(frame) : undefined}
    >
      <img
        className="hmi-plate"
        src={plate?.src ?? `${ASSET}/plates/nav-instruction-card-${variant}-plate.svg`}
        style={plate ? hmiPlateStyle(plate) : undefined}
        alt=""
      />
      <div className="hmi-distance" style={{left: 188, top: 40, height: 67, lineHeight: '67px'}}>
        <span style={{fontSize: 50, fontWeight: 500, color: '#11DDAC', fontFamily: NUM_FONT}}>{amount}</span>
        {unit && (
          <span style={{fontSize: 24, color: '#11DDAC', fontFamily: CN_FONT, marginLeft: 11}}>{unit}</span>
        )}
      </div>
      <div className="hmi-text" style={{left: 347, top: 70, height: 34, lineHeight: '34px', fontSize: 24, color: 'rgba(255,255,255,0.4)', fontFamily: CN_FONT}}>
        {label}
      </div>
      <div className="hmi-text" style={{left: 188, top: 113, height: 42, lineHeight: '42px', fontSize: 30, color: '#fff', fontFamily: CN_FONT}}>
        {road}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------ route info */

const routeInfoApi = {
  name: 'HmiRouteInfo',
  schema: z.object({
    remainingDistance: DynamicStringSchema.optional(),
    remainingTime: DynamicStringSchema.optional(),
    variant: z.enum(['3d', '2d']).optional(),
  }),
} satisfies ComponentApi;

const HmiRouteInfo = createComponentImplementation(routeInfoApi, ({props}) => {
  const variant = useVariant();
  const distance = String(props.remainingDistance ?? '20');
  const time = String(props.remainingTime ?? '36');
  const label = (text: string, left: number, muted = false) => (
    <div className="hmi-text" style={{left, top: 19, height: 34, lineHeight: '34px', fontSize: 24, color: muted ? 'rgba(255,255,255,0.4)' : '#fff', fontFamily: CN_FONT}}>
      {text}
    </div>
  );

  const frame = hmiAssetEntry(`route-info-bar-${variant}`);
  const plate = hmiAssetEntry(`route-info-bar-${variant}-plate`);

  return (
    <div
      className={`hmi-abs hmi-panel ${variant === '3d' ? 'hmi-route-3d' : 'hmi-route-2d'}`}
      style={frame ? hmiFrameBox(frame) : undefined}
    >
      <img
        className="hmi-plate"
        src={plate?.src ?? `${ASSET}/plates/route-info-bar-${variant}-plate.svg`}
        style={plate ? hmiPlateStyle(plate) : undefined}
        alt=""
      />
      {label('剩余', 16, true)}
      <div className="hmi-text" style={{left: 88, top: 13, height: 40, lineHeight: '40px', fontSize: 30, fontWeight: 500, color: '#fff', fontFamily: NUM_FONT}}>
        {distance}
      </div>
      {label('公里', 124, true)}
      <div className="hmi-text" style={{left: 188, top: 13, height: 40, lineHeight: '40px', fontSize: 30, fontWeight: 500, color: '#fff', fontFamily: NUM_FONT}}>
        {time}
      </div>
      {label('分钟', 224, true)}
      {label('暂停', 296)}
      {label('退出', 378)}
    </div>
  );
});

/* ----------------------------------------------------------- speedometer */

const speedApi = {
  name: 'HmiSpeedometer',
  schema: z.object({
    speed: DynamicNumberSchema.optional(),
    variant: z.enum(['3d', '2d']).optional(),
  }),
} satisfies ComponentApi;

const HmiSpeedometer = createComponentImplementation(speedApi, ({props}) => {
  const variant = useVariant();
  const speed = props.speed === undefined ? 63 : Number(props.speed);
  const frame = hmiAssetEntry(`speedometer-${variant}`);
  const plate = hmiAssetEntry(`speedometer-${variant}-plate`);
  const width = frame?.rect.width ?? 100;

  return (
    <div
      className={`hmi-abs ${variant === '3d' ? 'hmi-speed-3d' : 'hmi-speed-2d'}`}
      style={frame ? hmiFrameBox(frame) : undefined}
    >
      <img
        className="hmi-plate"
        src={plate?.src ?? `${ASSET}/plates/speedometer-${variant}-plate.svg`}
        style={plate ? hmiPlateStyle(plate) : undefined}
        alt=""
      />
      <div className="hmi-text hmi-center" style={{left: 0, top: 16, width, height: 53, lineHeight: '53px', fontSize: 40, fontWeight: 500, color: '#2180FF', fontFamily: NUM_FONT}}>
        {Number.isFinite(speed) ? speed : 0}
      </div>
      <div className="hmi-text hmi-center" style={{left: 0, top: 69, width, height: 16, lineHeight: '16px', fontSize: 12, fontWeight: 500, color: '#2180FF', fontFamily: NUM_FONT}}>
        KM/H
      </div>
    </div>
  );
});

/* --------------------------------------------------------- static chrome */

function imagePart(name: keyof typeof PARTS) {
  const api = {
    name,
    schema: z.object({variant: z.enum(['3d', '2d']).optional()}),
  } satisfies ComponentApi;
  return createComponentImplementation(api, () => {
    const variant = useVariant();
    const part = PARTS[name];
    const entry = hmiAssetEntry(part.key(variant));
    return (
      <div className={`hmi-abs ${part.className(variant)}`} style={entry ? hmiFrameBox(entry) : undefined}>
        <img
          className="hmi-plate"
          src={entry?.src ?? `${ASSET}/components/${part.key(variant)}.svg`}
          alt=""
        />
      </div>
    );
  });
}

const PARTS = {
  HmiStatusBar: {
    key: (v: Variant) => `status-bar-${v}`,
    className: (v: Variant) => (v === '3d' ? 'hmi-status-3d' : 'hmi-status-2d'),
  },
  HmiMapButtons: {
    key: (v: Variant) => `map-buttons-${v}`,
    className: () => 'hmi-buttons',
  },
  HmiZoomControl: {
    key: (v: Variant) => `zoom-control-${v}`,
    className: () => 'hmi-zoom',
  },
  HmiRouteProgress: {
    key: (v: Variant) => `route-progress-${v}`,
    className: () => 'hmi-progress',
  },
  HmiControlBar: {
    key: (v: Variant) => `control-bar-${v}`,
    className: () => 'hmi-controlbar',
  },
} as const;

const HmiStatusBar = imagePart('HmiStatusBar');
const HmiMapButtons = imagePart('HmiMapButtons');
const HmiZoomControl = imagePart('HmiZoomControl');
const HmiRouteProgress = imagePart('HmiRouteProgress');
const HmiControlBar = imagePart('HmiControlBar');

/* ---------------------------------------------- registry-driven parts */

const assetApi = {
  name: 'HmiAsset',
  schema: z.object({
    asset: DynamicStringSchema,
    variant: z.enum(['3d', '2d']).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  }),
} satisfies ComponentApi;

/** Any asset from the registry, placed at its Sketch coordinates. */
const HmiAsset = createComponentImplementation(assetApi, ({props}) => {
  const variant = useVariant();
  const raw = String(props.asset ?? '');
  const entry = hmiAssetEntry(raw) ?? hmiAssetEntry(`${raw}-${variant}`);
  if (!entry) return null;
  const box = hmiAssetBox(entry, {
    x: props.x,
    y: props.y,
    width: props.width,
    height: props.height,
  });
  return (
    <img
      className="hmi-layer hmi-asset"
      src={entry.src}
      style={{left: box.left, top: box.top, width: box.width, height: box.height}}
      alt={entry.name}
    />
  );
});

const textApi = {
  name: 'HmiText',
  schema: z.object({
    text: DynamicStringSchema,
    x: z.number(),
    y: z.number(),
    width: z.number().optional(),
    size: z.number().optional(),
    color: z.string().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    font: z.enum(['cn', 'num']).optional(),
    bold: z.boolean().optional(),
    variant: z.enum(['3d', '2d']).optional(),
  }),
} satisfies ComponentApi;

/** Text in the design space, on top of a plate or straight on the map. */
const HmiText = createComponentImplementation(textApi, ({props}) => {
  const size = props.size ?? 28;
  return (
    <div
      className="hmi-abs hmi-label"
      style={{
        left: props.x,
        top: props.y,
        width: props.width,
        height: Math.round(size * 1.3),
        lineHeight: `${Math.round(size * 1.3)}px`,
        fontSize: size,
        fontWeight: props.bold === false ? 400 : 600,
        color: props.color ?? '#ffffff',
        textAlign: props.align ?? 'left',
        fontFamily: props.font === 'num' ? NUM_FONT : CN_FONT,
      }}
    >
      {String(props.text ?? '')}
    </div>
  );
});

const hotspotApi = {
  name: 'HmiHotspot',
  schema: z.object({
    asset: DynamicStringSchema.optional(),
    action: ActionSchema,
    label: DynamicStringSchema.optional(),
    /** 数据模型里的开关：/state/heater 这类布尔（或任何真值）会给热区加上高亮。 */
    bind: DynamicBooleanSchema.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    variant: z.enum(['3d', '2d']).optional(),
  }),
} satisfies ComponentApi;

/** A real control: the Sketch art stays, the click becomes an A2UI action. */
const HmiHotspot = createComponentImplementation(hotspotApi, ({props}) => {
  const variant = useVariant();
  const raw = String(props.asset ?? '');
  const entry = hmiAssetEntry(raw) ?? hmiAssetEntry(`${raw}-${variant}`);
  // 部件级组装出来的点击区可以没有素材，只有几何；那种热区照样要可点，只是看不见素材。
  if (!entry && (props.x === undefined || props.y === undefined)) return null;
  const box = entry
    ? hmiAssetBox(entry, {x: props.x, y: props.y, width: props.width, height: props.height})
    : {
        left: Math.round(props.x ?? 0),
        top: Math.round(props.y ?? 0),
        width: Math.max(1, Math.round(props.width ?? 56)),
        height: Math.max(1, Math.round(props.height ?? 56)),
      };
  const label = props.label === undefined ? null : String(props.label);
  const on = Boolean(props.bind);
  // The property binder turns an action prop into the callable that dispatches it.
  const fire = () => {
    void props.action();
  };

  return (
    <div
      className={`hmi-abs hmi-hotspot${on ? ' hmi-hotspot--on' : ''}${entry ? '' : ' hmi-hotspot--zone'}`}
      style={{left: box.left, top: box.top, width: box.width, height: box.height}}
      role="button"
      tabIndex={0}
      aria-pressed={on}
      title={label ?? (entry ? entry.name : '热区')}
      onClick={fire}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          fire();
        }
      }}
    >
      {entry && <img className="hmi-plate" src={entry.src} alt={entry.name} />}
      {label && (
        <span
          className="hmi-hotspot-label"
          style={{fontSize: 20, fontFamily: CN_FONT}}
        >
          {label}
        </span>
      )}
    </div>
  );
});

const panelApi = {
  name: 'HmiPanel',
  schema: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    fill: z.string().optional(),
    radius: z.number().optional(),
    border: z.string().optional(),
    opacity: z.number().optional(),
    variant: z.enum(['3d', '2d']).optional(),
  }),
} satisfies ComponentApi;

/** 底板：部件级组装给卡片、HUD、车控栏铺的那块圆角矩形，坐标同样是设计空间。 */
const HmiPanel = createComponentImplementation(panelApi, ({props}) => {
  const opacity = typeof props.opacity === 'number' ? Math.min(1, Math.max(0, props.opacity)) : 1;
  return (
    <div
      className="hmi-abs hmi-block"
      style={{
        left: Math.round(props.x),
        top: Math.round(props.y),
        width: Math.max(1, Math.round(props.width)),
        height: Math.max(1, Math.round(props.height)),
        background: props.fill ?? '#0B1220',
        borderRadius: Math.max(0, Math.round(props.radius ?? 18)),
        border: props.border ? `1px solid ${props.border}` : undefined,
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
});

/* ---------------------------------------------------------------- catalog */

export const hmiCatalog = new Catalog(
  HMI_CATALOG_ID,
  '0.9',
  [
    ...basicCatalog.components.values(),
    HmiScreen,
    HmiNavInstruction,
    HmiRouteInfo,
    HmiSpeedometer,
    HmiStatusBar,
    HmiMapButtons,
    HmiZoomControl,
    HmiRouteProgress,
    HmiControlBar,
    HmiAsset,
    HmiText,
    HmiHotspot,
    HmiPanel,
  ],
  BASIC_FUNCTIONS,
  basicCatalog.themeSchema,
);

export const HMI_COMPONENT_NAMES = [
  'HmiScreen',
  'HmiNavInstruction',
  'HmiRouteInfo',
  'HmiSpeedometer',
  'HmiStatusBar',
  'HmiMapButtons',
  'HmiZoomControl',
  'HmiRouteProgress',
  'HmiControlBar',
  'HmiAsset',
  'HmiText',
  'HmiHotspot',
  'HmiPanel',
] as const;
