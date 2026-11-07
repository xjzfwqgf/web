<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { useThemeStore } from '../stores/theme'
import { assetUrl } from '../api'

const router = useRouter()
const userStore = useUserStore()
const themeStore = useThemeStore()

const showUserMenu = ref(false)

function go(v) {
  showUserMenu.value = false
  router.push(v)
}

function logout() {
  userStore.logout()
  showUserMenu.value = false
  router.push({ name: 'music' })
}
</script>

<template>
  <header class="navbar">
    <div class="container navbar-inner">
      <router-link to="/music" class="logo">
        <span class="logo-mark">♪</span>
        <span class="logo-text">夜场音乐</span>
      </router-link>

      <div class="nav-actions">
        <button
          class="theme-toggle"
          :title="themeStore.theme === 'dark' ? '切换到浅色' : '切换到暗色'"
          :aria-label="themeStore.theme === 'dark' ? '切换到浅色' : '切换到暗色'"
          @click="themeStore.toggle()"
        >
          <span class="theme-ico" :class="{ dim: themeStore.theme === 'light' }">{{ themeStore.theme === 'dark' ? '☀️' : '🌙' }}</span>
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
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .navbar { background: var(--nav-bg-solid); }
}
.navbar-inner {
  height: 64px;
  display: flex;
  align-items: center;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.logo-mark {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: linear-gradient(150deg, #ff5d6c, #fa243c);
  color: #fff;
  font-size: 15px;
  box-shadow: 0 2px 10px rgba(250, 36, 60, 0.28);
}
.logo-text {
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text);
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-left: auto;
}

.theme-toggle {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text);
  font-size: 15px;
  line-height: 1;
  transition: all 0.2s ease;
}
.theme-toggle:hover {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}
.theme-ico { display: inline-block; filter: saturate(1.2); }
.theme-ico.dim { opacity: 0.7; }

.user-menu-wrap { position: relative; }
.user-avatar-btn {
  width: 36px;
  height: 36px;
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

@media (max-width: 720px) {
  .navbar-inner {
    height: 56px;
    padding-left: 14px;
    padding-right: 14px;
  }
  .logo { gap: 8px; }
  .logo-mark { width: 28px; height: 28px; font-size: 13px; border-radius: 8px; }
  .logo-text { font-size: 17px; }
  .nav-actions { gap: 6px; }
  .nav-actions .btn { padding: 7px 12px; font-size: 13px; }
  .theme-toggle { width: 32px; height: 32px; font-size: 14px; }
  .user-avatar-btn { width: 32px; height: 32px; }
}

@media (max-width: 400px) {
  .logo-text { display: none; }
}

@media (prefers-reduced-transparency: reduce) {
  .navbar {
    background: var(--nav-bg-solid);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
