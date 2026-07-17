DROP DATABASE IF EXISTS multimodal_health_consultation;
CREATE DATABASE multimodal_health_consultation
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE multimodal_health_consultation;

CREATE TABLE roles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL,
  description VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  role_id BIGINT NOT NULL,
  username VARCHAR(64) NOT NULL UNIQUE,
  phone VARCHAR(32) UNIQUE,
  email VARCHAR(128) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  status ENUM('active','disabled','locked') NOT NULL DEFAULT 'active',
  last_login_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB;

CREATE TABLE health_profiles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL UNIQUE,
  gender ENUM('male','female','other','unknown') NOT NULL DEFAULT 'unknown',
  birth_date DATE,
  height_cm DECIMAL(5,2),
  weight_kg DECIMAL(5,2),
  blood_type VARCHAR(8),
  allergy_history TEXT,
  disease_history TEXT,
  surgery_history TEXT,
  family_history TEXT,
  current_medications TEXT,
  lifestyle_notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE health_metrics (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  metric_type ENUM('blood_pressure','blood_glucose','heart_rate','temperature','weight','spo2') NOT NULL,
  value_text VARCHAR(64) NOT NULL,
  unit VARCHAR(32),
  measured_at DATETIME NOT NULL,
  note VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_metrics_user_time (user_id, measured_at),
  CONSTRAINT fk_metrics_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE consultation_sessions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  title VARCHAR(128) NOT NULL,
  status ENUM('open','closed','transferred') NOT NULL DEFAULT 'open',
  channel ENUM('text','image','voice','multimodal') NOT NULL,
  risk_level ENUM('low','medium','high','emergency') NOT NULL DEFAULT 'low',
  recommended_department VARCHAR(64),
  summary TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sessions_user_time (user_id, created_at),
  INDEX idx_sessions_risk (risk_level),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE consultation_messages (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id BIGINT NOT NULL,
  sender_type ENUM('user','assistant','doctor','system') NOT NULL,
  input_type ENUM('text','image','voice','mixed') NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  structured_json JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_messages_session_time (session_id, created_at),
  CONSTRAINT fk_messages_session FOREIGN KEY (session_id) REFERENCES consultation_sessions(id)
) ENGINE=InnoDB;

CREATE TABLE uploaded_files (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  session_id BIGINT,
  file_type ENUM('image','audio','document') NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_url VARCHAR(500) NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  status ENUM('uploaded','analyzed','rejected') NOT NULL DEFAULT 'uploaded',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_files_user (user_id),
  CONSTRAINT fk_files_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_files_session FOREIGN KEY (session_id) REFERENCES consultation_sessions(id)
) ENGINE=InnoDB;

CREATE TABLE image_analysis_results (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  file_id BIGINT NOT NULL,
  image_category ENUM('skin','tongue','wound','lab_report','medical_report','medicine','unknown') NOT NULL,
  quality_score DECIMAL(4,3),
  ocr_text TEXT,
  findings TEXT,
  confidence DECIMAL(4,3),
  safety_note TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_image_results_file FOREIGN KEY (file_id) REFERENCES uploaded_files(id)
) ENGINE=InnoDB;

CREATE TABLE speech_results (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  file_id BIGINT NOT NULL,
  transcript TEXT NOT NULL,
  language VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
  confidence DECIMAL(4,3),
  duration_seconds DECIMAL(8,2),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_speech_results_file FOREIGN KEY (file_id) REFERENCES uploaded_files(id)
) ENGINE=InnoDB;

CREATE TABLE risk_assessments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id BIGINT NOT NULL,
  risk_level ENUM('low','medium','high','emergency') NOT NULL,
  triggers JSON,
  recommendation TEXT NOT NULL,
  need_offline_care BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_risk_session (session_id),
  CONSTRAINT fk_risk_session FOREIGN KEY (session_id) REFERENCES consultation_sessions(id)
) ENGINE=InnoDB;

