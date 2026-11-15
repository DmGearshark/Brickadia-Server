# User-facing file handoff

- Do not hand the user only a `/workspace/...` link for a finished downloadable file.
- Put finished user-facing artifacts in `outputs/`, commit the specific artifact and its relevant generator/validator, and push the current branch to `origin`.
- In the final response, provide a direct `raw.githubusercontent.com` link to the committed artifact and label it as a download link.
- Verify the remote branch contains the commit and that the direct-download URL returns successfully before handing it off.
- Preserve unrelated worktree changes; never include them in the artifact commit.
