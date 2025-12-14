<template>
  <div class="remote-shell">
    <div v-if="loading" class="state">加载中…</div>
    <div v-else-if="error" class="state error">加载失败：{{ error }}</div>
    <component v-else :is="mod" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

const props = defineProps<{
  entry?: string
  title?: string
}>()

const loading = ref(true)
const error = ref<string | null>(null)
const mod = ref<any>(null)

onMounted(async () => {
  if (!props.entry) {
    error.value = '缺少客户端入口'
    loading.value = false
    return
  }
  try {
    const m = await import(/* @vite-ignore */ props.entry)
    mod.value = m.default || m
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.remote-shell {
  width: 100%;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
}
.state {
  width: 100%;
  height: 100%;
  border-radius: 14px;
  border: 1px dashed rgba(148, 163, 184, 0.4);
  display: grid;
  place-items: center;
  color: #94a3b8;
  background: rgba(15, 23, 42, 0.6);
}
.state.error {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.6);
}
</style>
