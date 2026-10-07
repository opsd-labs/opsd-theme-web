/** 仅打包构建产物和主题清单，不附带源码或依赖。 */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
const root = fileURLToPath(new URL('../', import.meta.url));
const option = process.argv.indexOf('--out');
if (option < 0 || !process.argv[option + 1]) throw new Error('请显式指定 ZIP 输出：npm run package -- --out releases/theme.zip');
const files = { 'theme.json': new Uint8Array(await readFile(resolve(root, 'theme.json'))) };
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) await collect(resolve(directory, entry.name), name + '/');
    else if (entry.isFile()) files[name] = new Uint8Array(await readFile(resolve(directory, entry.name)));
  }
}
await collect(resolve(root, 'dist'));
const output = resolve(process.cwd(), process.argv[option + 1]);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, zipSync(files, { level: 6 }));
console.log('主题 ZIP 已生成：' + output);
