<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { interactionApi, authApi, formatDuration, assetUrl } from '../api'
import { useUserStore } from '../stores/user'
import VideoCard from '../components/VideoCard.vue'

const userStore = useUserStore()
const router = useRouter()

const tab = ref('uploads')

// 数据
const uploads = ref([])
const favorites = ref([])
const history = ref([])

// 个人资料编辑
const nickname = ref('')
const bio = ref('')
const avatar = ref('')
const oldPwd = ref('')
const newPwd = ref('')

const user = userStore.user

async function loadUploads() {
  const d = await interactionApi.myUploads({ size: 20 })
  uploads.value = d.list
}
async function loadFavorites() {
  const d = await interactionApi.myFavorites({ size: 20 })
  favorites.value = d.list
}
async function loadHistory() {
  const d = await interactionApi.myHistory({ size: 20 })
  history.value = d.list
}

function switchTab(t) {
  tab.value = t
  if (t === 'uploads' && !uploads.value.length) loadUploads()
  if (t === 'favorites' && !favorites.value.length) loadFavorites()
  if (t === 'history' && !history.value.length) loadHistory()
}

async function saveProfile() {
  try {
    const { user: u } = await authApi.updateMe({ nickname: nickname.value, bio: bio.value, avatar: avatar.value })
    userStore.setUser(u)
    ElMessage.success('资料已更新')
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function changePwd() {
  if (newPwd.value.length < 8) return ElMessage.warning('新密码至少 8 位')
  try {
    await authApi.changePassword({ oldPassword: oldPwd.value, newPassword: newPwd.value })
    ElMessage.success('密码已修改')
    oldPwd.value = ''
    newPwd.value = ''
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function clearHistory() {
  try {
    await ElMessageBox.confirm('确定清空观看历史？', '提示', { type: 'warning' })
    await interactionApi.clearHistory()
    history.value = []
    ElMessage.success('已清空')
  } catch {}
}

async function removeVideo(v) {
  try {
    await ElMessageBox.confirm(`删除视频「${v.title}」？`, '提示', { type: 'warning' })
    const { videoApi } = await import('../api')
    await videoApi.remove(v.id)
    uploads.value = uploads.value.filter((x) => x.id !== v.id)
    ElMessage.success('已删除')
  } catch {}
}

function initProfile() {
  nickname.value = userStore.user?.nickname || ''
  bio.value = userStore.user?.bio || ''
  avatar.value = userStore.user?.avatar || ''
}

onMounted(() => {
  loadUploads()
  initProfile()
})
</script>

<template>
  <div class="user container">
    <!-- 用户卡片 -->
    <div class="user-hero reveal">
      <div class="user-hero-avatar">
        <img v-if="user?.avatar" :src="assetUrl(user.avatar)" alt="" />
        <span v-else>{{ (user?.nickname || '?')[0] }}</span>
      </div>
      <div class="user-hero-info">
        <h1 class="display-title">{{ user?.nickname }}</h1>
        <div class="meta-text">@{{ user?.username }} <span v-if="user?.role === 'admin'" class="admin-badge">管理员</span></div>
        <p class="user-bio">{{ user?.bio || '这个人很懒，什么都没写。' }}</p>
      </div>
    </div>

    <!-- 标签页 -->
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'uploads' }" @click="switchTab('uploads')">我的投稿</button>
      <button class="tab" :class="{ active: tab === 'favorites' }" @click="switchTab('favorites')">我的收藏</button>
      <button class="tab" :class="{ active: tab === 'history' }" @click="switchTab('history')">观看历史</button>
      <button class="tab" :class="{ active: tab === 'profile' }" @click="tab = 'profile'">个人资料</button>
    </div>

    <!-- 投稿 -->
    <div v-if="tab === 'uploads'" class="tab-body">
      <div class="upload-rows">
        <div v-for="v in uploads" :key="v.id" class="upload-row">
          <router-link :to="{ name: 'play', params: { id: v.id } }" class="ur-cover">
            <img :src="assetUrl(v.cover_url)" :alt="v.title" loading="lazy" />
            <span class="ur-dur">{{ formatDuration(v.duration) }}</span>
          </router-link>
          <div class="ur-main">
            <router-link :to="{ name: 'play', params: { id: v.id } }" class="ur-title">{{ v.title }}</router-link>
            <div class="meta-text">{{ v.views }} 播放 · {{ v.likes }} 赞 · {{ v.category }}</div>
          </div>
          <button class="btn btn-rose ur-del" @click="removeVideo(v)">删除</button>
        </div>
      </div>
      <div v-if="!uploads.length" class="empty-state">
        <span class="empty-icon">📤</span> 还没有投稿，<router-link to="/upload" class="inline-link">去发布第一个视频</router-link>
      </div>
    </div>

    <!-- 收藏 -->
    <div v-if="tab === 'favorites'" class="tab-body">
      <div class="grid">
        <VideoCard v-for="(v, i) in favorites" :key="v.id" :video="v" :index="i" />
      </div>
      <div v-if="!favorites.length" class="empty-state">
        <span class="empty-icon">⭐</span> 还没有收藏的视频
      </div>
    </div>

    <!-- 历史 -->
    <div v-if="tab === 'history'" class="tab-body">
      <div class="history-head">
        <span class="meta-text">{{ history.length }} 条记录</span>
        <button v-if="history.length" class="btn btn-ghost btn-sm" @click="clearHistory">清空历史</button>
      </div>
      <div class="grid">
        <VideoCard v-for="(v, i) in history" :key="v.id" :video="v" :index="i" show-progress />
      </div>
      <div v-if="!history.length" class="empty-state">
        <span class="empty-icon">🕐</span> 暂无观看记录
      </div>
    </div>

    <!-- 个人资料 -->
    <div v-if="tab === 'profile'" class="tab-body profile-body">
      <div class="profile-form">
        <h3 class="section-title">编辑资料</h3>
        <div class="field">
          <label>昵称</label>
          <input v-model="nickname" class="input" type="text" maxlength="30" />
        </div>
        <div class="field">
          <label>头像 URL</label>
          <input v-model="avatar" class="input" type="text" placeholder="https://…" />
        </div>
        <div class="field">
          <label>个性签名</label>
          <textarea v-model="bio" maxlength="200" placeholder="介绍一下自己"></textarea>
        </div>
        <button class="btn btn-primary" @click="saveProfile">保存资料</button>
      </div>

      <div class="profile-form">
        <h3 class="section-title">修改密码</h3>
        <div class="field">
          <label>原密码</label>
          <input v-model="oldPwd" class="input" type="password" autocomplete="current-password" />
        </div>
        <div class="field">
          <label>新密码</label>
          <input v-model="newPwd" class="input" type="password" autocomplete="new-password" />
        </div>
        <button class="btn btn-rose" @click="changePwd">修改密码</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.user { padding-top: 8px; }

.user-hero {
  display: flex;
  align-items: center;
  gap: 22px;
  background: linear-gradient(120deg, var(--surface), var(--bg-soft));
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 30px 34px;
  margin-bottom: 26px;
}
.user-hero-avatar {
  width: 84px;
  height: 84px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-3);
  display: grid;
  place-items: center;
  font-size: 36px;
  font-weight: 900;
  color: var(--accent);
  border: 3px solid var(--accent-glow);
  flex-shrink: 0;
}
.user-hero-avatar img { width: 100%; height: 100%; object-fit: cover; }
.user-hero-info h1 { font-size: 30px; }
.admin-badge {
  margin-left: 8px;
  font-size: 11px;
  color: var(--accent);
  border: 1px solid var(--accent);
  padding: 1px 8px;
  border-radius: 999px;
}
.user-bio { margin-top: 10px; color: var(--text-dim); font-size: 14px; }

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 24px;
}
.tab {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 15px;
  font-weight: 600;
  padding: 12px 18px;
  position: relative;
  transition: color 0.18s;
}
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); }
.tab.active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 20px;
}

