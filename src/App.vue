<script setup>
import { onMounted } from 'vue'
import NavBar from './components/NavBar.vue'
import { useUserStore } from './stores/user'

const userStore = useUserStore()
onMounted(() => userStore.refresh())
</script>

<template>
  <div class="app-shell">
    <NavBar />
    <main class="app-main">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <!-- key 用 path 而非 fullPath：query-only 变化（如播放页 ?t= 进度写入）不应重挂载页面，否则视频会被重置 -->
          <component :is="Component" :key="'v' + $route.path" />
        </transition>
      </router-view>
    </main>
    <footer class="app-footer">
      <span class="eyebrow">夜场 · NIGHTSHOW</span>
      <span class="dot">·</span>
      <span></span>
    </footer>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.app-main {
  flex: 1;
  padding-top: 76px;
  padding-bottom: 60px;
}
.app-footer {
  padding: 26px 24px;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-faint);
  font-size: 12px;
  border-top: 1px solid var(--border);
  background: var(--footer-bg);
}
.app-footer .dot { color: var(--accent); }
</style>
