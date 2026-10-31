<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminApi, timeAgo } from '../../api'
import { revealFrom } from '../../lib/gsap'

const list = ref([])
const total = ref(0)
const page = ref(1)
const size = 10
const keyword = ref('')
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const d = await adminApi.users({ page: page.value, size, keyword: keyword.value })
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

async function toggleBan(u) {
  try {
    if (u.status === 1) {
      await ElMessageBox.confirm(`确定封禁用户「${u.nickname}」？封禁后无法登录。`, '封禁确认', { type: 'warning' })
      await adminApi.banUser(u.id)
    } else {
      await adminApi.unbanUser(u.id)
    }
    ElMessage.success(u.status === 1 ? '已封禁' : '已解封')
    load()
  } catch {}
}

async function toggleRole(u) {
  try {
    await ElMessageBox.confirm(`确定将「${u.nickname}」设为${u.role === 'admin' ? '普通用户' : '管理员'}？`, '权限变更', { type: 'warning' })
    await adminApi.setRole(u.id, u.role === 'admin' ? 'user' : 'admin')
    ElMessage.success('权限已更新')
    load()
  } catch {}
}

const fmt = (ts) => timeAgo(ts)
</script>

<template>
  <div class="admin-page">
    <h1 class="page-title">用户管理</h1>

    <div class="toolbar">
      <input v-model="keyword" class="input" type="text" placeholder="搜索用户名 / 昵称…" @keyup.enter="search" />
      <button class="btn" @click="search">搜索</button>
      <span class="total-text">共 {{ total }} 位用户</span>
    </div>

    <div class="table-wrap">
      <el-table :data="list" v-loading="loading" empty-text="暂无用户">
        <el-table-column prop="id" label="ID" width="64" />
        <el-table-column label="用户" min-width="160">
          <template #default="{ row }">
            <div class="user-cell">
              <span class="cell-avatar">{{ (row.nickname || '?')[0] }}</span>
              <div>
                <div class="cell-name">
                  {{ row.nickname }}
                  <span v-if="row.role === 'admin'" class="tag-admin">管理</span>
                  <span v-if="row.status === 0" class="tag-banned">已封禁</span>
                </div>
                <div class="cell-sub">@{{ row.username }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="video_count" label="投稿" width="80" />
        <el-table-column label="注册时间" min-width="120">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :type="row.role === 'admin' ? 'info' : 'primary'" text @click="toggleRole(row)">
              {{ row.role === 'admin' ? '取消管理' : '设为管理' }}
            </el-button>
            <el-button size="small" :type="row.status === 1 ? 'danger' : 'success'" text @click="toggleBan(row)">
              {{ row.status === 1 ? '封禁' : '解封' }}
            </el-button>
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
.toolbar .input { max-width: 300px; }
.total-text { font-size: 13px; color: var(--text-faint); margin-left: auto; }
.table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.user-cell { display: flex; align-items: center; gap: 10px; }
.cell-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--surface-3);
  display: grid;
  place-items: center;
  font-weight: 900;
  color: var(--accent);
  flex-shrink: 0;
}
.cell-name { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px; }
.cell-sub { font-size: 12px; color: var(--text-faint); }
.tag-admin { font-size: 11px; color: var(--accent); border: 1px solid var(--accent); padding: 0 6px; border-radius: 4px; }
.tag-banned { font-size: 11px; color: var(--accent-rose); border: 1px solid var(--accent-rose); padding: 0 6px; border-radius: 4px; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
