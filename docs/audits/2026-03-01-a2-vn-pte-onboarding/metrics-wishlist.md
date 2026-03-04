# Metrics & Instrumentation Wishlist — A2 Vietnamese PTE onboarding audit

**Audit date**: 2026-03-01  
**Goal**: Validate onboarding + Day 0 “first value” improvements with measurable signals (not opinions).

## Principles (privacy + usefulness)
- Do **not** log raw audio, full transcripts, or long-form user writing by default.
- Prefer **counts + timings + boolean flags** over content payloads.
- Log enough context to debug: `session_id`, `uid_or_guest_id`, `mode`, `content_id`, `device_class`, `network_effective_type`, `utm_*`.

## Identity & segmentation (minimum)
- `user_type`: `guest | authed`
- `native_language`: `vi` (if user chooses)
- `self_reported_level`: `beginner | intermediate | expert`
- `exam_goal`: `pte` (if user chooses)
- `weak_skills`: e.g. `listening,speaking`

## Funnel events (critical path)

### Acquisition (Landing)
1. `landing_view`
   - Props: `utm_source`, `utm_campaign`, `utm_content`, `device_class`, `network_effective_type`
2. `landing_first_paint_seen`
   - Props: `ms_since_nav_start`
3. `landing_cta_click`
   - Props: `cta_id`, `section` (hero/journey/footer)
4. `landing_scroll_depth`
   - Props: `percent` (25/50/75/100)

**Success targets (starting point)**
- `landing_cta_click / landing_view` > 15% for ad traffic
- Median `landing_first_paint_seen` < 2000ms (mobile)

### Activation (App entry)
1. `app_load_start`
2. `preloader_shown`
   - Props: `reason` (`initial_load | timeout | tls_error_detected`), `ms_visible`
3. `preloader_bypass_clicked`
4. `app_loaded_ready`
   - Props: `ms_since_nav_start`, `boot_phase` (`core_ready | full_ready`)
5. `entry_modal_shown`
6. `entry_choice_selected`
   - Props: `choice` (`guest | login`), `ms_to_choice`

**Success targets**
- `preloader_bypass_clicked / preloader_shown` < 5% (ideally ~0%)
- `practice_start / app_loaded_ready` > 50%

### Registration & onboarding
1. `auth_overlay_opened`
   - Props: `source` (`entry_modal | save_progress_nudge | hint_gate | vocab_gate`)
2. `signup_submit`
3. `signup_error`
   - Props: `code` (`pw_mismatch | weak_pw | network | unknown`)
4. `signup_success`
5. `level_selection_shown`
6. `level_selected`
   - Props: `level`, `ms_to_select`

**Success targets**
- `signup_success / signup_submit` > 70%
- `level_selected / level_selection_shown` > 95%

## Learning loop events (Day 0)

### Mode + attempt lifecycle (applies to Type/Speak/Fill/Notes/Watch/Survival)
- `mode_switch`
  - Props: `to_mode`, `from_mode`
- `content_item_loaded`
  - Props: `mode`, `content_id`, `difficulty_level`, `sentence_len`
- `practice_start`
  - Props: `mode`, `content_id`
- `audio_play`
  - Props: `mode`, `content_id`, `source` (`auto | user`)
- `audio_replay`
  - Props: `replay_index`, `replay_budget_remaining`
- `hint_opened`
  - Props: `hint_type`
- `hint_used`
  - Props: `hint_type`, `coin_cost`, `was_guest`
- `hint_blocked`
  - Props: `reason` (`login_required | insufficient_coins | locked_skill`)
- `attempt_submitted`
  - Props: `mode`, `content_id`, `attempt_ms`
- `attempt_scored`
  - Props: `accuracy`, `assist_count`, `reward_xp`, `reward_coins`, `calibration_multiplier`
- `attempt_error`
  - Props: `stage` (`submit | score | firestore_write`), `code`

**Day 0 success targets**
- `attempt_scored / practice_start` > 85%
- Median `ms(app_loaded_ready → practice_start)` < 15s (mobile)

