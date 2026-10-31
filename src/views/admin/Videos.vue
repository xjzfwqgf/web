<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminApi, formatCount, timeAgo, assetUrl } from '../../api'
import { revealFrom } from '../../lib/gsap'

const router = useRouter()

const list = ref([])
const total = ref(0)
const page = ref(1)
const size = 10
const keyword = ref('')
const statusFilter = ref(null)
const loading = ref(false)

const categories = ['生活', '游戏', '科技', '音乐', '影视', '动画', '学习', '搞笑', '运动', '其他']

// 编辑弹窗
const editDialog = ref(false)
const editing = ref(null)
function openEdit(row) {
  editing.value = {
    id: row.id,
    title: row.title,
    category: row.category,
    collection_id: row.collection_id ?? '',
    episode: row.episode || 1,
  }
  editDialog.value = true
}
async function submitEdit() {
  const e = editing.value
  try {
    await adminApi.updateVideo(e.id, {
      title: e.title,
      category: e.category,
      collection_id: e.collection_id === '' ? '' : Number(e.collection_id),
      episode: e.episode,
    })
    ElMessage.success('已更新')
    editDialog.value = false
    load()
  } catch (err) {
    ElMessage.error(err.message)
  }
}

// 批量分配到合集
const selected = ref([])
const collections = ref([])
const batchDialog = ref(false)
const batchCollectionId = ref(null)
const batchStartEpisode = ref(1)
function onSelectionChange(rows) {
  selected.value = rows
}
async function submitBatch() {
  if (!batchCollectionId.value) return ElMessage.warning('请选择合集')
  if (!selected.value.length) return ElMessage.warning('请先勾选要分配的视频')
  try {
    let ep = Math.max(1, parseInt(batchStartEpisode.value) || 1)
    const items = selected.value.map((v) => ({ video_id: v.id, episode: ep++ }))
    await adminApi.assignVideos({ collection_id: batchCollectionId.value, items })
    ElMessage.success(`已把 ${items.length} 个视频分配进合集`)
    batchDialog.value = false
    selected.value = []
    load()
  } catch (err) {
    ElMessage.error(err.message)
  }
}

