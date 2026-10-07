<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useWorkspace } from "../workspace";
import { api } from "../api";
import Button from "../components/ui/Button.vue";
import Notice from "../components/ui/Notice.vue";
import Status from "../components/ui/Status.vue";
import Tag from "../components/ui/Tag.vue";
import StatusBar from "../components/resources/StatusBar.vue";
import { Activity, RefreshCw } from "lucide-vue-next";
import {
  dbAgeHeader,
  dbBinlog,
  dbBytes,
  dbDuration,
  dbLatency,
  dbOnOff,
  dbRatio,
  dbSince,
  dbToneColor,
  dbToneText,
  dbUntil,
  dbValue,
} from "../databasePresentation";

/**
 * 数据库只读运维视图。
 *
 * 这一页回答的问题是「五节点 Galera 集群现在到底怎么样」，因此：
 *
 * - **只读**：页面上没有任何写入口。不建库、不建用户、不改配置、不触发 SST、
 *   不 kill 查询。语句固定在 Agent 里，主控无法影响它们。
 * - **未知是一等状态**：连不上、没配置、没权限都显示「未知」并给出原因，
 *   绝不退化成 0 或「正常」。把采集失败显示成平静的绿色，是运维视图最危险的假象。
 * - **结论在控制台**：阈值与告警规则一致，所以这一页与告警不会互相矛盾。
 */
type Finding = {
  tone: "ok" | "warning" | "critical";
  title: string;
  detail: string;
};
type Section<T> = { data: T | null; reason: string | null };
type Galera = {
  cluster_status: string;
  cluster_size: number | null;
  expected_cluster_size: number;
  local_state: number | null;
  local_state_comment: string;
  ready: boolean | null;
  connected: boolean | null;
  desync: boolean | null;
  flow_control_paused: number | null;
  last_committed: number | null;
  recv_queue: number | null;
  send_queue: number | null;
  cert_failures: number | null;
  bf_aborts: number | null;
  cluster_state_uuid: string | null;
  node_uuid: string | null;
  sst_donor: string | null;
  provider_version: string | null;
  incoming: string[];
};
type DbHost = {
  version: string;
  version_comment: string;
  hostname: string | null;
  server_id: number | null;
  uptime: number | null;
  threads_connected: number | null;
  threads_running: number | null;
  read_only: boolean | null;
  binlog_file: string | null;
  binlog_position: number | null;
};
type Server = {
  hostgroup_id: number;
  hostname: string;
  port: number;
  status: string;
  weight: number;
  max_connections: number;
  latency_us: number | null;
  queries: number | null;
  conn_used: number | null;
  conn_free: number | null;
};
type Pool = {
  hostgroup: number;
  srv_host: string;
  srv_port: number;
  conn_used: number | null;
  conn_free: number | null;
  conn_err: number | null;
  queries: number | null;
  latency_us: number | null;
};
type Digest = {
  digest: string;
  hostgroup: number;
  schemaname: string;
  count_star: number;
  sum_time: number;
  max_time: number;
};
type ProxySql = {
  version: string | null;
  uptime: number | null;
  writer_online: number | null;
  backup_writer_online: number | null;
  servers: Server[];
  pools: Pool[];
  digests: Digest[];
};
type Tier = {
  tier: string;
  last_success: number | null;
  age_seconds: number | null;
  size_bytes: number | null;
  directory: string;
  files: number;
  has_checksums: boolean;
  age_header_ok: boolean | null;
};
type Backup = {
  root: string;
  tiers: Tier[];
  next_run: number | null;
  last_trigger: number | null;
};
type Report = {
  collected_at: number;
  configured: boolean;
  galera: Section<Galera>;
  host: Section<DbHost>;
  proxysql: Section<ProxySql>;
  backup: Section<Backup>;
  gaps: string[];
};
type NodeVerdict = {
  node_id: string;
  name: string;
  online: boolean;
  collected_at: number | null;
  configured: boolean;
  tone: "ok" | "warning" | "critical";
  findings: Finding[];
  unknown: string[];
  report: Report | null;
};
type Overview = {
  generated_at: number;
  nodes: NodeVerdict[];
  checks: Finding[];
  summary: string;
  expected_cluster_size: number;
  tone: "ok" | "warning" | "critical";
  unknown_count: number;
};

