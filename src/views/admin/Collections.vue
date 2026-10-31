<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminApi, assetUrl } from '../../api'
import { revealFrom } from '../../lib/gsap'

const list = ref([])
const loading = ref(false)

// 新建 / 编辑合集弹窗
const formDialog = ref(false)
const editing = ref(null) // null = 新建
const form = ref({ title: '', description: '', cover_url: '' })
function openCreate() {
  editing.value = null
  form.value = { title: '', description: '', cover_url: '' }
  formDialog.value = true
}
function openEdit(row) {
  editing.value = row
  form.value = {
    title: row.title,
    description: row.description || '',
    cover_url: row.cover_url || '',
  }
  formDialog.value = true
}
async function submitForm() {
  if (!form.value.title.trim()) return ElMessage.warning('请填写合集标题')
  const data = {
    title: form.value.title.trim(),
    description: form.value.description.trim(),
    cover_url: form.value.cover_url.trim(),
  }
  try {
    if (editing.value) {
      await adminApi.updateCollection(editing.value.id, data)
      ElMessage.success('已更新')
    } else {
      await adminApi.createCollection(data)
      ElMessage.success('已创建')
    }
    formDialog.value = false
    load()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除合集「${row.title}」？其下视频不会被删除，但会移出合集并清空集数。`,
      '删除确认',
      { type: 'warning' },
    )
    await adminApi.removeCollection(row.id)
    ElMessage.success('已删除')
    load()
  } catch {}
}

// 管理剧集弹窗
const manageDialog = ref(false)
const manageCol = ref(null)
const members = ref([])
const memberLoading = ref(false)
async function openManage(row) {
  manageCol.value = row
  manageDialog.value = true
  await loadMembers()
}
async function loadMembers() {
  if (!manageCol.value) return
  memberLoading.value = true
  try {
    const d = await adminApi.collectionVideos(manageCol.value.id)
    members.value = d.list
  } finally {
    memberLoading.value = false
  }
}
async function removeMember(v) {
  try {
    await adminApi.removeCollectionVideo(manageCol.value.id, v.id)
    ElMessage.success(`已移除「${v.title}」`)
    loadMembers()
    load()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 添加未分配视频
const addKeyword = ref('')
const candidates = ref([])
const searchLoading = ref(false)
async function searchUnassigned() {
  searchLoading.value = true
  try {
    const d = await adminApi.videos({
      page: 1,
      size: 20,
      keyword: addKeyword.value.trim() || undefined,
      unassigned: 1,
    })
    candidates.value = d.list
  } finally {
    searchLoading.value = false
  }
}
async function addMember(v) {
  try {
    await adminApi.addCollectionVideo(manageCol.value.id, { video_id: v.id, episode: members.value.length + 1 })
    ElMessage.success(`已加入「${v.title}」为第 ${members.value.length + 1} 集`)
    candidates.value = candidates.value.filter((c) => c.id !== v.id)
    loadMembers()
    load()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function load() {
  loading.value = true
  try {
    const d = await adminApi.collections()
    list.value = d.list
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  const node = document.querySelector('.admin-page')
  if (node) revealFrom(node, { y: 24, ease: 'back.out(1.4)' })
  load()
})
</script>

<template>
  <div class="admin-page">
    <div class="head-row">
      <h1 class="page-title">合集管理</h1>
      <button class="btn btn-primary" @click="openCreate">+ 新建合集</button>
    </div>

    <div class="table-wrap">
      <el-table :data="list" v-loading="loading" empty-text="暂无合集，点击右上角新建">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column label="合集" min-width="220">
          <template #default="{ row }">
            <div class="col-cell">
              <img
                :src="assetUrl(row.cover_url || row.first_cover)"
                class="col-cover"
                alt=""
                @error="(e) => (e.target.style.display = 'none')"
              />
              <div>
                <div class="col-name">{{ row.title }}</div>
                <div class="col-sub">{{ row.episode_count }} 集 · 共 {{ row.video_count }} 个视频</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="简介" min-width="200">
          <template #default="{ row }">
            <span class="col-desc">{{ row.description || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="success" text @click="openManage(row)">管理剧集</el-button>
            <el-button size="small" type="primary" text @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" text @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 新建 / 编辑合集 -->
    <el-dialog v-model="formDialog" :title="editing ? '编辑合集' : '新建合集'" width="480px">
      <div class="dialog-form">
        <div class="field">
          <label>标题</label>
          <input v-model="form.title" class="input" type="text" maxlength="80" placeholder="如「爱情公寓」" />
        </div>
        <div class="field">
          <label>简介（可选）</label>
          <textarea v-model="form.description" class="input" placeholder="这个合集讲的是什么…" maxlength="500"></textarea>
        </div>
        <div class="field">
          <label>封面 URL（可选，留空则取第一集封面）</label>
          <input v-model="form.cover_url" class="input" type="text" placeholder="https://…" />
        </div>
      </div>
      <template #footer>
        <el-button @click="formDialog = false">取消</el-button>
        <el-button type="primary" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- 管理剧集 -->
    <el-dialog v-model="manageDialog" :title="`管理剧集 · ${manageCol?.title || ''}`" width="720px">
      <div class="manage-body">
        <div class="manage-section">
          <div class="manage-title">现有剧集（{{ members.length }}）</div>
          <div v-loading="memberLoading" class="member-list">
            <div v-for="v in members" :key="v.id" class="member-row">
              <span class="member-ep">{{ v.episode }}</span>
              <img :src="assetUrl(v.cover_url)" class="member-cover" alt="" @error="(e) => (e.target.style.display = 'none')" />
              <span class="member-title">{{ v.title }}</span>
              <span class="member-sub">{{ v.status === 1 ? '在架' : '下架' }}</span>
              <el-button size="small" type="danger" text @click="removeMember(v)">移出</el-button>
            </div>
            <div v-if="!members.length" class="manage-empty">还没有剧集，从下方添加</div>
          </div>
        </div>

        <div class="manage-section">
          <div class="manage-title">添加未分配视频</div>
          <div class="add-bar">
            <input
              v-model="addKeyword"
              class="input"
              type="text"
              placeholder="搜索标题…"
              @keyup.enter="searchUnassigned"
            />
            <button class="btn" :loading="searchLoading" @click="searchUnassigned">搜索</button>
          </div>
          <div class="member-list">
            <div v-for="v in candidates" :key="v.id" class="member-row">
              <span class="member-ep">+</span>
              <img :src="assetUrl(v.cover_url)" class="member-cover" alt="" @error="(e) => (e.target.style.display = 'none')" />
              <span class="member-title">{{ v.title }}</span>
              <span class="member-sub">→ 第 {{ members.length + 1 }} 集</span>
              <el-button size="small" type="primary" text @click="addMember(v)">加入</el-button>
            </div>
            <div v-if="!candidates.length" class="manage-empty">先点「搜索」加载未分配视频</div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="manageDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.admin-page { padding: 6px 0 40px; }
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.head-row .page-title { margin: 0; }
.table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; margin-top: 20px; }

.col-cell { display: flex; align-items: center; gap: 12px; }
.col-cover {
  width: 88px;
  aspect-ratio: 16/9;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--border);
  background: var(--surface-3);
}
.col-name { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.col-sub { font-size: 12px; color: var(--text-faint); margin-top: 4px; }
.col-desc {
  font-size: 12px;
  color: var(--text-dim);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dialog-form { padding: 4px 2px; }
.dialog-form textarea { min-height: 80px; resize: vertical; }

.manage-body { display: flex; flex-direction: column; gap: 22px; max-height: 60vh; overflow-y: auto; }
.manage-title { font-size: 13px; font-weight: 700; color: var(--text-dim); margin-bottom: 10px; }
.manage-empty { padding: 22px; text-align: center; color: var(--text-faint); font-size: 13px; border: 1px dashed var(--border); border-radius: 8px; }
.member-list { display: flex; flex-direction: column; gap: 8px; min-height: 40px; }
.member-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
}
.member-ep {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-family: var(--font-syne);
  font-weight: 800;
  font-size: 13px;
  border-radius: 8px;
}
.member-cover {
  width: 56px;
  aspect-ratio: 16/9;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--surface-3);
  border: 1px solid var(--border);
}
.member-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.member-sub { font-size: 12px; color: var(--text-faint); flex-shrink: 0; }
.add-bar { display: flex; gap: 8px; margin-bottom: 10px; }
.add-bar .input { flex: 1; }
</style>
