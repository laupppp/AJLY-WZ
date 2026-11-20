#!/usr/bin/env node
/**
 * 对 h5/js 与 miniprogram 下的所有 .js 做语法检查（内部调用 node --check）。
 *
 * 为什么需要：H5 没有构建步骤、也没有打包器，语法错误不会在构建期暴露，
 * 一旦推上去就是白屏。这个脚本把这类低级错误挡在推送之前。
 *
 * 用法：
 *   node h5/check-syntax.js
 * 退出码：0 全部通过 / 1 存在语法错误
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIRS = ['h5/js', 'miniprogram'];
const SKIP_DIRS = ['node_modules', 'miniprogram_npm', 'dist', 'build'];

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.indexOf(ent.name) < 0) walk(p, out);
    } else if (ent.name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

const files = DIRS.reduce(function (acc, d) { return walk(path.join(ROOT, d), acc); }, []);

if (!files.length) {
  console.error('没有找到任何 .js 文件，检查路径是否跑对（应在项目根目录执行）');
  process.exit(1);
}

const bad = [];
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    bad.push(f);
    const msg = String(err.stderr || err.message).trim().split('\n').slice(0, 5).join('\n');
    console.error('✗ ' + path.relative(ROOT, f) + '\n' + msg + '\n');
  }
}

if (bad.length) {
  console.error('语法检查未通过：' + bad.length + '/' + files.length + ' 个文件有错');
  process.exit(1);
}

console.log('语法检查通过：' + files.length + ' 个文件');