CREATE TABLE model_call_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id BIGINT,
  provider VARCHAR(64) NOT NULL,
  model_name VARCHAR(128) NOT NULL,
  capability ENUM('llm','vision','ocr','asr','tts','safety') NOT NULL,
  latency_ms INT,
  success BOOLEAN NOT NULL,
  error_message VARCHAR(500),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_model_logs_session (session_id),
  CONSTRAINT fk_model_logs_session FOREIGN KEY (session_id) REFERENCES consultation_sessions(id)
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  actor_user_id BIGINT,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id BIGINT,
  ip_address VARCHAR(64),
  detail JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_actor_time (actor_user_id, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE symptom_extractions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  symptom_name VARCHAR(100) NOT NULL,
  body_part VARCHAR(100),
  onset_text VARCHAR(100),
  duration_text VARCHAR(100),
  severity ENUM('mild','moderate','severe','unknown') NOT NULL DEFAULT 'unknown',
  frequency_text VARCHAR(100),
  confidence DECIMAL(5,4),
  source_type ENUM('text','image','voice','fusion') NOT NULL DEFAULT 'text',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_symptom_session (session_id),
  INDEX idx_symptom_message (message_id),
  CONSTRAINT fk_symptom_session FOREIGN KEY (session_id) REFERENCES consultation_sessions(id),
  CONSTRAINT fk_symptom_message FOREIGN KEY (message_id) REFERENCES consultation_messages(id)
) ENGINE=InnoDB;

CREATE TABLE follow_up_questions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id BIGINT NOT NULL,
  source_message_id BIGINT,
  question_text VARCHAR(500) NOT NULL,
  target_field VARCHAR(100),
  priority INT NOT NULL DEFAULT 1,
  status ENUM('pending','answered','skipped') NOT NULL DEFAULT 'pending',
  answer_message_id BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at DATETIME,
  INDEX idx_question_session_status (session_id, status),
  CONSTRAINT fk_question_session FOREIGN KEY (session_id) REFERENCES consultation_sessions(id),
  CONSTRAINT fk_question_source_message FOREIGN KEY (source_message_id) REFERENCES consultation_messages(id),
  CONSTRAINT fk_question_answer_message FOREIGN KEY (answer_message_id) REFERENCES consultation_messages(id)
) ENGINE=InnoDB;

CREATE TABLE consultation_summaries (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id BIGINT NOT NULL,
  source_message_id BIGINT,
  version INT NOT NULL DEFAULT 1,
  symptom_summary TEXT,
  user_summary TEXT,
  doctor_summary TEXT,
  recommendations JSON,
  suggested_department VARCHAR(100),
  generated_by ENUM('ai','doctor','system') NOT NULL DEFAULT 'ai',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_summary_version (session_id, version),
  INDEX idx_summary_session (session_id),
  CONSTRAINT fk_summary_session FOREIGN KEY (session_id) REFERENCES consultation_sessions(id),
  CONSTRAINT fk_summary_source_message FOREIGN KEY (source_message_id) REFERENCES consultation_messages(id)
) ENGINE=InnoDB;

CREATE TABLE doctor_reviews (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id BIGINT NOT NULL,
  doctor_id BIGINT NOT NULL,
  review_status ENUM('pending','confirmed','modified','rejected') NOT NULL DEFAULT 'pending',
  risk_level ENUM('low','medium','high','emergency'),
  review_comment TEXT,
  reviewed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_review_doctor_status (doctor_id, review_status),
  INDEX idx_review_session (session_id),
  CONSTRAINT fk_review_session FOREIGN KEY (session_id) REFERENCES consultation_sessions(id),
  CONSTRAINT fk_review_doctor FOREIGN KEY (doctor_id) REFERENCES users(id)
) ENGINE=InnoDB;

INSERT INTO roles (code, name, description) VALUES
('user', '普通用户', '进行健康问诊和档案管理'),
('doctor', '医生顾问', '查看问诊并提供人工建议'),
('admin', '管理员', '管理用户、记录、安全规则和系统配置');

