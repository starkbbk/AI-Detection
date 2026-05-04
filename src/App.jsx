import React, { useState, useEffect } from 'react';
import mammoth from 'mammoth';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Shield, User, History as HistoryIcon, Settings, Wand2, Upload, LogOut, Copy, Check } from 'lucide-react';

// -- Decopy.ai API (Advanced Mode) --
const DECOPY_PROXY = '/api/decopy?path=';
const getDeviceSerial = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};

const decopyDetect = async (text) => {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2, 18);
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="content"\r\n\r\n${text}\r\n--${boundary}--\r\n`;
  const res = await fetch(`${DECOPY_PROXY}${encodeURIComponent('/api/decopy/ai-detector/create-job')}`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Product-Serial': getDeviceSerial(),
      'Authorization': '',
      'Origin': 'https://decopy.ai',
      'Referer': 'https://decopy.ai/ai-detector/',
      'Accept': 'application/json, text/plain, */*',
      'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
    },
    body,
  });
  const data = await res.json();
  if (data.code !== 100000) throw new Error("DECOPY_LIMIT: Daily guest quota reached. Click 'Scan' again (New ID generated) or use Standard Mode.");
  const jobId = data.result.job_id;
  
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(`${DECOPY_PROXY}${encodeURIComponent(`/api/decopy/ai-detector/get-job/${jobId}`)}`, {
      headers: { 
        'Product-Serial': getDeviceSerial(), 
        'Authorization': '', 
        'Origin': 'https://decopy.ai',
        'Accept': 'application/json'
      },
    });
    const pollData = await pollRes.json();
    if (pollData.code === 100000 && pollData.result?.output) {
      return pollData.result.output;
    }
  }
  throw new Error('Detection timed out');
};

const decopyHumanize = async (text, { length = 'standard', tone = 'normal', purpose = 'general_writing' } = {}) => {
  const params = new URLSearchParams({ entertext: text, length, tone, purpose, language: 'en', model: 'basic' });
  const res = await fetch(`${DECOPY_PROXY}${encodeURIComponent('/api/decopy/ai-humanizer/create-job')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Product-Serial': getDeviceSerial(),
      'Authorization': '',
      'Origin': 'https://decopy.ai',
      'Referer': 'https://decopy.ai/ai-humanizer/',
    },
    body: params,
  });
  const data = await res.json();
  if (data.code !== 100000) throw new Error('DAILY_LIMIT_REACHED: Decopy.ai requires login for humanization.');
  const jobId = data.result.job_id;
  
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const pollRes = await fetch(`${DECOPY_PROXY}${encodeURIComponent(`/api/decopy/ai-humanizer/get-job/${jobId}`)}`, {
      headers: { 
        'Product-Serial': getDeviceSerial(), 
        'Authorization': '', 
        'Origin': 'https://decopy.ai',
        'Accept': 'application/json'
      },
    });
    const pollData = await pollRes.json();
    if (pollData.code === 100000 && pollData.result?.output) {
      return pollData.result.output;
    }
  }
  throw new Error('Humanization timed out');
};

// -- Utils --
const getWordCount = (text) => text.trim().split(/\s+/).filter(w => w.length > 0).length;

const extractTextFromPDF = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  // using pdfjsLib loaded via CDN
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
};

const extractTextFromDOCX = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
};

const callGroq = async (systemPrompt, userText, apiKey, model, maxTokens = 1000) => {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userText }]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  } catch (err) {
    if (err.name === 'TypeError' || err.message === 'Load failed') 
      throw new Error("NETWORK_BLOCKED: Disable Ad-blockers (ABP/uBlock) or try Chrome.");
    throw err;
  }
};

