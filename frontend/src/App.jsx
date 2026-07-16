import { useEffect, useMemo, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'

function App() {
  const [token, setToken] = useState(localStorage.getItem('health_token') || '')
  const [user, setUser] = useState(null)
  const [activeView, setActiveView] = useState('consultation')
  const [notice, setNotice] = useState('')
  const [loginForm, setLoginForm] = useState({ username: 'zhangsan', password: '123456' })
  const [profile, setProfile] = useState(null)
  const [metrics, setMetrics] = useState([])
  const [sessions, setSessions] = useState([])
  const [currentSession, setCurrentSession] = useState(null)
  const [messages, setMessages] = useState([])
  const [chatText, setChatText] = useState('小腿起红疹两天，很痒，晚上更明显。')
  const [sessionTitle, setSessionTitle] = useState('皮肤红疹瘙痒咨询')
  const [selectedImage, setSelectedImage] = useState(null)
  const [selectedAudio, setSelectedAudio] = useState(null)
  const [imageResult, setImageResult] = useState(null)
  const [speechResult, setSpeechResult] = useState(null)
  const [riskResult, setRiskResult] = useState(null)
  const [adminData, setAdminData] = useState({ highRisk: [], logs: [] })
  const [aiStatus, setAiStatus] = useState(null)

  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${token}`
  }), [token])

  async function api(path, options = {}) {
    const headers = options.body instanceof FormData
      ? { ...(token ? authHeaders : {}) }
      : { 'Content-Type': 'application/json', ...(token ? authHeaders : {}) }
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } })
    const payload = await response.json()
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.message || '请求失败')
    }
    return payload.data
  }

  async function handleLogin(event) {
    event.preventDefault()
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginForm)
      })
      localStorage.setItem('health_token', data.accessToken)
      setToken(data.accessToken)
      setUser(data.user)
      setNotice('登录成功')
    } catch (error) {
      setNotice(error.message)
    }
  }

  async function loadMe() {
    if (!token) return
    try {
      const data = await api('/auth/me')
      setUser(data)
    } catch {
      localStorage.removeItem('health_token')
      setToken('')
    }
  }

  async function loadProfile() {
    const [profileData, metricData, statusData] = await Promise.all([
      api('/health-profile/me'),
      api('/health-profile/me/metrics?page=1&pageSize=10'),
      api('/ai/status')
    ])
    setProfile(profileData)
    setMetrics(metricData.items || [])
    setAiStatus(statusData)
  }

  async function saveProfile(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = Object.fromEntries(form.entries())
    body.heightCm = Number(body.heightCm || 0)
    body.weightKg = Number(body.weightKg || 0)
    const data = await api('/health-profile/me', { method: 'PUT', body: JSON.stringify(body) })
    setProfile(data)
    setNotice('健康档案已保存')
  }

  async function loadSessions() {
    const data = await api('/consultations?page=1&pageSize=20')
    setSessions(data.items || [])
  }

  async function createSession() {
    const data = await api('/consultations', {
      method: 'POST',
      body: JSON.stringify({
        title: sessionTitle,
        channel: 'multimodal',
        initialMessage: chatText
      })
    })
    setCurrentSession({ id: data.id, title: sessionTitle })
    setMessages([{ senderType: 'user', content: chatText, inputType: 'text' }])
    await loadSessions()
    setNotice('问诊会话已创建')
  }

  async function openSession(id) {
    const data = await api(`/consultations/${id}`)
    setCurrentSession(data)
    setMessages(data.messages || [])
    setImageResult(null)
    setSpeechResult(null)
  }

  async function sendText() {
    if (!currentSession?.id) {
      await createSession()
      return
    }
    const data = await api(`/consultations/${currentSession.id}/messages/text`, {
      method: 'POST',
      body: JSON.stringify({ content: chatText, context: { source: 'web' } })
    })
    setMessages((items) => [
      ...items,
      { senderType: 'user', content: chatText, inputType: 'text' },
      { senderType: 'assistant', content: data.reply, inputType: 'text', ai: data.ai }
    ])
    setRiskResult(data.risk)
    await loadSessions()
  }

  async function uploadFile(type) {
    if (!currentSession?.id) {
      setNotice('请先创建或打开一个问诊会话')
      return
    }
    const file = type === 'image' ? selectedImage : selectedAudio
    if (!file) {
      setNotice(type === 'image' ? '请选择图片文件' : '请选择音频文件')
      return
    }
    const body = new FormData()
    body.append('file', file)
    if (type === 'image') body.append('description', '问诊图片')
    if (type === 'voice') body.append('language', 'zh-CN')
    const data = await api(`/consultations/${currentSession.id}/messages/${type}`, { method: 'POST', body })
    if (type === 'image') {
      setImageResult(data.analysis || await api(`/files/${data.fileId}/image-analysis`))
    } else {
      setSpeechResult(await api(`/files/${data.fileId}/speech-result`))
    }
    setNotice('文件已上传并分析')
  }

  async function runSafetyCheck() {
    const data = await api('/ai/safety-check', {
      method: 'POST',
      body: JSON.stringify({ scene: 'medical_consultation', content: chatText })
    })
    setRiskResult(data)
  }

  async function loadAdmin() {
    const [highRisk, logs] = await Promise.all([
      api('/admin/consultations/high-risk?page=1&pageSize=10'),
      api('/admin/model-call-logs?page=1&pageSize=10')
    ])
    setAdminData({ highRisk: highRisk.items || [], logs: logs.items || [] })
  }

  useEffect(() => {
    loadMe()
  }, [token])

  useEffect(() => {
    if (!token) return
    loadProfile().catch((error) => setNotice(error.message))
    loadSessions().catch((error) => setNotice(error.message))
  }, [token])

  if (!token) {
    return (
      <main className="login-screen">
        <section className="login-panel">
          <div>
            <p className="eyebrow">XuenWu Health</p>
            <h1>多模态健康问诊系统</h1>
            <p className="muted">登录后可测试健康档案、文本问诊、图片分析、语音识别、风险提示和管理端数据。</p>
          </div>
          <form onSubmit={handleLogin} className="stack">
            <label>
              用户名
              <input value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} />
            </label>
            <label>
              密码
              <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
            </label>
            <button type="submit">登录</button>
            <p className="hint">演示账号：zhangsan / 123456，admin / 123456</p>
            {notice && <p className="notice">{notice}</p>}
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">XuenWu Health</p>
          <h1>问诊工作台</h1>
          <p className="muted">{user?.displayName || user?.username} · {user?.roleName || '用户'}</p>
        </div>
        <nav>
          {[
            ['consultation', '智能问诊'],
            ['profile', '健康档案'],
            ['history', '问诊历史'],
            ['admin', '管理视图']
          ].map(([id, label]) => (
            <button key={id} className={activeView === id ? 'active' : ''} onClick={() => {
              setActiveView(id)
              if (id === 'admin') loadAdmin().catch((error) => setNotice(error.message))
            }}>{label}</button>
          ))}
        </nav>
        <button className="secondary" onClick={() => {
          localStorage.removeItem('health_token')
          setToken('')
          setUser(null)
        }}>退出登录</button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <strong>API</strong>
            <span>{API_BASE}</span>
          </div>
          <div className={aiStatus?.realAiEnabled ? 'status-pill ok' : 'status-pill warn'}>
            <strong>AI</strong>
            <span>{aiStatus?.realAiEnabled ? `${aiStatus.provider} · ${aiStatus.model}` : '本地规则占位'}</span>
          </div>
          {notice && <p className="notice">{notice}</p>}
        </header>

        {activeView === 'consultation' && (
          <section className="grid two">
            <div className="panel">
              <h2>多模态问诊</h2>
              <label>
                会话标题
                <input value={sessionTitle} onChange={(e) => setSessionTitle(e.target.value)} />
              </label>
              <label>
                症状描述
                <textarea rows="5" value={chatText} onChange={(e) => setChatText(e.target.value)} />
              </label>
              <div className="actions">
                <button onClick={createSession}>新建会话</button>
                <button onClick={sendText}>发送问诊</button>
                <button className="secondary" onClick={runSafetyCheck}>风险检查</button>
              </div>
              <div className="upload-row">
                <label>
                  图片
                  <input type="file" accept="image/*" onChange={(e) => setSelectedImage(e.target.files?.[0])} />
                </label>
                <button className="secondary" onClick={() => uploadFile('image')}>上传图片</button>
              </div>
              <div className="upload-row">
                <label>
                  语音
                  <input type="file" accept="audio/*" onChange={(e) => setSelectedAudio(e.target.files?.[0])} />
                </label>
                <button className="secondary" onClick={() => uploadFile('voice')}>上传语音</button>
              </div>
            </div>

            <div className="panel">
              <h2>会话结果</h2>
              <div className="chat-box">
                {messages.length === 0 && <p className="muted">还没有消息，先新建会话或发送问诊。</p>}
                {messages.map((message, index) => (
                  <article key={index} className={`bubble ${message.senderType}`}>
                    <span>{message.senderType}</span>
                    <p>{message.content}</p>
                    {message.ai && <small>{message.ai.provider}{message.ai.model ? ` · ${message.ai.model}` : ''}</small>}
                  </article>
                ))}
              </div>
              {riskResult && <Result title="风险提示" data={riskResult} />}
              {imageResult && <Result title="图像分析" data={imageResult} />}
              {speechResult && <Result title="语音识别" data={speechResult} />}
            </div>
          </section>
        )}

        {activeView === 'profile' && (
          <section className="grid two">
            <form className="panel form-grid" onSubmit={saveProfile}>
              <h2>健康档案</h2>
              <label>性别<input name="gender" defaultValue={profile?.gender || 'unknown'} /></label>
              <label>出生日期<input name="birthDate" type="date" defaultValue={dateOnly(profile?.birthDate)} /></label>
              <label>身高 cm<input name="heightCm" defaultValue={profile?.heightCm || ''} /></label>
              <label>体重 kg<input name="weightKg" defaultValue={profile?.weightKg || ''} /></label>
              <label>血型<input name="bloodType" defaultValue={profile?.bloodType || ''} /></label>
              <label>过敏史<textarea name="allergyHistory" defaultValue={profile?.allergyHistory || ''} /></label>
              <label>既往病史<textarea name="diseaseHistory" defaultValue={profile?.diseaseHistory || ''} /></label>
              <label>当前用药<textarea name="currentMedications" defaultValue={profile?.currentMedications || ''} /></label>
              <button type="submit">保存档案</button>
            </form>
            <div className="panel">
              <h2>健康指标</h2>
              <DataTable rows={metrics} columns={['metricType', 'valueText', 'unit', 'measuredAt', 'note']} />
            </div>
          </section>
        )}

        {activeView === 'history' && (
          <section className="panel">
            <div className="section-head">
              <h2>问诊历史</h2>
              <button className="secondary" onClick={loadSessions}>刷新</button>
            </div>
            <DataTable rows={sessions} columns={['id', 'title', 'channel', 'riskLevel', 'recommendedDepartment', 'status']} onRowClick={(row) => {
              openSession(row.id)
              setActiveView('consultation')
            }} />
          </section>
        )}

        {activeView === 'admin' && (
          <section className="grid two">
            <div className="panel">
              <h2>高风险会话</h2>
              <DataTable rows={adminData.highRisk} columns={['id', 'displayName', 'title', 'riskLevel', 'recommendedDepartment', 'status']} />
            </div>
            <div className="panel">
              <h2>模型调用日志</h2>
              <DataTable rows={adminData.logs} columns={['id', 'provider', 'modelName', 'capability', 'latencyMs', 'success']} />
            </div>
          </section>
        )}
      </section>
    </main>
  )
}

function Result({ title, data }) {
  return (
    <div className="result">
      <strong>{title}</strong>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  )
}

function DataTable({ rows, columns, onRowClick }) {
  if (!rows?.length) return <p className="muted">暂无数据</p>
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id || index} onClick={() => onRowClick?.(row)}>
              {columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatCell(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function dateOnly(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

export default App
