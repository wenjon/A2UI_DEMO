(function () {
'use strict';

var CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
var HMI_CATALOG = 'https://luckplusone.cfifa.com/a2ui/hmi/catalog.json';
var OPERATIONS = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'];
var ALLOWED = ['Text', 'Column', 'Row', 'Card', 'Button', 'TextField', 'CheckBox', 'Slider', 'Divider', 'Image', 'Icon', 'List'];
var HMI_ALLOWED = ['HmiScreen', 'HmiAsset', 'HmiText', 'HmiHotspot', 'HmiPanel', 'HmiSpeedometer', 'HmiStatusBar',
  'HmiNavInstruction', 'HmiRouteInfo', 'HmiMapButtons', 'HmiZoomControl', 'HmiRouteProgress', 'HmiControlBar'];
var HMI_SLOT_NAMES = {
  status: '状态栏', hud: 'HUD 卡片', gauge: '时速表', buttons: '地图按钮', dash: '车控栏',
  nav: '导航指引', route: '路线信息', zoom: '缩放控件', progress: '路线进度'
};
var TEXT_VARIANTS = ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'];
var BUTTON_VARIANTS = ['primary', 'default', 'borderless'];
var FLEX_ROW = ['Card', 'Column', 'List', 'Box'];
var ICONS = {
  favorite: '♥', favoriteOff: '♡', add: '＋', close: '✕', check: '✓', delete: '🗑',
  edit: '✎', download: '⬇', arrowBack: '←', arrowForward: '→', search: '🔍',
  calendarToday: '📅', call: '☎', camera: '📷', folder: '📁', help: '?',
  error: '!', info: 'i', star: '★'
};

function $(id) { return document.getElementById(id); }

var ui = {
  pillService: $('pillService'), pillModel: $('pillModel'), pillClients: $('pillClients'), pillPush: $('pillPush'),
  copySseTop: $('copySseTop'), openHelp: $('openHelp'),
  prompt: $('prompt'), promptCount: $('promptCount'), modeAi: $('modeAi'), modeLocal: $('modeLocal'),
  surfaceBasic: $('surfaceBasic'), surfaceHmi: $('surfaceHmi'), surfaceHint: $('surfaceHint'),
  chips: $('chips'), chipsHmi: $('chipsHmi'),
  hmiBar: $('hmiBar'), hmiArch: $('hmiArch'), hmiSlots: $('hmiSlots'), hmiNote: $('hmiNote'),
  editorKind: $('editorKind'), pushNote: $('pushNote'), hmiViewerRow: $('hmiViewerRow'),
  stageTitle: $('stageTitle'), stageNote: $('stageNote'), hmiBadge: $('hmiBadge'),
  phoneFrame: $('phoneFrame'), phoneTitle: $('phoneTitle'), phoneSub: $('phoneSub'),
  generate: $('generate'), generateIcon: $('generateIcon'), generateLabel: $('generateLabel'),
  genStatus: $('genStatus'), genText: $('genText'), genTimer: $('genTimer'),
  resultCard: $('resultCard'), resultTitle: $('resultTitle'), resultProvider: $('resultProvider'),
  resultSummary: $('resultSummary'), resultMs: $('resultMs'), resultCount: $('resultCount'), resultWarnings: $('resultWarnings'),
  historyList: $('historyList'), clearHistory: $('clearHistory'),
  phoneTime: $('phoneTime'), phoneLive: $('phoneLive'), surface: $('surface'),
  statMessages: $('statMessages'), statComponents: $('statComponents'), statErrorsWrap: $('statErrorsWrap'),
  statErrors: $('statErrors'), statClients: $('statClients'),
  lastAction: $('lastAction'), lastActionName: $('lastActionName'), lastActionContext: $('lastActionContext'),
  copyJson: $('copyJson'), downloadJson: $('downloadJson'),
  editorShell: $('editorShell'), gutter: $('gutter'), editor: $('editor'), editorCount: $('editorCount'),
  valState: $('valState'), valCount: $('valCount'), valToggle: $('valToggle'), valList: $('valList'),
  pushClients: $('pushClients'), pushTitle: $('pushTitle'), pushDelay: $('pushDelay'), push: $('push'),
  pushCount: $('pushCount'), sseUrl: $('sseUrl'), copySse: $('copySse'),
  toastHost: $('toastHost'), helpModal: $('helpModal')
};

var state = {
  messages: [],
  scene: null,
  parseError: null,
  validation: null,
  clients: 0,
  mode: 'ai',
  surfaceKind: 'basic',
  hmi: null,
  generating: false,
  history: [],
  valExpanded: false,
  statusWarned: false,
  statusBusy: false,
  validateSeq: 0,
  parseTimer: null,
  validateTimer: null,
  demoLoaded: false,
  lastPushLocal: null
};

function isObj(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function clone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function make(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function clearNode(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
}

function setPill(element, tone, value) {
  if (!element) return;
  element.classList.remove('ok', 'warn', 'bad');
  if (tone) element.classList.add(tone);
  var valueNode = element.querySelector('.value');
  if (valueNode) valueNode.textContent = value;
}

function updatePhoneTime() {
  var text = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (ui.phoneTime) ui.phoneTime.textContent = text;
}

function updatePromptCount() {
  if (ui.promptCount) ui.promptCount.textContent = ui.prompt.value.length + ' / 4000';
}

function setClients(count) {
  var n = Number(count);
  if (!isFinite(n) || n < 0) n = 0;
  state.clients = n;
  if (ui.statClients) ui.statClients.textContent = String(n);
  if (ui.pushClients) {
    ui.pushClients.className = 'clients ' + (n > 0 ? 'on' : 'off');
    ui.pushClients.textContent = n > 0 ? n + ' 台在线' : '0 台 · 先连接 App';
  }
  if (ui.phoneLive) {
    ui.phoneLive.className = 'live-chip' + (n > 0 ? ' active' : '');
    ui.phoneLive.replaceChildren(make('i'), document.createTextNode(n > 0 ? 'LIVE' : 'PREVIEW'));
  }
}

function toast(kind, text, sub) {
  if (!ui.toastHost) return;
  while (ui.toastHost.children.length >= 3) {
    ui.toastHost.removeChild(ui.toastHost.firstChild);
  }
  var item = make('div', 'toast ' + kind);
  var mark = kind === 'success' ? '✓' : kind === 'warn' ? '!' : kind === 'error' ? '✕' : 'i';
  item.appendChild(make('div', 'ico', mark));
  var body = make('div');
  var txt = make('div', 'txt', text);
  if (sub) txt.appendChild(make('span', 'sub', sub));
  body.appendChild(txt);
  item.appendChild(body);
  ui.toastHost.appendChild(item);
  var life = kind === 'error' ? 5200 : 3800;
  setTimeout(function () {
    item.classList.add('out');
    setTimeout(function () {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, 240);
  }, life);
}

function copyText(text, label) {
  text = String(text || '');
  if (!text) {
    toast('warn', '没有可复制的内容');
    return;
  }
  var done = function () {
    var preview = text.length > 120 ? text.slice(0, 116) + '…' : text;
    toast('success', label || '已复制', preview);
  };
  var fallback = function () {
    var area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    area.style.top = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
    document.body.removeChild(area);
    if (ok) done();
    else toast('error', '复制失败', '浏览器拒绝了剪贴板操作');
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else {
    fallback();
  }
}

function pointerTokens(path) {
  var raw = String(path === undefined || path === null ? '' : path).trim();
  if (!raw || raw === '/') return [];
  return raw.split('/').filter(function (part) { return part.length > 0; }).map(function (part) {
    return part.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

function readPath(path, data) {
  var tokens = pointerTokens(path);
  var current = data;
  for (var index = 0; index < tokens.length; index += 1) {
    var token = tokens[index];
    if (isObj(current)) {
      if (!hasOwn(current, token)) return null;
      current = current[token];
    } else if (Array.isArray(current)) {
      if (!/^\d+$/.test(token)) return null;
      var arrayIndex = parseInt(token, 10);
      if (arrayIndex < 0 || arrayIndex >= current.length) return null;
      current = current[arrayIndex];
    } else {
      return null;
    }
  }
  return current === undefined ? null : current;
}

function pathLookup(path, data, root) {
  var local = readPath(path, data);
  if (local !== null && local !== undefined) return local;
  if (data !== root) return readPath(path, root);
  return null;
}

function setPathData(root, path, value) {
  var tokens = pointerTokens(path);
  if (!tokens.length) return;
  var current = root;
  for (var index = 0; index < tokens.length - 1; index += 1) {
    var token = tokens[index];
    if (Array.isArray(current) && /^\d+$/.test(token)) {
      var at = parseInt(token, 10);
      if (!isObj(current[at]) && !Array.isArray(current[at])) current[at] = {};
      current = current[at];
    } else if (isObj(current)) {
      if (!isObj(current[token]) && !Array.isArray(current[token])) current[token] = {};
      current = current[token];
    } else {
      return;
    }
  }
  var leaf = tokens[tokens.length - 1];
  if (value === undefined || value === null) {
    if (Array.isArray(current) && /^\d+$/.test(leaf)) current.splice(parseInt(leaf, 10), 1);
    else if (isObj(current)) delete current[leaf];
  } else {
    var next = isObj(value) || Array.isArray(value) ? clone(value) : value;
    if (Array.isArray(current) && /^\d+$/.test(leaf)) current[parseInt(leaf, 10)] = next;
    else if (isObj(current)) current[leaf] = next;
  }
}

function removePathData(root, path) {
  var tokens = pointerTokens(path);
  if (!tokens.length) return;
  var current = root;
  for (var index = 0; index < tokens.length - 1; index += 1) {
    var token = tokens[index];
    if (isObj(current)) {
      if (!hasOwn(current, token)) return;
      current = current[token];
    } else if (Array.isArray(current) && /^\d+$/.test(token)) {
      current = current[parseInt(token, 10)];
    } else {
      return;
    }
  }
  var leaf = tokens[tokens.length - 1];
  if (Array.isArray(current) && /^\d+$/.test(leaf)) current.splice(parseInt(leaf, 10), 1);
  else if (isObj(current)) delete current[leaf];
}

function formatNumber(value) {
  var number = Number(value);
  if (!isFinite(number)) return '';
  if (number === Math.trunc(number)) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(number);
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(number);
}

function formatCurrency(value, currency) {
  var number = Number(value);
  if (!isFinite(number)) return '';
  var code = String(currency || 'CNY').toUpperCase();
  var amount = number.toFixed(2);
  if (code === 'CNY' || code === 'RMB') return '¥' + amount;
  if (code === 'USD') return '$' + amount;
  if (code === 'EUR') return '€' + amount;
  return code + ' ' + amount;
}

function evalCall(call, data, root) {
  var name = call.call;
  var args = isObj(call.args) ? call.args : {};
  if (name === 'formatCurrency') {
    var amount = dynNumber(args.value, data, root);
    if (amount === null) return '';
    return formatCurrency(amount, dynString(args.currency, data, root) || 'CNY');
  }
  if (name === 'formatNumber') {
    var number = dynNumber(args.value, data, root);
    return number === null ? '' : formatNumber(number);
  }
  if (name === 'pluralize') {
    var count = dynNumber(args.value, data, root);
    if (count === null) return '';
    return count === 1 ? dynString(args.one, data, root) : dynString(args.other, data, root);
  }
  if (name === 'formatString') {
    var template = dynString(args.value, data, root);
    return template.replace(/\$\s*\{(\/[^}]*)\}/g, function (match, path) {
      return dynString({ path: path }, data, root);
    });
  }
  return '';
}

function resolveValue(value, data, root) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map(function (item) { return resolveValue(item, data, root); });
  }
  if (isObj(value)) {
    var keys = Object.keys(value);
    if (hasOwn(value, 'path') && keys.length <= 2) {
      return pathLookup(value.path, data, root);
    }
    if (typeof value.call === 'string') {
      return evalCall(value, data, root);
    }
    var object = {};
    keys.forEach(function (key) {
      object[key] = resolveValue(value[key], data, root);
    });
    return object;
  }
  return value;
}
function interpolateString(text, data, root) {
  if (typeof text !== 'string' || text.indexOf('$') < 0) return text;
  return text.replace(/\$\s*\{(\/[^}]*)\}/g, function (match, path) {
    var value = pathLookup(path, data, root);
    if (value === null || value === undefined) return match;
    if (typeof value === 'number') return isFinite(value) ? formatNumber(value) : '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (isObj(value)) { try { return JSON.stringify(value); } catch (error) { return String(value); } }
    return String(value);
  });
}

function dynString(value, data, root) {
  var resolved = resolveValue(value, data, root);
  if (resolved === null || resolved === undefined) return '';
  if (typeof resolved === 'string') return interpolateString(resolved, data, root);
  if (typeof resolved === 'number') return isFinite(resolved) ? formatNumber(resolved) : '';
  if (typeof resolved === 'boolean') return resolved ? 'true' : 'false';
  try { return JSON.stringify(resolved); } catch (error) { return String(resolved); }
}
function dynNumber(value, data, root) {
  var resolved = resolveValue(value, data, root);
  if (typeof resolved === 'number' && isFinite(resolved)) return resolved;
  if (typeof resolved === 'string' && resolved.trim() !== '') {
    var parsed = Number(resolved);
    return isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dynBool(value, data, root) {
  var resolved = resolveValue(value, data, root);
  if (typeof resolved === 'boolean') return resolved;
  if (typeof resolved === 'string') {
    if (resolved === 'true') return true;
    if (resolved === 'false') return false;
  }
  return null;
}

function resolveContext(context, data, root) {
  var out = {};
  if (!isObj(context)) return out;
  Object.keys(context).forEach(function (key) {
    out[key] = resolveValue(context[key], data, root);
  });
  return out;
}

function newSurface(id, catalogId) {
  return { id: id, catalogId: catalogId || '', components: {}, data: {} };
}

function computeScene(messages) {
  var surfaces = new Map();
  if (!Array.isArray(messages)) return null;
  messages.forEach(function (message) {
    if (!isObj(message)) return;
    if (isObj(message.createSurface)) {
      var id = String(message.createSurface.surfaceId || '');
      if (id) surfaces.set(id, newSurface(id, message.createSurface.catalogId));
      return;
    }
    if (isObj(message.updateComponents)) {
      var update = message.updateComponents;
      var surfaceId = String(update.surfaceId || '');
      if (!surfaceId) return;
      var surface = surfaces.get(surfaceId);
      if (!surface) {
        surface = newSurface(surfaceId, '');
        surfaces.set(surfaceId, surface);
      }
      if (Array.isArray(update.components)) {
        update.components.forEach(function (component) {
          if (isObj(component) && typeof component.id === 'string') {
            surface.components[component.id] = component;
          }
        });
      }
      return;
    }
    if (isObj(message.updateDataModel)) {
      var dataUpdate = message.updateDataModel;
      var dataSurfaceId = String(dataUpdate.surfaceId || '');
      if (!dataSurfaceId) return;
      var dataSurface = surfaces.get(dataSurfaceId);
      if (!dataSurface) {
        dataSurface = newSurface(dataSurfaceId, '');
        surfaces.set(dataSurfaceId, dataSurface);
      }
      var path = hasOwn(dataUpdate, 'path') ? dataUpdate.path : '/';
      var value = hasOwn(dataUpdate, 'value') ? dataUpdate.value : null;
      if (!path || pointerTokens(path).length === 0) {
        dataSurface.data = isObj(value) ? clone(value) : {};
      } else if (value === null || value === undefined) {
        removePathData(dataSurface.data, path);
      } else {
        setPathData(dataSurface.data, path, value);
      }
      return;
    }
    if (isObj(message.deleteSurface)) {
      surfaces.delete(String(message.deleteSurface.surfaceId || ''));
    }
  });
  var list = [];
  surfaces.forEach(function (surface) { list.push(surface); });
  if (!list.length) return null;
  for (var index = list.length - 1; index >= 0; index -= 1) {
    if (list[index].components.root) return list[index];
  }
  return list[list.length - 1];
}

function detectKind(messages) {
  if (!Array.isArray(messages)) return 'basic';
  for (var i = 0; i < messages.length; i += 1) {
    var message = messages[i];
    if (!isObj(message)) continue;
    for (var o = 0; o < OPERATIONS.length; o += 1) {
      var body = message[OPERATIONS[o]];
      if (!isObj(body)) continue;
      if (String(body.catalogId || '').toLowerCase().indexOf('hmi') >= 0) return 'hmi';
      if (Array.isArray(body.components)) {
        for (var c = 0; c < body.components.length; c += 1) {
          var item = body.components[c];
          if (isObj(item) && String(item.component || '').indexOf('Hmi') === 0) return 'hmi';
        }
      }
    }
  }
  return 'basic';
}

function quickValidate(messages) {
  var errors = [];
  var warnings = [];
  var kind = detectKind(messages);
  var allowed = kind === 'hmi' ? HMI_ALLOWED : ALLOWED;
  var catalog = kind === 'hmi' ? HMI_CATALOG : CATALOG;
  if (!Array.isArray(messages) || !messages.length) {
    return { errors: ['messages 必须是非空数组'], warnings: warnings };
  }
  var created = {};
  var surfaces = {};
  var components = {};
  messages.forEach(function (message, index) {
    var label = '第 ' + (index + 1) + ' 条消息';
    if (!isObj(message)) {
      errors.push(label + ' 不是 JSON 对象');
      return;
    }
    if (message.version !== 'v0.9') errors.push(label + ' 的 version 必须是 "v0.9"');
    var ops = OPERATIONS.filter(function (op) { return hasOwn(message, op); });
    if (ops.length !== 1) {
      errors.push(label + ' 必须且只能包含一个操作，当前为 ' + (ops.join(', ') || '无'));
      if (!ops.length) return;
    }
    var op = ops[0];
    var body = message[op];
    if (!isObj(body)) {
      errors.push(label + ' 的 ' + op + ' 必须是对象');
      return;
    }
    var surfaceId = typeof body.surfaceId === 'string' ? body.surfaceId.trim() : '';
    if (!surfaceId) {
      errors.push(label + ' 缺少 surfaceId');
    } else {
      surfaces[surfaceId] = true;
    }
    if (op === 'createSurface') {
      if (index !== 0) errors.push('createSurface 必须是第一条消息');
      if (created[surfaceId]) errors.push('重复的 createSurface: ' + surfaceId);
      created[surfaceId] = true;
      if (body.catalogId !== catalog) errors.push('catalogId 必须为 ' + catalog);
      return;
    }
    if (op === 'updateComponents') {
      if (!created[surfaceId]) errors.push(label + ' 在 createSurface 之前更新了组件');
      if (!Array.isArray(body.components) || !body.components.length) {
        errors.push(label + ' 的 components 必须是非空数组');
        return;
      }
      var seen = {};
      body.components.forEach(function (item, itemIndex) {
        var where = label + ' 第 ' + (itemIndex + 1) + ' 个组件';
        if (!isObj(item)) {
          errors.push(where + ' 不是对象');
          return;
        }
        if (typeof item.id !== 'string' || !item.id.trim()) {
          errors.push(where + ' 缺少 id');
          return;
        }
        if (seen[item.id]) errors.push(label + ' 内组件 id 重复: ' + item.id);
        seen[item.id] = true;
        if (allowed.indexOf(item.component) < 0) {
          errors.push(where + ' 使用了不支持的组件: ' + String(item.component || '无')
            + (kind === 'hmi' ? '（车机场景请用 HMI catalog）' : ''));
        }
        components[item.id] = item;
      });
      return;
    }
    if (op === 'updateDataModel') {
      if (!created[surfaceId]) errors.push(label + ' 在 createSurface 之前更新了数据');
      if (hasOwn(body, 'path') && (typeof body.path !== 'string' || (body.path !== '/' && body.path.charAt(0) !== '/'))) {
        errors.push(label + ' 的 path 必须是 JSON Pointer（以 / 开头）');
      }
      if (!hasOwn(body, 'value')) warnings.push(label + ' 没有 value，将被视为删除该路径');
      return;
    }
    if (op === 'deleteSurface') created[surfaceId] = false;
  });
  if (Object.keys(surfaces).length > 1) {
    errors.push('一次只能生成一个 surface，当前为: ' + Object.keys(surfaces).sort().join(', '));
  }
  if (!components.root) {
    errors.push('最终组件树缺少 id="root" 的根组件');
  } else {
    var visited = {};
    var missing = {};
    var stack = ['root'];
    while (stack.length) {
      var id = stack.pop();
      if (visited[id]) continue;
      visited[id] = true;
      var node = components[id];
      if (!node) { missing[id] = true; continue; }
      if (Array.isArray(node.children)) {
        node.children.forEach(function (ref) {
          if (typeof ref === 'string') stack.push(ref);
        });
      } else if (isObj(node.children) && typeof node.children.componentId === 'string') {
        stack.push(node.children.componentId);
      }
      if (node.component === 'List' && typeof node.componentId === 'string') stack.push(node.componentId);
      if (typeof node.child === 'string') stack.push(node.child);
    }
    var missingIds = Object.keys(missing);
    if (missingIds.length) errors.push('引用了不存在的组件 id: ' + missingIds.sort().join(', '));
    var unreachable = Object.keys(components).filter(function (id) { return !visited[id]; }).sort();
    if (unreachable.length) warnings.push('存在未被 root 引用的组件: ' + unreachable.join(', '));
  }
  if (kind !== 'hmi' && messages.length < 4) warnings.push('消息条数偏少（' + messages.length + ' 条），流式效果不明显');
  if (kind !== 'hmi' && messages.length > 14) warnings.push('消息条数偏多（' + messages.length + ' 条）');
  return { errors: errors, warnings: warnings };
}

function bindingPath(value) {
  return isObj(value) && typeof value.path === 'string' && value.path.trim() ? value.path : null;
}

function childrenRefs(component, scene, data, rootData) {
  var refs = [];
  if (!isObj(component)) return refs;
  if (Array.isArray(component.children)) {
    component.children.forEach(function (id) {
      var child = scene.components[id];
      if (child) refs.push({ node: child, data: data });
    });
    return refs;
  }
  var templateRef = isObj(component.children) ? component.children : null;
  if (!templateRef && component.component === 'List' && typeof component.componentId === 'string') {
    templateRef = { componentId: component.componentId, path: component.path };
  }
  if (templateRef && typeof templateRef.componentId === 'string') {
    var template = scene.components[templateRef.componentId];
    if (!template) return refs;
    var list = readPath(templateRef.path, data);
    if (list === null && data !== rootData) list = readPath(templateRef.path, rootData);
    if (!Array.isArray(list)) return refs;
    list.forEach(function (item) {
      refs.push({ node: template, data: item });
    });
    return refs;
  }
  if (typeof component.child === 'string') {
    var single = scene.components[component.child];
    if (single) refs.push({ node: single, data: data });
  }
  return refs;
}

function justifyClass(value) {
  var allowed = ['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly'];
  return 'justify-' + (allowed.indexOf(value) >= 0 ? value : 'start');
}

function alignClass(value, axis) {
  var allowed = axis === 'column' ? ['start', 'center', 'end'] : ['start', 'center', 'end'];
  if (allowed.indexOf(value) < 0) return '';
  return 'align-' + value;
}

function unknownNode(component) {
  return make('div', 'a2-unknown', '未实现的组件：' + String(component && component.component ? component.component : '?'));
}

function renderText(component, data, rootData) {
  var variant = TEXT_VARIANTS.indexOf(component.variant) >= 0 ? component.variant : 'body';
  return make('div', 'a2-text v-' + variant, dynString(component.text, data, rootData));
}

function renderColumn(component, data, rootData, scene, stack) {
  var classes = ['a2-column', justifyClass(component.justify)];
  var align = alignClass(component.align, 'column');
  if (align) classes.push(align);
  var node = make('div', classes.join(' '));
  childrenRefs(component, scene, data, rootData).forEach(function (ref) {
    node.appendChild(renderNode(ref.node, ref.data, rootData, scene, stack));
  });
  return node;
}

function renderRow(component, data, rootData, scene, stack) {
  var classes = ['a2-row', justifyClass(component.justify)];
  var align = alignClass(component.align, 'row');
  if (align) classes.push(align);
  var node = make('div', classes.join(' '));
  childrenRefs(component, scene, data, rootData).forEach(function (ref) {
    var childNode = renderNode(ref.node, ref.data, rootData, scene, stack);
    if (FLEX_ROW.indexOf(ref.node.component) >= 0) childNode.classList.add('a2-flex');
    node.appendChild(childNode);
  });
  return node;
}

function renderCard(component, data, rootData, scene, stack) {
  var node = make('div', 'a2-card');
  var refs = childrenRefs(component, scene, data, rootData);
  refs.forEach(function (ref) {
    node.appendChild(renderNode(ref.node, ref.data, rootData, scene, stack));
  });
  return node;
}

function renderButton(component, data, rootData, scene, stack) {
  var variant = BUTTON_VARIANTS.indexOf(component.variant) >= 0 ? component.variant : 'default';
  var button = make('button', 'a2-button ' + variant);
  button.type = 'button';
  var enabled = dynBool(component.enabled, data, rootData);
  if (enabled === false) button.disabled = true;
  var refs = childrenRefs(component, scene, data, rootData);
  if (refs.length) {
    refs.forEach(function (ref) {
      button.appendChild(renderNode(ref.node, ref.data, rootData, scene, stack));
    });
  } else {
    button.textContent = dynString(component.label, data, rootData) || '按钮';
  }
  button.addEventListener('click', function () {
    handleAction(component.action, data, rootData);
  });
  return button;
}

function renderTextField(component, data, rootData, scene) {
  var variant = component.variant || 'shortText';
  var node = make('div', 'a2-field');
  var label = dynString(component.label, data, rootData);
  if (label) node.appendChild(make('label', null, label));
  var input = make(variant === 'longText' ? 'textarea' : 'input');
  if (variant === 'longText') {
    input.rows = 3;
  } else {
    input.type = variant === 'obscured' ? 'password' : variant === 'number' ? 'number' : 'text';
  }
  input.value = dynString(component.value, data, rootData);
  var placeholder = dynString(component.placeholder, data, rootData);
  if (placeholder) input.placeholder = placeholder;
  var path = bindingPath(component.value);
  input.addEventListener('input', function () {
    if (path) setPathData(scene.data, path, input.value);
  });
  node.appendChild(input);
  return node;
}

function renderCheckBox(component, data, rootData, scene) {
  var node = make('div', 'a2-check');
  node.setAttribute('role', 'checkbox');
  node.setAttribute('tabindex', '0');
  node.appendChild(make('div', 'box', '✓'));
  node.appendChild(make('div', 'label', dynString(component.label, data, rootData)));
  var checked = dynBool(component.value, data, rootData) === true;
  var path = bindingPath(component.value);
  function apply() { node.setAttribute('aria-checked', checked ? 'true' : 'false'); }
  function toggle() {
    checked = !checked;
    apply();
    if (path) setPathData(scene.data, path, checked);
  }
  apply();
  node.addEventListener('click', toggle);
  node.addEventListener('keydown', function (event) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      toggle();
    }
  });
  return node;
}

function renderSlider(component, data, rootData, scene) {
  var node = make('div', 'a2-slider');
  var head = make('div', 'a2-slider-head');
  head.appendChild(make('span', null, dynString(component.label, data, rootData)));
  var output = make('b');
  head.appendChild(output);
  var min = dynNumber(component.min, data, rootData);
  var max = dynNumber(component.max, data, rootData);
  min = min === null ? 0 : min;
  max = max === null ? 1 : max;
  if (max <= min) max = min + 0.0001;
  var current = dynNumber(component.value, data, rootData);
  current = current === null ? min : Math.min(max, Math.max(min, current));
  var input = make('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = component.step !== undefined ? String(component.step) : 'any';
  input.value = String(current);
  output.textContent = formatNumber(current);
  var path = bindingPath(component.value);
  input.addEventListener('input', function () {
    var next = Number(input.value);
    output.textContent = formatNumber(next);
    if (path) setPathData(scene.data, path, next);
  });
  node.appendChild(head);
  node.appendChild(input);
  return node;
}

function renderDivider(component) {
  return make('div', 'a2-divider' + (component.axis === 'vertical' ? ' vertical' : ''));
}

function renderImage(component, data, rootData) {
  var node = make('div', 'a2-image');
  var glyph = make('div', 'emoji');
  glyph.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true" focusable="false"><rect x="3" y="4.5" width="18" height="15" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8.6" cy="9.8" r="1.5" fill="currentColor"/><path d="M4.8 17.2l4.6-4.6 3.6 3.6 2.9-2.9 3.1 3.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  node.appendChild(glyph);
  var description = dynString(component.description, data, rootData) || '图片';
  node.appendChild(make('div', 'desc', description));
  if (dynString(component.url, data, rootData)) node.appendChild(make('div', 'note', '网络图片占位'));
  return node;
}

function renderIcon(component) {
  var name = String(component.name || '');
  return make('div', 'a2-icon', ICONS[name] || '●');
}

function renderList(component, data, rootData, scene, stack) {
  var node = make('div', 'a2-list' + (component.direction === 'horizontal' ? ' horizontal' : ''));
  childrenRefs(component, scene, data, rootData).forEach(function (ref) {
    node.appendChild(renderNode(ref.node, ref.data, rootData, scene, stack));
  });
  return node;
}

function renderNode(component, data, rootData, scene, stack) {
  if (!isObj(component) || typeof component.component !== 'string') return unknownNode(component);
  var id = typeof component.id === 'string' ? component.id : '?';
  if (stack.indexOf(id) >= 0) return make('div', 'a2-unknown', '检测到循环引用：' + id);
  var nextStack = stack.concat([id]);
  switch (component.component) {
    case 'Text': return renderText(component, data, rootData);
    case 'Column': return renderColumn(component, data, rootData, scene, nextStack);
    case 'Row': return renderRow(component, data, rootData, scene, nextStack);
    case 'Card': return renderCard(component, data, rootData, scene, nextStack);
    case 'Button': return renderButton(component, data, rootData, scene, nextStack);
    case 'TextField': return renderTextField(component, data, rootData, scene);
    case 'CheckBox': return renderCheckBox(component, data, rootData, scene);
    case 'Slider': return renderSlider(component, data, rootData, scene);
    case 'Divider': return renderDivider(component);
    case 'Image': return renderImage(component, data, rootData);
    case 'Icon': return renderIcon(component);
    case 'List': return renderList(component, data, rootData, scene, nextStack);
    default: return unknownNode(component);
  }
}

function handleAction(action, data, rootData) {
  if (!isObj(action)) {
    toast('info', '这个按钮还没有 action', '当前只做界面预览');
    return;
  }
  var spec = isObj(action.event) ? action.event : action;
  var name = typeof spec.name === 'string' ? spec.name : '';
  if (!name) {
    toast('info', 'action 没有 name', '按钮点击已触发，但没有可识别的动作名');
    return;
  }
  var context = resolveContext(spec.context, data, rootData);
  if (ui.lastAction) ui.lastAction.hidden = false;
  if (ui.lastActionName) ui.lastActionName.textContent = name;
  if (ui.lastActionContext) ui.lastActionContext.textContent = JSON.stringify(context);
  toast('info', '触发 ' + name, '仅本地预览，不会回传 App');
}

function renderEmpty() {
  clearNode(ui.surface);
  var wrap = make('div', 'empty-state');
  var art = make('div', 'empty-art');
  art.appendChild(make('i'));
  art.appendChild(make('i'));
  art.appendChild(make('i'));
  art.appendChild(make('i'));
  wrap.appendChild(art);
  wrap.appendChild(make('div', 'empty-title', '还没有界面'));
  wrap.appendChild(make('div', 'empty-sub', '在左侧输入需求生成，或直接在右侧粘贴 A2UI JSON。也可以先看看内置的咖啡会员示例。'));
  var cta = make('button', 'empty-cta', '试试咖啡会员首页');
  cta.type = 'button';
  cta.addEventListener('click', function () { loadDemo(false); });
  wrap.appendChild(cta);
  wrap.appendChild(make('div', 'empty-foot', 'A2UI v0.9 · WEB PREVIEW'));
  ui.surface.appendChild(wrap);
}

function updateStats() {
  if (ui.statMessages) ui.statMessages.textContent = String(state.messages.length);
  var count = state.scene ? Object.keys(state.scene.components).length : 0;
  if (ui.statComponents) ui.statComponents.textContent = String(count);
  updateErrorStat();
}

function updateErrorStat() {
  var errors = 0;
  if (state.parseError) errors = 1;
  else if (state.validation && Array.isArray(state.validation.errors)) errors = state.validation.errors.length;
  if (ui.statErrors) ui.statErrors.textContent = String(errors);
  if (ui.statErrorsWrap) ui.statErrorsWrap.classList.toggle('bad', errors > 0);
}

function renderScene() {
  state.scene = computeScene(state.messages);
  if (!state.scene || !state.scene.components.root) {
    renderEmpty();
    renderHmiBar();
    updateStats();
    return;
  }
  renderHmiBar();
  if (detectKind(state.messages) === 'hmi') {
    renderHmiPreview();
    updateStats();
    return;
  }
  clearNode(ui.surface);
  var wrap = make('div', 'a2-surface anim');
  wrap.appendChild(renderNode(state.scene.components.root, state.scene.data, state.scene.data, state.scene, []));
  ui.surface.appendChild(wrap);
  updateStats();
}

function firstArray(values) {
  for (var i = 0; i < values.length; i += 1) {
    if (Array.isArray(values[i]) && values[i].length) {
      return values[i].map(function (item) { return String(item); });
    }
  }
  return [];
}

function hmiInfo() {
  var stored = state.hmi || {};
  var root = state.scene && state.scene.components ? state.scene.components.root : null;
  var slots = firstArray([stored.slots, root && root.slots]);
  var assets = firstArray([stored.mapAssets, root && root.mapAssets]);
  return {
    name: stored.archetypeName || (root && root.archetypeName) || '车机场景',
    archetype: stored.archetype || (root && root.archetype) || '',
    variant: stored.variant || (root && root.variant) || '',
    slots: slots,
    mapAssets: assets,
    components: Number(stored.componentCount) || (state.scene ? Object.keys(state.scene.components).length : 0)
  };
}

function renderHmiBar() {
  if (!ui.hmiBar) return;
  var isHmi = detectKind(state.messages) === 'hmi';
  ui.hmiBar.hidden = !isHmi;
  if (!isHmi) {
    state.hmi = null;
    return;
  }
  var info = hmiInfo();
  if (ui.hmiArch) {
    ui.hmiArch.textContent = info.name;
    ui.hmiArch.title = (info.archetype || 'hmi') + ' · ' + (info.variant || '未标注') + ' · 1920×1200';
  }
  if (ui.hmiSlots) {
    clearNode(ui.hmiSlots);
    info.slots.forEach(function (slot) {
      ui.hmiSlots.appendChild(make('span', 'hmi-slot', slot));
    });
    info.mapAssets.forEach(function (asset) {
      ui.hmiSlots.appendChild(make('span', 'hmi-slot asset', asset));
    });
    if (!info.slots.length && !info.mapAssets.length) {
      ui.hmiSlots.appendChild(make('span', 'hmi-slot', '无槽位标注'));
    }
  }
  if (ui.hmiNote) {
    ui.hmiNote.textContent = '原型 ' + (info.archetype || '—') + ' · 变体 ' + (info.variant || '—')
      + ' · ' + info.components + ' 个组件 · ' + state.messages.length + ' 条消息'
      + ' · App 端由 HmiViewerActivity（WebView）承接画面';
  }
}

function renderHmiPreview() {
  var info = hmiInfo();
  clearNode(ui.surface);
  var wrap = make('div', 'hmi-canvas');
  var top = make('div', 'hmi-canvas-top');
  top.appendChild(make('div', 'hmi-name', info.name));
  top.appendChild(make('span', 'hmi-tag', '1920×1200 · ' + (info.variant === '2d' ? '2D 平面' : '3D 实景')));
  wrap.appendChild(top);

  var grid = make('div', 'hmi-grid');
  var cells = info.slots.length ? info.slots : ['screen'];
  cells.forEach(function (slot) {
    var cell = make('div', 'hmi-cell');
    cell.appendChild(make('b', null, slot));
    cell.appendChild(make('span', null, HMI_SLOT_NAMES[slot] || '槽位'));
    grid.appendChild(cell);
  });
  wrap.appendChild(grid);

  var foot = make('div', 'hmi-foot');
  foot.appendChild(document.createTextNode(
    '横屏预览框（不渲染 HMI 素材）。真实画面：App 的 HmiViewerActivity（WebView）。推送走同一条 SSE。'
  ));
  if (info.mapAssets.length) {
    foot.appendChild(document.createElement('br'));
    foot.appendChild(document.createTextNode('地图素材：'));
    foot.appendChild(make('code', null, info.mapAssets.join(' / ')));
  }
  wrap.appendChild(foot);
  ui.surface.appendChild(wrap);
}

var DEMO_MESSAGES = [
  {
    version: 'v0.9',
    createSurface: { surfaceId: 'web_console', catalogId: CATALOG }
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'web_console',
      components: [
        { id: 'root', component: 'Column', children: ['hero', 'member', 'quick-row', 'section-title', 'coupon-list', 'divider', 'upgrade'] },
        { id: 'hero', component: 'Column', children: ['hero-title', 'hero-sub'] },
        { id: 'hero-title', component: 'Text', text: '早安，林小满', variant: 'h2' },
        { id: 'hero-sub', component: 'Text', variant: 'caption', text: { call: 'formatString', args: { value: '$' + '{/tier}' + ' · 本月已省 ' + '$' + '{/savedText}' } } },
        { id: 'member', component: 'Card', child: 'member-box' },
        { id: 'member-box', component: 'Column', children: ['member-points', 'member-meta'] },
        { id: 'member-points', component: 'Row', children: ['points-label', 'points-value'], justify: 'spaceBetween', align: 'center' },
        { id: 'points-label', component: 'Text', text: '可用积分', variant: 'caption' },
        { id: 'points-value', component: 'Text', variant: 'h3', text: { call: 'formatNumber', args: { value: { path: '/points' } } } },
        { id: 'member-meta', component: 'Row', children: ['member-no', 'member-tier'], justify: 'spaceBetween' },
        { id: 'member-no', component: 'Text', variant: 'caption', text: { call: 'formatString', args: { value: 'NO. ' + '$' + '{/memberNo}' } } },
        { id: 'member-tier', component: 'Text', text: '金卡 · 积分永久有效', variant: 'caption' }
      ]
    }
  },
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: 'web_console',
      path: '/',
      value: {
        memberNo: 'CLUB-8821',
        tier: '金卡会员',
        savedText: '¥32.00',
        coupons: [
          { name: '满 50 减 15', expires: '11-30', discount: 15 },
          { name: '新品第二杯半价', expires: '11-25', discount: 19.5 },
          { name: '早餐组合立减', expires: '12-05', discount: 8 }
        ]
      }
    }
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'web_console',
      components: [
        { id: 'quick-row', component: 'Row', children: ['coupon-kpi', 'order-kpi', 'bean-kpi'], justify: 'spaceBetween' },
        { id: 'coupon-kpi', component: 'Card', child: 'coupon-kpi-box' },
        { id: 'coupon-kpi-box', component: 'Column', children: ['coupon-kpi-label', 'coupon-kpi-value'] },
        { id: 'coupon-kpi-label', component: 'Text', text: '优惠券', variant: 'caption' },
        { id: 'coupon-kpi-value', component: 'Text', text: '3 张', variant: 'h5' },
        { id: 'order-kpi', component: 'Card', child: 'order-kpi-box' },
        { id: 'order-kpi-box', component: 'Column', children: ['order-kpi-label', 'order-kpi-value'] },
        { id: 'order-kpi-label', component: 'Text', text: '本月订单', variant: 'caption' },
        { id: 'order-kpi-value', component: 'Text', variant: 'h5', text: { call: 'formatNumber', args: { value: { path: '/orders' } } } },
        { id: 'bean-kpi', component: 'Card', child: 'bean-kpi-box' },
        { id: 'bean-kpi-box', component: 'Column', children: ['bean-kpi-label', 'bean-kpi-value'] },
        { id: 'bean-kpi-label', component: 'Text', text: '咖啡豆', variant: 'caption' },
        { id: 'bean-kpi-value', component: 'Text', variant: 'h5', text: { call: 'formatNumber', args: { value: { path: '/beans' } } } }
      ]
    }
  },
  {
    version: 'v0.9',
    updateDataModel: { surfaceId: 'web_console', path: '/points', value: 2860 }
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'web_console',
      components: [
        { id: 'section-title', component: 'Text', text: '本月优惠券', variant: 'h5' },
        { id: 'coupon-list', component: 'List', children: { componentId: 'coupon-card', path: '/coupons' } },
        { id: 'coupon-card', component: 'Card', child: 'coupon-row' },
        { id: 'coupon-row', component: 'Row', children: ['coupon-main', 'coupon-amount'], justify: 'spaceBetween', align: 'center' },
        { id: 'coupon-main', component: 'Column', children: ['coupon-name', 'coupon-expire'] },
        { id: 'coupon-name', component: 'Text', text: { path: '/name' }, variant: 'h5' },
        { id: 'coupon-expire', component: 'Text', variant: 'caption', text: { call: 'formatString', args: { value: '有效期至 ' + '$' + '{/expires}' } } },
        { id: 'coupon-amount', component: 'Text', variant: 'h4', text: { call: 'formatCurrency', args: { value: { path: '/discount' }, currency: 'CNY' } } }
      ]
    }
  },
  {
    version: 'v0.9',
    updateDataModel: { surfaceId: 'web_console', path: '/orders', value: 18 }
  },
  {
    version: 'v0.9',
    updateDataModel: { surfaceId: 'web_console', path: '/beans', value: 320 }
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'web_console',
      components: [
        { id: 'divider', component: 'Divider' },
        { id: 'upgrade', component: 'Button', variant: 'primary', child: 'upgrade-label', action: { event: { name: 'upgradeMembership', context: { tier: { path: '/tier' } } } } },
        { id: 'upgrade-label', component: 'Text', text: '升级黑金会员，积分翻倍' }
      ]
    }
  }
];

