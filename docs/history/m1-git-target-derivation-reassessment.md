# M1 Git target derivation reassessment

**Historical evidence.** This document records investigation, design, or observed behavior at an earlier repository state. It is not current normative documentation. See [`../README.md`](../README.md) for the current documentation map.

**Status:** This report's proposed temporary-index M1 design was subsequently
superseded by the simpler M1 changed-path scope boundary. The normative
documents define the current architecture.

## 1. What M1 needs at the Git boundary

M1 needs the set of repository paths that could enter the resulting target, compared with the exact authorized path set. That set is the union of changes in the real index against bound `HEAD` and changes in a Git-staged view of the worktree against the same `HEAD`. A rename contributes both names; M1 does not need rename detection. M1 also needs the same canonical root and `HEAD` at the freshness and final gates ([M1 contract](https://github.com/mikechao/opencode-agents/blob/bf8d5f34324f97f7c11be9437e50ae09fe167aaa/docs/milestone-1-intent-implementation.md)).

The union matters because a staged version can differ from the working file. Neither view alone is complete.

## 2. Is the current snapshot stronger than M1 requires?

**Yes.** The current observer (`src/m1/git.ts`) parses Git's index format, hashes filesystem contents itself, traverses directories twice, and compares file and directory metadata. That attempts to establish a stable physical filesystem view. M1 asks for a Git target path set and does not require proof that no transient filesystem mutation occurred.

It also uses different semantics from Git when configuration deliberately suppresses a physical change. That distinction drives the recommendation below.

## 3. Can a disposable index satisfy M1?

**Yes, for a Git-materializable target, with explicit STOP states.** Git documents `git add -A` as updating an index for additions, modifications, and removals across the worktree; `git diff-index --cached` compares a tree with an index; and `git read-tree` seeds an index without updating worktree files ([git-add](https://git-scm.com/docs/git-add), [git-diff-index](https://git-scm.com/docs/git-diff-index), [git-read-tree](https://git-scm.com/docs/git-read-tree)).

| Case | Temporary-index result |
| --- | --- |
| Staged content differs from worktree | The real-index diff retains the staged path; the temporary-index diff captures the worktree path. |
| Unstaged edits, untracked additions, deletions | `add -A` captures them, subject to Git's ignore and configuration semantics. |
| Rename | `--no-renames` reports deletion at the old path and addition at the new path. |
| Assume-unchanged in real index | Does not hide the worktree edit from a freshly HEAD-seeded index. |
| Skip-worktree | STOP; its meaning includes treating an absent file as unchanged. |
| Fsmonitor | Disable it for observation commands; do not inherit validity hints. |
| Ignored untracked file | Excluded by ordinary `git add -A`; an already staged ignored file remains visible in the real-index diff. |
| Mode, symlink type, symlink target | Git captures changes it can stage. `core.filemode=false` or `core.symlinks=false` can suppress physical-only changes, so STOP under the current strict expectation. |
| Unstaged case-only rename with `core.ignorecase=true` | **Cannot be claimed complete from `git add -A` alone.** Git may retain the indexed spelling. A staged case-only rename is visible in the real-index diff. |

Git documents the behavior of assume-unchanged, skip-worktree, filemode, symlinks, and ignorecase; it warns that forcing `core.ignorecase` away from the filesystem's reality can produce unexpected behavior ([git-update-index](https://git-scm.com/docs/git-update-index), [Git core configuration](https://github.com/git/git/blob/master/Documentation/config/core.adoc)). `-c core.ignorecase=false` should not become an unverified trust fix.

## 4. Minimal observation sequence

For the **Git-materializable-target interpretation**, use the same sequence at baseline, immediately before admission, and after implementation:

1. Resolve and compare the canonical OpenCode location and Git top-level. Resolve `HEAD^{commit}` and require the bound OID when one exists.
2. Read Git's real-index entries with `git ls-files --stage -z`; reject unsupported modes or stages and retain the complete output as an attempt-local comparison value. Check flags with `git ls-files -v -z`. Derive staged paths with `git diff-index --cached --no-renames --name-only -z <bound-head> --`. Use `GIT_OPTIONAL_LOCKS=0` and disable fsmonitor for these observations.
3. For each of **two independently created temporary index files outside the worktree**, set `GIT_INDEX_FILE`, run `git read-tree <bound-head>`, `git add -A`, then `git write-tree`. Do not copy the real index. Reject unsupported target entries. Require both tree OIDs to match.
4. Derive worktree-target paths with `git diff-tree -r --no-renames --name-only -z <bound-head> <temporary-tree> --`. Union these paths with the staged paths and compare by exact path equality with the authorization.
5. Re-read the complete real-index entries and require them to match step 2. Recheck canonical root and `HEAD`. Any command failure or disagreement is STOP.

Use NUL-delimited output throughout; `--no-renames` makes both sides of a rename separate path changes ([git-diff-tree](https://git-scm.com/docs/git-diff-tree), [git-ls-files](https://git-scm.com/docs/git-ls-files)). This sequence does **not** modify the real index, though `git add` can write loose blob objects to Git's object store.

## 5. States to STOP

Keep the supported state small: STOP on unmerged entries, sparse checkout or skip-worktree entries, gitlinks or embedded repositories that become gitlinks, intent-to-add entries, unsupported file types or modes, and failed Git commands. Split indexes can be read through Git plumbing, but STOP is reasonable if M1 chooses not to support them; no custom split-index parser is warranted.

Under the **current tests' physical-change expectation**, also STOP when `core.filemode=false` or `core.symlinks=false`. Case-only worktree spelling changes under `core.ignorecase=true` need a separate, narrow spelling observation or an explicit contract decision; the temporary index alone does not establish them. The focused tests (`test/m1.test.ts`) intentionally require those physical-only observations.

## 6. Remaining races

Comparing two independently built temporary trees detects many worktree changes during observation; comparing real-index entries before and after detects retained index changes; root and `HEAD` checks detect retained binding changes. Any mismatch stops. None of these observations is a lock. A change after the final check, or an away-and-back change between checks, can escape detection. The existing snapshot has the same fundamental limit. M1's stated exemption for transient filesystem mutation is consistent with this bounded observation, but it should not be described as an atomic snapshot.

## 7. Complexity comparison

The temporary-index approach delegates path discovery, ignores, content conversion, modes, and tree construction to Git. Trusted code then handles command results, NUL paths, a small unsupported-state check, and equality checks. The current approach owns an index parser, blob hashing, recursive traversal, ignore classification, stat comparisons, and the interactions among them. Its review and test burden is materially larger.

## 8. Recommendation

**SIMPLIFY THE M1 CONTRACT**, then replace the snapshot observer with the temporary-index design. Define the checked result as the union of the real staged target and a fresh Git-staged worktree target. State explicitly that physical-only changes Git is configured not to stage are outside that target, or STOP for the relevant configuration. Decide separately whether unstaged case-only spelling on a case-insensitive filesystem is an M1 STOP condition; Git's temporary index alone cannot certify both path spellings.

This avoids retaining a general filesystem consistency subsystem to enforce a property stronger than the Git target M1 advances. This reassessment is an architecture investigation, not an implementation change or a claim that the proposed command sequence has been runtime validated.
