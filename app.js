const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const STORAGE_KEY = 'xiaoban';

let settings = {
  dsKey: '',
  robotName: '小伴',
  ttsEngine: 'native',
  azureKey: '',
  azureRegion: 'eastasia',
};

let memory = {
  conversations: [],
  profile: {},
};

let isListening = false;
let recognition = null;
let synth = null;
let azureToken = null;

function init() {
  loadSettings();
  loadMemory();
  bindEvents();
  initSpeechRecognition();
  initSpeechSynthesis();
  setFace('idle');
  setStatus('ready', '就绪');
  addSystemMsg(`你好，我是${settings.robotName}~`);
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY + '_settings'));
    if (saved) Object.assign(settings, saved);
  } catch (_) {}
  $('#dsKey').value = settings.dsKey;
  $('#robotName').value = settings.robotName;
  $('#ttsEngine').value = settings.ttsEngine;
  $('#azureKey').value = settings.azureKey;
  $('#azureRegion').value = settings.azureRegion;
  toggleAzureFields();
}

function saveSettings() {
  settings.dsKey = $('#dsKey').value.trim();
  settings.robotName = $('#robotName').value.trim() || '小伴';
  settings.ttsEngine = $('#ttsEngine').value;
  settings.azureKey = $('#azureKey').value.trim();
  settings.azureRegion = $('#azureRegion').value.trim() || 'eastasia';
  localStorage.setItem(STORAGE_KEY + '_settings', JSON.stringify(settings));
  toggleAzureFields();
}

function toggleAzureFields() {
  $('#azureSettings').style.display = settings.ttsEngine === 'azure' ? 'block' : 'none';
}

function loadMemory() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY + '_memory'));
    if (saved) memory = saved;
  } catch (_) {}
}

function saveMemory() {
  const recent = memory.conversations.slice(-100);
  memory.conversations = recent;
  try {
    localStorage.setItem(STORAGE_KEY + '_memory', JSON.stringify(memory));
  } catch (_) {}
}

function addConversation(role, content) {
  memory.conversations.push({ role, content, time: Date.now() });
  saveMemory();
}

function getProfileText() {
  const entries = Object.entries(memory.profile);
  if (!entries.length) return '暂无用户信息';
  return entries.map(([k, v]) => `${k}: ${v}`).join('；');
}

function formatMsgTime(ts) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return h + ':' + m;
}

function clearMemory() {
  memory = { conversations: [], profile: {} };
  localStorage.removeItem(STORAGE_KEY + '_memory');
  $('#chatMessages').innerHTML = '';
  setStatus('ready', '记忆已清除');
  addSystemMsg('记忆已清除');
}

function bindEvents() {
  $('#sendBtn').addEventListener('click', () => sendText());
  $('#textInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendText();
  });

  const micBtn = $('#micBtn');
  micBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startListening();
  });
  micBtn.addEventListener('pointerup', (e) => {
    e.preventDefault();
    stopListening();
  });
  micBtn.addEventListener('pointerleave', (e) => {
    if (isListening) stopListening();
  });

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#closeSettings').addEventListener('click', closeSettings);
  $('#saveSettings').addEventListener('click', () => { saveSettings(); closeSettings(); });
  $('#clearMemory').addEventListener('click', () => { clearMemory(); closeSettings(); });
  $('#ttsEngine').addEventListener('change', toggleAzureFields);

  $('#faceArea').addEventListener('click', () => {
    $('#textInput').focus();
  });
}

function openSettings() {
  $('#settingsPanel').classList.add('open');
  let overlay = $('#settingsOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'settingsOverlay';
    overlay.className = 'overlay show';
    overlay.addEventListener('click', closeSettings);
    document.body.appendChild(overlay);
  } else {
    overlay.classList.add('show');
  }
}

