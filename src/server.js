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
const aiProvider = String(process.env.AI_PROVIDER || (process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'openai')).toLowerCase();
const deepseekApiKey = process.env.DEEPSEEK_API_KEY || '';
const deepseekModel = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const deepseekBaseUrl = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
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

async function getOwnedSession(sessionId, userId) {
  return getOne(
    'SELECT * FROM consultation_sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId]
  );
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
  const ai = getAiStatus();
  res.json(ok({
    status: 'ok',
    mysqlVersion: row.mysql_version,
    aiProvider: ai.provider,
    aiModel: ai.model
  }));
}));

app.get('/api/v1/ai/status', auth, asyncRoute(async (_req, res) => {
  res.json(ok(getAiStatus()));
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
  const session = await getOwnedSession(req.params.id, req.user.id);
  if (!session) return res.status(404).json(fail('Consultation not found', 404));
  const messages = await query('SELECT * FROM consultation_messages WHERE session_id = ? ORDER BY id', [req.params.id]);
  const files = await query('SELECT * FROM uploaded_files WHERE session_id = ? ORDER BY id', [req.params.id]);
  const symptoms = await query('SELECT * FROM symptom_extractions WHERE session_id = ? ORDER BY id', [req.params.id]);
  const followUpQuestions = await query(
    'SELECT * FROM follow_up_questions WHERE session_id = ? ORDER BY priority, id',
    [req.params.id]
  );
  const latestSummary = await getOne(
    'SELECT * FROM consultation_summaries WHERE session_id = ? ORDER BY version DESC LIMIT 1',
    [req.params.id]
  );
  const latestRisk = await getOne(
    'SELECT * FROM risk_assessments WHERE session_id = ? ORDER BY id DESC LIMIT 1',
    [req.params.id]
  );
  const summaryData = latestSummary ? toCamel(latestSummary) : null;
  const riskData = latestRisk ? toCamel(latestRisk) : null;
  const questionProgress = await getQuestionProgress(req.params.id);
  res.json(ok({
    ...toCamel(session),
    messages: messages.map(toCamel),
    files: files.map(toCamel),
    analysis: {
      symptoms: symptoms.map((row) => {
        const item = toCamel(row);
        return {
          name: item.symptomName,
          bodyPart: item.bodyPart,
          onset: item.onsetText,
          duration: item.durationText,
          severity: item.severity,
          frequency: item.frequencyText,
          confidence: Number(item.confidence)
        };
      }),
      followUpQuestions: followUpQuestions.map((row) => {
        const item = toCamel(row);
        return {
          id: item.id,
          question: item.questionText,
          field: item.targetField,
          priority: item.priority,
          status: item.status
        };
      }),
      questionProgress,
      summary: summaryData,
      recommendations: parseJsonValue(summaryData?.recommendations, []),
      doctorSummary: summaryData?.doctorSummary || null,
      risk: riskData ? {
        level: riskData.riskLevel,
        reasons: parseJsonValue(riskData.triggers, []),
        department: summaryData?.suggestedDepartment || session.recommended_department,
        action: riskData.recommendation
      } : null
    }
  }));
}));

