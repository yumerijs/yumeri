document.addEventListener('DOMContentLoaded', () => {
    // 处理密码显示/隐藏
    const passwordToggles = document.querySelectorAll('.password-toggle');

    passwordToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
            const passwordInput = toggle.parentElement.querySelector('input');
            if (!passwordInput) return;

            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                toggle.textContent = 'visibility';
            } else {
                passwordInput.type = 'password';
                toggle.textContent = 'visibility_off';
            }
        });
    });

    const registerForm = document.getElementById('registerForm');
    const loginForm = document.getElementById('loginForm');

    if (registerForm) {
        registerForm.addEventListener('submit', (event) => {
            event.preventDefault(); // 阻止默认提交行为
            // POST请求/auth/api/register
            console.log('注册表单提交！');
            // 请求逻辑
            fetch('/auth/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: registerForm.username.value,
                    password: registerForm.password.value
                })
            })
                .then(response => response.json())
                .then(data => {
                    console.log(data);
                    if (data.code === 0) {
                        alert('注册成功！');
                        // 跳转到登录页面
                        window.location.href = '/auth/login';
                    } else {
                        alert(data.message);
                    }
                })
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', (event) => {
            event.preventDefault(); // 阻止默认提交行为
            // 请求/auth/api/login
            console.log('登录表单提交！');
            // 请求逻辑
            fetch('/auth/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: loginForm.identifier.value,
                    password: loginForm.password.value
                })
            })
                .then(response => response.json())
                .then(data => {
                    console.log(data);
                    if (data.code === 0) {
                        alert('登录成功！');
                        // 跳转到前端ref的query参数的页面（就是ref=xxx）
                        const params = new URLSearchParams(window.location.search);
                        window.location.href = params.get('ref') || '/';
                    } else {
                        alert(data.message);
                    }
                })
        });
    }
});