document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarBtn = document.getElementById('toggleSidebar');
    const menuList = document.getElementById('menuList');
    const quickGrid = document.getElementById('quickGrid');
    const frameWrap = document.getElementById('frameWrap');
    const contentFrame = document.getElementById('contentFrame');
    const welcomeSection = document.getElementById('welcomeSection');
    const currentPageEl = document.getElementById('currentPage');
    const backdrop = document.getElementById('backdrop');
    const refreshBtn = document.getElementById('refreshIframe');

    const hour = new Date().getHours();
    const greeting = (hour >= 5 && hour < 12) ? '早上好！' : (hour >= 12 && hour < 18) ? '中午好！' : '晚上好！';
    document.getElementById('greeting').textContent = greeting;

    const MOBILE_BREAKPOINT = 768;
    function isMobile() { return window.innerWidth <= MOBILE_BREAKPOINT; }

    function setSidebarExpanded(expanded) {
        if (expanded) { sidebar.classList.add('expanded'); }
        else { sidebar.classList.remove('expanded'); }
        if (isMobile() && expanded) { backdrop && backdrop.classList.add('show'); }
        else { backdrop && backdrop.classList.remove('show'); }
        if (!isMobile()) { localStorage.setItem('sidebarExpanded', expanded ? '1' : '0'); }
    }

    function initSidebarState() {
        if (isMobile()) { setSidebarExpanded(false); }
        else {
            const saved = localStorage.getItem('sidebarExpanded');
            setSidebarExpanded(saved === '1');
        }
    }
    initSidebarState();
    window.addEventListener('resize', initSidebarState);

    toggleSidebarBtn.addEventListener('click', () => {
        setSidebarExpanded(!sidebar.classList.contains('expanded'));
    });
    backdrop && backdrop.addEventListener('click', () => setSidebarExpanded(false));

    function setActiveMenu(li) {
        menuList.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
        if (li) li.classList.add('active');
    }

    function showWelcome() {
        currentPageEl.textContent = '欢迎';
        welcomeSection.style.display = '';
        frameWrap.classList.remove('active');
        contentFrame.removeAttribute('src');
        if (isMobile()) setSidebarExpanded(false);
    }

    function showIframe(url, titleText) {
        if (!url) { return; }
        currentPageEl.textContent = titleText || '页面';
        welcomeSection.style.display = 'none';
        frameWrap.classList.add('active');
        if (contentFrame.getAttribute('src') === url) {
            try { contentFrame.contentWindow && contentFrame.contentWindow.location.reload(); } catch (e) { }
        } else {
            contentFrame.setAttribute('src', url);
        }
        if (isMobile()) setSidebarExpanded(false);
    }

    refreshBtn.addEventListener('click', () => {
        if (frameWrap.classList.contains('active')) {
            try {
                const cw = contentFrame.contentWindow;
                if (cw) { cw.location.reload(); }
            } catch (e) {
                const src = contentFrame.getAttribute('src');
                if (src) contentFrame.setAttribute('src', src);
            }
        }
    });

    const welcomeMenuItem = menuList.querySelector('.menu-item[data-type="welcome"]');
    welcomeMenuItem.addEventListener('click', () => {
        setActiveMenu(welcomeMenuItem);
        showWelcome();
    });

    async function loadConsoleItems() {
        try {
            const resp = await fetch('/api/console/consoleitem');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const items = await resp.json();

            quickGrid.innerHTML = '';

            if (!Array.isArray(items) || items.length === 0) {
                quickGrid.innerHTML = '<div class="block" style="cursor:default"><i class="fa-solid fa-circle-info"></i><h3>没有找到任何配置项</h3></div>';
                return;
            }

            items.forEach((item) => {
                const li = document.createElement('li');
                li.className = 'menu-item';
                li.setAttribute('data-type', 'iframe');
                li.setAttribute('data-url', item.path || '#');
                li.setAttribute('data-label', item.name || '未命名');

                const icon = document.createElement('div');
                icon.className = 'icon';
                const i = document.createElement('i');
                const iconClass = (item.item || '').trim();
                i.className = iconClass ? `fa-solid ${iconClass}` : 'fa-solid fa-cube';
                icon.appendChild(i);

                const label = document.createElement('div');
                label.className = 'label';
                label.textContent = item.name || '未命名';

                li.appendChild(icon);
                li.appendChild(label);
                menuList.appendChild(li);

                li.addEventListener('click', () => {
                    setActiveMenu(li);
                    showIframe(item.path, item.name);
                });

                const block = document.createElement('div');
                block.className = 'block';
                const ci = document.createElement('i');
                ci.className = i.className;
                const ch3 = document.createElement('h3');
                ch3.textContent = item.name || '未命名';
                block.appendChild(ci);
                block.appendChild(ch3);
                block.addEventListener('click', () => {
                    setActiveMenu(li);
                    showIframe(item.path, item.name);
                });
                quickGrid.appendChild(block);
            });

        } catch (err) {
            console.error('加载控制台配置项失败:', err);
            quickGrid.innerHTML = '<div class="block" style="cursor:default"><i class="fa-solid fa-triangle-exclamation" style="color:#d93025;"></i><h3 style="color:#d93025;">加载配置项失败，请稍后再试</h3></div>';
        }
    }

    {{console:homejs}}

    setActiveMenu(welcomeMenuItem);
    showWelcome();
    loadConsoleItems();
});