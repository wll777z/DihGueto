import { mkdir, readdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';

const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', webp: 'image/webp', png: 'image/png' };
const files = Object.create(null);
for (const name of (await readdir('public')).sort()) {
  const ext = name.split('.').at(-1);
  if (!types[ext]) throw new Error('Tipo de arquivo desconhecido: ' + name);
  const binary = ['webp', 'png'].includes(ext);
  files[name === 'index.html' ? '/' : '/' + name] = [types[ext], (await readFile('public/' + name)).toString(binary ? 'base64' : 'utf8'), binary];
}
await rm('dist', { recursive: true, force: true });
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
const worker = (await readFile('worker/index.mjs', 'utf8')).replace("import assets from './assets.mjs';", 'const assets = Object.assign(Object.create(null), ' + JSON.stringify(files) + ');');
await writeFile('dist/server/index.js', worker);
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
