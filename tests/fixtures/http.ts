import type { Page } from '@playwright/test';
import { fixtureNodes, fixturePeers, fixtureTasks, fixtureMetrics } from './nodes';
import { fixtureOverview, fixtureReadiness } from './reports.mjs';

/** 浏览器测试只替换网络响应，运行时仍走真实登录和工作台入口。 */
export async function installFixtures(page: Page) {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path.endsWith('/auth/me')) body = { csrf: 'test-csrf' };
    else if (path.endsWith('/nodes')) body = fixtureNodes;
    else if (path.endsWith('/enrollment-tokens')) body = [];
    else if (path.endsWith('/tasks')) body = fixtureTasks;
    else if (path.endsWith('/peer-addresses')) body = fixturePeers;
    else if (path.endsWith('/metrics/overview')) body = { nodes: Object.values(fixtureMetrics()) };
    else if (path.endsWith('/database/overview')) body = fixtureOverview();
    else if (path.endsWith('/storage/readiness')) body = fixtureReadiness();
    else if (path.endsWith('/storage/clusters')) body = { clusters: [], limits: { image_prefix: 'pgsty/silo', filesystem: 'xfs', min_nodes: 4 } };
    else if (path.endsWith('/storage/plans')) { await route.fulfill({ status: 400, json: { error: '请先保存集群定义' } }); return; }
    else if (/\/nodes\/[^/]+\/metrics$/.test(path)) {
      const url = new URL(route.request().url());
      const to = Number(url.searchParams.get('to'));
      const from = Number(url.searchParams.get('from'));
      const step = (to - from) / 120;
      body = { node_id: path.split('/').at(-2), points: Array.from({ length: 120 }, (_, i) => ({
        at: Math.floor(from + i * step), cpu_usage: 20 + 15 * Math.sin(i / 7),
        memory_used: 3.2e9 + 4e8 * Math.sin(i / 11), memory_total: 8e9,
        load1: .4 + .3 * Math.sin(i / 5), net_rx_bytes_per_second: 4e5 + 3e5 * Math.abs(Math.sin(i / 9)),
        net_tx_bytes_per_second: 2e5 + 1.5e5 * Math.abs(Math.sin(i / 13)),
        disk_read_bytes_per_second: 1e5 * Math.abs(Math.sin(i / 17)), disk_write_bytes_per_second: 6e4 * Math.abs(Math.sin(i / 21)),
      })), tier: 'raw', step, truncated: false };
    }
    else if (path.endsWith('/events')) {
      // 保持连接请求挂起，避免一次性响应结束触发断线提示而改变页面布局。
      return;
    } else if (path.endsWith('/themes/active')) body = { console: { short: 'default', settings: {} }, share: { short: 'default', settings: {} }, console_frontend: { short: 'web' } };
    else {
      await route.fulfill({ status: 404, json: { error: '测试夹具未定义此接口' } });
      return;
    }
    await route.fulfill({ json: body });
  });
  await page.routeWebSocket('**/api/v1/nodes/*/stream**', socket => {
    const url = new URL(socket.url());
    if (url.searchParams.get('kind') === 'file_list') {
      socket.send(Buffer.from(JSON.stringify({ path: url.searchParams.get('path'), entries: [
        { name: 'etc', kind: 'dir', size: 4096, modified: 0, readonly: false },
        { name: 'opt', kind: 'dir', size: 4096, modified: 0, readonly: false },
        { name: 'app.log', kind: 'file', size: 20480, modified: 0, readonly: false },
        { name: 'link', kind: 'symlink', size: 12, modified: 0, readonly: false },
      ] })).toString('base64'));
      socket.close();
    } else {
      socket.onMessage(() => socket.send(Buffer.from('接口夹具：终端连接已建立\r\n').toString('base64')));
    }
  });
}
