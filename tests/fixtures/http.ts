import type { Page } from '@playwright/test';
import { fixtureNodes, fixturePeers, fixtureTasks, fixtureMetrics } from './nodes';

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
    else if (path.endsWith('/events')) {
      await route.fulfill({ contentType: 'text/event-stream', body: ': 就绪\n\n' });
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
      socket.send(Buffer.from('接口夹具：终端连接已建立\r\n').toString('base64'));
    }
  });
}
