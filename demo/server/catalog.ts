import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hmiComponentSpecs} from './hmi-registry.ts';

export const CATALOG_ID =
  'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

type JsonSchema = {
  type?: string;
  $ref?: string;
  enum?: string[];
  default?: unknown;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  items?: JsonSchema;
};

export type PropSpec = {
  name: string;
  type: string;
  required: boolean;
  enumValues?: string[];
  defaultValue?: unknown;
};

export type ComponentSpec = {
  name: string;
  purpose: string;
  props: PropSpec[];
  required: string[];
  allowedProps: Set<string>;
};

const here = path.dirname(fileURLToPath(import.meta.url));
export const catalogPath =
  process.env.A2UI_CATALOG_PATH ??
  path.resolve(here, '../../a2ui/specification/v0_9/catalogs/basic/catalog.json');

const purpose: Record<string, string> = {
  Text: '显示文字、标题、说明',
  Image: '显示图片',
  Icon: '显示内置图标',
  Video: '播放视频',
  AudioPlayer: '播放音频',
  Row: '横向排列子组件',
  Column: '纵向排列子组件',
  List: '列表容器（可横向/纵向）',
  Card: '卡片容器，包住一个子组件',
  Tabs: '标签页，每页一个子组件',
  Modal: '弹窗，由 trigger 触发显示 content',
  Divider: '分隔线',
  Button: '按钮，必须绑定一个文字子组件和一个 action',
  TextField: '文本输入框',
  CheckBox: '复选框',
  ChoicePicker: '单选/多选选择器',
  Slider: '数值滑块',
  DateTimeInput: '日期/时间输入',
};

const commonProps = new Set(['id', 'component', 'weight', 'accessibility']);

function typeLabel(schema: JsonSchema): string {
  if (schema.enum) return 'enum';
  if (schema.$ref) return schema.$ref.split('/').pop() ?? 'ref';
  if (schema.type === 'array') {
    const inner = schema.items?.$ref?.split('/').pop() ?? schema.items?.type;
    return inner ? `array<${inner}>` : 'array';
  }
  return schema.type ?? 'any';
}

export function loadComponentSpecs(
  file = catalogPath,
): Map<string, ComponentSpec> {
  const catalog = JSON.parse(readFileSync(file, 'utf8')) as {
    components: Record<string, JsonSchema>;
  };
  const specs = new Map<string, ComponentSpec>();

  for (const [name, definition] of Object.entries(catalog.components)) {
    const properties: Record<string, JsonSchema> = {};
    const required = new Set<string>();

    for (const part of definition.allOf ?? [definition]) {
      Object.assign(properties, part.properties ?? {});
      for (const key of part.required ?? []) required.add(key);
    }

    const props: PropSpec[] = [];
    for (const [propName, schema] of Object.entries(properties)) {
      if (propName === 'id' || propName === 'component') continue;
      props.push({
        name: propName,
        type: typeLabel(schema),
        required: required.has(propName),
        enumValues: schema.enum,
        defaultValue: schema.default,
      });
    }

    specs.set(name, {
      name,
      purpose: purpose[name] ?? '',
      props,
      required: [...required].filter(key => key !== 'component'),
      allowedProps: new Set([...Object.keys(properties), ...commonProps]),
    });
  }

  return specs;
}

export function renderCatalogText(specs: Map<string, ComponentSpec>): string {
  const lines: string[] = [];
  for (const spec of specs.values()) {
    const props = spec.props
      .map(prop => {
        const requiredMark = prop.required ? '*' : '';
        const values = prop.enumValues
          ? ` [${prop.enumValues.join('|')}]`
          : '';
        const fallback =
          prop.defaultValue === undefined
            ? ''
            : ` =${JSON.stringify(prop.defaultValue)}`;
        return `${prop.name}${requiredMark}:${prop.type}${values}${fallback}`;
      })
      .join(', ');
    lines.push(`${spec.name}（${spec.purpose}）: ${props}`);
  }

  lines.push(
    '',
    '嵌套结构：',
    '- Tabs.tabs: [{"title":"页签", "child":"组件id"}]（至少一项）',
    '- ChoicePicker.options: [{"label":"选项", "value":"值"}]（至少一项）',
    '- Icon.name: 内置图标名，如 home, search, star, favorite, settings, person, mail, check, close, add, delete, shoppingCart, notifications',
    '- Button.action: {"event":{"name":"动作名","context":{"字段":"值或输入路径"}}}',
    '- 输入值用 {"path":"/字段名"}；例如 TextField.value、CheckBox.value、ChoicePicker.value',
  );
  return lines.join('\n');
}

let cached: {text: string; specs: Map<string, ComponentSpec>} | null = null;

export function getCatalog() {
  if (!cached) {
    const specs = loadComponentSpecs();
    // The HMI catalog extends the basic one: same surface vocabulary, plus the
    // car-screen components registered in demo/src/hmi/hmi-catalog.tsx.
    for (const [name, entry] of hmiComponentSpecs()) specs.set(name, entry);
    cached = {specs, text: renderCatalogText(specs)};
  }
  return cached;
}
