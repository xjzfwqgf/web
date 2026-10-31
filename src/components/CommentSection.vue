<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { commentApi, timeAgo, assetUrl } from '../api'
import { useUserStore } from '../stores/user'

const props = defineProps({
  videoId: { type: [String, Number], required: true },
})

const userStore = useUserStore()
const router = useRouter()

const comments = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const newContent = ref('')
const replyTo = ref(null)
const replyContent = ref('')

async function load(reset = false) {
  if (reset) page.value = 1
  loading.value = true
  try {
    const data = await commentApi.list(props.videoId, { page: page.value, size: 10 })
    comments.value = reset ? data.list : [...comments.value, ...data.list]
    total.value = data.total
    page.value += 1 // 加载成功后翻页，下一次「加载更多」请求下一页
  } finally {
    loading.value = false
  }
}

onMounted(() => load(true))
onBeforeUnmount(() => {}) // 占位

function requireLogin() {
  if (!userStore.isLoggedIn()) {
    router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
    return false
  }
  return true
}

async function submitRoot() {
  if (!requireLogin()) return
  const content = newContent.value.trim()
  if (!content) return ElMessage.warning('评论内容不能为空')
  try {
    await commentApi.add(props.videoId, { content })
    newContent.value = ''
    ElMessage.success('评论成功')
    await load(true)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function startReply(c) {
  replyTo.value = c
  replyContent.value = ''
}
async function submitReply() {
  if (!requireLogin()) return
  const content = replyContent.value.trim()
  if (!content) return ElMessage.warning('回复内容不能为空')
  try {
    await commentApi.add(props.videoId, { content, parentId: replyTo.value.id })
    replyTo.value = null
    replyContent.value = ''
    ElMessage.success('回复成功')
    await load(true)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function del(c) {
  try {
    await commentApi.remove(c.id)
    ElMessage.success('已删除')
    await load(true)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function canDelete(c) {
  const u = userStore.user
  return u && (u.role === 'admin' || u.id === c.author?.id)
}

function avatarOf(c) {
  return assetUrl(c.author?.avatar) || ''
}
function initialOf(c) {
  return (c.author?.nickname || '?')[0]
}
</script>

<template>
  <div class="comments">
    <div class="comments-head">
      <span class="eyebrow">COMMENTS</span>
      <span class="comments-count">{{ total }} 条评论</span>
    </div>

    <!-- 评论输入 -->
    <div class="comment-input-box">
      <div class="comment-avatar">
        <img v-if="userStore.user?.avatar" :src="assetUrl(userStore.user.avatar)" alt="" />
        <span v-else>{{ (userStore.user?.nickname || '访')[0] }}</span>
      </div>
      <textarea
        v-model="newContent"
        class="comment-input"
        rows="2"
        placeholder="说点什么吧…（支持回复楼中楼）"
        maxlength="500"
      ></textarea>
      <button class="btn btn-primary comment-submit" @click="submitRoot">发布评论</button>
    </div>

    <!-- 评论列表 -->
    <div v-if="!comments.length && !loading" class="empty-state">
      <span class="empty-icon">💬</span> 还没有评论，快来抢沙发！
    </div>

    <div v-for="c in comments" :key="c.id" class="comment-item">
      <div class="comment-avatar">
        <img v-if="avatarOf(c)" :src="avatarOf(c)" alt="" />
        <span v-else>{{ initialOf(c) }}</span>
      </div>
      <div class="comment-main">
        <div class="comment-info">
          <span class="comment-author">{{ c.author?.nickname }}</span>
          <span class="comment-time">{{ timeAgo(c.created_at) }}</span>
          <span v-if="c.user_status === 0" class="banned-tag">已封禁</span>
        </div>
        <div class="comment-content">{{ c.content }}</div>
        <div class="comment-actions">
          <button class="ca-btn" @click="startReply(c)">回复</button>
          <button v-if="canDelete(c)" class="ca-btn danger" @click="del(c)">删除</button>
        </div>

        <!-- 楼中楼 -->
        <div v-if="c.replies.length" class="replies">
          <div v-for="r in c.replies" :key="r.id" class="reply-item">
            <div class="comment-avatar small">
              <img v-if="avatarOf(r)" :src="avatarOf(r)" alt="" />
              <span v-else>{{ initialOf(r) }}</span>
            </div>
            <div class="comment-main">
              <div class="comment-info">
                <span class="comment-author">{{ r.author?.nickname }}</span>
                <span class="comment-time">{{ timeAgo(r.created_at) }}</span>
                <span v-if="r.user_status === 0" class="banned-tag">已封禁</span>
              </div>
              <div class="comment-content">{{ r.content }}</div>
              <div class="comment-actions">
                <button class="ca-btn" @click="startReply(c)">回复</button>
                <button v-if="canDelete(r)" class="ca-btn danger" @click="del(r)">删除</button>
              </div>
            </div>
          </div>
          <div v-if="replyTo?.id === c.id" class="reply-box">
            <input v-model="replyContent" class="reply-input" placeholder="回复 {{ c.author?.nickname }}…" maxlength="500" @keyup.enter="submitReply" />
            <button class="btn btn-primary reply-submit" @click="submitReply">回复</button>
          </div>
        </div>
        <div v-else-if="replyTo?.id === c.id" class="reply-box">
          <input v-model="replyContent" class="reply-input" placeholder="回复 {{ c.author?.nickname }}…" maxlength="500" @keyup.enter="submitReply" />
          <button class="btn btn-primary reply-submit" @click="submitReply">回复</button>
        </div>
      </div>
    </div>

    <div v-if="comments.length < total" class="load-more">
      <button class="btn btn-ghost" :disabled="loading" @click="load()">
        {{ loading ? '加载中…' : '加载更多评论' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.comments { margin-top: 30px; }
.comments-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}
.comments-count {
  font-family: var(--font-syne);
  font-size: 14px;
  color: var(--text-dim);
}

.comment-input-box {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 22px;
}
.comment-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  resize: none;
  outline: none;
  padding: 4px 0;
  line-height: 1.6;
}
.comment-submit { flex-shrink: 0; align-self: flex-end; }

.comment-item {
  display: flex;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
  animation: fadeIn 0.3s ease;
}
.comment-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--surface-3);
  display: grid;
  place-items: center;
  font-weight: 900;
  color: var(--accent);
}
.comment-avatar.small { width: 28px; height: 28px; font-size: 13px; }
.comment-avatar img { width: 100%; height: 100%; object-fit: cover; }
.comment-main { flex: 1; min-width: 0; }
.comment-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.comment-author { font-weight: 700; font-size: 14px; }
.comment-time { font-size: 12px; color: var(--text-faint); }
.banned-tag {
  font-size: 11px;
  color: var(--accent-rose);
  border: 1px solid var(--rose-soft);
  padding: 0 6px;
  border-radius: 4px;
}
.comment-content {
  margin-top: 6px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
  word-break: break-word;
}
.comment-actions { margin-top: 8px; display: flex; gap: 4px; }
.ca-btn {
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.15s;
}
.ca-btn:hover { color: var(--text); background: var(--surface-2); }
.ca-btn.danger:hover { color: var(--accent-rose); background: var(--rose-soft); }

.replies {
  margin-top: 12px;
  background: var(--bg-soft);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
}
.reply-item {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--border);
}
.reply-item:last-child { border-bottom: none; }

.reply-box {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  animation: fadeIn 0.2s ease;
}
.reply-input {
  flex: 1;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  outline: none;
}
.reply-input:focus { border-color: var(--accent); }
.reply-submit { padding: 8px 16px; font-size: 13px; }

.load-more {
  text-align: center;
  margin-top: 20px;
}
</style>
