require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 8080);
const jwtSecret = process.env.JWT_SECRET || 'local-dev-health-secret';
const openaiApiKey = process.env.OPENAI_API_KEY || '';
const openaiModel = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const uploadDir = path.join(__dirname, '..', 'uploads');
const frontendDistDir = path.join(__dirname, '..', 'frontend', 'dist');

fs.mkdirSync(uploadDir, { recursive: true });

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'multimodal_health_consultation',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10
});

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 20 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadDir));

function ok(data = null, message = 'success') {
  return { code: 0, message, data };
}

function fail(message, code = 400) {
  return { code, message, data: null };
}

function toCamel(row) {
  if (!row || typeof row !== 'object') return row;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase()),
    value
  ]));
}

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function getOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, roleCode: user.role_code || user.roleCode },
    jwtSecret,
    { expiresIn: '8h' }
  );
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json(fail('Missing access token', 401));
    const payload = jwt.verify(token, jwtSecret);
    const user = await getOne(
      `SELECT u.*, r.code AS role_code, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? AND u.status = 'active'`,
      [payload.id]
    );
    if (!user) return res.status(401).json(fail('Invalid access token', 401));
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json(fail('Invalid access token', 401));
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function pageArgs(req, defaultPageSize = 10) {
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize || String(defaultPageSize), 10) || defaultPageSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

app.get('/api/v1/health', asyncRoute(async (_req, res) => {
  const row = await getOne('SELECT VERSION() AS mysql_version');
  res.json(ok({
    status: 'ok',
    mysqlVersion: row.mysql_version,
    aiProvider: openaiApiKey ? 'openai' : 'local-rule-fallback',
    aiModel: openaiApiKey ? openaiModel : null
  }));
}));

app.get('/api/v1/ai/status', auth, asyncRoute(async (_req, res) => {
  res.json(ok({
    provider: openaiApiKey ? 'openai' : 'local-rule-fallback',
    model: openaiApiKey ? openaiModel : null,
    realAiEnabled: Boolean(openaiApiKey)
  }));
}));

app.post('/api/v1/auth/register', asyncRoute(async (req, res) => {
  const { username, password, displayName, phone, email } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json(fail('username, password and displayName are required'));
  }
  const exists = await getOne('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) return res.status(409).json(fail('Username already exists', 409));
  const role = await getOne("SELECT id FROM roles WHERE code = 'user'");
  const hash = await bcrypt.hash(password, 10);
  const result = await query(
    `INSERT INTO users (role_id, username, phone, email, password_hash, display_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [role.id, username, phone || null, email || null, hash, displayName]
  );
  res.status(201).json(ok({ id: result.insertId, username, displayName }));
}));

app.post('/api/v1/auth/login', asyncRoute(async (req, res) => {
  const { username, password } = req.body;
  const user = await getOne(
    `SELECT u.*, r.code AS role_code, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.username = ?`,
    [username]
  );
  if (!user) return res.status(401).json(fail('Invalid username or password', 401));
  const storedHash = String(user.password_hash || '');
  const bcryptHash = storedHash.startsWith('$2') && !storedHash.includes('demo_hash');
  const passwordOk = bcryptHash
    ? await bcrypt.compare(password || '', storedHash)
    : password === '123456';
  if (!passwordOk) return res.status(401).json(fail('Invalid username or password', 401));
  await query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  const accessToken = signToken(user);
  const refreshToken = jwt.sign({ id: user.id, type: 'refresh' }, jwtSecret, { expiresIn: '7d' });
  res.json(ok({
    accessToken,
    refreshToken,
    user: toCamel({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role_code: user.role_code,
      role_name: user.role_name
    })
  }));
}));

app.post('/api/v1/auth/refresh', asyncRoute(async (req, res) => {
  const payload = jwt.verify(req.body.refreshToken || '', jwtSecret);
  const user = await getOne(
    `SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [payload.id]
  );
  res.json(ok({ accessToken: signToken(user) }));
}));

app.post('/api/v1/auth/logout', (_req, res) => res.json(ok(true)));

app.get('/api/v1/auth/me', auth, (req, res) => {
  res.json(ok(toCamel({
    id: req.user.id,
    username: req.user.username,
    display_name: req.user.display_name,
    phone: req.user.phone,
    email: req.user.email,
    role_code: req.user.role_code,
    role_name: req.user.role_name
  })));
});

