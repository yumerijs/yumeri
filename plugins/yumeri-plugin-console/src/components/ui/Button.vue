<template>
  <button
    class="btn"
    :class="[`btn-${variant}`, `btn-${size}`, { 'btn-loading': loading }]"
    :disabled="disabled || loading"
    v-bind="$attrs"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
const props = defineProps<{
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
}>();

const variant = props.variant ?? 'default';
const size = props.size ?? 'md';
const loading = props.loading ?? false;
const disabled = props.disabled ?? false;
</script>

<style scoped>
:global(:root) {
  --btn-bg: linear-gradient(135deg, #6366f1, #22d3ee);
  --btn-fg: #0b1220;
  --btn-border: rgba(148, 163, 184, 0.2);
  --btn-ghost-bg: rgba(255, 255, 255, 0.04);
  --btn-ghost-border: rgba(148, 163, 184, 0.2);
}
.btn {
  border-radius: 10px;
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
  transition: 0.15s ease;
  color: var(--btn-fg);
  background: var(--btn-bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.btn-ghost {
  background: var(--btn-ghost-bg);
  border-color: var(--btn-ghost-border);
  color: #e2e8f0;
}
.btn-outline {
  background: transparent;
  border-color: rgba(99, 102, 241, 0.5);
  color: #e2e8f0;
}
.btn-sm { padding: 8px 12px; font-size: 13px; }
.btn-md { padding: 10px 14px; font-size: 14px; }
.btn-lg { padding: 12px 16px; font-size: 15px; }
.btn:hover:not(:disabled) {
  filter: brightness(1.05);
  box-shadow: 0 10px 30px rgba(99, 102, 241, 0.35);
}
.btn-ghost:hover:not(:disabled) {
  border-color: rgba(99, 102, 241, 0.6);
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.12);
}
.btn-outline:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.08);
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-loading {
  position: relative;
}
.btn-loading::after {
  content: '';
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-top-color: rgba(255, 255, 255, 0.9);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
