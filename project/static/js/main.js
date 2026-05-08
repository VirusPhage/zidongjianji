/* static/js/main.js */

// ================= 全局状态 =================
let assets = []; // 素材库数据
let timeline = []; // 轨道数据 [{id, type, src, start, duration, content}]
let nextId = 1; // 用于生成唯一ID
let zoomLevel = 100; // 缩放比例 (px/s)
const PIXELS_PER_SECOND = 100; // 基础缩放单位 (加大了基础值，体验更好)
let isDraggingScrollbar = false; // 防止拖拽时触发滚轮

// ================= 初始化 =================
document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    renderTimeRuler();
    updateTimelineView();
});

function initEventListeners() {
    // 文件上传
    const fileInput = document.getElementById('fileInput');
    fileInput.addEventListener('change', handleFileUpload);

    // 轨道点击（取消选中）
    const tracksArea = document.getElementById('tracksArea');
    tracksArea.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) clearSelection();
    });

    // =============== 滚轮缩放逻辑 (剪映核心体验) ===============
    tracksArea.addEventListener('wheel', handleZoomWheel, { passive: false });

    // 拖拽时防止缩放
    tracksArea.addEventListener('mousedown', () => isDraggingScrollbar = false);
    tracksArea.addEventListener('mousemove', () => isDraggingScrollbar = false);
    tracksArea.addEventListener('mouseup', () => isDraggingScrollbar = true);
}

// 处理滚轮缩放
function handleZoomWheel(e) {
    // 如果用户正在拖拽滚动条，或者点击了子元素，不缩放
    if (isDraggingScrollbar || e.ctrlKey) return;

    e.preventDefault(); // 阻止页面滚动

    const delta = e.deltaY;
    const zoomFactor = 1.1; // 缩放因子

    // 获取鼠标相对于轨道容器的 X 坐标
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    // 计算鼠标在时间轴上的位置 (秒)
    const scale = PIXELS_PER_SECOND * zoomLevel / 100;
    const timeAtMouse = (mouseX + e.currentTarget.scrollLeft) / scale;

    // 调整缩放级别
    if (delta > 0) {
        zoomLevel /= zoomFactor;
    } else {
        zoomLevel *= zoomFactor;
    }

    // 限制缩放范围
    zoomLevel = Math.max(20, Math.min(400, zoomLevel));

    // 计算新的滚动位置，使鼠标下的时间点保持不动
    const newScale = PIXELS_PER_SECOND * zoomLevel / 100;
    const newScrollLeft = timeAtMouse * newScale - mouseX;

    // 应用缩放和滚动
    e.currentTarget.scrollLeft = newScrollLeft;
    applyZoom();
}

// ================= 文件上传与素材库 =================
function handleFileUpload(e) {
    const files = e.target.files;
    if (!files.length) return;

    Array.from(files).forEach(file => {
        // 1. 创建临时资产对象 (包含进度条)
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const asset = {
            id: tempId,
            name: file.name,
            type: file.type.startsWith('video') ? 'video' : 'audio',
            url: null,
            duration: 0,
            progress: 0
        };

        // 2. 立即添加到列表，显示“加载中”状态
        assets.push(asset);
        addAssetToDOM(asset);

        // 3. 异步读取文件 (修复视频无法读取时长的问题)
        const reader = new FileReader();
        
        reader.onprogress = (event) => {
            if (event.lengthComputable) {
                const percent = (event.loaded / event.total) * 100;
                asset.progress = percent;
                updateAssetProgress(tempId, percent);
            }
        };

        reader.onload = (event) => {
            // 文件读取完成，生成 URL
            const url = URL.createObjectURL(file);
            asset.url = url;

            // 加载元数据
            const media = new (asset.type === 'video' ? Video : Audio)();
            media.src = url;
            
            media.onloadedmetadata = () => {
                asset.duration = media.duration;
                asset.progress = 100; // 元数据加载完成
                updateAssetProgress(tempId, 100);
                
                // 更新 DOM 显示时长
                updateTimelineView(); 
            };
        };

        reader.onerror = () => {
            alert(`文件读取失败: ${file.name}`);
            asset.progress = -1; // 错误状态
            updateAssetProgress(tempId, -1);
        };

        reader.readAsArrayBuffer(file); // 开始读取
    });

    // 重置输入框
    e.target.value = '';
}

// 更新素材列表中的进度条
function updateAssetProgress(assetId, percent) {
    const item = document.querySelector(`.asset-item[data-id="${assetId}"]`);
    if (!item) return;

    const progressEl = item.querySelector('.progress-bar');
    if (progressEl) {
        if (percent === -1) {
            progressEl.style.backgroundColor = '#f44336';
            progressEl.style.width = '100%';
        } else {
            progressEl.style.width = `${percent}%`;
        }
    }
}

