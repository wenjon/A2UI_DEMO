import {CATALOG_ID, getCatalog, type ComponentSpec} from './catalog.ts';
import {assetBox, hmiAsset, hmiCatalogId, resolveAssetKey} from './hmi-registry.ts';

export type ValidationResult = {
  ok: boolean;
  components: Record<string, unknown>[];
  errors: string[];
  warnings: string[];
};

type Json = Record<string, any>;

const COMPONENT_ALIASES: Record<string, string> = {
  container: 'Column',
  stack: 'Column',
  view: 'Column',
  box: 'Column',
  form: 'Column',
  vbox: 'Column',
  hbox: 'Row',
  flex: 'Row',
  label: 'Text',
  heading: 'Text',
  title: 'Text',
  paragraph: 'Text',
  caption: 'Text',
  textlabel: 'Text',
  input: 'TextField',
  textbox: 'TextField',
  textinput: 'TextField',
  img: 'Image',
  picture: 'Image',
  photo: 'Image',
  btn: 'Button',
  toggle: 'CheckBox',
  switch: 'CheckBox',
  select: 'ChoicePicker',
  dropdown: 'ChoicePicker',
  picker: 'ChoicePicker',
  range: 'Slider',
  datepicker: 'DateTimeInput',
  dateinput: 'DateTimeInput',
  screen: 'HmiScreen',
  gauge: 'HmiSpeedometer',
  speedometer: 'HmiSpeedometer',
  panel: 'HmiAsset',
  plate: 'HmiAsset',
  asset: 'HmiAsset',
  hotspot: 'HmiHotspot',
  tapzone: 'HmiHotspot',
  hudtext: 'HmiText',
};

const PLACEHOLDER_IMAGE = 'https://picsum.photos/600/400';

function asComponentList(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return null;
  const object = parsed as Json;
  if (Array.isArray(object.components)) return object.components;
  if (Array.isArray(object.updateComponents?.components)) {
    return object.updateComponents.components;
  }
  if (Array.isArray(object.messages)) {
    for (let index = object.messages.length - 1; index >= 0; index -= 1) {
      const message = object.messages[index];
      if (Array.isArray(message?.updateComponents?.components)) {
        return message.updateComponents.components;
      }
    }
  }
  if (Array.isArray(object.ui?.components)) return object.ui.components;
  return null;
}

function resolveComponentName(
  rawName: unknown,
  specs: Map<string, ComponentSpec>,
): string | null {
  if (typeof rawName !== 'string') return null;
  if (specs.has(rawName)) return rawName;
  const alias = COMPONENT_ALIASES[rawName.toLowerCase()];
  if (alias) return alias;
  for (const name of specs.keys()) {
    if (name.toLowerCase() === rawName.toLowerCase()) return name;
  }
  return null;
}

function sanitizeId(rawId: unknown, index: number): string {
  if (typeof rawId !== 'string') return `c${index}`;
  const cleaned = rawId.trim().replace(/[^A-Za-z0-9_-]+/g, '-');
  return cleaned || `c${index}`;
}

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function referencedIds(component: Json): {single: string[]; lists: string[]} {
  const single: string[] = [];
  const lists: string[] = [];
  for (const key of ['child', 'trigger', 'content']) {
    if (typeof component[key] === 'string') single.push(component[key]);
  }
  if (Array.isArray(component.children)) {
    lists.push(...component.children.filter((id) => typeof id === 'string'));
  }
  if (Array.isArray(component.tabs)) {
    for (const tab of component.tabs) {
      if (typeof tab?.child === 'string') lists.push(tab.child);
    }
  }
  return {single, lists};
}

function applyDefaults(component: Json, spec: ComponentSpec, warnings: string[]) {
  const has = (key: string) => component[key] !== undefined;
  const set = (key: string, value: unknown, reason: string) => {
    component[key] = value;
    warnings.push(`${component.id}: 缺少 ${key}，已${reason}`);
  };

  switch (spec.name) {
    case 'Text':
      if (!has('text')) set('text', '', '补为空字符串');
      break;
    case 'Image':
      if (!has('url')) set('url', PLACEHOLDER_IMAGE, '补为占位图');
      break;
    case 'Icon':
      if (!has('name')) set('name', 'star', '补为 star');
      break;
    case 'Video':
    case 'AudioPlayer':
      break;
    case 'Row':
    case 'Column':
    case 'List':
      if (!has('children')) set('children', [], '补为空数组');
      break;
    case 'TextField':
      if (!has('label')) set('label', '输入', '补为“输入”');
      break;
    case 'CheckBox':
      if (!has('label')) set('label', '选项', '补为“选项”');
      if (!has('value')) set('value', {path: '/checked'}, '绑定 /checked');
      break;
    case 'Slider':
      if (!has('value')) set('value', {path: '/value'}, '绑定 /value');
      if (!has('max')) set('max', 100, '补为 100');
      break;
    case 'DateTimeInput':
      if (!has('value')) set('value', {path: '/date'}, '绑定 /date');
      break;
    default:
      break;
  }
}

