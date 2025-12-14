<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="sticky top-0 z-10 flex items-center justify-between border-b border-border/70 bg-[rgba(15,23,42,0.9)] px-5 py-3 backdrop-blur-lg">
      <div class="flex items-center gap-3">
        <UIButton variant="ghost" size="sm" @click="sidebarOpen = !sidebarOpen" aria-label="切换侧栏">
          ☰
        </UIButton>
        <div>
          <div class="text-base font-semibold tracking-tight">控制台</div>
          <div class="text-xs text-muted-foreground">欢迎回来</div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <UIButton variant="ghost" size="sm" @click="refresh">刷新</UIButton>
        <UIButton size="sm" @click="logout">退出</UIButton>
      </div>
    </header>

    <div class="grid min-h-[calc(100vh-64px)] grid-cols-12 md:grid-cols-12">
      <aside
        class="fixed inset-y-[64px] left-0 z-30 w-64 border-r border-border/70 bg-[rgba(15,23,42,0.95)] px-4 py-4 backdrop-blur transition-transform duration-200 md:static md:inset-auto md:w-auto md:col-span-4 lg:col-span-3 md:bg-[rgba(15,23,42,0.7)]"
        :class="sidebarOpen ? 'translate-x-0 md:translate-x-0' : '-translate-x-full md:translate-x-0'"
      >
        <div class="text-xs uppercase tracking-[0.08em] text-muted-foreground mb-3">功能</div>
        <div class="flex flex-col gap-2">
          <button
            v-for="item in items"
            :key="item.name"
            class="group flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-sm text-foreground transition hover:border-primary/60 hover:shadow-lg hover:shadow-primary/20"
            :class="{ 'border-primary/70 bg-card/80 shadow-lg shadow-primary/25': active === item.name }"
            @click="activate(item)"
          >
            <i :class="iconClass(item.icon)" class="text-lg text-primary"></i>
            <span class="flex-1 text-left truncate">{{ item.displayName }}</span>
            <span v-if="item.type === 'vue'" class="rounded-full border border-primary/40 bg-primary/15 px-2 text-xs text-primary">Vue</span>
          </button>
        </div>
      </aside>

      <main class="col-span-12 bg-background/80 px-0 pb-0 md:col-span-8 lg:col-span-9">
        <div class="min-h-[calc(100vh-64px)] bg-background">
          <template v-if="!activeItem">
            <div class="mb-4 px-5 pt-5">
              <div class="text-lg font-semibold text-foreground">仪表盘</div>
              <div class="text-sm text-muted-foreground">欢迎来到控制台</div>
            </div>
            <div class="grid gap-3 px-5 pb-5 md:grid-cols-2 lg:grid-cols-3">
              <div class="rounded-xl border border-border/60 bg-card/60 p-4">
                <div class="text-xs text-muted-foreground">插件总数</div>
                <div class="mt-2 text-2xl font-bold text-foreground">--</div>
              </div>
              <div class="rounded-xl border border-border/60 bg-card/60 p-4">
                <div class="text-xs text-muted-foreground">已启用</div>
                <div class="mt-2 text-2xl font-bold text-foreground">--</div>
              </div>
              <div class="rounded-xl border border-border/60 bg-card/60 p-4">
                <div class="text-xs text-muted-foreground">待处理</div>
                <div class="mt-2 text-2xl font-bold text-foreground">--</div>
              </div>
            </div>
            <div class="rounded-none border-t border-border/60 bg-card/60 px-5 py-4">
              <div class="text-sm text-muted-foreground">在左侧选择一个控制台项开始管理</div>
            </div>
          </template>

          <iframe
            v-else-if="activeItem.type === 'iframe'"
            class="h-[calc(100vh-64px)] w-full border-0 bg-card"
            :src="activeItem.path"
            title="控制台项"
          />

          <RemoteView
            v-else-if="activeItem.type === 'vue'"
            class="h-[calc(100vh-64px)] w-full border-0 bg-card"
            :entry="activeItem.entry"
            :title="activeItem.displayName"
          />
        </div>
      </main>
    </div>

    <div
      v-show="sidebarOpen"
      class="fixed inset-0 z-5 bg-black/40 md:hidden"
      @click="sidebarOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import RemoteView from '../components/RemoteView.vue'
import { UIButton, UICard } from '../components/ui'

export interface ConsoleItem {
  name: string
  displayName: string
  icon: string
  type: 'iframe' | 'vue'
  path?: string
  entry?: string
}

const props = defineProps<{
  items: ConsoleItem[]
  basePath: string
}>()

const sidebarOpen = ref(true)
const active = ref(props.items[0]?.name ?? '')

const activeItem = computed(() => props.items.find(i => i.name === active.value))

function activate(item: ConsoleItem) {
  active.value = item.name
  if (window.innerWidth < 960) sidebarOpen.value = false
}

function refresh() {
  if (activeItem.value?.type === 'iframe') {
    const iframe = document.querySelector<HTMLIFrameElement>('iframe.frame')
    if (iframe?.contentWindow) {
      iframe.contentWindow.location.reload()
    } else if (iframe?.src) {
      iframe.src = iframe.src
    }
  } else {
    active.value = '' // trigger remount
    requestAnimationFrame(() => {
      active.value = activeItem.value?.name || ''
    })
  }
}

function iconClass(icon?: string) {
  if (!icon) return 'fa-solid fa-cube'
  if (icon.includes('fa-')) return `fa-solid ${icon}`
  return `fa-solid ${icon}`
}

async function logout() {
  await fetch('/api/console/logout', { method: 'POST' }).catch(() => {})
  window.location.href = `/${props.basePath}/login`
}
</script>

<style scoped>
@import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css');
:global(body) {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
</style>