function closeSettings() {
  $('#settingsPanel').classList.remove('open');
  const overlay = $('#settingsOverlay');
  if (overlay) overlay.classList.remove('show');
  loadSettings();
  toggleAzureFields();
}

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Web Speech API not available');
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += t;
      else interim += t;
    }
    if (final) {
      $('#textInput').value = final;
      stopListening();
      processInput(final);
    } else if (interim) {
      $('#textInput').value = interim;
    }
  };

  recognition.onerror = (event) => {
    console.warn('ASR error:', event.error);
    stopListening();
  };

  recognition.onend = () => {
    stopListening();
  };
}

function startListening() {
  if (!recognition) {
    setStatus('error', '浏览器不支持语音');
    return;
  }
  isListening = true;
  $('#micBtn').classList.add('active');
  setStatus('listening', '正在听...');
  setFace('listening');
  try {
    recognition.start();
  } catch (_) {
    recognition.stop();
    recognition.start();
  }
}

function stopListening() {
  if (!isListening) return;
  isListening = false;
  $('#micBtn').classList.remove('active');
  if (recognition) {
    try { recognition.stop(); } catch (_) {}
  }
  setStatus('ready', '就绪');
  setFace('idle');
}

function initSpeechSynthesis() {
  if ('speechSynthesis' in window) {
    synth = window.speechSynthesis;
  }
}

function sendText() {
  const input = $('#textInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  processInput(text);
}

async function processInput(text) {
  addBubble('user', text);
  setStatus('thinking', '思考中...');
  setFace('thinking');

  const reply = await callLLM(text);

  addBubble('robot', reply);
  setStatus('ready', '就绪');
  setFace('idle');

  if (reply) {
    extractProfile(text, reply);
    setTimeout(() => speak(reply), 300);
  }
}

async function callLLM(userInput) {
  if (!settings.dsKey) {
    return localReply(userInput);
  }

  const systemPrompt = `你是"${settings.robotName}"，一个温暖贴心的桌面陪伴机器人。

## 性格
- 说话简洁自然，像朋友聊天，不超过3-4句话
- 能感知用户情绪，适当共情和安慰
- 记住用户的重要信息

## 关于用户
${getProfileText()}

## 规则
- 用中文回复
- 不知道就说不知道
- 避免过于机械或说教`;

  const recentMsgs = memory.conversations.slice(-12).map(c => ({
    role: c.role,
    content: c.content,
  }));

  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentMsgs,
    { role: 'user', content: userInput },
  ];

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + settings.dsKey,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        max_tokens: 400,
        temperature: 0.8,
      }),
    });

    if (!resp.ok) {
      console.error('API error:', resp.status);
      return localReply(userInput);
    }

    const data = await resp.json();
    const reply = data.choices[0].message.content.trim();
    addConversation('user', userInput);
    addConversation('assistant', reply);
    return reply;
  } catch (err) {
    console.error('LLM error:', err);
    return localReply(userInput);
  }
}

function localReply(text) {
  const t = text.trim();
  const keywords = {
    '你好': ['你好呀！今天过得怎么样？', '嗨~ 我在呢！'],
    '小伴': ['我在呢！有什么可以帮你的？', '叫我呀~'],
    '谢谢': ['不客气，能帮到你就好~', '嘿嘿，不客气！'],
    '再见': ['拜拜，随时叫我哦！', '再见啦，做个好梦~'],
    '早安': ['早安！新的一天要元气满满哦~', '早上好！今天天气不错~'],
    '晚安': ['晚安，做个好梦！', '晚安，明天见~'],
    '你是谁': [`我是${settings.robotName}，你的智能陪伴机器人！可以陪你聊天、回答问题。`, `我叫${settings.robotName}，是你的小机器人伙伴~`],
  };

  for (const [kw, replies] of Object.entries(keywords)) {
    if (t.includes(kw)) {
      const r = replies[Math.floor(Math.random() * replies.length)];
      addConversation('user', t);
      addConversation('assistant', r);
      return r;
    }
  }

  const fallback = '嗯嗯，我在听~（请先在设置中填入 DeepSeek API Key，我就能更聪明地和你聊天啦！）';
  addConversation('user', t);
  addConversation('assistant', fallback);
  return fallback;
}