function loadDemo(quiet) {
  if (state.generating) return;
  state.messages = clone(DEMO_MESSAGES);
  ui.editor.value = JSON.stringify(state.messages, null, 2);
  ui.editorShell.classList.remove('err');
  state.parseError = null;
  updateGutter();
  parseEditor(true);
  if (ui.pushTitle) ui.pushTitle.value = '咖啡会员首页';
  if (ui.resultCard) ui.resultCard.hidden = true;
  state.demoLoaded = true;
  scheduleServerValidate();
  if (!quiet) toast('info', '已载入内置示例', '本地预览，不会自动推送');
}

function updateGutter() {
  if (!ui.gutter || !ui.editor) return;
  var lines = ui.editor.value.split('\n').length;
  var fragment = document.createDocumentFragment();
  for (var index = 1; index <= lines; index += 1) {
    fragment.appendChild(make('span', null, String(index)));
  }
  ui.gutter.replaceChildren(fragment);
  ui.gutter.scrollTop = ui.editor.scrollTop;
}

function updateEditorCount() {
  var count = state.messages.length;
  if (ui.editorCount) ui.editorCount.textContent = count ? count + ' 条消息' : '0 条消息';
  if (ui.pushCount) ui.pushCount.textContent = count ? count + ' 条' : '';
}