INSERT INTO users (role_id, username, phone, email, password_hash, display_name, last_login_at) VALUES
((SELECT id FROM roles WHERE code = 'user'), 'zhangsan', '13800000001', 'zhangsan@example.com', '$2y$demo_hash_zhangsan', '张三', '2026-07-11 09:10:00'),
((SELECT id FROM roles WHERE code = 'user'), 'lisi', '13800000002', 'lisi@example.com', '$2y$demo_hash_lisi', '李四', '2026-07-10 20:30:00'),
((SELECT id FROM roles WHERE code = 'doctor'), 'doctor_wang', '13800000003', 'wangdoctor@example.com', '$2y$demo_hash_doctor', '王医生', '2026-07-11 08:00:00'),
((SELECT id FROM roles WHERE code = 'admin'), 'admin', '13800000004', 'admin@example.com', '$2y$demo_hash_admin', '系统管理员', '2026-07-11 08:30:00');

INSERT INTO health_profiles
(user_id, gender, birth_date, height_cm, weight_kg, blood_type, allergy_history, disease_history, surgery_history, family_history, current_medications, lifestyle_notes)
VALUES
((SELECT id FROM users WHERE username = 'zhangsan'), 'male', '1990-05-12', 175.00, 72.50, 'A', '青霉素过敏', '过敏性鼻炎', '无', '父亲高血压', '氯雷他定按需使用', '偶尔熬夜，每周运动2次'),
((SELECT id FROM users WHERE username = 'lisi'), 'female', '1988-09-21', 162.00, 58.00, 'O', '无明确药物过敏', '轻度贫血', '阑尾切除术', '母亲糖尿病', '铁剂间断补充', '睡眠一般，久坐');

INSERT INTO health_metrics (user_id, metric_type, value_text, unit, measured_at, note) VALUES
((SELECT id FROM users WHERE username = 'zhangsan'), 'blood_pressure', '128/82', 'mmHg', '2026-07-11 07:30:00', '晨起测量'),
((SELECT id FROM users WHERE username = 'zhangsan'), 'heart_rate', '76', 'bpm', '2026-07-11 07:31:00', '静息心率'),
((SELECT id FROM users WHERE username = 'lisi'), 'blood_glucose', '5.6', 'mmol/L', '2026-07-10 08:00:00', '空腹血糖'),
((SELECT id FROM users WHERE username = 'lisi'), 'temperature', '37.3', 'C', '2026-07-10 20:00:00', '轻微发热');

INSERT INTO consultation_sessions (user_id, title, status, channel, risk_level, recommended_department, summary) VALUES
((SELECT id FROM users WHERE username = 'zhangsan'), '皮肤红疹瘙痒咨询', 'open', 'multimodal', 'medium', '皮肤科', '用户描述小腿红疹伴瘙痒，上传皮肤图片，既往有过敏史。'),
((SELECT id FROM users WHERE username = 'lisi'), '咽痛发热语音问诊', 'closed', 'voice', 'low', '耳鼻喉科', '用户语音描述咽痛、低热，无呼吸困难。');

INSERT INTO consultation_messages (session_id, sender_type, input_type, content, structured_json) VALUES
((SELECT id FROM consultation_sessions WHERE title = '皮肤红疹瘙痒咨询'), 'user', 'mixed', '小腿起红疹两天，很痒，晚上更明显。', JSON_OBJECT('symptom','红疹瘙痒','body_part','小腿','duration','2天','severity','中等')),
((SELECT id FROM consultation_sessions WHERE title = '皮肤红疹瘙痒咨询'), 'assistant', 'text', '结合描述和过敏史，可能与过敏、虫咬或皮炎相关。若出现发热、疼痛加重、渗液或快速扩散，请及时线下就医。', JSON_OBJECT('risk','medium','follow_up',JSON_ARRAY('是否接触新衣物或草木','是否使用新药物','是否有渗液或疼痛'))),
((SELECT id FROM consultation_sessions WHERE title = '咽痛发热语音问诊'), 'user', 'voice', '我昨晚开始喉咙痛，今天有点低烧。', JSON_OBJECT('symptom','咽痛低热','duration','1天')),
((SELECT id FROM consultation_sessions WHERE title = '咽痛发热语音问诊'), 'assistant', 'text', '目前更像上呼吸道感染早期表现。建议补充饮水、休息并观察体温；若高热不退、呼吸困难或吞咽明显困难，应尽快就医。', JSON_OBJECT('risk','low','department','耳鼻喉科'));