async function extractProfile(userInput, reply) {
  if (!settings.dsKey) return;
  const combined = userInput + '\n' + reply;
  const prompt = `从对话提取用户个人信息。只提取明确提到的，不要猜测。key: value格式，一行一个。没新信息回复"无"。\n\n对话：\n${combined}`;

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + settings.dsKey,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.3,
      }),
    });

    const data = await resp.json();
    const text = data.choices[0].message.content.trim();
    if (text === '无') return;

    for (const line of text.split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        if (k && v && k.length < 30) {
          memory.profile[k] = v;
        }
      }
    }
    saveMemory();
  } catch (_) {}
}

function speak(text) {
  if (settings.ttsEngine === 'azure' && settings.azureKey) {
    speakAzure(text);
  } else {
    speakNative(text);
  }
}

function speakNative(text) {
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = 1.05;
  u.pitch = 1.1;
  u.volume = 1;

  u.onstart = () => { setStatus('speaking', '说话中...'); setFace('speaking'); };
  u.onend = () => { setStatus('ready', '就绪'); setFace('idle'); };
  u.onerror = () => { setStatus('ready', '就绪'); setFace('idle'); };

  synth.speak(u);
}

async function speakAzure(text) {
  try {
    setStatus('speaking', '说话中...');
    setFace('speaking');

    const resp = await fetch(
      `https://${settings.azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': settings.azureKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        },
        body: `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>
          <voice name='zh-CN-XiaoxiaoNeural'>${text}</voice>
        </speak>`,
      }
    );

    if (!resp.ok) throw new Error('Azure TTS error');

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => { setStatus('ready', '就绪'); setFace('idle'); URL.revokeObjectURL(url); };
    audio.onerror = () => { setStatus('ready', '就绪'); setFace('idle'); };
    await audio.play();
  } catch (err) {
    console.warn('Azure TTS failed, fallback to native:', err);
    speakNative(text);
  }
}

function setStatus(state, text) {
  const dot = $('#statusDot');
  dot.className = 'status-dot ' + state;
  $('#statusText').textContent = text;
}

function setFace(emotion) {
  const face = $('#robotFace');
  const leftEye = $('.left-eye');
  const rightEye = $('.right-eye');
  const mouth = $('#mouth');

  face.className = 'robot-face';
  leftEye.className = 'eye left-eye';
  rightEye.className = 'eye right-eye';
  mouth.className = 'mouth';

  switch (emotion) {
    case 'idle':
      break;
    case 'happy':
      leftEye.classList.add('happy');
      rightEye.classList.add('happy');
      mouth.classList.add('happy');
      break;
    case 'sad':
      leftEye.classList.add('sad');
      rightEye.classList.add('sad');
      mouth.classList.add('sad');
      break;
    case 'thinking':
      face.classList.add('thinking');
      mouth.classList.add('thinking');
      break;
    case 'speaking':
      face.classList.add('speaking');
      mouth.classList.add('speaking');
      break;
    case 'listening':
      face.classList.add('listening');
      leftEye.classList.add('surprised');
      rightEye.classList.add('surprised');
      break;
    case 'sleep':
      leftEye.classList.add('closed');
      rightEye.classList.add('closed');
      mouth.classList.add('sad');
      break;
  }
}

function addBubble(role, text) {
  const messagesDiv = $('#chatMessages');

  if (role === 'user' || role === 'robot') {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.textContent = text;
    messagesDiv.appendChild(div);
  }

  const bubble = $('#speechBubble');
  bubble.classList.remove('show');
  void bubble.offsetWidth;
  bubble.textContent = text;
  bubble.classList.add('show');

  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function addSystemMsg(text) {
  const div = document.createElement('div');
  div.className = 'msg system';
  div.textContent = text;
  $('#chatMessages').appendChild(div);
  const chatArea = $('#chatArea');
  chatArea.scrollTop = chatArea.scrollHeight;
}

document.addEventListener('DOMContentLoaded', init);
