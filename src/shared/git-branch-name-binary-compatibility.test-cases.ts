import { expect, it } from 'vitest'
import { isValidGitBranchName } from './git-branch-name'

export function registerGitBranchNameBinaryCompatibilityCases(
  runGit: (args: string[]) => Promise<{ stdout: string; stderr: string }>
): void {
  it('keeps the shared branch validator aligned with check-ref-format', async () => {
    const branchNames = [
      'mission/referral',
      'feature/한글-수정',
      'feature/🚀',
      'topic',
      '@',
      'refs/heads/nested',
      'topic/-inner-dash',
      '',
      'HEAD',
      '-leading-option',
      '/leading',
      'trailing/',
      'double//slash',
      'double..dot',
      '.hidden/topic',
      'topic/.hidden',
      'topic.lock',
      'topic/trailing.',
      'topic@{1}',
      'topic with space',
      'topic~parent',
      'topic^peel',
      'topic:destination',
      'topic?glob',
      'topic*glob',
      'topic[glob',
      'topic\\windows',
      'topic\ud800unpaired-high',
      'topic\udcffunpaired-low',
      'topic\u0000nul',
      'topic\u001fcontrol',
      'topic\u007fdelete'
    ]

    for (const branchName of branchNames) {
      let gitAcceptedExactly = true
      try {
        const result = await runGit(['check-ref-format', '--branch', branchName])
        const output = result.stdout.endsWith('\r\n')
          ? result.stdout.slice(0, -2)
          : result.stdout.slice(0, -1)
        gitAcceptedExactly = output === branchName
      } catch {
        gitAcceptedExactly = false
      }
      expect(isValidGitBranchName(branchName), branchName).toBe(gitAcceptedExactly)
    }

    await runGit(['checkout', '-q', '-b', 'compat-previous'])
    await runGit(['checkout', '-q', '-'])
    await expect(runGit(['check-ref-format', '--branch', '@{-1}'])).resolves.toBeDefined()
    expect(isValidGitBranchName('@{-1}')).toBe(false)
  })
}
