# Full-course acceptance and targeted fixes - 2026-10-12

Based on the deployed `chat-learning-runtime-feedback-20261012-v1` release from PR #4. **PR #5 was merged and this targeted patch deployed on 2026-10-12 at 08:10 Asia/Shanghai**, following the user's explicit merge/deploy instruction at 08:05. Release: `chat-learning-full-acceptance-20261012-v1`. See [RELEASE.md](RELEASE.md) for production verification and rollback. The earlier runtime patch is retained, not reimplemented; the obsolete whole-site deployment remains paused.

## Reproduced defects

1. **P1 - Common-course progression deadlock.** A normal learner submits the seven introductory chapters and the five common foundations. `currentCourseId` becomes `capstone-patrol`, while the semester project selector permits only one project. Unselected projects block later common courses such as robot learning, agent, mechanical, electrical, and integration courses. Full-access instructor accounts conceal the problem.
2. **P1 - Duplicate submission after a lost response.** The Newbie UI commits a submission, loses its response, then reloads. Its idempotency key existed only in memory, so retry creates a second record. The regression runs the actual UI draft/submit functions against an isolated real SQLite service and reproduces two rows before the fix, one afterward.
3. **P2 - Dataset selection lies after cancellation.** Selecting the zero-time sample and cancelling the confirmation leaves the label at zero seconds while the JSON remains four seconds. Reproduced in the production browser without submitting work.

4. **P2 - Duplicate advanced practice sections.** The production page and actual render function show two identical method/deepening mounts for common advanced lab pages. Removed the redundant call, preserving the editor and course-specific activities.

## Changes

- Compute common-course prerequisites independently of project-selection gates. Unchosen projects remain locked; no submission, exemption, grade, or teacher approval is fabricated. The one-project-per-semester rule stays in force.
- Persist and restore the Newbie submission idempotency key with the local draft. The payload remains unchanged. Same-content retries reuse the original submission after reload.
- Render the advanced practice guide and data exercises once, keeping one consistent set of controls.
- Synchronize dataset labels with the actual input when loading/editing drafts or cancelling a replacement. Custom inputs are explicitly labeled.

Only three live source files change: `service-core.mjs`, `course-progression.mjs`, and `app.js`. No runtime binaries, schema, production records, teacher decisions, quotas, identities, or security controls change.

## Validation

- 22 chapter storage lifecycles: save draft, submit, five concurrent same-key retries, ownership isolation, synthetic reviewer result, restart/readback, same-key retry after restart, stale-draft conflict. Each uses a separate disposable SQLite database and explicit fixture-only access; this is not browser E2E or a real AI quality evaluation.
- Normal student progression and five independent project-choice accounts; second semester choice rejected, unselected project remains locked, no actual OA bridge configured.
- Actual Newbie UI state/submit functions under injected response loss and reload; actual dataset handler under cancel/accept/custom-input cases.
- 49 selected service/UI-state/regression tests pass (28 new + 12 prior runtime/status unit tests + 3 quota tests + 6 original service tests).
- 18 actual Pyodide VM tests pass: all 15 Python exercises plus download disconnect, truncated standard library, and persistent failure. Delayed WASM chunks are injected in the VM. Recovery runs student code once; persistent failure stops after two initialization attempts. These are not mobile-browser or controlled browser-network tests.
- Production desktop: all 22 chapter pages and saved histories inspected; all three project-six direction panels and mower exercise entry opened; Python distance exercise rerun with 13/13 checks. Prior real Git/ROS2 runs are retained as historical evidence, not counted as new runs. No production submission or teacher decision was written.
- Safe patch validation, application, idempotent reapplication, and changed-source refusal verified. Syntax checks passed.

The legacy aggregate `learning-*.test.mjs` suite had 15 passes and three failures **before this patch**: its old `seedBefore` helper attempts to submit all mutually exclusive semester projects without selecting one. These obsolete fixture failures are disclosed, not counted as product failures or silently counted as passing. New fixtures explicitly test the current project-selection contract.

## Not yet accepted

- Real mobile devices/mobile viewport, touch keyboard, and mobile browsers.
- Controlled weak-network/offline recovery in an actual browser, including browser storage/cache behavior.
- Full browser E2E for ordinary-student progression and lost-response/reload retry. Targeted post-deployment desktop checks for dataset cancellation, practice-section deduplication, Python execution, and saved histories are recorded in RELEASE.md; these do not replace mobile or controlled browser-network acceptance.
- Fresh full ROS2/Git/physical-hardware experiments in this run; prior evidence is identified separately.
- Real AI review content quality and the pending project-six/mower reviews (state inspected only).

Thus **the complete production course cannot be signed off as fully usable yet**, even though the four targeted fixes are deployed.

## Apply and reproduce

Use a private copy of the current release. Never pass the active production directory.

```sh
python3 patches/learning-full-acceptance-20261012/apply.py /path/to/copied-release --check
python3 patches/learning-full-acceptance-20261012/apply.py /path/to/copied-release
LEARNING_CANDIDATE_ROOT=/path/to/copied-release node --test patches/learning-full-acceptance-20261012/*.test.mjs
LEARNING_CANDIDATE_ROOT=/path/to/copied-release node --test patches/learning-runtime-feedback-20261012/tests/*.test.mjs patches/learning-runtime-feedback-20261012/integration/quota.test.mjs /path/to/copied-release/tests/learning-service.test.mjs
```

Node 22.13+ required. The 15 synthetic Python solutions in `fixtures/python/` were recovered from the user's prior AI-assisted course verification material; no student work or credentials are included. `manifest.json` verifies every source and output hash before writing; `apply.py` refuses active production and source drift. The change does not deploy or restart anything. Release separately through the established targeted-copy procedure after authorization; rollback by restoring the previous release symlink, with no database downgrade.

## Handoff / publishing status

The initial GitHub push was stopped by automatic approval review pending explicit authorization. On 2026-10-12 at 07:54 Asia/Shanghai, the user authorized pushing this patch and its test evidence and creating a draft PR, initially without deployment. At 08:05 the user explicitly requested "合并部署", authorizing merge and targeted deployment. PR #5 was merged into its existing PR #4 baseline branch, and the production copy was released after all 67 tests passed under the production service account.

The review branch was based on `codex/learning-runtime-feedback-20261012` at `3527691f2cf9c3e38764e99ea4844b504f06fa58`, the already-deployed PR #4 patch record. Merge commit: `930816491bd5008974d0288ca22baaa217551d3e`. The main branch and whole-site deployment workflow were not used. Evidence retains baseline failures, local and server 67-test passes, and post-deployment resource/data checks. Existing course and teacher records are unchanged.