### Vocab capture (retention hook)
- `missed_words_shown`
  - Props: `count`, `mode`, `was_guest`
- `vocab_add_modal_shown`
  - Props: `count_suggested`
- `vocab_words_added`
  - Props: `count_added`, `source` (`missed_words | manual_add | bookmark`)
- `vocab_panel_opened`
  - Props: `tab` (`bookmarks | frequently_missed`)

**Targets**
- `vocab_words_added / attempt_scored` > 20% (Day 0)

### SRS loop (habit engine)
- `srs_opened`
  - Props: `due_count`, `algo` (`sm2 | fsrs`)
- `srs_session_started`
  - Props: `forced` (boolean), `due_count_at_start`
- `srs_card_shown`
  - Props: `lemma`, `has_vietnamese` (boolean)
- `srs_card_flipped`
- `srs_rating_selected`
  - Props: `rating` (`again|hard|good|easy`), `interval_next_days`
- `srs_session_completed`
  - Props: `cards_reviewed`, `cards_correct`, `session_ms`
- `srs_empty_state_shown`
  - Props: `reason` (`no_vocab | none_due | guest_blocked`)

**Targets**
- `srs_session_started / vocab_words_added` > 40% (Day 0)
- `srs_session_completed / srs_session_started` > 60%

### Speaking-specific (persona-weak area)
- `mic_permission_prompted`
- `mic_permission_result`
  - Props: `result` (`granted|denied|blocked`), `platform` (`ios|android|desktop`)
- `speech_record_started`
- `speech_record_stopped`
  - Props: `duration_ms`
- `stt_result_ready`
  - Props: `has_text` (boolean), `confidence_avg`

**Targets**
- `mic_permission_result(granted) / mic_permission_prompted` > 70% (mobile)
- `stt_result_ready / speech_record_stopped` > 80%

## RPG / economy / trust surfaces
- `skill_tree_opened`
- `skill_purchase_attempted`
  - Props: `skill_id`, `cost`, `balance_before`
- `skill_purchase_succeeded`
  - Props: `balance_after`
- `adaptive_engine_opened`
- `adaptive_engine_explainer_viewed`
  - Props: `ms_visible`

## AI services (safely)
- `ai_proxy_called`
  - Props: `model`, `prompt_hash`, `max_tokens`
- `ai_proxy_result`
  - Props: `from_cache`, `fallback_used`, `ms`
- `ai_stream_started`
- `ai_stream_completed`
- `ai_stream_error`
  - Props: `code`

## Reliability + performance monitoring (always-on)
- `js_unhandled_error`
  - Props: `message_hash`, `source_file`
- `resource_failed`
  - Props: `url_path`, `type` (`audio|script|css|image`), `error`
- `firestore_status_changed`
  - Props: `status` (`ok|degraded|offline`)
- Web Vitals (sampled):
  - `web_vitals`: `lcp_ms`, `cls`, `tbt_ms`, `fcp_ms`, `fid_ms`

## Dashboards to build (minimum set)
1. **Acquisition → Activation funnel**: `landing_view → landing_cta_click → app_loaded_ready → practice_start`
2. **Day 0 loop closure**: `attempt_scored → vocab_words_added → srs_session_started → srs_session_completed`
3. **Guest → signup**: gate-triggered flows (`hint_blocked`, `vocab_gate`) → `auth_overlay_opened → signup_success`
4. **Speaking health**: mic permission grant + STT success rates by platform
5. **Perf drop-off**: `app_loaded_ready` time vs `practice_start` conversion

## Experiments (tie metrics to fixes)
- Preloader copy/detection change:
  - Success: `preloader_bypass_clicked` drops; `practice_start` rises on Slow 3G.
- A2/PTE landing rewrite:
  - Success: higher `landing_cta_click`, lower bounce, higher `practice_start`.
- Guest baseline hints:
  - Success: higher `attempt_scored` and `attempt_2_started`, plus higher `signup_success` (upsell after value).
- “Save → SRS now” guided step:
  - Success: higher `vocab_words_added` and `srs_session_started` on Day 0.
