#!/usr/bin/env node
/**
 * 把多文件的 H5 压成一个 standalone.html（CSS / 全部 JS 内联）。
 *
 * 用途：
 *   1. 双击即可预览，不需要起本地服务器（file:// 也能跑）；
 *   2. 想把整个 H5 一次性贴给 ChatGPT / 其他外部工具看时，只需要给这一个文件。
 *
 * 注意：它是**产物**，不要手改。改了源文件重跑本脚本即可。
 *
 * 用法：
 *   node h5/build-standalone.js             生成
 *   node h5/build-standalone.js --out X     生成到指定路径
 *   node h5/build-standalone.js --check     只校验产物是否过期（CI 用，不一致退出码 1）
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const CHECK = process.argv.indexOf('--check') >= 0;
const OUT = (function () {
  const i = process.argv.indexOf('--out');
  return i >= 0 && process.argv[i + 1]
    ? path.resolve(process.argv[i + 1])
    : path.join(HERE, 'standalone.html');
})();

function read(rel) {
  const p = path.join(HERE, rel);
  if (!fs.existsSync(p)) throw new Error('缺少文件：' + rel + '（先跑 node h5/build-biz.js）');
  return fs.readFileSync(p, 'utf8');
}

let html = read('index.html');

// 1) 内联样式
html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g, function (_, href) {
  return '<style>\n/* ==== ' + href + ' ==== */\n' + read(href) + '\n</style>';
});

// 2) 内联脚本（保持原有顺序）
let count = 0;
html = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, function (_, src) {
  count++;
  return '<script>\n/* ==== ' + src + ' ==== */\n' + read(src) + '\n</script>';
});

if (!count) throw new Error('index.html 里没找到 <script src>，内联失败');

// 3) 顶部加一行说明，避免被误当成源文件维护
html = html.replace('<head>', '<head>\n<!-- 单文件产物：由 h5/build-standalone.js 生成，请勿手改（改源文件后重跑） -->');

const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
const shown = path.relative(process.cwd(), OUT);

if (CHECK) {
  if (!fs.existsSync(OUT)) {
    console.error('✗ ' + shown + ' 不存在（先跑 node h5/build-standalone.js）');
    process.exit(1);
  }
  if (fs.readFileSync(OUT, 'utf8') === html) {
    console.log(shown + ' 与源文件一致（' + kb + ' KB，内联 ' + count + ' 个脚本）');
    process.exit(0);
  }
  console.error('✗ ' + shown + ' 已过期：源文件改过但未重建单文件版');
  console.error('  修复：node h5/build-standalone.js');
  process.exit(1);
}

fs.writeFileSync(OUT, html);
console.log('已生成 ' + shown + '（' + kb + ' KB，内联 ' + count + ' 个脚本）');