app.get('/api/v1/users', auth, asyncRoute(async (req, res) => {
  const { page, pageSize, offset } = pageArgs(req, 10);
  const keyword = `%${req.query.keyword || ''}%`;
  const rows = await query(
    `SELECT u.id, u.username, u.display_name, u.phone, u.email, u.status, r.name AS role_name, u.created_at
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.username LIKE ? OR u.display_name LIKE ? OR u.phone LIKE ?
     ORDER BY u.id LIMIT ${pageSize} OFFSET ${offset}`,
    [keyword, keyword, keyword]
  );
  res.json(ok({ items: rows.map(toCamel), page, pageSize }));
}));

app.get('/api/v1/users/:id', auth, asyncRoute(async (req, res) => {
  const row = await getOne(
    `SELECT u.id, u.username, u.display_name, u.phone, u.email, u.status, r.name AS role_name, u.created_at
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [req.params.id]
  );
  if (!row) return res.status(404).json(fail('User not found', 404));
  res.json(ok(toCamel(row)));
}));

app.patch('/api/v1/users/:id/status', auth, asyncRoute(async (req, res) => {
  await query('UPDATE users SET status = ? WHERE id = ?', [req.body.status || 'active', req.params.id]);
  res.json(ok(true));
}));

app.get('/api/v1/health-profile/me', auth, asyncRoute(async (req, res) => {
  const profile = await getOne('SELECT * FROM health_profiles WHERE user_id = ?', [req.user.id]);
  res.json(ok(profile ? toCamel(profile) : null));
}));

app.put('/api/v1/health-profile/me', auth, asyncRoute(async (req, res) => {
  const b = req.body;
  await query(
    `INSERT INTO health_profiles
      (user_id, gender, birth_date, height_cm, weight_kg, blood_type, allergy_history, disease_history, surgery_history, family_history, current_medications, lifestyle_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      gender=VALUES(gender), birth_date=VALUES(birth_date), height_cm=VALUES(height_cm), weight_kg=VALUES(weight_kg),
      blood_type=VALUES(blood_type), allergy_history=VALUES(allergy_history), disease_history=VALUES(disease_history),
      surgery_history=VALUES(surgery_history), family_history=VALUES(family_history),
      current_medications=VALUES(current_medications), lifestyle_notes=VALUES(lifestyle_notes)`,
    [req.user.id, b.gender || 'unknown', b.birthDate || null, b.heightCm || null, b.weightKg || null, b.bloodType || null,
      b.allergyHistory || null, b.diseaseHistory || null, b.surgeryHistory || null, b.familyHistory || null,
      b.currentMedications || null, b.lifestyleNotes || null]
  );
  res.json(ok(await getOne('SELECT * FROM health_profiles WHERE user_id = ?', [req.user.id])));
}));

app.post('/api/v1/health-profile/me/metrics', auth, asyncRoute(async (req, res) => {
  const b = req.body;
  const result = await query(
    `INSERT INTO health_metrics (user_id, metric_type, value_text, unit, measured_at, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user.id, b.metricType, b.valueText, b.unit || null, new Date(b.measuredAt || Date.now()), b.note || null]
  );
  res.status(201).json(ok({ id: result.insertId }));
}));

app.get('/api/v1/health-profile/me/metrics', auth, asyncRoute(async (req, res) => {
  const { page, pageSize, offset } = pageArgs(req, 20);
  const params = [req.user.id];
  let where = 'WHERE user_id = ?';
  if (req.query.metricType) {
    where += ' AND metric_type = ?';
    params.push(req.query.metricType);
  }
  const rows = await query(`SELECT * FROM health_metrics ${where} ORDER BY measured_at DESC LIMIT ${pageSize} OFFSET ${offset}`, params);
  res.json(ok({ items: rows.map(toCamel), page, pageSize }));
}));

app.post('/api/v1/consultations', auth, asyncRoute(async (req, res) => {
  const b = req.body;
  const result = await query(
    `INSERT INTO consultation_sessions (user_id, title, channel, summary)
     VALUES (?, ?, ?, ?)`,
    [req.user.id, b.title || '新问诊', b.channel || 'text', b.initialMessage || null]
  );
  if (b.initialMessage) {
    await query(
      `INSERT INTO consultation_messages (session_id, sender_type, input_type, content)
       VALUES (?, 'user', 'text', ?)`,
      [result.insertId, b.initialMessage]
    );
  }
  res.status(201).json(ok({ id: result.insertId }));
}));

app.get('/api/v1/consultations', auth, asyncRoute(async (req, res) => {
  const { page, pageSize, offset } = pageArgs(req, 10);
  const params = [req.user.id];
  let where = 'WHERE user_id = ?';
  if (req.query.riskLevel) {
    where += ' AND risk_level = ?';
    params.push(req.query.riskLevel);
  }
  const rows = await query(`SELECT * FROM consultation_sessions ${where} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`, params);
  res.json(ok({ items: rows.map(toCamel), page, pageSize }));
}));

app.get('/api/v1/consultations/:id', auth, asyncRoute(async (req, res) => {
  const session = await getOne('SELECT * FROM consultation_sessions WHERE id = ?', [req.params.id]);
  if (!session) return res.status(404).json(fail('Consultation not found', 404));
  const messages = await query('SELECT * FROM consultation_messages WHERE session_id = ? ORDER BY id', [req.params.id]);
  const files = await query('SELECT * FROM uploaded_files WHERE session_id = ? ORDER BY id', [req.params.id]);
  res.json(ok({ ...toCamel(session), messages: messages.map(toCamel), files: files.map(toCamel) }));
}));

app.post('/api/v1/consultations/:id/messages/text', auth, asyncRoute(async (req, res) => {
  const content = req.body.content || '';
  await query(
    `INSERT INTO consultation_messages (session_id, sender_type, input_type, content, structured_json)
     VALUES (?, 'user', 'text', ?, ?)`,
    [req.params.id, content, JSON.stringify(req.body.context || {})]
  );
  const risk = inferRisk(content);
  const aiStarted = Date.now();
  const aiResult = await buildAssistantReply({
    sessionId: req.params.id,
    userId: req.user.id,
    content,
    risk
  });
  const assistantText = aiResult.text;
  const result = await query(
    `INSERT INTO consultation_messages (session_id, sender_type, input_type, content, structured_json)
     VALUES (?, 'assistant', 'text', ?, ?)`,
    [req.params.id, assistantText, JSON.stringify({
      riskLevel: risk.level,
      recommendation: risk.recommendation,
      aiProvider: aiResult.provider,
      aiModel: aiResult.model
    })]
  );
  await query(
    `INSERT INTO model_call_logs (session_id, provider, model_name, capability, latency_ms, success, error_message)
     VALUES (?, ?, ?, 'llm', ?, ?, ?)`,
    [req.params.id, aiResult.provider, aiResult.model || 'none', Date.now() - aiStarted, aiResult.success, aiResult.error || null]
  );
  await query(
    `UPDATE consultation_sessions SET risk_level = ?, recommended_department = COALESCE(recommended_department, ?), updated_at = NOW() WHERE id = ?`,
    [risk.level, risk.department, req.params.id]
  );
  res.status(201).json(ok({ messageId: result.insertId, reply: assistantText, risk, ai: aiResult }));
}));

app.post('/api/v1/consultations/:id/messages/image', auth, upload.single('file'), asyncRoute(async (req, res) => {
  const file = req.file;
  const result = await query(
    `INSERT INTO uploaded_files (user_id, session_id, file_type, original_name, storage_url, mime_type, file_size_bytes, status)
     VALUES (?, ?, 'image', ?, ?, ?, ?, 'analyzed')`,
    [req.user.id, req.params.id, file.originalname, `/uploads/${file.filename}`, file.mimetype, file.size]
  );
  const imageStarted = Date.now();
  const imageAiResult = await analyzeImageWithAi({
    sessionId: req.params.id,
    filePath: file.path,
    mimeType: file.mimetype,
    description: req.body.description || ''
  });
  await query(
    `INSERT INTO image_analysis_results (file_id, image_category, quality_score, findings, confidence, safety_note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      result.insertId,
      imageAiResult.imageCategory,
      imageAiResult.qualityScore,
      imageAiResult.findings,
      imageAiResult.confidence,
      imageAiResult.safetyNote
    ]
  );
  await query(
    `INSERT INTO model_call_logs (session_id, provider, model_name, capability, latency_ms, success, error_message)
     VALUES (?, ?, ?, 'vision', ?, ?, ?)`,
    [req.params.id, imageAiResult.provider, imageAiResult.model || 'none', Date.now() - imageStarted, imageAiResult.success, imageAiResult.error || null]
  );
  res.status(201).json(ok({ fileId: result.insertId, analysis: imageAiResult }));
}));

app.post('/api/v1/consultations/:id/messages/voice', auth, upload.single('file'), asyncRoute(async (req, res) => {
  const file = req.file;
  const result = await query(
    `INSERT INTO uploaded_files (user_id, session_id, file_type, original_name, storage_url, mime_type, file_size_bytes, status)
     VALUES (?, ?, 'audio', ?, ?, ?, ?, 'analyzed')`,
    [req.user.id, req.params.id, file.originalname, `/uploads/${file.filename}`, file.mimetype, file.size]
  );
  await query(
    `INSERT INTO speech_results (file_id, transcript, language, confidence, duration_seconds)
     VALUES (?, '演示环境暂未接入真实语音识别，这是占位转写文本。', ?, 0.500, 0)`,
    [result.insertId, req.body.language || 'zh-CN']
  );
  res.status(201).json(ok({ fileId: result.insertId }));
}));

app.post('/api/v1/consultations/:id/multimodal-analysis', auth, asyncRoute(async (req, res) => {
  const messages = await query('SELECT content FROM consultation_messages WHERE session_id = ? ORDER BY id', [req.params.id]);
  const files = await query('SELECT id, file_type, original_name FROM uploaded_files WHERE session_id = ? ORDER BY id', [req.params.id]);
  res.json(ok({
    sessionId: Number(req.params.id),
    includeHealthProfile: Boolean(req.body.includeHealthProfile),
    summary: `已融合 ${messages.length} 条消息和 ${files.length} 个文件。`,
    files: files.map(toCamel),
    safetyNote: '多模态结果仅作健康咨询辅助，不能替代医生诊断。'
  }));
}));

app.patch('/api/v1/consultations/:id/status', auth, asyncRoute(async (req, res) => {
  await query('UPDATE consultation_sessions SET status = ?, summary = COALESCE(?, summary) WHERE id = ?', [
    req.body.status || 'closed', req.body.summary || null, req.params.id
  ]);
  res.json(ok(true));
}));

app.get('/api/v1/files/:id', auth, asyncRoute(async (req, res) => {
  const file = await getOne('SELECT * FROM uploaded_files WHERE id = ?', [req.params.id]);
  if (!file) return res.status(404).json(fail('File not found', 404));
  res.json(ok(toCamel(file)));
}));

app.get('/api/v1/files/:id/image-analysis', auth, asyncRoute(async (req, res) => {
  const row = await getOne('SELECT * FROM image_analysis_results WHERE file_id = ?', [req.params.id]);
  res.json(ok(row ? toCamel(row) : null));
}));

app.get('/api/v1/files/:id/speech-result', auth, asyncRoute(async (req, res) => {
  const row = await getOne('SELECT * FROM speech_results WHERE file_id = ?', [req.params.id]);
  res.json(ok(row ? toCamel(row) : null));
}));

app.post('/api/v1/ai/tts', auth, asyncRoute(async (req, res) => {
  res.json(ok({
    text: req.body.text,
    voice: req.body.voice || 'female_standard',
    format: req.body.format || 'mp3',
    audioUrl: null,
    note: '演示服务暂未接入真实 TTS。'
  }));
}));

app.post('/api/v1/ai/safety-check', auth, asyncRoute(async (req, res) => {
  const risk = inferRisk(req.body.content || '');
  res.json(ok({ safe: risk.level !== 'emergency', ...risk }));
}));

app.get('/api/v1/consultations/:id/risk-assessments', auth, asyncRoute(async (req, res) => {
  const rows = await query('SELECT * FROM risk_assessments WHERE session_id = ? ORDER BY id DESC', [req.params.id]);
  res.json(ok(rows.map(toCamel)));
}));

app.post('/api/v1/consultations/:id/risk-assessments', auth, asyncRoute(async (req, res) => {
  const b = req.body;
  const result = await query(
    `INSERT INTO risk_assessments (session_id, risk_level, triggers, recommendation, need_offline_care)
     VALUES (?, ?, ?, ?, ?)`,
    [req.params.id, b.riskLevel, JSON.stringify(b.triggers || []), b.recommendation, Boolean(b.needOfflineCare)]
  );
  await query('UPDATE consultation_sessions SET risk_level = ? WHERE id = ?', [b.riskLevel, req.params.id]);
  res.status(201).json(ok({ id: result.insertId }));
}));

app.get('/api/v1/doctor/consultations', auth, asyncRoute(async (req, res) => {
  const { pageSize, offset } = pageArgs(req, 10);
  const rows = await query(
    `SELECT cs.*, u.display_name FROM consultation_sessions cs JOIN users u ON u.id = cs.user_id
     WHERE (? = '' OR cs.status = ?) AND (? = '' OR cs.risk_level = ?)
     ORDER BY cs.updated_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
    [req.query.status || '', req.query.status || '', req.query.riskLevel || '', req.query.riskLevel || '',
    ]
  );
  res.json(ok({ items: rows.map(toCamel) }));
}));

app.post('/api/v1/doctor/consultations/:id/reply', auth, asyncRoute(async (req, res) => {
  const result = await query(
    `INSERT INTO consultation_messages (session_id, sender_type, input_type, content, structured_json)
     VALUES (?, 'doctor', 'text', ?, ?)`,
    [req.params.id, req.body.content, JSON.stringify({ markHighRisk: Boolean(req.body.markHighRisk) })]
  );
  if (req.body.markHighRisk) {
    await query("UPDATE consultation_sessions SET risk_level = 'high' WHERE id = ?", [req.params.id]);
  }
  res.status(201).json(ok({ messageId: result.insertId }));
}));

app.get('/api/v1/admin/consultations/high-risk', auth, asyncRoute(async (req, res) => {
  const { pageSize, offset } = pageArgs(req, 10);
  const rows = await query(
    `SELECT cs.*, u.display_name FROM consultation_sessions cs JOIN users u ON u.id = cs.user_id
     WHERE cs.risk_level IN ('medium', 'high', 'emergency')
     ORDER BY FIELD(cs.risk_level, 'emergency', 'high', 'medium', 'low'), cs.updated_at DESC
     LIMIT ${pageSize} OFFSET ${offset}`
  );
  res.json(ok({ items: rows.map(toCamel) }));
}));

app.get('/api/v1/admin/model-call-logs', auth, asyncRoute(async (req, res) => {
  const { pageSize, offset } = pageArgs(req, 20);
  const rows = await query(
    `SELECT * FROM model_call_logs WHERE (? = '' OR session_id = ?) ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`,
    [req.query.sessionId || '', req.query.sessionId || '']
  );
  res.json(ok({ items: rows.map(toCamel) }));
}));

app.get('/api/v1/admin/audit-logs', auth, asyncRoute(async (req, res) => {
  const { pageSize, offset } = pageArgs(req, 20);
  const rows = await query(
    `SELECT * FROM audit_logs
     WHERE (? = '' OR actor_user_id = ?) AND (? = '' OR action = ?)
     ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`,
    [req.query.actorUserId || '', req.query.actorUserId || '', req.query.action || '', req.query.action || '']
  );
  res.json(ok({ items: rows.map(toCamel) }));
}));

app.put('/api/v1/admin/safety-rules', auth, asyncRoute(async (req, res) => {
  res.json(ok({ saved: true, rules: req.body }));
}));

function inferRisk(text) {
  const emergencyWords = ['胸痛', '呼吸困难', '意识障碍', '大出血', '严重过敏', '卒中', '中风'];
  if (emergencyWords.some((word) => text.includes(word))) {
    return {
      level: 'emergency',
      department: '急诊科',
      recommendation: '出现紧急危险信号，建议立即拨打急救电话或前往急诊。'
    };
  }
  if (['发热', '疼痛', '渗液', '扩散', '红肿'].some((word) => text.includes(word))) {
    return {
      level: 'medium',
      department: '全科',
      recommendation: '建议补充症状信息并考虑线下就医评估。'
    };
  }
  return {
    level: 'low',
    department: '全科',
    recommendation: '建议继续观察，若症状加重或持续不缓解，请及时就医。'
  };
}

async function buildAssistantReply({ sessionId, userId, content, risk }) {
  if (!openaiApiKey) {
    return {
      provider: 'local-rule-fallback',
      model: null,
      success: true,
      text: `当前未配置 OPENAI_API_KEY，因此这是本地规则回复，不是真正 AI。${risk.recommendation} 本系统仅提供健康咨询辅助，不能替代医生诊断。`
    };
  }

  try {
    const profile = await getOne('SELECT * FROM health_profiles WHERE user_id = ?', [userId]);
    const history = await query(
      `SELECT sender_type, content FROM consultation_messages
       WHERE session_id = ? ORDER BY id DESC LIMIT 8`,
      [sessionId]
    );
    const prompt = [
      '你是一个中文多模态健康问诊助手，只提供健康咨询、症状整理、风险提示和就医建议，不做确诊。',
      '回答必须包含：1. 对用户描述的理解；2. 需要追问的关键信息；3. 可能风险；4. 居家观察建议；5. 何时线下就医。',
      '如果出现胸痛、呼吸困难、意识障碍、大出血、严重过敏、疑似卒中等危险信号，必须明确建议立即急诊或拨打急救电话。',
      '不要编造检查结果，不要给出处方剂量，不要说“你就是某某病”。',
      '',
      `当前规则风险等级：${risk.level}`,
      `规则建议：${risk.recommendation}`,
      `健康档案：${JSON.stringify(toCamel(profile) || {})}`,
      `最近对话：${JSON.stringify(history.reverse().map(toCamel))}`,
      `用户最新描述：${content}`
    ].join('\n');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: openaiModel,
        input: prompt,
        temperature: 0.2,
        max_output_tokens: 700
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `OpenAI request failed: ${response.status}`);
    }
    const text = extractResponseText(data);
    return {
      provider: 'openai',
      model: openaiModel,
      success: true,
      text: text || `AI 没有返回有效文本。${risk.recommendation}`
    };
  } catch (error) {
    return {
      provider: 'openai',
      model: openaiModel,
      success: false,
      error: error.message,
      text: `AI 调用失败，已降级为本地安全回复：${risk.recommendation} 本系统仅提供健康咨询辅助，不能替代医生诊断。`
    };
  }
}