const w = useWorkspace();
const overview = ref<Overview | null>(null);
const error = ref("");
const notice = ref("");
const busy = ref(false);
const expanded = ref("");

/* 展示规则集中在 databasePresentation.ts：那里的单元测试守着
   「未知不等于 0，也不等于正常」这条约束，页面只负责调用。 */
const toneOf = dbToneColor;
const toneText = dbToneText;
const value = dbValue;
const onOff = dbOnOff;
const duration = dbDuration;
const since = dbSince;
const until = dbUntil;
const bytes = dbBytes;
const latency = dbLatency;
const ratio = dbRatio;
const binlog = dbBinlog;
const ageHeader = dbAgeHeader;

/** 顶栏汇总只统计**已知**的节点，未知单独计数。 */
const counts = computed(() => {
  const nodes = overview.value?.nodes || [];
  const reports = nodes
    .map((node) => node.report?.galera.data)
    .filter((galera): galera is Galera => !!galera);
  return {
    total: nodes.length,
    inspected: nodes.filter((node) => node.collected_at).length,
    synced: reports.filter(
      (galera) => galera.ready === true && galera.local_state === 4,
    ).length,
    notReady: reports.filter(
      (galera) => galera.ready === false || galera.local_state !== 4,
    ).length,
    writers: nodes
      .map((node) => node.report?.proxysql.data?.writer_online)
      .filter((value): value is number => value !== null && value !== undefined),
    backup: (() => {
      const ages = nodes
        .flatMap((node) => node.report?.backup.data?.tiers || [])
        .filter((tier) => tier.tier === "hourly")
        .map((tier) => tier.age_seconds)
        .filter((age): age is number => age !== null && age !== undefined);
      return ages.length ? Math.min(...ages) : null;
    })(),
  };
});