function resetValidation(text) {
  state.validation = null;
  if (ui.valState) {
    ui.valState.className = 'val-state';
    ui.valState.replaceChildren(make('i'), document.createTextNode(text || '等待生成'));
  }
  if (ui.valCount) ui.valCount.textContent = '';
  if (ui.valList) {
    clearNode(ui.valList);
    ui.valList.style.maxHeight = '74px';
    ui.valList.appendChild(make('div', 'val-item', '输入需求并生成，或直接粘贴 A2UI 消息数组。'));
  }
  state.valExpanded = false;
  if (ui.valToggle) ui.valToggle.textContent = '详情';
  updateErrorStat();
}

function setParseError(message) {
  state.parseError = message;
  ui.editorShell.classList.add('err');
  state.validation = {
    errors: ['JSON 解析失败：' + message],
    warnings: [],
    checking: false,
    source: 'parse'
  };
  state.validateSeq += 1;
  if (ui.editorCount) ui.editorCount.textContent = '—';
  if (ui.pushCount) ui.pushCount.textContent = '';
  renderValidation();
}

function clearParseError() {
  state.parseError = null;
  ui.editorShell.classList.remove('err');
}

function normalizeMessages(parsed) {
  var messages;
  if (Array.isArray(parsed)) {
    messages = parsed;
  } else if (isObj(parsed) && Array.isArray(parsed.messages)) {
    messages = parsed.messages;
  } else if (isObj(parsed)) {
    var hasOperation = OPERATIONS.some(function (op) { return hasOwn(parsed, op); });
    if (!hasOperation && !hasOwn(parsed, 'messages')) {
      throw new Error('对象里既没有 messages 数组，也不是单条 A2UI 消息');
    }
    messages = [parsed];
  } else {
    throw new Error('顶层必须是消息数组或消息对象');
  }
  messages.forEach(function (message, index) {
    if (!isObj(message)) throw new Error('第 ' + (index + 1) + ' 条消息不是 JSON 对象');
  });
  return messages;
}