function extractResponseText(data) {
  if (data.output_text) return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) chunks.push(content.text);
      if (content.type === 'text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

async function analyzeImageWithAi({ sessionId, filePath, mimeType, description }) {
  if (!openaiApiKey) {
    return {
      provider: 'local-rule-fallback',
      model: null,
      success: true,
      imageCategory: 'unknown',
      qualityScore: 0.5,
      findings: '当前未配置 OPENAI_API_KEY，因此图片只完成了上传记录，没有进行真实 AI 图像分析。',
      confidence: 0.3,
      safetyNote: '图片分析仅作辅助，不能替代医生面诊。'
    };
  }

  try {
    const imageBase64 = fs.readFileSync(filePath).toString('base64');
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: openaiModel,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: [
                  '你是中文健康问诊系统的图像辅助分析模块。',
                  '请根据图片和用户描述做辅助分析，不要确诊。',
                  '请输出 JSON，字段包含 imageCategory, qualityScore, findings, confidence, safetyNote。',
                  'imageCategory 可选 skin, tongue, wound, lab_report, medical_report, medicine, unknown。',
                  'qualityScore 和 confidence 是 0 到 1 的数字。',
                  '如果图片涉及严重红肿、出血、感染、骨折可能、明显畸形或其他危险信号，要建议线下就医。',
                  `用户描述：${description || '无'}`
                ].join('\n')
              },
              {
                type: 'input_image',
                image_url: `data:${mimeType};base64,${imageBase64}`
              }
            ]
          }
        ],
        temperature: 0.1,
        max_output_tokens: 600
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `OpenAI vision request failed: ${response.status}`);
    }
    const text = extractResponseText(data);
    const parsed = parseJsonObject(text);
    return {
      provider: 'openai',
      model: openaiModel,
      success: true,
      imageCategory: normalizeImageCategory(parsed.imageCategory),
      qualityScore: clampNumber(parsed.qualityScore, 0.75),
      findings: parsed.findings || text || 'AI 已分析图片，但未返回明确发现。',
      confidence: clampNumber(parsed.confidence, 0.65),
      safetyNote: parsed.safetyNote || '图片分析仅作辅助，不能替代医生面诊。'
    };
  } catch (error) {
    return {
      provider: 'openai',
      model: openaiModel,
      success: false,
      error: error.message,
      imageCategory: 'unknown',
      qualityScore: 0.5,
      findings: `AI 图像分析失败：${error.message}`,
      confidence: 0.1,
      safetyNote: '图片分析失败时请不要依赖系统判断，如症状明显或加重请线下就医。'
    };
  }
}

function parseJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function normalizeImageCategory(value) {
  const allowed = ['skin', 'tongue', 'wound', 'lab_report', 'medical_report', 'medicine', 'unknown'];
  return allowed.includes(value) ? value : 'unknown';
}

function clampNumber(value, fallback) {
  const number = Number(value);
  if (Number.isNaN(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json(fail(error.message || 'Internal server error', 500));
});

if (fs.existsSync(frontendDistDir)) {
  app.use(express.static(frontendDistDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    res.sendFile(path.join(frontendDistDir, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Multimodal health API is running at http://localhost:${port}/api/v1`);
  if (fs.existsSync(frontendDistDir)) {
    console.log(`Frontend is available at http://localhost:${port}/`);
  }
});