async function load() {
  busy.value = true;
  error.value = "";
  try {
    overview.value = await api("/database/overview");
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function inspect(nodeId: string) {
  notice.value = "";
  error.value = "";
  try {
    const result = await api(`/nodes/${nodeId}/db-inspect`, "POST", {
      idempotency_key: crypto.randomUUID(),
    });
    notice.value = `已提交只读巡检任务 ${result.task_id.slice(0, 8)}；执行完成后刷新即可看到结果`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function inspectAll() {
  for (const node of (overview.value?.nodes || []).filter((n) => n.online))
    await inspect(node.node_id);
}

/** 巡检任务状态一变就重新取结论，不必手动刷新。 */
const inspectSignature = computed(() =>
  w.tasks
    .filter((task: any) => task.action?.type === "db_inspect")
    .map((task: any) => `${task.id}:${task.status}`)
    .join(","),
);
watch(inspectSignature, (now, before) => {
  if (before !== undefined && now !== before) load();
});
onMounted(load);

</script>
<template>
  <StatusBar
    ><span
      >已巡检 <strong>{{ counts.inspected }}/{{ counts.total }}</strong></span
    ><Status :tone="counts.notReady ? 'danger' : 'success'"
      >Ready/Synced {{ counts.synced }}</Status
    ><span
      >ProxySQL writer
      <strong>{{ counts.writers.length ? counts.writers.join("/") : "未知" }}</strong></span
    ><span
      >最近小时备份
      <strong>{{ since(counts.backup) }}</strong></span
    ><template #end
      ><Button :disabled="busy" @click="inspectAll"
        ><Activity />全部节点巡检</Button
      ><Button :disabled="busy" @click="load"><RefreshCw />刷新结论</Button></template
    ></StatusBar
  >
  <Notice v-if="error" tone="danger">{{ error }}</Notice>
  <Notice v-if="notice">{{ notice }}</Notice>

  <section v-if="overview" class="storage-verdict">
    <header>
      <Status
        :tone="overview.tone === 'critical' ? 'danger' : overview.tone === 'warning' ? 'warning' : 'success'"
        :mark="overview.tone === 'critical' ? 'failed' : overview.tone === 'warning' ? 'pending' : 'active'"
        >{{ toneText(overview.tone) }}</Status
      >
      <span>{{ overview.summary }}</span>
      <Tag v-if="overview.unknown_count">未知 {{ overview.unknown_count }} 项</Tag>
    </header>
    <p class="muted">
      只读巡检：不建库、不建用户、不改配置、不触发 SST、不 kill
      查询。语句固定在节点侧的 Agent 里，主控无法影响它们；
      只读账号的密码留在节点本机，既不上传也不进审计。判断集中在控制台完成，
      因此每条结论都能被复核。
    </p>
  </section>

  <section v-if="overview?.checks.length" class="storage-checks">
    <h2>跨节点一致性检查</h2>
    <ul>
      <li v-for="check in overview.checks" :key="check.title">
        <Status
          :tone="toneOf(check.tone)"
          :mark="check.tone === 'ok' ? 'active' : check.tone === 'warning' ? 'pending' : 'failed'"
          >{{ check.tone === "critical" ? "异常" : "注意" }}</Status
        >
        <span class="check-name">{{ check.title }}</span>
        <span class="muted">{{ check.detail }}</span>
      </li>
    </ul>
  </section>

  <section class="storage-nodes">
    <h2>逐节点结论</h2>
    <article
      v-for="node in overview?.nodes || []"
      :key="node.node_id"
      class="storage-node db-node"
      :class="{ 'is-unknown': !node.report }"
    >
      <header @click="expanded = expanded === node.node_id ? '' : node.node_id">
        <Status
          :tone="node.report ? toneOf(node.tone) : 'neutral'"
          :mark="node.report ? (node.tone === 'ok' ? 'active' : node.tone === 'warning' ? 'pending' : 'failed') : 'unknown'"
          >{{ node.report ? toneText(node.tone) : "尚未巡检" }}</Status
        >
        <strong>{{ node.name }}</strong>
        <Tag v-if="!node.online">离线</Tag>
        <Tag v-if="node.report && !node.configured">未配置只读账号</Tag>
        <Tag v-if="node.unknown.length">未知 {{ node.unknown.length }} 项</Tag>
        <span class="muted">
          <template v-if="node.report?.galera.data">
            {{ node.report.galera.data.local_state_comment }} ·
            {{ value(node.report.galera.data.cluster_size) }}/{{ node.report.galera.data.expected_cluster_size }} 成员
          </template>
          <template v-else>未采集到集群状态</template>
          <template v-if="node.collected_at"> · {{ since(node.collected_at) }}采集</template>
        </span>
        <span class="spacer"></span>
        <Button
          :disabled="busy || !node.online"
          @click.stop="inspect(node.node_id)"
          ><Activity />巡检</Button
        >
      </header>

      <!-- 未知项必须直接列出来：只显示语气会让人以为"没消息就是好消息" -->
      <ul v-if="node.unknown.length" class="storage-reasons db-unknown">
        <li v-for="reason in node.unknown" :key="reason">{{ reason }}</li>
      </ul>
      <ul v-if="node.findings.length" class="storage-reasons">
        <li v-for="finding in node.findings" :key="finding.title">
          <Status
            :tone="toneOf(finding.tone)"
            :mark="finding.tone === 'warning' ? 'pending' : 'failed'"
            >{{ finding.tone === "critical" ? "异常" : "注意" }}</Status
          >
          <span><strong>{{ finding.title }}</strong>：{{ finding.detail }}</span>
        </li>
      </ul>

      <div v-if="expanded === node.node_id && node.report" class="storage-detail">
        <div>
          <h3>Galera</h3>
          <table v-if="node.report.galera.data" class="file-table">
            <tbody>
              <tr>
                <th>组件状态</th>
                <td>{{ node.report.galera.data.cluster_status }}</td>
                <th>本地状态</th>
                <td>
                  {{ node.report.galera.data.local_state_comment }}（{{
                    value(node.report.galera.data.local_state)
                  }}）
                </td>
              </tr>
              <tr>
                <th>成员数</th>
                <td>
                  {{ value(node.report.galera.data.cluster_size) }} / 期望
                  {{ node.report.galera.data.expected_cluster_size }}
                </td>
                <th>就绪 / 已连接</th>
                <td>
                  {{ onOff(node.report.galera.data.ready) }} /
                  {{ onOff(node.report.galera.data.connected) }}
                </td>
              </tr>
              <tr>
                <th>接收 / 发送队列</th>
                <td>
                  {{ value(node.report.galera.data.recv_queue) }} /
                  {{ value(node.report.galera.data.send_queue) }}
                </td>
                <th>流控暂停</th>
                <td>{{ ratio(node.report.galera.data.flow_control_paused) }}</td>
              </tr>
              <tr>
                <th>认证失败 / BF 中止</th>
                <td>
                  {{ value(node.report.galera.data.cert_failures) }} /
                  {{ value(node.report.galera.data.bf_aborts) }}
                </td>
                <th>SST 捐赠者</th>
                <td>{{ node.report.galera.data.sst_donor || "未指定" }}</td>
              </tr>
              <tr>
                <th>组件 UUID</th>
                <td class="mono">
                  {{ node.report.galera.data.cluster_state_uuid || "未知" }}
                </td>
                <th>节点 UUID</th>
                <td class="mono">{{ node.report.galera.data.node_uuid || "未知" }}</td>
              </tr>
              <tr>
                <th>last_committed</th>
                <td class="mono">{{ value(node.report.galera.data.last_committed) }}</td>
                <th>wsrep 版本</th>
                <td class="muted">{{ node.report.galera.data.provider_version || "未知" }}</td>
              </tr>
            </tbody>
          </table>
          <Notice v-else tone="warning"
            >集群状态未知：{{ node.report.galera.reason || "未说明原因" }}</Notice
          >
          <p v-if="node.report.galera.data?.incoming.length" class="muted mono">
            成员地址：{{ node.report.galera.data.incoming.join("、") }}
          </p>
        </div>

        <div>
          <h3>主机侧</h3>
          <table v-if="node.report.host.data" class="file-table">
            <tbody>
              <tr>
                <th>版本</th>
                <td>
                  {{ node.report.host.data.version }}
                  <span class="muted">{{ node.report.host.data.version_comment }}</span>
                </td>
                <th>主机名</th>
                <td>{{ node.report.host.data.hostname || "未知" }}</td>
              </tr>
              <tr>
                <th>运行时长</th>
                <td>{{ duration(node.report.host.data.uptime) }}</td>
                <th>只读</th>
                <td>{{ onOff(node.report.host.data.read_only) }}</td>
              </tr>
              <tr>
                <th>连接 / 活跃线程</th>
                <td>
                  {{ value(node.report.host.data.threads_connected) }} /
                  {{ value(node.report.host.data.threads_running) }}
                </td>
                <th>binlog 位点</th>
                <td class="mono">
                  {{
                    binlog(
                      node.report.host.data.binlog_file,
                      node.report.host.data.binlog_position,
                    )
                  }}
                </td>
              </tr>
            </tbody>
          </table>
          <Notice v-else tone="warning"
            >主机侧状态未知：{{ node.report.host.reason || "未说明原因" }}</Notice
          >
        </div>

        <div>
          <h3>ProxySQL</h3>
          <template v-if="node.report.proxysql.data">
            <p class="muted">
              在线 writer
              {{ value(node.report.proxysql.data.writer_online) }} · 备用 writer
              {{ value(node.report.proxysql.data.backup_writer_online) }} · 运行
              {{ duration(node.report.proxysql.data.uptime) }}
            </p>
            <table class="file-table">
              <thead>
                <tr>
                  <th>组</th>
                  <th>后端</th>
                  <th>状态</th>
                  <th>权重</th>
                  <th>延迟</th>
                  <th>在用的连接</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="server in node.report.proxysql.data.servers" :key="`${server.hostgroup_id}-${server.hostname}-${server.port}`">
                  <td>{{ server.hostgroup_id }}</td>
                  <td class="mono">{{ server.hostname }}:{{ server.port }}</td>
                  <td>
                    <Status
                      :tone="server.status === 'ONLINE' ? 'success' : 'warning'"
                      :mark="server.status === 'ONLINE' ? 'active' : 'pending'"
                      >{{ server.status }}</Status
                    >
                  </td>
                  <td>{{ server.weight }}</td>
                  <td>{{ latency(server.latency_us) }}</td>
                  <td>{{ value(server.conn_used) }}</td>
                </tr>
              </tbody>
            </table>
            <template v-if="node.report.proxysql.data.digests.length">
              <h4>最重的查询摘要</h4>
              <p class="muted">
                只显示摘要哈希与计数：真实 SQL 正文可能带着用户名、邮箱或令牌，因此不采集也不展示。
              </p>
              <table class="file-table">
                <thead>
                  <tr>
                    <th>摘要</th>
                    <th>库</th>
                    <th>次数</th>
                    <th>总耗时（ms）</th>
                    <th>最大耗时（ms）</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="digest in node.report.proxysql.data.digests" :key="digest.digest">
                    <td class="mono">{{ digest.digest.slice(0, 16) }}</td>
                    <td>{{ digest.schemaname || "—" }}</td>
                    <td>{{ digest.count_star }}</td>
                    <td>{{ (digest.sum_time / 1000).toFixed(0) }}</td>
                    <td>{{ (digest.max_time / 1000).toFixed(0) }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
          </template>
          <Notice v-else tone="warning"
            >ProxySQL 未知：{{ node.report.proxysql.reason || "未说明原因" }}</Notice
          >
        </div>

        <div>
          <h3>备份链路</h3>
          <template v-if="node.report.backup.data">
            <p class="muted">
              根目录 <code class="mono">{{ node.report.backup.data.root }}</code> · 下次触发
              {{ until(node.report.backup.data.next_run) }}
            </p>
            <table class="file-table">
              <thead>
                <tr>
                  <th>层级</th>
                  <th>最近成功</th>
                  <th>体积</th>
                  <th>归档</th>
                  <th>校验清单</th>
                  <th>age 头部</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="tier in node.report.backup.data.tiers" :key="tier.tier">
                  <td>{{ tier.tier }}</td>
                  <td>{{ since(tier.last_success) }}</td>
                  <td>{{ bytes(tier.size_bytes) }}</td>
                  <td>{{ tier.files ? `${tier.files} 个` : "无" }}</td>
                  <td>{{ tier.files ? (tier.has_checksums ? "有" : "缺失") : "—" }}</td>
                  <td>{{ ageHeader(tier.age_header_ok) }}</td>
                </tr>
              </tbody>
            </table>
            <p class="muted">
              只检查归档头部是不是 age 格式：解密私钥按设计不在节点上，因此这里不做解密校验，
              也不谎称做过。
            </p>
          </template>
          <Notice v-else tone="warning"
            >备份链路未知：{{ node.report.backup.reason || "未说明原因" }}</Notice
          >
        </div>
      </div>
    </article>
    <Notice v-if="overview && !overview.nodes.length">还没有已登记的节点。</Notice>
  </section>

  <Notice v-if="overview && overview.unknown_count" tone="warning"
    >本页有 {{ overview.unknown_count }} 项未知。未知不是正常，也不等于
    0：请先触发巡检或补齐只读账号配置，再做判断。</Notice
  >
</template>
<style scoped>
.db-node > header {
  flex-wrap: wrap;
}
.db-unknown li {
  color: var(--warning-text, inherit);
}
.spacer {
  flex: 1;
}
.storage-detail h4 {
  font-size: 12px;
  margin: 10px 0 4px;
}
</style>
