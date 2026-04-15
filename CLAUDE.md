# Claude Code 가이드

## Git Workflow

- 새 작업은 항상 `.worktrees/<feature-name>` 안에 feature 브랜치로 시작
- **main 브랜치에 직접 커밋 금지**
- 작업 완료 후 `gh pr create`로 PR 생성
- Worktree 디렉토리: `.worktrees/`

### 새 기능 개발 시 순서

1. `git worktree add .worktrees/<feature-name> -b feature/<feature-name>`
2. `cd .worktrees/<feature-name> && npm install`
3. 작업 진행 및 커밋
4. `gh pr create`로 PR 생성
5. 머지 후 `git worktree remove .worktrees/<feature-name>`
