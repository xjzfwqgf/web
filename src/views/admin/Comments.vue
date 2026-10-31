<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminApi, timeAgo } from '../../api'
import { revealFrom } from '../../lib/gsap'

const router = useRouter()
const list = ref([])
const total = ref(0)
const page = ref(1)
const size = 10
const keyword = ref('')
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const d = await adminApi.comments({ page: page.value, size, keyword: keyword.value })
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

async function remove(c) {
  try {
    await ElMessageBox.confirm('确定删除这条评论？', '删除确认', { type: 'warning' })
    await adminApi.removeComment(c.id)
    ElMessage.success('已删除')
    load()
  } catch {}
}

const fmt = (ts) => timeAgo(ts)
</script>

<template>
  <div class="admin-page">
    <h1 class="page-title">评论管理</h1>

    <div class="toolbar">
      <input v-model="keyword" class="input" type="text" placeholder="搜索评论内容…" @keyup.enter="search" />
      <button class="btn" @click="search">搜索</button>
      <span class="total-text">共 {{ total }} 条评论</span>
    </div>

    <div class="table-wrap">
      <el-table :data="list" v-loading="loading" empty-text="暂无评论">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column label="内容" min-width="260">
          <template #default="{ row }">
            <div class="content-cell">
              <span v-if="row.parent_id" class="reply-tag">回复</span>
              {{ row.content }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="作者" width="120">
          <template #default="{ row }">{{ row.author }}</template>
        </el-table-column>
        <el-table-column label="所属视频" min-width="160">
          <template #default="{ row }">
            <span class="video-link" @click="router.push({ name: 'play', params: { id: row.video_id } })">{{ row.video_title }}</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="110">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
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
.toolbar .input { max-width: 280px; }
.total-text { font-size: 13px; color: var(--text-faint); margin-left: auto; }
.table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.content-cell { display: flex; align-items: center; gap: 8px; }
.reply-tag { font-size: 11px; color: var(--accent); border: 1px solid var(--accent); padding: 0 6px; border-radius: 4px; flex-shrink: 0; }
.video-link { color: var(--text-dim); cursor: pointer; font-size: 13px; }
.video-link:hover { color: var(--accent-strong); }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