function parseEditor(skipValidate) {
  var raw = ui.editor.value.trim();
  if (state.parseTimer) {
    clearTimeout(state.parseTimer);
    state.parseTimer = null;
  }
  if (!raw) {
    state.messages = [];
    clearParseError();
    updateEditorCount();
    renderScene();
    resetValidation('等待输入');
    state.validateSeq += 1;
    return;
  }
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    setParseError(error.message);
    return;
  }
  try {
    state.messages = normalizeMessages(parsed);
  } catch (error) {
    setParseError(error.message);
    return;
  }
  clearParseError();
  updateEditorCount();
  renderScene();
  var quick = quickValidate(state.messages);
  state.validation = {
    errors: quick.errors,
    warnings: quick.warnings,
    checking: false,
    source: 'local'
  };
  renderValidation();
  state.validateSeq += 1;
  if (!skipValidate) scheduleServerValidate();
}

function scheduleServerValidate() {
  if (state.validateTimer) clearTimeout(state.validateTimer);
  state.validateTimer = setTimeout(function () {
    state.validateTimer = null;
    validateServer();
  }, 650);
}

async function validateServer() {
  if (state.parseError) return;
  if (!state.messages.length) {
    resetValidation('等待输入');
    return;
  }
  var quick = quickValidate(state.messages);
  var seq = ++state.validateSeq;
  state.validation = {
    errors: quick.errors,
    warnings: quick.warnings,
    checking: true,
    source: 'local'
  };
  renderValidation();
  try {
    var response = await fetch('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.messages })
    });
    var text = await response.text();
    var data = text ? JSON.parse(text) : {};
    if (seq !== state.validateSeq) return;
    if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
    state.validation = {
      errors: Array.isArray(data.errors) ? data.errors : [],
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
      checking: false,
      source: 'server'
    };
    renderValidation();
  } catch (error) {
    if (seq !== state.validateSeq) return;
    state.validation = {
      errors: quick.errors,
      warnings: quick.warnings,
      checking: false,
      source: 'offline',
      offline: true
    };
    renderValidation();
  }
}

