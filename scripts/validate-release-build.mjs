import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const runId = process.env.REUSE_RUN_ID;
if (runId) {
  assert.match(runId, /^\d+$/);
  assert.match(process.env.RELEASE_TAG, /^v\d+\.\d+\.\d+$/);
  const repo = process.env.GH_REPO;
  assert.ok(repo);
  const api = path => JSON.parse(execFileSync('gh', ['api', `repos/${repo}/${path}`], { encoding: 'utf8', timeout: 45000 }));
  const run = api(`actions/runs/${runId}`);
  const commit = execFileSync('git', ['rev-parse', `refs/tags/${process.env.RELEASE_TAG}^{commit}`], { encoding: 'utf8' }).trim();
  assert.equal(run.repository.full_name, repo);
  assert.equal(run.head_sha, commit, 'Only reuse builds from the exact version tag');
  assert.equal(run.path, '.github/workflows/desktop-release.yml');
  assert.equal(run.status, 'completed', 'Wait for the previous run to finish');
  const { jobs } = api(`actions/runs/${runId}/jobs?per_page=100`);
  for (const name of ['Company server update', 'Windows x64', 'macOS arm64', 'macOS x64']) {
    assert.equal(jobs.find(job => job.name === name)?.conclusion, 'success', `Cannot reuse failed or incomplete build ${name}`);
  }
  console.log(`Verified all four original builds at ${commit}; reusing run ${runId}`);
}
