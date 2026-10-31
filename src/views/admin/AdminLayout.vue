<script setup>
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const menus = [
  { name: 'admin-dashboard', label: '数据总览', icon: '📊' },
  { name: 'admin-users', label: '用户管理', icon: '👥' },
  { name: 'admin-videos', label: '视频管理', icon: '🎬' },
  { name: 'admin-collections', label: '合集管理', icon: '📚' },
  { name: 'admin-comments', label: '评论管理', icon: '💬' },
  { name: 'admin-danmaku', label: '弹幕管理', icon: '💭' },
]
</script>

<template>
  <div class="admin-layout">
    <aside class="admin-side">
      <router-link to="/" class="admin-brand">
        <span class="admin-logo">▶</span>
        <div>
          <div class="admin-brand-name">夜场后台</div>
          <div class="admin-brand-sub">NIGHTSHOW CONSOLE</div>
        </div>
      </router-link>

      <nav class="admin-nav">
        <button
          v-for="m in menus"
          :key="m.name"
          class="admin-nav-item"
          :class="{ active: route.name === m.name }"
          @click="router.push({ name: m.name })"
        >
          <span class="nav-icon">{{ m.icon }}</span>
          {{ m.label }}
        </button>
      </nav>

      <div class="admin-foot">
        <router-link to="/" class="admin-back">← 返回前台</router-link>
      </div>
    </aside>

    <main class="admin-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.admin-layout {
  min-height: calc(100vh - 76px);
  display: flex;
  gap: 26px;
  padding: 0 24px;
  max-width: 1400px;
  margin: 0 auto;
}
.admin-side {
  width: 220px;
  flex-shrink: 0;
  position: sticky;
  top: 96px;
  align-self: flex-start;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 480px;
}
.admin-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 8px;
}
.admin-logo {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-xs);
  background: var(--accent);
  color: var(--accent-text);
  font-size: 16px;
  box-shadow: 0 4px 14px var(--accent-glow);
}
.admin-brand-name { font-weight: 900; font-size: 16px; }
.admin-brand-sub {
  font-family: var(--font-syne);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--text-faint);
}
.admin-nav { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.admin-nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 14px;
  font-weight: 600;
  padding: 12px 14px;
  border-radius: var(--radius-xs);
  text-align: left;
  transition: all 0.15s;
}
.admin-nav-item:hover { color: var(--text); background: var(--surface-2); }
.admin-nav-item.active {
  color: var(--accent);
  background: var(--accent-soft);
}
.nav-icon { width: 20px; text-align: center; }
.admin-back {
  display: block;
  text-align: center;
  padding: 12px;
  color: var(--text-dim);
  font-size: 13px;
  border-top: 1px solid var(--border);
  transition: color 0.15s;
}
.admin-back:hover { color: var(--accent); }

.admin-main {
  flex: 1;
  min-width: 0;
}

@media (max-width: 860px) {
  .admin-layout { flex-direction: column; }
  .admin-side { position: static; width: 100%; min-height: auto; }
  .admin-nav { flex-direction: row; flex-wrap: wrap; }
  .admin-foot { display: none; }
}
</style>