const callGemini = async (systemPrompt, userText, apiKey, model = 'gemini-1.5-flash') => {
  const cleanKey = apiKey?.trim();
  const cleanModel = (model || 'gemini-1.5-flash').split('/').pop().trim();
  
  // Sequential fallback list
  const modelsToTry = [cleanModel, 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
  
  let lastError = null;

  for (const mId of modelsToTry) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mId}:generateContent?key=${cleanKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${systemPrompt}\n\nTEXT:\n${userText}` }] }] })
      });
      const data = await response.json();
      
      if (!data.error) {
        if (!data.candidates || !data.candidates[0]) throw new Error("EMPTY_RESPONSE");
        return data.candidates[0].content.parts[0].text;
      }
      lastError = data.error.message;
    } catch (err) {
      lastError = err.message;
    }
  }

  throw new Error(`CRITICAL_CORE_FAILURE: ${lastError}. \n\nTroubleshoot:\n1. DISABLE Ad-blockers (ABP/uBlock) for this site.\n2. Ensure 'Generative Language API' is ENABLED in Google AI Studio.\n3. Try switching to 'Groq' if Gemini continues to fail.`);
};

const callNvidia = async (systemPrompt, userText, apiKey, model, maxTokens = 1000) => {
  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userText }]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  } catch (err) {
    if (err.name === 'TypeError' || err.message === 'Load failed') 
      throw new Error("NETWORK_BLOCKED: Disable Ad-blockers (ABP/uBlock) or try Chrome.");
    throw err;
  }
};

const callRouter = async (systemPrompt, userText, apiKey, baseUrl, model, maxTokens = 1000) => {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userText }]
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
};

const callAI = async (systemPrompt, userText, config) => {
  const { provider, model, groqKey, geminiKey, nvidiaKey, routerKey, routerBase, maxTokens } = config;
  if (provider === 'gemini') return await callGemini(systemPrompt, userText, geminiKey, model);
  if (provider === 'nvidia') return await callNvidia(systemPrompt, userText, nvidiaKey, model, maxTokens);
  if (provider === 'router') return await callRouter(systemPrompt, userText, routerKey, routerBase, model, maxTokens);
  return await callGroq(systemPrompt, userText, groqKey, model, maxTokens);
};

// -- Components --
const CircularGauge = ({ percentage }) => {
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  const color = percentage > 70 ? '#ff4500' : percentage > 40 ? '#ffaa00' : '#ff8c00';

  return (
    <div className="relative w-40 h-40 flex items-center justify-center animate-pulse">
      <svg className="w-full h-full transform -rotate-90">
        <circle cx="80" cy="80" r="60" stroke="#111" strokeWidth="12" fill="none" />
        <circle cx="80" cy="80" r="60" stroke={color} strokeWidth="12" fill="none" 
          strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} 
          className="transition-all duration-1000 ease-out" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold orbitron" style={{ color, textShadow: `0 0 10px ${color}` }}>{percentage}%</span>
        <span className="text-[10px] text-gray-400 courier tracking-widest">AI_DETECTION</span>
      </div>
    </div>
  );
};

const AuthPage = ({ setPage, setCurrentUser, isLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [adminCode, setAdminCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    if (!email || !password) {
      setLoading(false);
      return setError("USER_INPUT_REQUIRED");
    }
    
    const allKeys = await window.storage.keys();
    const userKeys = allKeys.filter(k => k.startsWith('users:'));
    
    try {
      // -- MASTER ADMIN BYPASS (Works on all browsers) --
      const masterEmail = import.meta.env.VITE_ADMIN_EMAIL;
      const masterPass = import.meta.env.VITE_ADMIN_PASSWORD;

      if (masterEmail && masterPass && email.toLowerCase() === masterEmail.toLowerCase() && password === masterPass) {
        const masterAdmin = { email: masterEmail, password: masterPass, role: 'admin', status: 'approved', access: 'full', wordsScanned: 0 };
        // Sync to local storage if not present so history works
        const existing = await window.storage.get(`users:${email.toLowerCase()}`);
        if (!existing) await window.storage.set(`users:${email.toLowerCase()}`, masterAdmin);
        
        setCurrentUser(masterAdmin);
        setPage('detect');
        setLoading(false);
        return;
      }

      if (isLogin) {
        const userObj = await window.storage.get(`users:${email}`);
        if (!userObj) throw new Error("ID_NOT_FOUND: Accounts are browser-specific. Please Signup on this browser.");
        if (userObj.value.password !== password) throw new Error("AUTH_KEY_INVALID");
        if (userObj.value.status === 'pending') throw new Error("PENDING_ADMIN_LINK");
        if (userObj.value.status === 'blocked') throw new Error("ACCOUNT_LOCKED_BY_ADMIN");
        setCurrentUser(userObj.value);
        setPage('detect');
      } else {
        const exists = await window.storage.get(`users:${email}`);
        if (exists) throw new Error("ID_RESERVED");
        if (password.length < 6) throw new Error("KEY_LENGTH_MIN_6");
        
        // Only grant admin if secret code matches
        const role = adminCode === 'GODMODE_ADMIN' ? 'admin' : 'user';
        const status = role === 'admin' ? 'approved' : 'pending';
        const access = role === 'admin' ? 'full' : 'limited';
        
        const newUser = { email, password, role, status, access, wordsScanned: 0 };
        await window.storage.set(`users:${email}`, newUser);
        
        if (role === 'admin') {
          setCurrentUser(newUser);
          setPage('detect');
        } else {
          setError("INIT_SUCCESS_AWAIT_LINK");
          setEmail(''); setPassword(''); setAdminCode('');
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-transparent overflow-hidden p-4">
      
      <div className="z-20 w-full max-w-md animate-slide-up">
        <div className="bg-[#1a1a1a]/95 p-10 rounded shadow-2xl border border-white/5">
          <div className="text-center mb-10">
            <h2 className="text-3xl orbitron font-bold text-[#ff8c00] tracking-widest uppercase">
              {isLogin ? 'SIGN IN' : 'SIGN UP'}
            </h2>
          </div>

          <div className="flex flex-col gap-6">
            {error && <div className="text-[#ff4500] text-xs courier bg-red-900/10 p-3 border border-red-500/20 rounded">
              {'>'} ERROR: {error}
            </div>}
            
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 courier ml-1 uppercase tracking-widest">Username</label>
              <input 
                type="email" 
                value={email} 
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-[#2a2a2a] border-none p-4 rounded text-white focus:outline-none focus:ring-2 focus:ring-[#ff8c00]/50 transition-all"
                placeholder="root@mainframe"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 courier ml-1 uppercase tracking-widest">Password</label>
              <input 
                type="password" 
                value={password} 
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-[#2a2a2a] border-none p-4 rounded text-white focus:outline-none focus:ring-2 focus:ring-[#ff8c00]/50 transition-all"
                placeholder="********"
              />
            </div>

            {!isLogin && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-500 courier ml-1 uppercase tracking-widest">Admin Access Code (Optional)</label>
                <input 
                  type="password" 
                  value={adminCode} 
                  onChange={e => setAdminCode(e.target.value)}
                  className="w-full bg-[#2a2a2a] border-none p-4 rounded text-white focus:outline-none focus:ring-2 focus:ring-[#ff8c00]/50 transition-all"
                  placeholder="Leave empty for basic user"
                />
              </div>
            )}

            <div className="flex justify-between items-center text-[10px] courier text-gray-500 uppercase tracking-widest px-1">
              <span className="hover:text-white cursor-pointer transition">Forgot Password</span>
              <span className="text-[#ff8c00] hover:underline cursor-pointer transition" onClick={() => setPage(isLogin ? 'signup' : 'login')}>
                {isLogin ? 'Signup' : 'Login'}
              </span>
            </div>

            <button 
              onClick={handleSubmit} 
              disabled={loading}
              className="w-full bg-[#ffa500] text-black font-bold py-4 rounded orbitron hover:bg-[#ff8c00] shadow-[0_0_20px_rgba(255,165,0,0.3)] hover:shadow-[0_0_30px_rgba(255,140,0,0.5)] transition-all active:scale-95 uppercase tracking-widest"
            >
              {loading ? 'WAITING...' : (isLogin ? 'Login' : 'Initialize')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const DetectPage = ({ currentUser, config, onHumanizeRequest, initialText = '' }) => {
  const [text, setText] = useState(initialText);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true); setError('');
    try {
      let extracted = '';
      if (file.name.endsWith('.pdf')) {
        extracted = await extractTextFromPDF(file);
      } else if (file.name.endsWith('.docx')) {
        extracted = await extractTextFromDOCX(file);
      } else {
        extracted = await file.text();
      }
      setText(extracted);
    } catch (err) {
      setError("File extraction failed: " + err.message);
    }
    setLoading(false);
  };

  const handleScan = async () => {
    setError(''); setResult(null);
    if (!text.trim()) return setError("Please enter text or upload a file.");
    const words = getWordCount(text);
    const limit = currentUser.role === 'admin' ? Infinity : (currentUser.access === 'full' ? 10000 : 1000);
    if (words > limit) {
      return setError(`Word limit exceeded for your tier (${limit}). Contact admin for full access.`);
    }
    
    const { provider, groqKey, geminiKey, nvidiaKey, routerKey } = config;
    if (provider === 'groq' && !groqKey) return setError("Groq Key missing.");
    if (provider === 'gemini' && !geminiKey) return setError("Gemini Key missing.");
    if (provider === 'nvidia' && !nvidiaKey) return setError("NVIDIA Key missing.");
    if (provider === 'router' && !routerKey) return setError("Router Key missing.");

    setLoading(true);
    const systemPrompt = `You are an expert AI content detector. Analyze the text and return ONLY a JSON object:
{
  "ai_percentage": <0-100 number>,
  "human_percentage": <0-100 number>,
  "confidence": "<Low|Medium|High>",
  "verdict": "<Likely AI-Generated|Possibly AI-Generated|Likely Human-Written>",
  "suspicious_patterns": ["pattern1", "pattern2"],
  "sentence_analysis": [
    {"sentence": "first 8 words...", "ai_probability": <0-100>}
  ],
  "writing_style_notes": "brief analysis"
}
Return ONLY the JSON. No markdown. No explanation.`;

    try {
      const res = await callAI(systemPrompt, text, { ...config, maxTokens: 1000 });
      const raw = res.replace(/```json/gi, '').replace(/```/gi, '').trim();
      const data = JSON.parse(raw);
      setResult(data);
      
      await window.storage.set(`history:${currentUser.email}:${Date.now()}`, {
        type: 'detection',
        wordCount: words,
        aiPercent: data.ai_percentage,
        date: new Date().toISOString(),
        textPreview: text.substring(0, 100) + '...'
      });
      
      // Update words scanned
      const userObj = await window.storage.get(`users:${currentUser.email}`);
      if(userObj) {
        userObj.value.wordsScanned = (userObj.value.wordsScanned || 0) + words;
        await window.storage.set(`users:${currentUser.email}`, userObj.value);
      }
    } catch (err) {
      setError("Detection failed: " + err.message);
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto h-full overflow-hidden">
      <h2 className="text-xl md:text-2xl orbitron text-[#ff8c00]">AI Content Detection</h2>
      <div className={`glass p-4 md:p-6 rounded-lg flex flex-col gap-4 scan-container ${result ? 'h-48' : 'flex-1'}`}>
        {loading && <div className="scan-line"></div>}
        <div className="flex justify-between items-center">
          <label className="cursor-pointer bg-[#222] hover:bg-[#333] px-4 py-2 rounded flex items-center gap-2 border border-[#444] transition">
            <Upload size={18} /> Upload PDF/DOCX
            <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={handleFileUpload} />
          </label>
          <div className="text-sm text-gray-400">Words: {getWordCount(text)} {currentUser.role==='user' && '/ 5000'}</div>
        </div>
        <textarea 
          value={text} onChange={e => setText(e.target.value)}
          placeholder="Paste your text here..."
          className="w-full flex-1 bg-[#111] border border-[#333] rounded p-4 focus:outline-none focus:border-[#ff8c00] resize-none text-white min-h-0"
        ></textarea>
        {error && <div className="text-[#ff4500] text-sm">{error}</div>}
        <button onClick={handleScan} disabled={loading} className="bg-[#ff8c00] text-black font-bold py-3 rounded hover:bg-[#e67e00] transition disabled:opacity-50 shrink-0">
          {loading ? <span className="typewriter">🔍 Analyzing patterns...</span> : 'Analyze Content'}
        </button>
      </div>

      {result && (
        <div className="animated-border p-[1px] mt-2 flex-1 min-h-0">
          <div className="glass p-4 md:p-6 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-6 h-full overflow-y-auto">
            <div className="col-span-1 flex flex-col items-center justify-center gap-4 md:border-r border-[#333] md:pr-6">
              <CircularGauge percentage={result.ai_percentage} />
              <div className={`px-4 py-1 rounded text-sm font-bold ${result.ai_percentage > 70 ? 'bg-[#ff4500]/20 text-[#ff4500]' : result.ai_percentage > 40 ? 'bg-yellow-500/20 text-yellow-500' : 'bg-[#ff8c00]/20 text-[#ff8c00]'}`}>
                {result.verdict}
              </div>
              <div className="text-sm text-gray-400">Confidence: <span className="text-white">{result.confidence}</span></div>
              {onHumanizeRequest && (
                <button onClick={() => onHumanizeRequest(text)} className="mt-2 flex items-center gap-2 border border-[#ff8c00] text-[#ff8c00] px-4 py-2 rounded hover:bg-[#ff8c00]/10 transition text-sm">
                  <Wand2 size={16} /> Humanize Text
                </button>
              )}
            </div>
            <div className="col-span-2 flex flex-col gap-4 min-h-0 overflow-y-auto">
              <div>
                <h3 className="orbitron text-base mb-1 text-gray-300">Suspicious Patterns</h3>
                <ul className="list-disc pl-5 text-sm text-[#ff4500]">
                  {result.suspicious_patterns?.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
              <div>
                <h3 className="orbitron text-base mb-1 text-gray-300">Writing Style Notes</h3>
                <p className="text-sm text-gray-400">{result.writing_style_notes}</p>
              </div>
              <div>
                <h3 className="orbitron text-base mb-1 text-gray-300">Sentence Analysis</h3>
                <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-2">
                  {result.sentence_analysis?.map((s, i) => (
                    <div key={i} className="bg-[#111] p-2 rounded flex justify-between text-xs items-center border border-[#222]">
                      <span className="truncate mr-4 text-gray-300">"{s.sentence}"</span>
                      <span className={`${s.ai_probability > 70 ? 'text-[#ff4500]' : 'text-[#ff8c00]'}`}>{s.ai_probability}% AI</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const HumanizePage = ({ currentUser, config, initialText = '', onDetectRequest }) => {
  const [text, setText] = useState(initialText);
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleHumanize = async () => {
    setError(''); setResult(''); setCopied(false);
    if (!text.trim()) return setError("Please enter text.");
    const words = getWordCount(text);
    const limit = currentUser.role === 'admin' ? Infinity : (currentUser.access === 'full' ? 10000 : 1000);
    if (words > limit) {
      return setError(`Word limit exceeded for your tier (${limit}). Contact admin for full access.`);
    }
    
    const { provider, groqKey, geminiKey, nvidiaKey, routerKey } = config;
    if (provider === 'groq' && !groqKey) return setError("Groq Key missing.");
    if (provider === 'gemini' && !geminiKey) return setError("Gemini Key missing.");
    if (provider === 'nvidia' && !nvidiaKey) return setError("NVIDIA Key missing.");
    if (provider === 'router' && !routerKey) return setError("Router Key missing.");

    setLoading(true);
    const systemPrompt = `You are an expert text humanizer. Rewrite the given text to sound 100% human-written.
Rules:
- Preserve ALL meaning, facts, data, numbers exactly
- Keep word count within ±5% of original (CRITICAL: match original length)
- Use varied sentence structures, natural flow, occasional imperfections
- Avoid robotic transitions (Furthermore, Moreover, Additionally)
- Use contractions, colloquial phrases where appropriate
- Output ONLY the rewritten text. No explanations. No preamble.`;

    try {
      const res = await callAI(systemPrompt, text, { ...config, maxTokens: 4000 });
      setResult(res.trim());
      await window.storage.set(`history:${currentUser.email}:${Date.now()}`, {
        type: 'humanize',
        wordCount: words,
        aiPercent: 'N/A',
        date: new Date().toISOString(),
        textPreview: res.substring(0, 100) + '...'
      });
      // Update words scanned
      const userObj = await window.storage.get(`users:${currentUser.email}`);
      if(userObj) {
        userObj.value.wordsScanned = (userObj.value.wordsScanned || 0) + words;
        await window.storage.set(`users:${currentUser.email}`, userObj.value);
      }
    } catch (err) {
      setError("Humanization failed: " + err.message);
    }
    setLoading(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-4 max-w-6xl mx-auto h-full overflow-hidden">
      <div className="flex justify-between items-center px-1">
        <h2 className="text-xl md:text-2xl orbitron text-[#ff8c00]">Text Humanizer</h2>
        <div className="text-[10px] courier text-gray-500 uppercase">Limit: {currentUser.access === 'full' ? '10k' : '1k'} words</div>
      </div>
      
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-0">
        <div className="glass p-4 rounded-lg flex flex-col gap-2 scan-container min-h-0">
          <div className="flex justify-between items-center mb-1">
            <span className="orbitron text-xs text-gray-300 uppercase tracking-widest">Input Stream</span>
            <span className="text-[10px] text-gray-500 courier">Words: {getWordCount(text)}</span>
          </div>
          <textarea 
            value={text} onChange={e => setText(e.target.value)}
            placeholder="Paste AI-generated text here..."
            className="flex-1 bg-[#111] border border-[#333] rounded p-4 focus:outline-none focus:border-[#ff8c00] resize-none text-white text-sm min-h-0 courier"
          ></textarea>
          <button onClick={handleHumanize} disabled={loading} className="bg-[#ff8c00] text-black font-bold py-3 rounded hover:bg-[#e67e00] transition disabled:opacity-50 mt-1 shrink-0 orbitron uppercase text-xs tracking-wider">
            {loading ? <span className="typewriter">✨ RECODING TEXT...</span> : 'HUMANIZE'}
          </button>
          {error && <div className="text-[#ff4500] text-[10px] mt-1 courier uppercase">{'>'} ERROR: {error}</div>}
        </div>

        <div className="animated-border p-[1px] flex flex-col min-h-0">
          <div className="glass p-4 rounded-lg flex flex-col gap-2 h-full min-h-0">
            <div className="flex justify-between items-center mb-1">
              <span className="orbitron text-xs text-[#ff8c00] uppercase tracking-widest">Humanized Output</span>
              {result && <span className="text-[10px] text-gray-500 courier">Words: {getWordCount(result)}</span>}
            </div>
            <div className="flex-1 bg-[#0a0a0f] border border-[#222] rounded p-4 overflow-y-auto whitespace-pre-wrap text-gray-200 text-sm min-h-0 courier">
              {result ? result : <span className="text-gray-700 italic">SYSTEM READY... AWAITING INPUT...</span>}
            </div>
            {result && (
              <div className="flex gap-2 mt-1 shrink-0">
                <button onClick={copyToClipboard} className="flex-1 flex items-center justify-center gap-2 border border-[#333] hover:border-[#ff8c00] text-gray-300 py-2 rounded transition text-[10px] uppercase orbitron tracking-wider">
                  {copied ? <><Check size={14} /> COPIED!</> : <><Copy size={14} /> COPY</>}
                </button>
                {onDetectRequest && (
                  <button onClick={() => onDetectRequest(result)} className="flex-1 flex items-center justify-center gap-2 border border-[#ff8c00] text-[#ff8c00] py-2 rounded hover:bg-[#ff8c00]/10 transition text-[10px] uppercase orbitron tracking-wider">
                    <Shield size={14} /> RE-SCAN
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const AdvancedPage = ({ currentUser, config }) => {
  const [activeTab, setActiveTab] = useState('detect');
  // Detect state
  const [detectText, setDetectText] = useState('');
  const [detectLoading, setDetectLoading] = useState(false);
  const [detectResult, setDetectResult] = useState(null);
  const [detectError, setDetectError] = useState('');
  const [detectProgress, setDetectProgress] = useState('');
  // Humanize state
  const [humanizeText, setHumanizeText] = useState('');
  const [humanizeResult, setHumanizeResult] = useState('');
  const [humanizeLoading, setHumanizeLoading] = useState(false);
  const [humanizeError, setHumanizeError] = useState('');
  const [humanizeProgress, setHumanizeProgress] = useState('');
  const [tone, setTone] = useState('normal');
  const [purpose, setPurpose] = useState('general_writing');
  const [length, setLength] = useState('standard');
  const [copied, setCopied] = useState(false);

  const runDetect = async () => {
    if (!detectText.trim()) return setDetectError('Please enter text to detect.');
    if (detectText.length < 50) return setDetectError('Text too short for accurate detection (min 50 chars).');
    
    setDetectLoading(true); setDetectResult(null); setDetectError('');
    
    // Try Decopy first
    setDetectProgress('⏳ Connecting to Decopy.ai ML model...');
    try {
      const output = await decopyDetect(detectText);
      setDetectResult(output);
      setDetectProgress('');
      setDetectLoading(false);
      return;
    } catch (e) {
      console.warn('Decopy Blocked:', e);
    }

    // Fallback to God Mode AI Engine
    if (config.geminiKey || config.groqKey || config.nvidiaKey || config.routerKey) {
      setDetectProgress('🚀 Decopy Busy. Activating God Mode AI Engine...');
      try {
        const systemPrompt = `Analyze for AI content. Return JSON ONLY: {"score": <0.0-1.0>, "sentences": [{"content": "...", "score": <0.0-1.0>}], "verdict": "...", "confidence": <0.0-1.0>}`;
        const res = await callAI(systemPrompt, `Analyze this text for AI probability: "${detectText}"`, { ...config, maxTokens: 2000 });
        const jsonMatch = res.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("AI returned invalid data format.");
        const data = JSON.parse(jsonMatch[0]);
        setDetectResult({
          score: data.score || 0,
          sentences: data.sentences || [],
          language: 'en',
          isGodMode: true
        });
        setDetectProgress('✅ Deep Analysis Complete (via God Mode Engine)');
      } catch (innerE) {
        setDetectError("Engine Error: " + innerE.message);
      }
    } else {
      setDetectError("Decopy Quota Full. Please add a Gemini/Groq Key in Settings to activate the 'God Mode' AI Engine backup.");
    }
    setDetectLoading(false);
  };

  const runHumanize = async () => {
    if (!humanizeText.trim()) return setHumanizeError('Please enter text.');
    setHumanizeLoading(true); setHumanizeResult(''); setHumanizeError('');
    setHumanizeProgress('📡 Sending to decopy.ai humanizer...');
    try {
      setHumanizeProgress('⏳ Humanizing... (may take up to 30s)');
      const output = await decopyHumanize(humanizeText, { length, tone, purpose });
      // output can be string or object with text field
      const resultText = typeof output === 'string' ? output : (output?.text || output?.result || JSON.stringify(output));
      setHumanizeResult(resultText);
      setHumanizeProgress('');
    } catch (e) {
      setHumanizeError(e.message);
      setHumanizeProgress('');
    }
    setHumanizeLoading(false);
  };

  const aiScore = detectResult ? Math.round((detectResult.score || 0) * 100) : 0;
  const scoreColor = aiScore > 70 ? '#ff4500' : aiScore > 40 ? '#ffaa00' : '#ff8c00';

  return (
    <div className="flex flex-col gap-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl md:text-2xl orbitron text-[#ff8c00]">Advanced Mode</span>
          <span className="text-[10px] courier text-gray-500 border border-[#333] rounded px-2 py-0.5 uppercase">
            {detectResult?.isGodMode ? 'God Mode AI Engine' : 'Powered by decopy.ai'}
          </span>
        </div>
      </div>

      {/* Tab Switch */}
      <div className="flex gap-2 p-1 bg-[#111] rounded-lg border border-[#222] w-fit">
        <button
          onClick={() => setActiveTab('detect')}
          className={`px-4 py-2 rounded text-xs orbitron uppercase tracking-widest transition-all ${
            activeTab === 'detect'
              ? 'bg-[#ff8c00] text-black font-bold shadow-[0_0_15px_rgba(255,140,0,0.4)]'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          AI Detector
        </button>
        <button
          onClick={() => setActiveTab('humanize')}
          className={`px-4 py-2 rounded text-xs orbitron uppercase tracking-widest transition-all ${
            activeTab === 'humanize'
              ? 'bg-[#ff8c00] text-black font-bold shadow-[0_0_15px_rgba(255,140,0,0.4)]'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Humanizer
        </button>
      </div>

      {/* ---- DETECT TAB ---- */}
      {activeTab === 'detect' && (
        <div className="flex flex-col gap-4">
          <div className="glass p-4 md:p-6 rounded-lg flex flex-col gap-4 scan-container border border-[#ff8c00]/10">
            {detectLoading && <div className="scan-line"></div>}
            <div className="flex justify-between items-center">
              <span className="orbitron text-xs text-gray-400 uppercase tracking-widest">Input Text</span>
              <span className="text-[10px] courier text-gray-500">{getWordCount(detectText)} words</span>
            </div>
            <textarea
              value={detectText}
              onChange={e => setDetectText(e.target.value)}
              placeholder="Paste your text here — decopy.ai will scan it with their ML model..."
              className="w-full h-48 bg-[#0a0a0f] border border-[#222] rounded p-4 focus:outline-none focus:border-[#ff8c00] resize-none text-white text-sm"
            />
            {detectError && <div className="text-[#ff4500] text-xs courier">{'>'} ERROR: {detectError}</div>}
            {detectProgress && <div className="text-[#ff8c00] text-xs courier typewriter">{detectProgress}</div>}
            <button
              onClick={runDetect}
              disabled={detectLoading}
              className="bg-[#ff8c00] text-black font-bold py-3 rounded hover:bg-[#e67e00] transition disabled:opacity-50 orbitron uppercase text-xs tracking-widest"
            >
              {detectLoading ? <span className="typewriter">Analyzing...</span> : 'Scan with Decopy.ai'}
            </button>
          </div>

          {detectResult && (
            <div className="animated-border p-[1px] rounded-lg">
              <div className="glass p-4 md:p-6 rounded-lg flex flex-col gap-6">
                {/* Score overview */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col items-center justify-center gap-2 py-4 border border-[#222] rounded-lg bg-[#0a0a0f]">
                    <div className="text-5xl font-bold orbitron" style={{ color: scoreColor, textShadow: `0 0 20px ${scoreColor}` }}>
                      {aiScore}%
                    </div>
                    <div className="text-[10px] courier text-gray-500 uppercase tracking-widest">AI Score</div>
                    <div className={`text-xs font-bold px-3 py-1 rounded mt-1 ${
                      aiScore > 70 ? 'bg-[#ff4500]/20 text-[#ff4500]' :
                      aiScore > 40 ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-[#ff8c00]/20 text-[#ff8c00]'
                    }`}>
                      {aiScore > 70 ? 'Likely AI-Generated' : aiScore > 40 ? 'Mixed Content' : 'Likely Human'}
                    </div>
                  </div>
                  <div className="md:col-span-2 flex flex-col gap-2">
                    <div className="flex justify-between items-center text-xs courier mb-1">
                      <span className="text-gray-400">Human</span>
                      <span className="text-gray-400">AI</span>
                    </div>
                    <div className="h-4 rounded-full bg-[#111] border border-[#222] overflow-hidden">
                      <div
                        className="h-full transition-all duration-1000 ease-out"
                        style={{
                          width: `${aiScore}%`,
                          background: `linear-gradient(90deg, ${scoreColor}80, ${scoreColor})`,
                          boxShadow: `0 0 12px ${scoreColor}`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] courier text-gray-500 mt-1">
                      <span>{100 - aiScore}% Human</span>
                      <span>{aiScore}% AI</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-[#111] rounded p-3 border border-[#222]">
                        <div className="text-gray-500 courier text-[10px] uppercase mb-1">Language</div>
                        <div className="text-white font-mono">{(detectResult.language || 'en').toUpperCase()}</div>
                      </div>
                      <div className="bg-[#111] rounded p-3 border border-[#222]">
                        <div className="text-gray-500 courier text-[10px] uppercase mb-1">Sentences</div>
                        <div className="text-white font-mono">{detectResult.success_count || detectResult.sentences?.length || 0}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sentence-level analysis */}
                {detectResult.sentences?.length > 0 && (
                  <div>
                    <h3 className="orbitron text-xs text-gray-300 uppercase tracking-widest mb-3">Sentence Analysis</h3>
                    <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                      {detectResult.sentences.map((s, i) => {
                        const pct = Math.round((s.score || 0) * 100);
                        const c = pct > 70 ? '#ff4500' : pct > 40 ? '#ffaa00' : '#ff8c00';
                        return (
                          <div key={i} className="bg-[#0a0a0f] border border-[#1a1a1a] rounded p-3 flex items-start gap-3">
                            <div className="shrink-0 w-8 h-8 rounded flex items-center justify-center text-[10px] font-bold" style={{ background: `${c}20`, color: c }}>
                              {pct}%
                            </div>
                            <span className="text-gray-300 text-xs leading-relaxed">{s.content}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- HUMANIZE TAB ---- */}
      {activeTab === 'humanize' && (
        <div className="flex flex-col gap-4">
          {/* Options row */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] courier text-gray-500 uppercase mb-1 block">Length</label>
              <select value={length} onChange={e => setLength(e.target.value)} className="w-full bg-[#111] border border-[#333] rounded p-2 text-white text-xs focus:outline-none focus:border-[#ff8c00]">
                <option value="shorten">Shorten</option>
                <option value="standard">Standard</option>
                <option value="expand">Expand</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] courier text-gray-500 uppercase mb-1 block">Tone</label>
              <select value={tone} onChange={e => setTone(e.target.value)} className="w-full bg-[#111] border border-[#333] rounded p-2 text-white text-xs focus:outline-none focus:border-[#ff8c00]">
                <option value="normal">Normal</option>
                <option value="professional">Professional</option>
                <option value="academic">Academic</option>
                <option value="formal">Formal</option>
                <option value="business">Business</option>
                <option value="creative">Creative</option>
                <option value="friendly">Friendly</option>
                <option value="colloquial">Colloquial</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] courier text-gray-500 uppercase mb-1 block">Purpose</label>
              <select value={purpose} onChange={e => setPurpose(e.target.value)} className="w-full bg-[#111] border border-[#333] rounded p-2 text-white text-xs focus:outline-none focus:border-[#ff8c00]">
                <option value="general_writing">General Writing</option>
                <option value="academic">Academic</option>
                <option value="essay">Essay</option>
                <option value="blog">Blog</option>
                <option value="marketing_material">Marketing</option>
                <option value="story">Story</option>
                <option value="report">Report</option>
                <option value="business_material">Business</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Input */}
            <div className="glass p-4 rounded-lg flex flex-col gap-3 scan-container border border-[#ff8c00]/10">
              {humanizeLoading && <div className="scan-line"></div>}
              <div className="flex justify-between items-center">
                <span className="orbitron text-xs text-gray-400 uppercase tracking-widest">AI Text Input</span>
                <span className="text-[10px] courier text-gray-500">{getWordCount(humanizeText)}w</span>
              </div>
              <textarea
                value={humanizeText}
                onChange={e => setHumanizeText(e.target.value)}
                placeholder="Paste AI-generated text here — decopy.ai will rewrite it to sound human..."
                className="flex-1 h-48 bg-[#0a0a0f] border border-[#222] rounded p-4 focus:outline-none focus:border-[#ff8c00] resize-none text-white text-sm courier"
              />
              {humanizeError && <div className="text-[#ff4500] text-[10px] courier">{'>'} ERROR: {humanizeError}</div>}
              {humanizeProgress && <div className="text-[#ff8c00] text-[10px] courier typewriter">{humanizeProgress}</div>}
              <button
                onClick={runHumanize}
                disabled={humanizeLoading}
                className="bg-[#ff8c00] text-black font-bold py-3 rounded hover:bg-[#e67e00] transition disabled:opacity-50 orbitron uppercase text-xs tracking-widest"
              >
                {humanizeLoading ? <span className="typewriter">Humanizing...</span> : 'Humanize via Decopy.ai'}
              </button>
            </div>

            {/* Output */}
            <div className="animated-border p-[1px] flex flex-col">
              <div className="glass p-4 rounded-lg flex flex-col gap-3 h-full">
                <div className="flex justify-between items-center">
                  <span className="orbitron text-xs text-[#ff8c00] uppercase tracking-widest">Humanized Output</span>
                  {humanizeResult && <span className="text-[10px] text-gray-500 courier">{getWordCount(humanizeResult)}w</span>}
                </div>
                <div className="flex-1 h-48 bg-[#0a0a0f] border border-[#222] rounded p-4 overflow-y-auto whitespace-pre-wrap text-gray-200 text-sm courier">
                  {humanizeResult
                    ? humanizeResult
                    : <span className="text-gray-700 italic">Humanized text will appear here...</span>
                  }
                </div>
                {humanizeResult && (
                  <button
                    onClick={() => { navigator.clipboard.writeText(humanizeResult); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    className="flex items-center justify-center gap-2 border border-[#333] hover:border-[#ff8c00] text-gray-300 py-2 rounded transition text-[10px] uppercase orbitron tracking-wider"
                  >
                    {copied ? <><Check size={12} /> COPIED!</> : <><Copy size={12} /> COPY OUTPUT</>}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const HistoryPage = ({ currentUser }) => {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const loadHistory = async () => {
      const keys = await window.storage.keys();
      const historyKeys = currentUser.role === 'admin' 
        ? keys.filter(k => k.startsWith('history:'))
        : keys.filter(k => k.startsWith(`history:${currentUser.email}:`));
      
      const items = [];
      for (let k of historyKeys) {
        const data = await window.storage.get(k);
        const [, email, timestamp] = k.split(':');
        items.push({ ...data.value, email, timestamp: parseInt(timestamp) });
      }
      setHistory(items.sort((a,b) => b.timestamp - a.timestamp));
    };
    loadHistory();
  }, [currentUser]);

  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto">
      <h2 className="text-xl md:text-2xl orbitron text-[#ff8c00]">Scan History</h2>
      <div className="glass rounded-lg overflow-hidden border border-[#333]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#111] text-gray-400 border-b border-[#333]">
            <tr>
              <th className="p-4">Date</th>
              {currentUser.role === 'admin' && <th className="p-4">User</th>}
              <th className="p-4">Type</th>
              <th className="p-4">Words</th>
              <th className="p-4">AI %</th>
              <th className="p-4">Preview</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i} className="border-b border-[#222] hover:bg-[#111] transition">
                <td className="p-4 text-gray-300">{new Date(h.date).toLocaleString()}</td>
                {currentUser.role === 'admin' && <td className="p-4 text-gray-400">{h.email}</td>}
                <td className="p-4"><span className={`px-2 py-1 rounded text-xs ${h.type==='detection' ? 'bg-[#ff8c00]/10 text-[#ff8c00]' : 'bg-[#ff4500]/10 text-[#ff4500]'}`}>{h.type}</span></td>
                <td className="p-4 text-gray-300">{h.wordCount}</td>
                <td className="p-4 text-gray-300">{h.aiPercent}</td>
                <td className="p-4 text-gray-500 truncate max-w-xs">{h.textPreview}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-gray-500">No history found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const AdminPage = () => {
  const [users, setUsers] = useState([]);

  const loadUsers = async () => {
    const keys = await window.storage.keys();
    const userKeys = keys.filter(k => k.startsWith('users:'));
    const items = [];
    for (let k of userKeys) {
      const data = await window.storage.get(k);
      items.push(data.value);
    }
    setUsers(items);
  };

  useEffect(() => { loadUsers(); }, []);

  const toggleRole = async (email, currentRole) => {
    const key = `users:${email}`;
    const data = await window.storage.get(key);
    if (data) {
      data.value.role = currentRole === 'admin' ? 'user' : 'admin';
      await window.storage.set(key, data.value);
      loadUsers();
    }
  };

  const approveUser = async (email) => {
    const key = `users:${email}`;
    const data = await window.storage.get(key);
    if (data) {
      data.value.status = 'approved';
      if (!data.value.access) data.value.access = 'limited';
      await window.storage.set(key, data.value);
      loadUsers();
    }
  };

  const toggleBlock = async (email, currentStatus) => {
    const key = `users:${email}`;
    const data = await window.storage.get(key);
    if (data) {
      data.value.status = currentStatus === 'blocked' ? 'approved' : 'blocked';
      await window.storage.set(key, data.value);
      loadUsers();
    }
  };

  const toggleAccess = async (email, currentAccess) => {
    const key = `users:${email}`;
    const data = await window.storage.get(key);
    if (data) {
      data.value.access = currentAccess === 'full' ? 'limited' : 'full';
      await window.storage.set(key, data.value);
      loadUsers();
    }
  };

  const deleteUser = async (email) => {
    if(window.confirm(`Delete ${email}?`)) {
      const keys = await window.storage.keys();
      if (keys.includes(`users:${email}`)) {
        // Find the key and delete. Assuming window.storage has a generic way or I use set(key, undefined)
        // Based on previous code, I'll use set with null if delete isn't clear, 
        // but let's try to find if there's a delete/remove.
        // Actually, I'll just use a filter and re-save? No, window.storage is a KV store.
        await window.storage.set(`users:${email}`, undefined);
      }
      loadUsers();
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-6xl mx-auto h-full overflow-hidden">
      <div className="flex justify-between items-center px-1">
        <h2 className="text-xl md:text-2xl orbitron text-[#ff8c00]">System Registry</h2>
        <div className="text-[10px] courier text-gray-500 uppercase tracking-widest">Active nodes: {users.length}</div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
        {/* Desktop Table */}
        <div className="hidden md:block glass rounded-lg overflow-hidden border border-[#333]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#111] text-gray-500 border-b border-[#333] orbitron text-[10px] uppercase tracking-widest">
              <tr>
                <th className="p-4">Identity</th>
                <th className="p-4">Role</th>
                <th className="p-4">Status</th>
                <th className="p-4">Tier</th>
                <th className="p-4">Usage</th>
                <th className="p-4 text-right">Access Control</th>
              </tr>
            </thead>
            <tbody>
              {users.filter(u => u).map((u, i) => (
                <tr key={i} className="border-b border-[#222] hover:bg-[#111] transition text-xs">
                  <td className="p-4 text-gray-300 font-mono">{u.email}</td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase courier ${u.role==='admin' ? 'bg-[#ff4500]/20 text-[#ff4500]' : 'bg-gray-800 text-gray-400'}`}>{u.role}</span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase courier ${u.status==='approved' ? 'bg-[#ff8c00]/20 text-[#ff8c00]' : u.status==='blocked' ? 'bg-red-900/40 text-red-500' : 'bg-yellow-500/20 text-yellow-500'}`}>{u.status}</span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase courier ${u.access==='full' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-700 text-gray-500'}`}>{u.access || 'limited'}</span>
                  </td>
                  <td className="p-4 text-gray-400 courier">{u.wordsScanned || 0} w</td>
                  <td className="p-4 text-right flex justify-end gap-1">
                    {u.status === 'pending' && (
                      <button onClick={()=>approveUser(u.email)} className="bg-[#ff8c00]/20 text-[#ff8c00] hover:bg-[#ff8c00] hover:text-black text-[9px] px-2 py-1 rounded uppercase orbitron">Link</button>
                    )}
                    <button onClick={()=>toggleBlock(u.email, u.status)} className={`text-[9px] px-2 py-1 rounded border border-[#333] uppercase orbitron ${u.status==='blocked' ? 'bg-red-600 text-white border-none' : 'hover:bg-[#333]'}`}>{u.status === 'blocked' ? 'Unlock' : 'Lock'}</button>
                    <button onClick={()=>toggleAccess(u.email, u.access)} className="border border-[#444] text-[9px] px-2 py-1 rounded hover:border-blue-400 uppercase orbitron">Tier</button>
                    <button onClick={()=>toggleRole(u.email, u.role)} className="border border-[#444] text-[9px] px-2 py-1 rounded hover:border-[#ff8c00] uppercase orbitron">Priv</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card List */}
        <div className="md:hidden flex flex-col gap-3">
          {users.filter(u => u).map((u, i) => (
            <div key={i} className="glass p-4 rounded-lg border border-[#333] flex flex-col gap-3">
              <div className="flex justify-between items-start">
                <div className="flex flex-col gap-1 overflow-hidden">
                  <span className="text-xs font-mono text-gray-300 truncate">{u.email}</span>
                  <div className="flex gap-2">
                    <span className={`text-[8px] px-1.5 py-0.5 rounded uppercase courier ${u.role==='admin' ? 'bg-[#ff4500]/20 text-[#ff4500]' : 'bg-gray-800 text-gray-400'}`}>{u.role}</span>
                    <span className={`text-[8px] px-1.5 py-0.5 rounded uppercase courier ${u.access==='full' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-700 text-gray-400'}`}>{u.access || 'limited'}</span>
                  </div>
                </div>
                <span className={`text-[8px] px-1.5 py-0.5 rounded uppercase courier ${u.status==='approved' ? 'bg-[#ff8c00]/20 text-[#ff8c00]' : u.status==='blocked' ? 'bg-red-900 text-white' : 'bg-yellow-500/20 text-yellow-500'}`}>{u.status}</span>
              </div>
              <div className="text-[10px] text-gray-500 courier tracking-tight">DATA_USAGE: {u.wordsScanned || 0} WORDS</div>
              <div className="flex gap-2 pt-2 border-t border-[#222]">
                {u.status === 'pending' && (
                  <button onClick={()=>approveUser(u.email)} className="flex-1 bg-[#ff8c00]/20 text-[#ff8c00] py-2 rounded text-[9px] uppercase font-bold orbitron">Link</button>
                )}
                <button onClick={()=>toggleBlock(u.email, u.status)} className="flex-1 border border-[#333] py-2 rounded text-[9px] uppercase orbitron hover:bg-red-900">{u.status === 'blocked' ? 'Unlock' : 'Lock'}</button>
                <button onClick={()=>toggleAccess(u.email, u.access)} className="flex-1 border border-[#333] py-2 rounded text-[9px] uppercase orbitron">Tier</button>
                <button onClick={()=>toggleRole(u.email, u.role)} className="flex-1 border border-[#333] py-2 rounded text-[9px] uppercase orbitron">Priv</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const SettingsPage = ({ config, setConfig, isAdmin, currentUser, setCurrentUser }) => {
  const [showGroq, setShowGroq] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [showRouter, setShowRouter] = useState(false);
  const [saved, setSaved] = useState(false);
  
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  const saveGlobal = async () => {
    if(isAdmin) {
      await window.storage.set('config:all', config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto pb-10">
      <h2 className="text-xl md:text-2xl orbitron text-[#ff8c00]">System Settings</h2>
      
      <div className="glass p-4 md:p-6 rounded-lg flex flex-col gap-4 border border-[#333]">
        <h3 className="orbitron text-xs text-[#ff8c00] border-b border-[#333] pb-2 uppercase tracking-widest">AI Core Configuration</h3>
        <select 
          value={config.provider} 
          onChange={e => setConfig({...config, provider: e.target.value})}
          className="w-full bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#ff8c00] text-white text-sm"
        >
          <option value="groq">Groq (Llama Models - Fast)</option>
          <option value="gemini">Google Gemini (Best for Large Texts)</option>
          <option value="nvidia">NVIDIA NIM (Ultra High Performance)</option>
          <option value="router">Unified Router (AgentRouter/OneAPI)</option>
        </select>
        
        <div>
          <label className="block text-gray-500 mb-1 text-[10px] uppercase courier">Active Model ID</label>
          <input 
            type="text" 
            value={config.model} 
            onChange={e => setConfig({...config, model: e.target.value})}
            className="w-full bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#ff8c00] text-white text-sm"
            placeholder="e.g. gemini-1.5-flash"
          />
        </div>

        {isAdmin ? (
          <div className="mt-2 flex flex-col gap-4">
            {/* Groq */}
            <div className={`p-4 border rounded ${config.provider === 'groq' ? 'border-[#ff8c00] bg-[#ff8c00]/5' : 'border-[#333]'}`}>
              <label className="block text-[10px] text-gray-500 mb-2 uppercase courier">Groq API Key</label>
              <div className="flex gap-2">
                <input type={showGroq ? "text" : "password"} value={config.groqKey} onChange={e => setConfig({...config, groqKey: e.target.value})}
                  className="flex-1 bg-[#0a0a0f] border border-[#333] p-2 rounded text-white text-sm" />
                <button onClick={() => setShowGroq(!showGroq)} className="px-2 text-xs">👁</button>
              </div>
            </div>

            {/* Gemini */}
            <div className={`p-4 border rounded ${config.provider === 'gemini' ? 'border-[#ff8c00] bg-[#ff8c00]/5' : 'border-[#333]'}`}>
              <label className="block text-[10px] text-gray-500 mb-2 uppercase courier">Gemini API Key</label>
              <div className="flex gap-2">
                <input type={showGemini ? "text" : "password"} value={config.geminiKey} onChange={e => setConfig({...config, geminiKey: e.target.value})}
                  className="flex-1 bg-[#0a0a0f] border border-[#333] p-2 rounded text-white text-sm" />
                <button onClick={() => setShowGemini(!showGemini)} className="px-2 text-xs">👁</button>
              </div>
            </div>

            {/* NVIDIA */}
            <div className={`p-4 border rounded ${config.provider === 'nvidia' ? 'border-[#ff8c00] bg-[#ff8c00]/5' : 'border-[#333]'}`}>
              <label className="block text-[10px] text-gray-500 mb-2 uppercase courier">NVIDIA NIM API Key</label>
              <div className="flex gap-2">
                <input type={showRouter ? "text" : "password"} value={config.nvidiaKey} onChange={e => setConfig({...config, nvidiaKey: e.target.value})}
                  className="flex-1 bg-[#0a0a0f] border border-[#333] p-2 rounded text-white text-sm" />
                <button onClick={() => setShowRouter(!showRouter)} className="px-2 text-xs">👁</button>
              </div>
            </div>

            {/* Router */}
            <div className={`p-4 border rounded ${config.provider === 'router' ? 'border-[#ff8c00] bg-[#ff8c00]/5' : 'border-[#333]'}`}>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase courier">Router Base URL</label>
              <input type="text" value={config.routerBase} onChange={e => setConfig({...config, routerBase: e.target.value})}
                className="w-full bg-[#0a0a0f] border border-[#333] p-2 rounded text-white mb-3 text-sm" placeholder="https://agentrouter.org/v1" />
              <label className="block text-[10px] text-gray-500 mb-1 uppercase courier">Router API Key</label>
              <div className="flex gap-2">
                <input type={showRouter ? "text" : "password"} value={config.routerKey} onChange={e => setConfig({...config, routerKey: e.target.value})}
                  className="flex-1 bg-[#0a0a0f] border border-[#333] p-2 rounded text-white text-sm" />
                <button onClick={() => setShowRouter(!showRouter)} className="px-2 text-xs">👁</button>
              </div>
            </div>
            
            <button onClick={saveGlobal} className="mt-2 bg-[#ff4500]/10 text-[#ff4500] border border-[#ff4500]/30 py-3 rounded hover:bg-[#ff4500] hover:text-white transition orbitron text-xs tracking-widest uppercase">
              {saved ? 'SUCCESSFULLY SAVED' : 'COMMIT GLOBAL CONFIG'}
            </button>
          </div>
        ) : (
          <div className="p-8 border border-[#333] rounded bg-black/40 text-center courier text-[10px] text-gray-500 uppercase">
            {'>'} SYSTEM: API_ACCESS_RESTRICTED<br/>
            {'>'} STATUS: MANAGED_BY_ADMINISTRATOR<br/>
            {'>'} CONTACT ADMIN FOR KEY UPDATES
          </div>
        )}
      </div>

        <div className="mt-6 pt-6 border-t border-[#333]">
          <h3 className="text-xs orbitron text-[#ff8c00] mb-4 uppercase tracking-widest">Security Credentials</h3>
          <div className="flex flex-col gap-4">
            {pwError && <div className="text-[#ff4500] text-xs courier">{'>'} {pwError}</div>}
            {pwSuccess && <div className="text-[#ff8c00] text-xs courier">{'>'} {pwSuccess}</div>}
            <input type="password" placeholder="Current Password" value={oldPassword} onChange={e => setOldPassword(e.target.value)}
              className="bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#ff8c00] text-white text-sm" />
            <input type="password" placeholder="New Password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              className="bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#ff8c00] text-white text-sm" />
            <input type="password" placeholder="Confirm New Password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              className="bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#ff8c00] text-white text-sm" />
            <button onClick={async () => {
              setPwError(''); setPwSuccess('');
              if (oldPassword !== currentUser.password) return setPwError("AUTH_VERIFICATION_FAILED");
              if (newPassword !== confirmPassword) return setPwError("MISMATCHED_INPUT");
              if (newPassword.length < 6) return setPwError("KEY_STRENGTH_INSUFFICIENT");
              
              const updatedUser = { ...currentUser, password: newPassword };
              await window.storage.set(`users:${currentUser.email}`, updatedUser);
              setCurrentUser(updatedUser);
              setPwSuccess("CREDENTIALS_RECODED_SUCCESSFULLY");
              setOldPassword(''); setNewPassword(''); setConfirmPassword('');
            }} className="bg-[#ff8c00] text-black font-bold py-3 rounded hover:bg-[#e67e00] transition orbitron text-xs tracking-widest">
              UPDATE ACCESS KEY
            </button>
        </div>
      </div>
    </div>
  );
};

const Sidebar = ({ page, setPage, currentUser, setCurrentUser, isOpen, setIsOpen }) => {
  const navItems = [
    { id: 'detect', label: 'AI Detection', icon: <Shield size={18} /> },
    { id: 'humanize', label: 'Humanizer', icon: <Wand2 size={18} /> },
    { id: 'advanced', label: 'Advanced', icon: <span className="text-[10px] font-black orbitron">PRO</span>, badge: true },
    { id: 'history', label: 'History', icon: <HistoryIcon size={18} /> },
  ];

  if (currentUser.role === 'admin') {
    navItems.push({ id: 'admin', label: 'Users', icon: <User size={18} /> });
  }
  
  navItems.push({ id: 'settings', label: 'Settings', icon: <Settings size={18} /> });

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsOpen(false)}
        ></div>
      )}

      <div className={`fixed md:static inset-y-0 left-0 w-64 bg-black/40 backdrop-blur-xl border-r border-[#ff8c00]/20 flex flex-col h-full z-50 transition-transform duration-300 transform ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-6 flex justify-between items-center">
          <div>
            <h1 className="text-xl orbitron text-[#ff8c00] font-bold">GOD MODE</h1>
            <div className="text-xs text-gray-500 mt-1">Detection & Humanizer</div>
          </div>
          <button className="md:hidden text-gray-400" onClick={() => setIsOpen(false)}>
            <LogOut size={20} className="rotate-180" />
          </button>
        </div>
        <div className="flex-1 px-4 flex flex-col gap-2 mt-4">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => { setPage(item.id); setIsOpen(false); }}
              className={`flex items-center gap-3 p-3 rounded transition-all ${
                page === item.id
                  ? item.badge
                    ? 'bg-[#ff4500]/10 text-[#ff4500] border border-[#ff4500]/30'
                    : 'bg-[#ff8c00]/10 text-[#ff8c00] border border-[#ff8c00]/30'
                  : 'text-gray-400 hover:bg-[#111] hover:text-white'
              }`}
            >
              <span className={item.badge && page !== item.id ? 'text-[#ff4500]' : ''}>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge && page !== item.id && (
                <span className="text-[8px] orbitron bg-[#ff4500]/20 text-[#ff4500] border border-[#ff4500]/30 px-1.5 py-0.5 rounded uppercase">New</span>
              )}
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-[#222]">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-8 h-8 rounded-full bg-[#111] flex items-center justify-center border border-[#333] text-xs">
              {currentUser.email.substring(0,2).toUpperCase()}
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm truncate text-white">{currentUser.email}</span>
              <span className={`text-xs ${currentUser.role==='admin' ? 'text-[#ff4500]' : 'text-gray-500'}`}>{currentUser.role.toUpperCase()}</span>
            </div>
          </div>
          <button onClick={() => setCurrentUser(null)} className="w-full flex items-center justify-center gap-2 p-2 rounded text-gray-400 hover:text-[#ff4500] hover:bg-[#111] transition">
            <LogOut size={18} /> Logout
          </button>
        </div>
      </div>
    </>
  );
};

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [page, setPage] = useState('login');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [config, setConfig] = useState({
    provider: 'gemini',
    model: 'gemini-1.5-flash',
    groqKey: '',
    geminiKey: '',
    nvidiaKey: '',
    routerKey: '',
    routerBase: 'https://agentrouter.org/v1'
  });
  const [loadingInit, setLoadingInit] = useState(true);
  const [transferText, setTransferText] = useState('');

  useEffect(() => {
    // Load PDF.js via script tag as requested
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    };
    document.head.appendChild(script);

    const init = async () => {
      const saved = await window.storage.get('config:all');
      if (saved) setConfig(saved.value);
      setLoadingInit(false);
    };
    init();
  }, []);

  // Auto-save config changes
  useEffect(() => {
    if (!loadingInit) {
      const save = async () => {
        await window.storage.set('config:all', config);
      };
      save();
    }
  }, [config, loadingInit]);

  const handleHumanizeRequest = (text) => {
    setTransferText(text);
    setPage('humanize');
  };

  const handleDetectRequest = (text) => {
    setTransferText(text);
    setPage('detect');
  };

  if (loadingInit) return <div className="h-screen flex items-center justify-center bg-[#0a0a0f] text-[#ff8c00] orbitron">Initializing Secure Environment...</div>;

  if (!currentUser && (page !== 'login' && page !== 'signup')) {
    setPage('login');
  }

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-black text-[#ff8c00] courier select-none md:select-auto">
      {currentUser && <Sidebar page={page} setPage={setPage} currentUser={currentUser} setCurrentUser={setCurrentUser} isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} />}
      
      <main className="flex-1 overflow-y-auto relative flex flex-col z-10 w-full">
        {currentUser && (
          <div className="md:hidden sticky top-0 flex items-center justify-between h-16 px-4 bg-black/90 border-b border-[#ff8c00]/20 z-50 backdrop-blur-xl">
            <h1 className="text-lg orbitron text-[#ff8c00] font-bold tracking-tighter">GOD MODE</h1>
            <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-[#ff8c00] active:scale-90 transition-transform">
              <div className="w-6 h-0.5 bg-current mb-1 shadow-[0_0_8px_#ff8c00]"></div>
              <div className="w-6 h-0.5 bg-current mb-1 shadow-[0_0_8px_#ff8c00]"></div>
              <div className="w-6 h-0.5 bg-current shadow-[0_0_8px_#ff8c00]"></div>
            </button>
          </div>
        )}

        <div className="p-4 md:p-6 flex-1 w-full max-w-full overflow-x-hidden">
          {(!config.groqKey && !config.geminiKey && !config.routerKey) && currentUser && page !== 'settings' && (
            <div className="bg-[#ff4500]/10 border border-[#ff4500]/30 text-[#ff4500] p-4 rounded mb-6 flex justify-between items-center courier text-xs animate-pulse">
              <span>{'>'} WARNING: NO_API_KEYS_DETECTED</span>
              <button onClick={() => setPage('settings')} className="bg-[#ff4500] text-white px-4 py-1 rounded text-[10px] hover:bg-red-600 transition">RESOLVE</button>
            </div>
          )}
          
          <div className="animate-fade-in h-full">
            {page === 'login' && <AuthPage setPage={setPage} setCurrentUser={setCurrentUser} isLogin={true} />}
            {page === 'signup' && <AuthPage setPage={setPage} setCurrentUser={setCurrentUser} isLogin={false} />}
            {page === 'detect' && <DetectPage currentUser={currentUser} config={config} onHumanizeRequest={handleHumanizeRequest} initialText={page==='detect' ? transferText : ''} />}
            {page === 'humanize' && <HumanizePage currentUser={currentUser} config={config} initialText={page==='humanize' ? transferText : ''} onDetectRequest={handleDetectRequest} />}
            {page === 'history' && <HistoryPage currentUser={currentUser} />}
            {page === 'advanced' && <AdvancedPage currentUser={currentUser} config={config} />}
            {page === 'admin' && currentUser?.role === 'admin' && <AdminPage />}
            {page === 'settings' && <SettingsPage config={config} setConfig={setConfig} isAdmin={currentUser?.role === 'admin'} currentUser={currentUser} setCurrentUser={setCurrentUser} />}
          </div>
        </div>
      </main>
    </div>
  );
}