app.post('/api/v1/consultations/:id/messages/text', auth, asyncRoute(async (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json(fail('content is required'));
  const session = await getOwnedSession(req.params.id, req.user.id);
  if (!session) return res.status(404).json(fail('Consultation not found', 404));

  const userMessage = await query(
    `INSERT INTO consultation_messages (session_id, sender_type, input_type, content, structured_json)
     VALUES (?, 'user', 'text', ?, ?)`,
    [req.params.id, content, JSON.stringify(req.body.context || {})]
  );
  const pendingQuestions = await query(
    `SELECT id, question_text, target_field, priority
     FROM follow_up_questions
     WHERE session_id = ? AND status = 'pending'
     ORDER BY priority, id`,
    [req.params.id]
  );
  const ruleRisk = inferRisk(content);
  const aiStarted = Date.now();
  const aiResult = await buildAssistantReply({
    sessionId: req.params.id,
    userId: req.user.id,
    content,
    risk: ruleRisk,
    pendingQuestions: pendingQuestions.map(toCamel)
  });
  const analysis = normalizeConsultationAnalysis(aiResult.analysis, content, ruleRisk, pendingQuestions.map(toCamel));
  const connection = await pool.getConnection();
  let assistantMessageId;
  try {
    await connection.beginTransaction();
    const [assistantMessage] = await connection.execute(
      `INSERT INTO consultation_messages (session_id, sender_type, input_type, content, structured_json)
       VALUES (?, 'assistant', 'text', ?, ?)`,
      [req.params.id, analysis.reply, JSON.stringify({
        ...analysis,
        aiProvider: aiResult.provider,
        aiModel: aiResult.model
      })]
    );
    assistantMessageId = assistantMessage.insertId;

    if (analysis.answeredQuestionIds.length) {
      const placeholders = analysis.answeredQuestionIds.map(() => '?').join(',');
      await connection.execute(
        `UPDATE follow_up_questions
         SET status = 'answered', answer_message_id = ?, answered_at = NOW()
         WHERE session_id = ? AND status = 'pending' AND id IN (${placeholders})`,
        [userMessage.insertId, req.params.id, ...analysis.answeredQuestionIds]
      );
    }

    for (const symptom of analysis.symptoms) {
      await connection.execute(
        `INSERT INTO symptom_extractions
          (session_id, message_id, symptom_name, body_part, onset_text, duration_text, severity, frequency_text, confidence, source_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'text')`,
        [
          req.params.id,
          userMessage.insertId,
          symptom.name,
          symptom.bodyPart || null,
          symptom.onset || null,
          symptom.duration || null,
          symptom.severity,
          symptom.frequency || null,
          symptom.confidence
        ]
      );
    }

    for (const question of analysis.followUpQuestions) {
      const [duplicateRows] = await connection.execute(
        `SELECT id FROM follow_up_questions
         WHERE session_id = ? AND status = 'pending'
           AND (question_text = ? OR (target_field IS NOT NULL AND target_field = ?))
         LIMIT 1`,
        [req.params.id, question.question, question.field || null]
      );
      if (!duplicateRows.length) {
        await connection.execute(
          `INSERT INTO follow_up_questions
            (session_id, source_message_id, question_text, target_field, priority)
           VALUES (?, ?, ?, ?, ?)`,
          [req.params.id, assistantMessageId, question.question, question.field || null, question.priority]
        );
      }
    }

    await connection.execute(
      `INSERT INTO risk_assessments (session_id, risk_level, triggers, recommendation, need_offline_care)
       VALUES (?, ?, ?, ?, ?)`,
      [
        req.params.id,
        analysis.risk.level,
        JSON.stringify(analysis.risk.reasons),
        analysis.risk.action,
        ['medium', 'high', 'emergency'].includes(analysis.risk.level)
      ]
    );

    const [versionRows] = await connection.execute(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM consultation_summaries WHERE session_id = ?',
      [req.params.id]
    );
    await connection.execute(
      `INSERT INTO consultation_summaries
        (session_id, source_message_id, version, symptom_summary, user_summary, doctor_summary, recommendations, suggested_department, generated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        assistantMessageId,
        versionRows[0].next_version,
        analysis.symptoms.map((item) => `${item.bodyPart ? `${item.bodyPart} ` : ''}${item.name}`).join('、') || content,
        analysis.reply,
        analysis.doctorSummary,
        JSON.stringify(analysis.recommendations),
        analysis.risk.department,
        aiResult.provider === 'openai' ? 'ai' : 'system'
      ]
    );

    await connection.execute(
      `UPDATE consultation_sessions
       SET risk_level = ?, recommended_department = ?, summary = ?, updated_at = NOW()
       WHERE id = ?`,
      [analysis.risk.level, analysis.risk.department, analysis.doctorSummary, req.params.id]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await query(
    `INSERT INTO model_call_logs (session_id, provider, model_name, capability, latency_ms, success, error_message)
     VALUES (?, ?, ?, 'llm', ?, ?, ?)`,
    [req.params.id, aiResult.provider, aiResult.model || 'none', Date.now() - aiStarted, aiResult.success, aiResult.error || null]
  );
  const questionProgress = await getQuestionProgress(req.params.id);
  res.status(201).json(ok({
    userMessageId: userMessage.insertId,
    messageId: assistantMessageId,
    reply: analysis.reply,
    analysis: { ...analysis, questionProgress },
    risk: analysis.risk,
    ai: {
      provider: aiResult.provider,
      model: aiResult.model,
      success: aiResult.success,
      error: aiResult.error || null
    }
  }));
}));

async function getQuestionProgress(sessionId) {
  const rows = await query(
    `SELECT status, COUNT(*) AS total
     FROM follow_up_questions WHERE session_id = ? GROUP BY status`,
    [sessionId]
  );
  const counts = Object.fromEntries(rows.map((row) => [row.status, Number(row.total)]));
  return {
    answered: counts.answered || 0,
    pending: counts.pending || 0,
    skipped: counts.skipped || 0,
    total: rows.reduce((sum, row) => sum + Number(row.total), 0)
  };
}

app.post('/api/v1/consultations/:id/messages/image', auth, upload.single('file'), asyncRoute(async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json(fail('请选择图片文件'));
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
    fs.unlink(file.path, () => {});
    return res.status(400).json({
      ...fail('仅支持 JPEG、PNG 或 WebP 图片'),
      errorCode: 'INVALID_IMAGE'
    });
  }
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
  const emergencyWords = ['胸痛', '呼吸困难', '意识障碍', '昏迷', '大出血', '严重过敏', '卒中', '中风', '自杀', '自伤'];
  const emergencyTriggers = emergencyWords.filter((word) => hasAffirmedKeyword(text, word));
  if (emergencyTriggers.length) {
    return {
      level: 'emergency',
      department: '急诊科',
      triggers: emergencyTriggers,
      recommendation: '出现紧急危险信号，建议立即拨打急救电话或前往急诊。'
    };
  }
  const highRules = [
    { label: '无法正常行走', pattern: /(无法|不能).{0,4}(行走|走路)/ },
    { label: '不能正常负重', pattern: /(无法|不能).{0,4}负重/ },
    { label: '高烧不退', pattern: /高烧.{0,4}不退/ },
    { label: '持续呕吐', pattern: /持续.{0,2}呕吐/ },
    { label: '明显畸形', pattern: /明显.{0,2}畸形/ }
  ];
  const highTriggers = highRules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
  if (highTriggers.length) {
    return {
      level: 'high',
      department: '急诊科',
      triggers: highTriggers,
      recommendation: '存在较高风险信号，建议尽快前往线下医疗机构评估。'
    };
  }
  const mediumWords = ['发热', '疼痛', '疼', '渗液', '扩散', '红肿', '红疹', '很痒', '肿胀'];
  const mediumTriggers = mediumWords.filter((word) => text.includes(word));
  if (mediumTriggers.length) {
    return {
      level: 'medium',
      department: text.includes('红疹') || text.includes('皮疹') ? '皮肤科' : '全科',
      triggers: mediumTriggers,
      recommendation: '建议补充症状信息并考虑线下就医评估。'
    };
  }
  return {
    level: 'low',
    department: '全科',
    triggers: ['未发现明确危险关键词'],
    recommendation: '建议继续观察，若症状加重或持续不缓解，请及时就医。'
  };
}

function hasAffirmedKeyword(text, keyword) {
  let index = text.indexOf(keyword);
  while (index >= 0) {
    const prefix = text.slice(Math.max(0, index - 6), index);
    if (!/(没有|无|未见|并无|否认|不伴|未出现|不存在)\s*$/.test(prefix)) {
      return true;
    }
    index = text.indexOf(keyword, index + keyword.length);
  }
  return false;
}

async function buildAssistantReply({ sessionId, userId, content, risk, pendingQuestions = [] }) {
  const providerKey = aiProvider === 'deepseek' ? deepseekApiKey : openaiApiKey;
  if (!providerKey) {
    return {
      provider: 'local-rule-fallback',
      model: null,
      success: true,
      analysis: buildLocalConsultationAnalysis(content, risk, undefined, pendingQuestions)
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
      '只输出一个合法 JSON 对象，不要使用 Markdown 代码块。',
      'JSON 字段必须包含 reply, symptoms, followUpQuestions, risk, recommendations, doctorSummary。',
      'symptoms 每项包含 name, bodyPart, onset, duration, severity, frequency, confidence。',
      'severity 只能是 mild, moderate, severe, unknown；confidence 是 0 到 1。',
      'followUpQuestions 每项包含 question, field, priority，最多3项。',
      'answeredQuestionIds 是用户本次输入已经回答的待回答问题ID数组；只能从给出的待回答问题ID中选择。',
      'risk 包含 level, reasons, department, action；level 只能是 low, medium, high, emergency。',
      '如果出现胸痛、呼吸困难、意识障碍、大出血、严重过敏、疑似卒中等危险信号，必须明确建议立即急诊或拨打急救电话。',
      '不要编造检查结果，不要给出处方剂量，不要说“你就是某某病”。',
      '',
      `当前规则风险等级：${risk.level}`,
      `规则建议：${risk.recommendation}`,
      `健康档案：${JSON.stringify(toCamel(profile) || {})}`,
      `最近对话：${JSON.stringify(history.reverse().map(toCamel))}`,
      `当前待回答问题：${JSON.stringify(pendingQuestions)}`,
      `用户最新描述：${content}`
    ].join('\n');

    const response = aiProvider === 'deepseek'
      ? await fetch(`${deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${deepseekApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: deepseekModel,
          messages: [
            { role: 'system', content: '你是健康问诊辅助系统，必须严格输出合法JSON。' },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 1200
        })
      })
      : await fetch('https://api.openai.com/v1/responses', {
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
      throw new Error(data.error?.message || `${aiProvider} request failed: ${response.status}`);
    }
    const text = aiProvider === 'deepseek'
      ? String(data.choices?.[0]?.message?.content || '').trim()
      : extractResponseText(data);
    const analysis = parseJsonObject(text);
    if (!analysis.reply || !analysis.risk) {
      throw new Error('AI output is not valid structured consultation JSON');
    }
    return {
      provider: aiProvider,
      model: aiProvider === 'deepseek' ? deepseekModel : openaiModel,
      success: true,
      analysis
    };
  } catch (error) {
    return {
      provider: aiProvider,
      model: aiProvider === 'deepseek' ? deepseekModel : openaiModel,
      success: false,
      error: error.message,
      analysis: buildLocalConsultationAnalysis(content, risk, 'AI调用失败，已使用本地结构化规则。', pendingQuestions)
    };
  }
}

function getAiStatus() {
  if (aiProvider === 'deepseek' && deepseekApiKey) {
    return {
      provider: 'deepseek',
      model: deepseekModel,
      realAiEnabled: true,
      textEnabled: true,
      visionEnabled: Boolean(openaiApiKey)
    };
  }
  if (aiProvider === 'openai' && openaiApiKey) {
    return {
      provider: 'openai',
      model: openaiModel,
      realAiEnabled: true,
      textEnabled: true,
      visionEnabled: true
    };
  }
  return {
    provider: 'local-rule-fallback',
    model: null,
    realAiEnabled: false,
    textEnabled: false,
    visionEnabled: false
  };
}

function buildLocalConsultationAnalysis(
  content,
  risk,
  prefix = '当前未配置所选AI服务的API密钥，以下为本地结构化规则结果。',
  pendingQuestions = []
) {
  const symptom = inferSymptom(content);
  const answeredQuestionIds = inferAnsweredQuestionIds(content, pendingQuestions);
  const questions = [];
  if (!/[0-9一二两三四五六七八九十半]+\s*(分钟|小时|天|周|月|年)/.test(content)) {
    questions.push({ question: '症状持续多长时间了？', field: 'duration', priority: 1 });
  }
  if (!/(轻微|轻度|明显|严重|剧烈|[0-9一二三四五六七八九十]分)/.test(content)) {
    questions.push({ question: '症状程度如何，是否影响睡眠、行走或日常活动？', field: 'severity', priority: 2 });
  }
  if (!/(发热|发烧|呼吸困难|出血|渗液|肿胀|无发热|没有发热)/.test(content)) {
    questions.push({ question: '是否伴有发热、肿胀、出血、渗液或呼吸困难？', field: 'red_flags', priority: 3 });
  }
  return {
    reply: `${prefix}${risk.recommendation} 本系统仅提供健康咨询辅助，不能替代医生诊断。`,
    answeredQuestionIds,
    symptoms: [symptom],
    followUpQuestions: questions.slice(0, 3),
    risk: {
      level: risk.level,
      reasons: risk.triggers || [symptom.name],
      department: risk.department,
      action: risk.recommendation
    },
    recommendations: risk.level === 'emergency'
      ? ['停止等待线上回复，立即联系急救服务或前往急诊']
      : ['记录症状变化', '避免诱发或加重症状的活动', risk.recommendation],
    doctorSummary: `用户描述：${content}。规则风险等级：${risk.level}，建议科室：${risk.department}。`
  };
}

function inferAnsweredQuestionIds(content, pendingQuestions) {
  const fieldPatterns = {
    duration: /[0-9一二两三四五六七八九十半]+\s*(分钟|小时|天|周|月|年)/,
    severity: /(轻微|轻度|明显|严重|剧烈|不影响|影响|无法|不能|[0-9一二三四五六七八九十]分)/,
    red_flags: /(发热|发烧|呼吸困难|出血|渗液|肿胀|没有|无|否认|不伴)/
  };
  return pendingQuestions
    .filter((question) => fieldPatterns[question.targetField]?.test(content))
    .map((question) => Number(question.id));
}

function inferSymptom(content) {
  const symptomRules = [
    ['红疹', '皮疹'],
    ['瘙痒', '瘙痒'],
    ['痒', '瘙痒'],
    ['疼痛', '疼痛'],
    ['疼', '疼痛'],
    ['发热', '发热'],
    ['发烧', '发热'],
    ['咳嗽', '咳嗽'],
    ['头晕', '头晕'],
    ['恶心', '恶心'],
    ['腹泻', '腹泻'],
    ['胸闷', '胸闷'],
    ['呼吸困难', '呼吸困难']
  ];
  const bodyParts = ['头', '眼', '耳', '鼻', '咽', '喉', '胸', '腹', '腰', '背', '手', '手臂', '大腿', '小腿', '脚', '皮肤'];
  const symptomName = symptomRules.find(([keyword]) => content.includes(keyword))?.[1] || '身体不适';
  const bodyPart = bodyParts.find((item) => content.includes(item)) || null;
  const duration = content.match(/[0-9一二两三四五六七八九十半]+\s*(?:分钟|小时|天|周|月|年)/)?.[0] || null;
  const severe = /(严重|剧烈|无法|不能|大出血)/.test(content);
  const moderate = /(明显|加重|影响|很痒|很疼)/.test(content);
  return {
    name: symptomName,
    bodyPart,
    onset: /(运动后|饭后|睡醒后|用药后|接触后)/.exec(content)?.[0] || null,
    duration,
    severity: severe ? 'severe' : moderate ? 'moderate' : 'unknown',
    frequency: /(持续|反复|偶尔|间歇)/.exec(content)?.[0] || null,
    confidence: symptomName === '身体不适' ? 0.45 : 0.75
  };
}

function normalizeConsultationAnalysis(raw, content, ruleRisk, pendingQuestions = []) {
  const fallback = buildLocalConsultationAnalysis(content, ruleRisk, undefined, pendingQuestions);
  const riskOrder = { low: 0, medium: 1, high: 2, emergency: 3 };
  const aiRiskLevel = Object.hasOwn(riskOrder, raw?.risk?.level) ? raw.risk.level : 'low';
  const finalRiskLevel = riskOrder[ruleRisk.level] >= riskOrder[aiRiskLevel] ? ruleRisk.level : aiRiskLevel;
  const symptoms = Array.isArray(raw?.symptoms) && raw.symptoms.length ? raw.symptoms : fallback.symptoms;
  const questions = Array.isArray(raw?.followUpQuestions) ? raw.followUpQuestions : fallback.followUpQuestions;
  const validPendingIds = new Set(pendingQuestions.map((item) => Number(item.id)));
  return {
    reply: String(raw?.reply || fallback.reply),
    answeredQuestionIds: (Array.isArray(raw?.answeredQuestionIds)
      ? raw.answeredQuestionIds
      : fallback.answeredQuestionIds
    ).map(Number).filter((id) => validPendingIds.has(id)),
    symptoms: symptoms.slice(0, 10).map((item) => ({
      name: String(item.name || '身体不适').slice(0, 100),
      bodyPart: item.bodyPart ? String(item.bodyPart).slice(0, 100) : null,
      onset: item.onset ? String(item.onset).slice(0, 100) : null,
      duration: item.duration ? String(item.duration).slice(0, 100) : null,
      severity: ['mild', 'moderate', 'severe', 'unknown'].includes(item.severity) ? item.severity : 'unknown',
      frequency: item.frequency ? String(item.frequency).slice(0, 100) : null,
      confidence: clampNumber(item.confidence, 0.5)
    })),
    followUpQuestions: questions.slice(0, 3).map((item, index) => ({
      question: String(item.question || item).slice(0, 500),
      field: item.field ? String(item.field).slice(0, 100) : null,
      priority: Math.max(1, Math.min(9, Number(item.priority) || index + 1))
    })),
    risk: {
      level: finalRiskLevel,
      reasons: finalRiskLevel === ruleRisk.level
        ? (ruleRisk.triggers || raw?.risk?.reasons || fallback.risk.reasons)
        : (raw?.risk?.reasons || fallback.risk.reasons),
      department: finalRiskLevel === ruleRisk.level
        ? ruleRisk.department
        : String(raw?.risk?.department || fallback.risk.department),
      action: finalRiskLevel === ruleRisk.level
        ? ruleRisk.recommendation
        : String(raw?.risk?.action || fallback.risk.action)
    },
    recommendations: Array.isArray(raw?.recommendations) && raw.recommendations.length
      ? raw.recommendations.slice(0, 6).map(String)
      : fallback.recommendations,
    doctorSummary: String(raw?.doctorSummary || fallback.doctorSummary)
  };
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
    const unsupported = aiProvider === 'deepseek';
    return {
      provider: unsupported ? 'deepseek' : 'local-rule-fallback',
      model: null,
      success: false,
      errorCode: unsupported ? 'UNSUPPORTED' : 'NOT_CONFIGURED',
      userMessage: unsupported
        ? '图片已上传，但当前 DeepSeek 文本模型不支持图片分析。请用文字补充图片中的部位、颜色、大小和变化情况。'
        : '图片已上传，但尚未配置支持图片分析的AI服务。请补充文字描述后继续问诊。',
      imageCategory: 'unknown',
      qualityScore: 0.5,
      findings: unsupported
        ? '当前 DeepSeek 文本模型未执行图片内容分析。'
        : '当前未配置视觉模型，未执行图片内容分析。',
      confidence: 0,
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
      errorCode: null,
      userMessage: '图片分析完成。',
      imageCategory: normalizeImageCategory(parsed.imageCategory),
      qualityScore: clampNumber(parsed.qualityScore, 0.75),
      findings: parsed.findings || text || 'AI 已分析图片，但未返回明确发现。',
      confidence: clampNumber(parsed.confidence, 0.65),
      safetyNote: parsed.safetyNote || '图片分析仅作辅助，不能替代医生面诊。'
    };
  } catch (error) {
    const networkError = error.name === 'TypeError' || /fetch|network|timeout|ECONN|ENOTFOUND/i.test(error.message);
    return {
      provider: 'openai',
      model: openaiModel,
      success: false,
      error: error.message,
      errorCode: networkError ? 'NETWORK_ERROR' : 'MODEL_ERROR',
      userMessage: networkError
        ? '图片分析服务暂时无法连接，请稍后重试。图片已经保存，无需重复上传。'
        : '图片分析服务处理失败，请稍后重试或改用文字描述。',
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

function parseJsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
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
