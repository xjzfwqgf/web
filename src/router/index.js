import { createRouter, createWebHistory } from 'vue-router'

// 站点当前只保留音乐模块：视频相关路由统一重定向到 /music。
// 视频页面组件仍保留在仓库里，恢复时把下面的 redirect 换回 component 即可。
const routes = [
  { path: '/', redirect: '/music' },
  { path: '/music', name: 'music', component: () => import('../views/Music.vue'), meta: { auth: true } },

  // ---- 已下线的视频入口（保留路径，避免旧链接 404） ----
  { path: '/video/:id', redirect: '/music' },
  { path: '/collection/:id', redirect: '/music' },
  { path: '/search', redirect: '/music' },
  { path: '/category/:name', redirect: '/music' },
  { path: '/upload', redirect: '/music' },

  { path: '/user', name: 'user', component: () => import('../views/UserCenter.vue'), meta: { auth: true } },
  { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
  { path: '/register', name: 'register', component: () => import('../views/Register.vue') },
  {
    path: '/admin',
    component: () => import('../views/admin/AdminLayout.vue'),
    meta: { admin: true },
    children: [
      { path: '', name: 'admin-dashboard', component: () => import('../views/admin/Dashboard.vue') },
      { path: 'users', name: 'admin-users', component: () => import('../views/admin/Users.vue') },
      { path: 'videos', name: 'admin-videos', component: () => import('../views/admin/Videos.vue') },
      { path: 'collections', name: 'admin-collections', component: () => import('../views/admin/Collections.vue') },
      { path: 'comments', name: 'admin-comments', component: () => import('../views/admin/Comments.vue') },
      { path: 'danmaku', name: 'admin-danmaku', component: () => import('../views/admin/Danmaku.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/music' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  // 仅路径变化时滚到顶部；query-only 导航（如播放页 ?t= 进度更新）不滚动
  scrollBehavior(to, from, savedPosition) {
    if (to.path === from.path) return {}
    return savedPosition || { top: 0 }
  },
})

const loggedIn = () => !!localStorage.getItem('token')
const isAdmin = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')?.role === 'admin'
  } catch {
    return false
  }
}

router.beforeEach((to) => {
  if (to.meta.auth && !loggedIn()) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.admin && !(loggedIn() && isAdmin())) {
    return { name: 'music' }
  }
  if ((to.name === 'login' || to.name === 'register') && loggedIn()) {
    return { name: 'music' }
  }
})

export default router