function checkEnums(
  component: Json,
  spec: ComponentSpec,
  warnings: string[],
) {
  for (const prop of spec.props) {
    if (!prop.enumValues?.length) continue;
    const value = component[prop.name];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !prop.enumValues.includes(value)) {
      const fallback =
        typeof prop.defaultValue === 'string'
          ? prop.defaultValue
          : prop.enumValues[0];
      component[prop.name] = fallback;
      warnings.push(
        `${component.id}: ${prop.name}=${JSON.stringify(value)} 不是合法枚举，已改为 ${fallback}`,
      );
    }
  }
}

function checkAction(component: Json, errors: string[]) {
  if (component.component !== 'Button' && component.component !== 'HmiHotspot') return;
  const action = component.action;
  if (!isObject(action) || !isObject(action.event)) {
    errors.push(`${component.id}: ${component.component}.action 必须是 {"event":{"name":...}}`);
    return;
  }
  if (typeof action.event.name !== 'string' || !action.event.name.trim()) {
    errors.push(`${component.id}: Button.action.event.name 必须是非空字符串`);
  }
  if (action.event.context !== undefined && !isObject(action.event.context)) {
    errors.push(`${component.id}: Button.action.event.context 必须是对象`);
  }
}

/**
 * HMI-specific normalization: asset keys must exist in the shared registry, and
 * every asset/text/hotspot gets absolute coordinates in the 1920x1200 design
 * space (from the Sketch canvasRect, plus its stroke bleed).
 */
