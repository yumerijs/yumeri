<template>
  <div class="card">
    <slot />
  </div>
</template>

<style scoped>
.card {
  width: 100%;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 18px;
  padding: 24px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
}
</style>