.upload-rows { display: flex; flex-direction: column; gap: 12px; }
.upload-row {
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  transition: border-color 0.2s;
}
.upload-row:hover { border-color: var(--border-strong); }
.ur-cover {
  position: relative;
  width: 180px;
  aspect-ratio: 16/9;
  border-radius: var(--radius-sm);
  overflow: hidden;
  flex-shrink: 0;
}
.ur-cover img { width: 100%; height: 100%; object-fit: cover; }
.ur-dur {
  position: absolute;
  right: 6px;
  bottom: 6px;
  font-family: var(--font-syne);
  font-size: 11px;
  color: #fff;
  background: rgba(0, 0, 0, 0.7);
  padding: 1px 6px;
  border-radius: 5px;
}
.ur-main { flex: 1; min-width: 0; }
.ur-title {
  font-weight: 700;
  font-size: 15px;
  display: block;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ur-title:hover { color: var(--accent-strong); }
.ur-del { flex-shrink: 0; }

.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.profile-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  max-width: 860px;
}
.profile-form {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
}
.section-title { font-size: 17px; margin-bottom: 18px; }
.btn-sm { padding: 6px 14px; font-size: 13px; }
.inline-link { color: var(--accent); font-weight: 700; }

@media (max-width: 760px) {
  .profile-body { grid-template-columns: 1fr; }
  .upload-row { flex-wrap: wrap; }
}
</style>
