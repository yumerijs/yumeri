<template>
  <div class="login min-h-screen bg-background text-foreground">
    <div class="grid min-h-screen place-items-center px-6">
      <UICard class="w-full max-w-md space-y-2">
        <div class="text-lg font-bold tracking-tight text-foreground">Yumeri 控制台</div>
        <div class="text-sm text-muted-foreground">使用管理员账号登录</div>

        <form class="space-y-3" @submit.prevent="submit">
          <label class="flex flex-col gap-2 text-sm text-muted-foreground">
            <span>用户名</span>
            <input
              v-model="username"
              type="text"
              required
              autocomplete="username"
              class="rounded-lg border border-border/60 bg-card/70 px-3 py-2 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </label>
          <label class="flex flex-col gap-2 text-sm text-muted-foreground">
            <span>密码</span>
            <input
              v-model="password"
              type="password"
              required
              autocomplete="current-password"
              class="rounded-lg border border-border/60 bg-card/70 px-3 py-2 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </label>
          <UIButton class="mt-1 w-full justify-center" :loading="loading" type="submit">
            {{ loading ? '登录中…' : '登录' }}
          </UIButton>
          <p v-if="error" class="text-sm text-red-300">{{ error }}</p>
        </form>
      </UICard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { UIButton, UICard } from '../components/ui'

const props = defineProps<{ basePath: string }>()

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/console/loginpass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: password.value }),
    })
    const data = await res.json()
    if (data.success) {
      window.location.href = `/${props.basePath}/home`
    } else {
      error.value = data.message || '登录失败'
    }
  } catch (e: any) {
    error.value = e?.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
:global(body) {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.login {
  background:
    radial-gradient(circle at 20% 20%, rgba(99, 102, 241, 0.14), transparent 35%),
    radial-gradient(circle at 80% 10%, rgba(56, 189, 248, 0.12), transparent 25%),
    hsl(222, 47%, 11%);
}
</style>
