from flask import Flask, render_template, request, jsonify
import os
import whisper
import re
from pydub import AudioSegment
from werkzeug.utils import secure_filename # 用于安全地处理文件名
import webbrowser
import threading
import time

app = Flask(__name__)

# --- 配置 ---
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# 允许上传的文件扩展名
ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'mp4', 'avi', 'mov', 'mkv', 'wmv'}

def allowed_file(filename):
    """检查文件扩展名是否在允许的列表中"""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- 模型加载 ---
print("正在加载 Whisper 模型...")
model = whisper.load_model("base")
print("模型加载完成！")

# --- 文件上传路由 ---
@app.route('/api/upload', methods=['POST'])
def upload_file():
    # 1. 检查请求中是否包含文件
    if 'file' not in request.files:
        return jsonify({'error': '请求中没有找到文件部分'}), 400
    
    file = request.files['file']
    
    # 2. 如果用户没有选择文件，浏览器可能会提交一个空文件名
    if file.filename == '':
        return jsonify({'error': '没有选择文件'}), 400
    
    # 3. 验证文件类型并保存
    if file and allowed_file(file.filename):
        # secure_filename 会移除可能引起安全问题的字符
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        return jsonify({
            'message': '文件上传成功',
            'filename': filename
        }), 200
    else:
        return jsonify({'error': '不允许的文件类型'}), 400

# --- 语音识别与处理路由 ---
def process_audio_and_text(audio_path, filename, mode):
    # 1. 使用 Whisper 转录，获取字词级时间戳
    result = model.transcribe(audio_path, language="zh", word_timestamps=True)
    
    full_text = result["text"]
    segments = result["segments"]
    
    # 2. 定义要去除的语气词/填充词
    fillers = ['呃', '嗯', '啊', '哦', '呀', '嘛', '啦', '那个', '就是', '然后', '额', '哎']
    
    # 3. 标记需要保留的时间片段
    keep_segments = []
    audio = AudioSegment.from_file(audio_path)
    final_text_parts = []
    
    for segment in segments:
        seg_text = segment["text"]
        seg_start = segment["start"]
        seg_end = segment["end"]
        
        # 简单的去噪：去除标点
        clean_seg_text = re.sub(r'[^\w\s]', '', seg_text)
        
        should_keep = True
        
        # 检查这段文字是否主要是语气词
        temp_text = clean_seg_text
        for filler in fillers:
            temp_text = temp_text.replace(filler, '')
            
        if len(temp_text.strip()) == 0:
            should_keep = False
            
        if should_keep:
            keep_segments.append([seg_start, seg_end])
            final_text_parts.append(clean_seg_text)
        else:
            print(f"跳过片段: {seg_text} ({seg_start}s - {seg_end}s)")

    # 4. 拼接音频
    final_audio = AudioSegment.empty()
    for start, end in keep_segments:
        start_ms = start * 1000
        end_ms = end * 1000
        clip = audio[start_ms:end_ms]
        final_audio += clip

    # 5. 【核心改动】根据模式决定输出路径
    output_filename = ""
    if mode == 'overwrite':
        # 覆盖原文件
        output_filename = filename
        output_path = os.path.join(app.config['UPLOAD_FOLDER'], output_filename)
    else: # mode == 'save_as'
        # 另存为新文件，例如 video_1.mp3
        name, ext = os.path.splitext(filename)
        counter = 1
        output_filename = f"{name}_{counter}{ext}"
        output_path = os.path.join(app.config['UPLOAD_FOLDER'], output_filename)
        
        # 如果文件已存在，增加计数器，避免覆盖
        while os.path.exists(output_path):
            counter += 1
            output_filename = f"{name}_{counter}{ext}"
            output_path = os.path.join(app.config['UPLOAD_FOLDER'], output_filename)

    # 导出文件
    final_audio.export(output_path, format="mp3")
    
    # 6. 组合最终文本
    final_text = "".join(final_text_parts)
    final_text = re.sub(r'\s+', ' ', final_text).strip()

    return final_text, output_filename

@app.route('/api/recognize', methods=['POST'])
def api_recognize():
    data = request.json
    filename = data.get('filename')
    mode = data.get('mode', 'save_as') # 默认为另存为模式
    
    if not filename:
        return jsonify({'error': '未提供文件名'}), 400
        
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    if not os.path.exists(file_path):
        return jsonify({'error': '文件不存在'}), 404
    
    try:
        # 调用处理函数，传入 mode 参数
        cleaned_text, output_filename = process_audio_and_text(file_path, filename, mode)
        
        return jsonify({
            'text': cleaned_text, 
            'output_filename': output_filename # 返回处理后的文件名
        })
        
    except Exception as e:
        print(f"处理出错: {e}")
        return jsonify({'error': f'处理过程发生错误: {str(e)}'}), 500

# --- 首页路由 ---
@app.route('/')
def index():
    return render_template('index.html')

# --- 启动浏览器 ---
def open_browser():
    """在一个新线程中打开浏览器"""
    # 等待1.5秒，确保Flask服务器已经启动
    time.sleep(1.5)
    webbrowser.open("http://127.0.0.1:5000")

if __name__ == '__main__':
    # 启动一个线程来打开浏览器
    threading.Thread(target=open_browser).start()
    # 启动Flask应用
    app.run(debug=True, port=5000)