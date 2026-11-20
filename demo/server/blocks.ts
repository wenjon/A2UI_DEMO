import {CATALOG_ID} from './catalog.ts';

export type BlockKind =
  | 'TITLE'
  | 'SUBTITLE'
  | 'TEXT'
  | 'CAPTION'
  | 'IMAGE'
  | 'ICON'
  | 'DIVIDER'
  | 'FIELD'
  | 'CHECK'
  | 'SELECT'
  | 'SLIDER'
  | 'DATE'
  | 'BUTTON';

export type ParsedBlock = {
  kind: BlockKind;
  raw: string;
  text: string;
  args: string[];
};

export type CompileResult = {
  components: Record<string, unknown>[];
  messages: unknown[];
  data: Record<string, unknown>;
  warnings: string[];
};

const ALIASES: Record<string, BlockKind> = {
  HEADING: 'TITLE',
  H1: 'TITLE',
  H2: 'TITLE',
  H3: 'SUBTITLE',
  LABEL: 'TEXT',
  PARAGRAPH: 'TEXT',
  P: 'TEXT',
  DESC: 'CAPTION',
  NOTE: 'CAPTION',
  IMG: 'IMAGE',
  PICTURE: 'IMAGE',
  HR: 'DIVIDER',
  INPUT: 'FIELD',
  TEXTFIELD: 'FIELD',
  TEXT_FIELD: 'FIELD',
  CHECKBOX: 'CHECK',
  TOGGLE: 'CHECK',
  DROPDOWN: 'SELECT',
  PICKER: 'SELECT',
  CHOICE: 'SELECT',
  RANGE: 'SLIDER',
  DATETIME: 'DATE',
  DATEINPUT: 'DATE',
  DATEPICKER: 'DATE',
  BTN: 'BUTTON',
};

const KINDS = new Set<string>([
  'TITLE',
  'SUBTITLE',
  'TEXT',
  'CAPTION',
  'IMAGE',
  'ICON',
  'DIVIDER',
  'FIELD',
  'CHECK',
  'SELECT',
  'SLIDER',
  'DATE',
  'BUTTON',
]);

export const KNOWN_ICONS = [
  'accountCircle',
  'add',
  'arrowBack',
  'arrowForward',
  'calendarToday',
  'call',
  'camera',
  'check',
  'close',
  'delete',
  'download',
  'edit',
  'event',
  'error',
  'favorite',
  'folder',
  'help',
  'home',
  'info',
  'locationOn',
  'lock',
  'mail',
  'menu',
  'moreVert',
  'notifications',
  'payment',
  'person',
  'phone',
  'photo',
  'play',
  'refresh',
  'search',
  'send',
  'settings',
  'share',
  'shoppingCart',
  'star',
  'stop',
  'upload',
  'visibility',
  'warning',
] as const;

const ICON_SET = new Set<string>(KNOWN_ICONS);

function stripNumbering(line: string): string {
  return line.replace(/^(?:[-*•]+\s*|\d+[.)、]\s*)/, '').trim();
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('“') && trimmed.endsWith('”'))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function parseBlocks(text: string): {
  blocks: ParsedBlock[];
  warnings: string[];
} {
  const warnings: string[] = [];
  let body = text.trim();
  const fenced = body.match(/```(?:[a-z]+)?\s*([\s\S]*?)```/i);
  if (fenced) body = fenced[1].trim();

  const blocks: ParsedBlock[] = [];
  body.split(/\r?\n/).forEach((rawLine, index) => {
    let line = stripNumbering(rawLine.trim());
    if (!line || line.startsWith('#') || line.startsWith('```')) return;
    line = line.replace(/^`|`$/g, '').trim();

    const match = line.match(/^([A-Za-z_]+)\b\s*([\s\S]*)$/);
    if (!match) {
      warnings.push(`第 ${index + 1} 行无法识别，已跳过：${line.slice(0, 40)}`);
      return;
    }
    const keyword = match[1].toUpperCase();
    const kind = (KINDS.has(keyword) ? keyword : ALIASES[keyword]) as
      | BlockKind
      | undefined;
    if (!kind) {
      warnings.push(
        `第 ${index + 1} 行使用了未知块 ${match[1]}，已跳过`,
      );
      return;
    }

    const rest = match[2].trim().replace(/\uFF5C/g, '|');
    if (!rest && kind !== 'DIVIDER') {
      warnings.push(`第 ${index + 1} 行 ${kind} 缺少内容，已跳过`);
      return;
    }

    const isTextKind =
      kind === 'TITLE' ||
      kind === 'SUBTITLE' ||
      kind === 'TEXT' ||
      kind === 'CAPTION';
    const args = isTextKind ? [] : rest.split(/\s+/).filter(Boolean);

    if (isTextKind) {
      const content = unquote(rest);
      if (!content) return;
      if (/^[A-Za-z0-9_]{60,}$/.test(content)) {
        warnings.push(`第 ${index + 1} 行疑似乱码长文本，已跳过`);
        return;
      }
    } else if (kind === 'IMAGE') {
      if (!/^(https?:\/\/|data:image\/)/i.test(unquote(rest))) {
        warnings.push(`第 ${index + 1} 行图片地址不是 http(s)，将使用占位图`);
      }
    }

    blocks.push({kind, raw: rawLine.trim(), text: isTextKind ? unquote(rest) : rest, args});
  });

  return {blocks, warnings};
}

