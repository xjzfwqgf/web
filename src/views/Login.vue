<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { authApi, apiUrl } from '../api'
import { useUserStore } from '../stores/user'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const username = ref('')
const password = ref('')
const loading = ref(false)

async function submit() {
  if (!username.value || !password.value) {
    return ElMessage.warning('请填写用户名和密码')
  }
  loading.value = true
  try {
    const { token, user } = await authApi.login({ username: username.value, password: password.value })
    userStore.setAuth(token, user)
    ElMessage.success(`欢迎回来，${user.nickname}`)
    router.push(route.query.redirect || { name: 'home' })
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

// 跳转后端，再由后端 302 到 GitHub 授权页
// （跨域部署必须用后端绝对地址：/api 在前端域名下没有这个路由）
function githubLogin() {
  window.location.href = apiUrl('/api/auth/github/login')
}

// 跳转后端，再由后端 302 到夜场自家 OAuth Provider 授权页
function oauthLogin() {
  window.location.href = apiUrl('/api/auth/oauth/login')
}

// GitHub 授权完成后回跳 /login?token=...（或 ?error=...）
onMounted(async () => {
  const { token, error } = route.query
  if (error) {
    ElMessage.error(String(error))
    return router.replace({ name: 'login' })
  }
  if (!token) return
  try {
    userStore.setAuth(token, {})
    const { user } = await authApi.me()
    userStore.setUser(user)
    ElMessage.success(`欢迎回来，${user.nickname}`)
    router.replace(route.query.redirect || { name: 'home' })
  } catch (e) {
    userStore.logout()
    ElMessage.error(e.message)
    router.replace({ name: 'login' })
  }
})
</script>

<template>
  <div class="auth-page">
    <div class="auth-card fade-in">
      <div class="auth-logo">▶</div>
      <h1 class="display-title auth-title">回到夜场</h1>
      <p class="eyebrow auth-sub">LOGIN TO NIGHTSHOW</p>

      <form class="auth-form" @submit.prevent="submit">
        <div class="field">
          <label>用户名</label>
          <input v-model="username" class="input" type="text" placeholder="请输入用户名" autocomplete="username" />
        </div>
        <div class="field">
          <label>密码</label>
          <input v-model="password" class="input" type="password" placeholder="请输入密码" autocomplete="current-password" />
        </div>
        <button class="btn btn-primary auth-submit" type="submit" :disabled="loading">
          {{ loading ? '登录中…' : '登 录' }}
        </button>
      </form>

      <div class="oauth-divider"><span>或</span></div>

      <button class="btn btn-ghost auth-gh" type="button" @click="oauthLogin">
        <span class="oauth-logo" aria-hidden="true">▶</span>
        使用夜场账号登录
      </button>

      <button class="btn btn-ghost auth-gh" type="button" @click="githubLogin">
        <span class="gh-logo" aria-hidden="true">G</span>
        使用 GitHub 登录
      </button>

      <div class="auth-footer">
        还没有账号？<router-link to="/register" class="auth-link">立即注册</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: calc(100vh - 180px);
  display: grid;
  place-items: center;
  padding: 24px;
}
.auth-card {
  width: 100%;
  max-width: 400px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 40px 36px;
  box-shadow: var(--shadow-pop);
  position: relative;
  overflow: hidden;
}
.auth-card::before {
  content: '';
  position: absolute;
  top: -80px;
  left: 50%;
  transform: translateX(-50%);
  width: 300px;
  height: 160px;
  background: radial-gradient(ellipse, var(--accent-glow), transparent 70%);
  pointer-events: none;
}
.auth-logo {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  margin: 0 auto 18px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-text);
  font-size: 22px;
  box-shadow: 0 6px 24px var(--accent-glow);
}
.auth-title { text-align: center; font-size: 30px; }
.auth-sub { text-align: center; margin: 8px 0 30px; }
.auth-form .input { font-size: 15px; padding: 13px 14px; }
.auth-submit { width: 100%; padding: 13px; font-size: 15px; }
.oauth-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 22px 0 16px;
  color: var(--text-dim);
  font-size: 12px;
}
.oauth-divider::before,
.oauth-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-strong);
}
.auth-gh {
  width: 100%;
  padding: 13px;
  font-size: 14px;
  color: var(--text);
}
.auth-gh:hover {
  background: var(--surface-2);
  border-color: var(--accent);
  color: var(--accent);
}
.gh-logo {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #24292f; /* GitHub 品牌深色 */
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.oauth-logo {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent); /* 夜场品牌色 */
  color: var(--accent-text);
  font-size: 10px;
  font-weight: 800;
}
.auth-footer {
  margin-top: 22px;
  text-align: center;
  font-size: 13px;
  color: var(--text-dim);
}
.auth-link { color: var(--accent); font-weight: 700; }
</style>
