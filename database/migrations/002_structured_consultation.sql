USE multimodal_health_consultation;

CREATE TABLE IF NOT EXISTS symptom_extractions (
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

CREATE TABLE IF NOT EXISTS follow_up_questions (
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

CREATE TABLE IF NOT EXISTS consultation_summaries (
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

CREATE TABLE IF NOT EXISTS doctor_reviews (
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
