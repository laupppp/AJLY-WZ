#!/usr/bin/env node
/**
 * 把小程序里与平台无关的业务模块打包成浏览器可直接 <script> 引入的 BIZ 包。
 * 这样 H5 与小程序共用同一份业务规则（状态机、预算核定、权限矩阵、商品目录），
 * 不需要把逻辑复制一遍，改小程序里的规则重跑本脚本，H5 就跟着变。
 *
 * 用法：
 *   node h5/build-biz.js            构建一次
 *   node h5/build-biz.js --watch    监听源文件，改一次重建一次
 *   node h5/build-biz.js --check    只检查 h5/js/biz.js 是否已过期（CI / 发布前用，过期退出码 1）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', 'miniprogram');
const OUT = path.join(__dirname, 'js', 'biz.js');

// 打包入口。它们 require 到的其它纯逻辑模块会被自动收集（见 collect）。
const MODULES = [
  'utils/format',
  'data/catalog',
  'data/seed',
  'data/subcats',
  'utils/domain',
  'utils/perm'
];

// 平台相关模块：依赖 wx.*，只能留在小程序里，H5 有各自实现
const PLATFORM_ONLY = ['utils/store', 'utils/session', 'utils/share'];

// 检查过期时扫描的目录（改这些目录下的任何文件都算改业务）
const WATCH_DIRS = ['utils', 'data'];

const ARGS = process.argv.slice(2);
const WATCH = ARGS.indexOf('--watch') >= 0;
const CHECK = ARGS.indexOf('--check') >= 0;

function read(id) {
  return fs.readFileSync(path.join(ROOT, id + '.js'), 'utf8');
}

// 判断模块是否真的调用了 wx.*：先去掉注释，避免说明文字里的 wx.* 误判
function usesWx(src) {
  const clean = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'\\])\/\/[^\n]*/g, '');
  return /\bwx\./.test(clean);
}

function exists(id) {
  return fs.existsSync(path.join(ROOT, id + '.js'));
}

function resolveId(from, spec) {
  if (spec.charAt(0) !== '.') return null;
  const base = from.split('/');
  base.pop();
  spec.split('/').forEach(function (seg) {
    if (!seg || seg === '.') return;
    if (seg === '..') base.pop();
    else base.push(seg);
  });
  return base.join('/');
}

/**
 * 从入口出发，顺着 require('./xxx') 自动收集依赖。
 * 不在 MODULES 里但被引用到的模块，如果含 wx.* 就报错（应当留在小程序端），
 * 否则自动打进包里 —— 这样小程序新增一个纯逻辑模块时不用回来改这里。
 */
function collect() {
  const sources = {};
  const queue = MODULES.slice();
  const warnings = [];

  while (queue.length) {
    const id = queue.shift();
    if (sources[id]) continue;
    if (!exists(id)) {
      warnings.push('找不到模块：' + id + '.js');
      continue;
    }
    const src = read(id);
    sources[id] = src;

    const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const dep = resolveId(id, m[1]);
      if (!dep || sources[dep]) continue;
      if (PLATFORM_ONLY.indexOf(dep) >= 0) {
        throw new Error(
          id + ' 依赖了平台相关模块 ' + dep + '（含 wx.* 调用），无法打包到 H5。\n' +
          '请把它拆成「纯逻辑 + 平台适配」两层，纯逻辑部分再引用。'
        );
      }
      if (!exists(dep)) {
        warnings.push(id + ' 引用了不存在的模块：' + dep);
        continue;
      }
      if (usesWx(read(dep)) && MODULES.indexOf(dep) < 0) {
        throw new Error(dep + '.js 里调用了 wx.*，不能打包到 H5（浏览器没有 wx 对象）。');
      }
      queue.push(dep);
    }
  }

  return { sources: sources, warnings: warnings };
}

function fingerprint(sources) {
  const ids = Object.keys(sources).sort();
  const h = crypto.createHash('sha1');
  ids.forEach(function (id) {
    h.update(id + '\u0000' + sources[id] + '\u0000');
  });
  return h.digest('hex').slice(0, 16);
}

function readExistingFingerprint() {
  try {
    const txt = fs.readFileSync(OUT, 'utf8').slice(0, 800);
    const m = txt.match(/源文件指纹：([0-9a-f]+)/);
    return m ? m[1] : '';
  } catch (e) {
    return '';
  }
}