function sanitizeKey(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/^\/+/, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `f_${cleaned}` : cleaned;
}

function uniqueKey(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function fieldVariant(value?: string): string {
  const normalized = (value ?? '').toLowerCase();
  if (['password', 'obscured', 'secret'].includes(normalized)) return 'obscured';
  if (['number', 'numeric', 'int'].includes(normalized)) return 'number';
  if (['long', 'longtext', 'textarea', 'multiline', 'text'].includes(normalized)) {
    return 'longText';
  }
  return 'shortText';
}

export function compileBlocks(
  blocks: ParsedBlock[],
  request: string,
  surfaceId: string,
): CompileResult {
  const warnings: string[] = [];
  const components: Record<string, unknown>[] = [];
  const childIds: string[] = [];
  const data: Record<string, unknown> = {};
  const inputKeys: string[] = [];
  const usedKeys = new Set<string>();
  let counter = 0;

  const nextId = (prefix = 'b') => {
    counter += 1;
    return `${prefix}${counter}`;
  };

  const addText = (kind: string, text: string) => {
    if (!text.trim()) return;
    const id = nextId();
    const variant =
      kind === 'TITLE'
        ? 'h2'
        : kind === 'SUBTITLE'
          ? 'h3'
          : kind === 'CAPTION'
            ? 'caption'
            : 'body';
    components.push({id, component: 'Text', text: text.trim(), variant});
    childIds.push(id);
  };

  const addInputKey = (rawKey: string): string => {
    const key = uniqueKey(sanitizeKey(rawKey, `field${counter + 1}`), usedKeys);
    usedKeys.add(key);
    inputKeys.push(key);
    return key;
  };

  for (const block of blocks) {
    const {kind, args} = block;
    if (kind === 'TITLE' || kind === 'SUBTITLE' || kind === 'TEXT' || kind === 'CAPTION') {
      addText(kind, block.text);
      continue;
    }

    if (kind === 'DIVIDER') {
      const id = nextId();
      components.push({id, component: 'Divider'});
      childIds.push(id);
      continue;
    }

    if (kind === 'IMAGE') {
      const id = nextId();
      const rawUrl = unquote(block.text);
      const url = /^(https?:\/\/|data:image\/)/i.test(rawUrl)
        ? rawUrl
        : 'https://picsum.photos/600/400';
      components.push({
        id,
        component: 'Image',
        url,
        fit: 'cover',
        variant: 'mediumFeature',
      });
      childIds.push(id);
      continue;
    }

    if (kind === 'ICON') {
      const id = nextId();
      const rawName = unquote(block.text);
      const name = ICON_SET.has(rawName) ? rawName : 'star';
      if (name !== rawName) {
        warnings.push(`图标 ${rawName} 不在内置列表，已改用 star`);
      }
      components.push({id, component: 'Icon', name});
      childIds.push(id);
      continue;
    }

    if (kind === 'FIELD') {
      const label = unquote(args[0] ?? '输入');
      const key = addInputKey(args[1] ?? label);
      const id = nextId();
      components.push({
        id,
        component: 'TextField',
        label,
        value: {path: `/${key}`},
        variant: fieldVariant(args[2]),
      });
      data[key] = '';
      childIds.push(id);
      continue;
    }

    if (kind === 'CHECK') {
      const label = unquote(args[0] ?? '选项');
      const key = addInputKey(args[1] ?? label);
      const id = nextId();
      components.push({
        id,
        component: 'CheckBox',
        label,
        value: {path: `/${key}`},
      });
      data[key] = false;
      childIds.push(id);
      continue;
    }

    if (kind === 'SELECT') {
      const label = unquote(args[0] ?? '选择');
      let keySource = args[1] ?? label;
      let optionSource = args.slice(2);
      if (keySource.includes('|')) {
        const [keyPart, ...rest] = keySource.split('|');
        keySource = keyPart;
        optionSource = [...rest, ...optionSource];
      }
      let options = optionSource
        .flatMap(item => item.split('|'))
        .map(item => unquote(item).trim())
        .filter(Boolean);
      if (options.length === 0) {
        options = ['选项一', '选项二'];
        warnings.push(`选择框“${label}”没有选项，已补默认选项`);
      }
      const key = addInputKey(keySource);
      const id = nextId();
      components.push({
        id,
        component: 'ChoicePicker',
        label,
        options: options.map(option => ({label: option, value: option})),
        value: {path: `/${key}`},
        variant: 'mutuallyExclusive',
        displayStyle: 'chips',
      });
      data[key] = [options[0]];
      childIds.push(id);
      continue;
    }

    if (kind === 'SLIDER') {
      const label = unquote(args[0] ?? '数值');
      const key = addInputKey(args[1] ?? label);
      const maxRaw = Number(args[2]);
      const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 100;
      if (max !== maxRaw) {
        warnings.push(`滑块“${label}”最大值缺失，已用 100`);
      }
      const id = nextId();
      components.push({
        id,
        component: 'Slider',
        label,
        min: 0,
        max,
        value: {path: `/${key}`},
      });
      data[key] = 0;
      childIds.push(id);
      continue;
    }

    if (kind === 'DATE') {
      const label = unquote(args[0] ?? '日期');
      const key = addInputKey(args[1] ?? label);
      const mode = (args[2] ?? '').toLowerCase();
      const enableTime = mode.includes('time') || /时间|时段/.test(label);
      const enableDate = mode.includes('date') || /日期|时间|时段/.test(label) || !enableTime;
      const id = nextId();
      components.push({
        id,
        component: 'DateTimeInput',
        label,
        value: {path: `/${key}`},
        enableDate,
        enableTime,
      });
      data[key] = '';
      childIds.push(id);
      continue;
    }

    if (kind === 'BUTTON') {
      const label = unquote(args[0] ?? '提交');
      const actionName = (args[1] ?? 'submit').replace(/[^A-Za-z0-9_]+/g, '_') || 'submit';
      const id = nextId();
      const textId = `${id}Label`;
      components.push({
        id: textId,
        component: 'Text',
        text: label,
      });
      components.push({
        id,
        component: 'Button',
        child: textId,
        variant: 'primary',
        action: {
          event: {
            name: actionName,
            context: Object.fromEntries(
              inputKeys.map(key => [key, {path: `/${key}`}]),
            ),
          },
        },
      });
      childIds.push(id);
      continue;
    }
  }

  const useCard = /卡片|卡\b|card/i.test(request);
  if (childIds.length === 0) {
    components.push({
      id: 'b1',
      component: 'Text',
      text: '没有生成任何界面内容。',
      variant: 'body',
    });
    childIds.push('b1');
  }

  const content: Record<string, unknown> = useCard
    ? {id: 'content', component: 'Column', children: childIds}
    : {id: 'root', component: 'Column', children: childIds};
  const root: Record<string, unknown> = useCard
    ? {id: 'root', component: 'Card', child: 'content'}
    : content;

  const ordered = useCard
    ? [root, content, ...components]
    : [root, ...components];

  const messages: unknown[] = [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId,
        catalogId: CATALOG_ID,
        sendDataModel: true,
      },
    },
    {
      version: 'v0.9',
      updateComponents: {surfaceId, components: ordered},
    },
  ];
  if (Object.keys(data).length) {
    messages.push({
      version: 'v0.9',
      updateDataModel: {surfaceId, value: data},
    });
  }

  return {components: ordered, messages, data, warnings};
}
