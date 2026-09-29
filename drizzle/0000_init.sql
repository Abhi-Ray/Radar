CREATE TABLE `accuracy_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`logic_versions_json` json NOT NULL,
	`results_json` json NOT NULL,
	`sample_count` int NOT NULL,
	`blocked` boolean NOT NULL DEFAULT false,
	`blocked_reasons_json` json,
	`compared_to_run_id` bigint unsigned,
	`trigger` varchar(32),
	`duration_ms` int,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `accuracy_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `golden_samples` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`job_id` bigint unsigned,
	`snapshot_json` json NOT NULL,
	`labels_json` json NOT NULL,
	`source_key` varchar(191),
	`country_iso2` char(2),
	`labeled_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`notes` text,
	`origin` enum('manual','correction','spot_check') NOT NULL DEFAULT 'manual',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `golden_samples_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `spot_checks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`job_id` bigint unsigned,
	`source_id` bigint unsigned,
	`field` varchar(64) NOT NULL,
	`was_correct` boolean NOT NULL,
	`error_type` varchar(64),
	`note` text,
	`batch_key` varchar(32),
	`checked_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`golden_sample_id` bigint unsigned,
	CONSTRAINT `spot_checks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_cache` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`cache_key` char(64) NOT NULL,
	`content_hash` char(64) NOT NULL,
	`task` varchar(64) NOT NULL,
	`prompt_version` varchar(64) NOT NULL,
	`model` varchar(128),
	`response_json` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ai_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_cache_key_uq` UNIQUE(`cache_key`)
);
--> statement-breakpoint
CREATE TABLE `ai_calls` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`task` varchar(64) NOT NULL,
	`model` varchar(128) NOT NULL,
	`prompt_version` varchar(64) NOT NULL,
	`job_ids_json` json,
	`status` enum('ok','invalid','error','budget') NOT NULL,
	`latency_ms` int,
	`tokens_in` int,
	`tokens_out` int,
	`rejected_count` int,
	`error` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ai_calls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_queue` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`job_id` bigint unsigned NOT NULL,
	`task` varchar(64) NOT NULL,
	`priority` smallint NOT NULL DEFAULT 0,
	`status` enum('queued','done','skipped','failed') NOT NULL DEFAULT 'queued',
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`done_at` datetime(3),
	CONSTRAINT `ai_queue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`day` date NOT NULL,
	`calls_used` int NOT NULL DEFAULT 0,
	`calls_limit` int NOT NULL,
	`remote_used` int,
	`synced_at` datetime(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ai_usage_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_usage_day_uq` UNIQUE(`day`)
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` varchar(64) NOT NULL,
	`severity` enum('info','warn','critical') NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text,
	`entity_type` varchar(64),
	`entity_id` varchar(128),
	`dedupe_key` varchar(191),
	`occurrences` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_raised_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`acknowledged_at` datetime(3),
	`sent_channels_json` json,
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`actor` varchar(64) NOT NULL DEFAULT 'admin',
	`action` varchar(96) NOT NULL,
	`entity_type` varchar(64) NOT NULL,
	`entity_id` varchar(128),
	`before_json` json,
	`after_json` json,
	`reason` text,
	`ip` varchar(64),
	`at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backup_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` enum('backup','restore_test') NOT NULL,
	`status` enum('running','ok','failed') NOT NULL DEFAULT 'running',
	`started_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`finished_at` datetime(3),
	`size_bytes` bigint unsigned,
	`sha256` char(64),
	`details_json` json,
	`error` text,
	CONSTRAINT `backup_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`ip` varchar(64) NOT NULL,
	`outcome` enum('success','bad_credentials','locked','lockout','invalid') NOT NULL,
	`success` boolean NOT NULL DEFAULT false,
	`user_agent` varchar(512),
	`locked_until` datetime(3),
	`lockout_level` int,
	`at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `login_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`sid_hash` char(64) NOT NULL,
	`email` varchar(254) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_seen_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`renewed_at` datetime(3),
	`ip` varchar(64),
	`user_agent` varchar(512),
	`revoked_at` datetime(3),
	`revoked_reason` varchar(64),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_sid_hash_uq` UNIQUE(`sid_hash`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(64) NOT NULL,
	`value_json` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`normalized_name` varchar(191) NOT NULL,
	`domain` varchar(191),
	`hq_country` char(2),
	`size_band` varchar(32),
	`type` enum('startup','scaleup','midsize','mnc','agency','unknown') NOT NULL DEFAULT 'unknown',
	`is_agency` boolean NOT NULL DEFAULT false,
	`parent_company_id` bigint unsigned,
	`merged_into_id` bigint unsigned,
	`notes` text,
	`sponsor_summary_json` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `companies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `company_aliases` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`company_id` bigint unsigned NOT NULL,
	`alias` varchar(255) NOT NULL,
	`normalized_alias` varchar(191) NOT NULL,
	`kind` enum('brand','legal','ats_slug','other') NOT NULL DEFAULT 'other',
	`country_iso2` char(2),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `company_aliases_id` PRIMARY KEY(`id`),
	CONSTRAINT `company_aliases_company_alias_kind_uq` UNIQUE(`company_id`,`normalized_alias`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `company_evidence` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`company_id` bigint unsigned NOT NULL,
	`kind` enum('register_match','posting_history','manual_note','ai') NOT NULL,
	`value_json` json,
	`evidence` text,
	`source` varchar(512) NOT NULL,
	`method` enum('manual','official','posting','rule','ai','estimate') NOT NULL,
	`confidence` enum('high','medium','low') NOT NULL,
	`match_status` enum('confirmed','possible','rejected') NOT NULL DEFAULT 'possible',
	`register_entry_id` bigint unsigned,
	`checked_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`logic_version` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `company_evidence_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sponsor_register_entries` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`register_key` varchar(64) NOT NULL,
	`country_iso2` char(2) NOT NULL,
	`org_name` varchar(512) NOT NULL,
	`normalized_name` varchar(191) NOT NULL,
	`town` varchar(128),
	`route` varchar(191),
	`rating` varchar(64),
	`raw_json` json,
	`entry_hash` char(64) NOT NULL,
	`imported_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`register_version` varchar(32) NOT NULL,
	CONSTRAINT `sponsor_register_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `sponsor_register_version_entry_uq` UNIQUE(`register_key`,`register_version`,`entry_hash`)
);
--> statement-breakpoint
CREATE TABLE `countries` (
	`iso2` char(2) NOT NULL,
	`name` varchar(100) NOT NULL,
	`tier` tinyint unsigned NOT NULL,
	`region` varchar(64),
	`currency` varchar(3),
	`is_live` boolean NOT NULL DEFAULT false,
	`languages_json` json,
	`notes` text,
	`salary_ranges_json` json,
	`best_sites_json` json,
	`cv_conventions_json` json,
	`language_notes` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `countries_iso2` PRIMARY KEY(`iso2`)
);
--> statement-breakpoint
CREATE TABLE `official_page_watches` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`url` varchar(2048) NOT NULL,
	`url_hash` char(64) NOT NULL,
	`route_id` bigint unsigned,
	`last_hash` char(64),
	`last_checked_at` datetime(3),
	`changed_at` datetime(3),
	`status` enum('unchecked','ok','changed','error') NOT NULL DEFAULT 'unchecked',
	`last_error` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `official_page_watches_id` PRIMARY KEY(`id`),
	CONSTRAINT `official_page_watches_url_uq` UNIQUE(`url_hash`)
);
--> statement-breakpoint
CREATE TABLE `visa_routes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`country_iso2` char(2) NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`official_url` varchar(2048),
	`is_active` boolean NOT NULL DEFAULT true,
	`notes` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `visa_routes_id` PRIMARY KEY(`id`),
	CONSTRAINT `visa_routes_country_code_uq` UNIQUE(`country_iso2`,`code`)
);
--> statement-breakpoint
CREATE TABLE `visa_rule_changes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`route_id` bigint unsigned NOT NULL,
	`rule_version_id` bigint unsigned,
	`change_kind` varchar(32) NOT NULL,
	`what` text NOT NULL,
	`why` text,
	`source_url` varchar(2048),
	`before_json` json,
	`after_json` json,
	`actor` varchar(64) NOT NULL DEFAULT 'admin',
	`changed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `visa_rule_changes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `visa_rule_versions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`route_id` bigint unsigned NOT NULL,
	`version` int NOT NULL,
	`effective_from` date,
	`effective_to` date,
	`salary_threshold_eur` int unsigned,
	`salary_threshold_local` int unsigned,
	`currency` varchar(3),
	`degree_rule` text,
	`experience_rule` text,
	`other_rules_json` json,
	`rule_text` text,
	`official_source_url` varchar(2048),
	`verification_status` enum('unverified','verified') NOT NULL DEFAULT 'unverified',
	`last_verified_at` datetime(3),
	`next_review_at` datetime(3),
	`verified_by` varchar(64),
	`change_reason` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `visa_rule_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `visa_rule_versions_route_version_uq` UNIQUE(`route_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `corrections` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`job_id` bigint unsigned,
	`field` varchar(64) NOT NULL,
	`wrong_value_json` json,
	`correct_value_json` json,
	`note` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`added_to_golden` boolean NOT NULL DEFAULT false,
	`golden_sample_id` bigint unsigned,
	CONSTRAINT `corrections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `duplicate_candidates` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`job_a` bigint unsigned NOT NULL,
	`job_b` bigint unsigned NOT NULL,
	`score` double NOT NULL,
	`reasons_json` json,
	`status` enum('open','merged','split','dismissed') NOT NULL DEFAULT 'open',
	`decided_at` datetime(3),
	`decided_reason` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `duplicate_candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `duplicate_candidates_pair_uq` UNIQUE(`job_a`,`job_b`)
);
--> statement-breakpoint
CREATE TABLE `job_changes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`job_id` bigint unsigned NOT NULL,
	`field` varchar(64) NOT NULL,
	`old_value` mediumtext,
	`new_value` mediumtext,
	`changed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`run_id` bigint unsigned,
	CONSTRAINT `job_changes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_facts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`job_id` bigint unsigned NOT NULL,
	`fact_key` varchar(32) NOT NULL,
	`value_json` json NOT NULL,
	`value_hash` char(64) NOT NULL,
	`evidence` text,
	`source` varchar(512) NOT NULL,
	`method` enum('manual','official','posting','rule','ai','estimate') NOT NULL,
	`confidence` enum('high','medium','low') NOT NULL,
	`checked_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`logic_version` varchar(64) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `job_facts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_overrides` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`job_id` bigint unsigned NOT NULL,
	`field` varchar(64) NOT NULL,
	`value_json` json NOT NULL,
	`reason` text NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`active` boolean NOT NULL DEFAULT true,
	`deactivated_at` datetime(3),
	CONSTRAINT `job_overrides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_scores` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`job_id` bigint unsigned NOT NULL,
	`score` tinyint unsigned NOT NULL,
	`components_json` json NOT NULL,
	`score_version` varchar(64) NOT NULL,
	`inputs_hash` char(64),
	`computed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`is_current` boolean NOT NULL DEFAULT true,
	CONSTRAINT `job_scores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_sources` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`job_id` bigint unsigned NOT NULL,
	`source_id` bigint unsigned NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`grade` enum('A','B','C','D') NOT NULL,
	`first_seen_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_seen_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`raw_snapshot_id` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `job_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `job_sources_source_external_uq` UNIQUE(`source_id`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`company_id` bigint unsigned NOT NULL,
	`canonical_title` varchar(255) NOT NULL,
	`title_raw` varchar(512) NOT NULL,
	`role_key` varchar(64),
	`role_family` enum('primary','secondary','fallback','other') NOT NULL DEFAULT 'other',
	`country_iso2` char(2),
	`city` varchar(128),
	`region` varchar(128),
	`location_raw` varchar(512) NOT NULL DEFAULT '',
	`workplace_type` enum('onsite','hybrid','remote'),
	`description_html_sanitized` mediumtext,
	`description_text` mediumtext NOT NULL,
	`description_hash` char(64) NOT NULL,
	`apply_url` varchar(2048) NOT NULL,
	`apply_url_clean` varchar(2048) NOT NULL,
	`apply_url_hash` char(64) NOT NULL,
	`best_source_id` bigint unsigned,
	`posted_at` datetime(3),
	`closing_at` datetime(3),
	`first_seen_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_seen_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_confirmed_live_at` datetime(3),
	`state` enum('new','active','updated','stale','closed','expired','suspicious') NOT NULL DEFAULT 'new',
	`missing_run_count` int NOT NULL DEFAULT 0,
	`ghost_risk` boolean NOT NULL DEFAULT false,
	`repost_count` int NOT NULL DEFAULT 0,
	`link_status` enum('ok','dead','unknown','redirected') NOT NULL DEFAULT 'unknown',
	`link_checked_at` datetime(3),
	`needs_review` boolean NOT NULL DEFAULT false,
	`hidden` boolean NOT NULL DEFAULT false,
	`hidden_reason` varchar(255),
	`saved` boolean NOT NULL DEFAULT false,
	`lang` varchar(8),
	`content_version` int NOT NULL DEFAULT 1,
	`merged_into_job_id` bigint unsigned,
	`visa_status` enum('confirmed','likely','unknown','not_offered','conflicting'),
	`visa_confidence` enum('high','medium','low'),
	`remote_class` enum('worldwide','region_limited','timezone_limited','unclear','not_remote'),
	`language_requirement` enum('english_ok','local_required','unclear'),
	`experience_band` enum('core','show','hide','unknown'),
	`experience_min_years` tinyint unsigned,
	`seniority` enum('junior','mid','senior','lead','principal'),
	`eligibility` enum('meets','borderline','doesnt_meet','cant_tell'),
	`salary_eur_min` int unsigned,
	`salary_eur_max` int unsigned,
	`salary_kind` enum('stated','estimated'),
	`facts_confidence` enum('high','medium','low'),
	`score` tinyint unsigned,
	`score_version` varchar(64),
	`resolved_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `link_checks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`job_id` bigint unsigned NOT NULL,
	`url` varchar(2048) NOT NULL,
	`status_code` smallint unsigned,
	`final_url` varchar(2048),
	`ok` boolean NOT NULL,
	`duration_ms` int,
	`checked_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`error` text,
	CONSTRAINT `link_checks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `title_review_queue` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`title_raw` varchar(512) NOT NULL,
	`normalized` varchar(191) NOT NULL,
	`count` int NOT NULL DEFAULT 1,
	`lang` varchar(8),
	`sample_job_id` bigint unsigned,
	`first_seen` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_seen` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`status` enum('open','mapped','ignored') NOT NULL DEFAULT 'open',
	`mapped_role_key` varchar(64),
	`decided_at` datetime(3),
	CONSTRAINT `title_review_queue_id` PRIMARY KEY(`id`),
	CONSTRAINT `title_review_normalized_uq` UNIQUE(`normalized`)
);
--> statement-breakpoint
CREATE TABLE `dead_letters` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_id` bigint unsigned,
	`run_id` bigint unsigned,
	`raw_snapshot_id` bigint unsigned,
	`external_id` varchar(255),
	`stage` enum('parse','validate','normalize','enrich') NOT NULL,
	`error` text NOT NULL,
	`payload_excerpt` text,
	`status` enum('open','retried','resolved','ignored') NOT NULL DEFAULT 'open',
	`retry_count` int NOT NULL DEFAULT 0,
	`parser_version` varchar(64),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`resolved_at` datetime(3),
	CONSTRAINT `dead_letters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pipeline_lock` (
	`name` varchar(64) NOT NULL,
	`owner` varchar(128),
	`run_id` bigint unsigned,
	`acquired_at` datetime(3),
	`heartbeat_at` datetime(3),
	`expires_at` datetime(3),
	CONSTRAINT `pipeline_lock_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` enum('daily','manual','reprocess','dry_run','linkcheck') NOT NULL,
	`status` enum('queued','running','ok','partial','failed','skipped') NOT NULL DEFAULT 'queued',
	`requested_by` varchar(32) NOT NULL,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`lock_owner` varchar(128),
	`stats_json` json,
	`logic_versions_json` json,
	`dry_run` boolean NOT NULL DEFAULT false,
	`error` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `pipeline_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `raw_snapshots` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_id` bigint unsigned NOT NULL,
	`run_id` bigint unsigned,
	`external_id` varchar(255) NOT NULL,
	`content_hash` char(64) NOT NULL,
	`payload` longtext NOT NULL,
	`url` varchar(2048),
	`fetched_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`parser_version` varchar(64) NOT NULL,
	`retained` boolean NOT NULL DEFAULT false,
	CONSTRAINT `raw_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `raw_snapshots_source_ext_hash_uq` UNIQUE(`source_id`,`external_id`,`content_hash`)
);
--> statement-breakpoint
CREATE TABLE `source_platforms` (
	`key` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`grade` enum('A','B','C','D') NOT NULL,
	`access_method` varchar(64) NOT NULL,
	`terms_url` varchar(2048),
	`terms_status` enum('allowed','restricted','unknown','forbidden') NOT NULL DEFAULT 'unknown',
	`terms_reviewed_at` datetime(3),
	`terms_notes` text,
	`rate_limit_per_min` int NOT NULL DEFAULT 30,
	`daily_cap` int NOT NULL DEFAULT 1000,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `source_platforms_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `source_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`run_id` bigint unsigned NOT NULL,
	`source_id` bigint unsigned NOT NULL,
	`status` enum('running','ok','failed','partial','skipped') NOT NULL DEFAULT 'running',
	`fetched` int NOT NULL DEFAULT 0,
	`parsed` int NOT NULL DEFAULT 0,
	`new_count` int NOT NULL DEFAULT 0,
	`updated_count` int NOT NULL DEFAULT 0,
	`closed_count` int NOT NULL DEFAULT 0,
	`failed_parse` int NOT NULL DEFAULT 0,
	`duration_ms` int,
	`error` text,
	`health_flags_json` json,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `source_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `source_runs_run_source_uq` UNIQUE(`run_id`,`source_id`)
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_key` varchar(191) NOT NULL,
	`platform_key` varchar(64) NOT NULL,
	`config_json` json NOT NULL,
	`label` varchar(191) NOT NULL,
	`country_iso2` char(2),
	`company_id` bigint unsigned,
	`status` enum('draft','trial','live','paused','disabled') NOT NULL DEFAULT 'draft',
	`checklist_json` json,
	`baseline_json` json,
	`consecutive_failures` int NOT NULL DEFAULT 0,
	`circuit_open_until` datetime(3),
	`last_run_at` datetime(3),
	`last_success_at` datetime(3),
	`notes` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `sources_source_key_uq` UNIQUE(`source_key`)
);
--> statement-breakpoint
CREATE TABLE `application_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`application_id` bigint unsigned NOT NULL,
	`kind` enum('stage_change','comment','follow_up_set','edit','snapshot') NOT NULL,
	`stage_from` enum('saved','applied','screening','technical','final','offer','accepted','rejected','withdrawn','no_response'),
	`stage_to` enum('saved','applied','screening','technical','final','offer','accepted','rejected','withdrawn','no_response'),
	`body` text,
	`meta_json` json,
	`occurred_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `application_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `application_snapshots` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`application_id` bigint unsigned NOT NULL,
	`job_json` json NOT NULL,
	`description_html_sanitized` mediumtext,
	`requirements_text` mediumtext,
	`apply_url` varchar(2048),
	`salary_json` json,
	`captured_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `application_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `applications` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`job_id` bigint unsigned,
	`company_name` varchar(255) NOT NULL,
	`title` varchar(512) NOT NULL,
	`country_iso2` char(2),
	`current_stage` enum('saved','applied','screening','technical','final','offer','accepted','rejected','withdrawn','no_response') NOT NULL DEFAULT 'saved',
	`resume_version_id` bigint unsigned,
	`applied_at` datetime(3),
	`source` varchar(191),
	`next_follow_up_at` datetime(3),
	`outcome` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `applications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`application_id` bigint unsigned NOT NULL,
	`due_at` datetime(3) NOT NULL,
	`note` text,
	`done_at` datetime(3),
	`notified_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `reminders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `resume_versions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(191) NOT NULL,
	`track` enum('cloud_security','devsecops','fullstack','other') NOT NULL DEFAULT 'other',
	`content_md` mediumtext NOT NULL,
	`file_note` varchar(512),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `resume_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` enum('cover_letter','outreach','checklist','cv_convention') NOT NULL,
	`name` varchar(191) NOT NULL,
	`body_md` mediumtext NOT NULL,
	`fields_json` json,
	`country_iso2` char(2),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `accuracy_runs` ADD CONSTRAINT `accuracy_runs_compared_to_run_id_accuracy_runs_id_fk` FOREIGN KEY (`compared_to_run_id`) REFERENCES `accuracy_runs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `golden_samples` ADD CONSTRAINT `golden_samples_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `spot_checks` ADD CONSTRAINT `spot_checks_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `spot_checks` ADD CONSTRAINT `spot_checks_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `spot_checks` ADD CONSTRAINT `spot_checks_golden_sample_id_golden_samples_id_fk` FOREIGN KEY (`golden_sample_id`) REFERENCES `golden_samples`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_queue` ADD CONSTRAINT `ai_queue_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `companies` ADD CONSTRAINT `companies_parent_company_id_companies_id_fk` FOREIGN KEY (`parent_company_id`) REFERENCES `companies`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `companies` ADD CONSTRAINT `companies_merged_into_id_companies_id_fk` FOREIGN KEY (`merged_into_id`) REFERENCES `companies`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `company_aliases` ADD CONSTRAINT `company_aliases_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `company_evidence` ADD CONSTRAINT `company_evidence_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `company_evidence` ADD CONSTRAINT `company_evidence_register_entry_fk` FOREIGN KEY (`register_entry_id`) REFERENCES `sponsor_register_entries`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `official_page_watches` ADD CONSTRAINT `official_page_watches_route_id_visa_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `visa_routes`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visa_routes` ADD CONSTRAINT `visa_routes_country_iso2_countries_iso2_fk` FOREIGN KEY (`country_iso2`) REFERENCES `countries`(`iso2`) ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `visa_rule_changes` ADD CONSTRAINT `visa_rule_changes_route_id_visa_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `visa_routes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visa_rule_changes` ADD CONSTRAINT `visa_rule_changes_rule_version_id_visa_rule_versions_id_fk` FOREIGN KEY (`rule_version_id`) REFERENCES `visa_rule_versions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visa_rule_versions` ADD CONSTRAINT `visa_rule_versions_route_id_visa_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `visa_routes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `corrections` ADD CONSTRAINT `corrections_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `corrections` ADD CONSTRAINT `corrections_golden_sample_id_golden_samples_id_fk` FOREIGN KEY (`golden_sample_id`) REFERENCES `golden_samples`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `duplicate_candidates` ADD CONSTRAINT `duplicate_candidates_job_a_jobs_id_fk` FOREIGN KEY (`job_a`) REFERENCES `jobs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `duplicate_candidates` ADD CONSTRAINT `duplicate_candidates_job_b_jobs_id_fk` FOREIGN KEY (`job_b`) REFERENCES `jobs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_changes` ADD CONSTRAINT `job_changes_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_changes` ADD CONSTRAINT `job_changes_run_id_pipeline_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_facts` ADD CONSTRAINT `job_facts_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_overrides` ADD CONSTRAINT `job_overrides_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_scores` ADD CONSTRAINT `job_scores_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_sources` ADD CONSTRAINT `job_sources_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_sources` ADD CONSTRAINT `job_sources_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_sources` ADD CONSTRAINT `job_sources_raw_snapshot_id_raw_snapshots_id_fk` FOREIGN KEY (`raw_snapshot_id`) REFERENCES `raw_snapshots`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_country_iso2_countries_iso2_fk` FOREIGN KEY (`country_iso2`) REFERENCES `countries`(`iso2`) ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_best_source_id_sources_id_fk` FOREIGN KEY (`best_source_id`) REFERENCES `sources`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_merged_into_job_id_jobs_id_fk` FOREIGN KEY (`merged_into_job_id`) REFERENCES `jobs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `link_checks` ADD CONSTRAINT `link_checks_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `title_review_queue` ADD CONSTRAINT `title_review_queue_sample_job_id_jobs_id_fk` FOREIGN KEY (`sample_job_id`) REFERENCES `jobs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dead_letters` ADD CONSTRAINT `dead_letters_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dead_letters` ADD CONSTRAINT `dead_letters_run_id_pipeline_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dead_letters` ADD CONSTRAINT `dead_letters_raw_snapshot_id_raw_snapshots_id_fk` FOREIGN KEY (`raw_snapshot_id`) REFERENCES `raw_snapshots`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `raw_snapshots` ADD CONSTRAINT `raw_snapshots_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `raw_snapshots` ADD CONSTRAINT `raw_snapshots_run_id_pipeline_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `source_runs` ADD CONSTRAINT `source_runs_run_id_pipeline_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `source_runs` ADD CONSTRAINT `source_runs_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sources` ADD CONSTRAINT `sources_platform_key_source_platforms_key_fk` FOREIGN KEY (`platform_key`) REFERENCES `source_platforms`(`key`) ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `sources` ADD CONSTRAINT `sources_country_iso2_countries_iso2_fk` FOREIGN KEY (`country_iso2`) REFERENCES `countries`(`iso2`) ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `sources` ADD CONSTRAINT `sources_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `application_events` ADD CONSTRAINT `application_events_application_id_applications_id_fk` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `application_snapshots` ADD CONSTRAINT `application_snapshots_application_id_applications_id_fk` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `applications` ADD CONSTRAINT `applications_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `applications` ADD CONSTRAINT `applications_country_iso2_countries_iso2_fk` FOREIGN KEY (`country_iso2`) REFERENCES `countries`(`iso2`) ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `applications` ADD CONSTRAINT `applications_resume_version_id_resume_versions_id_fk` FOREIGN KEY (`resume_version_id`) REFERENCES `resume_versions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reminders` ADD CONSTRAINT `reminders_application_id_applications_id_fk` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `templates` ADD CONSTRAINT `templates_country_iso2_countries_iso2_fk` FOREIGN KEY (`country_iso2`) REFERENCES `countries`(`iso2`) ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `accuracy_runs_created_idx` ON `accuracy_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `golden_samples_job_idx` ON `golden_samples` (`job_id`);--> statement-breakpoint
CREATE INDEX `golden_samples_origin_idx` ON `golden_samples` (`origin`);--> statement-breakpoint
CREATE INDEX `golden_samples_source_idx` ON `golden_samples` (`source_key`);--> statement-breakpoint
CREATE INDEX `spot_checks_checked_idx` ON `spot_checks` (`checked_at`);--> statement-breakpoint
CREATE INDEX `spot_checks_field_idx` ON `spot_checks` (`field`,`was_correct`);--> statement-breakpoint
CREATE INDEX `spot_checks_job_idx` ON `spot_checks` (`job_id`);--> statement-breakpoint
CREATE INDEX `ai_cache_content_idx` ON `ai_cache` (`content_hash`,`task`);--> statement-breakpoint
CREATE INDEX `ai_calls_created_idx` ON `ai_calls` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_calls_status_idx` ON `ai_calls` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_queue_status_priority_idx` ON `ai_queue` (`status`,`priority`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_queue_job_task_idx` ON `ai_queue` (`job_id`,`task`,`status`);--> statement-breakpoint
CREATE INDEX `alerts_dedupe_idx` ON `alerts` (`dedupe_key`,`acknowledged_at`);--> statement-breakpoint
CREATE INDEX `alerts_created_idx` ON `alerts` (`created_at`);--> statement-breakpoint
CREATE INDEX `alerts_ack_idx` ON `alerts` (`acknowledged_at`,`severity`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `audit_log` (`action`);--> statement-breakpoint
CREATE INDEX `backup_runs_kind_started_idx` ON `backup_runs` (`kind`,`started_at`);--> statement-breakpoint
CREATE INDEX `login_attempts_ip_at_idx` ON `login_attempts` (`ip`,`at`);--> statement-breakpoint
CREATE INDEX `login_attempts_at_idx` ON `login_attempts` (`at`);--> statement-breakpoint
CREATE INDEX `sessions_revoked_idx` ON `sessions` (`revoked_at`);--> statement-breakpoint
CREATE INDEX `companies_normalized_name_idx` ON `companies` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `companies_domain_idx` ON `companies` (`domain`);--> statement-breakpoint
CREATE INDEX `companies_merged_into_idx` ON `companies` (`merged_into_id`);--> statement-breakpoint
CREATE INDEX `company_aliases_normalized_idx` ON `company_aliases` (`normalized_alias`);--> statement-breakpoint
CREATE INDEX `company_evidence_company_kind_idx` ON `company_evidence` (`company_id`,`kind`);--> statement-breakpoint
CREATE INDEX `company_evidence_match_idx` ON `company_evidence` (`match_status`);--> statement-breakpoint
CREATE INDEX `sponsor_register_name_idx` ON `sponsor_register_entries` (`register_key`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `sponsor_register_country_name_idx` ON `sponsor_register_entries` (`country_iso2`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `countries_tier_idx` ON `countries` (`tier`);--> statement-breakpoint
CREATE INDEX `official_page_watches_status_idx` ON `official_page_watches` (`status`);--> statement-breakpoint
CREATE INDEX `visa_rule_changes_route_idx` ON `visa_rule_changes` (`route_id`,`changed_at`);--> statement-breakpoint
CREATE INDEX `visa_rule_versions_effective_idx` ON `visa_rule_versions` (`route_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `corrections_job_idx` ON `corrections` (`job_id`);--> statement-breakpoint
CREATE INDEX `corrections_field_idx` ON `corrections` (`field`,`created_at`);--> statement-breakpoint
CREATE INDEX `duplicate_candidates_status_idx` ON `duplicate_candidates` (`status`);--> statement-breakpoint
CREATE INDEX `job_changes_job_idx` ON `job_changes` (`job_id`,`changed_at`);--> statement-breakpoint
CREATE INDEX `job_facts_job_key_active_idx` ON `job_facts` (`job_id`,`fact_key`,`is_active`);--> statement-breakpoint
CREATE INDEX `job_facts_key_method_idx` ON `job_facts` (`fact_key`,`method`);--> statement-breakpoint
CREATE INDEX `job_overrides_job_field_idx` ON `job_overrides` (`job_id`,`field`,`active`);--> statement-breakpoint
CREATE INDEX `job_scores_job_current_idx` ON `job_scores` (`job_id`,`is_current`);--> statement-breakpoint
CREATE INDEX `job_scores_current_score_idx` ON `job_scores` (`is_current`,`score`);--> statement-breakpoint
CREATE INDEX `job_sources_job_idx` ON `job_sources` (`job_id`);--> statement-breakpoint
CREATE INDEX `jobs_state_country_idx` ON `jobs` (`state`,`country_iso2`);--> statement-breakpoint
CREATE INDEX `jobs_posted_idx` ON `jobs` (`posted_at`);--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`company_id`);--> statement-breakpoint
CREATE INDEX `jobs_first_seen_idx` ON `jobs` (`first_seen_at`);--> statement-breakpoint
CREATE INDEX `jobs_apply_url_hash_idx` ON `jobs` (`apply_url_hash`);--> statement-breakpoint
CREATE INDEX `jobs_description_hash_idx` ON `jobs` (`description_hash`);--> statement-breakpoint
CREATE INDEX `jobs_score_idx` ON `jobs` (`hidden`,`score`);--> statement-breakpoint
CREATE INDEX `jobs_visa_idx` ON `jobs` (`visa_status`);--> statement-breakpoint
CREATE INDEX `jobs_role_idx` ON `jobs` (`role_family`,`role_key`);--> statement-breakpoint
CREATE INDEX `jobs_merged_idx` ON `jobs` (`merged_into_job_id`);--> statement-breakpoint
CREATE INDEX `link_checks_job_idx` ON `link_checks` (`job_id`,`checked_at`);--> statement-breakpoint
CREATE INDEX `title_review_status_idx` ON `title_review_queue` (`status`,`count`);--> statement-breakpoint
CREATE INDEX `dead_letters_status_created_idx` ON `dead_letters` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `dead_letters_source_idx` ON `dead_letters` (`source_id`,`status`);--> statement-breakpoint
CREATE INDEX `pipeline_runs_status_created_idx` ON `pipeline_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `pipeline_runs_kind_created_idx` ON `pipeline_runs` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `raw_snapshots_fetched_idx` ON `raw_snapshots` (`fetched_at`);--> statement-breakpoint
CREATE INDEX `raw_snapshots_run_idx` ON `raw_snapshots` (`run_id`);--> statement-breakpoint
CREATE INDEX `source_runs_source_created_idx` ON `source_runs` (`source_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sources_platform_idx` ON `sources` (`platform_key`);--> statement-breakpoint
CREATE INDEX `sources_status_idx` ON `sources` (`status`);--> statement-breakpoint
CREATE INDEX `sources_country_idx` ON `sources` (`country_iso2`);--> statement-breakpoint
CREATE INDEX `application_events_app_idx` ON `application_events` (`application_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `application_snapshots_app_idx` ON `application_snapshots` (`application_id`);--> statement-breakpoint
CREATE INDEX `applications_stage_idx` ON `applications` (`current_stage`,`updated_at`);--> statement-breakpoint
CREATE INDEX `applications_job_idx` ON `applications` (`job_id`);--> statement-breakpoint
CREATE INDEX `applications_follow_up_idx` ON `applications` (`next_follow_up_at`);--> statement-breakpoint
CREATE INDEX `reminders_due_idx` ON `reminders` (`done_at`,`due_at`);--> statement-breakpoint
CREATE INDEX `reminders_app_idx` ON `reminders` (`application_id`);--> statement-breakpoint
CREATE INDEX `templates_kind_idx` ON `templates` (`kind`,`country_iso2`);