INSERT INTO uploaded_files (user_id, session_id, file_type, original_name, storage_url, mime_type, file_size_bytes, status) VALUES
((SELECT id FROM users WHERE username = 'zhangsan'), (SELECT id FROM consultation_sessions WHERE title = '皮肤红疹瘙痒咨询'), 'image', 'leg_rash.jpg', 'local://uploads/2026/07/leg_rash.jpg', 'image/jpeg', 482913, 'analyzed'),
((SELECT id FROM users WHERE username = 'lisi'), (SELECT id FROM consultation_sessions WHERE title = '咽痛发热语音问诊'), 'audio', 'sore_throat.m4a', 'local://uploads/2026/07/sore_throat.m4a', 'audio/mp4', 982112, 'analyzed');

INSERT INTO image_analysis_results (file_id, image_category, quality_score, ocr_text, findings, confidence, safety_note) VALUES
((SELECT id FROM uploaded_files WHERE original_name = 'leg_rash.jpg'), 'skin', 0.860, NULL, '图片可见局部片状红斑，边界不完全清晰，未见明显大面积破溃。', 0.720, '图片分析仅作辅助，不能替代医生面诊。若红肿热痛明显或快速扩散，请及时就医。');

INSERT INTO speech_results (file_id, transcript, confidence, duration_seconds) VALUES
((SELECT id FROM uploaded_files WHERE original_name = 'sore_throat.m4a'), '我昨晚开始喉咙痛，今天有点低烧。', 0.910, 8.40);

INSERT INTO risk_assessments (session_id, risk_level, triggers, recommendation, need_offline_care) VALUES
((SELECT id FROM consultation_sessions WHERE title = '皮肤红疹瘙痒咨询'), 'medium', JSON_ARRAY('皮疹持续2天','瘙痒明显','过敏史'), '建议皮肤科就诊或线上医生复核；若快速扩散、疼痛、发热或渗液，应及时线下就医。', TRUE),
((SELECT id FROM consultation_sessions WHERE title = '咽痛发热语音问诊'), 'low', JSON_ARRAY('低热','咽痛1天','无呼吸困难'), '建议观察体温、补充水分、休息；若高热持续或出现呼吸困难，及时就医。', FALSE);

INSERT INTO model_call_logs (session_id, provider, model_name, capability, latency_ms, success) VALUES
((SELECT id FROM consultation_sessions WHERE title = '皮肤红疹瘙痒咨询'), 'demo-provider', 'demo-vision-medical', 'vision', 1820, TRUE),
((SELECT id FROM consultation_sessions WHERE title = '皮肤红疹瘙痒咨询'), 'demo-provider', 'demo-health-llm', 'llm', 2450, TRUE),
((SELECT id FROM consultation_sessions WHERE title = '咽痛发热语音问诊'), 'demo-provider', 'demo-asr-medical', 'asr', 930, TRUE),
((SELECT id FROM consultation_sessions WHERE title = '咽痛发热语音问诊'), 'demo-provider', 'demo-health-llm', 'llm', 2210, TRUE);

INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, ip_address, detail) VALUES
((SELECT id FROM users WHERE username = 'zhangsan'), 'CREATE_CONSULTATION', 'consultation_session', (SELECT id FROM consultation_sessions WHERE title = '皮肤红疹瘙痒咨询'), '127.0.0.1', JSON_OBJECT('channel','multimodal')),
((SELECT id FROM users WHERE username = 'lisi'), 'CREATE_CONSULTATION', 'consultation_session', (SELECT id FROM consultation_sessions WHERE title = '咽痛发热语音问诊'), '127.0.0.1', JSON_OBJECT('channel','voice')),
((SELECT id FROM users WHERE username = 'admin'), 'VIEW_HIGH_RISK_LIST', 'admin_console', NULL, '127.0.0.1', JSON_OBJECT('filter','risk_level >= medium'));
