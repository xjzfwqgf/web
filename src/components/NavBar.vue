<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '../stores/user'
import { useThemeStore } from '../stores/theme'
import { videoApi, assetUrl } from '../api'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const themeStore = useThemeStore()

const keyword = ref('')
const categories = ref([])
const showSearch = ref(false)
const showUserMenu = ref(false)
const scrolled = ref(false)

async function loadCategories() {
  try {
    const { list } = await videoApi.categories()
    categories.value = list
  } catch {
    /* 分类加载失败不阻塞 */
  }
}
onMounted(() => {
  loadCategories()
  window.addEventListener('scroll', onScroll)
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
function onScroll() {
  scrolled.value = window.scrollY > 10
}

function submitSearch() {
  const k = keyword.value.trim()
  if (!k) return
  router.push({ name: 'search', query: { keyword: k } })
  if (route.name !== 'search') keyword.value = ''
  showSearch.value = false
}

function goCategory(name) {
  router.push({ name: 'category', params: { name } })
}

function go(v) {
  showUserMenu.value = false
  router.push(v)
}

function logout() {
  userStore.logout()
  showUserMenu.value = false
  if (route.meta.auth || route.meta.admin) router.push({ name: 'home' })
  else router.go(0)
}
</script>

<template>
  <header class="navbar" :class="{ scrolled }">
    <div class="container navbar-inner">
      <router-link to="/" class="logo">
        <span class="logo-mark">▶</span>
        <span class="logo-text">夜场</span>
      </router-link>

      <router-link to="/music" class="music-link" :class="{ active: route.name === 'music' }">
        <span class="music-ico">🎵</span>
        <span>音乐</span>
      </router-link>

      <nav class="cat-nav" v-if="categories.length">
        <button
          v-for="c in categories.slice(0, 6)"
          :key="c.name"
          class="cat-link"
          :class="{ active: route.name === 'category' && route.params.name === c.name }"
          @click="goCategory(c.name)"
        >
          {{ c.name }}
        </button>
      </nav>

      <div class="search-box" :class="{ open: showSearch }">
        <input
          v-model="keyword"
          class="search-input"
          type="text"
          placeholder="搜索视频…"
          @keyup.enter="submitSearch"
          @focus="showSearch = true"
          @blur="showSearch = false"
        />
        <button class="search-btn" @mousedown.prevent="submitSearch">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        </button>
      </div>

      <div class="nav-actions">
        <button
          class="theme-toggle"
          :title="themeStore.theme === 'dark' ? '切换到浅色' : '切换到暗色'"
          :aria-label="themeStore.theme === 'dark' ? '切换到浅色' : '切换到暗色'"
          @click="themeStore.toggle()"
        >
          <span class="theme-ico" :class="{ dim: themeStore.theme === 'light' }">{{ themeStore.theme === 'dark' ? '☀️' : '🌙' }}</span>
        </button>

        <button v-if="userStore.isAdmin()" class="btn btn-primary upload-btn" @click="go({ name: 'upload' })">
          发布视频
        </button>

        <template v-if="userStore.isLoggedIn()">
          <div class="user-menu-wrap">
            <button class="user-avatar-btn" @click="showUserMenu = !showUserMenu">
              <img
                v-if="userStore.user?.avatar"
                :src="assetUrl(userStore.user.avatar)"
                class="avatar-img"
                alt="avatar"
              />
              <span v-else class="avatar-fallback">{{ (userStore.user?.nickname || '?')[0] }}</span>
            </button>
            <transition name="drop">
              <div v-if="showUserMenu" class="user-menu">
                <div class="user-menu-head">
                  <strong>{{ userStore.user?.nickname }}</strong>
                  <span>@{{ userStore.user?.username }}</span>
                </div>
                <button class="menu-item" @click="go({ name: 'user' })">👤 个人中心</button>
                <button v-if="userStore.isAdmin()" class="menu-item" @click="go({ name: 'upload' })">⬆ 发布视频</button>
                <button v-if="userStore.isAdmin()" class="menu-item admin-item" @click="go({ name: 'admin-dashboard' })">⚙ 后台管理</button>
                <div class="menu-sep"></div>
                <button class="menu-item" @click="logout">↪ 退出登录</button>
              </div>
            </transition>
          </div>
        </template>

        <template v-else>
          <button class="btn btn-ghost" @click="go({ name: 'login' })">登录</button>
          <button class="btn btn-primary" @click="go({ name: 'register' })">注册</button>
        </template>
      </div>
    </div>
  </header>
</template>

<style scoped>
.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--nav-bg);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid var(--border);
  transition: border-color 0.3s ease, box-shadow 0.3s ease, background-color 0.3s ease;
}
.navbar.scrolled {
  border-bottom-color: var(--border-strong);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02), 0 8px 24px rgba(0, 0, 0, 0.06);
  background: var(--nav-bg-solid);
}
:global(html[data-theme='dark'] .navbar.scrolled) { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .navbar { background: var(--nav-bg-solid); }
}
.navbar-inner {
  height: 76px;
  display: flex;
  align-items: center;
  gap: 20px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}
