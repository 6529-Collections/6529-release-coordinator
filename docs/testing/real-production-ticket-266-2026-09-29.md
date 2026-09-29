# Real production ticket #266: runtime pin stop, September 29

The user authorized one real-profile, filtered run for [Issue #266](https://github.com/6529-Collections/6529-release-coordinator/issues/266), actor `simo6529`. The request targets production with `database_change: no` and pins frontend [PR #4093](https://github.com/6529-Collections/6529seize-frontend/pull/4093) at `6c54b615084a5d0ad0c3ca9b17166fb53485a238`. The run used Coordinator `main` at `5cccdec5d1958636707cc4335c60544138f7697c` and acquired journal run lock `5375bc43-986c-418c-8a3c-bc64713e313f`.

The ticket receipt was valid. Exact-PR rehearsal against frontend `main` at `2c5c9db6239c86a297f0b2c94b28cbcb95a99dd2` passed and its temporary Git workspace was removed. The combined candidate passed the Git check and all required checks on temporary frontend [PR #4123](https://github.com/6529-Collections/6529seize-frontend/pull/4123). The Coordinator closed that trial PR and removed its owned branch. These results are pre-release evidence, not staging or production proof.

Before release authorization, the product runtime identity guard rejected the backend `.github/workflows/deploy.yml` pin. Immediately after the stop, read-only branch/tree checks found:

| Backend branch | Observed commit | Reviewed workflow blob | Previous Coordinator pin |
| --- | --- | --- | --- |
| `1a-staging` | `42ee0fcdd45d67803cc285e3d6a2aa636080d011` | `55f2db38999869b7b231c476f849ae330abef1da` | `4738363b457f5af9a2497b2854d1e5f78c241222` |
| `main` | `18a11298b67a436d74a023fa2332c97e13e0ebcd` | `eff687cc84a14df7f15134af1068039c5b875bda` | `4738363b457f5af9a2497b2854d1e5f78c241222` |

The backend workflow changes predate this run. Both branches changed the `mediaResizerLoop` deployment from a fixed sleep to Lambda update waits, set and verify 2048 MiB memory, and fail on a mismatch. Staging also added `websocketOutboundHandler` to the service allowlist and verification mapping. The workflow dispatch inputs and exact-source guard remain in place. The frontend runtime files matched their pins on both branches. The Coordinator update pins the two reviewed backend blobs independently; it does not change product repositories or waive runtime verification.

The command exited 2 with `release_authorized: false`. The local run log at `~/.6529-release-coordinator/logs/real/1346244762/5375bc43-986c-418c-8a3c-bc64713e313f.jsonl` has no staging or production release step. Issue #266 remained `status:received` and the journal retained the original lock; the original process exited. No product merge or deployment is claimed. Do not start a separate run: after the Coordinator pin update passes checks and is merged, recheck current branches, PR head, runtime files, journal lock and process ownership before explicitly resuming this same run ID. A new drift or incompatible workflow change must stop again.
