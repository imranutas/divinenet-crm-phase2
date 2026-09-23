# One local start

This local build requires first-use administrator setup and signed-in local access. See [START_HERE.md](../START_HERE.md) for the campaign, banner, intake, backup and restore workflow and [README.md](../README.md) for source-ZIP setup.

Double-click **START-CRM.cmd** on Windows after Node.js 24 and backend dependencies are available. A GitHub source ZIP does not include them. It opens `http://127.0.0.1:3192/#campaigns` after readiness succeeds. It does not install, download or expose anything publicly.

Keep its window open. Ctrl+C is handled by the launcher's graceful stop handler; alternatively double-click **STOP-CRM.cmd** for a package-specific graceful stop. Closing the foreground window ends its Node process; prefer the stop command for a clean database shutdown. Records persist in this package's `data/divinenet.sqlite`; startup never resets, replaces, seeds or imports an older database. Existing previews such as port 3186 and their databases are untouched. If 3192 is occupied, startup stops safely; never close an unknown process to clear the port.

Commands from the project folder:

- `START-CRM.cmd --no-open`: run normally without opening a browser.
- `START-CRM.cmd --no-ai --no-open`: core CRM only; no image runtime is used or started.
- `START-CRM.cmd --check`: validate dependencies, port, pinned AI files and any existing runtime identity/readiness; start no service and open no database.
- `STOP-CRM.cmd` or `START-CRM.cmd --stop`: asks only this package's running CRM to close gracefully, using a local named pipe and a random token under `logs/crm-launch.json`. This adds no HTTP shutdown endpoint and kills no process by PID or name.
- `node scripts/start-crm.cjs --no-open`: equivalent foreground start, useful for verification.

The batch file selects an explicitly supplied `DIVINENET_NODE_EXE`, then `runtime/node.exe` if separately bundled, then Node on PATH. Node must be version 24. It never modifies PATH or PowerShell execution policy. For a fresh source ZIP, install dependencies from the project root using `npm.cmd ci` and `npm.cmd --prefix backend ci`; network access is required and the launcher never runs these automatically. A separately prepared portable package must supply the runtime and a native database dependency matching the target OS/architecture, retain licences and be tested on a clean machine. The GitHub source ZIP is not that portable package.

## Optional local AI

AI is separate because its reviewed files total approximately 6 GB. The launcher searches `ai/`, then `../../AI_RUNTIME_PILOT_15_SEPTEMBER_2026` relative to this project. Alternatively, copy `launcher.config.example.json` to `launcher.config.json` and set `aiDirectory` to the chosen folder (absolute, or relative to this project). `enableAI: false` disables AI; `openBrowser: false` suppresses automatic browser opening. These are the only settings; database and loopback ports cannot accidentally target older copies.

Retain the full model/runtime provenance and licence notices. The launcher checks the exact model files and all runtime binary hashes against `scripts/ai-runtime-files.json`. It never downloads missing files. The reviewed setup is Windows x64, stable-diffusion.cpp commit `07a85c74`, Z-Image-Turbo Q3_K, Qwen3-4B-Instruct-2507 Q4_K_M, the supplied VAE, and NVIDIA Vulkan1 on the tested RTX 5060 laptop. Other hardware, especially CPU-only computers, has not been validated. The core still works when optional AI is unavailable.

At port 1234, an existing server is reused only when its loopback listener, recorded PID, executable path, start time, model and settings match. The launcher never stops a pre-existing AI process. A stopped runtime can be started hidden after checks, with timestamped logs and a process record under this package's `logs/`. Ctrl+C normally stops an AI process created by that same launcher. Abrupt window/system termination can leave that helper running; a later launch may safely recognise its recorded identity. No blanket process termination is used.

Default seed 42 intentionally preserves the reviewed pilot. Identical prompts can yield identical images; this is not varied regeneration. Readiness does not generate a picture and is not proof of image quality or client acceptance. Each actual result needs review. The application's 120-second generation timeout, daily limit and persistent uncertain-execution guard remain unchanged. Do not automatically clear a guard or retry a timed-out generation: the image server reports it cannot cancel an already generating job. Follow the backend's controlled recovery guidance, and never stop an unrelated or shared runtime without coordination.

The package's launcher checks are assistant engineering checks, not member execution, independent QA, live Phase 1 integration or approval for production.