function renderValidation() {
  var validation = state.validation;
  if (!validation) {
    resetValidation('等待生成');
    return;
  }
  var errors = Array.isArray(validation.errors) ? validation.errors : [];
  var warnings = Array.isArray(validation.warnings) ? validation.warnings : [];
  var tone = 'val-state';
  var label = '等待生成';
  if (errors.length) {
    tone += ' bad';
    label = errors.length + ' 个错误';
  } else if (validation.checking) {
    tone += ' warn';
    label = '校验中…';
  } else if (warnings.length) {
    tone += ' warn';
    label = '校验通过 · ' + warnings.length + ' 条提示';
  } else if (validation.source === 'local') {
    tone += ' good';
    label = '本地校验通过';
  } else {
    tone += ' good';
    label = '校验通过';
  }
  if (validation.offline && !errors.length) {
    tone = 'val-state warn';
    label = '本地校验通过 · 服务离线';
  }
  if (ui.valState) {
    ui.valState.className = tone;
    ui.valState.replaceChildren(make('i'), document.createTextNode(label));
  }
  if (ui.valCount) {
    var countText = errors.length + ' 错误 / ' + warnings.length + ' 提示';
    if (validation.checking) countText += ' · 同步中';
    ui.valCount.textContent = countText;
  }
  if (ui.valList) {
    clearNode(ui.valList);
    var items = [];
    errors.forEach(function (message) {
      var row = make('div', 'val-item error');
      row.appendChild(make('i', null, '✕'));
      row.appendChild(document.createTextNode(String(message)));
      items.push(row);
    });
    warnings.forEach(function (message) {
      var row = make('div', 'val-item warning');
      row.appendChild(make('i', null, '!'));
      row.appendChild(document.createTextNode(String(message)));
      items.push(row);
    });
    if (!items.length && !validation.checking) {
      var ok = make('div', 'val-item ok');
      ok.appendChild(make('i', null, '✓'));
      ok.appendChild(document.createTextNode('结构校验通过，可以推送到 App。'));
      items.push(ok);
    }
    items.slice(0, 14).forEach(function (row) { ui.valList.appendChild(row); });
    ui.valList.style.maxHeight = state.valExpanded ? '220px' : '74px';
  }
  if (ui.valToggle) ui.valToggle.textContent = state.valExpanded ? '收起' : '详情';
  updateErrorStat();
}

