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
  const [selectedAudio, setSelectedAudio] = useState(null)
  const [speechResult, setSpeechResult] = useState(null)
  const [riskResult, setRiskResult] = useState(null)
  const [consultationAnalysis, setConsultationAnalysis] = useState(null)
  const [adminData, setAdminData] = useState({ highRisk: [], logs: [] })
  const [aiStatus, setAiStatus] = useState(null)
  const [careMode, setCareMode] = useState(localStorage.getItem('health_care_mode') || 'standard')
  const [outputLanguage, setOutputLanguage] = useState('zh-CN')
  const [guidedInput, setGuidedInput] = useState({
    bodyPart: '下肢',
    symptom: '疼痛',
    duration: '2天',
    severity: '中度，影响部分日常活动',
    accompanying: '无明显伴随症状'
  })
  const [guidedApplied, setGuidedApplied] = useState(false)

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
        channel: 'multimodal'
      })
    })
    setCurrentSession({ id: data.id, title: sessionTitle })
    setMessages([])
    setConsultationAnalysis(null)
    await loadSessions()
    setNotice('问诊会话已创建')
    return data.id
  }

  async function openSession(id) {
    const data = await api(`/consultations/${id}`)
    setCurrentSession(data)
    setMessages(data.messages || [])
    setConsultationAnalysis(data.analysis || null)
    setRiskResult(data.analysis?.risk || null)
    setImageResult(null)
    setSpeechResult(null)
  }

  async function sendText() {
    let sessionId = currentSession?.id
    if (!currentSession?.id) {
      sessionId = await createSession()
    }
    const data = await api(`/consultations/${sessionId}/messages/text`, {
      method: 'POST',
      body: JSON.stringify({
        content: chatText,
        context: { source: 'web', careMode, outputLanguage, guided: guidedApplied }
      })
    })
    setMessages((items) => [
      ...items,
      { senderType: 'user', content: chatText, inputType: 'text' },
      { senderType: 'assistant', content: data.reply, inputType: 'text', ai: data.ai }
    ])
    setRiskResult(data.risk)
    setConsultationAnalysis(data.analysis)
    setGuidedApplied(false)
    setNotice('结构化问诊分析已完成')
    await loadSessions()
  }

  function applyGuidedAssessment() {
    const modeText = careMode === 'child' ? '儿童患者' : careMode === 'elder' ? '老年患者' : '本人'
    const text = `${modeText}${guidedInput.bodyPart}出现${guidedInput.symptom}，持续${guidedInput.duration}，程度为${guidedInput.severity}，${guidedInput.accompanying}。`
    setChatText(text)
    setGuidedApplied(true)
    setNotice('症状自查信息已整理，可继续补充后发送问诊')
  }

  function changeCareMode(mode) {
    setCareMode(mode)
    localStorage.setItem('health_care_mode', mode)
  }

  async function uploadVoice() {
    if (!currentSession?.id) {
      setNotice('请先创建或打开一个问诊会话')
      return
    }
    if (!selectedAudio) return setNotice('请选择音频文件')
    const body = new FormData()
    body.append('file', selectedAudio)
    body.append('language', 'zh-CN')
    const data = await api(`/consultations/${currentSession.id}/messages/voice`, { method: 'POST', body })
    setSpeechResult(await api(`/files/${data.fileId}/speech-result`))
    setNotice('语音文件已上传并处理')
  }

  function showImageComingSoon() {
    setNotice('图片问诊功能正在开发中')
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
            <p className="muted">登录后可测试健康档案、文本问诊、语音识别、风险提示和管理端数据。</p>
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
    <main className={`app-shell care-${careMode}`}>
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
            <span>
              {aiStatus?.realAiEnabled
                ? `${aiStatus.provider} · ${aiStatus.model}${aiStatus.visionEnabled ? '' : ' · 仅文本'}`
                : '本地规则占位'}
            </span>
          </div>
          {notice && <p className="notice">{notice}</p>}
        </header>

        {activeView === 'consultation' && (
          <section className="grid two">
            <div className="panel consultation-input">
              <h2>多模态问诊</h2>
              <div className="mode-toolbar">
                <div>
                  <span className="field-label">问诊模式</span>
                  <div className="segmented-control">
                    {[
                      ['standard', '普通'],
                      ['child', '儿童'],
                      ['elder', '老人']
                    ].map(([value, label]) => (
                      <button key={value} className={careMode === value ? 'selected' : ''} onClick={() => changeCareMode(value)}>{label}</button>
                    ))}
                  </div>
                </div>
                <label>
                  回复语言
                  <select value={outputLanguage} onChange={(event) => setOutputLanguage(event.target.value)}>
                    <option value="zh-CN">中文</option>
                    <option value="zh-CN,en">中英双语</option>
                  </select>
                </label>
              </div>

              <details className="guided-assessment">
                <summary>症状自查向导</summary>
                <div className="guided-grid">
                  <label>不适部位<select value={guidedInput.bodyPart} onChange={(event) => setGuidedInput({ ...guidedInput, bodyPart: event.target.value })}>
                    {['头部', '胸部', '腹部', '背部', '上肢', '下肢', '皮肤', '咽喉'].map((item) => <option key={item}>{item}</option>)}
                  </select></label>
                  <label>主要症状<select value={guidedInput.symptom} onChange={(event) => setGuidedInput({ ...guidedInput, symptom: event.target.value })}>
                    {['疼痛', '瘙痒', '肿胀', '红疹', '发热', '麻木', '头晕', '咳嗽'].map((item) => <option key={item}>{item}</option>)}
                  </select></label>
                  <label>持续时间<select value={guidedInput.duration} onChange={(event) => setGuidedInput({ ...guidedInput, duration: event.target.value })}>
                    {['1小时内', '1天', '2天', '3-7天', '1-4周', '1个月以上'].map((item) => <option key={item}>{item}</option>)}
                  </select></label>
                  <label>严重程度<select value={guidedInput.severity} onChange={(event) => setGuidedInput({ ...guidedInput, severity: event.target.value })}>
                    <option>轻度，不影响活动</option><option>中度，影响部分日常活动</option><option>重度，无法正常活动</option>
                  </select></label>
                  <label className="guided-wide">伴随症状<select value={guidedInput.accompanying} onChange={(event) => setGuidedInput({ ...guidedInput, accompanying: event.target.value })}>
                    <option>无明显伴随症状</option><option>伴随发热</option><option>伴随恶心或呕吐</option><option>伴随肿胀或出血</option><option>伴随呼吸困难</option>
                  </select></label>
                  <button className="secondary" onClick={applyGuidedAssessment}>生成症状描述</button>
                </div>
              </details>
              <label>
                会话标题
                <input value={sessionTitle} onChange={(e) => setSessionTitle(e.target.value)} />
              </label>
              <label>
                症状描述
                <textarea rows="5" value={chatText} onChange={(e) => {
                  setChatText(e.target.value)
                  setGuidedApplied(false)
                }} />
              </label>
              <div className="actions">
                <button onClick={createSession}>新建会话</button>
                <button onClick={sendText}>发送问诊</button>
                <button className="secondary" onClick={runSafetyCheck}>风险检查</button>
              </div>
              <button className="secondary feature-pending" onClick={showImageComingSoon}>图片问诊（开发中）</button>
              <div className="upload-row">
                <label>
                  语音
                  <input type="file" accept="audio/*" onChange={(e) => setSelectedAudio(e.target.files?.[0])} />
                </label>
                <button className="secondary" onClick={uploadVoice}>上传语音</button>
              </div>
            </div>

            <div className="panel consultation-results">
              <div className="section-head">
                <h2>会话结果</h2>
                <button className="secondary print-button" onClick={() => window.print()}>打印问诊报告</button>
              </div>
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
              {consultationAnalysis && <ConsultationAnalysis analysis={consultationAnalysis} />}
              {!consultationAnalysis && riskResult && <Result title="风险提示" data={riskResult} />}
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

function ConsultationAnalysis({ analysis }) {
  const risk = analysis.risk || {}
  const pendingQuestions = (analysis.followUpQuestions || []).filter((item) => !item.status || item.status === 'pending')
  const progress = analysis.questionProgress
  return (
    <section className="analysis-board">
      <div className="analysis-head">
        <strong>结构化问诊结果</strong>
        <div className="analysis-meta">
          {progress && <span className="progress-text">已回答 {progress.answered} · 待补充 {progress.pending}</span>}
          <span className={`risk-badge ${risk.level || 'low'}`}>{risk.level || 'low'}</span>
        </div>
      </div>

      <div className="analysis-section">
        <h3>症状提取</h3>
        <div className="symptom-list">
          {(analysis.symptoms || []).map((symptom, index) => (
            <article className="symptom-item" key={`${symptom.name}-${index}`}>
              <strong>{symptom.name}</strong>
              <span>{symptom.bodyPart || '部位待确认'}</span>
              <span>{symptom.duration || '持续时间待确认'}</span>
              <span>{severityText(symptom.severity)}</span>
            </article>
          ))}
        </div>
      </div>

      {!!pendingQuestions.length && (
        <div className="analysis-section">
          <h3>需要补充</h3>
          <ol className="question-list">
            {pendingQuestions.map((item, index) => (
              <li key={`${item.question || item.questionText}-${index}`}>{item.question || item.questionText}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="analysis-section risk-summary">
        <h3>风险与就医建议</h3>
        <p>{risk.action || risk.recommendation}</p>
        <dl>
          <div><dt>建议科室</dt><dd>{risk.department || analysis.summary?.suggestedDepartment || '全科'}</dd></div>
          <div><dt>风险原因</dt><dd>{(risk.reasons || risk.triggers || []).join('、') || '暂无明确危险信号'}</dd></div>
        </dl>
      </div>

      {!!analysis.recommendations?.length && (
        <div className="analysis-section">
          <h3>行动建议</h3>
          <ul className="recommendation-list">
            {analysis.recommendations.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
          </ul>
        </div>
      )}

      <div className="analysis-section doctor-summary">
        <h3>医生摘要</h3>
        <p>{analysis.doctorSummary || analysis.summary?.doctorSummary || '尚未生成摘要'}</p>
      </div>
    </section>
  )
}

function severityText(value) {
  return {
    mild: '轻度',
    moderate: '中度',
    severe: '重度',
    unknown: '程度待确认'
  }[value] || '程度待确认'
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
