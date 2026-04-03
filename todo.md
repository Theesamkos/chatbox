# ChatBridge / TutorMeAI — Electron Integration TODO

Built on top of: https://github.com/chatboxai/chatbox

## Phase 2: Setup
- [x] Clone Chatbox repo
- [x] Install dependencies (pnpm install)
- [x] Verify build system works
- [x] Create todo.md

## Phase 3: Plugin Infrastructure
- [ ] Create `src/renderer/packages/plugin-bridge/` directory structure
- [ ] Implement `PluginBridge` class with typed postMessage protocol
- [ ] Implement origin validation (allowlist enforcement)
- [ ] Implement message type routing (PLUGIN_READY, TOOL_INVOKE, TOOL_RESULT, STATE_UPDATE, PLUGIN_COMPLETE, PLUGIN_ERROR)
- [ ] Implement timeout watchdog (5s for PLUGIN_READY, 10s for TOOL_RESULT)
- [ ] Create `PluginContainer` React component (sandboxed iframe host)
- [ ] Plugin registry in electron-store (plugin_schemas equivalent)
- [ ] Plugin allowlist enforcement (no iframe loads unless in allowlist)
- [ ] Circuit breaker (3 failures in 5 minutes → disable plugin for session)
- [ ] Audit logging to electron-store (audit_logs, plugin_failures, safety_events)

## Phase 4: Context Assembly Engine
- [ ] Context assembly function: load last 20 messages + plugin state + tool schemas
- [ ] Dynamic system message builder (K-12 safety guidelines + plugin context)
- [ ] Plugin state injection into LLM context on every user turn
- [ ] Tool schema injection (OpenAI-compatible function definitions)
- [ ] Context window management (summarize oldest 10 if >60k tokens)
- [ ] SSE streaming with tool_invoke, tool_result, token, complete, error events
- [ ] Tool invocation routing: LLM → PluginBridge → TOOL_INVOKE → TOOL_RESULT → LLM re-invocation

## Phase 5: Safety Layer
- [ ] Pre-LLM input moderation (K-12 content policy pattern matching)
- [ ] Prompt injection detection (ignore previous instructions, etc.)
- [ ] Input length enforcement (4000 char max)
- [ ] Pre-LLM plugin state inspection (scan string fields for injection patterns)
- [ ] Post-LLM output moderation (K-12 content policy, PII detection, harmful content)
- [ ] Session freeze logic (status: frozen → reject further sends)
- [ ] Safety events logging to electron-store

## Phase 6: Plugin Apps
### Chess (continuous bidirectional)
- [ ] Chess plugin HTML with legal move validation (chess.js)
- [ ] Piece drag-and-drop or click-to-move
- [ ] Visual last-move indicator + check/checkmate detection
- [ ] Tools: start_game, make_move, get_board_state, get_legal_moves
- [ ] STATE_UPDATE on every move (FEN + turn + moveHistory + status)
- [ ] PLUGIN_COMPLETE on checkmate/stalemate/resignation/draw
- [ ] FEN string validation before storage

### Timeline Builder (structured completion)
- [ ] Timeline plugin HTML with drag-and-drop event cards
- [ ] Keyboard accessibility for drag-and-drop
- [ ] Tools: load_timeline, validate_arrangement
- [ ] PLUGIN_COMPLETE with student order, correct order, per-item correctness, score
- [ ] LLM feedback on historical reasoning after completion

### Artifact Investigation Studio (guided multi-step)
- [ ] Discover phase: search interface → Smithsonian API (server-side proxy)
- [ ] Fallback to Library of Congress API if Smithsonian fails
- [ ] K-12 content filter on artifact search results
- [ ] Inspect phase: high-res image + metadata + annotation tools
- [ ] Investigate phase: observations/evidence/claims form with min char requirements
- [ ] Conclude phase: review + submit → INVESTIGATION_COMPLETE
- [ ] Tools: search_artifacts, get_artifact_detail, submit_investigation
- [ ] Image proxy through platform server (no direct student browser requests to external APIs)
- [ ] Offline cached dataset fallback if both APIs fail

## Phase 7: K-12 UI
- [ ] Split-view layout when plugin active (chat left, plugin right, resizable)
- [ ] Layout returns to full-width on plugin completion
- [ ] Plugin picker in sidebar (K-12 section)
- [ ] K-12 mode indicator in header
- [ ] Teacher/admin role-based access (role field in user store)
- [ ] Session freeze UI (frozen sessions show "under review" message)
- [ ] Plugin loading state (spinner + "tool is loading" indicator)
- [ ] Plugin error state ("tool temporarily unavailable")
- [ ] Circuit breaker UI ("tool has been temporarily disabled")
- [ ] Tool invocation indicator in chat ("thinking" + "active" state)

## Phase 8: Testing & Delivery
- [ ] Test scenario 1: user asks chatbot to use a third-party app (tool discovery + invocation)
- [ ] Test scenario 2: third-party app UI renders correctly within chat
- [ ] Test scenario 3: user interacts with app, returns to chatbot (completion signaling)
- [ ] Test scenario 4: chatbot remembers app results after completion (context retention)
- [ ] Test scenario 5: user switches between multiple apps in same conversation
- [ ] Test scenario 6: ambiguous question routing accuracy
- [ ] Test scenario 7: chatbot refuses to invoke apps for unrelated queries
- [ ] All 10 acceptance criteria from PRD verified
- [ ] Push to GitLab
- [ ] README with setup guide, architecture overview, API docs
- [ ] Demo video script prepared