.logo-mark {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-xs);
  background: var(--accent);
  color: var(--accent-text);
  font-size: 15px;
  box-shadow: 0 4px 14px var(--accent-glow);
}
.logo-text {
  font-family: var(--font-display);
  font-size: 21px;
  letter-spacing: 0.02em;
}

.music-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--accent-soft);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 14px;
  font-weight: 700;
  transition: all 0.2s ease;
}
.music-link .music-ico { font-size: 15px; line-height: 1; }
.music-link:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: var(--focus-ring);
}
.music-link.active {
  color: var(--accent-text);
  background: var(--accent);
  border-color: transparent;
  box-shadow: 0 4px 14px var(--accent-glow);
}
.music-link.active .music-ico { filter: none; }

.cat-nav {
  display: flex;
  gap: 4px;
  flex: 0 1 auto;
  overflow-x: auto;
  scrollbar-width: none;
}
.cat-nav::-webkit-scrollbar { display: none; }
.cat-link {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 14px;
  font-weight: 600;
  padding: 8px 12px;
  border-radius: 999px;
  white-space: nowrap;
  transition: all 0.18s ease;
  position: relative;
}
.cat-link:hover { color: var(--text); }
.cat-link.active {
  color: var(--accent);
  background: var(--accent-soft);
}
.cat-link.active::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  transition: all 0.25s ease;
  max-width: 440px;
  margin-left: auto;
}
.search-box.open {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
  background: var(--surface-2);
}
.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text);
  padding: 10px 18px;
  font-size: 14px;
  outline: none;
}
.search-btn {
  width: 42px;
  height: 40px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-dim);
  transition: color 0.2s;
}
.search-btn:hover { color: var(--accent); }

.nav-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.upload-btn { padding: 9px 18px; }

.theme-toggle {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text);
  font-size: 16px;
  line-height: 1;
  transition: all 0.2s ease;
}
.theme-toggle:hover {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
  transform: rotate(15deg);
}
.theme-ico { display: inline-block; filter: saturate(1.2); }
.theme-ico.dim { opacity: 0.7; }

.user-menu-wrap { position: relative; }
.user-avatar-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  overflow: hidden;
  padding: 0;
  background: var(--surface-3);
  transition: border-color 0.2s;
}
.user-avatar-btn:hover { border-color: var(--accent); }
.avatar-img { width: 100%; height: 100%; object-fit: cover; }
.avatar-fallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  font-weight: 900;
  color: var(--accent);
}

.user-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  width: 220px;
  background: var(--nav-bg-solid);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-pop);
  padding: 8px;
  overflow: hidden;
  transform-origin: top right;
}
.user-menu-head {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 6px;
}
.user-menu-head strong { font-size: 15px; }
.user-menu-head span { font-size: 12px; color: var(--text-faint); }
.menu-item {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text);
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 14px;
  transition: background 0.15s;
}
.menu-item:hover { background: var(--surface-3); }
.menu-item.admin-item { color: var(--accent); }
.menu-sep { height: 1px; background: var(--border); margin: 6px 4px; }

.drop-enter-active, .drop-leave-active { transition: all 0.2s ease; }
.drop-enter-from, .drop-leave-to { opacity: 0; transform: translateY(-8px); }

@media (max-width: 900px) {
  .cat-nav { display: none; }
}

/* 减少透明度的用户偏好：导航玻璃变实底 */
@media (prefers-reduced-transparency: reduce) {
  .navbar {
    background: var(--nav-bg-solid);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