function normalizeHmi(component: Json, warnings: string[], errors: string[]) {
  const name = component.component as string;
  if (!name.startsWith('Hmi')) return;

  const variant: '3d' | '2d' = component.variant === '2d' ? '2d' : '3d';
  if (component.variant !== undefined) component.variant = variant;

  if (name === 'HmiScreen') {
    if (!Array.isArray(component.children)) {
      component.children = [];
      warnings.push(`${component.id}: HmiScreen 缺少 children，已补为空数组`);
    }
    return;
  }

  if (name === 'HmiAsset' || name === 'HmiHotspot') {
    const rawAsset = typeof component.asset === 'string' ? component.asset : '';
    if (!rawAsset) {
      if (name === 'HmiAsset') {
        errors.push(`${component.id}: ${name}.asset 必须是素材名`);
        return;
      }
      // 纯几何热区（组装出来的点击区可以不带素材）
      component.variant = variant;
      component.x = Math.round(typeof component.x === 'number' ? component.x : 0);
      component.y = Math.round(typeof component.y === 'number' ? component.y : 0);
      component.width = Math.max(1, Math.round(typeof component.width === 'number' ? component.width : 56));
      component.height = Math.max(1, Math.round(typeof component.height === 'number' ? component.height : 56));
      delete component.anchor;
      return;
    }

    let entry = hmiAsset(rawAsset);
    if (!entry) {
      const resolved = resolveAssetKey(rawAsset, variant);
      if (resolved.key) {
        entry = hmiAsset(resolved.key);
        component.asset = resolved.key;
        warnings.push(`${component.id}: 素材 ${rawAsset} 已映射为 ${resolved.key}`);
      }
    } else {
      component.asset = entry.key;
    }
    if (!entry) {
      errors.push(`${component.id}: 未知素材 ${JSON.stringify(rawAsset)}`);
      return;
    }

    if (name === 'HmiAsset' || name === 'HmiHotspot') component.variant = variant;
    const box = assetBox(entry, {
      x: typeof component.x === 'number' ? component.x : undefined,
      y: typeof component.y === 'number' ? component.y : undefined,
      width: typeof component.width === 'number' ? component.width : undefined,
      height: typeof component.height === 'number' ? component.height : undefined,
    });
    component.x = box.left;
    component.y = box.top;
    component.width = box.width;
    component.height = box.height;
    delete component.anchor;
    return;
  }

  if (name === 'HmiPanel') {
    component.variant = variant;
    component.x = Math.round(typeof component.x === 'number' ? component.x : 0);
    component.y = Math.round(typeof component.y === 'number' ? component.y : 0);
    component.width = Math.max(1, Math.round(typeof component.width === 'number' ? component.width : 320));
    component.height = Math.max(1, Math.round(typeof component.height === 'number' ? component.height : 120));
    if (typeof component.fill !== 'string') component.fill = '#0B1220';
    if (typeof component.radius !== 'number') component.radius = 18;
    if (typeof component.opacity === 'number') {
      component.opacity = Math.min(1, Math.max(0, component.opacity));
    }
    delete component.anchor;
    return;
  }

  if (name === 'HmiText') {
    const text = component.text;
    if (text && typeof text === 'object' && !Array.isArray(text)) {
      // 绑定值 {path: '/nav/road'} 要原样保留，端上才会随数据模型变
      const path = (text as Json).path;
      if (typeof path !== 'string' || !path) {
        errors.push(`${component.id}: HmiText.text 绑定缺少 path`);
        component.text = '';
      } else {
        component.text = {path};
      }
    } else if (typeof text !== 'string') {
      component.text = String(text ?? '');
    }
    if (typeof component.x !== 'number') warnings.push(`${component.id}: HmiText 缺少 x，已按 0 处理`);
    if (typeof component.y !== 'number') warnings.push(`${component.id}: HmiText 缺少 y，已按 0 处理`);
    let originX = typeof component.x === 'number' ? component.x : 0;
    let originY = typeof component.y === 'number' ? component.y : 0;

    const anchor = typeof component.anchor === 'string' ? component.anchor : null;
    if (anchor) {
      const resolved = resolveAssetKey(anchor, variant);
      const entry = resolved.key ? hmiAsset(resolved.key) : undefined;
      if (entry) {
        originX = entry.rect.x + originX;
        originY = entry.rect.y + originY;
      } else if (resolved.warning) {
        warnings.push(`${component.id}: ${resolved.warning}`);
      }
      delete component.anchor;
    }

    component.x = Math.round(originX);
    component.y = Math.round(originY);
    if (typeof component.size !== 'number' || !Number.isFinite(component.size)) {
      component.size = 28;
      warnings.push(`${component.id}: HmiText 缺少 size，已补为 28`);
    }
    if (typeof component.width === 'number') component.width = Math.max(1, Math.round(component.width));
    if (component.font === undefined) component.font = 'cn';
    if (component.align === undefined) component.align = 'left';
    component.variant = variant;
    return;
  }

  component.variant = variant;
}

function findCycles(components: Map<string, Json>): string[] {  const visiting = new Set<string>();
  const done = new Set<string>();
  const cycles: string[] = [];

  const visit = (id: string, trail: string[]) => {
    if (visiting.has(id)) {
      cycles.push([...trail, id].join(' → '));
      return;
    }
    if (done.has(id)) return;
    visiting.add(id);
    const component = components.get(id);
    if (component) {
      const {single, lists} = referencedIds(component);
      for (const childId of [...single, ...lists]) visit(childId, [...trail, id]);
    }
    visiting.delete(id);
    done.add(id);
  };

  for (const id of components.keys()) visit(id, []);
  return cycles;
}