function build() {
  const { sources, warnings } = collect();
  warnings.forEach(function (w) { console.warn('  ! ' + w); });

  const ids = Object.keys(sources).sort();
  const fp = fingerprint(sources);

  const blocks = ids.map(function (id) {
    return '__def(' + JSON.stringify(id) + ', function (module, exports, require) {\n' +
      sources[id] + '\n});';
  });

  const header = [
    '/* 自动生成，请勿直接修改。',
    ' * 来源：miniprogram/{utils,data}/*.js（纯逻辑模块）',
    ' * 重新生成：node h5/build-biz.js',
    ' * 生成时间：' + new Date().toISOString(),
    ' * 模块：' + ids.join(', '),
    ' * 源文件指纹：' + fp,
    ' */',
    '(function (global) {',
    '  var defs = {};',
    '  var cache = {};',
    '  function __def(id, fn) { defs[id] = fn; }',
    '',
    '  function resolve(from, spec) {',
    "    if (spec.charAt(0) !== '.') return spec;",
    "    var base = from.split('/');",
    '    base.pop();',
    "    spec.split('/').forEach(function (seg) {",
    "      if (!seg || seg === '.') return;",
    "      if (seg === '..') base.pop();",
    '      else base.push(seg);',
    '    });',
    "    return base.join('/');",
    '  }',
    '',
    '  function load(id) {',
    '    if (cache[id]) return cache[id].exports;',
    '    var fn = defs[id];',
    "    if (!fn) throw new Error('模块未打包：' + id);",
    '    var mod = { exports: {} };',
    '    cache[id] = mod;',
    '    fn(mod, mod.exports, function (spec) { return load(resolve(id, spec)); });',
    '    return mod.exports;',
    '  }'
  ].join('\n');

  const exportsMap = ids.map(function (id) {
    // BIZ.fmt / BIZ.catalog / BIZ.domain …（format 对外沿用 fmt 这个短名）
    const key = id === 'utils/format' ? 'fmt' : id.replace(/^utils\//, '').replace(/^data\//, '');
    return '    ' + JSON.stringify(key) + ": load('" + id + "')";
  });

  const footer = [
    '',
    '  global.BIZ = {',
    '    load: load,',
    exportsMap.join(',\n'),
    '  };',
    "})(typeof window !== 'undefined' ? window : globalThis);",
    ''
  ].join('\n');

  const out = header + '\n\n' + blocks.join('\n\n') + '\n' + footer;
  fs.writeFileSync(OUT, out);

  const rel = path.relative(process.cwd(), OUT);
  console.log('[' + new Date().toLocaleTimeString('zh-CN') + '] 已生成 ' + rel +
    '（' + (out.length / 1024).toFixed(1) + ' KB，' + ids.length + ' 个模块，指纹 ' + fp + '）');
  return fp;
}

if (CHECK) {
  const { sources } = collect();
  const want = fingerprint(sources);
  const have = readExistingFingerprint();
  if (!have) {
    console.error('h5/js/biz.js 不存在或没有指纹，请先运行：node h5/build-biz.js');
    process.exit(1);
  }
  if (have !== want) {
    console.error('h5/js/biz.js 已过期（源文件指纹 ' + want + ' ≠ 产物 ' + have + '）。');
    console.error('小程序业务逻辑改过但没重建，H5 跑的仍是旧规则。请运行：node h5/build-biz.js');
    process.exit(1);
  }
  console.log('h5/js/biz.js 与小程序源文件一致（指纹 ' + want + '）。');
  process.exit(0);
}

build();

if (WATCH) {
  console.log('监听 miniprogram/{utils,data} 变化中，Ctrl+C 退出…');
  let timer = null;
  WATCH_DIRS.forEach(function (dir) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) return;
    fs.watch(full, { persistent: true }, function (_evt, file) {
      if (!file || !/\.js$/.test(file)) return;
      if (PLATFORM_ONLY.indexOf(dir + '/' + file.replace(/\.js$/, '')) >= 0) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        try {
          build();
        } catch (e) {
          console.error('构建失败：' + e.message);
        }
      }, 120);
    });
  });
}
