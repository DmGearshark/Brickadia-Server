# User-facing file handoff

- Do not hand the user only a `/workspace/...` link for a finished downloadable file.
- Put finished user-facing artifacts in `outputs/`, commit the specific artifact and its relevant generator/validator, and push the current branch to `origin`.
- In the final response, provide a direct `raw.githubusercontent.com` link to the committed artifact and label it as a download link.
- Verify the remote branch contains the commit and that the direct-download URL returns successfully before handing it off.
- Preserve unrelated worktree changes; never include them in the artifact commit.

# Scrap Runners task tracking

- Treat `SCRAP_RUNNERS_TODO.md` as the persistent source of truth for the Scrap Runners roadmap.
- Read it before starting Scrap Runners work and update it whenever a task changes state, scope, or gains an important implementation note.
- Do not mark a task `Done` solely because implementation finished. Move it to `Needs user verification`, ask the user whether anything else needs checking or was missed, and raise any concern or follow-up the agent notices.
- Only move a task from `Needs user verification` to `Done` after the user confirms it.
- Commit and push roadmap updates while preserving all unrelated worktree changes.
