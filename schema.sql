-- GitHub Trending Viewer — Database Schema
-- PostgreSQL 14+
--
-- 使用说明：
--   使用 Docker Compose 部署时，首次启动会自动建表，无需手动执行此文件。
--   使用托管 PostgreSQL（Supabase、RDS 等）时，在连接数据库后执行：
--     psql $DATABASE_URL -f schema.sql

-- ─── 趋势榜单 ───────────────────────────────────────────────────────────────

-- 每次抓取的元数据（since=daily/weekly/monthly，每天每个 since 一条记录）
CREATE TABLE IF NOT EXISTS trending_records (
  id           SERIAL       PRIMARY KEY,
  since        VARCHAR(10)  NOT NULL,
  collected_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  collect_date DATE         NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (since, collect_date)
);

-- 每次抓取的仓库列表
CREATE TABLE IF NOT EXISTS trending_repos (
  id             SERIAL       PRIMARY KEY,
  record_id      INT          NOT NULL REFERENCES trending_records(id) ON DELETE CASCADE,
  rank           INT          NOT NULL,
  author         VARCHAR(255) NOT NULL,
  name           VARCHAR(255) NOT NULL,
  description    TEXT,
  description_zh TEXT,
  language       VARCHAR(100),
  stars          INT          NOT NULL DEFAULT 0,
  period_stars   INT          NOT NULL DEFAULT 0,
  forks          INT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_trending_repos_record_id ON trending_repos (record_id);

-- ─── AI 报告 ─────────────────────────────────────────────────────────────────

-- 日报 / 周报 / 月报（status: pending → done | failed）
CREATE TABLE IF NOT EXISTS analysis_reports (
  id           SERIAL      PRIMARY KEY,
  report_type  VARCHAR(10) NOT NULL,                  -- daily | weekly | monthly
  period_start DATE        NOT NULL,
  period_end   DATE        NOT NULL,
  status       VARCHAR(10) NOT NULL DEFAULT 'pending',
  retry_count  INT         NOT NULL DEFAULT 0,
  content_md   TEXT,                                  -- Markdown 正文
  stats_json   JSONB,                                 -- 统计数据快照
  error_msg    TEXT,
  generated_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_type, period_start)
);

-- ─── AI 摘要缓存 ──────────────────────────────────────────────────────────────

-- README 摘要，30 天内复用（summarized_at 用于判断缓存是否过期）
CREATE TABLE IF NOT EXISTS repo_summaries (
  id            SERIAL       PRIMARY KEY,
  owner         VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  summary       TEXT         NOT NULL,
  readme_sha    VARCHAR(64),
  summarized_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (owner, name)
);

CREATE INDEX IF NOT EXISTS idx_repo_summaries_owner_name ON repo_summaries (owner, name);

-- ─── 应用配置 KV ──────────────────────────────────────────────────────────────

-- 通用键值存储（当前用于持久化 AI 任务分配等配置）
CREATE TABLE IF NOT EXISTS app_settings (
  key        VARCHAR(255) PRIMARY KEY,
  value      JSONB        NOT NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── 个性化推荐分数 ─────────────────────────────────────────────────────────

-- AI 基于用户 Star 画像为当日 Trending 项目打分；profile_hash 变化时同日覆盖重算
CREATE TABLE IF NOT EXISTS recommendation_scores (
  id           SERIAL       PRIMARY KEY,
  owner        VARCHAR(255) NOT NULL,
  name         VARCHAR(255) NOT NULL,
  since        VARCHAR(16)  NOT NULL,
  score_date   DATE         NOT NULL,
  score        SMALLINT     NOT NULL,
  reason       TEXT,
  profile_hash VARCHAR(64),
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (owner, name, since, score_date)
);

CREATE INDEX IF NOT EXISTS idx_rec_scores_lookup
  ON recommendation_scores (since, score_date);
