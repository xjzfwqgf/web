<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { authApi } from '../api'
import { useUserStore } from '../stores/user'

const router = useRouter()
const userStore = useUserStore()

const username = ref('')
const nickname = ref('')
const password = ref('')
const confirm = ref('')
const loading = ref(false)

async function submit() {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username.value)) {
    return ElMessage.warning('用户名需为 3-20 位字母、数字或下划线')
  }
  if (password.value.length < 8) return ElMessage.warning('密码至少 8 位')
  if (password.value !== confirm.value) return ElMessage.warning('两次输入的密码不一致')
  loading.value = true
  try {
    const { token, user } = await authApi.register({
      username: username.value,
      password: password.value,
      nickname: nickname.value,
    })
    userStore.setAuth(token, user)
    ElMessage.success('注册成功，欢迎加入夜场！')
    router.push({ name: 'home' })
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card fade-in">
      <div class="auth-logo">▶</div>
      <h1 class="display-title auth-title">加入夜场</h1>
      <p class="eyebrow auth-sub">JOIN NIGHTSHOW</p>

      <form class="auth-form" @submit.prevent="submit">
        <div class="field">
          <label>用户名 <small>3-20 位字母/数字/下划线</small></label>
          <input v-model="username" class="input" type="text" placeholder="设置用户名" autocomplete="username" />
        </div>
        <div class="field">
          <label>昵称（可选）</label>
          <input v-model="nickname" class="input" type="text" placeholder="展示给别人的名字" />
        </div>
        <div class="field">
          <label>密码 <small>至少 8 位</small></label>
          <input v-model="password" class="input" type="password" placeholder="设置密码" autocomplete="new-password" />
        </div>
        <div class="field">
          <label>确认密码</label>
          <input v-model="confirm" class="input" type="password" placeholder="再次输入密码" autocomplete="new-password" />
        </div>
        <button class="btn btn-primary auth-submit" type="submit" :disabled="loading">
          {{ loading ? '注册中…' : '注 册' }}
        </button>
      </form>

      <div class="auth-footer">
        已有账号？<router-link to="/login" class="auth-link">直接登录</router-link>
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
.auth-form label small { color: var(--text-faint); font-weight: 400; }
.auth-submit { width: 100%; padding: 13px; font-size: 15px; }
.auth-footer {
  margin-top: 22px;
  text-align: center;
  font-size: 13px;
  color: var(--text-dim);
}
.auth-link { color: var(--accent); font-weight: 700; }
</style>
