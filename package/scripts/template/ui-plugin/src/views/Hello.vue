<template>
  <div>
    <h1>Hello from a Yumeri UI Plugin!</h1>
    <p>This component was rendered by the '{{ from }}'.</p>
  </div>
</template>

<script setup>
defineProps({
  from: String
})
</script>

<style scoped>
div {
  font-family: sans-serif;
  padding: 2rem;
  text-align: center;
  color: #2c3e50;
  background-color: #f0f8ff;
  border-radius: 8px;
}
h1 {
  color: #34495e;
}
</style>
