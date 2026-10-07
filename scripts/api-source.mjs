/** 获取唯一官方契约的固定版本，不依赖相邻仓库。 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const { opsd } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const response = await fetch('https://raw.githubusercontent.com/opsd-labs/opsd/' + opsd.api_ref + '/docs/api/openapi.yaml');
if (!response.ok) throw new Error('读取固定版本的官方契约失败：' + response.status);
await mkdir(new URL('.cache/', root), { recursive: true });
await writeFile(new URL('.cache/openapi.yaml', root), await response.text(), 'utf8');
console.log('已获取官方契约版本 ' + opsd.api_ref);