export function normalizeComponents(parsed: unknown): ValidationResult {
  const {specs} = getCatalog();
  const errors: string[] = [];
  const warnings: string[] = [];
  const rawList = asComponentList(parsed);

  if (!rawList) {
    return {
      ok: false,
      components: [],
      errors: ['输出里找不到 components 数组'],
      warnings,
    };
  }
  if (rawList.length === 0) {
    return {ok: false, components: [], errors: ['components 为空'], warnings};
  }
  if (rawList.length > 120) {
    errors.push(`组件过多（${rawList.length}），最多 120 个`);
  }

  const used = new Set<string>();
  const components = new Map<string, Json>();

  rawList.forEach((raw, index) => {
    if (!isObject(raw)) {
      warnings.push(`第 ${index + 1} 项不是对象，已丢弃`);
      return;
    }
    const name = resolveComponentName(raw.component, specs);
    if (!name) {
      errors.push(
        `未知组件 ${JSON.stringify(raw.component)}，只能用：${[...specs.keys()].join(', ')}`,
      );
      return;
    }
    const spec = specs.get(name)!;
    const component: Json = {...raw, component: name};
    component.id = uniqueId(sanitizeId(raw.id, index), used);
    used.add(component.id);

    for (const key of Object.keys(component)) {
      if (!spec.allowedProps.has(key)) {
        delete component[key];
        warnings.push(`${component.id}: 已移除不支持属性 ${key}`);
      }
    }

    applyDefaults(component, spec, warnings);
    checkEnums(component, spec, warnings);
    normalizeHmi(component, warnings, errors);
    for (const required of spec.required) {
      if (component[required] === undefined) {
        errors.push(`${component.id}: ${name} 缺少必填属性 ${required}`);
      }
    }
    checkAction(component, errors);
    components.set(component.id, component);
  });

  if (components.size === 0) {
    return {ok: false, components: [], errors, warnings};
  }

  if (!components.has('root')) {
    const referenced = new Set<string>();
    for (const component of components.values()) {
      const {single, lists} = referencedIds(component);
      [...single, ...lists].forEach(id => referenced.add(id));
    }
    const candidates = [...components.keys()].filter(id => !referenced.has(id));
    if (candidates.length === 1) {
      const [only] = candidates;
      const component = components.get(only)!;
      components.delete(only);
      component.id = 'root';
      components.set('root', component);
      rewire(components, only, 'root');
      warnings.push(`没有 root，已把顶层组件 ${only} 重命名为 root`);
    } else {
      const root: Json = {
        id: 'root',
        component: 'Column',
        children: candidates.length ? candidates : [...components.keys()],
      };
      components.set('root', root);
      warnings.push('没有 root，已自动包一层 Column 作为 root');
    }
  }

  const root = components.get('root')!;
  if (root.component === 'Button' || root.component === 'Text') {
    // A bare leaf root still renders; no special handling required.
  }

  for (const component of components.values()) {
    if (component.id !== 'root') {
      const {single, lists} = referencedIds(component);
      for (const key of ['child', 'trigger', 'content'] as const) {
        if (typeof component[key] === 'string' && !components.has(component[key])) {
          errors.push(`${component.id}: ${key} 指向不存在的组件 ${component[key]}`);
        }
      }
      void single;
      void lists;
      if (Array.isArray(component.children)) {
        const kept = component.children.filter((id: unknown) => {
          if (typeof id !== 'string' || !components.has(id)) {
            warnings.push(
              `${component.id}: children 里的 ${JSON.stringify(id)} 不存在，已移除`,
            );
            return false;
          }
          return true;
        });
        component.children = kept;
      }
      if (Array.isArray(component.tabs)) {
        for (const tab of component.tabs) {
          if (typeof tab?.child === 'string' && !components.has(tab.child)) {
            errors.push(`${component.id}: tab 指向不存在的组件 ${tab.child}`);
          }
        }
      }
    }
  }

  const cycles = findCycles(components);
  for (const cycle of cycles) errors.push(`组件引用成环：${cycle}`);

  const reachable = new Set<string>();
  const queue = ['root'];
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const component = components.get(id);
    if (!component) continue;
    const {single, lists} = referencedIds(component);
    for (const childId of [...single, ...lists]) {
      if (components.has(childId)) queue.push(childId);
    }
  }
  for (const id of [...components.keys()]) {
    if (!reachable.has(id)) {
      components.delete(id);
      warnings.push(`${id}: 从 root 不可达，已移除`);
    }
  }

  return {
    ok: errors.length === 0,
    components: [...components.values()],
    errors,
    warnings,
  };
}

function rewire(
  components: Map<string, Json>,
  from: string,
  to: string,
) {
  for (const component of components.values()) {
    for (const key of ['child', 'trigger', 'content'] as const) {
      if (component[key] === from) component[key] = to;
    }
    if (Array.isArray(component.children)) {
      component.children = component.children.map((id: unknown) =>
        id === from ? to : id,
      );
    }
    if (Array.isArray(component.tabs)) {
      for (const tab of component.tabs) {
        if (tab?.child === from) tab.child = to;
      }
    }
  }
}

export function toMessages(
  components: Record<string, unknown>[],
  surfaceId: string,
): unknown[] {
  const usesHmi = components.some(
    component => typeof component.component === 'string' && component.component.startsWith('Hmi'),
  );
  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId,
        catalogId: usesHmi ? hmiCatalogId() : CATALOG_ID,
        sendDataModel: true,
      },
    },
    {
      version: 'v0.9',
      updateComponents: {surfaceId, components},
    },
  ];
}
