#!/usr/bin/env node
/**
 * 开发期依赖链接：把宿主安装里的 peer 依赖连到本包的 node_modules，
 * 让 `npm test` 能直接 import lib/bazi.js（它 import 宿主提供的包）。
 *
 * DSH 运行时自己会通过「安装范围包解析」提供这些包，所以这只是本地开发垫片，
 * 不参与发布。Windows 上用目录 junction（不需要管理员权限）。
 *
 * 用法：node scripts/link-deps.mjs [--install-anchor <path>]
 *
 * 锚点是 `@deepseek-ai/dsh` 这个包的目录。不显式指定时按下面的顺序探测：
 *   1. 环境变量 DSH_INSTALL_ANCHOR
 *   2. Node 模块解析（dsh 装在当前项目里时可用）
 *   3. <node 所在目录>/node_modules/@deepseek-ai/dsh（便携版 / 独立 Node 布局）
 *   4. `npm root -g`/@deepseek-ai/dsh（全局 npm 安装）
 */

import { existsSync, mkdirSync, readdirSync, symlinkSync, rmSync, lstatSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const DSH_PACKAGE = '@deepseek-ai/dsh';

/** 需要链接的包 → 在锚点包 node_modules 下的相对位置。 */
const LINKS = new Map([
  ['zod', 'node_modules/zod'],
  ['@deepseek-ai/dsh-tools', 'node_modules/@deepseek-ai/dsh-tools'],
  ['@deepseek-ai/dsh-storage-domain', 'node_modules/@deepseek-ai/dsh-storage-domain'],
  ['@deepseek-ai/dsh-session-projection', 'node_modules/@deepseek-ai/dsh-session-projection'],
]);

/** 从解析出来的入口文件向上找包根（第一个带 package.json 的目录）。 */
function packageRootOf(entry) {
  let dir = dirname(entry);
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 同级目录里其他 Node 安装的锚点（nvm-windows / 便携版解压包都是这种并排布局）。 */
function siblingAnchors() {
  const parent = dirname(dirname(process.execPath));
  let entries;
  try {
    entries = readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name, 'node_modules', '@deepseek-ai', 'dsh'));
}

/** 探测手段：每项返回候选锚点列表，按顺序取第一个存在的。 */
const PROBES = [
  ['Node 模块解析', () => [packageRootOf(createRequire(import.meta.url).resolve(DSH_PACKAGE))]],
  ['便携版 Node 布局', () => [join(dirname(process.execPath), 'node_modules', '@deepseek-ai', 'dsh')]],
  ['同级 Node 版本', siblingAnchors],
  ['全局 npm 安装', () => [join(globalRoot(), '@deepseek-ai', 'dsh')]],
];

/** `npm root -g`；拿不到就返回空串（探针随即落空）。 */
function globalRoot() {
  try {
    return execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/**
 * 定锚点：显式参数 → 环境变量 → 各探测手段。
 * @param {string[]} argv - 去掉 node 与脚本名之后的参数。
 * @returns {{ anchor: string|null, tried: string[] }} 锚点与尝试记录。
 */
function resolveAnchor(argv) {
  const tried = [];
  let explicit;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--install-anchor') explicit = argv[i + 1];
  }
  if (explicit !== undefined) return { anchor: explicit, tried: [`--install-anchor ${explicit}`] };

  const env = process.env.DSH_INSTALL_ANCHOR;
  if (env !== undefined && env !== '') {
    return { anchor: env, tried: [`DSH_INSTALL_ANCHOR=${env}`] };
  }

  for (const [label, probe] of PROBES) {
    let candidates;
    try {
      candidates = (probe() ?? []).filter((candidate) => candidate !== null && candidate !== '');
    } catch {
      candidates = [];
    }
    if (candidates.length === 0) {
      tried.push(`${label} → 未命中`);
      continue;
    }
    for (const candidate of candidates) {
      tried.push(`${label} → ${candidate}`);
      if (existsSync(candidate)) return { anchor: candidate, tried };
    }
  }
  return { anchor: null, tried };
}

/** 目标位置已存在就删掉，保证脚本可重复执行。 */
function clear(target) {
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  return stat.isSymbolicLink();
}

function main() {
  const { anchor, tried } = resolveAnchor(process.argv.slice(2));
  if (anchor === null || !existsSync(anchor)) {
    console.error(
      [
        '找不到 dsh 安装锚点（@deepseek-ai/dsh 包目录）。已尝试：',
        ...tried.map((line) => `  - ${line}`),
        '',
        '用 --install-anchor <path> 显式指定，或设环境变量 DSH_INSTALL_ANCHOR。',
      ].join('\n'),
    );
    process.exit(2);
  }

  const nodeModules = join(PACKAGE_ROOT, 'node_modules');
  mkdirSync(nodeModules, { recursive: true });

  let linked = 0;
  for (const [packageName, relative] of LINKS) {
    const source = join(anchor, relative);
    if (!existsSync(source)) {
      console.warn(`跳过 ${packageName}：宿主里找不到 ${source}`);
      continue;
    }
    const target = join(nodeModules, ...packageName.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    clear(target);
    // Windows 上用 junction（目录连接，无需管理员权限）；其他平台用目录符号链接
    symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
    linked += 1;
    console.log(`已链接 ${packageName} → ${source}`);
  }

  console.log(`\n锚点：${anchor}`);
  console.log(`完成：${linked} 个链接。现在可以运行 npm test。`);
}

main();