function refreshEditorText(text) {
  ui.editor.value = text;
  updateGutter();
  parseEditor(true);
  validateServer();
}

function formatEditor() {
  var raw = ui.editor.value.trim();
  if (!raw) {
    toast('warn', '编辑器是空的');
    return;
  }
  try {
    refreshEditorText(JSON.stringify(JSON.parse(raw), null, 2));
    toast('success', 'JSON 已格式化');
  } catch (error) {
    toast('error', '格式化失败', error.message);
  }
}

function minifyEditor() {
  var raw = ui.editor.value.trim();
  if (!raw) {
    toast('warn', '编辑器是空的');
    return;
  }
  try {
    refreshEditorText(JSON.stringify(JSON.parse(raw)));
    toast('success', 'JSON 已压缩');
  } catch (error) {
    toast('error', '压缩失败', error.message);
  }
}

function clearEditor() {
  ui.editor.value = '';
  updateGutter();
  parseEditor(true);
  resetValidation('等待输入');
  if (ui.lastAction) ui.lastAction.hidden = true;
  toast('info', '编辑器已清空');
}

function copyJson() {
  var text = ui.editor.value.trim();
  if (!text) {
    toast('warn', '没有可复制的 JSON');
    return;
  }
  copyText(text, 'JSON 已复制');
}

function downloadJson() {
  var text = ui.editor.value.trim();
  if (!text) {
    toast('warn', '没有可下载的 JSON');
    return;
  }
  var title = ui.resultTitle && ui.resultTitle.textContent ? ui.resultTitle.textContent : 'a2ui-scene';
  var slug = String(title).replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '') || 'a2ui-scene';
  var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = slug + '-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  toast('success', '已下载 JSON', link.download);
}


function shortText(text, limit) {
  var value = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!limit || value.length <= limit) return value;
  return value.slice(0, Math.max(1, limit - 1)) + '…';
}

function clockText(epochSeconds) {
  var date = new Date(Number(epochSeconds) * 1000);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function uptimeText(seconds) {
  var value = Math.max(0, Number(seconds) || 0);
  if (value < 60) return Math.round(value) + '秒';
  if (value < 3600) return Math.round(value / 60) + '分';
  var hours = Math.floor(value / 3600);
  var minutes = Math.round((value % 3600) / 60);
  return minutes ? hours + '时' + minutes + '分' : hours + '时';
}

async function requestJson(url, options) {
  var response = await fetch(url, options);
  var text = await response.text();
  var data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = {};
    }
  }
  if (!response.ok) {
    var failure = new Error((data && data.error) || ('HTTP ' + response.status));
    failure.data = data;
    failure.status = response.status;
    throw failure;
  }
  return data;
}

function providerInfo(provider) {
  var full = String(provider || '');
  if (full.indexOf('llm:') === 0) {
    return { cls: '', label: 'AI · ' + shortText(full.slice(4), 24), full: full };
  }
  if (full === 'local-fallback') {
    return { cls: 'fallback', label: '回退 · 本地规则', full: full };
  }
  if (full === 'local-rules') {
    return { cls: 'local', label: '本地规则', full: full };
  }
  if (full === 'hmi-composer') {
    return { cls: 'local', label: '车机组装 · hmi-cli', full: full };
  }
  if (!full) return { cls: 'local', label: '本地规则', full: 'local-rules' };
  return { cls: '', label: shortText(full, 26), full: full };
}

function setMode(mode, quiet) {
  state.mode = mode === 'local' ? 'local' : 'ai';
  var isAi = state.mode === 'ai';
  if (ui.modeAi) {
    ui.modeAi.classList.toggle('active', isAi);
    ui.modeAi.setAttribute('aria-selected', isAi ? 'true' : 'false');
  }
  if (ui.modeLocal) {
    ui.modeLocal.classList.toggle('active', !isAi);
    ui.modeLocal.setAttribute('aria-selected', isAi ? 'false' : 'true');
  }
  if (ui.generateLabel) ui.generateLabel.textContent = isAi ? 'AI 生成界面' : '本地规则生成';
  if (!quiet) {
    toast('info', isAi ? '已切换到 AI 生成' : '已切换到本地规则',
      isAi ? '优先调用模型，失败自动回退' : '离线可用，不调用模型接口');
  }
}

function setSurfaceMode(kind, quiet) {
  var hmi = kind === 'hmi';
  state.surfaceKind = hmi ? 'hmi' : 'basic';
  if (ui.surfaceBasic) {
    ui.surfaceBasic.classList.toggle('active', !hmi);
    ui.surfaceBasic.setAttribute('aria-selected', hmi ? 'false' : 'true');
  }
  if (ui.surfaceHmi) {
    ui.surfaceHmi.classList.toggle('active', hmi);
    ui.surfaceHmi.setAttribute('aria-selected', hmi ? 'true' : 'false');
  }
  if (ui.surfaceHint) ui.surfaceHint.textContent = hmi ? 'HMI catalog' : 'Basic Catalog';
  if (ui.chips) ui.chips.hidden = hmi;
  if (ui.chipsHmi) ui.chipsHmi.hidden = !hmi;
  if (ui.phoneFrame) ui.phoneFrame.classList.toggle('hmi', hmi);
  if (ui.stageTitle) ui.stageTitle.textContent = hmi ? '车机预览' : '实时预览';
  if (ui.stageNote) ui.stageNote.textContent = hmi ? '16:10 横屏框（真实画面在 App 的 WebView 里）' : 'Compose 渲染模拟';
  if (ui.hmiBadge) ui.hmiBadge.hidden = !hmi;
  if (ui.phoneTitle) ui.phoneTitle.textContent = hmi ? '车机 HMI' : 'A2UI Android';
  if (ui.phoneSub) ui.phoneSub.textContent = hmi ? '1920 × 1200 · HmiViewerActivity 承接' : 'JSON 驱动的 Compose 界面';
  if (ui.editorKind) ui.editorKind.textContent = hmi ? 'A2UI v0.9 · HMI catalog' : 'A2UI v0.9 · Basic Catalog';
  if (ui.pushNote) ui.pushNote.hidden = !hmi;
  if (ui.hmiViewerRow) ui.hmiViewerRow.hidden = !hmi;
  if (ui.generateLabel && !state.generating) {
    ui.generateLabel.textContent = hmi ? '组装车机场景' : (state.mode === 'ai' ? 'AI 生成界面' : '本地规则生成');
  }
  renderScene();
  if (!quiet) {
    toast('info', hmi ? '已切换到车机 HMI 模式' : '已切换到通用界面模式',
      hmi ? 'demo/server/hmi-cli.ts 组装 1920×1200 · App 端 WebView 查看器' : '生成和预览都走 Basic Catalog（原流程）');
  }
}

function renderWarnings(warnings) {
  if (!ui.resultWarnings) return;
  clearNode(ui.resultWarnings);
  var list = Array.isArray(warnings) ? warnings.filter(Boolean).map(String) : [];
  if (!list.length) {
    ui.resultWarnings.hidden = true;
    return;
  }
  ui.resultWarnings.hidden = false;
  list.slice(0, 5).forEach(function (text) {
    var row = make('div', 'warn-item');
    row.appendChild(make('i', null, '!'));
    row.appendChild(document.createTextNode(text));
    ui.resultWarnings.appendChild(row);
  });
  if (list.length > 5) {
    var more = make('div', 'warn-item');
    more.appendChild(make('i', null, '…'));
    more.appendChild(document.createTextNode('还有 ' + (list.length - 5) + ' 条提示'));
    ui.resultWarnings.appendChild(more);
  }
}

