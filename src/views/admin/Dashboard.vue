<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { adminApi, formatCount, timeAgo } from '../../api'
import { revealFrom } from '../../lib/gsap'

const stats = ref(null)
const byCategory = ref([])
const topVideos = ref([])
const recentUsers = ref([])

onMounted(async () => {
  const data = await adminApi.stats()
  stats.value = data.stats
  byCategory.value = data.byCategory
  topVideos.value = data.topVideos
  recentUsers.value = data.recentUsers
  // 等 `.dashboard`（v-if=stats）渲染后再做弹簧进场
  await nextTick()
  const node = document.querySelector('.dashboard')
  if (node) revealFrom(node, { y: 24, ease: 'back.out(1.4)' })
})

const maxCat = () => Math.max(1, ...byCategory.value.map((c) => c.count))
</script>

<template>
  <div class="dashboard" v-if="stats">
    <h1 class="page-title">数据总览</h1>

    <!-- 统计卡片 -->
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-icon">👥</div>
        <div class="stat-num">{{ stats.userCount }}</div>
        <div class="stat-label">注册用户<span class="stat-sub">今日 +{{ stats.todayRegisters }}</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🎬</div>
        <div class="stat-num">{{ stats.videoCount }}</div>
        <div class="stat-label">视频总数</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">▶</div>
        <div class="stat-num">{{ formatCount(stats.totalViews) }}</div>
        <div class="stat-label">累计播放</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">💬</div>
        <div class="stat-num">{{ stats.commentCount }}</div>
        <div class="stat-label">评论<span class="stat-sub">弹幕 {{ stats.danmakuCount }}</span></div>
      </div>
    </div>

    <div class="dash-grid">
      <!-- 分类分布 -->
      <div class="panel">
        <h3 class="panel-title">分类分布</h3>
        <div v-for="c in byCategory" :key="c.category" class="cat-bar-row">
          <span class="cat-bar-name">{{ c.category }}</span>
          <div class="cat-bar-track">
            <div class="cat-bar-fill" :style="{ width: (c.count / maxCat()) * 100 + '%' }"></div>
          </div>
          <span class="cat-bar-count">{{ c.count }}</span>
        </div>
        <div v-if="!byCategory.length" class="empty-state"><span class="empty-icon">📭</span> 暂无数据</div>
      </div>

      <!-- 热门视频 -->
      <div class="panel">
        <h3 class="panel-title">热门视频 TOP5</h3>
        <div v-for="(v, i) in topVideos" :key="v.id" class="top-row">
          <span class="top-rank" :class="{ 'top-1': i === 0 }">{{ i + 1 }}</span>
          <div class="top-main">
            <div class="top-title">{{ v.title }}</div>
            <div class="meta-text">by {{ v.author }} · {{ formatCount(v.views) }} 播放</div>
          </div>
        </div>
        <div v-if="!topVideos.length" class="empty-state"><span class="empty-icon">📭</span> 暂无数据</div>
      </div>
    </div>

    <!-- 最新注册 -->
    <div class="panel">
      <h3 class="panel-title">最新注册用户</h3>
      <div class="user-list">
        <div v-for="u in recentUsers" :key="u.id" class="recent-user">
          <span class="recent-avatar">{{ (u.nickname || '?')[0] }}</span>
          <div>
            <div class="recent-name">{{ u.nickname }} <span class="admin-tag" v-if="u.role === 'admin'">管理</span><span class="banned-tag" v-if="u.status === 0">已封禁</span></div>
            <div class="meta-text">{{ timeAgo(u.created_at) }} · @{{ u.username }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard { padding: 6px 0 40px; }

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin: 24px 0;
}
.stat-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  transition: transform 0.2s, border-color 0.2s;
}
.stat-card:hover { transform: translateY(-3px); border-color: var(--accent-glow); }
.stat-icon { font-size: 22px; margin-bottom: 10px; }
.stat-num {
  font-family: var(--font-syne);
  font-size: 32px;
  font-weight: 800;
  line-height: 1;
  color: var(--accent);
}
.stat-label { margin-top: 8px; font-size: 13px; color: var(--text-dim); }
.stat-sub { display: block; font-size: 12px; color: var(--text-faint); margin-top: 2px; }

.dash-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}
.panel-title {
  font-size: 15px;
  margin-bottom: 16px;
  color: var(--text);
}

.cat-bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.cat-bar-name { width: 44px; font-size: 13px; color: var(--text-dim); flex-shrink: 0; }
.cat-bar-track { flex: 1; height: 8px; border-radius: 8px; background: var(--surface-3); overflow: hidden; }
.cat-bar-fill {
  height: 100%;
  border-radius: 8px;
  background: var(--accent);
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}
.cat-bar-count { font-family: var(--font-syne); font-size: 13px; color: var(--text-dim); width: 30px; text-align: right; }

.top-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px dashed var(--border); }
.top-row:last-child { border-bottom: none; }
.top-rank {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  font-family: var(--font-syne);
  font-weight: 800;
  font-size: 13px;
  background: var(--surface-3);
  color: var(--text-dim);
  flex-shrink: 0;
}
.top-rank.top-1 { background: var(--accent); color: var(--accent-text); }
.top-main { flex: 1; min-width: 0; }
.top-title { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.user-list { display: flex; flex-direction: column; }
.recent-user { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
.recent-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--surface-3);
  display: grid;
  place-items: center;
  font-weight: 900;
  color: var(--accent);
}
.recent-name { font-size: 14px; font-weight: 600; }
.admin-tag { font-size: 11px; color: var(--accent); margin-left: 6px; }
.banned-tag { font-size: 11px; color: var(--accent-rose); margin-left: 6px; }

@media (max-width: 860px) {
  .dash-grid { grid-template-columns: 1fr; }
}
</style>