// 批量删除（勾选多行 → 一次提交，后端用事务级联清理子表）
async function batchRemove() {
  if (!selected.value.length) return ElMessage.warning('请先勾选要删除的视频')
  if (selected.value.length > 200) return ElMessage.warning('单次最多删除 200 个视频，请分批操作')
  const n = selected.value.length
  try {
    await ElMessageBox.confirm(
      `确定永久删除选中的 ${n} 个视频？其评论、弹幕、点赞、收藏、观看记录会一并删除，且不可恢复。`,
      '批量删除确认',
      { type: 'error', confirmButtonText: '全部删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    const d = await adminApi.batchRemoveVideos(selected.value.map((v) => v.id))
    ElMessage.success(d.message || `已删除 ${n} 个视频`)
    selected.value = []
    load()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function load() {
  loading.value = true
  try {
    const d = await adminApi.videos({
      page: page.value,
      size,
      keyword: keyword.value,
      status: statusFilter.value === null ? undefined : statusFilter.value,
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
  adminApi.collections().then((d) => (collections.value = d.list)).catch(() => {})
})

function search() {
  page.value = 1
  load()
}

async function toggleStatus(v) {
  try {
    await adminApi.setVideoStatus(v.id, v.status === 1 ? 0 : 1)
    ElMessage.success(v.status === 1 ? '已下架' : '已上架')
    load()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function remove(v) {
  try {
    await ElMessageBox.confirm(`确定永久删除视频「${v.title}」？该操作不可恢复。`, '删除确认', { type: 'error' })
    await adminApi.removeVideo(v.id)
    ElMessage.success('已删除')
    load()
  } catch {}
}

const fmt = (ts) => timeAgo(ts)
</script>

<template>
  <div class="admin-page">
    <h1 class="page-title">视频管理</h1>

    <div class="toolbar">
      <input v-model="keyword" class="input" type="text" placeholder="搜索标题 / 简介…" @keyup.enter="search" />
      <button class="btn" @click="search">搜索</button>
      <div class="seg">
        <button class="seg-btn" :class="{ active: statusFilter === null }" @click="statusFilter = null; search()">全部</button>
        <button class="seg-btn" :class="{ active: statusFilter === 1 }" @click="statusFilter = 1; search()">在架</button>
        <button class="seg-btn" :class="{ active: statusFilter === 0 }" @click="statusFilter = 0; search()">已下架</button>
      </div>
      <button
        class="btn"
        :disabled="!selected.length"
        @click="batchDialog = true"
      >批量分配到合集<span v-if="selected.length" class="sel-count">({{ selected.length }})</span></button>
      <button
        class="btn btn-danger"
        :disabled="!selected.length"
        @click="batchRemove"
      >批量删除<span v-if="selected.length" class="sel-count">({{ selected.length }})</span></button>
      <span class="total-text">共 {{ total }} 个视频</span>
    </div>

    <div class="table-wrap">
      <el-table :data="list" v-loading="loading" empty-text="暂无视频" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="46" />
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column label="视频" min-width="220">
          <template #default="{ row }">
            <div class="video-cell">
              <img :src="assetUrl(row.cover_url)" class="cell-cover" alt="" @click="router.push({ name: 'play', params: { id: row.id } })" />
              <div>
                <div class="cell-name" @click="router.push({ name: 'play', params: { id: row.id } })">{{ row.title }}</div>
                <div class="cell-sub">{{ row.category }} · by {{ row.author }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="数据" width="150">
          <template #default="{ row }">
            <div class="cell-sub">{{ formatCount(row.views) }} 播放 · {{ formatCount(row.likes) }} 赞</div>
          </template>
        </el-table-column>
        <el-table-column label="合集" width="170">
          <template #default="{ row }">
            <div v-if="row.collection_id" class="cell-collection">
              <span class="col-tag">📚 {{ row.collection_title || '合集' }}</span>
              <span class="col-episode">第{{ row.episode }}集</span>
            </div>
            <span v-else class="cell-faint">未分配</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <span class="status-pill" :class="row.status === 1 ? 'on' : 'off'">{{ row.status === 1 ? '在架' : '下架' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="上传时间" width="110">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" text @click="openEdit(row)">编辑</el-button>
            <el-button size="small" :type="row.status === 1 ? 'info' : 'success'" text @click="toggleStatus(row)">
              {{ row.status === 1 ? '下架' : '上架' }}
            </el-button>
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

    <!-- 编辑视频弹窗 -->
    <el-dialog v-model="editDialog" title="编辑视频" width="480px">
      <div v-if="editing" class="dialog-form">
        <div class="field">
          <label>标题</label>
          <input v-model="editing.title" class="input" type="text" maxlength="80" />
        </div>
        <div class="field">
          <label>分类</label>
          <select v-model="editing.category" class="input">
            <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="field">
          <label>所属合集</label>
          <select v-model="editing.collection_id" class="input">
            <option value="">不加入合集</option>
            <option v-for="c in collections" :key="c.id" :value="c.id">{{ c.title }}</option>
          </select>
        </div>
        <div v-if="editing.collection_id !== ''" class="field">
          <label>集数</label>
          <input v-model.number="editing.episode" class="input" type="number" min="1" />
        </div>
      </div>
      <template #footer>
        <el-button @click="editDialog = false">取消</el-button>
        <el-button type="primary" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量分配到合集弹窗 -->
    <el-dialog v-model="batchDialog" title="批量分配到合集" width="440px">
      <div class="dialog-form">
        <div class="field">
          <label>目标合集</label>
          <select v-model="batchCollectionId" class="input">
            <option :value="null">请选择…</option>
            <option v-for="c in collections" :key="c.id" :value="c.id">{{ c.title }}</option>
          </select>
        </div>
        <div class="field">
          <label>起始集数</label>
          <input v-model.number="batchStartEpisode" class="input" type="number" min="1" />
          <p class="dialog-hint">勾选的 {{ selected.length }} 个视频将按顺序从起始集数递增分配</p>
        </div>
      </div>
      <template #footer>
        <el-button @click="batchDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!selected.length" @click="submitBatch">确认分配</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.admin-page { padding: 6px 0 40px; }
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0;
  flex-wrap: wrap;
}
.toolbar .input { max-width: 280px; }
.total-text { font-size: 13px; color: var(--text-faint); margin-left: auto; }
.seg { display: flex; background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 3px; }
.seg-btn {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
  padding: 5px 14px;
  border-radius: 999px;
}
.seg-btn.active { background: var(--accent); color: var(--accent-text); }
.table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.video-cell { display: flex; align-items: center; gap: 12px; }
.cell-cover {
  width: 96px;
  aspect-ratio: 16/9;
  border-radius: 6px;
  object-fit: cover;
  cursor: pointer;
  flex-shrink: 0;
  border: 1px solid var(--border);
}
.cell-name { font-weight: 600; font-size: 14px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
.cell-name:hover { color: var(--accent-strong); }
.cell-sub { font-size: 12px; color: var(--text-faint); margin-top: 4px; }
.cell-collection { display: flex; flex-direction: column; gap: 3px; }
.col-tag {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-strong);
  background: var(--accent-soft);
  padding: 2px 8px;
  border-radius: 999px;
  align-self: flex-start;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 130px;
}
.col-episode { font-size: 12px; color: var(--text-dim); font-family: var(--font-syne); }
.cell-faint { font-size: 12px; color: var(--text-faint); }
.sel-count { font-family: var(--font-syne); margin-left: 2px; }
.toolbar .btn-danger { color: #f56c6c; border-color: color-mix(in srgb, #f56c6c 45%, transparent); }
.toolbar .btn-danger:hover:not(:disabled) { background: #f56c6c; color: #fff; }
.toolbar .btn-danger:disabled { opacity: 0.45; cursor: not-allowed; }
.dialog-form { padding: 4px 2px; }
.dialog-hint { margin-top: 6px; font-size: 12px; color: var(--text-faint); }
.status-pill { font-size: 12px; padding: 2px 10px; border-radius: 999px; font-weight: 600; }
.status-pill.on { color: var(--accent-green); background: color-mix(in srgb, var(--accent-green) 15%, transparent); }
.status-pill.off { color: var(--text-dim); background: var(--surface-3); }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