function renderResult(payload) {
  if (!ui.resultCard) return;
  ui.resultCard.hidden = false;
  var info = providerInfo(payload.provider);
  if (ui.resultTitle) ui.resultTitle.textContent = shortText(payload.title || '未命名场景', 46);
  if (ui.resultProvider) {
    ui.resultProvider.className = 'provider' + (info.cls ? ' ' + info.cls : '');
    ui.resultProvider.textContent = info.label;
    ui.resultProvider.title = info.full;
  }
  if (ui.resultSummary) {
    ui.resultSummary.textContent = payload.summary || '已生成 A2UI 消息，可在右侧编辑并推送。';
  }
  if (ui.resultMs) ui.resultMs.textContent = (Number(payload.elapsedMs) || 0) + ' ms';
  var count = Number(payload.messageCount) || (Array.isArray(payload.messages) ? payload.messages.length : 0);
  var components = Number(payload.componentCount) || 0;
  if (ui.resultCount) {
    ui.resultCount.textContent = count + ' 条消息' + (components ? ' · ' + components + ' 个组件' : '');
  }
  renderWarnings(payload.warnings);
}

function applyGenerated(payload, prompt) {
  var messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!messages.length) throw new Error('生成结果中没有 messages');
  state.messages = messages;
  if (payload.hmi || payload.provider === 'hmi-composer' || detectKind(messages) === 'hmi') {
    state.hmi = {
      archetype: payload.archetype || '',
      archetypeName: payload.archetypeName || payload.title || '车机场景',
      variant: payload.variant || '',
      slots: Array.isArray(payload.slots) ? payload.slots : [],
      mapAssets: Array.isArray(payload.mapAssets) ? payload.mapAssets : [],
      componentCount: Number(payload.componentCount) || 0
    };
    if (payload.surfaceKind !== 'hmi' && state.surfaceKind !== 'hmi') setSurfaceMode('hmi', true);
  } else {
    state.hmi = null;
  }
  ui.editor.value = JSON.stringify(messages, null, 2);
  updateGutter();
  parseEditor(true);
  updateEditorCount();
  validateServer();
  renderResult(payload);
  if (ui.pushTitle) ui.pushTitle.value = shortText(payload.title || '控制台场景', 60);
  state.history.unshift({
    title: payload.title || '未命名场景',
    summary: payload.summary || '',
    provider: payload.provider || 'local-rules',
    kind: detectKind(messages),
    hmi: state.hmi ? clone(state.hmi) : null,
    count: messages.length,
    at: Date.now(),
    prompt: prompt,
    messages: clone(messages)
  });
  if (state.history.length > 8) state.history.length = 8;
  renderHistory();
}

function renderHistory() {
  if (!ui.historyList) return;
  clearNode(ui.historyList);
  if (!state.history.length) {
    ui.historyList.appendChild(make('div', 'empty-line', '还没有生成记录'));
    return;
  }
  state.history.forEach(function (item) {
    var button = make('button', 'history-item');
    button.type = 'button';
    button.title = '载入：' + (item.prompt || item.title);
    button.appendChild(make('strong', null, shortText(item.title, 48)));
    var meta = make('span');
    meta.textContent = providerInfo(item.provider).label + ' · ' + item.count + ' 条 · ' + clockText(item.at / 1000).slice(0, 5);
    button.appendChild(meta);
    button.addEventListener('click', function () {
      if (state.generating) return;
      state.messages = clone(item.messages);
      state.hmi = item.hmi ? clone(item.hmi) : null;
      if (item.kind && item.kind !== state.surfaceKind) setSurfaceMode(item.kind, true);
      ui.editor.value = JSON.stringify(state.messages, null, 2);
      updateGutter();
      parseEditor(true);
      updateEditorCount();
      validateServer();
      if (ui.pushTitle) ui.pushTitle.value = shortText(item.title, 60);
      if (ui.prompt) {
        ui.prompt.value = item.prompt || '';
        updatePromptCount();
      }
      toast('info', '已载入历史场景', item.title);
    });
    ui.historyList.appendChild(button);
  });
}

function genLabelText() {
  if (state.surfaceKind === 'hmi') return '组装车机场景';
  return state.mode === 'ai' ? 'AI 生成界面' : '本地规则生成';
}

function setGenerating(active) {
  state.generating = active;
  if (ui.generate) ui.generate.disabled = active;
  if (ui.generateIcon) ui.generateIcon.textContent = active ? '⏳' : '✦';
  if (ui.genStatus) ui.genStatus.hidden = !active;
  if (active) {
    if (ui.genText) {
      ui.genText.textContent = state.surfaceKind === 'hmi'
        ? '正在组装车机 1920×1200 场景…'
        : (state.mode === 'ai' ? '正在调用模型并校验…' : '正在套用本地规则…');
    }
    if (ui.genTimer) ui.genTimer.textContent = '0.0s';
  }
}

function generatePromptPlaceholder() {
  return state.surfaceKind === 'hmi'
    ? '例如：找附近的停车场，时速 60（可加「时速 / 剩余 / 隐藏 / 卡片 / 按钮」这类车机词）'
    : '例如：咖啡会员首页，积分、优惠券、升级按钮';
}

async function generateScene() {
  if (state.generating) return;
  var prompt = ui.prompt ? ui.prompt.value.trim() : '';
  if (!prompt) {
    toast('warn', '先描述一下你想要的界面', generatePromptPlaceholder());
    if (ui.prompt) ui.prompt.focus();
    return;
  }
  var hmi = state.surfaceKind === 'hmi';
  var body = hmi
    ? { prompt: prompt, surfaceKind: 'hmi' }
    : { prompt: prompt, preferLlm: state.mode === 'ai' };
  var startedAt = Date.now();
  var timer = null;
  setGenerating(true);
  timer = setInterval(function () {
    if (ui.genTimer) ui.genTimer.textContent = ((Date.now() - startedAt) / 1000).toFixed(1) + 's';
  }, 100);
  try {
    var payload = await requestJson('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    applyGenerated(payload, prompt);
    var provider = providerInfo(payload.provider);
    if (hmi) {
      if (payload.provider !== 'hmi-composer') {
        toast('warn', '后台还是旧进程，没走车机模式',
          '返回的是 ' + (payload.provider || '未知') + '：重启控制台才会启用 surfaceKind=hmi'
          + '（python -u android-demo/server/a2ui_console_server.py --port 8787）');
      } else {
        toast('success', '已组装车机场景「' + shortText(payload.archetypeName || payload.title || '车机', 22) + '」',
          (payload.variant === '2d' ? '2D 平面' : '3D 实景') + ' · ' + (payload.componentCount || 0)
          + ' 个组件 · 槽位 ' + ((payload.slots || []).join('/') || '无'));
      }
    } else if (String(payload.provider || '').indexOf('local-fallback') === 0) {
      toast('warn', '模型不可用，已回退本地规则', provider.label + ' · ' + (payload.messageCount || 0) + ' 条消息');
    } else {
      toast('success', '已生成「' + shortText(payload.title || '新界面', 28) + '」',
        provider.label + ' · ' + (payload.messageCount || 0) + ' 条消息 · ' + (payload.elapsedMs || 0) + ' ms');
    }
  } catch (error) {
    toast('error', hmi ? '车机组装失败' : '生成失败', error.message || '未知错误');
  } finally {
    if (timer) clearInterval(timer);
    if (ui.genTimer) ui.genTimer.textContent = ((Date.now() - startedAt) / 1000).toFixed(1) + 's';
    setGenerating(false);
    if (ui.generateLabel) ui.generateLabel.textContent = genLabelText();
  }
}

function pushBlockingErrors() {
  if (state.parseError) {
    toast('error', 'JSON 解析失败', state.parseError);
    return true;
  }
  if (!state.messages.length) {
    toast('warn', '没有可推送的界面', '先生成或粘贴 A2UI 消息数组');
    return true;
  }
  var errors = state.validation && Array.isArray(state.validation.errors) ? state.validation.errors : [];
  if (errors.length) {
    toast('error', '推送前校验未通过', errors[0]);
    state.valExpanded = true;
    renderValidation();
    return true;
  }
  return false;
}

async function pushToApp() {
  if (state.pushing) return;
  if (pushBlockingErrors()) return;
  var title = (ui.pushTitle && ui.pushTitle.value.trim()) || '控制台场景';
  var delayMs = ui.pushDelay ? parseInt(ui.pushDelay.value, 10) : 160;
  if (!isFinite(delayMs)) delayMs = 160;
  state.pushing = true;
  if (ui.push) ui.push.disabled = true;
  try {
    var payload = await requestJson('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.messages, title: title, delayMs: delayMs })
    });
    setClients(Number(payload.clients) || 0);
    var stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setPill(ui.pillPush, 'ok', shortText(title, 16) + ' · ' + stamp);
    state.lastPushLocal = {
      title: title,
      stamp: stamp,
      at: Date.now(),
      count: Number(payload.queued) || 0,
      clients: Number(payload.clients) || 0
    };
    if (ui.pillPush) ui.pillPush.title = title + ' · ' + (state.lastPushLocal.count || 0) + ' 条 · ' + (state.lastPushLocal.clients || 0) + ' 台 App';
    if (payload.clients > 0) {
      toast('success', '已推送 ' + payload.queued + ' 条消息',
        payload.clients + ' 台 App 在线 · 间隔 ' + payload.delayMs + ' ms'
        + (detectKind(state.messages) === 'hmi' ? ' · 车机画面在 HmiViewerActivity（WebView）里' : ''));
    } else {
      toast('warn', '消息已入队，但没有 App 连接', '先 adb reverse tcp:8787 tcp:8787，并在 App 中连接实时流');
    }
    var settleMs = Math.min(12000, (Number(payload.delayMs) || 160) * (Number(payload.queued) || 1) + 600);
    setTimeout(pollStatus, settleMs);
  } catch (error) {
    var detail = error.data && Array.isArray(error.data.errors) ? error.data.errors[0] : error.message;
    if (error.data && Array.isArray(error.data.errors)) {
      state.validation = {
        errors: error.data.errors,
        warnings: Array.isArray(error.data.warnings) ? error.data.warnings : [],
        checking: false,
        source: 'server'
      };
      renderValidation();
    }
    toast('error', '推送失败', detail || '服务返回错误');
  } finally {
    state.pushing = false;
    if (ui.push) ui.push.disabled = false;
  }
}

