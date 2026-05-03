import React, { useState, useEffect } from 'react';
import mammoth from 'mammoth';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Shield, User, History as HistoryIcon, Settings, Wand2, Upload, LogOut, Copy, Check } from 'lucide-react';

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
  const color = percentage > 70 ? '#ff3366' : percentage > 40 ? '#ffaa00' : '#00ff88';

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
      if (isLogin) {
        const userObj = await window.storage.get(`users:${email}`);
        if (!userObj) throw new Error("ID_NOT_FOUND");
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
            <h2 className="text-3xl orbitron font-bold text-[#00ff88] tracking-widest uppercase">
              {isLogin ? 'SIGN IN' : 'SIGN UP'}
            </h2>
          </div>

          <div className="flex flex-col gap-6">
            {error && <div className="text-[#ff3366] text-xs courier bg-red-900/10 p-3 border border-red-500/20 rounded">
              {'>'} ERROR: {error}
            </div>}
            
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 courier ml-1 uppercase tracking-widest">Username</label>
              <input 
                type="email" 
                value={email} 
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-[#2a2a2a] border-none p-4 rounded text-white focus:outline-none focus:ring-2 focus:ring-[#00ff88]/50 transition-all"
                placeholder="root@mainframe"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 courier ml-1 uppercase tracking-widest">Password</label>
              <input 
                type="password" 
                value={password} 
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-[#2a2a2a] border-none p-4 rounded text-white focus:outline-none focus:ring-2 focus:ring-[#00ff88]/50 transition-all"
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
                  className="w-full bg-[#2a2a2a] border-none p-4 rounded text-white focus:outline-none focus:ring-2 focus:ring-[#00ff88]/50 transition-all"
                  placeholder="Leave empty for basic user"
                />
              </div>
            )}

            <div className="flex justify-between items-center text-[10px] courier text-gray-500 uppercase tracking-widest px-1">
              <span className="hover:text-white cursor-pointer transition">Forgot Password</span>
              <span className="text-[#00ff88] hover:underline cursor-pointer transition" onClick={() => setPage(isLogin ? 'signup' : 'login')}>
                {isLogin ? 'Signup' : 'Login'}
              </span>
            </div>

            <button 
              onClick={handleSubmit} 
              disabled={loading}
              className="w-full bg-[#00ff00] text-black font-bold py-4 rounded orbitron hover:bg-[#00ff88] shadow-[0_0_20px_rgba(0,255,0,0.3)] hover:shadow-[0_0_30px_rgba(0,255,136,0.5)] transition-all active:scale-95 uppercase tracking-widest"
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
      <h2 className="text-xl md:text-2xl orbitron text-[#00ff88]">AI Content Detection</h2>
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
          className="w-full flex-1 bg-[#111] border border-[#333] rounded p-4 focus:outline-none focus:border-[#00ff88] resize-none text-white min-h-0"
        ></textarea>
        {error && <div className="text-[#ff3366] text-sm">{error}</div>}
        <button onClick={handleScan} disabled={loading} className="bg-[#00ff88] text-black font-bold py-3 rounded hover:bg-[#00cc6a] transition disabled:opacity-50 shrink-0">
          {loading ? <span className="typewriter">🔍 Analyzing patterns...</span> : 'Analyze Content'}
        </button>
      </div>

      {result && (
        <div className="animated-border p-[1px] mt-2 flex-1 min-h-0">
          <div className="glass p-4 md:p-6 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-6 h-full overflow-y-auto">
            <div className="col-span-1 flex flex-col items-center justify-center gap-4 md:border-r border-[#333] md:pr-6">
              <CircularGauge percentage={result.ai_percentage} />
              <div className={`px-4 py-1 rounded text-sm font-bold ${result.ai_percentage > 70 ? 'bg-[#ff3366]/20 text-[#ff3366]' : result.ai_percentage > 40 ? 'bg-yellow-500/20 text-yellow-500' : 'bg-[#00ff88]/20 text-[#00ff88]'}`}>
                {result.verdict}
              </div>
              <div className="text-sm text-gray-400">Confidence: <span className="text-white">{result.confidence}</span></div>
              {onHumanizeRequest && (
                <button onClick={() => onHumanizeRequest(text)} className="mt-2 flex items-center gap-2 border border-[#00ff88] text-[#00ff88] px-4 py-2 rounded hover:bg-[#00ff88]/10 transition text-sm">
                  <Wand2 size={16} /> Humanize Text
                </button>
              )}
            </div>
            <div className="col-span-2 flex flex-col gap-4 min-h-0 overflow-y-auto">
              <div>
                <h3 className="orbitron text-base mb-1 text-gray-300">Suspicious Patterns</h3>
                <ul className="list-disc pl-5 text-sm text-[#ff3366]">
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
                      <span className={`${s.ai_probability > 70 ? 'text-[#ff3366]' : 'text-[#00ff88]'}`}>{s.ai_probability}% AI</span>
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
        <h2 className="text-xl md:text-2xl orbitron text-[#00ff88]">Text Humanizer</h2>
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
            className="flex-1 bg-[#111] border border-[#333] rounded p-4 focus:outline-none focus:border-[#00ff88] resize-none text-white text-sm min-h-0 courier"
          ></textarea>
          <button onClick={handleHumanize} disabled={loading} className="bg-[#00ff88] text-black font-bold py-3 rounded hover:bg-[#00cc6a] transition disabled:opacity-50 mt-1 shrink-0 orbitron uppercase text-xs tracking-wider">
            {loading ? <span className="typewriter">✨ RECODING TEXT...</span> : 'HUMANIZE'}
          </button>
          {error && <div className="text-[#ff3366] text-[10px] mt-1 courier uppercase">{'>'} ERROR: {error}</div>}
        </div>

        <div className="animated-border p-[1px] flex flex-col min-h-0">
          <div className="glass p-4 rounded-lg flex flex-col gap-2 h-full min-h-0">
            <div className="flex justify-between items-center mb-1">
              <span className="orbitron text-xs text-[#00ff88] uppercase tracking-widest">Humanized Output</span>
              {result && <span className="text-[10px] text-gray-500 courier">Words: {getWordCount(result)}</span>}
            </div>
            <div className="flex-1 bg-[#0a0a0f] border border-[#222] rounded p-4 overflow-y-auto whitespace-pre-wrap text-gray-200 text-sm min-h-0 courier">
              {result ? result : <span className="text-gray-700 italic">SYSTEM READY... AWAITING INPUT...</span>}
            </div>
            {result && (
              <div className="flex gap-2 mt-1 shrink-0">
                <button onClick={copyToClipboard} className="flex-1 flex items-center justify-center gap-2 border border-[#333] hover:border-[#00ff88] text-gray-300 py-2 rounded transition text-[10px] uppercase orbitron tracking-wider">
                  {copied ? <><Check size={14} /> COPIED!</> : <><Copy size={14} /> COPY</>}
                </button>
                {onDetectRequest && (
                  <button onClick={() => onDetectRequest(result)} className="flex-1 flex items-center justify-center gap-2 border border-[#00ff88] text-[#00ff88] py-2 rounded hover:bg-[#00ff88]/10 transition text-[10px] uppercase orbitron tracking-wider">
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
      <h2 className="text-xl md:text-2xl orbitron text-[#00ff88]">Scan History</h2>
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
                <td className="p-4"><span className={`px-2 py-1 rounded text-xs ${h.type==='detection' ? 'bg-[#00ff88]/10 text-[#00ff88]' : 'bg-[#ff3366]/10 text-[#ff3366]'}`}>{h.type}</span></td>
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
        <h2 className="text-xl md:text-2xl orbitron text-[#00ff88]">System Registry</h2>
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
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase courier ${u.role==='admin' ? 'bg-[#ff3366]/20 text-[#ff3366]' : 'bg-gray-800 text-gray-400'}`}>{u.role}</span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase courier ${u.status==='approved' ? 'bg-[#00ff88]/20 text-[#00ff88]' : u.status==='blocked' ? 'bg-red-900/40 text-red-500' : 'bg-yellow-500/20 text-yellow-500'}`}>{u.status}</span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase courier ${u.access==='full' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-700 text-gray-500'}`}>{u.access || 'limited'}</span>
                  </td>
                  <td className="p-4 text-gray-400 courier">{u.wordsScanned || 0} w</td>
                  <td className="p-4 text-right flex justify-end gap-1">
                    {u.status === 'pending' && (
                      <button onClick={()=>approveUser(u.email)} className="bg-[#00ff88]/20 text-[#00ff88] hover:bg-[#00ff88] hover:text-black text-[9px] px-2 py-1 rounded uppercase orbitron">Link</button>
                    )}
                    <button onClick={()=>toggleBlock(u.email, u.status)} className={`text-[9px] px-2 py-1 rounded border border-[#333] uppercase orbitron ${u.status==='blocked' ? 'bg-red-600 text-white border-none' : 'hover:bg-[#333]'}`}>{u.status === 'blocked' ? 'Unlock' : 'Lock'}</button>
                    <button onClick={()=>toggleAccess(u.email, u.access)} className="border border-[#444] text-[9px] px-2 py-1 rounded hover:border-blue-400 uppercase orbitron">Tier</button>
                    <button onClick={()=>toggleRole(u.email, u.role)} className="border border-[#444] text-[9px] px-2 py-1 rounded hover:border-[#00ff88] uppercase orbitron">Priv</button>
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
                    <span className={`text-[8px] px-1.5 py-0.5 rounded uppercase courier ${u.role==='admin' ? 'bg-[#ff3366]/20 text-[#ff3366]' : 'bg-gray-800 text-gray-400'}`}>{u.role}</span>
                    <span className={`text-[8px] px-1.5 py-0.5 rounded uppercase courier ${u.access==='full' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-700 text-gray-400'}`}>{u.access || 'limited'}</span>
                  </div>
                </div>
                <span className={`text-[8px] px-1.5 py-0.5 rounded uppercase courier ${u.status==='approved' ? 'bg-[#00ff88]/20 text-[#00ff88]' : u.status==='blocked' ? 'bg-red-900 text-white' : 'bg-yellow-500/20 text-yellow-500'}`}>{u.status}</span>
              </div>
              <div className="text-[10px] text-gray-500 courier tracking-tight">DATA_USAGE: {u.wordsScanned || 0} WORDS</div>
              <div className="flex gap-2 pt-2 border-t border-[#222]">
                {u.status === 'pending' && (
                  <button onClick={()=>approveUser(u.email)} className="flex-1 bg-[#00ff88]/20 text-[#00ff88] py-2 rounded text-[9px] uppercase font-bold orbitron">Link</button>
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
      <h2 className="text-xl md:text-2xl orbitron text-[#00ff88]">System Settings</h2>
      
      <div className="glass p-4 md:p-6 rounded-lg flex flex-col gap-4 border border-[#333]">
        <h3 className="orbitron text-xs text-[#00ff88] border-b border-[#333] pb-2 uppercase tracking-widest">AI Core Configuration</h3>
        <select 
          value={config.provider} 
          onChange={e => setConfig({...config, provider: e.target.value})}
          className="w-full bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#00ff88] text-white text-sm"
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
            className="w-full bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#00ff88] text-white text-sm"
            placeholder="e.g. gemini-1.5-flash"
          />
        </div>

        {isAdmin ? (
          <div className="mt-2 flex flex-col gap-4">
            {/* Groq */}
            <div className={`p-4 border rounded ${config.provider === 'groq' ? 'border-[#00ff88] bg-[#00ff88]/5' : 'border-[#333]'}`}>
              <label className="block text-[10px] text-gray-500 mb-2 uppercase courier">Groq API Key</label>
              <div className="flex gap-2">
                <input type={showGroq ? "text" : "password"} value={config.groqKey} onChange={e => setConfig({...config, groqKey: e.target.value})}
                  className="flex-1 bg-[#0a0a0f] border border-[#333] p-2 rounded text-white text-sm" />
                <button onClick={() => setShowGroq(!showGroq)} className="px-2 text-xs">👁</button>
              </div>
            </div>

            {/* Gemini */}
            <div className={`p-4 border rounded ${config.provider === 'gemini' ? 'border-[#00ff88] bg-[#00ff88]/5' : 'border-[#333]'}`}>
              <label className="block text-[10px] text-gray-500 mb-2 uppercase courier">Gemini API Key</label>
              <div className="flex gap-2">
                <input type={showGemini ? "text" : "password"} value={config.geminiKey} onChange={e => setConfig({...config, geminiKey: e.target.value})}
                  className="flex-1 bg-[#0a0a0f] border border-[#333] p-2 rounded text-white text-sm" />
                <button onClick={() => setShowGemini(!showGemini)} className="px-2 text-xs">👁</button>
              </div>
            </div>

            {/* NVIDIA */}
            <div className={`p-4 border rounded ${config.provider === 'nvidia' ? 'border-[#00ff88] bg-[#00ff88]/5' : 'border-[#333]'}`}>
              <label className="block text-[10px] text-gray-500 mb-2 uppercase courier">NVIDIA NIM API Key</label>
              <div className="flex gap-2">
                <input type={showRouter ? "text" : "password"} value={config.nvidiaKey} onChange={e => setConfig({...config, nvidiaKey: e.target.value})}
                  className="flex-1 bg-[#0a0a0f] border border-[#333] p-2 rounded text-white text-sm" />
                <button onClick={() => setShowRouter(!showRouter)} className="px-2 text-xs">👁</button>
              </div>
            </div>

            {/* Router */}
            <div className={`p-4 border rounded ${config.provider === 'router' ? 'border-[#00ff88] bg-[#00ff88]/5' : 'border-[#333]'}`}>
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
            
            <button onClick={saveGlobal} className="mt-2 bg-[#ff3366]/10 text-[#ff3366] border border-[#ff3366]/30 py-3 rounded hover:bg-[#ff3366] hover:text-white transition orbitron text-xs tracking-widest uppercase">
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
          <h3 className="text-xs orbitron text-[#00ff88] mb-4 uppercase tracking-widest">Security Credentials</h3>
          <div className="flex flex-col gap-4">
            {pwError && <div className="text-[#ff3366] text-xs courier">{'>'} {pwError}</div>}
            {pwSuccess && <div className="text-[#00ff88] text-xs courier">{'>'} {pwSuccess}</div>}
            <input type="password" placeholder="Current Password" value={oldPassword} onChange={e => setOldPassword(e.target.value)}
              className="bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#00ff88] text-white text-sm" />
            <input type="password" placeholder="New Password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              className="bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#00ff88] text-white text-sm" />
            <input type="password" placeholder="Confirm New Password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              className="bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#00ff88] text-white text-sm" />
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
            }} className="bg-[#00ff88] text-black font-bold py-3 rounded hover:bg-[#00cc6a] transition orbitron text-xs tracking-widest">
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

      <div className={`fixed md:static inset-y-0 left-0 w-64 bg-black/40 backdrop-blur-xl border-r border-[#00ff88]/20 flex flex-col h-full z-50 transition-transform duration-300 transform ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-6 flex justify-between items-center">
          <div>
            <h1 className="text-xl orbitron text-[#00ff88] font-bold">GOD MODE</h1>
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
              className={`flex items-center gap-3 p-3 rounded transition-all ${page === item.id ? 'bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30' : 'text-gray-400 hover:bg-[#111] hover:text-white'}`}
            >
              {item.icon} {item.label}
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
              <span className={`text-xs ${currentUser.role==='admin' ? 'text-[#ff3366]' : 'text-gray-500'}`}>{currentUser.role.toUpperCase()}</span>
            </div>
          </div>
          <button onClick={() => setCurrentUser(null)} className="w-full flex items-center justify-center gap-2 p-2 rounded text-gray-400 hover:text-[#ff3366] hover:bg-[#111] transition">
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

  if (loadingInit) return <div className="h-screen flex items-center justify-center bg-[#0a0a0f] text-[#00ff88] orbitron">Initializing Secure Environment...</div>;

  if (!currentUser && (page !== 'login' && page !== 'signup')) {
    setPage('login');
  }

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-black text-[#00ff88] courier select-none md:select-auto">
      {currentUser && <Sidebar page={page} setPage={setPage} currentUser={currentUser} setCurrentUser={setCurrentUser} isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} />}
      
      <main className="flex-1 overflow-y-auto relative flex flex-col z-10 w-full">
        {currentUser && (
          <div className="md:hidden sticky top-0 flex items-center justify-between h-16 px-4 bg-black/90 border-b border-[#00ff88]/20 z-50 backdrop-blur-xl">
            <h1 className="text-lg orbitron text-[#00ff88] font-bold tracking-tighter">GOD MODE</h1>
            <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-[#00ff88] active:scale-90 transition-transform">
              <div className="w-6 h-0.5 bg-current mb-1 shadow-[0_0_8px_#00ff88]"></div>
              <div className="w-6 h-0.5 bg-current mb-1 shadow-[0_0_8px_#00ff88]"></div>
              <div className="w-6 h-0.5 bg-current shadow-[0_0_8px_#00ff88]"></div>
            </button>
          </div>
        )}

        <div className="p-4 md:p-6 flex-1 w-full max-w-full overflow-x-hidden">
          {(!config.groqKey && !config.geminiKey && !config.routerKey) && currentUser && page !== 'settings' && (
            <div className="bg-[#ff3366]/10 border border-[#ff3366]/30 text-[#ff3366] p-4 rounded mb-6 flex justify-between items-center courier text-xs animate-pulse">
              <span>{'>'} WARNING: NO_API_KEYS_DETECTED</span>
              <button onClick={() => setPage('settings')} className="bg-[#ff3366] text-white px-4 py-1 rounded text-[10px] hover:bg-red-600 transition">RESOLVE</button>
            </div>
          )}
          
          <div className="animate-fade-in h-full">
            {page === 'login' && <AuthPage setPage={setPage} setCurrentUser={setCurrentUser} isLogin={true} />}
            {page === 'signup' && <AuthPage setPage={setPage} setCurrentUser={setCurrentUser} isLogin={false} />}
            {page === 'detect' && <DetectPage currentUser={currentUser} config={config} onHumanizeRequest={handleHumanizeRequest} initialText={page==='detect' ? transferText : ''} />}
            {page === 'humanize' && <HumanizePage currentUser={currentUser} config={config} initialText={page==='humanize' ? transferText : ''} onDetectRequest={handleDetectRequest} />}
            {page === 'history' && <HistoryPage currentUser={currentUser} />}
            {page === 'admin' && currentUser?.role === 'admin' && <AdminPage />}
            {page === 'settings' && <SettingsPage config={config} setConfig={setConfig} isAdmin={currentUser?.role === 'admin'} currentUser={currentUser} setCurrentUser={setCurrentUser} />}
          </div>
        </div>
      </main>
    </div>
  );
}
