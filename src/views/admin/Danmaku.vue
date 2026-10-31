<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminApi, formatDuration, timeAgo } from '../../api'
import { revealFrom } from '../../lib/gsap'

const router = useRouter()
const list = ref([])
const total = ref(0)
const page = ref(1)
const size = 10
const videoId = ref('')
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const d = await adminApi.danmaku({
      page: page.value,
      size,
      videoId: videoId.value || undefined,
    })
    list.value = d.list
    total.value = d.total
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  const node = document.querySelector('.admin-page')
  if (node) revealFrom(node, { y: 24, ease: 'back.out(1.4)' })
  load()
})

function search() {
  page.value = 1
  load()
}

async function remove(d) {
  try {
    await ElMessageBox.confirm(`删除弹幕「${d.text}」？`, '删除确认', { type: 'warning' })
    await adminApi.removeDanmaku(d.id)
    ElMessage.success('已删除')
    load()
  } catch {}
}

const fmtTime = (ts) => timeAgo(ts)
</script>

<template>
  <div class="admin-page">
    <h1 class="page-title">弹幕管理</h1>

    <div class="toolbar">
      <input v-model="videoId" class="input" type="number" placeholder="按视频 ID 筛选（可选）" @keyup.enter="search" />
      <button class="btn" @click="search">筛选</button>
      <span class="total-text">共 {{ total }} 条弹幕</span>
    </div>

    <div class="table-wrap">
      <el-table :data="list" v-loading="loading" empty-text="暂无弹幕">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column label="弹幕" min-width="200">
          <template #default="{ row }">
            <span class="dm-text" :style="{ color: row.color }">{{ row.text }}</span>
          </template>
        </el-table-column>
        <el-table-column label="时间点" width="90">
          <template #default="{ row }">
            <span class="dm-time">{{ formatDuration(row.time) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="位置" width="80">
          <template #default="{ row }">{{ ['滚动', '顶部', '底部'][row.position] }}</template>
        </el-table-column>
        <el-table-column label="所属视频" min-width="160">
          <template #default="{ row }">
            <span class="video-link" @click="router.push({ name: 'play', params: { id: row.video_id } })">
              #{{ row.video_id }} {{ row.video_title }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="110">
          <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="danger" text @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pager">
      <el-pagination
        layout="prev, pager, next"
        :total="total"
        :page-size="size"
        :current-page="page"
        background
        @current-change="(p) => { page = p; load() }"
      />
    </div>
  </div>
</template>

<style scoped>
.admin-page { padding: 6px 0 40px; }
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0;
}
.toolbar .input { max-width: 220px; }
.total-text { font-size: 13px; color: var(--text-faint); margin-left: auto; }
.table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.dm-text { font-weight: 700; }
.dm-time { font-family: var(--font-syne); font-size: 13px; color: var(--text-dim); }
.video-link { color: var(--text-dim); cursor: pointer; font-size: 13px; }
.video-link:hover { color: var(--accent-strong); }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