async function pollStatus() {
  if (state.statusBusy) return;
  state.statusBusy = true;
  try {
    var payload = await requestJson('/api/status', { cache: 'no-store' });
    var server = payload.server || {};
    var model = payload.model || {};
    setPill(ui.pillService, 'ok', '在线 · ' + uptimeText(server.uptimeSec));
    if (model.configured) {
      setPill(ui.pillModel, 'ok', 'AI · ' + shortText(model.name || 'model', 22));
      if (ui.pillModel) ui.pillModel.title = (model.baseUrl || '') + ' · ' + (model.name || '');
    } else {
      setPill(ui.pillModel, 'warn', '本地规则');
      if (ui.pillModel) ui.pillModel.title = '未配置 A2UI_LLM_API_KEY / OPENAI_API_KEY';
    }
    var clients = Number(server.clients) || 0;
    setClients(clients);
    setPill(ui.pillClients, clients > 0 ? 'ok' : null, clients + ' 台');
    var last = payload.lastPush;
    var local = state.lastPushLocal;
    var localFresh = local && (Date.now() - local.at < 60000);
    var serverAt = last && last.at ? Number(last.at) * 1000 : 0;
    if (localFresh && (!last || !serverAt || local.at >= serverAt)) {
      setPill(ui.pillPush, 'ok', shortText(local.title || '场景', 16) + ' · ' + local.stamp);
      if (ui.pillPush) ui.pillPush.title = (local.title || '') + ' · ' + (local.count || 0) + ' 条 · ' + (local.clients || 0) + ' 台 App';
    } else if (last && last.at) {
      setPill(ui.pillPush, 'ok', shortText(last.title || '场景', 16) + ' · ' + clockText(last.at));
      if (ui.pillPush) ui.pillPush.title = (last.title || '') + ' · ' + (last.count || 0) + ' 条 · ' + (last.clients || 0) + ' 台 App';
    } else {
      setPill(ui.pillPush, null, '—');
      if (ui.pillPush) ui.pillPush.title = '还没有推送';
    }
    if (server.surfaceId && ui.sseUrl) {
      var base = String(ui.sseUrl.value || '').split('/stream')[0] || 'http://127.0.0.1:8787';
      ui.sseUrl.value = base + '/stream';
    }
    state.statusWarned = false;
  } catch (error) {
    setPill(ui.pillService, 'bad', '离线');
    setPill(ui.pillModel, 'warn', '—');
    setClients(0);
    setPill(ui.pillClients, 'bad', '0 台');
    if (!state.statusWarned) {
      state.statusWarned = true;
      toast('error', '控制台服务未连接', '在项目目录运行 python -u android-demo/server/a2ui_console_server.py --port 8787');
    }
  } finally {
    state.statusBusy = false;
  }
}

function manualValidate() {
  if (state.parseError) {
    toast('error', 'JSON 解析失败', state.parseError);
    return;
  }
  if (!state.messages.length) {
    toast('warn', '没有可校验的消息');
    return;
  }
  validateServer().then(function () {
    var errors = state.validation && Array.isArray(state.validation.errors) ? state.validation.errors : [];
    var warnings = state.validation && Array.isArray(state.validation.warnings) ? state.validation.warnings : [];
    if (errors.length) toast('error', '校验发现 ' + errors.length + ' 个错误', errors[0]);
    else if (warnings.length) toast('warn', '校验通过，但有 ' + warnings.length + ' 条提示', warnings[0]);
    else toast('success', '校验通过', state.messages.length + ' 条 A2UI 消息');
  });
}

function insertTab() {
  var start = ui.editor.selectionStart;
  var end = ui.editor.selectionEnd;
  var text = ui.editor.value;
  var spaces = '  ';
  var next = text.slice(0, start) + spaces + text.slice(end);
  ui.editor.value = next;
  ui.editor.selectionStart = ui.editor.selectionEnd = start + spaces.length;
  updateGutter();
  ui.editor.dispatchEvent(new Event('input'));
}

function openHelp(open) {
  if (!ui.helpModal) return;
  ui.helpModal.classList.toggle('open', Boolean(open));
  ui.helpModal.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open && ui.helpModal.querySelector('.modal-close')) {
    setTimeout(function () { ui.helpModal.querySelector('.modal-close').focus(); }, 60);
  }
}

function bindEvents() {
  if (ui.modeAi) ui.modeAi.addEventListener('click', function () { setMode('ai'); });
  if (ui.modeLocal) ui.modeLocal.addEventListener('click', function () { setMode('local'); });
  if (ui.surfaceBasic) ui.surfaceBasic.addEventListener('click', function () { setSurfaceMode('basic'); });
  if (ui.surfaceHmi) ui.surfaceHmi.addEventListener('click', function () { setSurfaceMode('hmi'); });

  if (ui.prompt) {
    ui.prompt.addEventListener('input', updatePromptCount);
    ui.prompt.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        generateScene();
      }
    });
  }

  function onChipClick(event) {
    var chip = event.target.closest('.chip');
    if (!chip) return;
    var text = chip.getAttribute('data-prompt') || chip.textContent || '';
    if (ui.prompt) {
      ui.prompt.value = text;
      updatePromptCount();
    }
    if (event.shiftKey) {
      toast('info', '示例已填入', '按 Ctrl+Enter 或点击生成');
      if (ui.prompt) ui.prompt.focus();
      return;
    }
    generateScene();
  }
  if (ui.chips) ui.chips.addEventListener('click', onChipClick);
  if (ui.chipsHmi) ui.chipsHmi.addEventListener('click', onChipClick);

  if (ui.generate) ui.generate.addEventListener('click', generateScene);
  if (ui.push) ui.push.addEventListener('click', pushToApp);
  if (ui.copySse) ui.copySse.addEventListener('click', function () {
    copyText(ui.sseUrl ? ui.sseUrl.value : '', 'SSE 地址已复制');
  });
  if (ui.copySseTop) ui.copySseTop.addEventListener('click', function () {
    copyText(ui.sseUrl ? ui.sseUrl.value : '', 'SSE 地址已复制');
  });
  if (ui.copyJson) ui.copyJson.addEventListener('click', copyJson);
  if (ui.downloadJson) ui.downloadJson.addEventListener('click', downloadJson);
  if (ui.clearHistory) ui.clearHistory.addEventListener('click', function () {
    state.history = [];
    renderHistory();
    toast('info', '本次会话记录已清空');
  });

  if (ui.editor) {
    ui.editor.addEventListener('input', function () {
      updateGutter();
      if (state.parseTimer) clearTimeout(state.parseTimer);
      state.parseTimer = setTimeout(function () {
        state.parseTimer = null;
        parseEditor(false);
      }, 350);
    });
    ui.editor.addEventListener('scroll', function () {
      if (ui.gutter) ui.gutter.scrollTop = ui.editor.scrollTop;
    });
    ui.editor.addEventListener('keydown', function (event) {
      if (event.key === 'Tab') {
        event.preventDefault();
        insertTab();
      }
    });
  }

  document.querySelectorAll('[data-editor]').forEach(function (button) {
    button.addEventListener('click', function () {
      var action = button.getAttribute('data-editor');
      if (action === 'format') formatEditor();
      else if (action === 'minify') minifyEditor();
      else if (action === 'validate') manualValidate();
      else if (action === 'clear') clearEditor();
    });
  });

  if (ui.valToggle) ui.valToggle.addEventListener('click', function () {
    state.valExpanded = !state.valExpanded;
    renderValidation();
  });

  if (ui.openHelp) ui.openHelp.addEventListener('click', function () { openHelp(true); });
  var closeButtons = document.querySelectorAll('[data-close="help"]');
  closeButtons.forEach(function (button) {
    button.addEventListener('click', function () { openHelp(false); });
  });

  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      copyText(button.getAttribute('data-copy') || '', '命令已复制');
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && ui.helpModal && ui.helpModal.classList.contains('open')) {
      openHelp(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      if (ui.helpModal && ui.helpModal.classList.contains('open')) return;
      if (event.target && event.target.tagName === 'TEXTAREA' && event.target !== ui.prompt) return;
      event.preventDefault();
      generateScene();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) pollStatus();
  });
}

function init() {
  bindEvents();
  updatePromptCount();
  updatePhoneTime();
  setMode(state.mode, true);
  setSurfaceMode(state.surfaceKind, true);
  setClients(0);
  loadDemo(true);
  if (ui.sseUrl && (!ui.sseUrl.value || ui.sseUrl.value.indexOf('/stream') < 0)) {
    var origin = location.protocol === 'file:' ? 'http://127.0.0.1:8787' : location.origin;
    ui.sseUrl.value = origin + '/stream';
  }
  renderHistory();
  pollStatus();
  setInterval(updatePhoneTime, 30000);
  setInterval(pollStatus, 3000);
}

init();
})();
