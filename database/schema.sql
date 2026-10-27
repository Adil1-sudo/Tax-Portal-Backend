
CREATE DATABASE IF NOT EXISTS your_tax_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE your_tax_db;


-- 1. USERS
-- Shared login identity for administrators and clients.

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'client') NOT NULL DEFAULT 'client',
  account_status ENUM(
    'pending',
    'active',
    'rejected',
    'suspended'
  ) NOT NULL DEFAULT 'pending',
  email_verified_at DATETIME NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  rejection_reason VARCHAR(500) NULL,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_users_role_status (role, account_status),
  INDEX idx_users_created_at (created_at),

  CONSTRAINT fk_users_approved_by
    FOREIGN KEY (approved_by) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;


-- 2. CLIENT PROFILES
-- Additional details that belong only to a client account.

CREATE TABLE IF NOT EXISTS client_profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  business_name VARCHAR(200) NULL,
  phone VARCHAR(40) NULL,
  address VARCHAR(500) NULL,
  country VARCHAR(100) NULL,
  tax_reference VARCHAR(150) NULL,
  internal_notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_client_profiles_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;


-- 3. DOCUMENT REQUESTS
-- An administrator requests a specific document from a client.

CREATE TABLE IF NOT EXISTS document_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NULL,
  status ENUM(
    'pending',
    'submitted',
    'completed',
    'cancelled'
  ) NOT NULL DEFAULT 'pending',
  due_date DATE NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_document_requests_client_status (client_id, status),
  INDEX idx_document_requests_created_at (created_at),

  CONSTRAINT fk_document_requests_client
    FOREIGN KEY (client_id) REFERENCES users(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_document_requests_admin
    FOREIGN KEY (requested_by) REFERENCES users(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB;


-- 4. DOCUMENTS
-- Stores file metadata. Actual files live in protected storage.

CREATE TABLE IF NOT EXISTS documents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  request_id BIGINT UNSIGNED NULL,
  title VARCHAR(200) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(1000) NOT NULL,
  mime_type VARCHAR(150) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  document_category VARCHAR(100) NULL,
  source ENUM('client_upload', 'admin_upload') NOT NULL,
  visibility ENUM('client_and_admin', 'admin_only')
    NOT NULL DEFAULT 'client_and_admin',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_documents_client_created (client_id, created_at),
  INDEX idx_documents_request (request_id),

  CONSTRAINT fk_documents_client
    FOREIGN KEY (client_id) REFERENCES users(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_documents_uploader
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_documents_request
    FOREIGN KEY (request_id) REFERENCES document_requests(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;


-- 5. FEE REQUESTS
-- This tracks requested fees, not verified payment transactions.

CREATE TABLE IF NOT EXISTS fee_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'PKR',
  due_date DATE NULL,
  status ENUM(
    'pending',
    'paid',
    'overdue',
    'cancelled'
  ) NOT NULL DEFAULT 'pending',
  paid_at DATETIME NULL,
  payment_reference VARCHAR(200) NULL,
  internal_notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_fee_requests_client_status (client_id, status),
  INDEX idx_fee_requests_due_date (due_date),

  CONSTRAINT fk_fee_requests_client
    FOREIGN KEY (client_id) REFERENCES users(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_fee_requests_admin
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB;


-- 6. WEBSITE PAGES
-- Editable text content for About Us and Contact pages.

CREATE TABLE IF NOT EXISTS website_pages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  page_key VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(250) NOT NULL,
  description TEXT NULL,
  content LONGTEXT NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_website_pages_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;


-- 7. WEBSITE SERVICES
-- Editable service cards shown on the public Services page.

CREATE TABLE IF NOT EXISTS website_services (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_website_services_active_order (is_active, display_order),

  CONSTRAINT fk_website_services_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,

  CONSTRAINT fk_website_services_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;


-- 8. WEBSITE VALUES
-- Editable values displayed on the About Us page.

CREATE TABLE IF NOT EXISTS website_values (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_website_values_active_order (is_active, display_order),

  CONSTRAINT fk_website_values_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;


-- 9. ADMIN SETTINGS
-- Individual preferences stored as key-value records.

CREATE TABLE IF NOT EXISTS admin_settings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value TEXT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_admin_settings_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS contact_enquiries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(30) DEFAULT NULL,
  subject VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('new', 'in_progress', 'resolved', 'spam')
    NOT NULL DEFAULT 'new',
  admin_notes TEXT DEFAULT NULL,
  handled_by BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_enquiries_status_created (status, created_at),
  KEY idx_enquiries_email (email),
  CONSTRAINT fk_enquiries_handled_by
    FOREIGN KEY (handled_by) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;