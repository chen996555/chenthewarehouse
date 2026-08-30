'use strict';
// 让点击工具栏图标打开 Side Panel（而非默认 popup）
// 顶层直接调用（而非 onInstalled）：重新加载扩展不会触发 onInstalled，需每次 worker 启动都设置
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