function addAssetToDOM(asset) {
    const list = document.getElementById('materialList');
    
    // 移除空提示
    const emptyTip = list.querySelector('.empty-tip');
    if (emptyTip) emptyTip.remove();

    const li = document.createElement('li');
    li.className = 'asset-item';
    li.dataset.id = asset.id; // 存储 ID 用于更新

    // 添加进度条 HTML
    li.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; flex:1;">
            <i class="fas ${asset.type === 'video' ? 'fa-video' : 'fa-music'}"></i>
            <span title="${asset.name}">${asset.name.length > 15 ? asset.name.substring(0, 15) + '...' : asset.name}</span>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
            <small class="asset-duration">${asset.duration ? formatTime(asset.duration) : '加载中...'}</small>
            <div class="progress-container">
                <div class="progress-bar" style="width: ${asset.progress}%"></div>
            </div>
        </div>
    `;

    // 拖拽事件
    li.setAttribute('draggable', true);
    li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({
            type: 'asset',
            assetId: asset.id
        }));
        li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));

    // 双击预览
    li.addEventListener('dblclick', () => {
        const player = document.getElementById('previewPlayer');
        if (asset.url) {
            player.src = asset.url;
            player.play();
        }
    });

    list.appendChild(li);
}

// ================= 轨道逻辑 (剪映风格) =================
function renderTimeRuler() {
    const ruler = document.getElementById('timeRuler');
    ruler.innerHTML = '';
    const totalSeconds = 3600; // 假设最大1小时
    const scale = PIXELS_PER_SECOND * zoomLevel / 100;

    // 计算刻度间隔 (根据缩放级别动态调整)
    let step = 1; // 默认1秒
    if (zoomLevel < 20) step = 60; // 1分钟
    else if (zoomLevel < 50) step = 10; // 10秒
    else if (zoomLevel < 100) step = 5; // 5秒

    for (let i = 0; i < totalSeconds; i += step) {
        const tick = document.createElement('div');
        tick.className = 'ruler-tick';
        tick.style.left = `${i * scale}px`;
        tick.innerHTML = `<span>${formatTime(i)}</span>`;
        ruler.appendChild(tick);
    }
}

function zoomIn() {
    if (zoomLevel < 400) {
        zoomLevel += 50;
        applyZoom();
    }
}

function zoomOut() {
    if (zoomLevel > 20) {
        zoomLevel -= 50;
        applyZoom();
    }
}

function applyZoom() {
    document.getElementById('zoomLevel').innerText = zoomLevel + '%';
    const scale = PIXELS_PER_SECOND * zoomLevel / 100;
    // 这里可以动态设置 CSS 变量，或者直接重绘
    updateTimelineView(); // 重绘轨道位置
}

// 更新轨道视图
function updateTimelineView() {
    const videoContainer = document.getElementById('videoTrackContent');
    const audioContainer = document.getElementById('audioTrackContent');
    videoContainer.innerHTML = '';
    audioContainer.innerHTML = '';

    timeline.forEach(item => {
        const asset = assets.find(a => a.id === item.assetId) || {};
        const el = document.createElement('div');
        el.className = `clip-item clip-${item.type}`;
        el.dataset.id = item.id;

        // 定位逻辑：Left = Start * Scale
        const scale = PIXELS_PER_SECOND * zoomLevel / 100;
        el.style.left = `${item.start * scale}px`;
        el.style.width = `${item.duration * scale}px`;

        // 内容渲染
        if (item.type === 'video') {
            el.innerHTML = `<div class="clip-title"><i class="fas fa-video"></i> ${asset.name || '视频片段'}</div>`;
        } else {
            el.innerHTML = `
                <div class="waveform"></div>
                <div class="clip-title"><i class="fas fa-music"></i> ${asset.name || '音频片段'}</div>
            `;
        }

        // 选中状态
        if (item.selected) el.classList.add('selected');

        // 双击播放
        el.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            playClip(item);
        });

        // 点击选中
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            selectClip(item.id);
        });

        const container = item.type === 'video' ? videoContainer : audioContainer;
        container.appendChild(el);
    });
}

// 处理放置到轨道
document.getElementById('videoTrackContent').addEventListener('dragover', allowDrop);
document.getElementById('audioTrackContent').addEventListener('dragover', allowDrop);

document.getElementById('videoTrackContent').addEventListener('drop', (e) => handleDrop(e, 'video'));
document.getElementById('audioTrackContent').addEventListener('drop', (e) => handleDrop(e, 'audio'));

function allowDrop(e) {
    e.preventDefault();
}

function handleDrop(e, trackType) {
    e.preventDefault();
    let data;
    try {
        data = JSON.parse(e.dataTransfer.getData('text/plain'));
    } catch (err) { return; }

    const scale = PIXELS_PER_SECOND * zoomLevel / 100;
    const containerRect = e.currentTarget.getBoundingClientRect();
    // 计算点击位置相对于轨道起点的像素，再转换为秒
    const clickX = e.clientX - containerRect.left + e.currentTarget.scrollLeft;
    let startTime = Math.max(0, clickX / scale);

    if (data.type === 'asset') {
        // 从素材库拖入
        const asset = assets.find(a => a.id === data.assetId);
        if (asset) {
            // 对齐逻辑（可选）：这里简单处理为自由放置
            const newClip = {
                id: nextId++,
                assetId: asset.id,
                name: asset.name,
                type: trackType, // 强制使用轨道类型，或者根据素材类型决定
                src: asset.url,
                start: startTime,
                duration: asset.duration,
                selected: false
            };
            timeline.push(newClip);
            // 简单的防止重叠逻辑可以在这里加，或者交给后端AI处理
            sortTimeline();
            updateTimelineView();
        }
    } else if (data.type === 'clip') {
        // 在轨道内移动
        const clip = timeline.find(c => c.id === data.clipId);
        if (clip) {
            // 计算新位置
            const deltaX = e.clientX - e.currentTarget.dragStartX; // 需要在全局或element上存dragStartX
            // 注意：上面的dragstart里存的clientX在drop时可能拿不到，建议用e.dataTransfer或全局变量
            // 这里简化处理，直接用当前鼠标位置计算
            clip.start = startTime;
            sortTimeline();
            updateTimelineView();
        }
    }
}

// 辅助函数：按开始时间排序
function sortTimeline() {
    timeline.sort((a, b) => a.start - b.start);
}

// ================= 播放与交互 =================
function selectClip(id) {
    clearSelection();
    const clip = timeline.find(c => c.id === id);
    if (clip) {
        clip.selected = true;
        updateTimelineView();
    }
}

function clearSelection() {
    timeline.forEach(c => c.selected = false);
    updateTimelineView();
}

function playClip(clip) {
    const player = document.getElementById('previewPlayer');
    const asset = assets.find(a => a.id === clip.assetId);
    if (asset && asset.url) {
        player.src = asset.url;
        player.play();
    }
}

// ================= 语音识别 (保持不变) =================
function startRecognition() {
    if (!('webkitSpeechRecognition' in window)) {
        alert("您的浏览器不支持语音识别，请使用 Chrome 浏览器。");
        return;
    }

    const recognition = new webkitSpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const outputDiv = document.getElementById('transcriptList');
    outputDiv.innerHTML = '<div class="empty-tip">正在聆听...</div>';

    recognition.start();

    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        outputDiv.innerHTML = `<div class="transcript-item"><strong>识别结果：</strong>${transcript}</div>`;
    };

    recognition.onerror = function(event) {
        outputDiv.innerHTML = `<div class="empty-tip" style="color:red;">识别出错: ${event.error}</div>`;
    };
}

// ================= AI 指令 (保持不变) =================
async function runAICommand() {
    const textarea = document.querySelector('.prompt-panel textarea');
    const prompt = textarea.value.trim();
    if (!prompt) return;

    // 简单模拟
    const btn = document.querySelector('.btn-run-ai');
    const originalText = btn.innerText;
    btn.innerText = 'AI 思考中...';
    btn.disabled = true;

    try {
        // 这里应调用实际的后端API
        // const response = await fetch('/api/ai', { ... })
        await new Promise(r => setTimeout(r, 1500)); // 模拟延迟
        alert(`AI 指令已接收: "${prompt}"\n(此处应连接后端处理逻辑)`);
    } catch (e) {
        console.error(e);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// ================= 工具函数 =================
function formatTime(seconds) {
    if (!seconds) return "00:00";
    const date = new Date(seconds * 1000);
    const mm = date.getMinutes().toString().padStart(2, '0');
    const ss = date.getSeconds().toString().padStart(2, '0');
    return `${mm}:${ss}`;
}

// 暴露全局函数给 HTML
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.startRecognition = startRecognition;
window.runAICommand = runAICommand;
// 新增清空素材功能
window.clearAllMaterials = function() {
    if(confirm("确定要清空所有素材和轨道吗？")) {
        assets = [];
        timeline = [];
        document.getElementById('materialList').innerHTML = '<div class="empty-tip">请上传音频或视频文件</div>';
        updateTimelineView();
    }
}